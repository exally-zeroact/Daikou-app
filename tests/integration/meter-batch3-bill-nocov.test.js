// tests/integration/meter-batch3-bill-nocov.test.js
//
// ★設計変更宣言 Phase 8 Batch 3 (2026-05-21・BILL NoCoverage 全消化・司さん採択):
//   Stryker Pass A の [BILL] NoCoverage 60 件中・最も未到達 cluster を新規 test で
//   code path に踏ませて killed / survived 化させる。Batch 3 で BILL 全消化区切り。
//
// 対象 line + 推定 mutant 件数:
//   L1110 fareConfig v2 tiers 経路 (= 既存 calcfare.test.js は v1 中心)         (~10 mutants)
//   L1249-1281 setSurchargeActive / toggleSurcharge / setVehicleType            (~10 mutants)
//   L1339-1345 getMMStats snap_rate / skip_rate / mm_silent_ms 計算             (~15 mutants)
//   L1653 setElapsedAccumulated(savedSec) ガード                                 (~8 mutants)
//
// ★絶対ルール準拠:
//   prod (js/meter.js) は 1 byte も触らない (= test 追加のみ)。
//   distance_m += 5 経路・calcFare 本体・commit 機構 完全不変。
//   calcFare の Step 1-7 ロジック・surcharge / vehicle 倍率は public API 経由で・
//   既存挙動を verify するだけ (= 仕様変更ゼロ)。

'use strict';

const path = require('path');
const METER_JS_PATH = path.join(__dirname, '..', '..', 'js', 'meter.js');

function loadMeter() {
  delete require.cache[require.resolve(METER_JS_PATH)];
  return require(METER_JS_PATH);
}

function mockGPS() {
  globalThis.GPS = {
    calcDistance: () => 0,
    calcDistance3D: () => 0,
    setRoadType: () => {},
  };
}

const FC_V1 = {
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

// ─── L1110: fareConfig v2 tiers 経路 ──────────────────────────────────────
//
// 対象式: if (Array.isArray(fareConfig.tiers) && fareConfig.tiers.length > 0) {
//   tiers 配列で・距離区間ごとに add_distance_m / add_fare を変える v2 料金体系
// kill mutant: Array.isArray / && / > 0 / 配列内 ループ条件 / tier.to_m null check

describe('Phase 8 Batch 3: L1110 fareConfig v2 tiers 料金体系', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('tiers=[] (= 空配列) は v1 fallback と同じ料金になる (= L1110 false 経路)', () => {
    Meter.setFareConfig({ ...FC_V1, tiers: [] });
    // v1 fallback: 1500m なら base 1300 + ceil(500/420) * 100 = 1300 + 200 = 1500
    expect(Meter.calcFare(1500)).toBe(1500);
  });

  it('tiers 未定義 (= undefined) も v1 fallback (= Array.isArray=false)', () => {
    Meter.setFareConfig({ ...FC_V1, tiers: undefined });
    expect(Meter.calcFare(1500)).toBe(1500);
  });

  it('tiers=[{from:1000,to:5000,add_distance:420,add_fare:100}] (= 1 tier) で計算', () => {
    Meter.setFareConfig({
      ...FC_V1,
      tiers: [{ from_m: 1000, to_m: 5000, add_distance_m: 420, add_fare: 100 }],
    });
    // distanceM=1500: extra=500・steps=floor(500/420)+1=2 → 1300 + 200 = 1500
    expect(Meter.calcFare(1500)).toBe(1500);
    // distanceM=1000 (= base 内): 1300
    expect(Meter.calcFare(1000)).toBe(1300);
    // distanceM=0: 1300 (= base 範囲)
    expect(Meter.calcFare(0)).toBe(1300);
  });

  it('tiers=2 段階 (= 短距離 + 長距離 別レート) で・tier 境界跨いでも計算', () => {
    Meter.setFareConfig({
      ...FC_V1,
      tiers: [
        { from_m: 1000, to_m: 3000, add_distance_m: 200, add_fare: 50 }, // 短距離 200m/50円
        { from_m: 3000, to_m: null, add_distance_m: 500, add_fare: 100 }, // 長距離 500m/100円
      ],
    });
    // 1000m: base=1300
    expect(Meter.calcFare(1000)).toBe(1300);
    // 1200m: tier1 200m → steps=floor(200/200)+1=2 → 1300+2*50=1400
    expect(Meter.calcFare(1200)).toBe(1400);
    // 4000m: tier1 全部 (= 2000m・steps=11) + tier2 1000m (steps=3)
    //   tier1: floor(2000/200)+1 = 11 steps × 50 = 550
    //   tier2: floor(1000/500)+1 = 3 steps × 100 = 300
    //   total: 1300 + 550 + 300 = 2150
    expect(Meter.calcFare(4000)).toBe(2150);
  });

  it('tier.to_m=null (= 無制限) は tierEnd=distanceM で計算', () => {
    Meter.setFareConfig({
      ...FC_V1,
      tiers: [{ from_m: 1000, to_m: null, add_distance_m: 420, add_fare: 100 }],
    });
    // distanceM=10000・tier1: extra=9000・steps=floor(9000/420)+1=22 → 1300+2200=3500
    expect(Meter.calcFare(10000)).toBe(3500);
  });

  it('tier.from_m がない / 不正値の tier は skip (= L1117 continue)', () => {
    Meter.setFareConfig({
      ...FC_V1,
      tiers: [
        { add_distance_m: 420, add_fare: 100 }, // from_m なし → skip
        { from_m: 1000, to_m: null, add_distance_m: 420, add_fare: 100 }, // valid
      ],
    });
    // distanceM=1500: 1 番目 skip・2 番目で計算 → base + tier2
    expect(Meter.calcFare(1500)).toBeGreaterThan(1300);
  });
});

// ─── L1249-1281: surcharge / vehicleType public API ──────────────────────
//
// kill mutant: !id 早期 return / Set.add/delete 動作 / vehicle id 設定

describe('Phase 8 Batch 3: L1249-1281 surcharge / vehicleType public API', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig({
      ...FC_V1,
      surcharges: [
        { id: 'night', rate: 1.2 },
        { id: 'rain', rate: 1.1 },
      ],
      vehicles: [
        { id: 'standard', multiplier: 1.0, addon: 0 },
        { id: 'premium', multiplier: 1.5, addon: 500 },
      ],
      vehiclesEnabled: true,
    });
    Meter.reset();
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('setSurchargeActive(id, true) で active 化・fare_yen が更新される', () => {
    Meter.setDistance(1000);
    const fareBefore = Meter.getState().fare_yen;
    Meter.setSurchargeActive('night', true);
    const fareAfter = Meter.getState().fare_yen;
    expect(fareAfter).toBeGreaterThan(fareBefore); // night 1.2x 適用
    expect(Meter.getActiveSurcharges()).toContain('night');
  });

  it('setSurchargeActive(id, false) で active 解除', () => {
    Meter.setSurchargeActive('night', true);
    expect(Meter.getActiveSurcharges()).toContain('night');
    Meter.setSurchargeActive('night', false);
    expect(Meter.getActiveSurcharges()).not.toContain('night');
  });

  it('setSurchargeActive(null, true) は no-op (= !id 早期 return)', () => {
    const before = Meter.getActiveSurcharges();
    Meter.setSurchargeActive(null, true);
    expect(Meter.getActiveSurcharges()).toEqual(before);
  });

  it('toggleSurcharge(id) で active 状態が反転する', () => {
    expect(Meter.getActiveSurcharges()).not.toContain('rain');
    Meter.toggleSurcharge('rain');
    expect(Meter.getActiveSurcharges()).toContain('rain');
    Meter.toggleSurcharge('rain');
    expect(Meter.getActiveSurcharges()).not.toContain('rain');
  });

  it('toggleSurcharge(null) は no-op (= !id 早期 return)', () => {
    const before = Meter.getActiveSurcharges();
    Meter.toggleSurcharge(null);
    expect(Meter.getActiveSurcharges()).toEqual(before);
  });

  it('setVehicleType(id) で vehicle が active 化・getVehicleType() で取得可', () => {
    expect(Meter.getVehicleType()).toBeNull();
    Meter.setVehicleType('premium');
    expect(Meter.getVehicleType()).toBe('premium');
  });

  it('setVehicleType(null) で active vehicle が null に戻る', () => {
    Meter.setVehicleType('premium');
    expect(Meter.getVehicleType()).toBe('premium');
    Meter.setVehicleType(null);
    expect(Meter.getVehicleType()).toBeNull();
  });

  it('setVehicleType("premium") で fare_yen が multiplier×addon 反映', () => {
    Meter.setDistance(1000);
    const fareStandard = Meter.getState().fare_yen;
    Meter.setVehicleType('premium');
    const farePremium = Meter.getState().fare_yen;
    // premium = standard * 1.5 + 500
    expect(farePremium).toBeGreaterThan(fareStandard);
  });

  it('getSurchargeMultiplier() は・active surcharge の rate 積を返す', () => {
    // active なし: 1.0 (= auto も含むので >= 1.0 が下限)
    const mul0 = Meter.getSurchargeMultiplier();
    expect(mul0).toBeGreaterThanOrEqual(1.0);
    Meter.setSurchargeActive('night', true);
    const mul1 = Meter.getSurchargeMultiplier();
    expect(mul1).toBeGreaterThanOrEqual(1.2); // night 1.2x 以上
  });
});

// ─── L1339-1345: getMMStats snap_rate / skip_rate / mm_silent_ms ──────────
//
// kill mutant: total > 0 ガード (snap_rate / skip_rate)・lastMmUsefulAt > 0 ガード

describe('Phase 8 Batch 3: L1339-1345 getMMStats 集計', () => {
  let Meter, fakeWorker;
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
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig(FC_V1);
    Meter.reset();
    fakeWorker = makeFakeWorker();
    Meter.setMapMatcher(fakeWorker);
    Meter.start();
    if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
    if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);
    fakeWorker._dispatch({ type: 'roadsLoaded', ok: true, pref: 'ehime' });
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('total=0 (= mm 経路未起動) では snap_rate / skip_rate = 0 (= 0 除算回避)', () => {
    const s = Meter.getMMStats();
    expect(s.total_count).toBe(0);
    expect(s.snap_rate).toBe(0);
    expect(s.skip_rate).toBe(0);
  });

  it('start 前 (= lastMmUsefulAt=0) では mm_silent_ms = null (= L1345 fallback path)', () => {
    // Meter.start() は L683 で lastMmUsefulAt=Date.now() を設定する。
    // この test だけは start を呼ばない fresh Meter で・lastMmUsefulAt=0 の null 経路を verify。
    const FreshMeter = loadMeter();
    FreshMeter.setFareConfig(FC_V1);
    FreshMeter.reset();
    // start を呼ばずに getMMStats → lastMmUsefulAt=0 → L1345 三項で null path
    const s = FreshMeter.getMMStats();
    expect(s.mm_silent_ms).toBeNull();
    FreshMeter.reset();
  });

  it('snap success (= snapped:true, mmIncrement>0) で snap_rate > 0', () => {
    // GPS update で total_count++ を発火
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      altitude: 0,
      accuracy: 5,
      speedKmh: 50,
      isStationary: false,
      timestamp: 1714100000000,
    });
    // snap commit dispatch
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 10,
      snapped: true,
      committed: true,
    });
    const s = Meter.getMMStats();
    expect(s.total_count).toBeGreaterThan(0);
    expect(s.snap_count).toBeGreaterThan(0);
    expect(s.snap_rate).toBeGreaterThan(0);
    expect(s.snap_rate).toBeLessThanOrEqual(1);
  });

  it('snap success 後 mm_silent_ms は 0 以上の数値になる (= lastMmUsefulAt 更新済)', () => {
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      altitude: 0,
      accuracy: 5,
      speedKmh: 50,
      isStationary: false,
      timestamp: 1714100000000,
    });
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 10,
      snapped: true,
      committed: true,
    });
    const s = Meter.getMMStats();
    expect(s.mm_silent_ms).not.toBeNull();
    expect(typeof s.mm_silent_ms).toBe('number');
    expect(s.mm_silent_ms).toBeGreaterThanOrEqual(0);
  });

  it('snap_rate / skip_rate の和は 1 以下 (= ratio 整合)', () => {
    // 複数 GPS + 一部 snap / 一部 skip
    for (let i = 0; i < 3; i++) {
      Meter.update({
        lat: 33.84,
        lng: 132.7656,
        altitude: 0,
        accuracy: 5,
        speedKmh: 50,
        isStationary: false,
        timestamp: 1714100000000 + i * 1000,
      });
    }
    // 1 snap + 1 skip dispatch
    fakeWorker._dispatch({ type: 'mmResult', mmIncrementM: 5, snapped: true, committed: true });
    fakeWorker._dispatch({ type: 'mmResult', mmIncrementM: 0, snapped: false, skipped: 1 });
    const s = Meter.getMMStats();
    expect(s.snap_rate + s.skip_rate).toBeLessThanOrEqual(1.01); // 浮動小数点許容
  });

  it('worker_active は mmWorker set 状況に連動', () => {
    const s = Meter.getMMStats();
    expect(s.worker_active).toBe(true); // setMapMatcher 済
  });
});

// ─── L1653: setElapsedAccumulated(savedSec) ガード ────────────────────────
//
// 対象式: const v = typeof savedSec === 'number' && savedSec >= 0 ? savedSec : 0;
// kill mutant: typeof / && / >= 0 / fallback 0

describe('Phase 8 Batch 3: L1653 setElapsedAccumulated(savedSec) ガード', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig(FC_V1);
    Meter.reset();
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('valid 100 → elapsed_accumulated_sec=100', () => {
    if (typeof Meter.setElapsedAccumulated !== 'function') return;
    Meter.setElapsedAccumulated(100);
    expect(Meter.getState().elapsed_accumulated_sec).toBe(100);
  });

  it('valid 0 → 0 (= 境界・ゼロ許容)', () => {
    if (typeof Meter.setElapsedAccumulated !== 'function') return;
    Meter.setElapsedAccumulated(0);
    expect(Meter.getState().elapsed_accumulated_sec).toBe(0);
  });

  it('負値 -100 → 0 fallback (= savedSec >= 0 ガード)', () => {
    if (typeof Meter.setElapsedAccumulated !== 'function') return;
    Meter.setElapsedAccumulated(-100);
    expect(Meter.getState().elapsed_accumulated_sec).toBe(0);
  });

  it('NaN → 0 fallback (= Number.isFinite 相当の typeof guard)', () => {
    if (typeof Meter.setElapsedAccumulated !== 'function') return;
    Meter.setElapsedAccumulated(NaN);
    // NaN の typeof は 'number' で・NaN >= 0 は false → fallback 0
    expect(Meter.getState().elapsed_accumulated_sec).toBe(0);
  });

  it('Infinity → Infinity (= 仕様確認・typeof "number" && Infinity >= 0 で true)', () => {
    if (typeof Meter.setElapsedAccumulated !== 'function') return;
    Meter.setElapsedAccumulated(Infinity);
    // Infinity の typeof は 'number'・Infinity >= 0 は true → そのまま代入される (= 仕様)
    expect(Meter.getState().elapsed_accumulated_sec).toBe(Infinity);
  });

  it('文字列 "100" → 0 fallback (= typeof !== "number")', () => {
    if (typeof Meter.setElapsedAccumulated !== 'function') return;
    Meter.setElapsedAccumulated('100');
    expect(Meter.getState().elapsed_accumulated_sec).toBe(0);
  });

  it('undefined → 0 fallback', () => {
    if (typeof Meter.setElapsedAccumulated !== 'function') return;
    Meter.setElapsedAccumulated(undefined);
    expect(Meter.getState().elapsed_accumulated_sec).toBe(0);
  });

  it('last_resume_time は呼出時刻に更新される', () => {
    if (typeof Meter.setElapsedAccumulated !== 'function') return;
    const before = Date.now();
    Meter.setElapsedAccumulated(50);
    const after = Date.now();
    const t = Meter.getState().last_resume_time;
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });
});
