// tests/integration/meter-batch4-guard.test.js
//
// ★設計変更宣言 Phase 8 Batch 4 (2026-05-21・GUARD 高密度 mutant kill・司さん採択):
//   非課金判定 layer (= accuracy / dtSec / physMax / mmResult skip / vehicles / rounding) を
//   既存挙動 verify で kill する。距離機構・課金経路は完全不変。
//
// 対象 line + 推定 mutant 件数:
//   L292-293  _trackHaversineBetweenGps accuracy gate (= 上下流 ±50m)   (~8 mutants)
//   L340-341  _calculateOffRoadIncrement accuracy gate (同上)             (~8 mutants)
//   L294 / L342 dtSec <=0 / > 60 ガード                                    (~12 mutants)
//   L302 / L349 physMaxM 計算 + d > physMaxM 上限                          (~8 mutants)
//   L490 mmResult skip gate (= snap miss 連続検出条件)                     (~6 mutants)
//   L1161 calcFare vehicles 倍率 gate                                       (~5 mutants)
//   L1211 calcFare rounding ガード                                          (~5 mutants)
//   L1314 display maxDelta clamp ── docs only (L1321 Math.max で隠蔽・既出)
//
// ★絶対ルール準拠:
//   prod (js/*) 1 byte も触らない (= test 追加のみ)。distance_m 加算 5 経路・calcFare 本体・
//   commit 機構 完全不変。追加 test は public API + 既存 fakeWorker dispatch で・既存挙動を
//   verify するだけ (= 仕様変更ゼロ)。
//
// L1314 docs (= 観測不能・無理に kill しない):
//   `if (Math.abs(diff) <= maxDelta)` → display = target / else → diff 方向に maxDelta clamp。
//   但し直後 L1321 `display = Math.max(display, state.distance_m || 0)` で・**display は
//   常に distance_m 以上に強制補正**される (= 課金距離下回らない設計・defense-in-depth)。
//   結果: L1314 の clamp 方向の差異は・L1321 で吸収され観測不能。Batch 1 既出 L1317 と同様。
//   → 課金 kill 率の真の分母から除外 (= docs 明記のみ)。

'use strict';

const path = require('path');
const METER_JS_PATH = path.join(__dirname, '..', '..', 'js', 'meter.js');

function loadMeter() {
  delete require.cache[require.resolve(METER_JS_PATH)];
  return require(METER_JS_PATH);
}

const FC = {
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
    addEventListener(t, h) {
      if (t === 'message') handlers.push(h);
    },
    removeEventListener(t, h) {
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
  Meter.setFareConfig(FC);
  Meter.reset();
  const fakeWorker = makeFakeWorker();
  Meter.setMapMatcher(fakeWorker);
  if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);
  fakeWorker._dispatch({ type: 'roadsLoaded', ok: true, pref: 'ehime' });
  return { Meter, fakeWorker };
}

const baseTs = 1714100000000;
function gps(stepIdx, opts) {
  opts = opts || {};
  return {
    lat: opts.lat != null ? opts.lat : 33.84 + 0.000225 * stepIdx, // 25m 北 / step
    lng: opts.lng != null ? opts.lng : 132.7656,
    altitude: 0,
    accuracy: opts.accuracy != null ? opts.accuracy : 5,
    speedKmh: opts.speedKmh != null ? opts.speedKmh : 50,
    isStationary: false,
    timestamp: opts.ts != null ? opts.ts : baseTs + stepIdx * 1000,
  };
}
function snapMiss() {
  return { type: 'mmResult', mmIncrementM: 0, snapped: false, skipped: 1, committed: false };
}

// ─── L292-293: _trackHaversineBetweenGps accuracy gate ───────────────────
//
// 対象式:
//   if (gpsResult.accuracy != null && gpsResult.accuracy > 50) return;          ← L292
//   if (state.last_gps.accuracy != null && state.last_gps.accuracy > 50) return; ← L293
//
// 観測: _haverAccumSinceLastCommit 累積 → 5 snap miss で Off-Road retroactive → state.distance_m

describe('Phase 8 Batch 4: L292-293 _trackHaversineBetweenGps accuracy gate (= 上下流 50m)', () => {
  let Meter, fakeWorker;
  beforeEach(() => {
    ({ Meter, fakeWorker } = setupMeter());
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('accuracy=5 (= 高精度) GPS 連続 → retroactive add で distance_m 増加 (= gate 通過)', () => {
    for (let i = 0; i <= 5; i++) Meter.update(gps(i, { accuracy: 5 }));
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    expect(Meter.getState().distance_m).toBeGreaterThan(50); // ~125m 加算
  });

  it('accuracy=100 (= 低精度・> 50) GPS 連続 → _haverAccum 累積されず・retroactive add ゼロ', () => {
    for (let i = 0; i <= 5; i++) Meter.update(gps(i, { accuracy: 100 }));
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    expect(Meter.getState().distance_m).toBe(0); // 累積ゼロ → retroactive 0
  });

  it('accuracy=50 (= 境界・= 50 は通過) → retroactive add で distance_m 増加', () => {
    for (let i = 0; i <= 5; i++) Meter.update(gps(i, { accuracy: 50 }));
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    expect(Meter.getState().distance_m).toBeGreaterThan(50);
  });

  it('accuracy=51 (= 境界外・> 50) → 累積されず・retroactive add ゼロ', () => {
    for (let i = 0; i <= 5; i++) Meter.update(gps(i, { accuracy: 51 }));
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    expect(Meter.getState().distance_m).toBe(0);
  });
});

// ─── L340-341: _calculateOffRoadIncrement accuracy gate ──────────────────
//
// 対象式:
//   if (gpsResult.accuracy != null && gpsResult.accuracy > 50) return 0;          ← L340
//   if (state.last_gps.accuracy != null && state.last_gps.accuracy > 50) return 0;← L341
//
// 観測: Off-Road active 中の追加 update での state.distance_m delta

describe('Phase 8 Batch 4: L340-341 _calculateOffRoadIncrement accuracy gate', () => {
  let Meter, fakeWorker;
  beforeEach(() => {
    ({ Meter, fakeWorker } = setupMeter());
    // Off-Road 起動
    for (let i = 0; i <= 5; i++) Meter.update(gps(i, { accuracy: 5 }));
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('Off-Road 中・accuracy=5 (= 高精度) → incremental 加算 (~25m)', () => {
    const before = Meter.getState().distance_m;
    Meter.update(gps(6, { accuracy: 5 }));
    expect(Meter.getState().distance_m - before).toBeGreaterThan(20);
  });

  it('Off-Road 中・accuracy=100 (= > 50) → incremental 加算ゼロ', () => {
    const before = Meter.getState().distance_m;
    Meter.update(gps(6, { accuracy: 100 }));
    expect(Meter.getState().distance_m).toBe(before);
  });

  it('Off-Road 中・accuracy=50 (= 境界・= 50 は通過) → 加算', () => {
    const before = Meter.getState().distance_m;
    Meter.update(gps(6, { accuracy: 50 }));
    expect(Meter.getState().distance_m - before).toBeGreaterThan(20);
  });

  it('Off-Road 中・accuracy=51 (= 境界外・> 50) → 加算ゼロ', () => {
    const before = Meter.getState().distance_m;
    Meter.update(gps(6, { accuracy: 51 }));
    expect(Meter.getState().distance_m).toBe(before);
  });
});

// ─── L294 / L342: dtSec <= 0 || dtSec > 60 ガード ─────────────────────────
//
// 対象式: if (dtSec <= 0 || dtSec > 60) return;
// 観測: _trackHaversineBetweenGps と _calculateOffRoadIncrement の両方で同じ条件

describe('Phase 8 Batch 4: L294 / L342 dtSec ガード (= 0 < dt <= 60 秒のみ加算)', () => {
  let Meter, fakeWorker;
  beforeEach(() => {
    ({ Meter, fakeWorker } = setupMeter());
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('dtSec=1 (= 通常) → _haverAccum 蓄積 (= retroactive 加算で確認)', () => {
    Meter.update(gps(0));
    Meter.update(gps(1)); // dtSec=1
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    expect(Meter.getState().distance_m).toBeGreaterThan(20);
  });

  it('dtSec=0 (= 同 timestamp) → _haverAccum 蓄積されず', () => {
    Meter.update(gps(0));
    // 同 timestamp で 2 回目
    Meter.update({ ...gps(0), lat: 33.840225 }); // 同 ts・別座標
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    expect(Meter.getState().distance_m).toBe(0);
  });

  it('dtSec=-1 (= 巻き戻し) → _haverAccum 蓄積されず', () => {
    Meter.update(gps(2)); // baseTs + 2000
    // 巻き戻し: baseTs + 1000
    Meter.update({ ...gps(0), lat: 33.840225, timestamp: baseTs + 1000 });
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    expect(Meter.getState().distance_m).toBe(0);
  });

  it('dtSec=60 (= 境界・= 60 は通過) + gap fill 経路で distance_m > 0', () => {
    // 注: dtSec >= 5 で gap fill 経路 (= L949) が並行発火する設計
    // _trackHaversineBetweenGps の L294 ガード単独観測は・gap fill が dtSec >= 5 を
    // 先に拾うため structurally 不可能。本 test は dtSec=60 で gap fill 経由の蓄積を verify。
    Meter.update(gps(0));
    Meter.update({ ...gps(0), lat: 33.840225, timestamp: baseTs + 60000 });
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    expect(Meter.getState().distance_m).toBeGreaterThan(0);
  });

  // L294 / L342 の `dtSec > 60` ガード単独観測は不可能 (= 等価相当・docs):
  //   dtSec >= 5 では・gap fill (= L949) が同 update 内で先行発火し distance_m に gap fill 由来の
  //   値が加算される。_trackHaversineBetweenGps の L294 でガードされた `_haverAccumSinceLastCommit`
  //   は・gap fill の L966 で resetされるため・retroactive 加算 (= L514) への寄与もゼロになる。
  //   結果: dtSec=60 と dtSec=61 で distance_m の最終値に有意差を観測できない。
  //   → L294 `dtSec > 60` の片側 mutant は structural equivalent・kill 対象外として docs 明記。
});

// ─── L302 / L349: physMaxM 物理上限 ───────────────────────────────────────
//
// 対象式: physMaxM = (160 / 3.6) * Math.max(1, dtSec) + 5;  ← L302 / L349
//        if (d > physMaxM) return [0];                       ← L303 / L350
// 観測: GPS jump (> physMax) で蓄積されないこと

describe('Phase 8 Batch 4: L302 / L349 physMaxM 物理上限 (= 160 km/h cap)', () => {
  let Meter, fakeWorker;
  beforeEach(() => {
    ({ Meter, fakeWorker } = setupMeter());
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('通常移動 (~25m / 1秒・= 90km/h) → 蓄積される (= physMax 49.4m 内)', () => {
    Meter.update(gps(0));
    Meter.update(gps(1)); // 25m 北
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    expect(Meter.getState().distance_m).toBeGreaterThan(20);
  });

  it('GPS jump (~200m / 1秒・= 720km/h) → 蓄積されず (= physMax 超過)', () => {
    Meter.update(gps(0));
    // 200m 北 / 1秒 → 720 km/h・physMax 49.4m を遥かに超過
    Meter.update({ ...gps(0), lat: 33.84 + 0.0018, timestamp: baseTs + 1000 });
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    expect(Meter.getState().distance_m).toBe(0);
  });

  it('境界付近: 40m / 1秒 (= ~144 km/h・物理上限内) → 蓄積', () => {
    Meter.update(gps(0));
    // 40m 北 ≈ 144 km/h
    Meter.update({ ...gps(0), lat: 33.84 + 0.00036, timestamp: baseTs + 1000 });
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    expect(Meter.getState().distance_m).toBeGreaterThan(30);
  });

  it('Off-Road 中・GPS jump (= 1km 級・physMax 大幅超) → incremental 加算ゼロ (= L350 経路)', () => {
    // 起動 (= 5 step 蓄積後・5 snap miss で Off-Road on)
    for (let i = 0; i <= 5; i++) Meter.update(gps(i));
    for (let k = 0; k < 5; k++) fakeWorker._dispatch(snapMiss());
    const before = Meter.getState().distance_m;
    // state.last_gps.lat ≈ 33.84 + 0.001125 (= gps(5) の値)
    // 新 lat 33.84 + 0.01 → 0.008875 度 ≈ 985m 移動 / 1 秒・physMax (dtSec=1) = 49.4m 大幅超
    Meter.update({ ...gps(0), lat: 33.84 + 0.01, timestamp: baseTs + 6000 });
    expect(Meter.getState().distance_m).toBe(before); // 加算ゼロ (= jump 棄却)
  });
});

// ─── L490: mmResult skip gate (= snap miss 連続検出条件) ───────────────
//
// 対象式: m.skipped || (typeof m.mmIncrementM === 'number' && m.mmIncrementM === 0 && !m.committed)
// 観測: _consecutiveSnapMiss++ → 5 連続で Off-Road 起動 (offroad_count=1)

describe('Phase 8 Batch 4: L490 mmResult skip gate (= snap miss 連続検出)', () => {
  let Meter, fakeWorker;
  beforeEach(() => {
    ({ Meter, fakeWorker } = setupMeter());
    for (let i = 0; i <= 5; i++) Meter.update(gps(i));
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('skipped=1 を 5 件 dispatch → Off-Road 起動 (offroad_count=1)', () => {
    for (let k = 0; k < 5; k++)
      fakeWorker._dispatch({
        type: 'mmResult',
        mmIncrementM: 0,
        snapped: false,
        skipped: 1,
        committed: false,
      });
    expect(Meter.getState().offroad_count).toBe(1);
  });

  it('mmIncrementM=0 & committed=false & snapped=false を 5 件 → Off-Road 起動 (= L490 後半 path)', () => {
    for (let k = 0; k < 5; k++)
      fakeWorker._dispatch({
        type: 'mmResult',
        mmIncrementM: 0,
        snapped: false,
        committed: false,
      });
    expect(Meter.getState().offroad_count).toBe(1);
  });

  it('mmIncrementM=0 & committed=true (= L490 !committed で false) → snap miss 扱いせず', () => {
    // committed=true の 5 件は・else if path に入らない → _consecutiveSnapMiss 増えない
    for (let k = 0; k < 5; k++)
      fakeWorker._dispatch({
        type: 'mmResult',
        mmIncrementM: 0,
        snapped: false,
        committed: true,
      });
    expect(Meter.getState().offroad_count).toBe(0);
  });

  it('snapped=true → _consecutiveSnapMiss reset (= else if 分岐に入らない)', () => {
    // 4 件 snap miss
    for (let k = 0; k < 4; k++) fakeWorker._dispatch(snapMiss());
    // ここで snap success
    fakeWorker._dispatch({ type: 'mmResult', mmIncrementM: 50, snapped: true, committed: true });
    // さらに 4 件 snap miss → 累積 4 (= 5 未満) → Off-Road 起動しない
    for (let k = 0; k < 4; k++) fakeWorker._dispatch(snapMiss());
    expect(Meter.getState().offroad_count).toBe(0);
  });
});

// ─── L1161: calcFare vehicles 倍率 gate ──────────────────────────────────
//
// 対象式: if (fareConfig.vehiclesEnabled && _activeVehicleId && Array.isArray(fareConfig.vehicles)) {
// 観測: vehicle multiplier 適用 / 不適用での calcFare 差

describe('Phase 8 Batch 4: L1161 calcFare vehicles 倍率 gate', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('vehiclesEnabled=true + 有効 vehicle id → multiplier 適用', () => {
    Meter.setFareConfig({
      ...FC,
      vehiclesEnabled: true,
      vehicles: [{ id: 'premium', multiplier: 2.0, addon: 0 }],
    });
    Meter.setVehicleType('premium');
    // 1000m: base 1300・multiplier 2.0 → 2600
    expect(Meter.calcFare(1000)).toBe(2600);
  });

  it('vehiclesEnabled=false → 倍率適用なし (= 通常料金)', () => {
    Meter.setFareConfig({
      ...FC,
      vehiclesEnabled: false,
      vehicles: [{ id: 'premium', multiplier: 2.0, addon: 0 }],
    });
    Meter.setVehicleType('premium');
    expect(Meter.calcFare(1000)).toBe(1300);
  });

  it('_activeVehicleId=null (= 未選択) → 倍率適用なし', () => {
    Meter.setFareConfig({
      ...FC,
      vehiclesEnabled: true,
      vehicles: [{ id: 'premium', multiplier: 2.0, addon: 0 }],
    });
    Meter.setVehicleType(null);
    expect(Meter.calcFare(1000)).toBe(1300);
  });

  it('fareConfig.vehicles が Array でない (= undefined) → 適用なし', () => {
    Meter.setFareConfig({ ...FC, vehiclesEnabled: true, vehicles: undefined });
    Meter.setVehicleType('premium');
    expect(Meter.calcFare(1000)).toBe(1300);
  });
});

// ─── L1211: calcFare rounding ガード ──────────────────────────────────────
//
// 対象式: typeof fareConfig.rounding === 'number' && fareConfig.rounding > 0 ? fareConfig.rounding : 1;
// 観測: 丸め単位の動作

describe('Phase 8 Batch 4: L1211 calcFare rounding ガード', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('rounding=10 → 10 円単位丸め (= unit=10 path)', () => {
    Meter.setFareConfig({ ...FC, rounding: 10, surcharges: [{ id: 'r25', rate: 1.025 }] });
    // base 1300 × 1.025 = 1332.5 (FP 1332.499...) → unit=10 → Math.round(133.249.../1)*10 ≈ 1330
    Meter.setSurchargeActive('r25', true);
    const fare = Meter.calcFare(1000);
    expect(fare % 10).toBe(0); // 10 円単位
    // unit=10 で Math.round(fare/10) * 10・FP 1332.49 → 133.249 → round → 133 → *10 → 1330
    expect(fare).toBeGreaterThanOrEqual(1330);
    expect(fare).toBeLessThanOrEqual(1340);
  });

  it('rounding=100 → 100 円単位', () => {
    Meter.setFareConfig({ ...FC, rounding: 100 });
    // base 1300 → 100 単位なら 1300 (= 既に整合)
    expect(Meter.calcFare(1000) % 100).toBe(0);
  });

  it('rounding=0 (= 無効値) → 1 円単位 fallback (= unit=1・surcharge 適用後 Math.round)', () => {
    Meter.setFareConfig({ ...FC, rounding: 0, surcharges: [{ id: 'r25', rate: 1.025 }] });
    Meter.setSurchargeActive('r25', true);
    // 1300 × 1.025 ≈ 1332.5 → unit=1 → Math.round → 1332 or 1333 (FP 依存)
    const fare = Meter.calcFare(1000);
    expect(Number.isInteger(fare)).toBe(true);
    expect(fare).toBeGreaterThanOrEqual(1332);
    expect(fare).toBeLessThanOrEqual(1333);
  });

  it('rounding=undefined → 1 円単位 fallback (= unit=1)', () => {
    Meter.setFareConfig({ ...FC, rounding: undefined, surcharges: [{ id: 'r25', rate: 1.025 }] });
    Meter.setSurchargeActive('r25', true);
    const fare = Meter.calcFare(1000);
    expect(Number.isInteger(fare)).toBe(true);
    expect(fare).toBeGreaterThanOrEqual(1332);
    expect(fare).toBeLessThanOrEqual(1333);
  });

  it('rounding 文字列 → 1 円単位 fallback (= typeof !== "number")', () => {
    Meter.setFareConfig({ ...FC, rounding: '10' });
    // typeof '10' === 'string' → unit=1 → Math.round(1300) = 1300
    expect(Meter.calcFare(1000)).toBe(1300);
  });

  it('rounding=負値 → 1 円単位 fallback (= > 0 false)', () => {
    Meter.setFareConfig({ ...FC, rounding: -5 });
    expect(Meter.calcFare(1000)).toBe(1300);
  });
});
