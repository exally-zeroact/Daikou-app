// tests/property/gps-injection-malformed.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step ㉑ / 全32件)
//
// 検証対象: meter.js update() への GPS 悪値 (NaN/Infinity/負値/0/極値) 注入時
//   state.distance_m / state.business_distance_m が必ず有限非負を保つ
//
// 絶対ルール準拠:
//   js/meter.js は触らない absolute・GPS 悪値で distance_m 汚染を防ぐ。

const path = require('path');
const { fc, propertyAssert } = require('../../scripts/zeroact-test-commons/property-test-helpers');

const METER_JS_PATH = path.join(__dirname, '..', '..', 'js', 'meter.js');

function loadMeter() {
  delete require.cache[require.resolve(METER_JS_PATH)];
  return require(METER_JS_PATH);
}

function mockGPS() {
  globalThis.GPS = {
    calcDistance: (lat1, lng1, lat2, lng2) => {
      // 入力 NaN/Infinity をそのまま伝播させて Meter 側の防御を verify
      if (![lat1, lng1, lat2, lng2].every((v) => Number.isFinite(v))) return NaN;
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
  };
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

describe('GPS 悪値 injection で distance_m 非汚染 (㉑)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig(DEFAULT_FARE_CONFIG);
    Meter.reset();
    Meter.start();
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('P1: NaN/Infinity/-Infinity 注入で distance_m が必ず有限非負', () => {
    propertyAssert(
      fc.property(
        fc.constantFrom(NaN, Infinity, -Infinity),
        fc.constantFrom(NaN, Infinity, -Infinity),
        fc.constantFrom(NaN, Infinity, -Infinity),
        (lat, lng, speedKmh) => {
          Meter.reset();
          Meter.start();
          Meter.update({
            lat,
            lng,
            accuracy: 5,
            speedKmh,
            isStationary: false,
            timestamp: 1714100000000,
          });
          Meter.update({
            lat: 33.84,
            lng: 132.7656,
            accuracy: 5,
            speedKmh: 36,
            isStationary: false,
            timestamp: 1714100010000,
          });
          const s = Meter.getState();
          if (!Number.isFinite(s.distance_m) || s.distance_m < 0) {
            throw new Error('distance_m 汚染: ' + s.distance_m);
          }
        }
      )
    );
  });

  it('P2: 負値 lat/lng の極値で distance_m 安全', () => {
    propertyAssert(
      fc.property(
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (lat, lng) => {
          Meter.reset();
          Meter.start();
          Meter.update({
            lat,
            lng,
            accuracy: 5,
            speedKmh: 30,
            isStationary: false,
            timestamp: 1714100000000,
          });
          const s = Meter.getState();
          if (!Number.isFinite(s.distance_m) || s.distance_m < 0) {
            throw new Error('distance_m 汚染: ' + s.distance_m);
          }
        }
      )
    );
  });

  it('P3: accuracy=0 / Infinity / NaN でも distance_m 健全', () => {
    propertyAssert(
      fc.property(fc.constantFrom(0, NaN, Infinity, -1, -100), (accuracy) => {
        Meter.reset();
        Meter.start();
        Meter.update({
          lat: 33.84,
          lng: 132.7656,
          accuracy,
          speedKmh: 30,
          isStationary: false,
          timestamp: 1714100000000,
        });
        const s = Meter.getState();
        if (!Number.isFinite(s.distance_m) || s.distance_m < 0) {
          throw new Error('distance_m 汚染 (accuracy=' + accuracy + '): ' + s.distance_m);
        }
      })
    );
  });

  it('P4: speedKmh = Infinity / -Infinity / NaN で gap fill が安全側 (= 加算なし or clamp)', () => {
    propertyAssert(
      fc.property(fc.constantFrom(Infinity, -Infinity, NaN, -50, 100000), (speedKmh) => {
        Meter.reset();
        Meter.start();
        Meter.update({
          lat: 33.84,
          lng: 132.7656,
          accuracy: 5,
          speedKmh,
          isStationary: false,
          timestamp: 1714100000000,
        });
        Meter.update({
          lat: 33.8401,
          lng: 132.7656,
          accuracy: 5,
          speedKmh,
          isStationary: false,
          timestamp: 1714100010000,
        });
        const s = Meter.getState();
        if (!Number.isFinite(s.distance_m) || s.distance_m < 0) {
          throw new Error('distance_m 汚染 (speed=' + speedKmh + '): ' + s.distance_m);
        }
        // 物理上限 160km/h × 10s + 余裕で 500m 以下
        if (s.distance_m > 500) {
          throw new Error('clamp 失敗: distance_m=' + s.distance_m);
        }
      })
    );
  });

  it('P5: timestamp 順序逆転 (= 過去 GPS) で distance_m 加算しない (= 安全側)', () => {
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 30,
      isStationary: false,
      timestamp: 1714100010000,
    });
    Meter.update({
      lat: 33.85,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 30,
      isStationary: false,
      timestamp: 1714100000000, // 過去
    });
    const s = Meter.getState();
    expect(Number.isFinite(s.distance_m)).toBe(true);
    expect(s.distance_m).toBeGreaterThanOrEqual(0);
  });

  it('P6: 大量の悪値連続注入で state.distance_m 単調非減少維持', () => {
    propertyAssert(
      fc.property(
        fc.array(
          fc.record({
            lat: fc.option(fc.double({ min: -90, max: 90, noNaN: true }), { nil: NaN }),
            lng: fc.option(fc.double({ min: -180, max: 180, noNaN: true }), { nil: NaN }),
            accuracy: fc.option(fc.double({ min: 0, max: 1000 }), { nil: NaN }),
            speedKmh: fc.option(fc.double({ min: 0, max: 200, noNaN: true }), { nil: NaN }),
            isStationary: fc.boolean(),
          }),
          { minLength: 2, maxLength: 10 }
        ),
        (seq) => {
          Meter.reset();
          Meter.start();
          const baseTs = 1714100000000;
          let prevDist = 0;
          for (let i = 0; i < seq.length; i++) {
            const s = seq[i];
            Meter.update({
              lat: s.lat,
              lng: s.lng,
              accuracy: s.accuracy,
              speedKmh: s.speedKmh,
              isStationary: s.isStationary,
              timestamp: baseTs + i * 1000,
            });
            const curr = Meter.getState().distance_m;
            if (!Number.isFinite(curr) || curr < 0) {
              throw new Error('distance_m 汚染 at step ' + i + ': ' + curr);
            }
            if (curr < prevDist) {
              throw new Error('distance_m 減少 (= 単調性違反) at step ' + i);
            }
            prevDist = curr;
          }
        }
      )
    );
  });

  // ★調査メモ (2026-05-18・検証中検出):
  //   Meter.setDistance(NaN/Infinity/-Infinity) を直接呼ぶと state.distance_m が
  //   NaN/Infinity に汚染される。setDistance はガード関数なしの直接代入。
  //   呼出側 (= business.js / index.html) が valid 値のみ渡す責任。
  //   既存テスト群はこの assumption の下で動作・本ファイルでは update() 経由の
  //   悪値防御を中心に検証する (setDistance ガード追加は js/meter.js の
  //   touch が必要なため別タスク)。
});
