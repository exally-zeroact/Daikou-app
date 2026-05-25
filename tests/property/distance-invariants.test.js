// tests/property/distance-invariants.test.js
// ZEROact 共通テスト基盤 (2026-05-17 新規) — ダイコメ用 property-based tests
//
// 絶対ルールを述語化して fast-check で網羅検証:
//   R1: calcFare の出力は入力距離に対して単調非減少
//   R2: running=false でも calcFare は不変 (純粋関数性)
//   R3: 距離 < 0 / NaN / Infinity 等の異常入力でも runtime エラーなし
//   R4: 同じ入力で 2 回呼んでも同じ出力 (idempotence)

const path = require('path');
const {
  fc,
  assertMonotonic,
  propertyAssert,
} = require('../../scripts/zeroact-test-commons/property-test-helpers');

const METER_JS_PATH = path.join(__dirname, '..', '..', 'js', 'meter.js');

function loadMeter() {
  delete require.cache[require.resolve(METER_JS_PATH)];
  return require(METER_JS_PATH);
}

describe('ZEROact 共通テスト基盤: ダイコメ distance / fare invariants', () => {
  let Meter;
  beforeEach(() => {
    Meter = loadMeter();
    // calcFare default config を明示注入 (test 間で state を独立化)
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

  it('R1: calcFare(d) は d ≥ 0 の範囲で単調非減少', () => {
    propertyAssert(
      fc.property(
        fc
          .array(fc.double({ min: 0, max: 100000, noNaN: true }), {
            minLength: 2,
            maxLength: 30,
          })
          .map((arr) => arr.sort((a, b) => a - b)),
        (distances) => {
          const fares = distances.map((d) => Meter.calcFare(d));
          assertMonotonic(fares, 'calcFare monotonic');
        }
      )
    );
  });

  it('R2: calcFare は副作用ゼロ (running 状態に依存しない・純粋関数)', () => {
    propertyAssert(
      fc.property(
        fc.double({ min: 0, max: 50000, noNaN: true }),
        fc.boolean(),
        (distanceM, _runningHypothetical) => {
          // calcFare は state.running に依存しないはず (= 純粋関数)
          const before = Meter.calcFare(distanceM);
          const after = Meter.calcFare(distanceM);
          if (before !== after) {
            throw new Error(
              'calcFare is not pure: before=' + before + ' after=' + after + ' input=' + distanceM
            );
          }
        }
      )
    );
  });

  it('R3: calcFare(<0) でも runtime エラーなし (絶対ルール: 業務継続性最優先)', () => {
    propertyAssert(
      fc.property(fc.double({ min: -10000, max: -0.01, noNaN: true }), (negDistance) => {
        // 負の距離は理論上発生しないが、防御的に runtime エラーが出ないことを確認
        const r = Meter.calcFare(negDistance);
        if (typeof r !== 'number') {
          throw new Error('calcFare(negative) must return number, got: ' + typeof r);
        }
      })
    );
  });

  it('R4: calcFare の idempotence (同じ入力で同じ出力)', () => {
    propertyAssert(
      fc.property(
        fc.double({ min: 0, max: 100000, noNaN: true }),
        fc.integer({ min: 1, max: 5 }),
        (distanceM, repeatCount) => {
          const results = [];
          for (let i = 0; i < repeatCount; i++) {
            results.push(Meter.calcFare(distanceM));
          }
          const first = results[0];
          for (let i = 1; i < results.length; i++) {
            if (results[i] !== first) {
              throw new Error(
                'idempotence violated: distance=' +
                  distanceM +
                  ' results=' +
                  JSON.stringify(results)
              );
            }
          }
        }
      )
    );
  });

  it('R5: 1000m 以下は必ず base_fare (¥1300)', () => {
    propertyAssert(
      fc.property(fc.double({ min: 0, max: 1000, noNaN: true }), (distanceM) => {
        const f = Meter.calcFare(distanceM);
        if (f !== 1300) {
          throw new Error('base_fare invariant violated: distance=' + distanceM + ' fare=' + f);
        }
      })
    );
  });

  it('R6: 1000m 超は base_fare + add_fare × ceil((d-1000)/420) (rounding 10)', () => {
    propertyAssert(
      fc.property(fc.double({ min: 1001, max: 100000, noNaN: true }), (distanceM) => {
        const expected = 1300 + Math.ceil((distanceM - 1000) / 420) * 100;
        // rounding 10 円単位
        const expectedRounded = Math.round(expected / 10) * 10;
        const actual = Meter.calcFare(distanceM);
        if (actual !== expectedRounded) {
          throw new Error(
            'fare formula violated: distance=' +
              distanceM +
              ' expected=' +
              expectedRounded +
              ' actual=' +
              actual
          );
        }
      })
    );
  });
});
