// 距離累積・料金計算
// 2026-05-09 設計変更: MM 優先 + GPS fallback (5s silent threshold)
//   旧: state.distance_m = GPS 直線+×1.3 補正 / MM は参照のみ
//   新: state.distance_m = MM 道路距離 (primary) / MM silent 5s+ で GPS 直線 (fallback)
//   業務継続性は維持: MM Worker dead でも GPS 経路で課金が動く
const Meter = (() => {
  let state = {
    running: false,
    distance_m: 0,
    distanceSource: 'gps',    // 'mm' | 'gps' | 'gap' | 'inline' | 'offroad' 直近で distance_m を更新したソース
    fare_yen: 0,
    elapsed_sec: 0,
    start_time: null,
    last_gps: null,
    last_timestamp: null,
    last_speed_kmh: 0,    // GPS消失時の補完用
    gap_fill_count: 0,    // GPS消失補完回数（サマリー表示用）
    gap_fill_total_m: 0,  // GPS消失補完合計距離
    // ─── Map Matching（2026/04/30追加・既存distance_mとは独立） ───
    mm_distance_m: 0,         // Map Matching距離（道路にsnapした実距離・参照値）
    mm_snap_count: 0,         // snap成功回数（精度評価用）
    mm_total_count: 0,        // update呼び出し回数（snap成功率算出用）
    mm_skip_count: 0,         // 異常値でスキップした回数
    // ─── Phase 1.C Off-Road Mode (2026-05-10 追加) ───
    offroad_distance_m: 0,    // Off-Road Mode で加算した距離 (参照値)
    offroad_count: 0,         // Off-Road Mode 起動回数
    // ─── 待機料金 (fareConfig v2・2026-05-10 追加) ───
    wait_sec: 0,              // 累積待機時間 (秒・速度<3km/h で加算)
  };

  // MM 優先設計 (2026-05-09):
  //   _onMmWorkerMessage が mmIncrementM>0 を受信した時刻
  //   (now - lastMmUsefulAt) > MM_SILENT_THRESHOLD_MS で MM "silent" と判定し
  //   GPS 直線距離を fallback として state.distance_m に加算する
  let lastMmUsefulAt = 0;
  const MM_SILENT_THRESHOLD_MS = 2500;   // A2 (2026-05-09): 5000→2500 短縮で fallback 早期化

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
  let _haverAccumSinceLastCommit = 0;   // 直近 commit からの haversine 累積 (retroactive 用)
  const OFFROAD_SNAP_MISS_THRESHOLD = 5;
  const OFFROAD_ABS_MAX_KMH = 160;      // 物理上限

  // Map Matching の内部状態（state とは別・stateはユーザー向け値のみ）
  // MM-1 (2026-05-08): Worker 経路使用時は prevSnap は Worker 内で保持し
  //   こちらは fallback（Worker 起動失敗時）でのみ使用される
  let prevSnap = null;

  // MM-1: Worker B 参照（index.html から setMapMatcher で注入）
  //   null の場合は既存インラインロジックにフォールバック
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

  function _recordMmLatency(ms){
    if(typeof ms !== 'number' || !isFinite(ms) || ms < 0) return;
    _mmLatencyBuf[_mmLatencyIdx] = ms;
    _mmLatencyIdx = (_mmLatencyIdx + 1) % _MM_LATENCY_BUFFER_SIZE;
    if(_mmLatencyCount < _MM_LATENCY_BUFFER_SIZE) _mmLatencyCount++;
  }

  function _calcP99Latency(){
    if(_mmLatencyCount === 0) return 0;
    const arr = new Array(_mmLatencyCount);
    for(let i = 0; i < _mmLatencyCount; i++) arr[i] = _mmLatencyBuf[i];
    arr.sort(function(a, b){ return a - b; });
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
      night:    { enabled: false, from: 22, to: 5, rate: 1.2 },
      weekend:  { enabled: false, rate: 1.1 },
      winter:   { enabled: false, from: '12-15', to: '03-15', rate: 1.1 },
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
    0: 120, 1: 100, 2: 80, 3: 70, 4: 60,
    5: 50, 6: 40, 7: 80, 8: 80, 9: 70, 10: 60, 11: 50, 12: 30
  };
  function _maxSpeedFor(typeCode){
    if(typeCode == null) return 100;
    const v = ROAD_MAX_KMH_BY_TYPE[typeCode];
    return v != null ? v : 80;
  }
  let _lastSnapTypeCode = null;

  // GPS消失補完の閾値
  const GAP_THRESHOLD_SEC = 5;        // 5秒以上の空白＝GPS消失
  const GAP_MAX_SEC = 600;            // 最大10分（それ以上は異常）
  const NEAR_INFRA_RADIUS_M = 200;    // 200m以内のトンネル/橋を「該当」と判定

  // Map Matching 設定（2026/04/30追加）
  const MM_ENABLED = true;            // Map Matching ON/OFF
  const MM_MAX_SNAP_DIST_M = 50;      // snap 許容距離（道路から離れすぎたら snap しない）
  const MM_MAX_SEGMENT_DIST_M = 1000; // 1更新で 1km 超えは異常値（GPSジャンプ等）
  const MM_GAP_RESET_SEC = 5;         // 5秒以上空白で prevSnap リセット（連続性失う）

  let timer = null;

  // F6 (2026-05-09): 業務中の fareConfig 変更を抑制
  //   業務開始時に凍結・業務終了/idle で解凍
  //   Firebase 側の非同期更新が走行中に降ってきても fare 計算には反映しない
  //   (途中でメーターが急変するのを防ぐ)
  let _fareConfigFrozen = false;
  function setFareConfig(config){
    if(_fareConfigFrozen){
      if(typeof dlog === 'function') dlog('[Meter] setFareConfig ignored (frozen during business)');
      return;
    }
    fareConfig = { ...fareConfig, ...config };
  }
  function getFareConfig(){ return { ...fareConfig }; }

  // ─── MM-1: Worker B 連携 ───────────────────────────────
  // B1 (2026-05-09): roadsLoaded ack を Set で track して MM ready 判定に使う
  let _workerLoadedPrefs = new Set();
  function setMapMatcher(worker){
    if(mmWorker){
      try { mmWorker.removeEventListener('message', _onMmWorkerMessage); } catch(e){}
    }
    mmWorker = worker || null;
    _workerLoadedPrefs = new Set();   // 新 Worker 起動で再カウント
    if(mmWorker){
      mmWorker.addEventListener('message', _onMmWorkerMessage);
    }
  }
  function isMmReady(){ return mmWorker && _workerLoadedPrefs.size > 0; }

  // MM-7: 最新 MM-7 統計を保持（mmResult から間接取得）
  let _lastMcmN = 0;

  // Phase 1.C Off-Road Mode ヘルパー
  //   通常時に GPS 連続点の haversine を累積する (= 直近 commit からの distance buffer)
  //   Off-Road 起動時に retroactive add するため事前に蓄積しておく
  function _trackHaversineBetweenGps(gpsResult, dtSec){
    if(_offRoadActive) return;       // off-road 中は incremental add で別経路
    if(!state.last_gps) return;
    if(gpsResult.isStationary) return;
    if(gpsResult.accuracy != null && gpsResult.accuracy > 50) return;
    if(state.last_gps.accuracy != null && state.last_gps.accuracy > 50) return;
    if(dtSec <= 0 || dtSec > 60) return;
    const d = GPS.calcDistance(state.last_gps.lat, state.last_gps.lng, gpsResult.lat, gpsResult.lng);
    // 物理上限 sanity (160km/h × dtSec + 5m 余裕)
    const physMaxM = (OFFROAD_ABS_MAX_KMH / 3.6) * Math.max(1, dtSec) + 5;
    if(d > physMaxM) return;
    _haverAccumSinceLastCommit += d;
  }

  //   Off-Road 中に毎フレーム加算する 1 step distance
  //   Kalman 平滑化済 GPS 連続点の haversine = polyline 累積の 1 区間
  function _calculateOffRoadIncrement(gpsResult, dtSec){
    if(!state.last_gps) return 0;
    if(gpsResult.isStationary) return 0;
    if(gpsResult.accuracy != null && gpsResult.accuracy > 50) return 0;
    if(state.last_gps.accuracy != null && state.last_gps.accuracy > 50) return 0;
    if(dtSec <= 0 || dtSec > 60) return 0;
    const d = GPS.calcDistance(state.last_gps.lat, state.last_gps.lng, gpsResult.lat, gpsResult.lng);
    const physMaxM = (OFFROAD_ABS_MAX_KMH / 3.6) * Math.max(1, dtSec) + 5;
    if(d > physMaxM){
      if(typeof dlog === 'function') dlog(`[Meter] Phase1.C off-road skip: ${d.toFixed(0)}m > phys max ${physMaxM.toFixed(0)}m`);
      return 0;
    }
    return d;
  }

  // Worker B からの mmResult を受けて state に反映するハンドラ
  // 2026-05-09: MM 優先設計に変更。mmIncrementM>0 を受信したら state.distance_m と
  //   fare_yen を直接更新する。業務継続性は update() 側 GPS fallback で担保。
  // 2026-05-10 (Phase 1.C): Off-Road Mode の入退場制御を追加
  function _onMmWorkerMessage(e){
    const m = e && e.data;
    if(!m) return;
    // B1 (2026-05-09): roadsLoaded ack を track
    if(m.type === 'roadsLoaded'){
      if(m.ok && m.pref) _workerLoadedPrefs.add(m.pref);
      return;
    }
    if(m.type !== 'mmResult') return;
    if(typeof m.mmIncrementM === 'number' && m.mmIncrementM > 0){
      if(_offRoadActive){
        // Phase 1.C: Off-Road でカバー済 → 二重課金防止のため Worker B mmIncrement を無視
        //   Worker B の lastCommittedSnap は古い (= off-road 突入前) 状態なので
        //   resetCommittedSnap で null 化し未来の commit を再起点化
        if(typeof dlog === 'function'){
          dlog(`[Meter] Phase1.C Off-Road 終了 (Worker B 復帰・mmIncrement ${m.mmIncrementM.toFixed(0)}m を二重課金回避のため無視)`);
        }
        _offRoadActive = false;
        _consecutiveSnapMiss = 0;
        _haverAccumSinceLastCommit = 0;
        if(mmWorker){
          try { mmWorker.postMessage({ type: 'resetCommittedSnap' }); } catch(_){}
        }
        // mmIncrement は加算しない・lastMmUsefulAt も更新しない (= mmHealthy false 維持)
      } else {
        // 通常: MM 優先で道路距離を課金距離に反映
        state.distance_m += m.mmIncrementM;
        state.fare_yen = calcFare(state.distance_m);
        state.distanceSource = 'mm';
        lastMmUsefulAt = Date.now();
        // 参照値も並行更新 (旧設計互換・stats 表示用)
        state.mm_distance_m += m.mmIncrementM;
        // Phase 1.C: 通常 commit が起きたので haversine 累積 buffer をリセット
        _haverAccumSinceLastCommit = 0;
      }
    }
    // Phase 1.C (2026-05-10): snap miss 連続検出 → Off-Road Mode 起動
    if(m.snapped){
      _consecutiveSnapMiss = 0;
    } else if(m.skipped || (typeof m.mmIncrementM === 'number' && m.mmIncrementM === 0 && !m.committed)){
      _consecutiveSnapMiss++;
      if(!_offRoadActive && _consecutiveSnapMiss >= OFFROAD_SNAP_MISS_THRESHOLD){
        _offRoadActive = true;
        state.offroad_count = (state.offroad_count || 0) + 1;
        // 直前 commit からの haversine 累積を retroactive で加算 (snap-miss 区間の課金漏れ防止)
        if(_haverAccumSinceLastCommit > 0){
          state.distance_m += _haverAccumSinceLastCommit;
          state.fare_yen = calcFare(state.distance_m);
          state.distanceSource = 'offroad';
          state.offroad_distance_m = (state.offroad_distance_m || 0) + _haverAccumSinceLastCommit;
          if(typeof dlog === 'function'){
            dlog(`[Meter] Phase1.C Off-Road 起動 (${_consecutiveSnapMiss} 連続 snap miss)・retroactive add ${_haverAccumSinceLastCommit.toFixed(0)}m`);
          }
          _haverAccumSinceLastCommit = 0;
        } else {
          if(typeof dlog === 'function') dlog(`[Meter] Phase1.C Off-Road 起動 (${_consecutiveSnapMiss} 連続 snap miss)`);
        }
        // Worker B に resetCommittedSnap を送り、off-road 中の commit を抑制
        if(mmWorker){
          try { mmWorker.postMessage({ type: 'resetCommittedSnap' }); } catch(_){}
        }
      }
    }
    // D4 (2026-05-09): 直近 snap の typeCode を記録 (gap fill 速度クランプ用)
    // T5 (2026-05-09): 同じ typeCode を gps-worker.js に伝達して Kalman Q を動的化
    //   - motorway/trunk: Q=1.5・residential/track: Q=4.0 等
    //   - typeCode 変化時のみ送信 (postMessage 過剰防止)
    if(m.snap && m.snap.typeCode != null){
      const newTypeCode = m.snap.typeCode;
      if(newTypeCode !== _lastSnapTypeCode){
        _lastSnapTypeCode = newTypeCode;
        if(typeof GPS !== 'undefined' && typeof GPS.setRoadType === 'function'){
          try { GPS.setRoadType(newTypeCode); } catch(_){}
        }
      }
    }
    // T8 (2026-05-09): commit が起きた road を Firebase 側 cross-user pheromone に集約
    //   重複防止は FB.markVisited (Set) 側でやる
    if(m.committed && m.snap && m.snap.prefecture && m.snap.roadIndex != null){
      if(typeof FB !== 'undefined' && typeof FB.markVisited === 'function'){
        try { FB.markVisited(m.snap.prefecture, m.snap.roadIndex); } catch(_){}
      }
    }
    if(m.snapped) state.mm_snap_count++;
    if(m.skipped){
      state.mm_skip_count++;
      if(typeof dlog === 'function' && m._reason){
        dlog('[MM] skip: ' + m._reason);
      }
    }
    // MM-2: 遅延・候補数の評価指標を蓄積
    if(typeof m.latencyMs === 'number') _recordMmLatency(m.latencyMs);
    if(typeof m.candidatesCount === 'number'){
      _mmCandCountSum += m.candidatesCount;
      _mmCandCountSamples++;
    }
    // MM-7: MCM 窓サイズの最新値
    if(typeof m.mcmN === 'number') _lastMcmN = m.mcmN;
  }

  function start(){
    const now = Date.now();
    // 起動時warm up：5秒以上前のlastWarmupGpsは使わない（過剰課金リスク回避・2026/05/01）
    // GPS止まった状態で移動→起動時に古い座標と現在地で距離爆発するのを防ぐ
    const WARMUP_MAX_AGE_MS = 5000;
    const warmupValid = lastWarmupGps &&
      lastWarmupGps.timestamp &&
      (now - lastWarmupGps.timestamp) < WARMUP_MAX_AGE_MS;
    state = {
      running: true,
      distance_m: 0,
      distanceSource: 'gps',
      fare_yen: fareConfig.base_fare,
      elapsed_sec: 0,
      start_time: now,
      // 起動時warm upでGPS取得済みなら初期値として使う（即時計測開始のため）
      // 過去の動きは加算しないよう last_timestamp は now を使用
      last_gps: warmupValid ? {
        lat: lastWarmupGps.lat,
        lng: lastWarmupGps.lng,
        altitude: lastWarmupGps.altitude,
        compassHeading: lastWarmupGps.compassHeading
      } : null,
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
    };
    prevSnap = null;  // Map Matching 連続性リセット（fallback 用）
    // Phase 1.C 状態リセット
    _offRoadActive = false;
    _consecutiveSnapMiss = 0;
    _haverAccumSinceLastCommit = 0;
    // fareConfig v2: 業務開始時に default ON の surcharge を初期 active に
    _activeSurchargeIds = new Set();
    if(Array.isArray(fareConfig.surcharges)){
      for(const s of fareConfig.surcharges){
        if(s && s.active_default && s.id) _activeSurchargeIds.add(s.id);
      }
    }
    // vehicle 初期選択 (default フラグ・なければ最初の vehicle)
    if(fareConfig.vehiclesEnabled && Array.isArray(fareConfig.vehicles) && fareConfig.vehicles.length > 0){
      const def = fareConfig.vehicles.find(v => v && v.default);
      _activeVehicleId = (def && def.id) || fareConfig.vehicles[0].id || null;
    } else {
      _activeVehicleId = null;
    }
    _fareConfigFrozen = true;  // F6: 業務開始時に凍結
    // B2 (2026-05-09): 業務開始時 MM warmup grace
    //   lastMmUsefulAt=0 だと mmHealthy=false で fallback 経路に入る
    //   Date.now() に設定しておけば MM_SILENT_THRESHOLD_MS (5s) 分の待ち時間が確保され
    //   その間に Worker B から最初の useful mmResult が届く想定
    //   届かなければ自然に inline / gap fallback に移行
    lastMmUsefulAt = Date.now();
    // MM-1: Worker 側 prevSnap も初期化（業務開始時の連続性リセット）
    if(mmWorker){
      try { mmWorker.postMessage({ type: 'reset' }); } catch(e){}
    }
    if(timer) clearInterval(timer);
    timer = setInterval(() => { if(state.running) state.elapsed_sec++; }, 1000);
  }

  function stop(){
    state.running = false;
    if(timer){ clearInterval(timer); timer = null; }
    // 注: Worker への reset 送信はしない (F5 維持)
    // 業務終了時の flush は businessEnd() で明示的に呼ぶ
  }

  // B7 (2026-05-09): 業務終了専用・Worker B の Viterbi 窓を flush して
  //   未確定の N 秒分を mmResult で post 返却 → state.distance_m に最終加算
  //   この後の getReport() で正確な合計距離を返す
  function businessEnd(){
    state.running = false;
    if(timer){ clearInterval(timer); timer = null; }
    _fareConfigFrozen = false;  // F6: 業務終了で解凍
    if(mmWorker){
      try { mmWorker.postMessage({ type: 'reset' }); } catch(e){}
    }
    // T8 (2026-05-09): 業務終了で当 session の cross-user pheromone を Firebase に push
    if(typeof FB !== 'undefined' && typeof FB.pushSessionAggregates === 'function'){
      try { FB.pushSessionAggregates(); } catch(_){}
    }
  }

  function reset(){
    stop();
    state = {
      running: false,
      distance_m: 0,
      distanceSource: 'gps',
      fare_yen: 0,
      elapsed_sec: 0,
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
    };
    prevSnap = null;
    // Phase 1.C 状態リセット
    _offRoadActive = false;
    _consecutiveSnapMiss = 0;
    _haverAccumSinceLastCommit = 0;
    lastMmUsefulAt = 0;
    // F5 (2026-05-09): trip reset では Worker 'softReset' を送る
    //   → lastCommittedSnap のみクリア・Viterbi 窓は維持
    //   業務終了時の完全 flush + clear は businessEnd() で別途呼ぶ
    if(mmWorker){
      try { mmWorker.postMessage({ type: 'softReset' }); } catch(e){}
    }
    // 起動時warm up GPSもクリア（過剰課金リスク回避・2026/05/01）
    // GPS止まった状態で移動→次回代行開始時に古い座標と現在地で距離爆発するのを防ぐ
    lastWarmupGps = null;
  }

  // GPS消失時の補完（トンネル・橋データ活用）
  // returns: 補完すべき距離(m) | null（補完しない）
  // 2026-05-09 設計変更: ROAD_FACTOR (×1.3) 廃止。MM 優先化で道路距離は MM が
  //   担当するため、GPS 消失時の fallback では補正係数を掛けない (=速度×時間そのまま)。
  //   トンネル/橋データ infraLength は引き続き Math.max で採用する。
  // トンネル/橋方向とコンパス方向の許容差（度）
  const TUNNEL_COMPASS_THRESHOLD_DEG = 45;

  function calcBearingMeter(lat1, lng1, lat2, lng2){
    const φ1=lat1*Math.PI/180, φ2=lat2*Math.PI/180;
    const Δλ=(lng2-lng1)*Math.PI/180;
    return((Math.atan2(Math.sin(Δλ)*Math.cos(φ2),
      Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ))*180/Math.PI)+360)%360;
  }
  function angleDiffMeter(a,b){let d=Math.abs(a-b)%360;return d>180?360-d:d;}

  function calculateGapFill(prevLat, prevLng, currLat, currLng, gapSec, lastSpeedKmh, compassHeading){
    if(gapSec > GAP_MAX_SEC) return null;

    // 停車中（速度=0）の場合は座標差分で判断
    if(lastSpeedKmh <= 0){
      const coordDiff = GPS.calcDistance(prevLat, prevLng, currLat, currLng);
      if(coordDiff >= 20){
        dlog(`[Meter] 停車中補完: 座標差分 ${Math.round(coordDiff)}m`);
        return coordDiff;
      }
      return null;
    }

    // 走行中の補完（速度×時間）
    // D4 (2026-05-09): 道路種別ベースの最大速度を _maxSpeedFor で参照値として記録
    // F7 (2026-05-09・設計変更): gap fill の clamp は道路種別cap ではなく
    //   160km/h 絶対上限に変更。理由: 道路種別cap=120 (motorway) で実速度 160km/h
    //   走行中の GPS 圏外時に距離が欠落していた (= 過少課金リスク・絶対ルール「GPS 直線禁止」
    //   と並ぶ品質要件)。ROAD_MAX_KMH_BY_TYPE 表は将来の参照用に保持。
    const maxKmh = _maxSpeedFor(_lastSnapTypeCode);
    const ABS_MAX_KMH = 160;
    const clampedKmh = Math.min(lastSpeedKmh, ABS_MAX_KMH);
    const speedMs = clampedKmh / 3.6;
    const naiveDistance = speedMs * gapSec;
    if(typeof dlog === 'function' && lastSpeedKmh > maxKmh){
      dlog(`[Meter] gap fill: speed ${lastSpeedKmh.toFixed(1)}km/h > road-cap ${maxKmh}km/h ` +
           `(absolute cap ${ABS_MAX_KMH} 適用)`);
    }

    if(typeof RegionLoader === 'undefined') return naiveDistance;

    // ★設計変更宣言 Phase 1.B (2026-05-10): GPS lost A 点・GPS recovered B 点
    //   両方が同じ tunnel/bridge polyline 上にあれば polyline 上の A→B 実走距離で精緻化
    //   既存 findNearestTunnel は mid から 200m 半径で短トンネル限定だったため、
    //   findTunnelByPosition (polyline 距離ベース) を併用して長トンネルも検出
    //   過少課金防止のため Math.max(polylineDist, naiveDistance) を採用
    //   (polylineDist は tunnel 部分のみ・naiveDistance は前後アプローチ含む total 推定)
    if(typeof RegionLoader.findTunnelByPosition === 'function'
       && typeof RegionLoader.calcInfraPolylineDistance === 'function'){
      let infraA = RegionLoader.findTunnelByPosition(prevLat, prevLng, NEAR_INFRA_RADIUS_M);
      if(!infraA) infraA = RegionLoader.findBridgeByPosition(prevLat, prevLng, NEAR_INFRA_RADIUS_M);
      let infraB = RegionLoader.findTunnelByPosition(currLat, currLng, NEAR_INFRA_RADIUS_M);
      if(!infraB) infraB = RegionLoader.findBridgeByPosition(currLat, currLng, NEAR_INFRA_RADIUS_M);

      // 同じ infra (item 配列の参照一致) → polyline 上の A→B 距離
      if(infraA && infraB && infraA.item === infraB.item){
        const polylineDist = RegionLoader.calcInfraPolylineDistance(
          infraA, prevLat, prevLng, currLat, currLng);
        if(polylineDist != null && polylineDist > 0){
          // 物理上限 sanity (160km/h × gapSec + 余裕)
          const physMaxM = (ABS_MAX_KMH / 3.6) * Math.max(1, gapSec) + 50;
          if(polylineDist <= physMaxM){
            // 過少課金防止: polyline と naive の max
            const filled = Math.max(polylineDist, naiveDistance);
            dlog(`[Meter] Phase1.B A→B polyline: ${polylineDist.toFixed(0)}m vs naive ${naiveDistance.toFixed(0)}m → ${filled.toFixed(0)}m (${infraA.item[0]} 全長${infraA.item[1]}m)`);
            return filled;
          }
        }
      }
    }

    // 既存ロジック (fallback): A 周辺の単発 infra 検出
    let infra = RegionLoader.findNearestTunnel(prevLat, prevLng, NEAR_INFRA_RADIUS_M);
    if(!infra) infra = RegionLoader.findNearestBridge(prevLat, prevLng, NEAR_INFRA_RADIUS_M);

    if(infra){
      const infraLength = infra.item[1];
      const infraStart  = infra.item[2]; // [lat, lng]
      const infraEnd    = infra.item[3]; // [lat, lng]

      // コンパス方向と構造物方向の照合
      if(compassHeading != null){
        const infraBearing = calcBearingMeter(infraStart[0], infraStart[1], infraEnd[0], infraEnd[1]);
        // 双方向（順方向・逆方向）の小さい方で判定
        const diffFwd = angleDiffMeter(compassHeading, infraBearing);
        const diffRev = angleDiffMeter(compassHeading, (infraBearing + 180) % 360);
        const diff = Math.min(diffFwd, diffRev);

        if(diff <= TUNNEL_COMPASS_THRESHOLD_DEG){
          // コンパスと一致 → 構造物の実距離 vs 速度×時間 の長い方
          const filled = Math.max(naiveDistance, infraLength);
          dlog(`[Meter] ${infra.item[0]} コンパス一致(${diff.toFixed(0)}°) → ${Math.round(filled)}m (infra=${infraLength}m, naive=${Math.round(naiveDistance)}m)`);
          return filled;
        } else {
          // コンパスと不一致 → 誤検出の可能性・速度×時間そのまま
          dlog(`[Meter] ${infra.item[0]} コンパス不一致(${diff.toFixed(0)}°) → 速度補完`);
          return naiveDistance;
        }
      }

      // コンパスなし → 構造物長と速度×時間の長い方を採用
      const filled = Math.max(naiveDistance, infraLength);
      dlog(`[Meter] GPS消失補完: ${gapSec.toFixed(1)}秒 → ${Math.round(filled)}m (${infra.item[0]} ${infraLength}m, naive=${Math.round(naiveDistance)}m)`);
      return filled;
    }

    // データなし → 速度×時間そのまま
    dlog(`[Meter] GPS消失補完: ${gapSec.toFixed(1)}秒 → ${Math.round(naiveDistance)}m (補正なし)`);
    return naiveDistance;
  }

  function _recordGapFill(filledM){
    state.gap_fill_count++;
    state.gap_fill_total_m += filledM;
  }

  // 2026-05-09 絶対ルール: 課金距離は道路距離のみ。GPS 直線距離は使わない。
  //   inline road-snap (RegionLoader.snapToNearestRoad + calcRoadDistance) は
  //   道路距離計算なので使用可。Worker B 不在 / silent 時の代替経路として動かす。
  //   road データが未 load・snap miss の場合は加算せず distance_m を据え置く
  //   (= GPS 直線距離による誤課金を絶対に発生させない)。
  function _inlineSnapAndIncrement(gpsResult){
    if(typeof RegionLoader === 'undefined' || !RegionLoader.snapToNearestRoad) return null;
    let snap;
    try {
      snap = RegionLoader.snapToNearestRoad(
        gpsResult.lat, gpsResult.lng, { maxDistM: MM_MAX_SNAP_DIST_M });
    } catch(_){ return null; }
    if(!snap) return null;
    let increment = 0;
    if(prevSnap){
      const dtSec = prevSnap.timestamp != null
        ? (gpsResult.timestamp - prevSnap.timestamp) / 1000
        : 0;
      if(dtSec > MM_GAP_RESET_SEC){
        prevSnap = Object.assign({}, snap, { timestamp: gpsResult.timestamp });
        return null;
      }
      try {
        const r = RegionLoader.calcRoadDistance(prevSnap, snap);
        if(r && typeof r.distanceM === 'number'
           && r.distanceM >= 0 && r.distanceM <= MM_MAX_SEGMENT_DIST_M){
          increment = r.distanceM;
        }
      } catch(_){}
    }
    prevSnap = Object.assign({}, snap, { timestamp: gpsResult.timestamp });
    return increment;
  }

  function update(gpsResult){
    // P3 (2026-05-09): 業務外 (state.running=false) でも MM Worker B には GPS を流す
    //   これにより業務開始ボタン押下時には Viterbi 窓が温まっており即 ready
    //   state.running=false の間は距離加算 (state.distance_m) は行わない
    if(!state.running){
      if(gpsResult && !gpsResult.isStationary){
        _updateMapMatching(gpsResult);
      }
      return;
    }
    if(gpsResult.isStationary){
      // B5 (2026-05-09): 停車中でも Worker B にハートビートを送信
      //   Viterbi 窓内の確定前候補が時間進行で commit される機会を作る
      //   業務終了時の flush で観測時刻が古いまま commit されるのを防ぐ
      _updateMapMatching(gpsResult);
      return;
    }

    // 2026-05-09 (絶対ルール準拠): 課金距離は MM (道路距離) のみ
    //   mmHealthy = MM Worker が直近 5 秒内に mmIncrementM>0 を返している
    //   → distance_m への加算は _onMmWorkerMessage に任せる
    //   不健全時 (Worker dead / 沈黙) → inline RegionLoader 道路スナップで加算
    //     inline は GPS 直線ではなく道路距離計算なのでルール適合
    //   inline でも snap 不可 (roads 未 load / 道路から 50m 超) → 加算しない
    const mmHealthy = mmWorker && (Date.now() - lastMmUsefulAt) <= MM_SILENT_THRESHOLD_MS;

    if(state.last_gps && state.last_timestamp){
      const dtSec = (gpsResult.timestamp - state.last_timestamp) / 1000;

      // Phase 1.C (2026-05-10): 通常時は haversine 累積を裏で track
      //   off-road 起動時に retroactive 加算するための buffer
      _trackHaversineBetweenGps(gpsResult, dtSec);

      // GPS消失検出：5秒以上の空白 (トンネル等で MM/GPS 共に不可)
      if(dtSec >= GAP_THRESHOLD_SEC){
        // gap fill: 速度×時間 (タイヤ回転由来の概算・GPS 直線弦ではない)
        //   トンネル/橋データがあれば infraLength を加味
        const filled = calculateGapFill(
          state.last_gps.lat, state.last_gps.lng,
          gpsResult.lat, gpsResult.lng,
          dtSec, state.last_speed_kmh,
          state.last_gps.compassHeading
        );
        if(filled !== null){
          state.distance_m += filled;
          state.fare_yen = calcFare(state.distance_m);
          state.distanceSource = 'gap';
          _recordGapFill(filled);
          _haverAccumSinceLastCommit = 0;   // gap fill で確定したのでバッファ reset
        }
      } else if(_offRoadActive){
        // Phase 1.C Off-Road Mode: GPS polyline 累積で課金続行
        const inc = _calculateOffRoadIncrement(gpsResult, dtSec);
        if(inc > 0){
          state.distance_m += inc;
          state.fare_yen = calcFare(state.distance_m);
          state.distanceSource = 'offroad';
          state.offroad_distance_m = (state.offroad_distance_m || 0) + inc;
        }
      } else if(!mmHealthy){
        // MM 不健全時の inline 道路スナップ fallback (絶対ルール: GPS 直線禁止)
        const inc = _inlineSnapAndIncrement(gpsResult);
        if(inc !== null && inc > 0){
          state.distance_m += inc;
          state.fare_yen = calcFare(state.distance_m);
          state.distanceSource = 'inline';
        }
        // inc===null (snap miss / roads 未 load) → 加算なし・distance_m 据え置き
      }
      // mmHealthy 時はここで距離は加算しない・MM Worker が _onMmWorkerMessage で加算する
    } else {
      // 初回 GPS step: 比較対象がないので加算せず prevSnap を初期化
      _inlineSnapAndIncrement(gpsResult);
    }
    // 待機時間累積 (fareConfig v2): 速度 < 3km/h かつ業務中で wait_sec を増加
    //   wait.enabled が true でなくても累積する (= 集計用・課金は wait.enabled 時のみ)
    //   無料時間 freeMins は calcFare 側で控除する
    if(state.last_timestamp){
      const dtSec2 = (gpsResult.timestamp - state.last_timestamp) / 1000;
      if(dtSec2 > 0 && dtSec2 < 60 && (gpsResult.speedKmh || 0) < 3){
        state.wait_sec += dtSec2;
      }
    }

    state.last_gps = { lat: gpsResult.lat, lng: gpsResult.lng, altitude: gpsResult.altitude, compassHeading: gpsResult.compassHeading || null };
    state.last_timestamp = gpsResult.timestamp;
    state.last_speed_kmh = gpsResult.speedKmh || 0;

    // Phase 2.A (2026-05-10): 訓練データ収集
    //   GPS 良好 (accuracy<=20m) + 速度>5km/h + !isStationary で 1 サンプル保存
    //   将来 AI 推論 (Phase 4・CarSpeedNet ONNX) のための蓄積基盤
    //   位置情報は一切送られない (TrainingCollector 内で禁止)
    //   default ON・Phase 3 設定画面で OFF 切替可能
    if(typeof TrainingCollector !== 'undefined' && typeof TrainingCollector.collectIfEligible === 'function'){
      try { TrainingCollector.collectIfEligible(gpsResult); } catch(_){}
    }

    // ━━━━━ Map Matching: Worker B にも GPS を転送 ━━━━━
    _updateMapMatching(gpsResult);
  }

  // Map Matching 処理（update から呼ばれる・分離して既存ロジック保護）
  // MM-1 (2026-05-08): Worker B 経路を優先・worker 不在時は既存インライン fallback
  //   挙動同一を担保するため、early-return 条件と各分岐を Worker / inline 双方で揃える
  //   失敗しても state.distance_m / fare_yen は絶対に止めない（業務継続性最優先）
  //
  // 2026/05/03 NAV-1 修正（fallback 経路にも維持）：prevSnap に timestamp を保持
  //   旧コードは state.last_timestamp を参照していたが update() 末尾で
  //   gpsResult.timestamp に先に更新されるため dtSec が常に 0 になっていた。
  //   修正：prevSnap 自身が時刻を持つ自己完結型に変更（snap オブジェクトは汚染しない）。
  function _updateMapMatching(gpsResult){
    if(!MM_ENABLED) return;
    if(gpsResult.isStationary) return;
    if(typeof gpsResult.lat !== 'number' || typeof gpsResult.lng !== 'number') return;

    // ── MM-1: Worker B 経路（優先） ────────────────────
    // mm_total_count は post タイミングで main 側がカウント（Worker と二重管理回避）
    // mm_snap_count / mm_skip_count / mm_distance_m は _onMmWorkerMessage で加算
    // B1 (2026-05-09): roadsLoaded ack を 1 件以上受領済の Worker にのみ post
    if(mmWorker && _workerLoadedPrefs.size > 0){
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
          headingDeg: (gpsResult.compassHeading != null) ? gpsResult.compassHeading : null,
          // 2026-05-09 (P4/P5): cellularLayerHint / accelLayerHint 廃止・layer 連続性 boost で代替
          // GPS altitude は DEM 比較用に維持
          altitude: (typeof gpsResult.altitude === 'number') ? gpsResult.altitude : null,
        });
      } catch(e) {
        // post 失敗時はメーター本体に影響を与えず inline fallback に進む
        if(typeof dlog === 'function') dlog('[MM] worker post error: ' + e.message);
      }
      return;
    }

    // ── Fallback: 既存インライン処理（Worker 起動失敗時の保険） ──
    if(typeof RegionLoader === 'undefined' || !RegionLoader.snapToNearestRoad) return;

    state.mm_total_count++;

    try {
      const snap = RegionLoader.snapToNearestRoad(
        gpsResult.lat, gpsResult.lng,
        { maxDistM: MM_MAX_SNAP_DIST_M }
      );
      if(!snap){
        // 道路から遠い → snap せず（駐車場・畑など）
        // prevSnap は維持（道路に戻ったら再開）
        return;
      }

      state.mm_snap_count++;

      if(prevSnap){
        const dtSec = prevSnap.timestamp != null
          ? (gpsResult.timestamp - prevSnap.timestamp) / 1000
          : 0;
        if(dtSec > MM_GAP_RESET_SEC){
          prevSnap = Object.assign({}, snap, { timestamp: gpsResult.timestamp });
          return;
        }

        const r = RegionLoader.calcRoadDistance(prevSnap, snap);
        if(r && typeof r.distanceM === 'number'){
          if(r.distanceM >= 0 && r.distanceM <= MM_MAX_SEGMENT_DIST_M){
            state.mm_distance_m += r.distanceM;
          } else {
            state.mm_skip_count++;
            if(typeof dlog === 'function'){
              dlog('[MM] skip 異常距離: ' + r.distanceM.toFixed(0) + 'm');
            }
          }
        }
      }
      prevSnap = Object.assign({}, snap, { timestamp: gpsResult.timestamp });
    } catch(e) {
      state.mm_skip_count++;
      if(typeof dlog === 'function') dlog('[MM] error: ' + e.message);
    }
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
  function calcFare(distanceM){
    let fare = 0;

    // Step 1: 距離料金
    if(Array.isArray(fareConfig.tiers) && fareConfig.tiers.length > 0){
      // 新形式: tiers 配列 走査
      if(distanceM <= fareConfig.base_distance_m){
        fare = fareConfig.base_fare;
      } else {
        fare = fareConfig.base_fare;
        for(const tier of fareConfig.tiers){
          if(!tier || typeof tier.from_m !== 'number') continue;
          if(distanceM <= tier.from_m) continue;
          const tierEnd = (tier.to_m === null || tier.to_m === undefined)
            ? distanceM : Math.min(distanceM, tier.to_m);
          const tierDist = tierEnd - tier.from_m;
          if(tierDist <= 0) continue;
          const ad = tier.add_distance_m > 0 ? tier.add_distance_m : 1;
          const af = tier.add_fare || 0;
          const steps = Math.floor(tierDist / ad) + 1;
          fare += steps * af;
          if(tier.to_m === null || tier.to_m === undefined) break;
          if(distanceM <= tier.to_m) break;
        }
      }
    } else {
      // 旧形式 fallback: base + add 単純計算
      if(distanceM < fareConfig.base_distance_m){
        fare = fareConfig.base_fare;
      } else {
        const extra = distanceM - fareConfig.base_distance_m;
        const steps = Math.floor(extra / fareConfig.add_distance_m) + 1;
        fare = fareConfig.base_fare + (steps * fareConfig.add_fare);
      }
    }

    // Step 2: vehicle 倍率 + addon
    if(fareConfig.vehiclesEnabled && _activeVehicleId && Array.isArray(fareConfig.vehicles)){
      const v = fareConfig.vehicles.find(x => x && x.id === _activeVehicleId);
      if(v){
        const mul = (typeof v.multiplier === 'number' && v.multiplier > 0) ? v.multiplier : 1.0;
        const addon = (typeof v.addon === 'number') ? v.addon : 0;
        fare = fare * mul + addon;
      }
    }

    // Step 3: 手動 surcharges 乗算
    let manualMul = 1.0;
    if(Array.isArray(fareConfig.surcharges)){
      for(const id of _activeSurchargeIds){
        const s = fareConfig.surcharges.find(x => x && x.id === id);
        if(s && typeof s.rate === 'number' && s.rate >= 1.0) manualMul *= s.rate;
      }
    }
    fare *= manualMul;

    // Step 4: autoSurcharges 自動判定 (現在時刻ベース)
    fare *= _calcAutoSurchargeMultiplier(new Date());

    // Step 5: wait 料金加算
    if(fareConfig.wait && fareConfig.wait.enabled){
      const waitMin = (state.wait_sec || 0) / 60;
      const free = (typeof fareConfig.wait.freeMins === 'number') ? fareConfig.wait.freeMins : 5;
      const rate = (typeof fareConfig.wait.ratePerMin === 'number') ? fareConfig.wait.ratePerMin : 100;
      const billable = Math.max(0, waitMin - free);
      fare += billable * rate;
    }

    // Step 6: min/max clamp
    if(typeof fareConfig.minFare === 'number' && fareConfig.minFare > 0 && fare < fareConfig.minFare){
      fare = fareConfig.minFare;
    }
    if(typeof fareConfig.maxFare === 'number' && fareConfig.maxFare > 0 && fare > fareConfig.maxFare){
      fare = fareConfig.maxFare;
    }

    // Step 7: 丸め
    const unit = (typeof fareConfig.rounding === 'number' && fareConfig.rounding > 0) ? fareConfig.rounding : 1;
    if(unit > 1) fare = Math.round(fare / unit) * unit;
    else fare = Math.round(fare);

    return fare;
  }

  // autoSurcharges 自動判定: 現在時刻に該当する全 auto rule の rate 積
  function _calcAutoSurchargeMultiplier(now){
    if(!fareConfig.autoSurcharges) return 1.0;
    let mul = 1.0;
    const a = fareConfig.autoSurcharges;
    // night: 時刻範囲 (wraparound 対応)
    if(a.night && a.night.enabled){
      const h = now.getHours();
      const f = a.night.from, t = a.night.to;
      const inRange = (f <= t) ? (h >= f && h < t) : (h >= f || h < t);
      if(inRange && typeof a.night.rate === 'number') mul *= a.night.rate;
    }
    // weekend: 土日固定 (簡易仕様・要件通り)
    if(a.weekend && a.weekend.enabled){
      const dow = now.getDay();
      if((dow === 0 || dow === 6) && typeof a.weekend.rate === 'number') mul *= a.weekend.rate;
    }
    // winter: 月日範囲 (年跨ぎ対応・MM-DD 文字列)
    if(a.winter && a.winter.enabled){
      const mmdd = String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      const f = a.winter.from || '12-15';
      const t = a.winter.to || '03-15';
      const inRange = (f <= t) ? (mmdd >= f && mmdd <= t) : (mmdd >= f || mmdd <= t);
      if(inRange && typeof a.winter.rate === 'number') mul *= a.winter.rate;
    }
    return mul;
  }

  // fareConfig v2: 公開 API
  function setSurchargeActive(id, active){
    if(!id) return;
    if(active) _activeSurchargeIds.add(id);
    else _activeSurchargeIds.delete(id);
    state.fare_yen = calcFare(state.distance_m);
  }
  function toggleSurcharge(id){
    if(!id) return;
    if(_activeSurchargeIds.has(id)) _activeSurchargeIds.delete(id);
    else _activeSurchargeIds.add(id);
    state.fare_yen = calcFare(state.distance_m);
  }
  function getActiveSurcharges(){ return Array.from(_activeSurchargeIds); }
  // 現在の合計 surcharge 倍率 (手動 × 自動・vehicle 倍率は除外)
  function getSurchargeMultiplier(){
    let mul = 1.0;
    if(Array.isArray(fareConfig.surcharges)){
      for(const id of _activeSurchargeIds){
        const s = fareConfig.surcharges.find(x => x && x.id === id);
        if(s && typeof s.rate === 'number' && s.rate >= 1.0) mul *= s.rate;
      }
    }
    mul *= _calcAutoSurchargeMultiplier(new Date());
    return mul;
  }
  function setVehicleType(vehicleId){
    _activeVehicleId = vehicleId || null;
    state.fare_yen = calcFare(state.distance_m);
  }
  function getVehicleType(){ return _activeVehicleId; }

  function getState(){ return { ...state }; }

  // MM-2 (2026-05-08): 評価インフラ用 公開 API
  //   いつでも呼び出せる現状の Map Matching 統計値スナップショット
  function getMMStats(){
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
      distance_source: state.distanceSource,                   // 直近の課金距離ソース ('mm' | 'gps')
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

  function setDistance(distanceM){
    state.distance_m = distanceM;
    state.fare_yen = calcFare(distanceM);
  }

  // リロード復元用：最終GPS状態をセット（層3・GPS消失補完を復元後に発火させる）
  function setLastGps(lat, lng, altitude, speedKmh, timestamp){
    state.last_gps = { lat, lng, altitude };
    state.last_timestamp = timestamp;
    state.last_speed_kmh = speedKmh || 0;
  }

  function resume(){
    if(state.running) return;
    state.running = true;
    if(timer) clearInterval(timer);
    timer = setInterval(() => { if(state.running) state.elapsed_sec++; }, 1000);
  }

  // 起動時warm up（2026/04/30追加）
  // 代行開始前でも常に呼ばれて、GPSを内部に保存しておく
  // 「代行開始」押した瞬間に start() が lastWarmupGps を初期値として使う
  // これにより「100m走って動き出す」遅延が解消される
  // state には触らない（距離・料金は変えない）
  function updateGpsOnly(gpsResult){
    if(!gpsResult || typeof gpsResult.lat !== 'number' || typeof gpsResult.lng !== 'number') return;
    lastWarmupGps = {
      lat: gpsResult.lat,
      lng: gpsResult.lng,
      altitude: gpsResult.altitude || 0,
      compassHeading: gpsResult.compassHeading || null,
      timestamp: gpsResult.timestamp || Date.now(),
      speedKmh: gpsResult.speedKmh || 0
    };
  }

  return { start, stop, businessEnd, reset, resume, update, updateGpsOnly, getState, getMMStats, setFareConfig, getFareConfig, calcFare, setDistance, setLastGps, setMapMatcher, isMmReady,
    // fareConfig v2 (2026-05-10)
    setSurchargeActive, toggleSurcharge, getActiveSurcharges, getSurchargeMultiplier,
    setVehicleType, getVehicleType,
  };
})();
