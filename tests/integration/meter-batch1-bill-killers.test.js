// tests/integration/meter-batch1-bill-killers.test.js
//
// ★設計変更宣言 Phase 8 Batch 1 (2026-05-21・BILL 高密度 mutant kill・司さん採択):
//   Stryker Pass A で survived の [BILL] 分類 mutant のうち・1 line に複数 mutant 集中する
//   高 ROI cluster を kill するための boundary / behavior test 集約。
//
// 対象 line + mutant 件数 (= 計 56 mutant 中 大半 kill 想定):
//   L460  tier2_pending_m = Math.max(0, (tier2 || 0) - (mmIncrement || 0))     (8 mutants)
//   L932  if (_haver > 0 && _haver <= _maxDist)  (gps_predictive 物理上限)     (6 mutants)
//   L1002 if (dtSec2 > 0 && dtSec2 < 60 && (speedKmh || 0) < 3)  (wait_sec 境界) (18 mutants)
//   L1305 (distance_m || 0) + (tier2_pending_m || 0)            (display target) (7 mutants)
//   L1317 display += diff > 0 ? maxDelta : -maxDelta            (display clamp)  (5 mutants)
//   L1321 display = Math.max(display, distance_m || 0)          (display 下限)   (4 mutants)
//
// L1374 equivalent mutation (= 等価・kill 不可・docs のみ):
//   setBusinessDistance(m) の `m >= 0` → `m > 0` 改変は・L1364 と同パターン:
//     入力 m=0: 旧 true → state.business_distance_m=0 / 新 false → 0 (fallback) → **同値 0**
//     入力 m=正値: 両者 true → m そのまま → **同値**
//     入力 m=負値/NaN/Infinity: 両者 false → 0 → **同値**
//   → 全入力で state.business_distance_m 同一・観測不能・kill 不可
//   → 課金 kill 率の真の分母から除外 (= L1364 と同列の構造的等価 mutation)
//
// ★絶対ルール準拠:
//   prod (js/meter.js) は 1 byte も触らない (= test 追加のみ)。
//   distance_m += 5 経路・calcFare・commit 機構は完全不変。
//   tier2_pending_m / wait_sec / gps_predictive_distance_m / display_distance_m は
//   表示 layer 又は集計 layer・課金根拠 (= distance_m / fare_yen) には一切影響しない。

'use strict';

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
      // 同パターンのハバーサイン (= 既存 offroad-mode-activation.test.js と同等)
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

function setupMeter() {
  mockGPS();
  const Meter = loadMeter();
  Meter.setFareConfig(DEFAULT_FARE_CONFIG);
  Meter.reset();
  const fakeWorker = makeFakeWorker();
  Meter.setMapMatcher(fakeWorker);
  if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);
  return { Meter, fakeWorker };
}

// ─── L460: tier2_pending_m commit 差分減算 (8 mutants) ──────────────────────
//
// 対象式: state.tier2_pending_m = Math.max(0, (state.tier2_pending_m || 0) - (m.mmIncrementM || 0));
//   pending 累積 > mmIncrementM: 差分減算で残値 > 0
//   pending 累積 < mmIncrementM: Math.max(0, ...) で 0 下限 clamp
//   tier2_pending_m undefined / null: || 0 fallback で 0 として扱う
//   m.mmIncrementM undefined / null: 同上
//
// kill する mutant: ArithmeticOperator (- → +)・MethodExpression (max → min)・
//   ConditionalExpression / LogicalOperator (|| 0 系列)

describe('Phase 8 Batch 1: L460 tier2_pending_m commit 差分減算 (= 表示単調増加保証)', () => {
  let Meter, fakeWorker;
  beforeEach(() => {
    ({ Meter, fakeWorker } = setupMeter());
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('pending=100 + commit mmIncrement=30 → pending=70 (= 差分減算)', () => {
    // 先に tentativeIncrementM で pending を 100 まで積む (= L483 経路)
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 0,
      tentativeIncrementM: 100,
      snapped: true,
      committed: false,
    });
    expect(Meter.getState().tier2_pending_m).toBe(100);
    // commit (= mmIncrement>0 + committed:true) で L460 差分減算
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 30,
      snapped: true,
      committed: true,
    });
    expect(Meter.getState().tier2_pending_m).toBe(70);
  });

  it('pending=50 + commit mmIncrement=100 → pending=0 (= Math.max 下限 clamp)', () => {
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 0,
      tentativeIncrementM: 50,
      snapped: true,
      committed: false,
    });
    expect(Meter.getState().tier2_pending_m).toBe(50);
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 100,
      snapped: true,
      committed: true,
    });
    expect(Meter.getState().tier2_pending_m).toBe(0);
  });

  it('pending=0 + commit mmIncrement=50 → pending=0 (= 0 下限維持・既に 0)', () => {
    expect(Meter.getState().tier2_pending_m).toBe(0);
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 50,
      snapped: true,
      committed: true,
    });
    expect(Meter.getState().tier2_pending_m).toBe(0);
  });

  it('複数 commit 連続で表示値 (distance + tier2_pending) 単調増加', () => {
    // pending=200 まで積む
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 0,
      tentativeIncrementM: 200,
      snapped: true,
      committed: false,
    });
    const driveDistBefore =
      (Meter.getState().distance_m || 0) + (Meter.getState().tier2_pending_m || 0);
    expect(driveDistBefore).toBe(200);
    // commit 60 → distance_m=60・tier2=140 → driveDist=200 (= 不変・表示停止)
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 60,
      snapped: true,
      committed: true,
    });
    const driveDistAfter =
      (Meter.getState().distance_m || 0) + (Meter.getState().tier2_pending_m || 0);
    expect(driveDistAfter).toBe(200); // 60 + 140 = 200 (= 不変)
    expect(driveDistAfter).toBeGreaterThanOrEqual(driveDistBefore); // 単調非減少
  });
});

// ─── L932: gps_predictive 物理上限 160 km/h gate (6 mutants) ──────────────
//
// 対象式: if (_haver > 0 && _haver <= _maxDist)
//   _maxDist = (160 / 3.6) * dtSec
//   _haver=0 → skip / _haver>_maxDist → skip (GPS jump 防御) / 0<_haver<=_maxDist → 加算
//
// kill する mutant: ConditionalExpression / LogicalOperator / EqualityOperator boundary

describe('Phase 8 Batch 1: L932 _haver 物理上限 160 km/h gate (= GPS jump 防御)', () => {
  let Meter;
  // 1 sec interval・25m 北 (= 90 km/h・上限内)
  const baseTs = 1714100000000;
  function gps(stepIdx, opts) {
    opts = opts || {};
    return {
      lat: 33.84 + (opts.dLat != null ? opts.dLat : 0.000225 * stepIdx),
      lng: 132.7656,
      altitude: 0,
      accuracy: 5,
      speedKmh: opts.speedKmh != null ? opts.speedKmh : 50,
      isStationary: false,
      timestamp: baseTs + stepIdx * 1000,
    };
  }
  beforeEach(() => {
    ({ Meter } = setupMeter());
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('_haver=0 (= 同座標) → gps_predictive 加算なし', () => {
    Meter.update(gps(0)); // last_gps 確立
    const before = Meter.getState().gps_predictive_distance_m || 0;
    // 同座標で再 update → haver=0 → L932 `_haver > 0` で skip
    Meter.update({ ...gps(0), timestamp: baseTs + 1000 });
    expect(Meter.getState().gps_predictive_distance_m || 0).toBe(before);
  });

  it('_haver 通常範囲 (= ~25m / 1 秒) → gps_predictive 加算される', () => {
    Meter.update(gps(0));
    const before = Meter.getState().gps_predictive_distance_m || 0;
    Meter.update(gps(1)); // 25m 北 → _haver ≈ 25・_maxDist ≈ 44 (= 160km/h × 1s)
    const after = Meter.getState().gps_predictive_distance_m || 0;
    expect(after).toBeGreaterThan(before);
    expect(after - before).toBeGreaterThan(20);
    expect(after - before).toBeLessThan(30);
  });

  it('_haver 物理上限超 (= 200m / 1 秒・720km/h) → gps_predictive 加算なし (= GPS jump 防御)', () => {
    Meter.update(gps(0));
    const before = Meter.getState().gps_predictive_distance_m || 0;
    // 200m 北 ≈ 720 km/h・160 km/h 上限超過
    Meter.update({ ...gps(0, { dLat: 0.0018 }), timestamp: baseTs + 1000 });
    expect(Meter.getState().gps_predictive_distance_m || 0).toBe(before);
  });
});

// ─── L1002: wait_sec 累積 boundary (18 mutants・最大密度) ────────────────
//
// 対象式: if (dtSec2 > 0 && dtSec2 < 60 && (gpsResult.speedKmh || 0) < 3) {
//          state.wait_sec += dtSec2;
//        }
// 境界:
//   dtSec2 > 0    (= 0 / 負値で除外)
//   dtSec2 < 60   (= 60 ちょうどで除外)
//   speedKmh < 3  (= 3 ちょうどで除外)
//   speedKmh = null → ||0 → 0 < 3 真 → 加算経路
//
// kill する mutant: 各 boundary を真偽両方経由する境界 test 集

describe('Phase 8 Batch 1: L1002 wait_sec 累積 boundary (= 待機料金集計)', () => {
  let Meter;
  const baseTs = 1714100000000;
  function gpsLike(opts) {
    return {
      lat: 33.84,
      lng: 132.7656,
      altitude: 0,
      accuracy: 5,
      speedKmh: opts.speedKmh,
      isStationary: false,
      timestamp: opts.ts,
    };
  }
  function setLast(Meter, ts, speedKmh) {
    // 初期 GPS で state.last_timestamp 確立
    Meter.update(gpsLike({ ts, speedKmh: speedKmh != null ? speedKmh : 2 }));
  }
  beforeEach(() => {
    ({ Meter } = setupMeter());
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('dtSec2=1 + speedKmh=2 → wait_sec += 1 (= 通常加算 path)', () => {
    setLast(Meter, baseTs);
    const before = Meter.getState().wait_sec || 0;
    Meter.update(gpsLike({ ts: baseTs + 1000, speedKmh: 2 }));
    expect(Meter.getState().wait_sec).toBeCloseTo(before + 1, 6);
  });

  it('dtSec2=0 (= 同 timestamp) → wait_sec 不変 (= > 0 境界)', () => {
    setLast(Meter, baseTs);
    const before = Meter.getState().wait_sec || 0;
    Meter.update(gpsLike({ ts: baseTs, speedKmh: 2 })); // 同 ts
    expect(Meter.getState().wait_sec).toBe(before);
  });

  it('dtSec2=60 (= 60 ちょうど) → wait_sec 不変 (= < 60 境界)', () => {
    setLast(Meter, baseTs);
    const before = Meter.getState().wait_sec || 0;
    Meter.update(gpsLike({ ts: baseTs + 60000, speedKmh: 2 })); // 60 秒後ちょうど
    expect(Meter.getState().wait_sec).toBe(before);
  });

  it('dtSec2=59 + speedKmh=2 → wait_sec += 59 (= < 60 境界の内側)', () => {
    setLast(Meter, baseTs);
    const before = Meter.getState().wait_sec || 0;
    Meter.update(gpsLike({ ts: baseTs + 59000, speedKmh: 2 }));
    expect(Meter.getState().wait_sec).toBeCloseTo(before + 59, 6);
  });

  it('dtSec2=1 + speedKmh=3 (= 3 ちょうど) → wait_sec 不変 (= < 3 境界)', () => {
    setLast(Meter, baseTs);
    const before = Meter.getState().wait_sec || 0;
    Meter.update(gpsLike({ ts: baseTs + 1000, speedKmh: 3 }));
    expect(Meter.getState().wait_sec).toBe(before);
  });

  it('dtSec2=1 + speedKmh=0 → wait_sec += 1 (= 完全停止でも累積)', () => {
    setLast(Meter, baseTs);
    const before = Meter.getState().wait_sec || 0;
    Meter.update(gpsLike({ ts: baseTs + 1000, speedKmh: 0 }));
    expect(Meter.getState().wait_sec).toBeCloseTo(before + 1, 6);
  });

  it('dtSec2=1 + speedKmh=null → wait_sec += 1 (= ||0 fallback で 0 扱い)', () => {
    setLast(Meter, baseTs);
    const before = Meter.getState().wait_sec || 0;
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      altitude: 0,
      accuracy: 5,
      speedKmh: null,
      isStationary: false,
      timestamp: baseTs + 1000,
    });
    expect(Meter.getState().wait_sec).toBeCloseTo(before + 1, 6);
  });
});

// ─── L1305 / L1317 / L1321: display_distance_m 計算 (16 mutants) ─────────
//
// 対象式:
//   target = max(distance_m, gps_predictive, distance_m + tier2_pending)  ← L1305
//   if |diff| > maxDelta: display += diff > 0 ? maxDelta : -maxDelta       ← L1317
//   display = max(display, distance_m)                                     ← L1321
//
// 規約: display_distance_m は・課金距離 (= distance_m) を下回らない / 単調増加 / 急減なし

describe('Phase 8 Batch 1: L1305/L1317/L1321 display_distance_m 計算 (= 表示値)', () => {
  let Meter, fakeWorker;
  beforeEach(() => {
    ({ Meter, fakeWorker } = setupMeter());
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('L1305 target は (distance_m + tier2_pending_m) を含む (= max source 3)', () => {
    Meter.setDistance(100);
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 0,
      tentativeIncrementM: 50,
      snapped: true,
      committed: false,
    });
    // 1 回目 getState (= last_display_update_time=null → target を即時採用)
    const s1 = Meter.getState();
    expect(s1.tier2_pending_m).toBe(50);
    // target = max(100, gps_predictive=0, 100+50=150) = 150
    expect(s1.display_distance_m).toBeGreaterThanOrEqual(150);
  });

  it('L1321 display は distance_m を下回らない (= 課金距離下限保証)', () => {
    // 大きな distance_m を setDistance で設定
    Meter.setDistance(500);
    const s = Meter.getState();
    // display_distance_m は・最低でも distance_m 以上
    expect(s.display_distance_m).toBeGreaterThanOrEqual(500);
  });

  it('L1305 target は (distance_m + tier2_pending_m) で正方向に動く (= ArithmeticOperator + → -)', () => {
    Meter.setDistance(100);
    // 1 回目: tier2=50 → target=150
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 0,
      tentativeIncrementM: 50,
      snapped: true,
      committed: false,
    });
    const s1 = Meter.getState();
    // 2 回目: tier2=100 (= +50)・短い経過 → target=200 だが maxDelta clamp で漸増
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 0,
      tentativeIncrementM: 50,
      snapped: true,
      committed: false,
    });
    const s2 = Meter.getState();
    // tier2_pending_m が増えたら・display_distance_m は (前回 ≤ now) で単調非減少
    expect(s2.tier2_pending_m).toBe(100);
    expect(s2.display_distance_m).toBeGreaterThanOrEqual(s1.display_distance_m);
  });

  it('L1317 maxDelta clamp 方向: distance_m 急増で display は前回より大きくなる (= diff > 0 path)', () => {
    Meter.setDistance(100);
    const s1 = Meter.getState();
    // 大きく distance_m を増やす (= 急増)
    Meter.setDistance(10000);
    const s2 = Meter.getState();
    // display は L1321 の Math.max で・最低でも 10000 (= distance_m) になる
    expect(s2.display_distance_m).toBeGreaterThanOrEqual(10000);
    expect(s2.display_distance_m).toBeGreaterThan(s1.display_distance_m);
  });
});
