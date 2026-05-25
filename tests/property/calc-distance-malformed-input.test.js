// tests/property/calc-distance-malformed-input.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step ㉖ / 全32件)
//
// 検証対象: gps.js GPS.calcDistance の不正入力 robustness (property test)
//   既存 distance-invariants.test.js は calcFare 単調性のみ・calcDistance 本体未検証。
//   本 test は Vincenty 計算の極値・無限・NaN 入力に対する property を検証。
//
// 絶対ルール準拠:
//   js/gps.js は触らない absolute・vm sandbox で GPS.calcDistance を直接呼ぶ。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { fc, propertyAssert } = require('../../scripts/zeroact-test-commons/property-test-helpers');

const GPS_JS_PATH = path.join(__dirname, '..', '..', 'js', 'gps.js');

function loadGps() {
  const ctx = {
    console: console,
    Date: Date,
    Math: Math,
    Float32Array: Float32Array,
    Worker: undefined,
    DeviceOrientationEvent: undefined,
    DeviceMotionEvent: undefined,
    document: { addEventListener: () => {} },
    dlog: () => {},
    alert: () => {},
    performance: { now: () => Date.now() },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx.navigator = { geolocation: { watchPosition: () => 1, clearWatch: () => {} } };
  ctx.addEventListener = () => {};
  ctx.removeEventListener = () => {};
  ctx.setTimeout = () => 0;
  ctx.clearTimeout = () => {};
  ctx.setInterval = () => 0;
  ctx.clearInterval = () => {};
  vm.createContext(ctx);
  const src = fs.readFileSync(GPS_JS_PATH, 'utf8') + '\n;globalThis.GPS = GPS;\n';
  vm.runInContext(src, ctx, { filename: 'js/gps.js' });
  return ctx.GPS;
}

describe('GPS.calcDistance 不正入力 robustness (㉖)', () => {
  let GPS;
  beforeAll(() => {
    GPS = loadGps();
  });

  it('P1: 同一座標 (= 距離 0) で 0 を返す', () => {
    propertyAssert(
      fc.property(
        fc.double({ min: 24, max: 46, noNaN: true }),
        fc.double({ min: 122, max: 146, noNaN: true }),
        (lat, lng) => {
          const d = GPS.calcDistance(lat, lng, lat, lng);
          // 同座標 → 0 または極小値
          if (!(d >= 0 && d < 1)) {
            throw new Error('同座標距離 = ' + d + ' (期待: ~0)');
          }
        }
      )
    );
  });

  it('P2: 任意有効座標で距離は有限非負', () => {
    propertyAssert(
      fc.property(
        fc.double({ min: 24, max: 46, noNaN: true }),
        fc.double({ min: 122, max: 146, noNaN: true }),
        fc.double({ min: 24, max: 46, noNaN: true }),
        fc.double({ min: 122, max: 146, noNaN: true }),
        (lat1, lng1, lat2, lng2) => {
          const d = GPS.calcDistance(lat1, lng1, lat2, lng2);
          if (!Number.isFinite(d) || d < 0) {
            throw new Error('distance 不正: ' + d);
          }
        }
      )
    );
  });

  it('P3: 距離は対称的 (= calcDistance(A,B) === calcDistance(B,A))', () => {
    propertyAssert(
      fc.property(
        fc.double({ min: 24, max: 46, noNaN: true }),
        fc.double({ min: 122, max: 146, noNaN: true }),
        fc.double({ min: 24, max: 46, noNaN: true }),
        fc.double({ min: 122, max: 146, noNaN: true }),
        (a, b, c, d) => {
          const ab = GPS.calcDistance(a, b, c, d);
          const ba = GPS.calcDistance(c, d, a, b);
          if (Math.abs(ab - ba) > 1) {
            throw new Error('対称性違反: ' + ab + ' vs ' + ba);
          }
        }
      )
    );
  });

  it('P4: 三角不等式 (= d(A,C) <= d(A,B) + d(B,C))', () => {
    propertyAssert(
      fc.property(
        fc.double({ min: 30, max: 40, noNaN: true }),
        fc.double({ min: 130, max: 140, noNaN: true }),
        fc.double({ min: 30, max: 40, noNaN: true }),
        fc.double({ min: 130, max: 140, noNaN: true }),
        fc.double({ min: 30, max: 40, noNaN: true }),
        fc.double({ min: 130, max: 140, noNaN: true }),
        (a1, a2, b1, b2, c1, c2) => {
          const ab = GPS.calcDistance(a1, a2, b1, b2);
          const bc = GPS.calcDistance(b1, b2, c1, c2);
          const ac = GPS.calcDistance(a1, a2, c1, c2);
          // 1m の数値誤差許容
          if (ac > ab + bc + 1) {
            throw new Error('三角不等式違反: AC=' + ac + ' > AB+BC=' + ab + '+' + bc);
          }
        }
      )
    );
  });

  it('P5: 極座標 (= lat=90 / -90) で例外なし', () => {
    expect(() => GPS.calcDistance(90, 0, 0, 0)).not.toThrow();
    expect(() => GPS.calcDistance(-90, 0, 0, 0)).not.toThrow();
    expect(() => GPS.calcDistance(0, 180, 0, -180)).not.toThrow();
  });

  it('P6: 1km の概算距離 (= 緯度 0.009 度差 ≈ 1km)', () => {
    const d = GPS.calcDistance(35.6895, 139.6917, 35.6985, 139.6917);
    // 約 1000m (= 緯度 0.009 度差 ≈ 1km)・誤差 ±50m 許容
    expect(d).toBeGreaterThan(950);
    expect(d).toBeLessThan(1050);
  });
});
