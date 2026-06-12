// ============================================================
// meter.js  (ダイコメ メーター本体・白紙書き直し・clean-rebuild-pipeline)
//
// ★アーキテクチャ (2026-05-30 白紙書き直し)★
//   距離 distance_m = 「道路 snap 道なり累積」を ★単一エンジン★ で駆動する。
//     エンジン = js/pipeline-distance.js (createDistanceTracker・実走 9,677m 検証済)。
//     エンジンは Worker B (map-matcher.js) 内で動き、GPS 1 点ごとに ingest して
//     その区間の道なり増分を mmResult.pipelineDeltaM として main に返す。
//     meter は running gate 内で state.distance_m += pipelineDeltaM するだけ (= 単一経路)。
//
//   旧 meter.js の・distance_m 5 経路集計 (mm commit / retro Off-Road / gap fill /
//   Off-Road incremental / setDistance) や・13 orphan helper・Viterbi mmIncrementM 集計・
//   tier2 preview 二重回路・α-β filter は ★この新ファイルには存在しない★。
//
// ★絶対不可侵 (白紙でも完全保持)★
//   1. calcFare 料金式 (1000m¥1300 / 以降 420m¥100・多段 tiers/vehicle/surcharge/auto/
//      wait/clamp/round) = 旧 meter.js から 1 byte もじらず移植。
//   2. 公開メソッド signature = 全て維持 (return オブジェクト末尾参照・公開 28 メソッド
//      + テスト用 escape hatch 2 = 計 30 プロパティ。旧 meter.js と export 名・順序一致)。
//   3. getState が返す既存 state field キー (distance_m / fare_yen / business_distance_m /
//      display_distance_m / business_display_distance_m / tier2_pending_m /
//      business_tier2_pending_m / running / business_active / elapsed_sec / last_gps /
//      wait_sec / distanceSource / mm_* / offroad_* / gap_fill_* 等)
//      = 既存キーは消さない (index.html / business.js が読む)。距離 5 経路廃止に伴い
//      参照値となった field (mm_*/offroad_*/gap_fill_*) は 0 のまま温存 (= 後方互換キー)。
//   4. 非距離ロジック (住所 getNearestAddress / surcharge / vehicle / fareConfig /
//      elapsed 時間 / wait / business 状態) = 旧から clean に移植 (機能保持)。
//   5. Worker B プロトコル (post: gps/reset/loadRoads/configPlatform/softReset,
//      受信: mmResult/roadsLoaded) = 名前と形維持。
//      ※旧 'resetCommittedSnap' message は白紙書き直しで廃止 (meter は post せず・
//        map-matcher.js も handler 削除済・2026-05-30)。距離の gap/off-road 境界は
//        pipeline-distance エンジンが内部処理するため不要。
//   6. 距離 = 道路 snap 道なり累積の意味論・GPS 直線課金禁止・完全オフライン・
//      iOS/Android 両対応。
//
//   distance_m 加算は「running gate 内の state.distance_m += pipelineDeltaM」の ★1 経路のみ★
//   + 復元用 setDistance の代入。GPS.calcDistance による直線課金は meter.js には存在しない
//   (= haversine は pipeline-distance.js / Worker B 内に集約)。
// ============================================================

// eslint-disable-next-line no-unused-vars -- 他ファイルから Meter をグローバル参照 (cross-file global pattern)
const Meter = (() => {
  // ★随伴車別 k(メーター定数/器差調整)★ (2026-06-09・discovery監査スペック準拠):
  //   engine(pipeline-distance) は無改変。k は ★meter 層の器差定数★ として rawDelta に乗算する。
  //   ・distance_m / business_distance_m = rawDelta × _activeVehicleK (校正)
  //   ・mm_distance_m は rawDelta のまま (RAW・校正前監査ベースライン温存)
  //   ・k は代行開始 (setBusinessActive false→true / 業務外start) でロック=業務別 (途中改ざん無視)
  //   ・_clampVK で [VK_MIN, VK_MAX] ハードクランプ。★VK_MAX が唯一の過大臨界ノブ★
  //   ・never-over: 学習基準=認定メーター読み(検定上タイヤ真値以下) → k適用後 ≤ cert ≤ 真値
  //   ・既定 k=1.0 で全乗算が恒等=現行 1byte 不変 (cert-gate/parity 影響ゼロ)
  const VK_MIN = 0.9;
  const VK_MAX = 1.01;
  let _activeVehicleK = 1.0; // 業務開始でロックされる適用係数
  function _clampVK(k) {
    return typeof k === 'number' && isFinite(k) ? Math.min(VK_MAX, Math.max(VK_MIN, k)) : 1.0;
  }
  function _resolveVK() {
    try {
      return typeof window !== 'undefined' &&
        window.DK_VEHICLE_PROFILE &&
        typeof window.DK_VEHICLE_PROFILE.k === 'number'
        ? window.DK_VEHICLE_PROFILE.k
        : 1.0;
    } catch (_) {
      return 1.0;
    }
  }

  // ─── state 初期化 ──────────────────────────────────────────
  //   ★既存キーは消さない (index.html / business.js が読む)。
  let state = {
    running: false, // 代行中 (= 課金 gate)
    distance_m: 0, // 課金距離 (= 道路 snap 道なり累積・pipeline delta 駆動・不可侵)
    distanceSource: 'pipeline', // 直近で distance_m を更新したソース ('pipeline' | 'inline')
    fare_yen: 0, // 課金料金
    elapsed_sec: 0, // 経過時間 (getState で都度計算)
    elapsed_accumulated_sec: 0, // 累積走行時間 (= stop / businessEnd で確定加算・内部)
    last_resume_time: null, // 直近 start / resume の時刻 (= 都度計算の基準・内部)
    business_active: false, // 業務中フラグ (= Business.start/end で外部設定)
    business_distance_m: 0, // 業務単位累積距離 (= 業務 active gate・trip 跨ぎ保持)
    start_time: null, // 代行開始時刻
    last_gps: null, // {lat,lng,accuracy,altitude,compassHeading} | null
    last_timestamp: null, // 最後の GPS 時刻
    last_speed_kmh: 0, // 直近 GPS 速度
    last_isStationary: false, // gps.js isStationary 判定
    // ─── 表示用 (予測補間・実距離値 1 byte 不変の表示専用 layer) ───
    display_distance_m: 0, // 課金 display (= distance_m を 10m 滑らかに先取り表示)
    last_display_update_time: null,
    _prev_target_distance_m: 0,
    _prev_target_time: null,
    _target_velocity_mps: 0,
    business_display_distance_m: 0, // 業務 display (= business_distance_m を滑らか追従)
    last_business_display_update_time: null,
    _prev_business_target_distance_m: 0,
    _prev_business_target_time: null,
    _business_target_velocity_mps: 0,
    // ─── 待機料金 ───
    wait_sec: 0, // 累積待機時間 (秒・速度 < 3km/h で加算)
    // ─── 後方互換キー (旧 5 経路廃止で参照値化・0 のまま温存・index.html が読む) ───
    tier2_pending_m: 0, // 旧 tier2 preview (= 廃止・常に 0)
    business_tier2_pending_m: 0, // 旧 business preview (= 廃止・常に 0)
    gps_predictive_distance_m: 0, // 旧 GPS predictive (= 廃止・常に 0)
    mm_distance_m: 0, // Map Matching 参照距離 (= pipeline と同値を mirror)
    mm_snap_count: 0, // snap 成功回数 (Worker B stats)
    mm_total_count: 0, // update 呼出回数
    mm_skip_count: 0, // snap skip 回数
    offroad_distance_m: 0, // 旧 Off-Road 加算 (= 廃止・常に 0)
    offroad_count: 0, // 旧 Off-Road 起動回数 (= 廃止・常に 0)
    gap_fill_count: 0, // 旧 gap fill 回数 (= 廃止・常に 0)
    gap_fill_total_m: 0, // 旧 gap fill 距離 (= 廃止・常に 0)
  };

  // ─── 表示 catch-up の定数 (= 距離値 1 byte 不変の表示専用 layer) ───
  //   ★司さん確定方針 (2026-05-30・過大請求根絶)★:
  //     ・display は実距離 (target=distance_m) を ★絶対に超えない (overshoot ゼロ)★。
  //       先取り (predict lookahead) は過大請求の穴になるため完全廃止。
  //     ・display は target に「下から」滑らかに追いつく (catch-up・指数収束)。
  //     ・確定 / 停車 / 業務終了 (= 支払タイミング) では display を target に latch し
  //       メーター=実距離=料金 を一致させる (= calcFare(display) ≤ calcFare(distance_m) 保証)。
  //   旧 predict 先取り (display = target + velocity×経過秒) は overshoot を生むため撤去。
  const DISP_CATCHUP_TAU_S = 0.4; // (旧・指数catch-up 時定数。等速ペース化で未使用・互換のため残置)
  const DISP_LATCH_GAP_M = 0.01; // この残差未満なら target に着地 (= 収束扱い)
  const DISP_RATE_EMA_ALPHA = 0.5; // 等速ペース rate の EMA 平滑係数 (= 直近瞬時レートの寄与・0<α≤1)
  const DISP_RATE_MAX_MPS = 55; // 等速ペース rate の物理上限 (= 198km/h・cold-start/glitch の瞬時値 spike を EMA から除外)
  const DISP_MAX_FRAME_DT_S = 0.4; // dtFrame 上限秒 (= タブ復帰/描画間引きの一撃飛び防止・残差は次フレーム連続収束)
  const DISP_CLOSE_TAU_S = 3.0; // gap 収束 spring の時定数 (= lump/復帰時に gap を τ 秒で詰める)
  const DISP_CATCHUP_MAX_MPS = 24; // 追従速度上限 (= 大 lump 復帰の「ドン」抑制・直近走行速度の妥当倍率内)
  void DISP_CATCHUP_TAU_S; // 等速ペース化で未使用 (= 形維持・lint 黙らせ)

  // ─── fareConfig (v2・後方互換維持) ───
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
  // F6: 業務中の fareConfig 変更を抑制 (= 走行中の急変防止)
  let _fareConfigFrozen = false;

  // ─── Map Matching (Worker B) 連携 ───
  const MM_ENABLED = true;
  let mmWorker = null;
  let _workerLoadedPrefs = new Set(); // roadsLoaded ack を track して MM ready 判定に使う

  // ★代行開始直後の Worker B バッファ残骸 drain (= driveDist が 0.17km 等で開始する事象防止)。
  //   Meter.start() は worker に 'reset' を ASYNC で送るが、直前 commit が queue に残り
  //   start 完了直後の tick で届く race を回避する。drain window 中の pipelineDeltaM は
  //   distance_m / business_distance_m いずれにも加算しない。
  let _drainMmUntil = 0;
  const MM_DRAIN_AFTER_START_MS = 500;

  // ★gap補完 (Worker B 不在時のみ・GNSS空白の速度補完) 定数★
  const GAP_FILL_THRESHOLD_SEC = 5; // dt がこれ以上で gap 補完発火 (= GPS 空白)
  const GAP_FILL_MAX_SEC = 120; // これ以上の dt は app background 等とみなし補完しない
  const GAP_FILL_MAX_KMH = 160; // 速度の物理上限 clamp (異常 speed での過大補完防止)

  // ★計器 (2026-05-30・実機検証用・課金非関与の診断ログ): engine 実動値を ~1Hz で console 出力。
  //   debug-log-uploader が trace に収集 → 実機で distance_m/distanceSource(pipeline vs gap)/
  //   business/creep/速度 が実際どう動いたかをオフライン replay と突合できる。state は read のみ。
  let _lastEngineLogT = 0;
  // 旧 Off-Road grace period の escape hatch 用 (= テスト互換・新距離では未使用だが API 維持)。
  let _offRoadGraceUntil = 0;
  const OFFROAD_GRACE_AFTER_START_MS = 5000;

  // Worker B 健全性 (= 直近 useful な mmResult を受けた時刻・getMMStats 用)
  let lastMmUsefulAt = 0;

  // MM 評価インフラ: latency 循環バッファ + 候補数累積 (getMMStats 用)
  const _MM_LATENCY_BUFFER_SIZE = 1000;
  const _mmLatencyBuf = new Float32Array(_MM_LATENCY_BUFFER_SIZE);
  let _mmLatencyIdx = 0;
  let _mmLatencyCount = 0;
  let _mmCandCountSum = 0;
  let _mmCandCountSamples = 0;
  let _lastMcmN = 0;
  let _lastSnapTypeCode = null;

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

  // 起動時 warm up: 代行開始前から GPS を保持 (= 「代行開始」押下で即計測開始)。
  let lastWarmupGps = null;

  // ─── fareConfig 公開 API ───
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

  // ─── Worker B 連携 ───
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

  // ─── Worker B からの mmResult ハンドラ (= 距離駆動の単一受信点) ───
  //   新アーキ: state.distance_m += m.pipelineDeltaM (= 道路 snap 道なり区間増分) を
  //   running gate 内で実行する。business_distance_m は business_active gate で加算。
  //   旧 Viterbi mmIncrementM / tentative / Off-Road / gap は ★参照しない★。
  function _onMmWorkerMessage(e) {
    const m = e && e.data;
    if (!m) return;
    if (m.type === 'roadsLoaded') {
      if (m.ok && m.pref) _workerLoadedPrefs.add(m.pref);
      return;
    }
    if (m.type !== 'mmResult') return;

    // ★距離駆動: pipeline delta を距離に加算する単一経路★
    const delta =
      typeof m.pipelineDeltaM === 'number' && m.pipelineDeltaM > 0 ? m.pipelineDeltaM : 0;
    if (delta > 0 && Date.now() >= _drainMmUntil) {
      lastMmUsefulAt = Date.now();
      // 参照値 mirror (= 後方互換 stats・mm_distance_m は ★RAW★・校正前監査ベースライン温存)
      state.mm_distance_m += delta;
      // ★随伴車別 k 校正★: 課金距離/業務距離は raw × _activeVehicleK (k=1.0 で恒等=1byte不変)
      const cal = delta * _activeVehicleK;
      // 課金距離 (running gate・絶対不可侵経路)
      if (state.running) {
        state.distance_m += cal;
        state.fare_yen = calcFare(state.distance_m);
        state.distanceSource = 'pipeline';
      }
      // 業務単位累積 (business_active gate・空車中も加算・後付メーター対等)
      if (state.business_active) {
        state.business_distance_m = (state.business_distance_m || 0) + cal;
      }
    } else if (delta > 0 && Date.now() < _drainMmUntil) {
      // drain window 中の残骸は破棄 (= 代行開始直後 0.17km 等を防ぐ)。stats のみ更新。
      lastMmUsefulAt = Date.now();
      state.mm_distance_m += delta;
      if (typeof dlog === 'function') {
        dlog('[Meter] drain pipelineDelta ' + delta.toFixed(1) + 'm (代行開始直後の残骸)');
      }
    }

    // snap stats / road type 伝達 (= getMMStats / GPS Kalman Q 動的化用・距離には無関係)
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
    // commit が起きた road を Firebase cross-user pheromone に集約
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
      if (typeof dlog === 'function' && m._reason) dlog('[MM] skip: ' + m._reason);
    }
    if (typeof m.latencyMs === 'number') _recordMmLatency(m.latencyMs);
    if (typeof m.candidatesCount === 'number') {
      _mmCandCountSum += m.candidatesCount;
      _mmCandCountSamples++;
    }
    if (typeof m.mcmN === 'number') _lastMcmN = m.mcmN;
  }

  // ─── 代行開始 ───
  function start() {
    const now = Date.now();
    // ★k 保険ロック★: 業務外 (単独計測) の start でも k を解決して課金距離を校正。
    //   業務中 (business_active=true) は ★ロック維持★ (start/resume で再解決しない=業務別不変)。
    if (!state.business_active) {
      _activeVehicleK = _clampVK(_resolveVK());
    }
    const WARMUP_MAX_AGE_MS = 5000;
    const warmupValid =
      lastWarmupGps && lastWarmupGps.timestamp && now - lastWarmupGps.timestamp < WARMUP_MAX_AGE_MS;
    // business_* は trip 跨ぎで保持 (= 業務単位累積・businessEnd でのみ 0 化)。
    const prevBusinessDist = (state && state.business_distance_m) || 0;
    const prevBusinessActive = !!(state && state.business_active);
    const prevBusinessDisplay = (state && state.business_display_distance_m) || prevBusinessDist;
    state = {
      running: true,
      distance_m: 0,
      distanceSource: 'pipeline',
      fare_yen: fareConfig.base_fare,
      elapsed_sec: 0,
      elapsed_accumulated_sec: 0,
      last_resume_time: now,
      business_active: prevBusinessActive,
      business_distance_m: prevBusinessDist,
      start_time: now,
      last_gps: warmupValid
        ? {
            lat: lastWarmupGps.lat,
            lng: lastWarmupGps.lng,
            accuracy: lastWarmupGps.accuracy,
            altitude: lastWarmupGps.altitude,
            compassHeading: lastWarmupGps.compassHeading,
          }
        : null,
      last_timestamp: warmupValid ? now : null,
      last_speed_kmh: warmupValid ? lastWarmupGps.speedKmh : 0,
      last_isStationary: false,
      // 表示用 (trip 単位 0 化)
      display_distance_m: 0,
      last_display_update_time: null,
      _prev_target_distance_m: 0,
      // ★等速ペース★: 開始時刻を seed (= 初回 delta で valid dtTarget を得て cold-start sit を解消)。
      _prev_target_time: now,
      _target_velocity_mps: 0,
      // business display (per-trip 引き継ぎ)
      business_display_distance_m: prevBusinessDisplay,
      last_business_display_update_time: null,
      _prev_business_target_distance_m: prevBusinessDisplay,
      _prev_business_target_time: now,
      _business_target_velocity_mps: 0,
      wait_sec: 0,
      // 後方互換キー (= 廃止・0 維持)
      tier2_pending_m: 0,
      business_tier2_pending_m: (state && state.business_tier2_pending_m) || 0,
      gps_predictive_distance_m: 0,
      mm_distance_m: 0,
      mm_snap_count: 0,
      mm_total_count: 0,
      mm_skip_count: 0,
      offroad_distance_m: 0,
      offroad_count: 0,
      gap_fill_count: 0,
      gap_fill_total_m: 0,
    };
    // fareConfig v2: 業務開始時 default ON の surcharge を初期 active に
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
    _fareConfigFrozen = true; // F6: 業務開始で凍結
    lastMmUsefulAt = Date.now();
    // ★設計変更宣言 (2026-06-04・直し2 ウォーム始動): 代行開始の「出だしラグ」根治。
    //   旧: 代行開始で必ず Worker B を 'reset' (Viterbi 窓を flush+再初期化=コールド) + 500ms drain。
    //       待機中に既に現在道路へ収束済の Viterbi 窓を捨て、再収束する間の最初の区間が計上されず
    //       メーターが後ろにズレてスタートする (= 出だしラグ・短業務ほど%で過少)。
    //   新: 待機中 GPS が流れ収束済 (warmupValid) なら ★softReset★ (Viterbi 窓は保持し
    //       lastCommittedSnap/prevSnap だけクリア=距離会計のみ新規) + drain 無し。
    //       = 収束済の道路の掴みを引き継ぎ、代行開始の1m目から計上。距離カウンタは business 側で 0 始まり。
    //   安全分岐: 未収束 (cold-open=アプリ起動直後/タスクキル復帰/待機GPS無し) は従来 'reset'+drain を維持
    //       (収束してない窓を引き継ぐと逆に幻 snap で不整合になるため)。device 分岐でなく収束状態での分岐。
    //   distance_m 構造 / calcFare / running gate / business 分離 / 過大ゼロ は不変 (会計は触らない)。
    if (warmupValid) {
      _drainMmUntil = Date.now(); // drain 無し (= 収束済の正しい増分を捨てない)
      _offRoadGraceUntil = Date.now();
    } else {
      _drainMmUntil = Date.now() + MM_DRAIN_AFTER_START_MS; // cold-open は従来 drain (creep/不整合保険)
      _offRoadGraceUntil = Date.now() + OFFROAD_GRACE_AFTER_START_MS;
    }
    // Worker B: warmup 済なら softReset (Viterbi 窓保持=ウォーム引き継ぎ) / 未収束なら reset (コールド)
    if (mmWorker) {
      try {
        mmWorker.postMessage({ type: warmupValid ? 'softReset' : 'reset' });
      } catch (e) {
        /* noop - intentionally empty */
      }
    }
  }

  // ─── 代行一時停止 ───
  function stop() {
    state.running = false;
    if (state.last_resume_time !== null) {
      state.elapsed_accumulated_sec += Date.now() - state.last_resume_time;
      state.last_resume_time = null;
    }
    // ★latch: 一時停止 / 確定 (= 支払タイミング) で display を実距離に一致させる。
    _latchDisplay();
  }

  // ─── 業務終了 ───
  function businessEnd() {
    state.running = false;
    if (state.last_resume_time !== null) {
      state.elapsed_accumulated_sec += Date.now() - state.last_resume_time;
      state.last_resume_time = null;
    }
    state.business_active = false;
    _fareConfigFrozen = false;
    // ★latch: 業務終了 (= 支払タイミング) で display / business_display を実距離に一致させる。
    _latchDisplay();
    if (mmWorker) {
      try {
        mmWorker.postMessage({ type: 'reset' });
      } catch (e) {
        /* noop - intentionally empty */
      }
    }
    if (typeof FB !== 'undefined' && typeof FB.pushSessionAggregates === 'function') {
      try {
        FB.pushSessionAggregates();
      } catch (_) {
        /* noop - intentionally empty */
      }
    }
  }

  // ─── 代行中断 (空車・trip 単位 reset) ───
  function reset() {
    stop();
    const prevBusinessDist = (state && state.business_distance_m) || 0;
    const prevBusinessActive = !!(state && state.business_active);
    const prevBusinessDisplay = (state && state.business_display_distance_m) || prevBusinessDist;
    state = {
      running: false,
      distance_m: 0,
      distanceSource: 'pipeline',
      fare_yen: 0,
      elapsed_sec: 0,
      elapsed_accumulated_sec: 0,
      last_resume_time: null,
      business_active: prevBusinessActive,
      business_distance_m: prevBusinessDist,
      start_time: null,
      last_gps: null,
      last_timestamp: null,
      last_speed_kmh: 0,
      last_isStationary: false,
      display_distance_m: 0,
      last_display_update_time: null,
      _prev_target_distance_m: 0,
      _prev_target_time: null,
      _target_velocity_mps: 0,
      business_display_distance_m: prevBusinessDisplay,
      last_business_display_update_time: null,
      _prev_business_target_distance_m: prevBusinessDisplay,
      _prev_business_target_time: null,
      _business_target_velocity_mps: 0,
      wait_sec: 0,
      tier2_pending_m: 0,
      business_tier2_pending_m: (state && state.business_tier2_pending_m) || 0,
      gps_predictive_distance_m: 0,
      mm_distance_m: 0,
      mm_snap_count: 0,
      mm_total_count: 0,
      mm_skip_count: 0,
      offroad_distance_m: 0,
      offroad_count: 0,
      gap_fill_count: 0,
      gap_fill_total_m: 0,
    };
    lastMmUsefulAt = 0;
    // trip reset では softReset (= lastCommittedSnap / prevSnap のみクリア・窓は維持)。
    if (mmWorker) {
      try {
        mmWorker.postMessage({ type: 'softReset' });
      } catch (e) {
        /* noop - intentionally empty */
      }
    }
    // warmup GPS もクリア (= 次回代行開始時の距離爆発防止)。
    lastWarmupGps = null;
  }

  // ─── 代行再開 ───
  function resume() {
    if (state.running) return;
    state.running = true;
    state.last_resume_time = Date.now();
  }

  // ─── GPS 1 step 処理 ───
  //   距離計算は Worker B (pipeline-distance) が行う。meter は GPS を Worker B に転送し、
  //   待機時間累積と last_gps 保持を行う。距離 distance_m への加算は _onMmWorkerMessage
  //   (= pipelineDeltaM 受信) でのみ起きる。
  function update(gpsResult) {
    // ★isStationary 早期 return: 停車中は距離を一切動かさない (= creep 防止・絶対)。
    //   停車中でも Worker B にハートビートを送り Viterbi の時間進行 commit 機会を作る。
    if (gpsResult.isStationary) {
      _updateMapMatching(gpsResult);
      return;
    }

    // 待機時間累積 (fareConfig v2): 速度 < 3km/h かつ running で wait_sec を増加。
    if (state.running && state.last_timestamp) {
      const dtSec2 = (gpsResult.timestamp - state.last_timestamp) / 1000;
      if (dtSec2 > 0 && dtSec2 < 60 && (gpsResult.speedKmh || 0) < 3) {
        state.wait_sec += dtSec2;
      }
    }

    // ★gap補完 (GNSS空白・国交省認定メーター方式の「速度補完」) ★:
    //   Worker B(pipeline engine)が居れば gap 区間は engine が道なり routing で計上するため不要。
    //   ★Worker B 不在時のみ★ (= worker 起動前/importScripts失敗/E2E等) speed×時間 で距離を補完し
    //   トンネル/worker欠落時の課金欠損を防ぐ。GPS直線でなく速度×時間 (= 認定メーター準拠)。
    //   dt は GAP_FILL_THRESHOLD_SEC〜GAP_FILL_MAX_SEC・速度は物理上限 GAP_FILL_MAX_KMH に clamp。
    //   engine 経路 (pipelineDeltaM) とは Worker B 有無で排他のため二重計上しない。
    if (
      state.running &&
      state.last_timestamp &&
      !(mmWorker && _workerLoadedPrefs.size > 0) &&
      (gpsResult.speedKmh || 0) > 0
    ) {
      const gapSec = (gpsResult.timestamp - state.last_timestamp) / 1000;
      const roadsLoading = !!mmWorker && _workerLoadedPrefs.size === 0;
      const minGapSec = roadsLoading ? 0 : GAP_FILL_THRESHOLD_SEC;
      if (gapSec >= minGapSec && gapSec < GAP_FILL_MAX_SEC) {
        const spdKmh = Math.min(gpsResult.speedKmh, GAP_FILL_MAX_KMH);
        const gapM = (spdKmh / 3.6) * gapSec;
        if (gapM > 0) {
          // ★k 校正の穴を塞ぐ★: Worker B 不在 (E2E/startup/loadfill) でも同一 _activeVehicleK を適用。
          //   gap_fill_total_m (stat) は RAW 維持。
          const gapCal = gapM * _activeVehicleK;
          state.distance_m += gapCal;
          state.fare_yen = calcFare(state.distance_m);
          state.distanceSource = roadsLoading ? 'loadfill' : 'gap';
          state.gap_fill_count = (state.gap_fill_count || 0) + 1;
          state.gap_fill_total_m = (state.gap_fill_total_m || 0) + gapM;
          if (state.business_active) {
            state.business_distance_m = (state.business_distance_m || 0) + gapCal;
          }
        }
      }
    }

    // last_gps 保持 (= 復元 / heading 表示用・距離計算には使わない)。
    state.last_gps = {
      lat: gpsResult.lat,
      lng: gpsResult.lng,
      accuracy: gpsResult.accuracy,
      altitude: gpsResult.altitude,
      compassHeading: gpsResult.compassHeading || null,
    };
    state.last_timestamp = gpsResult.timestamp;
    state.last_speed_kmh = gpsResult.speedKmh || 0;
    state.last_isStationary = gpsResult.isStationary === true;

    // Phase 2.A 訓練データ収集 (位置情報は送られない・将来 AI 推論基盤)。
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

    // ★計器: engine 実動値を ~1Hz で console 出力 (実機検証用・課金非関与・state read のみ)。
    if (typeof dlog === 'function') {
      const _t = gpsResult.timestamp || 0;
      if (!_lastEngineLogT || _t - _lastEngineLogT >= 1000) {
        _lastEngineLogT = _t;
        dlog(
          '[ENGINE] dm=' +
            (state.distance_m || 0).toFixed(1) +
            ' src=' +
            state.distanceSource +
            ' biz=' +
            (state.business_distance_m || 0).toFixed(1) +
            ' disp=' +
            (state.display_distance_m || 0).toFixed(1) +
            ' spd=' +
            (gpsResult.speedKmh || 0).toFixed(1) +
            ' run=' +
            state.running +
            ' bizActive=' +
            state.business_active
        );
      }
    }

    // Worker B に GPS 転送 (= pipeline tracker ingest → pipelineDeltaM 返却)。
    _updateMapMatching(gpsResult);
  }

  // ─── Worker B に GPS を転送 ───
  function _updateMapMatching(gpsResult) {
    if (!MM_ENABLED) return;
    if (gpsResult.isStationary) {
      // 停車中も heartbeat を送り isStationary=true を伝える (= Worker B が delta=0 を返す)。
      if (mmWorker && _workerLoadedPrefs.size > 0) {
        try {
          mmWorker.postMessage({
            type: 'gps',
            lat: gpsResult.lat,
            lng: gpsResult.lng,
            timestamp: gpsResult.timestamp,
            accuracy: gpsResult.accuracy,
            speedKmh: gpsResult.speedKmh,
            speedSrc: gpsResult.speedSrc || null, // ★speedSrc 貫通 (2026-06-07): 'dop'/'hav'
            headingDeg: gpsResult.compassHeading != null ? gpsResult.compassHeading : null,
            altitude: typeof gpsResult.altitude === 'number' ? gpsResult.altitude : null,
            isStationary: true,
          });
        } catch (e) {
          if (typeof dlog === 'function') dlog('[MM] worker post error: ' + e.message);
        }
      }
      return;
    }
    if (typeof gpsResult.lat !== 'number' || typeof gpsResult.lng !== 'number') return;
    if (mmWorker && _workerLoadedPrefs.size > 0) {
      state.mm_total_count++;
      try {
        mmWorker.postMessage({
          type: 'gps',
          lat: gpsResult.lat,
          lng: gpsResult.lng,
          timestamp: gpsResult.timestamp,
          accuracy: gpsResult.accuracy,
          speedKmh: gpsResult.speedKmh,
          speedSrc: gpsResult.speedSrc || null, // ★speedSrc 貫通 (2026-06-07): 'dop'/'hav'/'obd'/'coast'
          isSynthetic: gpsResult.isSynthetic === true, // ★タイマー穴埋め合成点 (2026-06-10): 平滑バイパス印
          headingDeg: gpsResult.compassHeading != null ? gpsResult.compassHeading : null,
          altitude: typeof gpsResult.altitude === 'number' ? gpsResult.altitude : null,
          isStationary: gpsResult.isStationary === true,
        });
      } catch (e) {
        if (typeof dlog === 'function') dlog('[MM] worker post error: ' + e.message);
      }
    }
    // Worker B 不在時は何もしない (= GPS 直線課金は絶対不可・距離据え置き)。
  }

  // ─── calcFare (★1 byte もじらず移植★・v2 多段階パイプライン) ───
  //   Step 1 距離料金 (tiers 優先・旧 base+add fallback)
  //   Step 2 vehicle 倍率 + addon / Step 3 手動 surcharges 乗算
  //   Step 4 autoSurcharges 乗算 / Step 5 wait 料金 / Step 6 clamp / Step 7 丸め
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
    // weekend: 土日固定
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

  // ─── fareConfig v2 surcharge / vehicle 公開 API ───
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

  // ─── 表示用 catch-up ヘルパ (= 距離値 1 byte 不変の表示専用 layer) ───
  //   ★等速ペース catch-up★ (2026-05-30・「止まって動いて」脈動の根治):
  //   target = 実距離値 (distance_m)。display は前回値から target へ「下から」★一定速度★で詰める。
  //   ・rate = 直近の target 増分速度 (= target増分/target間dt) を EMA 平滑したもの (m/s)。
  //     1Hz GPS なら rate ≈ 実走行速度。これで display を等速に進めるので「動いて→止まって」が消える。
  //   ・毎フレーム: display += min(gap, rate*dt_frame)。dt_frame = 直前 display 更新からの経過秒。
  //     min(gap,…) clamp で ★display は target を絶対に超えない (overshoot ゼロ)★。
  //   ・gap ≤ 0 (= target に追いついた/停車で target 不進) は据え置き (= 不動・単調非減少・creep 0)。
  //   ・true-stop (target 進まない) → 新規増分 0 → EMA で rate→0 → display 不動 (phantom 0)。
  //   ・fps 非依存 (dt_frame ベース)。latch は呼出側 _latchDisplay で維持。
  //   velRef: { v(=rate EMA m/s), prevTarget(=最後に観測した target), prevTargetTime(=その時刻) }。
  //   lastDisplayTime: 直前にこの display を更新した時刻 (= per-frame dt の基準・null 可)。
  function _smoothDisplay(target, prevDisplay, lastDisplayTime, velRef, now) {
    const tgt = target > 0 ? target : 0;
    let display = prevDisplay > 0 ? prevDisplay : 0;

    // ── rate (EMA) 更新: target が新しい値に増えた fix のたびに瞬時レートを取り込む ──
    const prevTarget = typeof velRef.prevTarget === 'number' ? velRef.prevTarget : tgt;
    const prevTargetTime = velRef.prevTargetTime;
    if (tgt > prevTarget + 1e-9) {
      // target が増えた = 新 fix 到着。瞬時レート = 増分 / 経過秒 (= 速度近似)。
      const dtTarget = prevTargetTime !== null ? (now - prevTargetTime) / 1000 : 0;
      if (dtTarget > 1e-3) {
        let inst = (tgt - prevTarget) / dtTarget; // m/s
        // 物理上限 clamp: cold-start (start 直後の極小 dt) や GPS glitch の spike を EMA から除外。
        if (inst > DISP_RATE_MAX_MPS) inst = DISP_RATE_MAX_MPS;
        const prevRate = typeof velRef.v === 'number' && velRef.v > 0 ? velRef.v : inst;
        velRef.v = DISP_RATE_EMA_ALPHA * inst + (1 - DISP_RATE_EMA_ALPHA) * prevRate;
      }
      velRef.prevTarget = tgt;
      velRef.prevTargetTime = now;
    } else if (prevTargetTime === null) {
      // 初観測 (= latch/setDistance 直後の時刻基準確立)。レートは据え置き、時刻だけ刻む。
      velRef.prevTarget = tgt;
      velRef.prevTargetTime = now;
    }

    // 防御的 clamp: display が target を超える事は設計上起きないが万一あれば即 target に揃える。
    if (display >= tgt) {
      if (display > tgt) display = tgt;
      return display;
    }

    // ── 等速で gap を詰める ──
    let dtFrame = lastDisplayTime !== null ? (now - lastDisplayTime) / 1000 : 0;
    if (!(dtFrame > 0)) {
      // 時間未経過 (= 同一 tick 再読) は据え置き (= overshoot しない・単調維持)。
      return display;
    }
    // ★1 フレーム上限 (frame clamp)★: タブ復帰/描画間引きで dtFrame が巨大化 (例 30s) した時の
    //   一撃飛びを防ぐ。dtFrame そのものを上限で頭打ちにし、残り gap は次フレーム以降で連続収束。
    //   通常の GPS cadence (1〜5s poll) はこの上限以内なので不変。
    if (dtFrame > DISP_MAX_FRAME_DT_S) dtFrame = DISP_MAX_FRAME_DT_S;
    const gap = tgt - display;
    const rate = typeof velRef.v === 'number' && velRef.v > 0 ? velRef.v : 0;
    // ★gap 収束 spring (1 項)★: rate (実速度ペース) を主とし、gap が残る時のみ gap/τ で下から
    //   詰める。定速走行時は gap が 1 フレーム分しか無いので寄与が小さく等速ペースを維持。
    //   lump/穴復帰/停車前減速窓では spring が効いて永続 deficit を τ 秒で解消する
    //   (= 停車時残差 0・収束残差 0)。山 (cap/gain/bleed) は作らない。
    const closeRate = gap / DISP_CLOSE_TAU_S;
    let eff = rate + closeRate; // 実速度ペース + gap 収束 spring (= 永続 lag を残さず target に収束)
    // ★追従速度上限★: 大 lump 復帰 (穴明け一括加算) を 55m/s 張り付きの「ドン」でなく
    //   直近走行速度の妥当倍率内で飲む。定速/停車では eff がこの上限を下回るため不発。
    if (eff > DISP_CATCHUP_MAX_MPS) eff = DISP_CATCHUP_MAX_MPS;
    let step = eff * dtFrame; // 等速ペース前進量
    if (!(step > 0)) {
      // rate 未確立 (= 最初の数 fix) で gap が残る場合のみ、収束保証のため
      //   残差が極小なら着地。そうでなければ据え置き (= 次 fix で rate 確立後に等速で詰める)。
      if (gap < DISP_LATCH_GAP_M) return tgt;
      return display;
    }
    if (step > gap) step = gap; // ★overshoot ゼロ★: target を超えない
    let next = display + step;
    // 残差が極小なら target に着地 (= 乖離放置せず収束させる)。
    if (tgt - next < DISP_LATCH_GAP_M) next = tgt;
    // ★絶対不変条件★: display ≤ target (overshoot ゼロ) かつ 単調非減少。
    if (next > tgt) next = tgt;
    if (next < display) next = display;
    return next;
  }

  // ─── latch: display を実距離 (target) に即一致させる (= 支払タイミング契約) ───
  //   stop (一時停止 / 確定) / businessEnd (業務終了) で呼ぶ。これにより
  //   メーター(display) = 実距離(distance_m) = 料金(calcFare(display)) が一致する。
  function _latchDisplay() {
    const d = state.distance_m || 0;
    state.display_distance_m = d;
    state._prev_target_distance_m = d;
    state._prev_target_time = null;
    state._target_velocity_mps = 0;
    const b = state.business_distance_m || 0;
    state.business_display_distance_m = b;
    state._prev_business_target_distance_m = b;
    state._prev_business_target_time = null;
    state._business_target_velocity_mps = 0;
  }

  // ─── getState ───
  function getState() {
    // elapsed_sec は都度計算 (= 累積 + 直近 resume 経過・setInterval 全廃)。
    const elapsedSec =
      state.running && state.last_resume_time !== null
        ? Math.floor((state.elapsed_accumulated_sec + (Date.now() - state.last_resume_time)) / 1000)
        : Math.floor((state.elapsed_accumulated_sec || 0) / 1000);

    const now = Date.now();
    // 課金 display: distance_m を 10m 滑らかに先取り表示 (= 実距離値は不変)。
    const target = state.distance_m || 0;
    const velRef = {
      v: state._target_velocity_mps,
      prevTarget: state._prev_target_distance_m,
      prevTargetTime: state._prev_target_time,
    };
    const display = _smoothDisplay(
      target,
      state.display_distance_m,
      state.last_display_update_time,
      velRef,
      now
    );
    state._target_velocity_mps = velRef.v;
    state._prev_target_distance_m = velRef.prevTarget;
    state._prev_target_time = velRef.prevTargetTime;
    state.display_distance_m = display;
    state.last_display_update_time = now;

    // 業務 display: business_distance_m を滑らか追従 (= 別回路・実距離値は不変)。
    const btarget = state.business_distance_m || 0;
    const bvelRef = {
      v: state._business_target_velocity_mps,
      prevTarget: state._prev_business_target_distance_m,
      prevTargetTime: state._prev_business_target_time,
    };
    const bdisplay = _smoothDisplay(
      btarget,
      state.business_display_distance_m,
      state.last_business_display_update_time,
      bvelRef,
      now
    );
    state._business_target_velocity_mps = bvelRef.v;
    state._prev_business_target_distance_m = bvelRef.prevTarget;
    state._prev_business_target_time = bvelRef.prevTargetTime;
    state.business_display_distance_m = bdisplay;
    state.last_business_display_update_time = now;

    return { ...state, elapsed_sec: elapsedSec };
  }

  // ─── getMMStats ───
  function getMMStats() {
    const total = state.mm_total_count;
    const snap = state.mm_snap_count;
    const skip = state.mm_skip_count;
    return {
      total_count: total,
      snap_count: snap,
      skip_count: skip,
      snap_rate: total > 0 ? snap / total : 0,
      skip_rate: total > 0 ? skip / total : 0,
      mm_distance_m: state.mm_distance_m,
      distance_m: state.distance_m,
      distance_source: state.distanceSource,
      mm_silent_ms: lastMmUsefulAt > 0 ? Date.now() - lastMmUsefulAt : null,
      p99_latency_ms: _calcP99Latency(),
      latency_samples: _mmLatencyCount,
      avg_candidates: _mmCandCountSamples > 0 ? _mmCandCountSum / _mmCandCountSamples : 0,
      worker_active: !!mmWorker,
      mcm_window_size: _lastMcmN,
    };
  }

  // ─── 復元 / 外部設定 API ───
  function setDistance(distanceM) {
    const v = Number.isFinite(distanceM) && distanceM >= 0 ? distanceM : 0;
    state.distance_m = v;
    state.fare_yen = calcFare(v);
    // ★overshoot ゼロ★: display は target(v) を超えない (= min clamp)。target が上がっても
    //   display は getState の catch-up で「下から」追いつく (= 先取りしない)。
    //   復元 (= 確定済み実距離) で即一致させたい場合は呼出側で Meter.latchDisplay() を使う。
    if ((state.display_distance_m || 0) > v) state.display_distance_m = v;
    // ★等速ペース化★: _prev_target_* / _target_velocity_mps は _smoothDisplay が所有する
    //   (= fix 間の増分でレートを測るため setDistance では clobber しない)。overshoot は
    //   getState 内 min(gap, rate*dt) clamp で保証。即一致が要る復元は latchDisplay() を使う。
  }
  function setBusinessDistance(m) {
    const bv = typeof m === 'number' && m >= 0 ? m : 0;
    state.business_distance_m = bv;
    // ★設計変更宣言 (2026-06-04・表示復元 latch): setBusinessDistance は prime/復元/業務開始の
    //   ★authoritative な設定★ (= 通常の GPS 累積は本 API を通らず ingest で内部加算)。よって業務
    //   display を即 bv に latch する。
    //   旧: display を bv で下クランプのみ (上には latch せず getState catch-up に委ねた) →
    //       タスクキル復元等で business_distance_m=bv に prime されても business_display_distance_m=0 のままで、
    //       getReport が business_display>0 になった瞬間 (catch-up 開始) に生 bv 表示から平滑小値へ切替わり
    //       ★総走行が 0 にガクッと落ちて少しずつ bv へ這い上がる★表示バグになっていた。
    //   新: prime 時に display=bv へ即 latch (= _latchDisplay の business 部と同等) → 復元/復帰で
    //       即正値表示・0 への落ち込み無し。★raw business_distance_m / business_tier2_pending_m /
    //       課金 / distance_m は 1 byte 不変・表示専用 latch★。業務開始(bv=0)では display=0 で従来同等。
    state.business_display_distance_m = bv;
    state._prev_business_target_distance_m = bv;
    state._prev_business_target_time = null;
    state._business_target_velocity_mps = 0;
  }
  // ★随伴車別 k 学習★ (業務終了後・認定メーター読みで器差を更新):
  //   sample = _activeVehicleK × (cert / business_distance_m) = cert / raw (★複利安全★・
  //     現kで校正済の業務距離でも sample は生距離比に一致)。
  //   外れ値拒否: D<1000m (短業務/GPS脱落) ・|sample/kActive−1|>0.05 (1業務で5%超急変)。
  //   保守 EWMA: k_new = 0.3×sample + 0.7×prevK (1業務が支配しない)。clamp [VK_MIN, VK_MAX]。
  //   過大ゼロ: cert は検定上タイヤ真値以下 → k適用後距離 ≤ cert ≤ 真値。VK_MAX が上げ硬天井。
  //   ★業務別のみ★: D = 1業務 (代行開始→精算終了) の business_distance_m (businessEnd で0化されない)。
  function calibrateVehicleK(certMeterMeters) {
    if (
      !(typeof certMeterMeters === 'number' && isFinite(certMeterMeters) && certMeterMeters > 0)
    ) {
      return { ok: false, reason: 'invalid_cert', k: _resolveVK() };
    }
    const D = (state && state.business_distance_m) || 0;
    if (D < 1000) {
      return { ok: false, reason: 'business_too_short', k: _resolveVK() };
    }
    const kActive = _activeVehicleK > 0 ? _activeVehicleK : 1.0;
    const sample = kActive * (certMeterMeters / D); // = cert / raw (複利安全)
    if (Math.abs(sample / kActive - 1) > 0.05) {
      return { ok: false, reason: 'outlier_jump', k: _resolveVK() };
    }
    const prevK = _resolveVK();
    const kNew = _clampVK(0.3 * sample + 0.7 * prevK);
    // 永続化 (window.DK_VEHICLE_PROFILE + dk_veh_active / dk_veh_<VIN>・他フィールド保全)
    try {
      if (typeof window !== 'undefined') {
        if (!window.DK_VEHICLE_PROFILE) window.DK_VEHICLE_PROFILE = {};
        window.DK_VEHICLE_PROFILE.k = kNew;
        window.DK_VEHICLE_PROFILE.k_samples = (window.DK_VEHICLE_PROFILE.k_samples || 0) + 1;
        window.DK_VEHICLE_PROFILE.k_last_cert_m = certMeterMeters;
        window.DK_VEHICLE_PROFILE.k_last_business_m = D;
        if (typeof localStorage !== 'undefined') {
          const json = JSON.stringify(window.DK_VEHICLE_PROFILE);
          localStorage.setItem('dk_veh_active', json);
          if (window.DK_VEHICLE_PROFILE.vin) {
            localStorage.setItem('dk_veh_' + window.DK_VEHICLE_PROFILE.vin, json);
          }
        }
      }
    } catch (_) {
      /* persistence best-effort・課金距離には影響しない */
    }
    return {
      ok: true,
      k: kNew,
      sample: sample,
      sampleCount:
        (typeof window !== 'undefined' &&
          window.DK_VEHICLE_PROFILE &&
          window.DK_VEHICLE_PROFILE.k_samples) ||
        1,
      reason: 'updated',
    };
  }

  function setBusinessActive(active) {
    // ★k 業務別ロック★: 代行開始 (false→true) の瞬間に随伴車 k を確定し業務全体で固定。
    //   業務途中の profile 編集を無視 = 過大の途中混入を防止。
    //   ★多区間業務 (stop→resume) の再 true でも k は再解決されるが、profile.k は
    //     較正 (精算後 calibrateVehicleK) でしか変わらない=1業務中は値不変 → 実効的に 1業務=1k。
    //     かつ常に _clampVK で ≤VK_MAX のため never-over は再ロックでも不変 (監査確認済 2026-06-09)。
    if (!!active && !state.business_active) {
      _activeVehicleK = _clampVK(_resolveVK());
    }
    state.business_active = !!active;
  }
  function setLastGps(lat, lng, altitude, speedKmh, timestamp) {
    state.last_gps = { lat, lng, altitude };
    state.last_timestamp = timestamp;
    state.last_speed_kmh = speedKmh || 0;
  }
  function setElapsedAccumulated(savedSec) {
    const v = typeof savedSec === 'number' && savedSec >= 0 ? savedSec : 0;
    state.elapsed_accumulated_sec = v;
    state.last_resume_time = Date.now();
  }

  // ─── warm up: 代行開始前から GPS を保持 (state には触らない) ───
  function updateGpsOnly(gpsResult) {
    if (!gpsResult || typeof gpsResult.lat !== 'number' || typeof gpsResult.lng !== 'number')
      return;
    lastWarmupGps = {
      lat: gpsResult.lat,
      lng: gpsResult.lng,
      accuracy: gpsResult.accuracy,
      altitude: gpsResult.altitude || 0,
      compassHeading: gpsResult.compassHeading || null,
      timestamp: gpsResult.timestamp || Date.now(),
      speedKmh: gpsResult.speedKmh || 0,
    };
  }

  // ─── 業務開始時 warmup GPS prime (= 待機中初回 GPS からラグ最小で計測開始) ───
  function primeFromWarmup() {
    const now = Date.now();
    const WARMUP_MAX_AGE_MS = 5000;
    const warmupValid =
      lastWarmupGps && lastWarmupGps.timestamp && now - lastWarmupGps.timestamp < WARMUP_MAX_AGE_MS;
    if (!warmupValid) return false;
    state.last_gps = {
      lat: lastWarmupGps.lat,
      lng: lastWarmupGps.lng,
      accuracy: lastWarmupGps.accuracy,
      altitude: lastWarmupGps.altitude,
      compassHeading: lastWarmupGps.compassHeading || null,
    };
    state.last_timestamp = lastWarmupGps.timestamp;
    state.last_speed_kmh = lastWarmupGps.speedKmh || 0;
    return true;
  }

  // ============================================================
  // 住所検索 (= 表示専用・距離 / 課金 / Worker B とは無関係) ───
  //   県別 fine → 全国 fine (後方互換) → coarse 付近 の 4 段フォールバック。
  // ============================================================
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
  function _jisToPref(jis) {
    if (typeof jis !== 'string' && typeof jis !== 'number') return null;
    const key = String(jis);
    return _JIS_TO_PREF[key] || _JIS_TO_PREF[Number(key)] || null;
  }
  function _getFineBundleForPref(pref) {
    if (typeof window === 'undefined') return null;
    const upper = pref.toUpperCase().replace(/-/g, '_');
    const bundle = window['ADDRESSES_FINE_' + upper];
    if (bundle && Array.isArray(bundle.items)) return bundle;
    return null;
  }
  function _searchFineItems(items, lat, lng, targetLatI, targetLngI) {
    const COORD_SCALE = 100000;
    const FINE_RADIUS_M = 500;
    const fineRangeI = 520;
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
    const COORD_SCALE = 100000;
    const targetLatI = Math.round(lat * COORD_SCALE);
    const targetLngI = Math.round(lng * COORD_SCALE);
    const COARSE_RADIUS_M = 25000;
    const coarseRangeI = 25000;

    // ① coarse から最近傍 (~25km 内) を引いて県コードを取得
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
    let prefName = null;
    if (bestCoarse && typeof bestCoarse.c === 'string' && bestCoarse.c.length >= 2) {
      prefName = _jisToPref(bestCoarse.c.substring(0, 2));
    }

    // ② 該当県の fine が load 済なら fine 検索 (~500m 内)
    if (prefName) {
      const bundle = _getFineBundleForPref(prefName);
      if (bundle) {
        const best = _searchFineItems(bundle.items, lat, lng, targetLatI, targetLngI);
        if (best) return best.n;
      }
    }

    // ③ 後方互換: 全国版 ADDRESSES_FINE_JP が load 済ならそれも検索
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

    // ④ fine miss / fine 未 load → coarse 結果 (市区町村 + 付近)
    if (bestCoarse) return bestCoarse.n + ' 付近';

    return null;
  }
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

  // ─── 公開 API (= 公開 28 メソッド + テスト escape hatch 2 = 30 プロパティ・signature 完全維持) ───
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
    getNearestAddress,
    isAddressDataReady,
    setDistance,
    setLastGps,
    setMapMatcher,
    isMmReady,
    setBusinessDistance,
    setBusinessActive,
    calibrateVehicleK,
    setSurchargeActive,
    toggleSurcharge,
    getActiveSurcharges,
    getSurchargeMultiplier,
    setVehicleType,
    getVehicleType,
    latchDisplay: _latchDisplay,
    // ★テスト用 escape hatch (prod からは呼ばない)
    _setDrainMmUntil: function (t) {
      _drainMmUntil = typeof t === 'number' ? t : 0;
    },
    _setOffRoadGraceUntil: function (t) {
      _offRoadGraceUntil = typeof t === 'number' ? t : 0;
    },
  };
})();

// Node test context: require('./meter.js') で Meter API オブジェクトを取得可能。
// browser / Worker context: module 未定義のため no-op。
// eslint-disable-next-line no-undef -- node 環境のみ・typeof guard で browser/Worker は no-op
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') module.exports = Meter;
