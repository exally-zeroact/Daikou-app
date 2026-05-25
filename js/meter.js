// 距離累積・料金計算
// 2026-05-09 設計変更: MM 優先 + GPS fallback (5s silent threshold)
//   旧: state.distance_m = GPS 直線+×1.3 補正 / MM は参照のみ
//   新: state.distance_m = MM 道路距離 (primary) / MM silent 5s+ で GPS 直線 (fallback)
//   業務継続性は維持: MM Worker dead でも GPS 経路で課金が動く
// eslint-disable-next-line no-unused-vars -- 他ファイルから Meter をグローバル参照 (cross-file global pattern)
const Meter = (() => {
  let state = {
    running: false,
    distance_m: 0,
    distanceSource: 'gps', // 'mm' | 'gps' | 'gap' | 'inline' | 'offroad' 直近で distance_m を更新したソース
    fare_yen: 0,
    elapsed_sec: 0,
    // ★設計変更宣言 (2026-05-18・Phase 1 A1 案・setInterval 全廃→都度計算):
    //   旧: state.elapsed_sec を setInterval 1Hz で増加・ブラウザ throttle で不整合リスク
    //   新: stop/resume の度に確定加算 + getState() で都度計算 (= 単一の真実源)
    elapsed_accumulated_sec: 0, // 累積走行時間 (= stop / businessEnd で確定加算)
    last_resume_time: null, // 直近 start / resume の時刻 (= 都度計算の基準)
    // ★設計変更宣言 (2026-05-18・Phase 2・business_active gate 化):
    //   旧: business_distance_m を running gate (= 代行中のみ) で加算
    //   新: business_distance_m は business_active gate (= 業務中常時) で加算
    //   理由: 後付メーター機との対等性・業務総走行距離は空車中も増加する仕様
    //   分離: distance_m (= 課金根拠) は running gate のまま・絶対不可侵
    business_active: false, // 業務中フラグ (= Business.start/end で外部設定)
    // ★設計変更宣言 (2026-05-18・Phase 3・案G Layer 1+3・GPS predictive + Reconciliation):
    //   旧: 表示式 = distance_m + tier2_pending_m (= Worker B 確定 + preview)
    //       → iOS 1Hz GPS + Viterbi 窓 N=10 で 5-10 秒ラグ (= P2)
    //       → Off-Road 復帰時 tier2 一括 0 リセットで表示 150m 急減 (= P3)
    //   新: + gps_predictive_distance_m (= GPS speed × dt 即時加算・1 秒以内ラグ)
    //       + display_distance_m (= Reconciliation で滑らか同期・急減ゼロ)
    //       tier2_pending_m は通常 commit 差分減算で維持 (= 既存挙動互換)
    //   絶対ルール準拠: 表示専用・課金経路ゼロ・distance_m は無変更。
    gps_predictive_distance_m: 0, // GPS speed × dt 即時加算 (= P2 ラグ解消)
    display_distance_m: 0, // Reconciliation で滑らか同期した表示用 (= P3 急減ゼロ)
    last_display_update_time: null, // display_distance_m の前回更新時刻
    start_time: null,
    last_gps: null,
    last_timestamp: null,
    last_speed_kmh: 0, // GPS消失時の補完用
    gap_fill_count: 0, // GPS消失補完回数（サマリー表示用）
    gap_fill_total_m: 0, // GPS消失補完合計距離
    // ─── Map Matching（2026/04/30追加・既存distance_mとは独立） ───
    mm_distance_m: 0, // Map Matching距離（道路にsnapした実距離・参照値）
    mm_snap_count: 0, // snap成功回数（精度評価用）
    mm_total_count: 0, // update呼び出し回数（snap成功率算出用）
    mm_skip_count: 0, // 異常値でスキップした回数
    // ─── Phase 1.C Off-Road Mode (2026-05-10 追加) ───
    offroad_distance_m: 0, // Off-Road Mode で加算した距離 (参照値)
    offroad_count: 0, // Off-Road Mode 起動回数
    // ─── 待機料金 (fareConfig v2・2026-05-10 追加) ───
    wait_sec: 0, // 累積待機時間 (秒・速度<3km/h で加算)
    // ─── 業務単位累積距離 (2026-05-14 追加) ───
    // ★設計変更宣言 (2026-05-14・総走行距離を業務開始からの全走行距離に修正):
    //   業務開始から終了までの「総走行距離」(実車中 + 空車中 + 待機中の道路移動全部) を累積する。
    //   distance_m は trip 単位 (fare 計算入力) で Meter.start() / Meter.reset() でリセットされるが
    //   business_distance_m は trip 跨ぎで保持し、Meter.businessEnd() でのみ 0 化する。
    //   絶対ルール準拠: 距離計算は既存 5-tier (MM / inline / gap / off-road / GPS) と同じ道路距離。
    //   永続化: Business.onGps() 経由で daikou_business_state の state.total_distance_m に sync。
    business_distance_m: 0,
    // ─── Tier 2 リードインジケータ用 表示先行距離 (2026-05-15 追加・2026-05-16 Worker B 経由に移行) ───
    // ★設計変更宣言 (2026-05-17・RegionLoader 撤去対応):
    //   Tier 2 は Worker B mmResult.tentativeIncrementM 経由で毎 GPS step 加算される (= 道路 polyline 距離)。
    //   表示式は state.distance_m + state.tier2_pending_m (即時反映)、課金式は
    //   state.fare_yen = calcFare(state.distance_m) のまま (Tier 1 authoritative 維持)。
    //   commit 受領時に mmIncrementM ぶん差分減算 (0 下限 clamp・単調増加保証)。
    //   絶対ルール準拠:
    //     ✓ 距離計算 = Worker B dec.calcRoadDistance (道路 polyline 距離)
    //     ✓ GPS 直線距離は経由しない (snap miss 時は加算ゼロ・据え置き)
    //     ✓ iOS / Android 両経路で同一動作 (platform 分岐なし)
    tier2_pending_m: 0,
    // ★設計変更宣言 (2026-05-24・表示層 予測補間・実距離値 1 byte 不変):
    //   GPS 1Hz 物理限界 + UI 500ms refresh の・stair-step (= カクカク) 解消用 state。
    //   target_velocity_mps = 直近 1 秒の target 増分 / dt で・自己整合算出
    //     (= GPS speed 依存なし・屋内 drift で・target 0 進捗なら velocity 0・予測ゼロ)
    //   予測 = velocity × min(1.0, 経過時間) で・display を・滑らかに先取り表示
    //   絶対ルール準拠:
    //     ・state.distance_m / business_distance_m / tier2_pending_m / business_tier2_pending_m:
    //       1 byte 不変 (= 実距離値・課金根拠不可侵)
    //     ・本 state は・表示専用 layer (= display_distance_m 同様・課金経路ゼロ)
    _prev_target_distance_m: 0, // 課金 display 用・直近 target 値
    _prev_target_time: null, // 課金 display 用・直近 target 更新時刻
    _target_velocity_mps: 0, // 課金 display 用・直近 1 秒の・target 速度 m/sec
    // ★ business preview 別回路の・表示用 display (= 業務 totalDist 用)
    business_display_distance_m: 0, // 表示用・business_distance_m + business_tier2_pending_m 滑らか追従
    last_business_display_update_time: null,
    _prev_business_target_distance_m: 0,
    _prev_business_target_time: null,
    _business_target_velocity_mps: 0,
    // ★設計変更宣言 (2026-05-24・司さん採用指示・business preview 完全別回路):
    //   旧: business_distance_m の表示は・確定値のみ・Viterbi ~15 秒ラグで・走行中フリーズ感
    //   新: 業務専用 preview state を・新設・課金 tier2_pending_m とは・完全独立
    //   絶対原則: 仕組み(暫定値+確定減算で即時表示)は課金と同じだが・回路は完全独立
    //     ・課金 tier2_pending_m の・宣言/累積/確定減算/表示は・1 byte 不変
    //     ・1 つの if 文や式に・課金 / business を・相乗りさせない (= 完全別ブロック・別変数)
    //     ・課金回路の・中間変数を・business が・間借りすることを禁止
    //   表示式: 総走行距離 = business_distance_m + business_tier2_pending_m (= 業務 driveDist 相当)
    //   永続化: state.business_distance_m のみ (= preview は・揮発・state 再構築で 0)
    business_tier2_pending_m: 0,
  };

  // Tier 2 リードインジケータ用 道路 snap セグメントキュー (2026-05-15 追加)
  //   各エントリ: {endTimestamp, distanceM}
  //   _onMmWorkerMessage の commit 分岐で cutoffTs 以前を削除し pending から差し引く。
  let _tier2Segments = [];

  // MM 優先設計 (2026-05-09):
  //   _onMmWorkerMessage が mmIncrementM>0 を受信した時刻
  //   (now - lastMmUsefulAt) > MM_SILENT_THRESHOLD_MS で MM "silent" と判定し
  //   GPS 直線距離を fallback として state.distance_m に加算する
  let lastMmUsefulAt = 0;
  // eslint-disable-next-line no-unused-vars -- 将来 fallback 再活用予定 (= 旧 MM 沈黙判定 threshold)
  const MM_SILENT_THRESHOLD_MS = 2500; // A2 (2026-05-09): 5000→2500 短縮で fallback 早期化

  // ★設計変更宣言 (2026-05-15・代行開始直後の Worker B バッファ残骸 drain):
  //   問題: 業務開始 → 空車中 (state.running=false) でも MM Worker B は GPS を受け
  //         _onMmWorkerMessage 経路で state.business_distance_m を蓄積する設計。
  //         代行開始 (Meter.start) は worker に postMessage('reset') を送るが ASYNC のため、
  //         worker が直前に commit した mmIncrementM が queue 内に残り、Meter.start() 完了
  //         直後の event loop tick で main thread が受信する。
  //         この時点で state.running=true (代行中) のため state.distance_m += バッファ残骸
  //         が走り driveDist が 0.17km 等で開始してしまう (司さん 2026-05-15 報告事象)。
  //         加えて business_distance_m も既に空車 phase で加算済なので二重カウントになる。
  //   対策: Meter.start() で _drainMmUntil = Date.now() + DRAIN_MS を設定し、
  //         _onMmWorkerMessage の mmIncrement 加算経路でこの時刻未満は state.distance_m /
  //         state.business_distance_m のどちらも加算しない (mm_distance_m / lastMmUsefulAt
  //         は stats のため更新する)。
  let _drainMmUntil = 0;
  const MM_DRAIN_AFTER_START_MS = 500;

  // ★設計変更宣言 Phase 1.C (2026-05-10): Off-Road Mode
  //   snap 連続失敗時に Worker B が distance を計算できなくなる
  //   (例: 私道・駐車場・農道・OSM 未登録道路)
  //   → Kalman 平滑化済 GPS 連続点の haversine 累積で距離継続加算
  //   絶対ルール準拠:
  //     ・ Kalman 平滑化済 GPS 連続点の polyline 累積 = 許可
  //     ・ A→B の一発 haversine 直線課金 = 禁止 (本実装は連続点間累積)
  //   起動条件: snap miss 5 回連続 (= 直近 GPS が road から 50m 超 5 秒以上に等価)
  //   保護: GPS accuracy >50m / 物理上限 160km/h / isStationary 時は加算しない
  //   終了条件: Worker B が再 commit (mmIncrement>0) → 通常 HMM モード復帰
  //   2 重課金防止:
  //     ・ Off-Road active 中の Worker B mmIncrement は無視
  //     ・ 退場時に Worker B に resetCommittedSnap 送信し未来の commit を再起点化
  let _offRoadActive = false;
  let _consecutiveSnapMiss = 0;
  let _haverAccumSinceLastCommit = 0; // 直近 commit からの haversine 累積 (retroactive 用)
  const OFFROAD_SNAP_MISS_THRESHOLD = 5;
  const OFFROAD_ABS_MAX_KMH = 160; // 物理上限
  // ★設計変更宣言 (2026-05-19・R1・代行開始直後 Off-Road 起動 grace period):
  //   旧: 代行開始直後・Worker B reset 後 commit 遅延中に snap miss 5 連続 →
  //       Off-Road 起動 → retroactive 加算で 200m 一括飛び事象 (司さん実車報告)
  //   新: 代行開始 (Meter.start) から 5 秒間は Off-Road 起動を skip。
  //       Worker B が安定して commit を出し始める時間を確保し・retroactive 一括加算を防ぐ。
  //   絶対ルール準拠:
  //     ・distance_m / fare_yen / calcFare ロジック無変更
  //     ・5 秒経過後は通常 Off-Road 起動ロジック発火 (= 課金漏れ防止維持)
  //     ・grace 中の haversine 累積 buffer は維持 (= 5 秒経過後の正規 Off-Road 起動で
  //       retroactive 加算する場合・本物の Off-Road 区間の課金漏れ防止)
  let _offRoadGraceUntil = 0;
  const OFFROAD_GRACE_AFTER_START_MS = 5000;

  // MM-1: Worker B 参照（index.html から setMapMatcher で注入）
  //   ★設計変更宣言 (2026-05-17・RegionLoader 撤去): null の場合の inline fallback は廃止。
  //   Worker B 不在時は Tier 4 (gap fill) / Off-Road / 据え置きのいずれかで対応。
  let mmWorker = null;

  // MM-2 (2026-05-08): 評価インフラ
  //   Worker B の各 GPS 更新あたり処理時間を循環バッファに記録し p99 を算出
  //   Meter.getMMStats() で常時取得可能
  const _MM_LATENCY_BUFFER_SIZE = 1000;
  const _mmLatencyBuf = new Float32Array(_MM_LATENCY_BUFFER_SIZE);
  let _mmLatencyIdx = 0;
  let _mmLatencyCount = 0;
  // 候補数の累積（多候補化の効果計測用）
  let _mmCandCountSum = 0;
  let _mmCandCountSamples = 0;

  function _recordMmLatency(ms) {
    if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return;
    _mmLatencyBuf[_mmLatencyIdx] = ms;
    _mmLatencyIdx = (_mmLatencyIdx + 1) % _MM_LATENCY_BUFFER_SIZE;
    if (_mmLatencyCount < _MM_LATENCY_BUFFER_SIZE) _mmLatencyCount++;
  }

  function _calcP99Latency() {
    if (_mmLatencyCount === 0) return 0;
    const arr = new Array(_mmLatencyCount);
    for (let i = 0; i < _mmLatencyCount; i++) arr[i] = _mmLatencyBuf[i];
    arr.sort(function (a, b) {
      return a - b;
    });
    const idx = Math.floor(_mmLatencyCount * 0.99);
    return arr[Math.min(idx, _mmLatencyCount - 1)];
  }

  // 起動時warm up：代行開始前から GPS を保持しておく（2026/04/30追加）
  // 「代行開始」押した瞬間にすぐメーターが動くようにするため
  // ボタン追加せず、内部で常に GPS を受け取って lastWarmupGps に保存
  let lastWarmupGps = null;

  // ★設計変更宣言 (2026-05-10): fareConfig を v2 に拡張
  //   後方互換維持: 旧キー (base_fare/base_distance_m/add_fare/add_distance_m) は残し、
  //   tiers/surcharges 等の新キーが空 or 不在なら旧来通り動作する。
  //   firebase.js の loadFareConfig migration で旧形式を自動 v2 化する。
  let fareConfig = {
    version: 2,
    base_fare: 1300,
    base_distance_m: 1000,
    add_fare: 100,
    add_distance_m: 420,
    tiers: [],
    surcharges: [],
    minFare: null,
    maxFare: null,
    rounding: 10,
    autoSurcharges: {
      night: { enabled: false, from: 22, to: 5, rate: 1.2 },
      weekend: { enabled: false, rate: 1.1 },
      winter: { enabled: false, from: '12-15', to: '03-15', rate: 1.1 },
    },
    vehicles: [],
    vehiclesEnabled: false,
    wait: { enabled: false, freeMins: 5, ratePerMin: 100 },
  };

  // 業務画面で ON/OFF された手動 surcharge の id Set
  let _activeSurchargeIds = new Set();
  // 業務開始時に選択された車種 id (vehiclesEnabled=true のみ有効)
  let _activeVehicleId = null;

  // ハイブリッド計測の閾値
  // 旧: HYBRID_SPEED_KMH = 30 (Tier S P3 で update() の hybrid 経路を撤廃済・現在 dead)
  //     HYBRID_DISCREPANCY = 0.5 (同様に dead)
  // D4 (2026-05-09): 道路種別別の最大期待速度 (GPS 異常値クランプ用・gap fill で使用)
  //   GPS が誤って 200km/h を報告しても road type で sanity check
  //   typeCode: 0=motorway, 1=trunk, 2=primary, 3=secondary, 4=tertiary,
  //             5=unclassified, 6=residential, 7-11=*_link, 12=track
  const ROAD_MAX_KMH_BY_TYPE = {
    0: 120,
    1: 100,
    2: 80,
    3: 70,
    4: 60,
    5: 50,
    6: 40,
    7: 80,
    8: 80,
    9: 70,
    10: 60,
    11: 50,
    12: 30,
  };
  function _maxSpeedFor(typeCode) {
    if (typeCode == null) return 100;
    const v = ROAD_MAX_KMH_BY_TYPE[typeCode];
    return v != null ? v : 80;
  }
  let _lastSnapTypeCode = null;

  // GPS消失補完の閾値
  const GAP_THRESHOLD_SEC = 5; // 5秒以上の空白＝GPS消失
  const GAP_MAX_SEC = 600; // 最大10分（それ以上は異常）
  // ★設計変更宣言 (2026-05-17・RegionLoader 撤去): NEAR_INFRA_RADIUS_M / MM_MAX_SNAP_DIST_M /
  //   MM_MAX_SEGMENT_DIST_M / MM_GAP_RESET_SEC は inline snap / tunnel-bridge polyline 経路でのみ
  //   使用していたため削除。Worker B 側は map-matcher.js 内で独自の定数を持つ。

  // Map Matching 設定（2026/04/30追加）
  const MM_ENABLED = true; // Map Matching ON/OFF

  // ★設計変更宣言 (2026-05-18・Phase 1 A1 案): timer 変数は setInterval 全廃で不要
  // (旧 let timer = null は削除)

  // F6 (2026-05-09): 業務中の fareConfig 変更を抑制
  //   業務開始時に凍結・業務終了/idle で解凍
  //   Firebase 側の非同期更新が走行中に降ってきても fare 計算には反映しない
  //   (途中でメーターが急変するのを防ぐ)
  let _fareConfigFrozen = false;
  function setFareConfig(config) {
    if (_fareConfigFrozen) {
      if (typeof dlog === 'function')
        dlog('[Meter] setFareConfig ignored (frozen during business)');
      return;
    }
    fareConfig = { ...fareConfig, ...config };
  }
  function getFareConfig() {
    return { ...fareConfig };
  }

  // ─── MM-1: Worker B 連携 ───────────────────────────────
  // B1 (2026-05-09): roadsLoaded ack を Set で track して MM ready 判定に使う
  let _workerLoadedPrefs = new Set();
  function setMapMatcher(worker) {
    if (mmWorker) {
      try {
        mmWorker.removeEventListener('message', _onMmWorkerMessage);
      } catch (e) {
        /* noop - intentionally empty */
      }
    }
    mmWorker = worker || null;
    _workerLoadedPrefs = new Set(); // 新 Worker 起動で再カウント
    if (mmWorker) {
      mmWorker.addEventListener('message', _onMmWorkerMessage);
    }
  }
  function isMmReady() {
    return mmWorker && _workerLoadedPrefs.size > 0;
  }

  // MM-7: 最新 MM-7 統計を保持（mmResult から間接取得）
  let _lastMcmN = 0;

  // Phase 1.C Off-Road Mode ヘルパー
  //   通常時に GPS 連続点の haversine を累積する (= 直近 commit からの distance buffer)
  //   Off-Road 起動時に retroactive add するため事前に蓄積しておく
  function _trackHaversineBetweenGps(gpsResult, dtSec) {
    if (_offRoadActive) return; // off-road 中は incremental add で別経路
    if (!state.last_gps) return;
    if (gpsResult.isStationary) return;
    if (gpsResult.accuracy != null && gpsResult.accuracy > 50) return;
    if (state.last_gps.accuracy != null && state.last_gps.accuracy > 50) return;
    if (dtSec <= 0 || dtSec > 60) return;
    const d = GPS.calcDistance(
      state.last_gps.lat,
      state.last_gps.lng,
      gpsResult.lat,
      gpsResult.lng
    );
    // 物理上限 sanity (160km/h × dtSec + 5m 余裕)
    const physMaxM = (OFFROAD_ABS_MAX_KMH / 3.6) * Math.max(1, dtSec) + 5;
    if (d > physMaxM) return;
    _haverAccumSinceLastCommit += d;
  }

  // ★設計変更宣言 (2026-05-24・候補 A・business_distance_m 専用 連続点 ZUPT):
  //   ★ business_distance_m += 経路 (L934) 専用のガード追加 ★
  //   ・distance_m 5 経路 (L440/514/961/979/1365): 1 byte 不変 (= 課金根拠不可侵)
  //   ・isStationary 判定本体 (= gps.js / Worker A / Meter._isStationary): 1 byte 不変 (= 司さん専決)
  //   ・判定: (直近 30 秒 net 変位 < 10 m) AND (現 sample haversine < 5 m) なら「微動」と判定し
  //          business_distance_m += skip。AND 条件で・「停車→急発進境界」 の誤 skip を回避。
  //   閾値根拠 (= 走行中 skip ゼロ・絶対担保):
  //     v1 (= net のみ): 急発進境界で・119 km/h sample も skip (= 不適合) → 棄却
  //     v2 (= net AND 現 haver): 14.64 km/h で・skip 残存 (= 急発進低速 sample)
  //   走行中 skip 評価 (= trace -OtKTB5jBfoqcNsgeU5v):
  //     24 km/h 以上: 1 秒 6.7m+ → 現 haver 5m+ 確実 → ★ skip ゼロ ★
  //     徐行 14 km/h: 急発進境界 (= 信号停止 25s + 加速 5s) で・skip 残存 (= 司さん判断要)
  //   buffer warmup safety:
  //     直近 5 sample 未満 / buffer 最古 t < 10 秒 → 判定不可・false (= 既存挙動維持)
  const ZUPT_WINDOW_MS = 30000;
  const ZUPT_NET_THRESHOLD_M = 10;
  const ZUPT_INSTANT_HAVER_THRESHOLD_M = 5; // 現 sample haversine >= 5m なら・即走行扱い
  const ZUPT_MIN_SAMPLES = 5;
  const ZUPT_MIN_BUFFER_AGE_MS = 10000;
  const _zuptHistory = []; // [{lat, lng, t}]

  function _updateZuptHistory(gpsResult) {
    const now = gpsResult.timestamp;
    // 古い entry (= 30 秒以上前) を shift
    while (_zuptHistory.length > 0 && now - _zuptHistory[0].t > ZUPT_WINDOW_MS) {
      _zuptHistory.shift();
    }
    _zuptHistory.push({ lat: gpsResult.lat, lng: gpsResult.lng, t: now });
  }

  function _isBusinessZuptMicroMotion(gpsResult, currentHaverM) {
    // 直近 30 秒 net 変位 < 10 m AND 現 sample haversine < 5 m → true (= 微動)
    // buffer warmup 中 (= sample < 5 / 古い側 < 10 秒) は false (= 既存挙動維持)
    if (_zuptHistory.length < ZUPT_MIN_SAMPLES) return false;
    const oldest = _zuptHistory[0];
    if (gpsResult.timestamp - oldest.t < ZUPT_MIN_BUFFER_AGE_MS) return false;
    // 現 sample が・閾値以上動いていれば・即走行扱い (= 急発進境界・5+ m/s = 18 km/h 以上)
    if (currentHaverM >= ZUPT_INSTANT_HAVER_THRESHOLD_M) return false;
    const netDist = GPS.calcDistance(oldest.lat, oldest.lng, gpsResult.lat, gpsResult.lng);
    return netDist < ZUPT_NET_THRESHOLD_M;
  }

  //   Off-Road 中に毎フレーム加算する 1 step distance
  //   Kalman 平滑化済 GPS 連続点の haversine = polyline 累積の 1 区間
  // ★設計変更宣言 (2026-05-16・距離計算精査・停車判定共通ヘルパ):
  //   バグ2 (停車中の業務距離増加) の根治のため、Tier 1〜4 全経路で
  //   停車判定を共通化する。
  //   - business_distance_m += 加算をスキップする際に使用
  //   - distance_m (課金) への加算では使わない (絶対ルール「distance_m 変えない」)
  //   - iOS/Android 共通 (state.last_isStationary は GPS layer 由来で両 OS 共通)
  // ★設計変更宣言 (2026-05-16・補助 speedKmh 閾値を撤去・実走テストで走行中も停車誤判定):
  //   旧仕様 A: state.last_speed_kmh < 2 km/h (= 2km/h 閾値) → iOS speed=0 で誤判定
  //   旧仕様 B: gps.js isStationary 優先 + speed_kmh < 0.5 補助 → 補助が依然 iOS speed=0 で
  //            誤判定 (= GPS first fix 直後 / 屋内・低精度時 / 瞬間 null 化で speedKmh=0)
  //   新仕様: gps.js isStationary フラグ (= 5秒継続低速 + 3m 以内・保守的判定) のみを信頼。
  //          speedKmh 補助判定を完全撤去。
  //   理由:
  //     ・iOS Safari Geolocation API の coords.speed は走行中も null/0 を返す癖がある
  //     ・gps.js の isStationary 判定は 5 秒継続 + 3m 以内で確実な「停車」のみ true 返却
  //     ・state.last_isStationary === true のみで判定すれば iOS speed=0 ノイズに左右されない
  //     ・undefined (= 初期化前) は false 扱い (= 業務継続性最優先・加算許容)
  //   両 OS で同一動作 (= gps.js が両 OS 共通の isStationary 判定を提供)。
  function _isStationary() {
    // gps.js が確定した isStationary のみを信頼 (= 5秒継続低速 + 3m 半径以内)
    // 補助の speedKmh 判定は撤去 (= iOS GPS speed=0 ノイズで Worker B 出力が常時 0 化する事象を防ぐ)
    return state.last_isStationary === true;
  }

  // ★絶対ルール適用外区間（明示宣言）
  // Off-Road Mode は道路ジオメトリが利用できない区間のみ GPS polyline（短区間haversine積み上げ）を使用。
  // GPS直線距離（出発→到着の一発計算）とは異なり1〜5秒ごとの積み上げで実走行距離を近似する。
  // 停車中・精度50m超・物理速度上限超過は加算しない。Worker B復帰時にresetCommittedSnapで二重課金防止。
  function _calculateOffRoadIncrement(gpsResult, dtSec) {
    if (!state.last_gps) return 0;
    if (gpsResult.isStationary) return 0;
    if (gpsResult.accuracy != null && gpsResult.accuracy > 50) return 0;
    if (state.last_gps.accuracy != null && state.last_gps.accuracy > 50) return 0;
    if (dtSec <= 0 || dtSec > 60) return 0;
    const d = GPS.calcDistance(
      state.last_gps.lat,
      state.last_gps.lng,
      gpsResult.lat,
      gpsResult.lng
    );
    const physMaxM = (OFFROAD_ABS_MAX_KMH / 3.6) * Math.max(1, dtSec) + 5;
    if (d > physMaxM) {
      if (typeof dlog === 'function')
        dlog(`[Meter] Phase1.C off-road skip: ${d.toFixed(0)}m > phys max ${physMaxM.toFixed(0)}m`);
      return 0;
    }
    return d;
  }

  // Worker B からの mmResult を受けて state に反映するハンドラ
  // 2026-05-09: MM 優先設計に変更。mmIncrementM>0 を受信したら state.distance_m と
  //   fare_yen を直接更新する。業務継続性は update() 側 GPS fallback で担保。
  // 2026-05-10 (Phase 1.C): Off-Road Mode の入退場制御を追加
  function _onMmWorkerMessage(e) {
    const m = e && e.data;
    if (!m) return;
    // B1 (2026-05-09): roadsLoaded ack を track
    if (m.type === 'roadsLoaded') {
      if (m.ok && m.pref) _workerLoadedPrefs.add(m.pref);
      return;
    }
    if (m.type !== 'mmResult') return;
    if (typeof m.mmIncrementM === 'number' && m.mmIncrementM > 0) {
      if (_offRoadActive) {
        // Phase 1.C: Off-Road でカバー済 → 二重課金防止のため Worker B mmIncrement を無視
        //   Worker B の lastCommittedSnap は古い (= off-road 突入前) 状態なので
        //   resetCommittedSnap で null 化し未来の commit を再起点化
        if (typeof dlog === 'function') {
          dlog(
            `[Meter] Phase1.C Off-Road 終了 (Worker B 復帰・mmIncrement ${m.mmIncrementM.toFixed(0)}m を二重課金回避のため無視)`
          );
        }
        _offRoadActive = false;
        _consecutiveSnapMiss = 0;
        _haverAccumSinceLastCommit = 0;
        // ★設計変更宣言 (2026-05-18・Phase 3・P3 急減原因除去):
        //   旧: Off-Road 復帰時に tier2_pending_m = 0 一括リセット
        //       → 表示式 (= distance_m + tier2_pending_m) が 150m 急減する事象 (司さん実車テスト報告)
        //   新: 一括リセットを削除・通常 commit 時の差分減算 (= L435 周辺) で自然減算する
        //   絶対ルール準拠: distance_m への課金経路は無変更
        _tier2Segments = [];
        if (mmWorker) {
          try {
            mmWorker.postMessage({ type: 'resetCommittedSnap' });
          } catch (_) {
            /* noop - intentionally empty */
          }
        }
        // mmIncrement は加算しない・lastMmUsefulAt も更新しない (= mmHealthy false 維持)
      } else if (Date.now() < _drainMmUntil) {
        // ★設計変更宣言 (2026-05-15・drain window 経路):
        //   Meter.start() 直後の MM_DRAIN_AFTER_START_MS 期間中は worker queue 内の
        //   前 phase 残骸 mmIncrementM を破棄する。state.distance_m / business_distance_m
        //   どちらにも加算しない (driveDist が代行開始直後に 0.17km 等になる事象を防ぐ)。
        //   stats 用 mm_distance_m と lastMmUsefulAt は更新 (健全性判定に必要)。
        if (typeof dlog === 'function') {
          dlog('[Meter] drain mmIncrement ' + m.mmIncrementM.toFixed(1) + 'm (代行開始直後の残骸)');
        }
        lastMmUsefulAt = Date.now();
        state.mm_distance_m += m.mmIncrementM;
        _haverAccumSinceLastCommit = 0;
      } else {
        // 通常: MM 優先で道路距離を課金距離に反映
        // ★設計変更宣言 (2026-05-16・Step4・main 側停車スキップ撤去):
        //   旧: main 側で _isStationary() 判定して business_distance_m += スキップ
        //       → distance_m は加算継続なので両者整合性破れ
        //   新: Worker B 側で msg.isStationary=true なら mmIncrementM=0 を出力する設計に
        //       移行 (map-matcher.js)。これにより停車中は m.mmIncrementM=0 となり、
        //       business_distance_m += 0 / distance_m += 0 の両方が結果として加算 0 で整合。
        //   絶対ルール準拠:
        //     ・main 側 += ロジック不変 (= state.distance_m に触れない・++ 演算自体は維持)
        //     ・Worker B 出力値 (= 0) を信頼して main は無条件加算
        //   保険: Worker B が isStationary 受信に失敗した場合、停車中も mmIncrementM > 0 が
        //       出ることがあり得る。その場合 main で加算されるが、これは「Worker B 判断ミス」
        //       なので main 側で二重否定するより Worker B 側の信頼性向上が筋。
        // ★設計変更宣言 (2026-05-17・症状B 修正・running=false 時 business_distance_m 加算停止):
        //   旧 (2026-05-14): 業務単位累積は state.running を問わず加算 (= 空車中も累積)
        //   新: state.running===false 時は business_distance_m を更新しない (= 代行開始前/idle 中の
        //       GPS jitter 由来加算を遮断)。空車中累積も同時に停止される副作用あり (= 仕様変更)。
        //   absolute ルール準拠:
        //     ・distance_m / fare_yen / 課金ロジックには触れない
        //     ・running=true 時の挙動は完全不変
        //     ・iOS/Android 共通経路 (platform 分岐なし)
        // ★設計変更宣言 (2026-05-19・business_distance_m を Worker B 経路から完全分離):
        //   旧: 同じ m.mmIncrementM を distance_m と business_distance_m に分岐加算
        //       → main 側 _isStationary() gate の非対称で
        //         business_distance_m < distance_m の事象発生 (司さん実車 0.50<1.06 報告)
        //   新: business_distance_m は Worker B 経路では加算しない (= 完全分離)
        //       → update() L887 周辺で GPS speed × dt 独立加算経路で計上
        //   絶対ルール準拠: distance_m += m.mmIncrementM は完全不変 (= 課金根拠不可侵)
        // ★設計変更宣言 (2026-05-24・司さん採用指示・道路 snap 構成に変更):
        //   過去 dac45f03 の真因 = 「business 側のみ・!_isStationary() 追加ガード」 = 100%
        //   今回・「全く同じ構造で・gate だけ business_active」 で・非対称ガード構造的に解消。
        //   Worker B は・既に「停車中 mmIncrementM = 0」 設計 (= 2026-05-16 Step4) のため
        //   main 側で・追加 isStationary 判定不要・Worker B 出力を信頼。
        //   絶対ルール準拠:
        //     ・distance_m += m.mmIncrementM (= L487) は・1 byte 不変 (= 課金根拠不可侵)
        //     ・state.running gate も・1 byte 不変
        //     ・追加するのは・state.business_active gate の・並記のみ・他条件なし
        if (state.running) {
          state.distance_m += m.mmIncrementM;
          state.fare_yen = calcFare(state.distance_m);
          state.distanceSource = 'mm';
        }
        if (state.business_active) {
          state.business_distance_m = (state.business_distance_m || 0) + m.mmIncrementM;
        }
        lastMmUsefulAt = Date.now();
        // 参照値も並行更新 (旧設計互換・stats 表示用)
        state.mm_distance_m += m.mmIncrementM;
        // Phase 1.C: 通常 commit が起きたので haversine 累積 buffer をリセット
        _haverAccumSinceLastCommit = 0;
        // ★設計変更宣言 (2026-05-16・Tier 2 リードインジケータ commit 差分減算):
        //   旧設計 (2026-05-16 朝): commit 時に tier2_pending_m = 0 で全リセット
        //     問題: 走行中 mmIncrementM (Viterbi 確定値) < tier2_pending_m (preview 累積)
        //           のとき表示値 (distance_m + tier2_pending_m) が前回より小さくなる →
        //           「走行距離が急に 0 に戻る・繰り返し下がる」事象 (2026-05-16 実走テスト報告)。
        //   新設計: tier2_pending_m -= mmIncrementM (0 下限 clamp) で差分減算。
        //     ・mmIncrementM <= tier2_pending_m: 表示値 不変 (= 表示停止・課金は増加)
        //     ・mmIncrementM >  tier2_pending_m: 表示値 増加 (= 通常追従)
        //     → 表示値は単調増加 (絶対に下がらない)
        //   distance_m への加算は完全に不変 (= 絶対ルール「distance_m 変えない」準拠)
        //   _tier2Segments は引き続き未使用 (旧経路で使われていたが現在は空のまま維持)
        state.tier2_pending_m = Math.max(0, (state.tier2_pending_m || 0) - (m.mmIncrementM || 0));
        _tier2Segments = [];
      }
    }
    // ★設計変更宣言 (2026-05-24・business preview 別回路・mm commit 時の・★ 業務専用 ★ 確定減算):
    //   ★絶対原則: 課金 tier2_pending_m とは・完全に別ブロック・別行・別変数 ★
    //   ・上記 L519 課金確定減算は・1 byte 不変・touch せず
    //   ・本ブロックは・mmIncrementM > 0 commit 時のみ・state.business_active gate で・business 減算
    //   ・単調増加保証: Math.max(0, ...) で・負値防止 (= 課金と同仕組み・別計算)
    //   ・課金変数 (= state.tier2_pending_m) を・read/write しない (= 完全非共有)
    if (
      m.type === 'mmResult' &&
      typeof m.mmIncrementM === 'number' &&
      m.mmIncrementM > 0 &&
      state.business_active
    ) {
      state.business_tier2_pending_m = Math.max(
        0,
        (state.business_tier2_pending_m || 0) - m.mmIncrementM
      );
    }
    // ★設計変更宣言 (2026-05-16・Tier 2 リードインジケータ・Worker B 経由 preview):
    //   mmIncrementM === 0 でも tentativeIncrementM > 0 を毎 GPS step 受信する設計。
    //   commit を待たず state.tier2_pending_m に加算し、表示式
    //   driveDist = distance_m + tier2_pending_m を即時更新する (= 走行距離ラグ解消)。
    //   停車中 (speedKmh < 2 km/h) は加算スキップ (バグ2 対応)。
    //   state.running=false (空車中) も加算スキップ (= 既存仕様維持・空車中 driveDist 非表示)。
    // ★設計変更宣言 (2026-05-16・Step4・main 側 Tier 2 停車スキップ撤去):
    //   Worker B が msg.isStationary=true 時に tentativeIncrementM=0 を返す設計に移行したため、
    //   main 側の _isStationary 判定は冗長になり撤去。停車中は m.tentativeIncrementM=0 となり
    //   state.tier2_pending_m += 0 = 値不変。
    //   Tier 1 と同じく Worker B 出力を信頼。
    if (
      m.type === 'mmResult' &&
      typeof m.tentativeIncrementM === 'number' &&
      m.tentativeIncrementM > 0 &&
      state.running &&
      !_offRoadActive &&
      Date.now() >= _drainMmUntil
    ) {
      state.tier2_pending_m = (state.tier2_pending_m || 0) + m.tentativeIncrementM;
    }
    // ★設計変更宣言 (2026-05-24・business preview 別回路・tentativeIncrementM 受信時の・★ 業務専用 ★ 累積):
    //   ★絶対原則: 課金 tier2_pending_m とは・完全に別 if ブロック・別行・別変数 ★
    //   ・上記 課金 preview 累積 (= state.tier2_pending_m += tentativeIncrementM) は・1 byte 不変
    //   ・本ブロックは・state.business_active gate で・business preview 累積
    //     (= 課金は・state.running gate / business は・state.business_active gate・空車中も加算)
    //   ・Off-Road active 中は・累積 skip (= Worker B 確定不可・preview 不能)
    //   ・drain 中も・累積 skip (= 代行開始直後 0.17km 等の・残骸防止・課金 preview と同様)
    //   ・課金変数 (= state.tier2_pending_m) を・read/write しない (= 完全非共有)
    if (
      m.type === 'mmResult' &&
      typeof m.tentativeIncrementM === 'number' &&
      m.tentativeIncrementM > 0 &&
      state.business_active &&
      !_offRoadActive &&
      Date.now() >= _drainMmUntil
    ) {
      state.business_tier2_pending_m =
        (state.business_tier2_pending_m || 0) + m.tentativeIncrementM;
    }
    // Phase 1.C (2026-05-10): snap miss 連続検出 → Off-Road Mode 起動
    if (m.snapped) {
      _consecutiveSnapMiss = 0;
    } else if (
      m.skipped ||
      (typeof m.mmIncrementM === 'number' && m.mmIncrementM === 0 && !m.committed)
    ) {
      _consecutiveSnapMiss++;
      // ★設計変更宣言 (2026-05-19・R1・代行開始直後 5 秒 grace period):
      //   代行開始 (Meter.start) 直後の Worker B reset 期間に snap miss が 5 連続発生し
      //   retroactive 一括加算で 200m 飛びが発生する事象を防止。grace 経過後は通常起動。
      if (
        !_offRoadActive &&
        _consecutiveSnapMiss >= OFFROAD_SNAP_MISS_THRESHOLD &&
        Date.now() >= _offRoadGraceUntil
      ) {
        _offRoadActive = true;
        state.offroad_count = (state.offroad_count || 0) + 1;
        // 直前 commit からの haversine 累積を retroactive で加算 (snap-miss 区間の課金漏れ防止)
        if (_haverAccumSinceLastCommit > 0) {
          // ★設計変更宣言 (2026-05-17・症状B 修正・running=false 時 business_distance_m 加算停止):
          //   旧 (2026-05-14): retroactive 加算も state.running を問わず加算
          //   新: state.running===false 時は business_distance_m / distance_m 共に加算停止
          //       (= 旧設計と同じ整合性: running=true のときだけ全加算)
          // ★絶対ルール適用外区間（retroactive）停車中は_trackHaversineBetweenGpsで積算停止済のため停車区間は含まれない。
          // ★設計変更宣言 (2026-05-19・business_distance_m 完全分離・本経路から削除):
          //   business_distance_m は update() L887 周辺で GPS speed × dt 独立加算する設計に変更。
          //   ここでは distance_m (= 課金根拠) のみ加算 (絶対不可侵経路維持)。
          // ★設計変更宣言 (2026-05-24・司さん採用指示・道路 snap 構成に変更・本経路にも並記):
          //   distance_m と・同じ retroactive 補完を・business_distance_m にも適用。
          //   gate のみ・state.business_active で分岐 (= 他条件・距離計算は・全く同じ)。
          if (state.running) {
            state.distance_m += _haverAccumSinceLastCommit;
            state.fare_yen = calcFare(state.distance_m);
            state.distanceSource = 'offroad';
            state.offroad_distance_m = (state.offroad_distance_m || 0) + _haverAccumSinceLastCommit;
          }
          if (state.business_active) {
            state.business_distance_m =
              (state.business_distance_m || 0) + _haverAccumSinceLastCommit;
          }
          if (typeof dlog === 'function') {
            dlog(
              `[Meter] Phase1.C Off-Road 起動 (${_consecutiveSnapMiss} 連続 snap miss)・retroactive add ${_haverAccumSinceLastCommit.toFixed(0)}m`
            );
          }
          _haverAccumSinceLastCommit = 0;
        } else {
          if (typeof dlog === 'function')
            dlog(`[Meter] Phase1.C Off-Road 起動 (${_consecutiveSnapMiss} 連続 snap miss)`);
        }
        // Worker B に resetCommittedSnap を送り、off-road 中の commit を抑制
        if (mmWorker) {
          try {
            mmWorker.postMessage({ type: 'resetCommittedSnap' });
          } catch (_) {
            /* noop - intentionally empty */
          }
        }
        // ★設計変更宣言 (2026-05-18・Phase 3・P3 急減原因除去):
        //   旧: Off-Road 起動時に tier2_pending_m = 0 一括リセット
        //       → 表示式の急減原因
        //   新: 一括リセットを削除・通常 commit 時の差分減算 (= L435 周辺) で自然減算する
        //   絶対ルール準拠: distance_m への課金経路は無変更
        _tier2Segments = [];
      }
    }
    // D4 (2026-05-09): 直近 snap の typeCode を記録 (gap fill 速度クランプ用)
    // T5 (2026-05-09): 同じ typeCode を gps-worker.js に伝達して Kalman Q を動的化
    //   - motorway/trunk: Q=1.5・residential/track: Q=4.0 等
    //   - typeCode 変化時のみ送信 (postMessage 過剰防止)
    if (m.snap && m.snap.typeCode != null) {
      const newTypeCode = m.snap.typeCode;
      if (newTypeCode !== _lastSnapTypeCode) {
        _lastSnapTypeCode = newTypeCode;
        if (typeof GPS !== 'undefined' && typeof GPS.setRoadType === 'function') {
          try {
            GPS.setRoadType(newTypeCode);
          } catch (_) {
            /* noop - intentionally empty */
          }
        }
      }
    }
    // T8 (2026-05-09): commit が起きた road を Firebase 側 cross-user pheromone に集約
    //   重複防止は FB.markVisited (Set) 側でやる
    if (m.committed && m.snap && m.snap.prefecture && m.snap.roadIndex != null) {
      if (typeof FB !== 'undefined' && typeof FB.markVisited === 'function') {
        try {
          FB.markVisited(m.snap.prefecture, m.snap.roadIndex);
        } catch (_) {
          /* noop - intentionally empty */
        }
      }
    }
    if (m.snapped) state.mm_snap_count++;
    if (m.skipped) {
      state.mm_skip_count++;
      if (typeof dlog === 'function' && m._reason) {
        dlog('[MM] skip: ' + m._reason);
      }
    }
    // MM-2: 遅延・候補数の評価指標を蓄積
    if (typeof m.latencyMs === 'number') _recordMmLatency(m.latencyMs);
    if (typeof m.candidatesCount === 'number') {
      _mmCandCountSum += m.candidatesCount;
      _mmCandCountSamples++;
    }
    // MM-7: MCM 窓サイズの最新値
    if (typeof m.mcmN === 'number') _lastMcmN = m.mcmN;
  }

  function start() {
    const now = Date.now();
    // 起動時warm up：5秒以上前のlastWarmupGpsは使わない（過剰課金リスク回避・2026/05/01）
    // GPS止まった状態で移動→起動時に古い座標と現在地で距離爆発するのを防ぐ
    const WARMUP_MAX_AGE_MS = 5000;
    const warmupValid =
      lastWarmupGps && lastWarmupGps.timestamp && now - lastWarmupGps.timestamp < WARMUP_MAX_AGE_MS;
    // ★設計変更宣言 (2026-05-14): business_distance_m は trip 跨ぎで保持。
    //   Meter.start() は per-trip (代行開始) 呼出のため、業務単位累積をリセットしてはならない。
    //   リセットは Meter.businessEnd() (業務終了) でのみ実行。初期 state.business_distance_m=0 は
    //   初回 Meter モジュール load 時に効く。
    const prevBusinessDist = (state && state.business_distance_m) || 0;
    // ★ Phase 2: business_active は per-trip reset で引き継ぐ (= 業務継続中)
    const prevBusinessActive = !!(state && state.business_active);
    // ★設計変更宣言 (2026-05-24・business preview 別回路・per-trip 引き継ぎ):
    //   business_distance_m と同じ・per-trip reset で引き継ぎ (= 業務単位累積)。
    const prevBusinessTier2Pending = (state && state.business_tier2_pending_m) || 0;
    // ★設計変更宣言 (2026-05-19・混同#1#2 修正・gps_predictive / display を trip 単位に変更):
    //   旧 (Phase 3): start で prevGpsPredictive / prevDisplay 引き継ぎ = 業務単位扱い
    //                 → 代行 1 trip 開始時 driveDist が前 trip 累積値で再開・「全然変わらん」事象
    //   新: trip 単位 0 化 = 代行 1 件の走行距離表示 (= 司さん前提・後付メーター 1 件距離計に相当)
    //   業務単位累積は business_distance_m が別管理 (= 引き継ぎは prevBusinessDist のみ維持)
    state = {
      running: true,
      distance_m: 0,
      distanceSource: 'gps',
      fare_yen: fareConfig.base_fare,
      elapsed_sec: 0,
      // ★ A1: elapsed 累積初期化 + resume 基準時刻 = now
      elapsed_accumulated_sec: 0,
      last_resume_time: now,
      business_active: prevBusinessActive,
      // ★ 混同#1#2 修正: gps_predictive / display は trip 単位 0 化
      gps_predictive_distance_m: 0,
      display_distance_m: 0,
      last_display_update_time: null,
      start_time: now,
      // 起動時warm upでGPS取得済みなら初期値として使う（即時計測開始のため）
      // 過去の動きは加算しないよう last_timestamp は now を使用
      last_gps: warmupValid
        ? {
            lat: lastWarmupGps.lat,
            lng: lastWarmupGps.lng,
            altitude: lastWarmupGps.altitude,
            compassHeading: lastWarmupGps.compassHeading,
          }
        : null,
      last_timestamp: warmupValid ? now : null,
      last_speed_kmh: warmupValid ? lastWarmupGps.speedKmh : 0,
      gap_fill_count: 0,
      gap_fill_total_m: 0,
      // Map Matching 関連リセット
      mm_distance_m: 0,
      mm_snap_count: 0,
      mm_total_count: 0,
      mm_skip_count: 0,
      // Phase 1.C Off-Road Mode リセット
      offroad_distance_m: 0,
      offroad_count: 0,
      // 待機料金 リセット
      wait_sec: 0,
      // 業務単位累積 (per-trip リセットしない・businessEnd でのみ 0 化)
      business_distance_m: prevBusinessDist,
      // Tier 2 リードインジケータ (代行開始時は常に 0 から)
      tier2_pending_m: 0,
      // ★ business preview 別回路 (= per-trip 引き継ぎ・business_distance_m と同じ仕様)
      business_tier2_pending_m: prevBusinessTier2Pending,
      // ★設計変更宣言 (2026-05-24・表示層 予測補間): trip 単位 0 化 (= display と同期)
      _prev_target_distance_m: 0,
      _prev_target_time: null,
      _target_velocity_mps: 0,
      // ★ business display: per-trip 引き継ぎ (= business_distance_m と同期)
      business_display_distance_m: prevBusinessTier2Pending + prevBusinessDist,
      last_business_display_update_time: null,
      _prev_business_target_distance_m: prevBusinessTier2Pending + prevBusinessDist,
      _prev_business_target_time: null,
      _business_target_velocity_mps: 0,
    };
    // Phase 1.C 状態リセット
    _offRoadActive = false;
    _consecutiveSnapMiss = 0;
    _haverAccumSinceLastCommit = 0;
    // Tier 2 リードインジケータ segments クリア (2026-05-15)
    _tier2Segments = [];
    // fareConfig v2: 業務開始時に default ON の surcharge を初期 active に
    _activeSurchargeIds = new Set();
    if (Array.isArray(fareConfig.surcharges)) {
      for (const s of fareConfig.surcharges) {
        if (s && s.active_default && s.id) _activeSurchargeIds.add(s.id);
      }
    }
    // vehicle 初期選択 (default フラグ・なければ最初の vehicle)
    if (
      fareConfig.vehiclesEnabled &&
      Array.isArray(fareConfig.vehicles) &&
      fareConfig.vehicles.length > 0
    ) {
      const def = fareConfig.vehicles.find((v) => v && v.default);
      _activeVehicleId = (def && def.id) || fareConfig.vehicles[0].id || null;
    } else {
      _activeVehicleId = null;
    }
    _fareConfigFrozen = true; // F6: 業務開始時に凍結
    // B2 (2026-05-09): 業務開始時 MM warmup grace
    //   lastMmUsefulAt=0 だと mmHealthy=false で fallback 経路に入る
    //   Date.now() に設定しておけば MM_SILENT_THRESHOLD_MS (5s) 分の待ち時間が確保され
    //   その間に Worker B から最初の useful mmResult が届く想定
    //   届かなければ自然に inline / gap fallback に移行
    lastMmUsefulAt = Date.now();
    // ★設計変更宣言 (2026-05-15・代行開始直後の Worker B バッファ残骸 drain):
    //   worker への 'reset' postMessage は ASYNC・queue 内に残った直前 mmResult が
    //   本関数完了直後に main thread に届く race を回避するため drain window を設定。
    //   この時刻未満に届く mmIncrementM は state.distance_m / business_distance_m
    //   いずれにも加算しない (空車 phase で business 側は既加算・代行中 distance に
    //   持ち越さない)。
    _drainMmUntil = Date.now() + MM_DRAIN_AFTER_START_MS;
    // ★ R1: 代行開始直後 5 秒間は Off-Road 起動 skip (= retroactive 一括加算で 200m 飛び防止)
    _offRoadGraceUntil = Date.now() + OFFROAD_GRACE_AFTER_START_MS;
    // MM-1: Worker 側 prevSnap も初期化（業務開始時の連続性リセット）
    if (mmWorker) {
      try {
        mmWorker.postMessage({ type: 'reset' });
      } catch (e) {
        /* noop - intentionally empty */
      }
    }
    // ★ A1: 旧 setInterval は廃止 (= elapsed_sec は getState で都度計算)
  }

  function stop() {
    state.running = false;
    // ★ A1: elapsed 確定加算 (= last_resume_time からの経過を累積に追加)
    if (state.last_resume_time !== null) {
      state.elapsed_accumulated_sec += Date.now() - state.last_resume_time;
      state.last_resume_time = null;
    }
    // 注: Worker への reset 送信はしない (F5 維持)
    // 業務終了時の flush は businessEnd() で明示的に呼ぶ
  }

  // B7 (2026-05-09): 業務終了専用・Worker B の Viterbi 窓を flush して
  //   未確定の N 秒分を mmResult で post 返却 → state.distance_m に最終加算
  //   この後の getReport() で正確な合計距離を返す
  function businessEnd() {
    // ★設計変更宣言 (2026-05-19・混同#3#4#8 修正・businessEnd 責務整理):
    //   旧: businessEnd で elapsed_accumulated_sec=0 / gps_predictive=0 / display=0 /
    //       business_distance_m=0 / tier2_pending_m=0 を実施 → 直後の getReport で
    //       Meter.business_distance_m=0 が読まれ「総走行距離 0km」表示。
    //   新: businessEnd は「業務 gate OFF + Worker B Viterbi flush + 内部 flag リセット」のみが責務。
    //       業務単位 (business_distance_m) の 0 化は Business.start で実施 (= setBusinessDistance(0))。
    //       trip 単位 (elapsed/gps_predictive/display/tier2_pending) の 0 化は次代行 Meter.start で実施。
    state.running = false;
    // ★ A1: elapsed 確定加算 (= 確定だけ・0 化はしない・次代行 Meter.start で 0 化)
    if (state.last_resume_time !== null) {
      state.elapsed_accumulated_sec += Date.now() - state.last_resume_time;
      state.last_resume_time = null;
    }
    state.business_active = false; // ★ Phase 2: 業務終了で business_active 自動 off
    _fareConfigFrozen = false; // F6: 業務終了で解凍
    if (mmWorker) {
      try {
        mmWorker.postMessage({ type: 'reset' });
      } catch (e) {
        /* noop - intentionally empty */
      }
    }
    _tier2Segments = [];
    _offRoadActive = false;
    _consecutiveSnapMiss = 0;
    _haverAccumSinceLastCommit = 0;
    // T8 (2026-05-09): 業務終了で当 session の cross-user pheromone を Firebase に push
    if (typeof FB !== 'undefined' && typeof FB.pushSessionAggregates === 'function') {
      try {
        FB.pushSessionAggregates();
      } catch (_) {
        /* noop - intentionally empty */
      }
    }
  }

  function reset() {
    stop();
    // ★設計変更宣言 (2026-05-14): business_distance_m は per-trip reset でリセットしない。
    //   reset() は onIdle (空車) 経由の trip 単位リセット・業務終了ではない。
    //   業務単位累積を引き継ぐため prevBusinessDist を保存して再代入。
    const prevBusinessDist = (state && state.business_distance_m) || 0;
    // ★ Phase 2: business_active は per-trip reset で引き継ぐ (= 業務継続中)
    const prevBusinessActive = !!(state && state.business_active);
    // ★設計変更宣言 (2026-05-24・business preview 別回路・per-trip 引き継ぎ):
    //   business_distance_m と同じ・per-trip reset で引き継ぎ (= 業務単位累積)。
    const prevBusinessTier2Pending = (state && state.business_tier2_pending_m) || 0;
    // ★設計変更宣言 (2026-05-19・混同#1#2 修正): gps_predictive / display は trip 単位 0 化
    //   reset() は trip 終了経路 (= 確定送信ボタン) のため次 trip 用に 0 化する。
    state = {
      running: false,
      distance_m: 0,
      distanceSource: 'gps',
      fare_yen: 0,
      elapsed_sec: 0,
      // ★ A1: trip reset で elapsed 累積は 0 化・last_resume_time も null
      elapsed_accumulated_sec: 0,
      last_resume_time: null,
      business_active: prevBusinessActive,
      // ★ 混同#1#2 修正: gps_predictive / display は trip 単位 0 化
      gps_predictive_distance_m: 0,
      display_distance_m: 0,
      last_display_update_time: null,
      start_time: null,
      last_gps: null,
      last_timestamp: null,
      last_speed_kmh: 0,
      gap_fill_count: 0,
      gap_fill_total_m: 0,
      // Map Matching 関連リセット
      mm_distance_m: 0,
      mm_snap_count: 0,
      mm_total_count: 0,
      mm_skip_count: 0,
      // Phase 1.C Off-Road Mode リセット
      offroad_distance_m: 0,
      offroad_count: 0,
      // 待機料金 リセット
      wait_sec: 0,
      // 業務単位累積 (per-trip リセットしない)
      business_distance_m: prevBusinessDist,
      // Tier 2 リードインジケータ (reset 時も 0 から)
      tier2_pending_m: 0,
      // ★ business preview 別回路 (= per-trip 引き継ぎ・business_distance_m と同じ仕様)
      business_tier2_pending_m: prevBusinessTier2Pending,
      // ★設計変更宣言 (2026-05-24・表示層 予測補間): trip 単位 0 化
      _prev_target_distance_m: 0,
      _prev_target_time: null,
      _target_velocity_mps: 0,
      // ★ business display: per-trip 引き継ぎ
      business_display_distance_m: prevBusinessTier2Pending + prevBusinessDist,
      last_business_display_update_time: null,
      _prev_business_target_distance_m: prevBusinessTier2Pending + prevBusinessDist,
      _prev_business_target_time: null,
      _business_target_velocity_mps: 0,
    };
    // Phase 1.C 状態リセット
    _offRoadActive = false;
    _consecutiveSnapMiss = 0;
    _haverAccumSinceLastCommit = 0;
    // Tier 2 リードインジケータ segments クリア (2026-05-15)
    _tier2Segments = [];
    lastMmUsefulAt = 0;
    // F5 (2026-05-09): trip reset では Worker 'softReset' を送る
    //   → lastCommittedSnap のみクリア・Viterbi 窓は維持
    //   業務終了時の完全 flush + clear は businessEnd() で別途呼ぶ
    if (mmWorker) {
      try {
        mmWorker.postMessage({ type: 'softReset' });
      } catch (e) {
        /* noop - intentionally empty */
      }
    }
    // 起動時warm up GPSもクリア（過剰課金リスク回避・2026/05/01）
    // GPS止まった状態で移動→次回代行開始時に古い座標と現在地で距離爆発するのを防ぐ
    lastWarmupGps = null;
  }

  // GPS消失時の補完
  // returns: 補完すべき距離(m) | null（補完しない）
  // 2026-05-09 設計変更: ROAD_FACTOR (×1.3) 廃止。MM 優先化で道路距離は MM が担当するため、
  //   GPS 消失時の fallback では補正係数を掛けない (=速度×時間そのまま)。
  // ★設計変更宣言 (2026-05-17・RegionLoader 撤去): トンネル/橋 polyline 距離参照を撤廃。
  //   calcBearingMeter / angleDiffMeter / TUNNEL_COMPASS_THRESHOLD_DEG はコンパス方向と
  //   構造物方向の照合でのみ使用していたため削除。
  // ★設計変更宣言 (2026-05-17・RegionLoader 撤去):
  //   旧: calculateGapFill は RegionLoader.findTunnelByPosition / findNearestBridge 等で
  //       tunnel/bridge polyline 距離を加味して naiveDistance との max を採用していた。
  //   新: RegionLoader が永続的に undefined のためこれらの経路は dead code 化。
  //       速度×時間 (naiveDistance) のみで補完する設計に整理。
  //       prevLat/prevLng/currLat/currLng/compassHeading の引数は不要になったため signature 縮小。
  //   絶対ルール準拠: lastSpeedKmh<=0 で null 返却 (= GPS 直線距離流入遮断) は維持。
  function calculateGapFill(gapSec, lastSpeedKmh) {
    if (gapSec > GAP_MAX_SEC) return null;
    if (lastSpeedKmh <= 0) return null;

    // 走行中の補完（速度×時間）
    // D4 (2026-05-09): 道路種別ベースの最大速度を _maxSpeedFor で参照値として記録
    // F7 (2026-05-09・設計変更): gap fill の clamp は道路種別cap ではなく
    //   160km/h 絶対上限に変更。
    const maxKmh = _maxSpeedFor(_lastSnapTypeCode);
    const ABS_MAX_KMH = 160;
    const clampedKmh = Math.min(lastSpeedKmh, ABS_MAX_KMH);
    const speedMs = clampedKmh / 3.6;
    const naiveDistance = speedMs * gapSec;
    if (typeof dlog === 'function' && lastSpeedKmh > maxKmh) {
      dlog(
        `[Meter] gap fill: speed ${lastSpeedKmh.toFixed(1)}km/h > road-cap ${maxKmh}km/h ` +
          `(absolute cap ${ABS_MAX_KMH} 適用)`
      );
    }
    if (typeof dlog === 'function') {
      dlog(
        `[Meter] GPS消失補完: ${gapSec.toFixed(1)}秒 → ${Math.round(naiveDistance)}m (速度×時間)`
      );
    }
    return naiveDistance;
  }

  function _recordGapFill(filledM) {
    state.gap_fill_count++;
    state.gap_fill_total_m += filledM;
  }

  // ★設計変更宣言 (2026-05-17・RegionLoader 撤去・_inlineSnapAndIncrement 関数削除):
  //   旧: Worker B 不在 / silent 時の代替経路として RegionLoader.snapToNearestRoad +
  //       calcRoadDistance で道路距離を計算する設計だったが、RegionLoader は main thread に
  //       永続的に undefined のため毎 step null 返却で実機では動作しない dead code 状態。
  //   新: 関数自体を削除。Worker B 不在 / silent 時は Tier 4 (gap fill) / Tier 5 (Off-Road) /
  //       距離据え置き のいずれかで対応する。
  //   絶対ルール準拠: GPS 直線距離による誤課金経路は維持して発生しない。

  function update(gpsResult) {
    // ★設計変更宣言 (2026-05-14・空車中も business_distance_m を累積):
    //   旧: state.running=false なら早期 return (距離計算自体スキップ)
    //   新: state.running=false でも 5-tier 道路距離計算は行い、業務単位累積
    //       (state.business_distance_m) には加算する。state.distance_m / state.fare_yen
    //       (= trip 単位 / fare 計算入力) は state.running=true のときのみ更新。
    //   絶対ルール準拠: 距離は既存 4-tier 道路距離 (MM commit / MM preview / gap / off-road) で
    //   計算・GPS 直線は使わない。総走行距離 (= 業務開始から終了までの全走行) を仕様通り測る。
    if (gpsResult.isStationary) {
      // B5 (2026-05-09): 停車中でも Worker B にハートビートを送信
      //   Viterbi 窓内の確定前候補が時間進行で commit される機会を作る
      //   業務終了時の flush で観測時刻が古いまま commit されるのを防ぐ
      _updateMapMatching(gpsResult);
      return;
    }

    // 2026-05-09 (絶対ルール準拠): 課金距離は MM (道路距離) のみ
    //   distance_m への加算は _onMmWorkerMessage に任せる
    // ★設計変更宣言 (2026-05-17・RegionLoader 撤去): inline fallback 経路を廃止。
    //   Worker B 不在 / silent + 通常 dt 時は distance_m 据え置き (GPS 直線課金は絶対不可)。
    //   Tier 4 (gap fill・dtSec>=5s) / Tier 5 (Off-Road・snap miss 連続) でのみ加算。

    if (state.last_gps && state.last_timestamp) {
      const dtSec = (gpsResult.timestamp - state.last_timestamp) / 1000;

      // ★設計変更宣言 (2026-05-19・haversine 連続点累積に移行・業界標準準拠):
      //   旧 (Phase 3 〜 完全分離後): speedKmh × dt で計算
      //     問題: iOS Safari coords.speed が走行中も null/0 を返す癖でノイズに脆弱
      //           モール駐車場 / 信号停止後 / 徐行で加算停止する司さん実車事象
      //   新: 連続点 haversine 累積 (= Strava / Garmin / 米国タクシー特許と同手法)
      //       GPS 速度値を使わず・直前 GPS 位置 → 今 GPS 位置の距離を直接計算
      //       速度ノイズ免疫・GPS が動けば加算・止まれば加算停止 (= 後付メーター対等)
      //   絶対ルール準拠:
      //     ・「連続点 polyline 累積 = 許可」 (meter.js L106-108 既存明示) と完全整合
      //     ・「A → B 一発 haversine 課金 = 禁止」とは別物 (= 連続点 1 つずつ累積)
      //     ・distance_m 加算 5 経路は state.running gate で完全不変 (= 課金根拠不可侵)
      //     ・iOS / Android 両 OS 共通 (= GPS.calcDistance は既存 Off-Road でも利用)
      //   ガード (= 既存 _trackHaversineBetweenGps と同基準):
      //     ・isStationary=true (= gps.js 保守的停止判定) → 加算しない
      //     ・accuracy > 50m (= GPS 精度低下) → 加算しない
      //     ・物理上限 160 km/h 超過 → 加算しない (= GPS jump 防御)
      //     ・dtSec >= 10 秒 (= 長時間空白) → 加算しない (= gap fill 経路に委任)
      // ★設計変更宣言 (2026-05-24・候補 A・連続点 ZUPT buffer 更新):
      //   business_distance_m 専用 ZUPT 判定の・buffer 更新を・常時実行 (= ガード前)。
      //   buffer 更新は・副作用なし (= 配列 push/shift のみ・state 変更なし)。
      //   isStationary / accuracy / dtSec 条件に関わらず・連続点を蓄積し・判定時点で参照。
      //   ★2026-05-24・道路 snap 構成変更後・Off-Road incremental の・business 側 屋内対策で・継続使用★
      _updateZuptHistory(gpsResult);

      // ★設計変更宣言 (2026-05-24・司さん採用指示・道路 snap 構成変更):
      //   旧 (= 候補A v2): GPS haversine 直接 += business_distance_m (= L991 周辺)
      //   新: business_distance_m は・道路 snap 5 経路 (L487 / L549 retro / L967 gap / L988 offroad)
      //       で・state.business_active gate 並記で・加算する設計に移行。
      //   本ブロックでは・gps_predictive_distance_m += のみ・残す (= 表示用・trip 単位・既存仕様)。
      //   business_distance_m += は・本経路から・削除 (= 5 経路に移譲)。
      if (
        state.business_active &&
        !gpsResult.isStationary &&
        gpsResult.accuracy <= 50 &&
        dtSec > 0 &&
        dtSec < 10
      ) {
        const _haver = GPS.calcDistance(
          state.last_gps.lat,
          state.last_gps.lng,
          gpsResult.lat,
          gpsResult.lng
        );
        const _maxDist = (160 / 3.6) * dtSec; // 物理上限 160 km/h
        if (_haver > 0 && _haver <= _maxDist) {
          state.gps_predictive_distance_m += _haver;
          // business_distance_m += は・道路 snap 5 経路で並記 (= 上記設計宣言)
        }
      }

      // Phase 1.C (2026-05-10): 通常時は haversine 累積を裏で track
      //   off-road 起動時に retroactive 加算するための buffer
      _trackHaversineBetweenGps(gpsResult, dtSec);

      // GPS消失検出：5秒以上の空白 (トンネル等で MM/GPS 共に不可)
      // ★設計変更宣言 (2026-05-20・司さん指摘・室内停車中 gap fill 誤加算修正):
      //   旧: dtSec >= GAP_THRESHOLD_SEC のみ・停車判定 gate なし
      //   → 停車中 (= 室内/赤信号) でも state.last_speed_kmh が前フレーム値 (走行中速度)
      //     を保持 → gap fill が「停車していない前提」で速度×時間で誤加算 (最大数十m)
      //   新: !gpsResult.isStationary を条件に追加。停車判定中は gap fill skip。
      //   絶対ルール準拠: 既存 += 経路自体は変更なし・gate 強化のみ。
      if (dtSec >= GAP_THRESHOLD_SEC && !gpsResult.isStationary) {
        // gap fill: 速度×時間 (タイヤ回転由来の概算・GPS 直線弦ではない)
        const filled = calculateGapFill(dtSec, state.last_speed_kmh);
        if (filled !== null) {
          // ★設計変更宣言 (2026-05-17・症状B 修正・running=false 時 business_distance_m 加算停止):
          //   旧 (2026-05-14): running 問わず加算 / (2026-05-16) 停車判定追加
          //   新: state.running===false 時は business_distance_m を加算しない (= 代行開始前
          //       の GPS jitter 由来加算を遮断)。停車判定は維持。
          // ★設計変更宣言 (2026-05-19・business_distance_m 完全分離・本経路から削除):
          //   business_distance_m は update() L887 周辺で GPS speed × dt 独立加算する設計に変更。
          //   ここでは distance_m (= 課金根拠) のみ加算 (絶対不可侵経路維持)。
          // ★設計変更宣言 (2026-05-24・司さん採用指示・道路 snap 構成に変更・本経路にも並記):
          //   distance_m と・同じ gap fill 補完を・business_distance_m にも適用。
          //   gate のみ・state.business_active で分岐 (= 他条件・距離計算は・全く同じ)。
          if (state.running) {
            state.distance_m += filled;
            state.fare_yen = calcFare(state.distance_m);
            state.distanceSource = 'gap';
            _recordGapFill(filled);
          }
          if (state.business_active) {
            state.business_distance_m = (state.business_distance_m || 0) + filled;
          }
          _haverAccumSinceLastCommit = 0; // gap fill で確定したのでバッファ reset
        }
      } else if (_offRoadActive) {
        // Phase 1.C Off-Road Mode: GPS polyline 累積で課金続行
        const inc = _calculateOffRoadIncrement(gpsResult, dtSec);
        if (inc > 0) {
          // ★設計変更宣言 (2026-05-17・症状B 修正・running=false 時 business_distance_m 加算停止):
          //   旧 (2026-05-16): 停車判定のみガード
          //   新: state.running===false 時は business_distance_m を加算しない。停車判定維持。
          // ★設計変更宣言 (2026-05-19・business_distance_m 完全分離・本経路から削除):
          //   business_distance_m は update() L887 周辺で GPS speed × dt 独立加算する設計に変更。
          //   ここでは distance_m (= 課金根拠) のみ加算 (絶対不可侵経路維持)。
          if (state.running) {
            state.distance_m += inc;
            state.fare_yen = calcFare(state.distance_m);
            state.distanceSource = 'offroad';
            state.offroad_distance_m = (state.offroad_distance_m || 0) + inc;
          }
          // ★設計変更宣言 (2026-05-24・司さん採用指示・道路 snap 構成・本経路に・★屋内対策 ZUPT★):
          //   distance_m と同じ Off-Road incremental を・business_distance_m にも適用。
          //   ただし・本経路は・「snap miss 連続 = Off-Road active」 状態で・GPS haversine 直接加算するため
          //   屋内駐車 (= business_active=true / state.running=false / isStationary=false drift 状態) で
          //   drift haversine を・business_distance_m に・積む潜在問題あり。
          //   ★ 業務側のみ・追加 ZUPT ガード (= 直近 30 秒 net 変位 < 10m AND 現 haver < 5m → skip) ★
          //   ★ distance_m 側は・1 byte 不変 (= 課金根拠不可侵・running gate で・空車中既 skip) ★
          //   屋外走行 Off-Road (= 道路外通過 5+ 秒) は・連続点 net 変位大・ZUPT 不発・通常加算。
          if (state.business_active && !_isBusinessZuptMicroMotion(gpsResult, inc)) {
            state.business_distance_m = (state.business_distance_m || 0) + inc;
          }
        }
      }
      // ★設計変更宣言 (2026-05-17・RegionLoader 撤去): mmHealthy=false 時の inline 経路を削除。
      //   通常 dt + Worker B sliently silent な場合は distance_m 据え置き (GPS 直線課金禁止)。
      // ★設計変更宣言 (2026-05-16・Tier 2 リードインジケータを Worker B 経由に完全移行):
      //   tier2_pending_m への加算は _onMmWorkerMessage で Worker B からの tentativeIncrementM
      //   (毎 GPS step・道路距離) を受けて行う。mmHealthy 時の課金も _onMmWorkerMessage の通常
      //   commit 経由で更新される。
    }
    // ★設計変更宣言 (2026-05-17・RegionLoader 撤去・初回 GPS step の inline 呼出削除):
    //   旧: 初回 GPS step では _inlineSnapAndIncrement(gpsResult) を呼んで prevSnap を初期化
    //   新: _inlineSnapAndIncrement 自体を削除したため呼出箇所も削除 (= no-op で素通し)
    // 待機時間累積 (fareConfig v2): 速度 < 3km/h かつ業務中で wait_sec を増加
    //   wait.enabled が true でなくても累積する (= 集計用・課金は wait.enabled 時のみ)
    //   無料時間 freeMins は calcFare 側で控除する
    //   state.running=false (空車) のときは wait_sec を加算しない (fare 入力なので)
    if (state.running && state.last_timestamp) {
      const dtSec2 = (gpsResult.timestamp - state.last_timestamp) / 1000;
      if (dtSec2 > 0 && dtSec2 < 60 && (gpsResult.speedKmh || 0) < 3) {
        state.wait_sec += dtSec2;
      }
    }

    // ★設計変更宣言 (2026-05-20・司さん指摘・室内誤加算 bug 修正):
    //   旧: state.last_gps に accuracy フィールド欠落
    //   → _trackHaversineBetweenGps (L293) / _calculateOffRoadIncrement (L341) の
    //     accuracy ガード (`state.last_gps.accuracy != null && > 50`) が常に false 評価
    //   → GPS 精度低下時にも haversine 累積が止まらない
    //   新: accuracy を保存 (= 既存 accuracy guard が機能・課金経路保護)
    state.last_gps = {
      lat: gpsResult.lat,
      lng: gpsResult.lng,
      accuracy: gpsResult.accuracy,
      altitude: gpsResult.altitude,
      compassHeading: gpsResult.compassHeading || null,
    };
    state.last_timestamp = gpsResult.timestamp;
    state.last_speed_kmh = gpsResult.speedKmh || 0;
    // ★設計変更宣言 (2026-05-16・isStationary フラグを Meter 側に伝搬):
    //   _isStationary() が gps.js の保守的判定 (5秒継続低速 + 3m以内) を参照するため
    //   gpsResult.isStationary を state に保存する。両 OS 共通 (gps.js が両 OS で判定)。
    state.last_isStationary = gpsResult.isStationary === true;

    // Phase 2.A (2026-05-10): 訓練データ収集
    //   GPS 良好 (accuracy<=20m) + 速度>5km/h + !isStationary で 1 サンプル保存
    //   将来 AI 推論 (Phase 4・CarSpeedNet ONNX) のための蓄積基盤
    //   位置情報は一切送られない (TrainingCollector 内で禁止)
    //   default ON・Phase 3 設定画面で OFF 切替可能
    if (
      typeof TrainingCollector !== 'undefined' &&
      typeof TrainingCollector.collectIfEligible === 'function'
    ) {
      try {
        TrainingCollector.collectIfEligible(gpsResult);
      } catch (_) {
        /* noop - intentionally empty */
      }
    }

    // ━━━━━ Map Matching: Worker B にも GPS を転送 ━━━━━
    _updateMapMatching(gpsResult);
  }

  // Map Matching 処理（update から呼ばれる・分離して既存ロジック保護）
  // MM-1 (2026-05-08): Worker B 経路を優先
  // ★設計変更宣言 (2026-05-17・RegionLoader 撤去): worker 不在時の inline fallback 削除済。
  //   Worker B が未起動 / _workerLoadedPrefs 0 件のときは postMessage しない (= mmResult が来ない)。
  //   GPS 直線課金は絶対不可なため fallback 経路は持たない。
  function _updateMapMatching(gpsResult) {
    if (!MM_ENABLED) return;
    if (gpsResult.isStationary) return;
    if (typeof gpsResult.lat !== 'number' || typeof gpsResult.lng !== 'number') return;

    // ── MM-1: Worker B 経路（優先） ────────────────────
    // mm_total_count は post タイミングで main 側がカウント（Worker と二重管理回避）
    // mm_snap_count / mm_skip_count / mm_distance_m は _onMmWorkerMessage で加算
    // B1 (2026-05-09): roadsLoaded ack を 1 件以上受領済の Worker にのみ post
    if (mmWorker && _workerLoadedPrefs.size > 0) {
      state.mm_total_count++;
      try {
        mmWorker.postMessage({
          type: 'gps',
          lat: gpsResult.lat,
          lng: gpsResult.lng,
          timestamp: gpsResult.timestamp,
          // MM-2: emission scoring 用に accuracy / speedKmh / heading を転送
          accuracy: gpsResult.accuracy,
          speedKmh: gpsResult.speedKmh,
          headingDeg: gpsResult.compassHeading != null ? gpsResult.compassHeading : null,
          // 2026-05-09 (P4/P5): cellularLayerHint / accelLayerHint 廃止・layer 連続性 boost で代替
          // GPS altitude は DEM 比較用に維持
          altitude: typeof gpsResult.altitude === 'number' ? gpsResult.altitude : null,
          // ★設計変更宣言 (2026-05-16・Step4・停車情報を Worker B に伝達):
          //   _isStationary() の判定結果を Worker B に毎 GPS step 渡し、Worker B 内で
          //   出力 (mmIncrementM / tentativeIncrementM) を 0 化させる。
          //   これにより main の state.distance_m / business_distance_m が両方とも
          //   += 0 になり整合性確保 (= 「停車中も課金される」事象の根本解消)。
          isStationary: _isStationary(),
        });
      } catch (e) {
        // post 失敗はメーター本体に影響を与えない (絶対ルール: GPS 直線課金禁止のため fallback なし)
        if (typeof dlog === 'function') dlog('[MM] worker post error: ' + e.message);
      }
      return;
    }
    // ★設計変更宣言 (2026-05-17・RegionLoader 撤去・inline fallback 削除):
    //   旧: Worker B 不在 or _workerLoadedPrefs 0 件のとき RegionLoader.snapToNearestRoad で
    //       inline road-snap する fallback があったが、RegionLoader 永続 undefined のため dead。
    //   新: fallback 完全削除。Worker B 未起動時は何もしない (= mmResult が来ないので Tier 4/5 で
    //       カバー or 距離据え置き)。GPS 直線課金は絶対不可。
  }

  // ★設計変更宣言 (2026-05-10): calcFare を v2 多段階パイプライン化
  //   後方互換: tiers/surcharges/vehicles/wait が空 or 不在なら旧来動作
  //   計算順序:
  //     Step 1 距離料金 (tiers 優先・旧来 base+add は fallback)
  //     Step 2 vehicle 倍率 + addon (vehiclesEnabled 時)
  //     Step 3 手動 surcharges 乗算 (_activeSurchargeIds の rate 積)
  //     Step 4 autoSurcharges 乗算 (現在時刻ベースの自動判定)
  //     Step 5 wait 料金加算 (wait.enabled 時)
  //     Step 6 minFare/maxFare clamp
  //     Step 7 rounding 単位丸め
  function calcFare(distanceM) {
    let fare = 0;

    // Step 1: 距離料金
    if (Array.isArray(fareConfig.tiers) && fareConfig.tiers.length > 0) {
      // 新形式: tiers 配列 走査
      if (distanceM <= fareConfig.base_distance_m) {
        fare = fareConfig.base_fare;
      } else {
        fare = fareConfig.base_fare;
        for (const tier of fareConfig.tiers) {
          if (!tier || typeof tier.from_m !== 'number') continue;
          if (distanceM <= tier.from_m) continue;
          const tierEnd =
            tier.to_m === null || tier.to_m === undefined
              ? distanceM
              : Math.min(distanceM, tier.to_m);
          const tierDist = tierEnd - tier.from_m;
          if (tierDist <= 0) continue;
          const ad = tier.add_distance_m > 0 ? tier.add_distance_m : 1;
          const af = tier.add_fare || 0;
          const steps = Math.floor(tierDist / ad) + 1;
          fare += steps * af;
          if (tier.to_m === null || tier.to_m === undefined) break;
          if (distanceM <= tier.to_m) break;
        }
      }
    } else {
      // 旧形式 fallback: base + add 単純計算
      // ★設計変更宣言 (2026-05-15・1000m 境界バグ修正):
      //   旧: `distance_m < base_distance_m` (厳密未満) で 1000m ちょうどが
      //       extra=0 / steps=1 計算により fare=1,300+100=1,400 となるバグ。
      //   新: `<=` に変更し 1000m ちょうども base_fare 適用範囲に含める。
      //   新形式 tiers 経路 (L995) は元から `<=` で正しいので無変更。
      // ★設計変更宣言 (2026-05-15・420m 倍数境界バグ修正):
      //   旧: `steps = Math.floor(extra / add_distance_m) + 1`
      //       → 1420m (extra=420) で steps=floor(1)+1=2 → fare=1500 (1400 をスキップ)
      //       境界 (n × add_distance_m) ちょうどが次バケットに繰り上がる off-by-one。
      //   新: `steps = Math.ceil(extra / add_distance_m)` (確定仕様)
      //       1001m (extra=1)   → ceil(1/420)=1   → fare=1400 ✓
      //       1420m (extra=420) → ceil(420/420)=1 → fare=1400 ✓
      //       1421m (extra=421) → ceil(421/420)=2 → fare=1500 ✓
      //       1840m (extra=840) → ceil(840/420)=2 → fare=1500 ✓
      //       1841m (extra=841) → ceil(841/420)=3 → fare=1600 ✓
      //       2260m (extra=1260)→ ceil(1260/420)=3 → fare=1600 ✓
      if (distanceM <= fareConfig.base_distance_m) {
        fare = fareConfig.base_fare;
      } else {
        const extra = distanceM - fareConfig.base_distance_m;
        const steps = Math.ceil(extra / fareConfig.add_distance_m);
        fare = fareConfig.base_fare + steps * fareConfig.add_fare;
      }
    }

    // Step 2: vehicle 倍率 + addon
    if (fareConfig.vehiclesEnabled && _activeVehicleId && Array.isArray(fareConfig.vehicles)) {
      const v = fareConfig.vehicles.find((x) => x && x.id === _activeVehicleId);
      if (v) {
        const mul = typeof v.multiplier === 'number' && v.multiplier > 0 ? v.multiplier : 1.0;
        const addon = typeof v.addon === 'number' ? v.addon : 0;
        fare = fare * mul + addon;
      }
    }

    // Step 3: 手動 surcharges 乗算
    let manualMul = 1.0;
    if (Array.isArray(fareConfig.surcharges)) {
      for (const id of _activeSurchargeIds) {
        const s = fareConfig.surcharges.find((x) => x && x.id === id);
        if (s && typeof s.rate === 'number' && s.rate >= 1.0) manualMul *= s.rate;
      }
    }
    fare *= manualMul;

    // Step 4: autoSurcharges 自動判定 (現在時刻ベース)
    fare *= _calcAutoSurchargeMultiplier(new Date());

    // Step 5: wait 料金加算
    if (fareConfig.wait && fareConfig.wait.enabled) {
      const waitMin = (state.wait_sec || 0) / 60;
      const free = typeof fareConfig.wait.freeMins === 'number' ? fareConfig.wait.freeMins : 5;
      const rate =
        typeof fareConfig.wait.ratePerMin === 'number' ? fareConfig.wait.ratePerMin : 100;
      const billable = Math.max(0, waitMin - free);
      fare += billable * rate;
    }

    // Step 6: min/max clamp
    if (
      typeof fareConfig.minFare === 'number' &&
      fareConfig.minFare > 0 &&
      fare < fareConfig.minFare
    ) {
      fare = fareConfig.minFare;
    }
    if (
      typeof fareConfig.maxFare === 'number' &&
      fareConfig.maxFare > 0 &&
      fare > fareConfig.maxFare
    ) {
      fare = fareConfig.maxFare;
    }

    // Step 7: 丸め
    const unit =
      typeof fareConfig.rounding === 'number' && fareConfig.rounding > 0 ? fareConfig.rounding : 1;
    if (unit > 1) fare = Math.round(fare / unit) * unit;
    else fare = Math.round(fare);

    return fare;
  }

  // autoSurcharges 自動判定: 現在時刻に該当する全 auto rule の rate 積
  function _calcAutoSurchargeMultiplier(now) {
    if (!fareConfig.autoSurcharges) return 1.0;
    let mul = 1.0;
    const a = fareConfig.autoSurcharges;
    // night: 時刻範囲 (wraparound 対応)
    if (a.night && a.night.enabled) {
      const h = now.getHours();
      const f = a.night.from,
        t = a.night.to;
      const inRange = f <= t ? h >= f && h < t : h >= f || h < t;
      if (inRange && typeof a.night.rate === 'number') mul *= a.night.rate;
    }
    // weekend: 土日固定 (簡易仕様・要件通り)
    if (a.weekend && a.weekend.enabled) {
      const dow = now.getDay();
      if ((dow === 0 || dow === 6) && typeof a.weekend.rate === 'number') mul *= a.weekend.rate;
    }
    // winter: 月日範囲 (年跨ぎ対応・MM-DD 文字列)
    if (a.winter && a.winter.enabled) {
      const mmdd =
        String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      const f = a.winter.from || '12-15';
      const t = a.winter.to || '03-15';
      const inRange = f <= t ? mmdd >= f && mmdd <= t : mmdd >= f || mmdd <= t;
      if (inRange && typeof a.winter.rate === 'number') mul *= a.winter.rate;
    }
    return mul;
  }

  // fareConfig v2: 公開 API
  function setSurchargeActive(id, active) {
    if (!id) return;
    if (active) _activeSurchargeIds.add(id);
    else _activeSurchargeIds.delete(id);
    state.fare_yen = calcFare(state.distance_m);
  }
  function toggleSurcharge(id) {
    if (!id) return;
    if (_activeSurchargeIds.has(id)) _activeSurchargeIds.delete(id);
    else _activeSurchargeIds.add(id);
    state.fare_yen = calcFare(state.distance_m);
  }
  function getActiveSurcharges() {
    return Array.from(_activeSurchargeIds);
  }
  // 現在の合計 surcharge 倍率 (手動 × 自動・vehicle 倍率は除外)
  function getSurchargeMultiplier() {
    let mul = 1.0;
    if (Array.isArray(fareConfig.surcharges)) {
      for (const id of _activeSurchargeIds) {
        const s = fareConfig.surcharges.find((x) => x && x.id === id);
        if (s && typeof s.rate === 'number' && s.rate >= 1.0) mul *= s.rate;
      }
    }
    mul *= _calcAutoSurchargeMultiplier(new Date());
    return mul;
  }
  function setVehicleType(vehicleId) {
    _activeVehicleId = vehicleId || null;
    state.fare_yen = calcFare(state.distance_m);
  }
  function getVehicleType() {
    return _activeVehicleId;
  }

  function getState() {
    // ★設計変更宣言 (2026-05-18・Phase 1 A1 案): elapsed_sec は都度計算
    //   旧: setInterval で state.elapsed_sec をカウント
    //   新: 累積 + 直近 resume 経過を都度計算で返す (= browser throttle / race リスクゼロ)
    const elapsedSec =
      state.running && state.last_resume_time !== null
        ? Math.floor((state.elapsed_accumulated_sec + (Date.now() - state.last_resume_time)) / 1000)
        : Math.floor((state.elapsed_accumulated_sec || 0) / 1000);

    // ★設計変更宣言 (2026-05-18・Phase 3・Reconciliation): display_distance_m を都度計算
    //   target = max(distance_m, gps_predictive, distance_m + tier2_pending_m)
    //     ・3 source のうち最大値を採用 (= 最も進んでいる距離を表示)
    //     ・distance_m を必ず含むことで「課金距離を下回らない」保証
    //   rate = 100 m/s で前回 display_distance_m から target に滑らか追従
    //     ・経過時間 × 100m/秒 の差分まで補正 (= 急減ゼロ・P3 解消)
    //     ・初回は target を即時採用
    //   絶対ルール準拠: distance_m / fare_yen は無変更・表示専用 layer
    // ★設計変更宣言 (2026-05-24・表示層 予測補間・実距離値 1 byte 不変):
    //   GPS 1Hz 物理限界 + UI 500ms refresh の・stair-step (= カクカク) 解消。
    //   target_velocity_mps = 直近 1 秒の target 増分 / dt (= 自己整合・GPS speed 依存なし)
    //   予測 = velocity × min(1.0, 経過時間) で・GPS 待ち間も・display を・滑らかに先取り表示。
    //   屋内駐車 (= target 0 進捗) → velocity 0 → 予測 0 → 屋内ガード壊さない。
    //   停車中 (= target 0 進捗) → velocity 0 → 予測 0。
    //   絶対ルール準拠:
    //     ・state.distance_m / business_distance_m / tier2 系: 1 byte 不変 (= 実値・課金根拠)
    //     ・表示専用 layer・display_distance_m / business_display_distance_m を・滑らかに表示
    //     ・予測は・後退禁止・実値下回り禁止 (= 単調増加 + max(display, target))
    const now = Date.now();
    const target = Math.max(
      state.distance_m || 0,
      state.gps_predictive_distance_m || 0,
      (state.distance_m || 0) + (state.tier2_pending_m || 0)
    );
    // 予測 velocity 更新: 1 秒経過 or target 進捗時に・直近速度算出
    if (state._prev_target_time === null) {
      state._prev_target_distance_m = target;
      state._prev_target_time = now;
      state._target_velocity_mps = 0;
    } else {
      const tdt = (now - state._prev_target_time) / 1000;
      if (tdt >= 1.0) {
        const tdelta = Math.max(0, target - state._prev_target_distance_m);
        // 物理上限 60 m/sec (= 216 km/h) で・mm commit 一括加算の・暴走防止
        state._target_velocity_mps = Math.min(60, tdt > 0 ? tdelta / tdt : 0);
        state._prev_target_distance_m = target;
        state._prev_target_time = now;
      }
    }
    // 予測増分: 直近 target 更新から・最大 1 秒の・線形先取り
    const target_elapsed = Math.min(1.0, (now - (state._prev_target_time || now)) / 1000);
    const predicted_target = target + state._target_velocity_mps * target_elapsed;
    let display = state.display_distance_m || 0;
    if (state.last_display_update_time === null) {
      display = predicted_target;
    } else {
      const dt = Math.max(0, (now - state.last_display_update_time) / 1000);
      const maxDelta = dt * 100; // rate=100 m/s
      const diff = predicted_target - display;
      if (diff > 0 && diff <= maxDelta) {
        display = predicted_target;
      } else if (diff > 0) {
        display += maxDelta;
      }
      // diff <= 0: display 維持 (= 単調増加・後退禁止)
    }
    // 課金距離 (= state.distance_m) を下回らない max 保証
    display = Math.max(display, state.distance_m || 0);
    // 内部 state 更新 (= 次回計算の基準)
    state.display_distance_m = display;
    state.last_display_update_time = now;

    // ★設計変更宣言 (2026-05-24・業務 display 滑らか化・別回路):
    //   business_display_distance_m を・課金 display と・同仕様で計算。
    //   target = business_distance_m + business_tier2_pending_m (= 業務側・道路 snap + preview)
    //   予測 velocity は・別 state (_business_target_velocity_mps) で独立管理。
    //   絶対ルール準拠: business_distance_m / business_tier2_pending_m: 1 byte 不変。
    const business_target =
      (state.business_distance_m || 0) + (state.business_tier2_pending_m || 0);
    if (state._prev_business_target_time === null) {
      state._prev_business_target_distance_m = business_target;
      state._prev_business_target_time = now;
      state._business_target_velocity_mps = 0;
    } else {
      const btdt = (now - state._prev_business_target_time) / 1000;
      if (btdt >= 1.0) {
        const btdelta = Math.max(0, business_target - state._prev_business_target_distance_m);
        state._business_target_velocity_mps = Math.min(60, btdt > 0 ? btdelta / btdt : 0);
        state._prev_business_target_distance_m = business_target;
        state._prev_business_target_time = now;
      }
    }
    const btarget_elapsed = Math.min(1.0, (now - (state._prev_business_target_time || now)) / 1000);
    const predicted_business_target =
      business_target + state._business_target_velocity_mps * btarget_elapsed;
    let bdisplay = state.business_display_distance_m || 0;
    if (state.last_business_display_update_time === null) {
      bdisplay = predicted_business_target;
    } else {
      const bdt = Math.max(0, (now - state.last_business_display_update_time) / 1000);
      const bmaxDelta = bdt * 100; // rate=100 m/s (= 課金 display と同)
      const bdiff = predicted_business_target - bdisplay;
      if (bdiff > 0 && bdiff <= bmaxDelta) {
        bdisplay = predicted_business_target;
      } else if (bdiff > 0) {
        bdisplay += bmaxDelta;
      }
      // bdiff <= 0: 後退禁止
    }
    // 実値下回り防止
    bdisplay = Math.max(bdisplay, business_target);
    state.business_display_distance_m = bdisplay;
    state.last_business_display_update_time = now;

    return { ...state, elapsed_sec: elapsedSec };
  }

  // MM-2 (2026-05-08): 評価インフラ用 公開 API
  //   いつでも呼び出せる現状の Map Matching 統計値スナップショット
  function getMMStats() {
    const total = state.mm_total_count;
    const snap = state.mm_snap_count;
    const skip = state.mm_skip_count;
    return {
      // 基本統計
      total_count: total,
      snap_count: snap,
      skip_count: skip,
      snap_rate: total > 0 ? snap / total : 0,
      skip_rate: total > 0 ? skip / total : 0,
      // 距離（参照用・state.distance_m と並べて整合確認できる）
      mm_distance_m: state.mm_distance_m,
      distance_m: state.distance_m,
      distance_source: state.distanceSource, // 直近の課金距離ソース ('mm' | 'gps')
      mm_silent_ms: lastMmUsefulAt > 0 ? Date.now() - lastMmUsefulAt : null,
      // 性能・候補
      p99_latency_ms: _calcP99Latency(),
      latency_samples: _mmLatencyCount,
      avg_candidates: _mmCandCountSamples > 0 ? _mmCandCountSum / _mmCandCountSamples : 0,
      // Worker 経路 / fallback の判別
      worker_active: !!mmWorker,
      // MM-7: MCM 窓サイズ（mmResult 経由で更新される）
      mcm_window_size: _lastMcmN,
    };
  }

  // ★設計変更宣言 (2026-05-18・setDistance NaN/Infinity/負値 汚染対策):
  //   旧: state.distance_m = distanceM (= 直接代入・無防御)
  //   新: Number.isFinite() && >= 0 ガードで悪値遮断・0 fallback
  //   理由: localStorage 復元等の外部 API で呼ばれるため valid 値以外が入る可能性あり。
  //   絶対ルール準拠: distance_m 加算経路 (Tier1/Off-Road/gap-fill/incremental) は無変更・
  //   既存 valid 値での挙動完全不変 (= 防御強化のみ)。
  function setDistance(distanceM) {
    const v = Number.isFinite(distanceM) && distanceM >= 0 ? distanceM : 0;
    state.distance_m = v;
    state.fare_yen = calcFare(v);
  }

  // ★設計変更宣言 (2026-05-14): business_distance_m の外部設定 API。
  //   Business.load() / Business.restoreFromHistory() からタスクキル復元時に
  //   永続化値 (state.total_distance_m) を Meter 側に逆流させるために使う。
  //   通常の業務中は呼ばない (Meter 内部で累積する)。
  function setBusinessDistance(m) {
    state.business_distance_m = typeof m === 'number' && m >= 0 ? m : 0;
  }

  // ★設計変更宣言 (2026-05-18・Phase 2・business_active gate):
  //   業務開始/終了/再開/破棄のタイミングで Business.js から呼ばれる外部 API。
  //   state.business_active = true なら business_distance_m が常時加算 (= 後付メーター機対等)。
  //   false なら加算停止 (= 業務終了 / 業務未開始時)。
  //   distance_m / fare_yen には影響しない (= 課金根拠は state.running gate で別管理)。
  function setBusinessActive(active) {
    state.business_active = !!active;
  }

  // リロード復元用：最終GPS状態をセット（層3・GPS消失補完を復元後に発火させる）
  function setLastGps(lat, lng, altitude, speedKmh, timestamp) {
    state.last_gps = { lat, lng, altitude };
    state.last_timestamp = timestamp;
    state.last_speed_kmh = speedKmh || 0;
  }

  function resume() {
    if (state.running) return;
    state.running = true;
    // ★ A1: resume 時刻を記録 (= getState 都度計算の基準)
    state.last_resume_time = Date.now();
  }

  // ★設計変更宣言 (2026-05-15・経由地点 + 住所表示機能・最近傍住所検索ヘルパ):
  //   経由地点ボタン押下時 / 代行開始時 / 確定時に呼ばれ、現在地の町名を返す。
  // ★設計変更宣言 (2026-05-15・47 県分割対応・選択肢 Y 実装):
  //   旧: window.ADDRESSES_FINE_JP (全国一括 24.6 MB) を線形スキャン
  //       → 全国版 precache が初回 24.6 MB DL で起動遅延の原因 (2026-05-15 報告事象)
  //   新: 47 県分割 (data/addresses-fine-{pref}.js 各 ~0.4 MB) + perPref 動的ロード
  //       現在地の県を coarse の最近傍 (c の JIS5 桁先頭 2 桁) で特定し、
  //       対応する window.ADDRESSES_FINE_{PREF_UPPER} を参照する。
  //       旧 ADDRESSES_FINE_JP (全国版) も load 済なら fallback として使う (後方互換)。
  //   データソース:
  //     window.ADDRESSES_FINE_{PREF}  大字代表点・県別 (perPref 動的ロード)
  //     window.ADDRESSES_FINE_JP      大字代表点・全国 (後方互換・通常 load されない)
  //     window.ADDRESSES_COARSE_JP    市区町村代表点 1,919 件・47/47 県 (PRECACHE 維持)
  //   2 段フォールバック:
  //     ① coarse から最近傍 (~3km 内) を取り県コード抽出
  //     ② 該当県の fine が load 済なら fine 検索 (~500m 内) → "○○町"
  //     ③ fine 未 load / fine miss なら ① の coarse を採用 → "○○市 付近"
  //     ④ どれも miss / GPS accuracy>50m / coarse 未 load → null
  //   座標は 1e5 倍整数 (lat=4303504 → 43.03504°)。bbox プレフィルタ + haversine 厳密判定。
  //   絶対ルール準拠: 同期完結 (await 不要)・データ未 load や検索失敗で null・
  //                  呼び出し側 (business.js) は null でも業務継続。
  //                  iOS/Android 共通経路 (platform 分岐なし)。
  function _haversineMetersForAddr(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLng = (lng2 - lng1) * toRad;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  // JIS X 0401 都道府県コード (2 桁文字列) → ローマ字 pref 名 (perPref 命名規則)
  const _JIS_TO_PREF = {
    '01': 'hokkaido',
    '02': 'aomori',
    '03': 'iwate',
    '04': 'miyagi',
    '05': 'akita',
    '06': 'yamagata',
    '07': 'fukushima',
    '08': 'ibaraki',
    '09': 'tochigi',
    10: 'gunma',
    11: 'saitama',
    12: 'chiba',
    13: 'tokyo',
    14: 'kanagawa',
    15: 'niigata',
    16: 'toyama',
    17: 'ishikawa',
    18: 'fukui',
    19: 'yamanashi',
    20: 'nagano',
    21: 'gifu',
    22: 'shizuoka',
    23: 'aichi',
    24: 'mie',
    25: 'shiga',
    26: 'kyoto',
    27: 'osaka',
    28: 'hyogo',
    29: 'nara',
    30: 'wakayama',
    31: 'tottori',
    32: 'shimane',
    33: 'okayama',
    34: 'hiroshima',
    35: 'yamaguchi',
    36: 'tokushima',
    37: 'kagawa',
    38: 'ehime',
    39: 'kochi',
    40: 'fukuoka',
    41: 'saga',
    42: 'nagasaki',
    43: 'kumamoto',
    44: 'oita',
    45: 'miyazaki',
    46: 'kagoshima',
    47: 'okinawa',
  };
  // _JIS_TO_PREF の key は混合 (先頭 '0' の数値リテラル化を防ぐため文字列 + 数値) なので
  // 取り出し時には文字列に正規化して引く。
  function _jisToPref(jis) {
    if (typeof jis !== 'string' && typeof jis !== 'number') return null;
    const key = String(jis);
    return _JIS_TO_PREF[key] || _JIS_TO_PREF[Number(key)] || null;
  }
  // 県別 fine データ参照 (window.ADDRESSES_FINE_{PREF_UPPER}・未 load なら null)
  function _getFineBundleForPref(pref) {
    if (typeof window === 'undefined') return null;
    const upper = pref.toUpperCase().replace(/-/g, '_');
    const bundle = window['ADDRESSES_FINE_' + upper];
    if (bundle && Array.isArray(bundle.items)) return bundle;
    return null;
  }
  // 県別の items に対して半径 500m 以内最近傍を探す (bbox プレフィルタ + haversine)
  // ★設計変更宣言 (2026-05-22・座標スケール統一): items は precision: 100000 形式 (= 同 COARSE)。
  //   COORD_SCALE を function 内で明示化し・getNearestAddress と統一。
  //   FINE は・大字レベルの・密データ (= 1 県 1000-2000 件・500m radius) のため・bbox 520 不変。
  function _searchFineItems(items, lat, lng, targetLatI, targetLngI) {
    const COORD_SCALE = 100000;
    const FINE_RADIUS_M = 500;
    const fineRangeI = 520; // ≈ 580m 緯度方向 (経度方向は緯度依存で短くなる・広めに取って漏らさない)
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const dLatI = it.lat - targetLatI;
      if (dLatI > fineRangeI || dLatI < -fineRangeI) continue;
      const dLngI = it.lng - targetLngI;
      if (dLngI > fineRangeI || dLngI < -fineRangeI) continue;
      const itemLat = it.lat / COORD_SCALE;
      const itemLng = it.lng / COORD_SCALE;
      const distM = _haversineMetersForAddr(lat, lng, itemLat, itemLng);
      if (distM <= FINE_RADIUS_M && distM < bestDist) {
        bestDist = distM;
        best = it;
      }
    }
    return best;
  }
  function getNearestAddress(lat, lng, accuracy) {
    if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) {
      return null;
    }
    if (typeof accuracy === 'number' && isFinite(accuracy) && accuracy > 50) {
      return null;
    }
    // ★設計変更宣言 (2026-05-22・実機 bug 修正・座標スケール統一 + COARSE radius 拡大):
    //   ADDRESSES_COARSE_JP.items は・lat/lng が integer × 1e5 形式 (= 33.94 → 3393613)。
    //   precision: 100000 の data に対し getNearestAddress は・GPS decimal を targetLatI に
    //   ×1e5 化し・items 側は ÷1e5 を haversine で実施する・スケール統一実装。
    //   ★ 実機 bug (= 司さん eruda 観測・愛媛今治): COARSE_RADIUS_M=3000m + coarseRangeI=2800
    //     (= 0.028°≈3.1km) が・市域 sweep に対して狭すぎ・今治市 centroid (= 市の北部) と
    //     user (= 市の南部) の・実距離 8.6km で・全 1919 items が bbox SKIP → null 確定。
    //   修正: COARSE_RADIUS_M=25000m + coarseRangeI=25000 (= 0.25°≈28km) に拡大・
    //         日本最大規模の市 (= 静岡市 1411 km²・浜松市 1558 km² 等) でも・centroid から
    //         端までを haversine で正確に filter 可能に。
    //   COORD_SCALE 定数化: 4 段階探索全経路 (= coarse / 県別 fine / legacy fine) で・
    //     スケール変換を明示化し・将来 precision 変更時の・配線 mistake を防止。
    //   絶対ルール準拠:
    //     ✓ 住所は表示専用 (= 距離 / 課金 / Worker B / map-matcher は・無関係)
    //     ✓ distance_m += 5 経路 (L440/L514/L961/L979/L1365) は・一切 無変更
    //     ✓ data file は・再生成しない (= コード側でのみ ÷COORD_SCALE)
    const COORD_SCALE = 100000;
    const targetLatI = Math.round(lat * COORD_SCALE);
    const targetLngI = Math.round(lng * COORD_SCALE);
    const COARSE_RADIUS_M = 25000;
    const coarseRangeI = 25000;

    // ─── ① coarse から最近傍 (~25km 内) を引いて県コードを取得 ───
    let bestCoarse = null;
    let bestCoarseDistM = Infinity;
    if (
      typeof window !== 'undefined' &&
      window.ADDRESSES_COARSE_JP &&
      Array.isArray(window.ADDRESSES_COARSE_JP.items)
    ) {
      const coarseItems = window.ADDRESSES_COARSE_JP.items;
      for (let i = 0; i < coarseItems.length; i++) {
        const it = coarseItems[i];
        const dLatI = it.lat - targetLatI;
        if (dLatI > coarseRangeI || dLatI < -coarseRangeI) continue;
        const dLngI = it.lng - targetLngI;
        if (dLngI > coarseRangeI || dLngI < -coarseRangeI) continue;
        const itemLat = it.lat / COORD_SCALE;
        const itemLng = it.lng / COORD_SCALE;
        const distM = _haversineMetersForAddr(lat, lng, itemLat, itemLng);
        if (distM <= COARSE_RADIUS_M && distM < bestCoarseDistM) {
          bestCoarseDistM = distM;
          bestCoarse = it;
        }
      }
    }
    // coarse の c は JIS X 0402 市区町村コード 5 桁・先頭 2 桁が県コード
    let prefName = null;
    if (bestCoarse && typeof bestCoarse.c === 'string' && bestCoarse.c.length >= 2) {
      prefName = _jisToPref(bestCoarse.c.substring(0, 2));
    }

    // ─── ② 該当県の fine が load 済なら fine 検索 (~500m 内) ───
    if (prefName) {
      const bundle = _getFineBundleForPref(prefName);
      if (bundle) {
        const best = _searchFineItems(bundle.items, lat, lng, targetLatI, targetLngI);
        if (best) return best.n;
      }
    }

    // ─── ③ 後方互換: 全国版 ADDRESSES_FINE_JP が load 済ならそれも検索 ───
    if (
      typeof window !== 'undefined' &&
      window.ADDRESSES_FINE_JP &&
      Array.isArray(window.ADDRESSES_FINE_JP.items)
    ) {
      const best = _searchFineItems(
        window.ADDRESSES_FINE_JP.items,
        lat,
        lng,
        targetLatI,
        targetLngI
      );
      if (best) return best.n;
    }

    // ─── ④ fine miss / fine 未 load → coarse 結果 (市区町村 + 付近) ───
    if (bestCoarse) return bestCoarse.n + ' 付近';

    return null;
  }

  // ★設計変更宣言 (2026-05-15・住所取得 retry 用判定ヘルパ・47 県分割対応):
  //   旧: ADDRESSES_FINE_JP (全国版) or COARSE_JP のいずれか load 済なら true
  //   新: ADDRESSES_FINE_{PREF} (47 県のいずれか) / ADDRESSES_FINE_JP (後方互換) /
  //       ADDRESSES_COARSE_JP のいずれか load 済なら true
  //   coarse (PRECACHE 維持・220 KB) は必ず load 済になる前提のため、現実的には
  //   coarse のロード完了をもって retry を止める判定として機能する (= 旧挙動と等価)。
  //   絶対ルール準拠: 同期判定・例外を投げない・データ未 load でも業務継続性に影響を与えない。
  function _anyFinePrefLoaded() {
    if (typeof window === 'undefined') return false;
    for (const code of Object.keys(_JIS_TO_PREF)) {
      const pref = _JIS_TO_PREF[code];
      const upper = pref.toUpperCase().replace(/-/g, '_');
      const bundle = window['ADDRESSES_FINE_' + upper];
      if (bundle && Array.isArray(bundle.items) && bundle.items.length > 0) return true;
    }
    return false;
  }
  function isAddressDataReady() {
    const coarseReady =
      typeof window !== 'undefined' &&
      window.ADDRESSES_COARSE_JP &&
      Array.isArray(window.ADDRESSES_COARSE_JP.items) &&
      window.ADDRESSES_COARSE_JP.items.length > 0;
    if (coarseReady) return true;
    const fineLegacyReady =
      typeof window !== 'undefined' &&
      window.ADDRESSES_FINE_JP &&
      Array.isArray(window.ADDRESSES_FINE_JP.items) &&
      window.ADDRESSES_FINE_JP.items.length > 0;
    if (fineLegacyReady) return true;
    return _anyFinePrefLoaded();
  }

  // 起動時warm up（2026/04/30追加）
  // 代行開始前でも常に呼ばれて、GPSを内部に保存しておく
  // 「代行開始」押した瞬間に start() が lastWarmupGps を初期値として使う
  // これにより「100m走って動き出す」遅延が解消される
  // state には触らない（距離・料金は変えない）
  function updateGpsOnly(gpsResult) {
    if (!gpsResult || typeof gpsResult.lat !== 'number' || typeof gpsResult.lng !== 'number')
      return;
    lastWarmupGps = {
      lat: gpsResult.lat,
      lng: gpsResult.lng,
      altitude: gpsResult.altitude || 0,
      compassHeading: gpsResult.compassHeading || null,
      timestamp: gpsResult.timestamp || Date.now(),
      speedKmh: gpsResult.speedKmh || 0,
    };
  }

  // ★設計変更宣言 (2026-05-19・B-3・代行中タスクキル elapsed_sec 復元):
  //   旧: Meter.start で elapsed_accumulated_sec=0 / last_resume_time=now
  //       → タスクキル復帰時 checkDrivingRestore → Meter.start → elapsed 0 リセット
  //       → 代行中の経過時間が失われる
  //   新: 復帰時に Meter.start 後に本 API を呼んで elapsed_accumulated_sec を復元
  //       last_resume_time=now で復元後即時カウント開始
  //   絶対ルール準拠:
  //     ・distance_m / fare_yen / 課金経路には触れない
  //     ・正常起動時は呼ばれない (= タスクキル復帰時のみ)
  function setElapsedAccumulated(savedSec) {
    const v = typeof savedSec === 'number' && savedSec >= 0 ? savedSec : 0;
    state.elapsed_accumulated_sec = v;
    state.last_resume_time = Date.now();
  }

  // ★設計変更宣言 (2026-05-19・B-1・業務開始時 warmup GPS prime):
  //   旧: 業務開始 (= Business.start) は Meter.start を呼ばないので・state.last_gps=null のまま
  //       → 待機中の最初の GPS update は last_gps セットのみ・haversine 加算は 2 回目から
  //       → 業務開始から「最初の 1〜2 秒 + GPS first fix 待ち」 のラグ発生
  //   新: 業務開始時 (= onBusinessStart) で本 API を呼出・lastWarmupGps があれば
  //       state.last_gps / state.last_timestamp に prime → 待機中初回 GPS update から
  //       haversine 加算開始 (= ラグ最小化)
  //   絶対ルール準拠:
  //     ・5 秒以上前の warmup は使わない (= 過剰加算リスク回避・既存 WARMUP_MAX_AGE_MS 同基準)
  //     ・distance_m / fare_yen / 課金経路には触れない (= state.running gate 経路は不変)
  //     ・state.business_active 状態は不変 (= 業務 gate は別途 setBusinessActive で管理)
  function primeFromWarmup() {
    const now = Date.now();
    const WARMUP_MAX_AGE_MS = 5000;
    const warmupValid =
      lastWarmupGps && lastWarmupGps.timestamp && now - lastWarmupGps.timestamp < WARMUP_MAX_AGE_MS;
    if (!warmupValid) return false;
    state.last_gps = {
      lat: lastWarmupGps.lat,
      lng: lastWarmupGps.lng,
      altitude: lastWarmupGps.altitude,
      compassHeading: lastWarmupGps.compassHeading || null,
    };
    state.last_timestamp = lastWarmupGps.timestamp;
    state.last_speed_kmh = lastWarmupGps.speedKmh || 0;
    return true;
  }

  return {
    start,
    stop,
    businessEnd,
    reset,
    resume,
    update,
    updateGpsOnly,
    primeFromWarmup,
    setElapsedAccumulated,
    getState,
    getMMStats,
    setFareConfig,
    getFareConfig,
    calcFare,
    // ★設計変更宣言 (2026-05-15・経由地点 + 住所表示機能):
    //   ADDRESSES_FINE_JP / COARSE_JP からの最近傍住所検索ヘルパを export。
    //   呼び出し側は index.html (経由地点ボタン) / js/business.js (start/end 住所取得)。
    getNearestAddress,
    // ★設計変更宣言 (2026-05-15・住所取得 retry 用判定ヘルパ): データ load 完了判定を export。
    isAddressDataReady,
    setDistance,
    setLastGps,
    setMapMatcher,
    isMmReady,
    // 業務単位累積距離 (2026-05-14)
    setBusinessDistance,
    setBusinessActive, // ★ Phase 2: 業務 active gate 外部設定 (= Business.js から呼ぶ)
    // ★設計変更宣言 (2026-05-15・テスト用 drain window 制御 API):
    //   tests/meter-mm-priority.js 等の統合テストは Meter.start() 直後に
    //   fakeWorker._dispatch() で mmResult を同期投入する設計のため、
    //   prod 用の 500ms drain window に引っ掛かって state.distance_m が
    //   加算されず期待値と乖離する。テストでは Meter.start() の直後に
    //   Meter._setDrainMmUntil(0) を呼出して drain を即時無効化できるようにする。
    //   prod コードからは呼び出さない (テスト専用 escape hatch)。
    _setDrainMmUntil: function (t) {
      _drainMmUntil = typeof t === 'number' ? t : 0;
    },
    // ★設計変更宣言 (2026-05-19・R1 test escape hatch):
    //   Off-Road grace period (5 秒) は prod 環境で「代行開始直後 200m 飛び」防止のため
    //   必須。ただし既存 offroad-mode-activation.test.js は Meter.start 直後に snap miss
    //   5 連続で Off-Road 起動を期待しており、grace で起動しなくなる。
    //   テスト用に _setOffRoadGraceUntil(0) で grace を即時無効化できる API を提供。
    //   prod コードからは呼び出さない (テスト専用 escape hatch)。
    _setOffRoadGraceUntil: function (t) {
      _offRoadGraceUntil = typeof t === 'number' ? t : 0;
    },
    // fareConfig v2 (2026-05-10)
    setSurchargeActive,
    toggleSurcharge,
    getActiveSurcharges,
    getSurchargeMultiplier,
    setVehicleType,
    getVehicleType,
  };
})();

// ★設計変更宣言 (2026-05-15・Phase C・Node coverage 計測可能化):
//   既存 `const Meter = (() => {...})()` IIFE は無変更。末尾に Node 環境用 module.exports を追加。
//   browser/Worker context: module 未定義のため no-op (旧挙動と等価)。
//   Node test context: require('./meter.js') で Meter API オブジェクトを取得可能。
// eslint-disable-next-line no-undef -- node 環境のみ・typeof guard で browser/Worker は no-op
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') module.exports = Meter;
