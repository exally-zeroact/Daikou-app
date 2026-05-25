// tests/property/isstationary-no-increase.test.js
// ZEROact 共通テスト基盤 (2026-05-17 新規・Stage 1 Step C) — ダイコメ用 property test
//
// 述語B: gpsResult.isStationary === true のとき state.distance_m は増加しない
//
// 2 経路を独立に検証:
//   経路 1 (meter.js L790):
//     update() 入口で if (gpsResult.isStationary) { _updateMapMatching(gpsResult); return; }
//     → 全 Tier 到達せず distance_m 不変。
//
//   経路 2 (map-matcher.js L3007):
//     msg.isStationary === true 受信時に mmIncrementM=0 / tentativeIncrementM=0 強制。
//     → 経路 1 を bypass しても Worker B 側で 0 化されるため二重防御。
//     Worker context 必須のため Node では実行不可・静的解析で pattern 存在を verify。

const path = require('path');
const {
  fc,
  propertyAssert,
  stationaryGpsArb,
} = require('../../scripts/zeroact-test-commons/property-test-helpers');

// ★ Phase 6-7 (2026-05-21・(M) 分離): 静的 grep (= loadSource / MAP_MATCHER_JS_PATH / fs)
//   は tests/drift-static/meter-isStationary-anchor.test.js 側で使用・本 file からは撤去。
const METER_JS_PATH = path.join(__dirname, '..', '..', 'js', 'meter.js');

function loadMeter() {
  delete require.cache[require.resolve(METER_JS_PATH)];
  return require(METER_JS_PATH);
}

describe('ZEROact 共通テスト基盤: isStationary=true で distance_m 不変 (Step C)', () => {
  // ─── 経路 1 (meter.js L790・property test): update() 入口 早期 return ──

  describe('経路 1 (meter.js L790): update 入口で isStationary=true なら distance_m 不変', () => {
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

    it('B1: 任意の事前 distance_m + isStationary=true GPS で distance_m 不変', () => {
      propertyAssert(
        fc.property(
          fc.double({ min: 0, max: 100000, noNaN: true }),
          fc.double({ min: 24, max: 46, noNaN: true }),
          fc.double({ min: 122, max: 146, noNaN: true }),
          (preDistance, lat, lng) => {
            Meter.reset();
            Meter.start();
            Meter.setDistance(preDistance);
            const before = Meter.getState().distance_m;
            // isStationary=true GPS を流す
            Meter.update({
              lat,
              lng,
              accuracy: 5,
              speedKmh: 0,
              isStationary: true,
              timestamp: 1714100000000,
            });
            const after = Meter.getState().distance_m;
            if (after !== before) {
              throw new Error(
                'isStationary=true で distance_m 変化: before=' +
                  before +
                  ' after=' +
                  after +
                  ' (input distance=' +
                  preDistance +
                  ')'
              );
            }
          }
        )
      );
    });

    it('B2: stationaryGpsArb (6+ 点同座標シーケンス) を連続流しても distance_m 不変', () => {
      propertyAssert(
        fc.property(
          fc.double({ min: 0, max: 50000, noNaN: true }),
          stationaryGpsArb({ lat: 33.84, lng: 132.7656 }),
          (preDistance, gpsSeq) => {
            Meter.reset();
            Meter.start();
            Meter.setDistance(preDistance);
            const before = Meter.getState().distance_m;
            for (const gps of gpsSeq) {
              Meter.update(gps);
            }
            const after = Meter.getState().distance_m;
            if (after !== before) {
              throw new Error(
                'isStationary sequence で distance_m 変化: before=' +
                  before +
                  ' after=' +
                  after +
                  ' seqLen=' +
                  gpsSeq.length
              );
            }
          }
        )
      );
    });

    // ★ Phase 6-7 (2026-05-21・(M) 分離): 旧 B3 (meter.js L790 ±10 静的 grep) は
    //   tests/drift-static/meter-isStationary-anchor.test.js へ移動。
    //   理由: Stryker instrumentation で行シフト → false-fail。byte 不変で別 file 化し
    //         通常 vitest run では同 ±10 厳格度で実行・stryker では exclude する設計。
  });

  // ★ Phase 6-7 (2026-05-21・(M) 分離): 旧 '経路 2' describe の B4 (map-matcher.js L3007 ±10) は
  //   tests/drift-static/meter-isStationary-anchor.test.js へ移動。
  //   '経路 2' describe は B4 単独だったため・移動後 empty となり describe ごと削除。
});
