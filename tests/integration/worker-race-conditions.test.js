// tests/integration/worker-race-conditions.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step ㉔ / 全32件)
//
// 検証対象: Worker A/B 同時 message arrival で main 側 _onMmWorkerMessage の整合性
//   2-hop messaging chain (gps.js → Worker A → main → meter.js → Worker B → main)
//   reset 中の mmResult arrival → discard 動作
//
// 絶対ルール準拠:
//   js/meter.js は触らない absolute・fake worker で連続 dispatch で race verify。

const path = require('path');

const METER_JS_PATH = path.join(__dirname, '..', '..', 'js', 'meter.js');

function loadMeter() {
  delete require.cache[require.resolve(METER_JS_PATH)];
  return require(METER_JS_PATH);
}

function mockGPS() {
  globalThis.GPS = {
    calcDistance: () => 0,
    calcDistance3D: () => 0,
  };
}

function makeFakeWorker() {
  const handlers = [];
  return {
    addEventListener(t, h) {
      if (t === 'message') handlers.push(h);
    },
    removeEventListener() {},
    postMessage() {},
    _dispatch(data) {
      for (const h of handlers) h({ data });
    },
  };
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

describe('Worker A/B race conditions (㉔)', () => {
  let Meter, fw;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig(FC);
    Meter.reset();
    fw = makeFakeWorker();
    Meter.setMapMatcher(fw);
    Meter.start();
    Meter._setDrainMmUntil(0);
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('R1: Worker A 5Hz + Worker B 1Hz の異速度 arrival で distance_m 整合', () => {
    // Worker A から GPS 5 回・Worker B からは 1 回 mmResult
    const baseTs = 1714100000000;
    for (let i = 0; i < 5; i++) {
      Meter.update({
        lat: 33.84,
        lng: 132.7656,
        accuracy: 5,
        speedKmh: 30,
        isStationary: false,
        timestamp: baseTs + i * 200,
      });
    }
    fw._dispatch({ type: 'mmResult', mmIncrementM: 100, snapped: true, committed: true });
    expect(Meter.getState().distance_m).toBe(100);
  });

  it('R2: 同期同タイミングで複数 mmResult dispatch → 累積加算', () => {
    fw._dispatch({ type: 'mmResult', mmIncrementM: 50, snapped: true, committed: true });
    fw._dispatch({ type: 'mmResult', mmIncrementM: 30, snapped: true, committed: true });
    fw._dispatch({ type: 'mmResult', mmIncrementM: 20, snapped: true, committed: true });
    expect(Meter.getState().distance_m).toBe(100);
  });

  it('R3: reset 中 (= 直後 drain) の mmResult arrival → discard', () => {
    Meter.reset();
    Meter.start(); // _drainMmUntil = Date.now() + 500
    // drain 中
    fw._dispatch({ type: 'mmResult', mmIncrementM: 200, snapped: true, committed: true });
    expect(Meter.getState().distance_m).toBe(0);
  });

  it('R4: businessEnd 中の mmResult arrival → discard (= running=false)', () => {
    fw._dispatch({ type: 'mmResult', mmIncrementM: 100, snapped: true, committed: true });
    expect(Meter.getState().distance_m).toBe(100);
    Meter.businessEnd(); // state.running = false
    fw._dispatch({ type: 'mmResult', mmIncrementM: 100, snapped: true, committed: true });
    // running=false で加算なし
    expect(Meter.getState().distance_m).toBe(100);
  });

  it('R5: 不正 type の message は無視 (= type !== mmResult)', () => {
    fw._dispatch({ type: 'wrongType', mmIncrementM: 500, snapped: true });
    fw._dispatch({ type: 'mmResult', mmIncrementM: 100, snapped: true, committed: true });
    expect(Meter.getState().distance_m).toBe(100);
  });

  it('R6: 不正 data (= 空 object) でも例外なし', () => {
    expect(() => fw._dispatch({})).not.toThrow();
    expect(() => fw._dispatch({ type: 'mmResult' })).not.toThrow();
    expect(Meter.getState().distance_m).toBe(0);
  });

  it('R7: mmResult arrival → GPS update → mmResult arrival の交互順序', () => {
    fw._dispatch({ type: 'mmResult', mmIncrementM: 50, snapped: true, committed: true });
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 30,
      isStationary: false,
      timestamp: 1714100000000,
    });
    fw._dispatch({ type: 'mmResult', mmIncrementM: 30, snapped: true, committed: true });
    expect(Meter.getState().distance_m).toBe(80);
  });
});
