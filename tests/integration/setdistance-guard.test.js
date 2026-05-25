// tests/integration/setdistance-guard.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・★設計変更宣言・setDistance ガード verify)
//
// 検証対象: meter.js L1177 setDistance() Number.isFinite() && >= 0 ガード
//   修正前: state.distance_m = distanceM (= 直接代入・NaN/Infinity/負値 汚染)
//   修正後: Number.isFinite() && >= 0 ガードで 0 fallback
//
// 検出経緯 (= 2026-05-18 Opus 4.7 P0 検証):
//   Meter.setDistance(NaN) → state.distance_m=NaN (= 汚染) を node スクラッチで確認。
//   localStorage 復元等で valid 値以外が入った場合の課金 fail リスク事象。
//
// 絶対ルール準拠:
//   既存 valid 値での挙動完全不変・distance_m 加算経路 (Tier1/Off-Road/gap-fill/incremental) 無変更。
//
// ─── ★ Phase 8 ①-A (2026-05-21): equivalent mutant 明記 ────────────────────────
//
// meter.js L1364 EqualityOperator mutation: `distanceM >= 0` → `distanceM > 0`
//   この mutation は **数学的に等価 (equivalent mutant)** で kill 不可能:
//
//     条件式:        Number.isFinite(distanceM) && distanceM >= 0 ? distanceM : 0
//     mutation 条件: Number.isFinite(distanceM) && distanceM >  0 ? distanceM : 0
//
//   入力ごとの v (= 三項演算子の結果) 比較:
//     - distanceM = 0    : 旧 true → 0  /  新 false → 0 (fallback) → **同値 0**
//     - distanceM = 0.5  : 旧 true → 0.5/  新 true  → 0.5         → **同値 0.5**
//     - distanceM = 100  : 旧 true → 100/  新 true  → 100         → **同値 100**
//     - distanceM = -1   : 旧 false → 0/   新 false → 0           → **同値 0**
//     - distanceM = NaN  : 旧 false → 0/   新 false → 0           → **同値 0**
//     - distanceM = Infinity : 旧 false → 0/  新 false → 0         → **同値 0**
//
//   → 全入力で v 完全同一 → state.distance_m 同一 → state.fare_yen 同一 → 観測不能
//   → 課金 5 経路 mutation kill 率の真の分母から除外: 26 / 26 = 100% kill
//   → Stryker survived 報告には残るが・テスト追加で kill 不可な構造的等価 mutation
//
// 本ファイル内の動的 test (= NaN / Infinity / 負値 fallback verify) は・既に「ガード機能の
// 機能的正しさ」を verify している。等価 mutation の存在自体は Stryker 限界であり・
// テスト品質の問題ではない。

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

describe('setDistance ガード (★設計変更宣言・2026-05-18)', () => {
  let Meter;
  beforeEach(() => {
    globalThis.GPS = { calcDistance: () => 0, calcDistance3D: () => 0 };
    Meter = loadMeter();
    Meter.setFareConfig(FC);
    Meter.reset();
    Meter.start();
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('NaN → 0 fallback', () => {
    Meter.setDistance(NaN);
    expect(Meter.getState().distance_m).toBe(0);
  });

  it('Infinity → 0 fallback', () => {
    Meter.setDistance(Infinity);
    expect(Meter.getState().distance_m).toBe(0);
  });

  it('-Infinity → 0 fallback', () => {
    Meter.setDistance(-Infinity);
    expect(Meter.getState().distance_m).toBe(0);
  });

  it('負値 -100 → 0 fallback', () => {
    Meter.setDistance(-100);
    expect(Meter.getState().distance_m).toBe(0);
  });

  it('valid 500 → 500 (= 既存挙動維持)', () => {
    Meter.setDistance(500);
    expect(Meter.getState().distance_m).toBe(500);
  });

  it('valid 0 → 0 (= 境界・ゼロ許容)', () => {
    Meter.setDistance(0);
    expect(Meter.getState().distance_m).toBe(0);
  });

  it('文字列 "500" → 0 fallback (= Number.isFinite で string reject)', () => {
    Meter.setDistance('500');
    expect(Meter.getState().distance_m).toBe(0);
  });

  it('undefined → 0 fallback', () => {
    Meter.setDistance(undefined);
    expect(Meter.getState().distance_m).toBe(0);
  });

  it('fare_yen も連動して有限値 (= NaN 入力でも calcFare(0)=base_fare)', () => {
    Meter.setDistance(NaN);
    const s = Meter.getState();
    expect(Number.isFinite(s.fare_yen)).toBe(true);
    expect(s.fare_yen).toBe(1300); // base_fare (= calcFare(0))
  });
});
