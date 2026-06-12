// tests/integration/vehicle-k-meter.test.js
// ★随伴車別 k(メーター定数/器差調整)校正 の契約テスト (2026-06-09・discovery監査スペック準拠)★
//   設計: k は engine(pipeline-distance) 無改変・meter 層の器差定数として適用。
//     - distance_m / business_distance_m は rawDelta × _activeVehicleK (校正)
//     - mm_distance_m は rawDelta のまま (RAW・校正前監査ベースライン温存)
//     - k は代行開始(setBusinessActive false→true / start)でロック=業務別
//     - _clampVK で [VK_MIN=0.90, VK_MAX=1.01] ハードクランプ (VK_MAX=唯一の過大臨界)
//     - calibrateVehicleK: sample=cert/raw(複利安全)・D<1000m/5%超急変は拒否・保守EWMA(0.3)
//   絶対ルール: 過大ゼロ(cert≤真値 → k適用後≤cert≤真値)・業務別のみ・k=1.0で現行1byte不変。

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
    calcDistance: () => 0,
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

function deltaResult(deltaM) {
  return { type: 'mmResult', pipelineDeltaM: deltaM, snapped: true, committed: true };
}

// 業務を開始して running+business_active+drain解除にする
function startBusiness(Meter) {
  Meter.setBusinessActive(true); // false→true で k ロック
  Meter.start(); // running=true (+ k 再解決の保険)
  Meter._setDrainMmUntil(0); // drain window 解除 (= delta を捨てない)
}

function setProfile(k) {
  globalThis.window = globalThis;
  globalThis.DK_VEHICLE_PROFILE =
    k == null ? { maker: 'X', model: 'Y' } : { maker: 'X', model: 'Y', k };
  // _resolveVK は window.DK_VEHICLE_PROFILE を読む (window===globalThis)
}

describe('随伴車別 k 校正 (meter 層器差定数)', () => {
  let Meter, w;
  beforeEach(() => {
    mockGPS();
    delete globalThis.DK_VEHICLE_PROFILE;
    globalThis.window = globalThis;
    Meter = loadMeter();
    Meter.setFareConfig(DEFAULT_FARE_CONFIG);
    Meter.reset();
    w = makeFakeWorker();
    Meter.setMapMatcher(w);
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
    delete globalThis.DK_VEHICLE_PROFILE;
  });

  it('(a) profile無し(既定k=1.0)→ distance_m/business_distance_m/mm_distance_m が全て生delta合計と一致(1byte不変)', () => {
    setProfile(null); // k フィールド無し → 1.0
    startBusiness(Meter);
    [100, 200, 150].forEach((d) => w._dispatch(deltaResult(d)));
    const s = Meter.getState();
    expect(s.distance_m).toBeCloseTo(450, 6);
    expect(s.business_distance_m).toBeCloseTo(450, 6);
    expect(s.mm_distance_m).toBeCloseTo(450, 6);
  });

  it('(b) k=1.005 → distance_m/business_distance_m は ×1.005 校正・mm_distance_m は RAW(校正しない)', () => {
    setProfile(1.005);
    startBusiness(Meter);
    [100, 200, 150].forEach((d) => w._dispatch(deltaResult(d)));
    const s = Meter.getState();
    expect(s.distance_m).toBeCloseTo(450 * 1.005, 4); // 452.25
    expect(s.business_distance_m).toBeCloseTo(450 * 1.005, 4);
    expect(s.mm_distance_m).toBeCloseTo(450, 4); // RAW
  });

  it('(c) 壊れた学習値 k=1.65 を注入しても適用は VK_MAX=1.01 にハードクランプ', () => {
    setProfile(1.65);
    startBusiness(Meter);
    w._dispatch(deltaResult(1000));
    const s = Meter.getState();
    expect(s.distance_m).toBeCloseTo(1000 * 1.01, 4); // 1010 (1650でない)
    expect(s.mm_distance_m).toBeCloseTo(1000, 4);
  });

  it('(c2) k=0.5 注入も VK_MIN=0.90 にクランプ(下側)', () => {
    setProfile(0.5);
    startBusiness(Meter);
    w._dispatch(deltaResult(1000));
    expect(Meter.getState().distance_m).toBeCloseTo(900, 4); // 0.90 下限
  });

  it('(d) 業務途中で profile.k を変えても当該業務は開始時ロック値のまま(業務別)', () => {
    setProfile(1.005);
    startBusiness(Meter); // ここで k=1.005 ロック
    w._dispatch(deltaResult(100)); // ×1.005 = 100.5
    globalThis.DK_VEHICLE_PROFILE.k = 0.9; // 業務途中で改ざん
    w._dispatch(deltaResult(100)); // ★依然 ×1.005★ = 100.5 (0.9でない)
    const s = Meter.getState();
    expect(s.distance_m).toBeCloseTo(201.0, 4); // 100.5 + 100.5
    expect(s.mm_distance_m).toBeCloseTo(200, 4);
  });

  describe('calibrateVehicleK (k学習)', () => {
    it('(e) 複利安全: sample=cert/raw に収束(現kで校正済の業務距離でも正しく学習)', () => {
      setProfile(1.005);
      startBusiness(Meter);
      // raw 合計 10000 → business_distance_m = 10050 (×1.005 校正済)
      for (let i = 0; i < 100; i++) w._dispatch(deltaResult(100));
      expect(Meter.getState().business_distance_m).toBeCloseTo(10050, 2);
      // cert=10000 → sample = cert/raw = 10000/10000 = 1.0 (複利でなく)
      const r = Meter.calibrateVehicleK(10000);
      expect(r.ok).toBe(true);
      // k_new = 0.3*sample + 0.7*prevK = 0.3*1.0 + 0.7*1.005 = 1.0035
      expect(globalThis.DK_VEHICLE_PROFILE.k).toBeCloseTo(1.0035, 4);
    });

    it('(f1) 短業務 D<1000m は拒否(GPS脱落/誤校正防止)・k 不変', () => {
      setProfile(1.0);
      startBusiness(Meter);
      w._dispatch(deltaResult(500)); // business=500 < 1000
      const r = Meter.calibrateVehicleK(495);
      expect(r.ok).toBe(false);
      expect(
        globalThis.DK_VEHICLE_PROFILE.k == null || globalThis.DK_VEHICLE_PROFILE.k === 1.0
      ).toBe(true);
    });

    it('(f2) 1業務で5%超の急変は拒否(異常走行/メーター誤入力)', () => {
      setProfile(1.0);
      startBusiness(Meter);
      for (let i = 0; i < 100; i++) w._dispatch(deltaResult(100)); // raw=10000
      // cert=11000 → sample=1.10 (|1.10/1.0-1|=0.10>0.05) 拒否
      const r = Meter.calibrateVehicleK(11000);
      expect(r.ok).toBe(false);
    });

    it('(g) 保守EWMA: 1業務が k を支配しない(新値3割)', () => {
      setProfile(1.0);
      startBusiness(Meter);
      for (let i = 0; i < 100; i++) w._dispatch(deltaResult(100)); // raw=10000
      // cert=10400 → sample=1.04 (許容内) → k=0.3*1.04+0.7*1.0=1.012 → clamp 1.01
      const r = Meter.calibrateVehicleK(10400);
      expect(r.ok).toBe(true);
      expect(globalThis.DK_VEHICLE_PROFILE.k).toBeCloseTo(1.01, 4); // VK_MAX クランプ
    });

    it('(h) never-over: cert(真値以下) を学習基準 → 次業務の k 適用後距離 ≤ cert', () => {
      setProfile(1.0);
      startBusiness(Meter);
      for (let i = 0; i < 100; i++) w._dispatch(deltaResult(100)); // raw=10000
      const cert = 10300; // 真値以下の認定メーター読み (raw比+3%)
      Meter.calibrateVehicleK(cert); // k=0.3*1.03+0.7*1.0=1.009
      const k = globalThis.DK_VEHICLE_PROFILE.k;
      // 次業務 (同じ raw=10000) の校正後距離
      const nextCalibrated = 10000 * k;
      expect(nextCalibrated).toBeLessThanOrEqual(cert + 1e-6); // ≤ cert (過大ゼロ側)
    });
  });
});
