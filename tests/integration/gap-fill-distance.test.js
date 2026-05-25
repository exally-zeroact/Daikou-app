// tests/integration/gap-fill-distance.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step P0-① / 全32件)
//
// 検証対象: meter.js L824 gap fill (state.distance_m += filled) speed×time 加算の数値検証
//   発火条件: dtSec >= GAP_THRESHOLD_SEC (5s)
//   公式:    filled = min(lastSpeedKmh, 160km/h) / 3.6 × dtSec
//   停止:    lastSpeedKmh<=0 / gapSec>GAP_MAX_SEC(600s) / state.running=false
//
// 絶対ルール準拠:
//   gap fill は GPS 直線距離ではなく速度×時間 (= タイヤ回転由来の概算)。
//   distanceSource は 'gap' に切替・gap_fill_count / gap_fill_total_m が累積。

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

// GPS グローバル mock (node 環境では js/gps.js は読まれないため必要)
//   meter.js L257 / L305 で GPS.calcDistance が呼ばれる。haversine 公式で代替実装。
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
  };
}

describe('gap-fill (meter.js L824): speed×time 加算の数値検証', () => {
  let Meter;
  const BASE_TS = 1714100000000;

  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig(DEFAULT_FARE_CONFIG);
    Meter.reset();
    Meter.start(); // state.running = true
  });

  afterEach(() => {
    if (Meter) Meter.reset(); // setInterval 解放
    delete globalThis.GPS;
  });

  it('dtSec=10s, speed=60km/h で約 166.67m が加算される (= 60/3.6×10)', () => {
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: BASE_TS,
    });
    const afterStep1 = Meter.getState().distance_m;
    Meter.update({
      lat: 33.84001,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: BASE_TS + 10000,
    });
    const s = Meter.getState();
    expect(afterStep1).toBe(0);
    // filled = 60/3.6 × 10 = 166.666...
    expect(s.distance_m).toBeCloseTo(166.67, 1);
    expect(s.distanceSource).toBe('gap');
    expect(s.gap_fill_count).toBe(1);
    expect(s.gap_fill_total_m).toBeCloseTo(166.67, 1);
  });

  it('dtSec=5.0s ちょうど (GAP_THRESHOLD_SEC=5) で gap fill 発火', () => {
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 36,
      isStationary: false,
      timestamp: BASE_TS,
    });
    Meter.update({
      lat: 33.84001,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 36,
      isStationary: false,
      timestamp: BASE_TS + 5000,
    });
    const s = Meter.getState();
    // filled = 36/3.6 × 5 = 50m
    expect(s.distance_m).toBeCloseTo(50, 1);
    expect(s.distanceSource).toBe('gap');
    expect(s.gap_fill_count).toBe(1);
  });

  it('dtSec=4.9s (< GAP_THRESHOLD_SEC=5) では gap fill 発火しない', () => {
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: BASE_TS,
    });
    Meter.update({
      lat: 33.84001,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: BASE_TS + 4900,
    });
    const s = Meter.getState();
    expect(s.distance_m).toBe(0);
    expect(s.gap_fill_count).toBe(0);
    expect(s.distanceSource).not.toBe('gap');
  });

  it('lastSpeedKmh=0 で gap fill 停止 (calculateGapFill L744 早期 null return)', () => {
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 0,
      isStationary: false,
      timestamp: BASE_TS,
    });
    Meter.update({
      lat: 33.84001,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 0,
      isStationary: false,
      timestamp: BASE_TS + 10000,
    });
    const s = Meter.getState();
    expect(s.distance_m).toBe(0);
    expect(s.gap_fill_count).toBe(0);
  });

  it('gapSec=601s (> GAP_MAX_SEC=600) で gap fill 停止 (L743)', () => {
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: BASE_TS,
    });
    Meter.update({
      lat: 33.84001,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: BASE_TS + 601000,
    });
    const s = Meter.getState();
    expect(s.distance_m).toBe(0);
    expect(s.gap_fill_count).toBe(0);
  });

  it('gapSec=600s ちょうど (= GAP_MAX_SEC 境界) で gap fill 発火する (gapSec>GAP_MAX_SEC のみ停止)', () => {
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: BASE_TS,
    });
    Meter.update({
      lat: 33.84001,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: BASE_TS + 600000,
    });
    const s = Meter.getState();
    // filled = 60/3.6 × 600 = 10000m
    expect(s.distance_m).toBeCloseTo(10000, 0);
    expect(s.distanceSource).toBe('gap');
  });

  it('lastSpeedKmh=200km/h (>160km/h) は 160 で clamp (L752 ABS_MAX_KMH)', () => {
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 200,
      isStationary: false,
      timestamp: BASE_TS,
    });
    Meter.update({
      lat: 33.84001,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 200,
      isStationary: false,
      timestamp: BASE_TS + 10000,
    });
    const s = Meter.getState();
    // clampedKmh=160 → 160/3.6 × 10 = 444.44...
    expect(s.distance_m).toBeCloseTo(444.44, 1);
  });

  it('isStationary=true は update 早期 return で gap fill 発火しない (meter.js L790)', () => {
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: BASE_TS,
    });
    Meter.update({
      lat: 33.84001,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: true,
      timestamp: BASE_TS + 10000,
    });
    const s = Meter.getState();
    expect(s.distance_m).toBe(0);
    expect(s.gap_fill_count).toBe(0);
  });

  it('state.running=false なら distance_m に加算されない (stop 後)', () => {
    // accuracy 50 以下でない GPS は無視されるので、stop 前に valid な last_gps を作る
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: BASE_TS,
    });
    Meter.stop(); // state.running = false
    Meter.update({
      lat: 33.84001,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: BASE_TS + 10000,
    });
    const s = Meter.getState();
    // L823 if (state.running) state.distance_m += filled で running=false のため加算なし
    expect(s.distance_m).toBe(0);
  });

  it('gap fill 連続発火で gap_fill_count / gap_fill_total_m が累積する', () => {
    // step1: 初期 GPS (state.last_* セット用)
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: BASE_TS,
    });
    // step2: 10s 後 (= gap fill 1 回目)
    Meter.update({
      lat: 33.84001,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: BASE_TS + 10000,
    });
    // step3: さらに 10s 後 (= gap fill 2 回目)
    Meter.update({
      lat: 33.84002,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: BASE_TS + 20000,
    });
    const s = Meter.getState();
    expect(s.gap_fill_count).toBe(2);
    // 各回 166.67m × 2 = 333.33m
    expect(s.gap_fill_total_m).toBeCloseTo(333.33, 0);
    expect(s.distance_m).toBeCloseTo(333.33, 0);
  });

  it('gap fill 加算後 fare_yen が calcFare(distance_m) と一致 (L825)', () => {
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: BASE_TS,
    });
    Meter.update({
      lat: 33.84001,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: BASE_TS + 60000, // 60s gap = 1000m
    });
    const s = Meter.getState();
    // 1000m → base_fare 1300 (calcFare 仕様: 1000m以下→¥1,300)
    // distance_m は 60/3.6×60 = 1000 ぴったり
    expect(s.distance_m).toBeCloseTo(1000, 0);
    expect(s.fare_yen).toBe(Meter.calcFare(s.distance_m));
  });
});
