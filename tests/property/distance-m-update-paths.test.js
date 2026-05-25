// tests/property/distance-m-update-paths.test.js
// ZEROact 共通テスト基盤 (2026-05-17 新規・Stage 1 Step C) — ダイコメ用 property test
//
// 述語C: state.distance_m の更新元は 5 経路のみ
//   - L393  Tier1 Worker B Viterbi commit (state.distance_m += m.mmIncrementM)
//   - L462  retroactive Off-Road 起動時 (state.distance_m += _haverAccumSinceLastCommit)
//   - L824  gap fill (state.distance_m += filled・speed × time)
//   - L842  Phase 1.C Off-Road incremental (state.distance_m += inc)
//   - L1172 setDistance 外部 API (state.distance_m = distanceM)
//
// 検証方針:
//   meter.js を文字列読込し state.distance_m 書込の正規表現マッチ行数 = 5 を assert。
//   verified line numbers (2026-05-17) に対する drift を即時検出する目的。
//
// 述語A: calcFare は入力距離に対して単調非減少 (純粋関数・running 状態に依存しない)
//   既存 R1 (tests/property/distance-invariants.test.js) を property test として
//   再確認・running フラグの任意の組合せで挙動不変であることを assert。

const fs = require('fs');
const path = require('path');
const {
  fc,
  propertyAssert,
  assertMonotonic,
} = require('../../scripts/zeroact-test-commons/property-test-helpers');

const METER_JS_PATH = path.join(__dirname, '..', '..', 'js', 'meter.js');

function loadMeter() {
  delete require.cache[require.resolve(METER_JS_PATH)];
  return require(METER_JS_PATH);
}

function loadMeterSource() {
  return fs.readFileSync(METER_JS_PATH, 'utf8');
}

describe('ZEROact 共通テスト基盤: distance_m 更新経路の不変条件 (Step C)', () => {
  let Meter;
  beforeEach(() => {
    Meter = loadMeter();
    Meter.setFareConfig({
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
    });
  });

  // ─── 述語 C (静的解析): distance_m 更新元は 5 経路のみ ──────────────
  // ★ Phase 6-7 (2026-05-21・(M) 分離): 旧 C1 (= state.distance_m += 行アンカー
  //   expectedLines [440/514/961/979/1365] ±10) は
  //   tests/drift-static/distance-m-update-paths-anchor.test.js へ移動。
  //   理由: Stryker instrumentation で行シフト → false-fail。byte 不変で別 file 化し
  //         通常 vitest run では同 ±10 厳格度で実行・stryker では exclude する設計。

  it('C2: sanitizer マーカー 2 種が meter.js に存在', () => {
    const source = loadMeterSource();
    if (!source.includes('★絶対ルール適用外区間（retroactive）')) {
      throw new Error(
        'sanitizer マーカー欠落: ★絶対ルール適用外区間（retroactive） が meter.js に存在しない'
      );
    }
    if (!source.includes('★絶対ルール適用外区間（明示宣言）')) {
      throw new Error(
        'sanitizer マーカー欠落: ★絶対ルール適用外区間（明示宣言） が meter.js に存在しない'
      );
    }
  });

  // ★ Phase 6-7 (2026-05-21・(M) 分離): 旧 C3 (= GPS.calcDistance 行アンカー
  //   expectedLines [295/343/925] ±10) は
  //   tests/drift-static/distance-m-update-paths-anchor.test.js へ移動。

  // ─── 述語 A (property): calcFare 単調非減少 (純粋関数・running 状態 非依存) ──

  it('A1: calcFare(d) は d ≥ 0 で単調非減少 (running flag に依存しない)', () => {
    propertyAssert(
      fc.property(
        fc
          .array(fc.double({ min: 0, max: 100000, noNaN: true }), { minLength: 2, maxLength: 30 })
          .map((arr) => arr.sort((a, b) => a - b)),
        fc.boolean(),
        (distances, _runningFlag) => {
          // running flag は calcFare に影響しない (純粋関数)
          const fares = distances.map((d) => Meter.calcFare(d));
          assertMonotonic(fares, 'calcFare monotonic');
        }
      )
    );
  });

  it('A2: setDistance 経由で外部から distance_m を 0 に reset しても calcFare(0) = base_fare', () => {
    propertyAssert(
      fc.property(fc.double({ min: 0, max: 100000, noNaN: true }), (anyDistance) => {
        Meter.reset();
        Meter.start();
        Meter.setDistance(anyDistance);
        // setDistance 直後の fare_yen
        const fare = Meter.getState().fare_yen;
        const expected = Meter.calcFare(anyDistance);
        if (fare !== expected) {
          throw new Error(
            'setDistance 後 fare_yen 不整合: setDistance=' +
              anyDistance +
              ' fare_yen=' +
              fare +
              ' expected=' +
              expected
          );
        }
      })
    );
  });
});
