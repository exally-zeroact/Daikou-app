// tests/integration/distance-equals-display-invariant.test.js
//
// ★2026-05-30 過大請求根絶方針 (= 司さん確定・最新)★:
//   距離 (distance_m) は道路 polyline 累積 1 本 (= Google MM 式統一)。
//   display は実距離を ★絶対に超えない (overshoot ゼロ)★ で「下から」catch-up し・
//   停車 / 確定 / 業務終了 (= 支払タイミング) で実距離に latch し一致する。
//   旧「display == distance_m 完全一致 (1 行同期)」は走行中ラグを許さず・予測先取りを
//   招いて overshoot (= 過大請求) を生んだため撤回。新 invariant は「display ≤ distance_m
//   (+tier2) を全 step で満たし・停車 / latch で一致」へ更新。
//
// 絶対ルール準拠:
//   ・distance_m / calcFare / running gate / business_active gate = 1byte 不変
//   ・本 fixture は display 専用 layer の動作のみ assert
//   ・[A] display ≤ distance_m(+tier2) overshoot ゼロ invariant + 停車/latch 一致を強制

'use strict';

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

function mockGPS() {
  globalThis.GPS = {
    calcDistance: (lat1, lng1, lat2, lng2) => {
      if (lat1 === lat2 && lng1 === lng2) return 0;
      const R = 6371000;
      const tr = Math.PI / 180;
      const dLat = (lat2 - lat1) * tr;
      const dLng = (lng2 - lng1) * tr;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * tr) * Math.cos(lat2 * tr) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },
    calcDistance3D: () => 0,
  };
}

describe('★新方針 2026-05-30: display ≤ distance_m overshoot ゼロ + 停車/latch 一致', () => {
  let Meter;
  const BASE_TS = 1714100000000;

  function gps(t, opts) {
    opts = opts || {};
    const speedKmh = opts.speedKmh != null ? opts.speedKmh : 36;
    const moveM = (speedKmh / 3.6) * t;
    const dLat = moveM / 111132;
    return {
      lat: 33.84 + dLat,
      lng: 132.7656,
      altitude: 0,
      accuracy: opts.accuracy != null ? opts.accuracy : 5,
      speedKmh,
      isStationary: opts.isStationary || false,
      timestamp: BASE_TS + t * 1000,
    };
  }

  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig(DEFAULT_FARE_CONFIG);
    Meter.reset();
    Meter.start();
    if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
    if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  // ─── [A-1] trip 側 overshoot ゼロ invariant ────────────────────────
  it('A-1: trip display_distance_m ≤ distance_m + tier2_pending_m が任意 step で成立 (overshoot ゼロ)', () => {
    Meter.update(gps(0, { speedKmh: 36 }));
    for (let t = 5; t <= 60; t += 5) {
      Meter.update(gps(t, { speedKmh: 36 }));
      const s = Meter.getState();
      const upper = (s.distance_m || 0) + (s.tier2_pending_m || 0);
      // ★新方針: display は実距離 (+tier2) を超えない (= 先取り禁止・過大請求不能)。
      const over = (s.display_distance_m || 0) - upper;
      if (over > 0.01) {
        throw new Error(
          `A-1 FAIL: step=${t} display=${s.display_distance_m.toFixed(2)} > ` +
            `distance_m+tier2=${upper.toFixed(2)} (overshoot=${over.toFixed(2)})`
        );
      }
    }
  });

  // ─── [A-2] business 側 overshoot ゼロ invariant ────────────────────
  it('A-2: business display ≤ business_distance_m + business_tier2_pending_m が任意 step で成立 (overshoot ゼロ)', () => {
    if (typeof Meter.businessStart === 'function') {
      Meter.businessStart();
    }
    Meter.update(gps(0, { speedKmh: 36 }));
    for (let t = 5; t <= 60; t += 5) {
      Meter.update(gps(t, { speedKmh: 36 }));
      const s = Meter.getState();
      const upper = (s.business_distance_m || 0) + (s.business_tier2_pending_m || 0);
      const over = (s.business_display_distance_m || 0) - upper;
      if (over > 0.01) {
        throw new Error(
          `A-2 FAIL: step=${t} business_display=${(s.business_display_distance_m || 0).toFixed(2)} > ` +
            `business+tier2=${upper.toFixed(2)} (overshoot=${over.toFixed(2)})`
        );
      }
    }
  });

  // ─── [A-3] 単調維持 (= 後退禁止) ─────────────────────────────
  it('A-3: display_distance_m が任意 step で単調非減少 (= 後退禁止)', () => {
    Meter.update(gps(0, { speedKmh: 36 }));
    let prev = Meter.getState().display_distance_m || 0;
    for (let t = 5; t <= 60; t += 5) {
      Meter.update(gps(t, { speedKmh: 36 }));
      const s = Meter.getState();
      if (s.display_distance_m < prev) {
        throw new Error(
          `A-3 FAIL: step=${t} display=${s.display_distance_m.toFixed(2)} < prev=${prev.toFixed(2)}`
        );
      }
      prev = s.display_distance_m;
    }
  });

  // ─── [A-4] 課金収束 (= 停止 latch 時・display == distance_m に一致) ──────
  it('A-4: 停止 latch (= stop) 後に display_distance_m == distance_m (支払時点 一致)', () => {
    Meter.update(gps(0, { speedKmh: 36 }));
    Meter.update(gps(10, { speedKmh: 36 }));
    // ★停止 = 支払タイミング → display を実距離に latch し一致させる。
    Meter.stop();
    const s0 = Meter.getState();
    const diff = Math.abs((s0.display_distance_m || 0) - (s0.distance_m || 0));
    if (diff > 0.01) {
      throw new Error(
        `A-4 FAIL: stop(latch) 後 display=${s0.display_distance_m.toFixed(2)} ≠ distance_m=${s0.distance_m.toFixed(2)}`
      );
    }
  });

  // ─── [A-5] running=false (= 空車中) でも business 側 overshoot ゼロ ─
  it('A-5: running=false でも business_display ≤ business_distance_m + business_tier2_pending_m (overshoot ゼロ)', () => {
    if (typeof Meter.businessStart === 'function') {
      Meter.businessStart();
    }
    Meter.stop(); // running=false (= latch)
    Meter.update(gps(0, { speedKmh: 36 }));
    Meter.update(gps(10, { speedKmh: 36 }));
    const s = Meter.getState();
    const upper = (s.business_distance_m || 0) + (s.business_tier2_pending_m || 0);
    const over = (s.business_display_distance_m || 0) - upper;
    if (over > 0.01) {
      throw new Error(
        `A-5 FAIL: running=false business_display=${(s.business_display_distance_m || 0).toFixed(2)} > ` +
          `business+tier2=${upper.toFixed(2)} (overshoot=${over.toFixed(2)})`
      );
    }
  });
});
