// tests/integration/meter-batch1-bill-killers.test.js
//
// ★白紙書き直し (2026-05-30・clean-rebuild-pipeline・新挙動へ更新)★
//   旧 Phase 8 Batch 1 は tier2_pending_m snapshot SET / gps_predictive 物理上限 /
//   wait_sec 境界 / display 計算の mutant kill test だった。
//   新メーターでは tier2 preview 回路 / gps_predictive 連続点累積は ★廃止★。
//   存続する不変条件のみ残す:
//     - L: wait_sec 累積 boundary (dtSec2>0 && <60 && speedKmh<3)  ← 保持
//     - display_distance_m は distance_m を下回らない / 単調非減少     ← 保持 (= 表示予測補間)
//
// ★絶対ルール準拠:
//   distance_m は pipeline delta 単一経路で駆動・wait_sec / display は集計/表示 layer。

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

function makeFakeWorker() {
  const handlers = [];
  return {
    addEventListener(type, h) {
      if (type === 'message') handlers.push(h);
    },
    removeEventListener(type, h) {
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    },
    postMessage() {},
    _dispatch(data) {
      for (const h of handlers) h({ data });
    },
  };
}

function setupMeter() {
  mockGPS();
  const Meter = loadMeter();
  Meter.setFareConfig(DEFAULT_FARE_CONFIG);
  Meter.reset();
  const fakeWorker = makeFakeWorker();
  Meter.setMapMatcher(fakeWorker);
  if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);
  return { Meter, fakeWorker };
}

// ─── wait_sec 累積 boundary (= 待機料金集計・存続) ────────────────
//   if (dtSec2 > 0 && dtSec2 < 60 && (gpsResult.speedKmh || 0) < 3) state.wait_sec += dtSec2;
describe('Batch 1: wait_sec 累積 boundary (= 待機料金集計)', () => {
  let Meter;
  const baseTs = 1714100000000;
  function gpsLike(opts) {
    return {
      lat: 33.84,
      lng: 132.7656,
      altitude: 0,
      accuracy: 5,
      speedKmh: opts.speedKmh,
      isStationary: false,
      timestamp: opts.ts,
    };
  }
  function setLast(Meter, ts, speedKmh) {
    Meter.update(gpsLike({ ts, speedKmh: speedKmh != null ? speedKmh : 2 }));
  }
  beforeEach(() => {
    ({ Meter } = setupMeter());
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('dtSec2=1 + speedKmh=2 → wait_sec += 1 (= 通常加算 path)', () => {
    setLast(Meter, baseTs);
    const before = Meter.getState().wait_sec || 0;
    Meter.update(gpsLike({ ts: baseTs + 1000, speedKmh: 2 }));
    expect(Meter.getState().wait_sec).toBeCloseTo(before + 1, 6);
  });

  it('dtSec2=0 (= 同 timestamp) → wait_sec 不変 (= > 0 境界)', () => {
    setLast(Meter, baseTs);
    const before = Meter.getState().wait_sec || 0;
    Meter.update(gpsLike({ ts: baseTs, speedKmh: 2 }));
    expect(Meter.getState().wait_sec).toBe(before);
  });

  it('dtSec2=60 (= 60 ちょうど) → wait_sec 不変 (= < 60 境界)', () => {
    setLast(Meter, baseTs);
    const before = Meter.getState().wait_sec || 0;
    Meter.update(gpsLike({ ts: baseTs + 60000, speedKmh: 2 }));
    expect(Meter.getState().wait_sec).toBe(before);
  });

  it('dtSec2=59 + speedKmh=2 → wait_sec += 59 (= < 60 境界の内側)', () => {
    setLast(Meter, baseTs);
    const before = Meter.getState().wait_sec || 0;
    Meter.update(gpsLike({ ts: baseTs + 59000, speedKmh: 2 }));
    expect(Meter.getState().wait_sec).toBeCloseTo(before + 59, 6);
  });

  it('dtSec2=1 + speedKmh=3 (= 3 ちょうど) → wait_sec 不変 (= < 3 境界)', () => {
    setLast(Meter, baseTs);
    const before = Meter.getState().wait_sec || 0;
    Meter.update(gpsLike({ ts: baseTs + 1000, speedKmh: 3 }));
    expect(Meter.getState().wait_sec).toBe(before);
  });

  it('dtSec2=1 + speedKmh=0 → wait_sec += 1 (= 完全停止でも累積)', () => {
    setLast(Meter, baseTs);
    const before = Meter.getState().wait_sec || 0;
    Meter.update(gpsLike({ ts: baseTs + 1000, speedKmh: 0 }));
    expect(Meter.getState().wait_sec).toBeCloseTo(before + 1, 6);
  });

  it('dtSec2=1 + speedKmh=null → wait_sec += 1 (= ||0 fallback で 0 扱い)', () => {
    setLast(Meter, baseTs);
    const before = Meter.getState().wait_sec || 0;
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      altitude: 0,
      accuracy: 5,
      speedKmh: null,
      isStationary: false,
      timestamp: baseTs + 1000,
    });
    expect(Meter.getState().wait_sec).toBeCloseTo(before + 1, 6);
  });
});

// ─── display_distance_m: ★2026-05-30 過大請求根絶方針★ ──
//   旧 (= 予測先取り・display ≥ distance_m 下限保証) は overshoot を生み過大請求の穴だった。
//   新方針: display ≤ distance_m (overshoot ゼロ・先取り廃止) + 単調非減少 + catch-up/latch 収束。
//   ここでは「上限 (display ≤ distance_m) + 単調非減少 + 復元/latch で一致」を assert する。
describe('Batch 1: display_distance_m (= overshoot ゼロ・上限/単調/latch)', () => {
  let Meter, fakeWorker;
  beforeEach(() => {
    ({ Meter, fakeWorker } = setupMeter());
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('display は distance_m を超えない (= overshoot ゼロ・過大請求の穴を塞ぐ)', () => {
    Meter.setDistance(500);
    const s = Meter.getState();
    // ★新方針: display ≤ distance_m (= 先取りしない・過大請求不能)。
    expect(s.display_distance_m).toBeLessThanOrEqual(500 + 1e-6);
  });

  it('pipeline delta で distance_m が増えても display ≤ distance_m を維持 + 単調非減少', () => {
    fakeWorker._dispatch({ type: 'mmResult', pipelineDeltaM: 100, snapped: true, committed: true });
    const s1 = Meter.getState();
    expect(s1.distance_m).toBe(100);
    // ★display は target(distance_m) を超えない (= overshoot ゼロ)。
    expect(s1.display_distance_m).toBeLessThanOrEqual(100 + 1e-6);
    fakeWorker._dispatch({ type: 'mmResult', pipelineDeltaM: 50, snapped: true, committed: true });
    const s2 = Meter.getState();
    expect(s2.distance_m).toBe(150);
    expect(s2.display_distance_m).toBeLessThanOrEqual(150 + 1e-6);
    // 単調非減少は維持 (= 後退しない)。
    expect(s2.display_distance_m).toBeGreaterThanOrEqual(s1.display_distance_m);
  });

  it('setDistance 急増 + latchDisplay で display == distance_m に一致 (= 復元経路)', () => {
    Meter.setDistance(100);
    const s1 = Meter.getState();
    Meter.setDistance(10000);
    // ★setDistance 単体では display は target を超えない (overshoot ゼロ)・即時に上へ飛ばない。
    const sMid = Meter.getState();
    expect(sMid.display_distance_m).toBeLessThanOrEqual(10000 + 1e-6);
    // 復元経路は latchDisplay で実距離に一致させる (= index.html checkDrivingRestore と同一配線)。
    Meter.latchDisplay();
    const s2 = Meter.getState();
    expect(s2.display_distance_m).toBeCloseTo(10000, 6);
    expect(s2.display_distance_m).toBeGreaterThan(s1.display_distance_m);
  });
});
