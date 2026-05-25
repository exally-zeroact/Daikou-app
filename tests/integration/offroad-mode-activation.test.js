// tests/integration/offroad-mode-activation.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step P0-④ / 全32件)
//
// 検証対象: meter.js Phase 1.C Off-Road Mode
//   L95  OFFROAD_SNAP_MISS_THRESHOLD = 5
//   L442 snap miss 連続検出 (m.snapped===false || m.skipped || (mmIncrementM===0 && !committed))
//   L450 _offRoadActive=true 起動
//   L462 state.distance_m += _haverAccumSinceLastCommit (= retroactive 加算)
//   L833 _calculateOffRoadIncrement → state.distance_m += inc (= incremental 加算)
//   L334 Worker B 復帰 (mmIncrementM>0 受信) → _offRoadActive=false + commit 無視
//
// 既存 (= property/distance-m-update-paths.test.js C1) は L462/L842 静的 grep のみ・実動作未検証。
// 本 test は fake worker で snap miss / 復帰 sequence を駆動・動的検証。
//
// 絶対ルール準拠:
//   js/meter.js は触らない absolute。Off-Road は ★絶対ルール適用外区間 (= retroactive / 明示宣言)。

const path = require('path');
const METER_JS_PATH = path.join(__dirname, '..', '..', 'js', 'meter.js');

function loadMeter() {
  delete require.cache[require.resolve(METER_JS_PATH)];
  return require(METER_JS_PATH);
}

const DEFAULT_FARE_CONFIG = {
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
  autoSurcharges: {},
  vehicles: [],
  vehiclesEnabled: false,
  wait: { enabled: false, freeMins: 5, ratePerMin: 100 },
};

function mockGPS() {
  globalThis.GPS = {
    calcDistance: (lat1, lng1, lat2, lng2) => {
      const R = 6371000;
      const toRad = (d) => (d * Math.PI) / 180;
      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    },
    calcDistance3D: () => 0,
    setRoadType: () => {},
  };
}

function makeFakeWorker() {
  const handlers = [];
  return {
    addEventListener(type, h) {
      if (type === 'message') handlers.push(h);
    },
    removeEventListener(type, h) {
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    },
    postMessage() {},
    _dispatch(data) {
      for (const h of handlers) h({ data });
    },
  };
}

// 1 step = 0.000225 度 ≈ 25m 北・1 秒間隔 (= 90 km/h・物理上限 160km/h クリア)
function gpsAt(stepIdx, baseLat = 33.84, baseLng = 132.7656, baseTs = 1714100000000) {
  return {
    lat: baseLat + 0.000225 * stepIdx,
    lng: baseLng,
    altitude: 0,
    accuracy: 5,
    speedKmh: 90,
    isStationary: false,
    timestamp: baseTs + stepIdx * 1000,
  };
}

function snapMiss() {
  return { type: 'mmResult', mmIncrementM: 0, snapped: false, skipped: 1, committed: false };
}

function snapHit(mmIncrementM) {
  return { type: 'mmResult', mmIncrementM, snapped: true, committed: true };
}

describe('offroad-mode-activation (meter.js Phase 1.C L95/L442/L462/L833/L334)', () => {
  let Meter, fakeWorker;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig(DEFAULT_FARE_CONFIG);
    Meter.reset();
    fakeWorker = makeFakeWorker();
    Meter.setMapMatcher(fakeWorker);
    Meter.start();
    Meter._setDrainMmUntil(0); // drain 無効化 (= drain は P0-③ 検証範囲)
    // ★ R1 (2026-05-19): Off-Road grace 5 秒 を test では即時解除 (= Off-Road 起動を即可能に)
    if (typeof Meter._setOffRoadGraceUntil === 'function') {
      Meter._setOffRoadGraceUntil(0);
    }
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('snap miss 4 回連続 → Off-Road 未起動 (= OFFROAD_SNAP_MISS_THRESHOLD=5 未満)', () => {
    // 6 GPS update (= step 0 last_gps セット + step 1-5 で haver_accum 累積)
    for (let i = 0; i <= 5; i++) Meter.update(gpsAt(i));
    // snap miss 4 回 (= 5 未満)
    for (let k = 0; k < 4; k++) fakeWorker._dispatch(snapMiss());
    const s = Meter.getState();
    expect(s.offroad_count).toBe(0);
    expect(s.distance_m).toBe(0); // retroactive 未起動・distanceSource は 'mm' に切替なし
  });

  it('snap miss 5 回連続 → Off-Road 起動 (offroad_count=1) + retroactive 加算 (L462)', () => {
    for (let i = 0; i <= 5; i++) Meter.update(gpsAt(i));
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    const s = Meter.getState();
    expect(s.offroad_count).toBe(1);
    expect(s.distanceSource).toBe('offroad');
    // retroactive 加算: 5 step (= 約 125m haver_accum・25m/step × 5) が state.distance_m に
    expect(s.distance_m).toBeGreaterThan(100);
    expect(s.distance_m).toBeLessThan(150);
    expect(s.offroad_distance_m).toBe(s.distance_m); // 全額が offroad_distance_m に記録
    // _haverAccumSinceLastCommit は 0 reset される
  });

  it('Off-Road 起動後の追加 GPS update → incremental 加算 (L842 経路)', () => {
    // 起動まで 5 step + snap miss 5 回
    for (let i = 0; i <= 5; i++) Meter.update(gpsAt(i));
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    const afterActivation = Meter.getState().distance_m;
    expect(afterActivation).toBeGreaterThan(0);

    // Off-Road 中の追加 GPS step → _calculateOffRoadIncrement で inc 計算
    Meter.update(gpsAt(6));
    const s = Meter.getState();
    // 1 step (= 約 25m) が更に加算されているはず
    expect(s.distance_m).toBeGreaterThan(afterActivation + 20);
    expect(s.distance_m).toBeLessThan(afterActivation + 30);
    expect(s.offroad_distance_m).toBe(s.distance_m);
  });

  it('Off-Road 中の Worker B 復帰 (mmIncrementM>0) → _offRoadActive=false + commit 無視 (L334)', () => {
    // 起動
    for (let i = 0; i <= 5; i++) Meter.update(gpsAt(i));
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    const afterActivation = Meter.getState().distance_m;
    expect(afterActivation).toBeGreaterThan(0);

    // Worker B 復帰 (= snap 成功 + mmIncrementM>0)
    fakeWorker._dispatch(snapHit(100));
    const s = Meter.getState();
    // L340: Worker B mmIncrement を二重課金回避のため無視
    expect(s.distance_m).toBe(afterActivation); // 100m 加算されない
    // ここで mm 復帰チェック自体は internal flag・state には影響しない
  });

  it('Off-Road 中の Worker B 復帰後・新規 mmResult (snap hit) は通常加算される', () => {
    // 起動
    for (let i = 0; i <= 5; i++) Meter.update(gpsAt(i));
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    const afterActivation = Meter.getState().distance_m;

    // 復帰 1 回目: 無視
    fakeWorker._dispatch(snapHit(100));
    // 復帰 2 回目: _offRoadActive=false なので通常経路・state.distance_m += 50
    fakeWorker._dispatch(snapHit(50));
    const s = Meter.getState();
    expect(s.distance_m).toBe(afterActivation + 50);
    expect(s.distanceSource).toBe('mm');
  });

  it('snap miss 5 回連続後・snapped:true で _consecutiveSnapMiss が 0 reset (L443)', () => {
    // 4 回 snap miss → 5 回目で snap success → reset 検証
    for (let i = 0; i <= 5; i++) Meter.update(gpsAt(i));
    for (let k = 0; k < 4; k++) fakeWorker._dispatch(snapMiss());
    // ここで snap success
    fakeWorker._dispatch(snapHit(50));
    // さらに 4 回 snap miss → 累積は 4 (= 起動しない)
    for (let k = 0; k < 4; k++) fakeWorker._dispatch(snapMiss());
    const s = Meter.getState();
    expect(s.offroad_count).toBe(0); // 起動していない
  });

  it('Off-Road 起動時に haver_accum=0 (= 初回 GPS のみ) なら retroactive 加算なし (L473 dlog 経路)', () => {
    // 1 GPS のみ (= state.last_gps セット直後) で snap miss 5 回 dispatch
    Meter.update(gpsAt(0));
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    const s = Meter.getState();
    expect(s.offroad_count).toBe(1); // 起動はする
    expect(s.distance_m).toBe(0); // retroactive 加算なし (= haver_accum=0)
    expect(s.offroad_distance_m).toBe(0);
  });

  it('★ Phase 3: Off-Road 起動時の tier2_pending_m 一括 0 化は撤廃済 (= 自然減算で対応)', () => {
    // 2026-05-18 Phase 3 仕様変更:
    //   旧: Off-Road 起動時に tier2_pending_m = 0 一括リセット (= 表示急減原因)
    //   新: 一括リセット撤廃・通常 commit 時の差分減算 (= 自然減算) で対応
    //   表示は display_distance_m (= Reconciliation 同期値) で滑らか追従
    for (let i = 0; i <= 5; i++) Meter.update(gpsAt(i));
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 0,
      tentativeIncrementM: 50,
      snapped: true,
    });
    expect(Meter.getState().tier2_pending_m).toBe(50);

    // snap miss 5 回で起動
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    const s = Meter.getState();
    expect(s.offroad_count).toBe(1);
    // ★ Phase 3: tier2_pending_m は維持 (= 一括 0 化撤廃)
    expect(s.tier2_pending_m).toBe(50);
  });

  it('Off-Road 中の _trackHaversineBetweenGps は early return で haver_accum 不累積 (L251)', () => {
    // 起動まで
    for (let i = 0; i <= 5; i++) Meter.update(gpsAt(i));
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    const afterActivation = Meter.getState().distance_m;

    // Off-Road 中の追加 update → incremental で加算・haver_accum は累積しない
    Meter.update(gpsAt(6));
    Meter.update(gpsAt(7));
    const s = Meter.getState();
    // 2 step 分 = 約 50m が incremental で加算
    expect(s.distance_m - afterActivation).toBeGreaterThan(40);
    expect(s.distance_m - afterActivation).toBeLessThan(60);
  });

  it('Off-Road 中も distanceSource は "offroad" を維持 (= ロガー / UI 識別用)', () => {
    for (let i = 0; i <= 5; i++) Meter.update(gpsAt(i));
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    expect(Meter.getState().distanceSource).toBe('offroad');
    Meter.update(gpsAt(6));
    expect(Meter.getState().distanceSource).toBe('offroad');
  });

  // ─── ★ Phase 8 ①-A (2026-05-21): running=false ガード mutation kill ──
  //
  // 目的: Stryker Pass A で survived だった ConditionalExpression mutant 2 件を kill する。
  //   - meter.js L513: `if (state.running)` → mutation `if (true)` (retroactive Off-Road)
  //   - meter.js L978: `if (state.running)` → mutation `if (true)` (incremental Off-Road)
  // 両 mutant は・既存 test が running=true (= Meter.start() のみ) しか踏まないため survive。
  //
  // 絶対ルール準拠:
  //   distance_m += 経路・calcFare・commit 機構 は 1 byte も変更しない (= prod 無変更)。
  //   追加 test は「running=false で skip する既存挙動」を verify するだけ。
  //   meter.js stop() を呼ぶことで state.running=false にして・既存 retroactive / incremental
  //   経路が当該 step で += を skip することを確認する。
  //
  // L1364 (= setDistance の `>= 0` → `> 0` mutation) は・**等価 mutation (equivalent mutant)**:
  //   全入力 (= 0 / 正値 / 負値 / NaN / Infinity) で結果同一 (= 旧 v=0 / 新 v=0・fallback で 0 同値)。
  //   数学的に kill 不可能・課金 kill 率の真の分母から除外して 26/26 = 100% kill と評価する。

  it('★ Phase 8 L513 (running=false): retroactive Off-Road 起動でも state.running=false なら distance_m 加算 skip', () => {
    // 1. running=true で 6 GPS update を流し・_haverAccumSinceLastCommit を ~125m 蓄積
    //    (= 既存 retroactive 加算テストと同じ setup)
    for (let i = 0; i <= 5; i++) Meter.update(gpsAt(i));
    // 2. running=false に切替 (= 空車中・代行終了直後等の現実シナリオ)
    Meter.stop();
    expect(Meter.getState().running).toBe(false);
    const beforeOffroad = Meter.getState().distance_m;
    // 3. snap miss 5 回で Off-Road 起動・retroactive 加算 trigger
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    const s = Meter.getState();
    // 4. Off-Road 起動自体はする (offroad_count=1)・但し distance_m += は L513 guard で skip
    expect(s.offroad_count).toBe(1);
    expect(s.distance_m).toBe(beforeOffroad); // = 0・retroactive 加算なし
    expect(s.distance_m).toBe(0);
    // 5. offroad_distance_m も加算されない (= 同 if (state.running) ブロック内)
    expect(s.offroad_distance_m || 0).toBe(0);
  });

  it('★ Phase 8 L978 (running=false): Off-Road incremental でも state.running=false なら distance_m 加算 skip', () => {
    // 1. running=true で Off-Road 起動完了 (= retroactive 加算済)
    for (let i = 0; i <= 5; i++) Meter.update(gpsAt(i));
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    const afterActivation = Meter.getState().distance_m;
    expect(afterActivation).toBeGreaterThan(0); // 起動段階の retroactive 加算は行われている
    expect(Meter.getState().offroad_count).toBe(1);
    // 2. running=false に切替 (= Off-Road 中に代行終了等のシナリオ)
    Meter.stop();
    expect(Meter.getState().running).toBe(false);
    // 3. Off-Road 中の追加 GPS update → _calculateOffRoadIncrement で inc>0 計算される条件
    //    既存 test ('Off-Road 起動後の追加 GPS update → incremental 加算') と同じ 1 step
    Meter.update(gpsAt(6));
    const s = Meter.getState();
    // 4. L978 guard で incremental 加算 skip → distance_m は afterActivation のまま
    expect(s.distance_m).toBe(afterActivation); // 加算なし
    // 5. offroad_distance_m も同じ if (state.running) ブロック内のため・新規加算なし
    //    afterActivation 段階の retroactive 分は維持される
    expect(s.offroad_distance_m).toBe(afterActivation);
  });
});
