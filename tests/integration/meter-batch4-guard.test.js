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
//   表示 maxDelta clamp ── docs only (2026-05-27 表示1モデル化で再構成・下記)
//
// ★絶対ルール準拠:
//   prod (js/*) 1 byte も触らない (= test 追加のみ)。distance_m 加算 5 経路・calcFare 本体・
//   commit 機構 完全不変。追加 test は public API + 既存 fakeWorker dispatch で・既存挙動を
//   verify するだけ (= 仕様変更ゼロ)。
//
// 表示 clamp docs (= 2026-05-27 表示1モデル化で構造変更):
//   旧: if(diff<=maxDelta) display=target / else maxDelta clamp + 直後 瞬間 floor
//       display=Math.max(display, distance_m) で常に距離以上に強制補正(観測不能の主因)。
//   新: 瞬間 floor を撤廃 → display += Math.min(diff, maxDelta)・distance_m 下回り時のみ同レート catch-up。
//   影響: floor 撤去で clamp 方向 mutant の観測性が変わる → Stryker の実 survivor は run 結果で確認。
//   ※ display_distance_m は表示専用・distance_m / calcFare は 1byte 不変 (課金 kill 率に影響なし)。

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

// ★白紙書き直し (2026-05-30・clean-rebuild-pipeline): off-road / gap fill / _trackHaversineBetweenGps /
//   physMax / snap-miss skip gate の describe ブロックは・対象 helper が新メーターで廃止されたため削除。
//   存続する calcFare vehicles 倍率 / rounding ガードのみ残す (= calcFare は 1byte 不変移植)。

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
