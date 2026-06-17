// tests/integration/vehicle-k-meter.test.js
// ★OBD per-vehicle k は pipeline ラチェットへ一本化 (2026-06-13・司さん裁定A)★
//   旧設計(2026-06-12): meter が OBD∫v駆動delta に手動 _activeVehicleK を乗算(source-aware k)。
//   新設計: pipeline-distance が Doppler自動ラチェット(kNow)で per-vehicle スケールを既に適用 →
//     meter で再度乗算すると ★二重適用=過大課金(過大ゼロ違反)★。∴ meter は ★全 delta ×1.0(恒等)★。
//   本テストは「meter は手動k/source に依らず ×1.0(二重適用ゼロ)」を契約として固定する。
//   calibrateVehicleK/_activeVehicleK は dormant(距離に非作用・UI表示/将来用に学習関数は温存)。
//   過大ゼロは pipeline の Doppler下側分位天井が構造保証(別テスト: obd-doppler-ceiling/obd-overcount-zero)。

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

// ★source-aware k (2026-06-12)★: 随伴車k は ★OBD∫v駆動delta だけ★に適用(GPS駆動は×1.0)。
//   k機構(clamp/EWMA/業務ロック)の検証は OBD-tag delta で行う。GPS×1.0 は別途 (b2) で検証。
function deltaResult(deltaM, src) {
  return {
    type: 'mmResult',
    pipelineDeltaM: deltaM,
    pipelineDeltaSrc: src || 'obd',
    snapped: true,
    committed: true,
  };
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

  it('(b) ★二重適用ゼロ★: 手動k=1.005でも distance_m/business は ×1.0(pipelineラチェットが per-vehicle k)', () => {
    setProfile(1.005);
    startBusiness(Meter);
    [100, 200, 150].forEach((d) => w._dispatch(deltaResult(d)));
    const s = Meter.getState();
    expect(s.distance_m).toBeCloseTo(450, 4); // ×1.0 (×1.005でない=二重適用なし)
    expect(s.business_distance_m).toBeCloseTo(450, 4);
    expect(s.mm_distance_m).toBeCloseTo(450, 4); // RAW
  });

  it('(b2) source 不問で ×1.0: OBD駆動も GPS駆動も meter は手動k非適用(二重適用ゼロ)', () => {
    setProfile(1.005);
    startBusiness(Meter);
    w._dispatch(deltaResult(100, 'gps')); // GPS駆動 → ×1.0
    w._dispatch(deltaResult(200, 'obd')); // OBD駆動 → ×1.0 (旧: ×1.005 で二重→廃止)
    const s = Meter.getState();
    expect(s.distance_m).toBeCloseTo(300, 4); // 100 + 200 (両方×1.0)
    expect(s.mm_distance_m).toBeCloseTo(300, 4);
  });

  it('(c) 壊れた手動k=1.65 を注入しても distance に影響なし(×1.0・二重過大の経路自体が無い)', () => {
    setProfile(1.65);
    startBusiness(Meter);
    w._dispatch(deltaResult(1000));
    const s = Meter.getState();
    expect(s.distance_m).toBeCloseTo(1000, 4); // ×1.0 (1650/1020でない=手動k非作用)
    expect(s.mm_distance_m).toBeCloseTo(1000, 4);
  });

  it('(c2) 手動k=0.5 注入も distance に影響なし(×1.0)', () => {
    setProfile(0.5);
    startBusiness(Meter);
    w._dispatch(deltaResult(1000));
    expect(Meter.getState().distance_m).toBeCloseTo(1000, 4); // ×1.0 (900でない)
  });

  it('(d) 業務途中で profile.k を変えても distance は ×1.0 のまま(手動k は距離に非作用)', () => {
    setProfile(1.005);
    startBusiness(Meter);
    w._dispatch(deltaResult(100)); // ×1.0 = 100
    globalThis.DK_VEHICLE_PROFILE.k = 0.9; // 業務途中で改ざんしても距離に効かない
    w._dispatch(deltaResult(100)); // ×1.0 = 100
    const s = Meter.getState();
    expect(s.distance_m).toBeCloseTo(200.0, 4); // 100 + 100 (×1.0)
    expect(s.mm_distance_m).toBeCloseTo(200, 4);
  });

  describe('calibrateVehicleK (k学習)', () => {
    it('(e) ★calibrateVehicleK は dormant★: 学習しても distance_m は ×1.0 のまま(学習kが距離に漏れない=二重適用ゼロ)', () => {
      setProfile(1.0);
      startBusiness(Meter);
      // business は RAW = 10000 (×1.0)
      for (let i = 0; i < 100; i++) w._dispatch(deltaResult(100));
      expect(Meter.getState().business_distance_m).toBeCloseTo(10000, 2);
      // 学習を発火(k を 1.0 超へ動かそうとする)
      Meter.calibrateVehicleK(10300);
      // ★学習後も distance は ×1.0★: 次の delta=100 はそのまま +100 (×学習k でない=距離非作用)
      const before = Meter.getState().distance_m;
      w._dispatch(deltaResult(100, 'obd'));
      expect(Meter.getState().distance_m).toBeCloseTo(before + 100, 4);
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
      // cert=10400 → sample=1.04 (許容内) → k=0.3*1.04+0.7*1.0=1.012 (VK_MAX=1.02 未クランプ)
      const r = Meter.calibrateVehicleK(10400);
      expect(r.ok).toBe(true);
      // sample=1.04×0.997(cross-profileマージン)=1.0369 → EWMA 0.3*1.0369+0.7*1.0=1.0111 < VK_MAX
      expect(globalThis.DK_VEHICLE_PROFILE.k).toBeCloseTo(1.0111, 3);
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

  // ★認定据付測定K → pipeline 配線 (2026-06-15・認定前提)★:
  //   meter距離は依然 ×1.0(dormant・上記契約不変)。cert-K は pipeline(obdVehicleK)で OBD駆動のみ適用。
  //   meter の役割 = ★較正済(k_samples>0)の車だけ configVehicle{vehicleK} を worker へ通知★。
  //   未較正(k_samples=0/profile無)は vehicleK=0 → pipeline 従来自動(byte不変)。
  describe('cert-K → worker 配線 (configVehicle 通知)', () => {
    function recordingWorker() {
      const posts = [];
      const handlers = [];
      return {
        posts,
        addEventListener(type, h) {
          if (type === 'message') handlers.push(h);
        },
        removeEventListener(type, h) {
          const i = handlers.indexOf(h);
          if (i >= 0) handlers.splice(i, 1);
        },
        postMessage(m) {
          posts.push(m);
        },
        _dispatch(data) {
          for (const h of handlers) h({ data });
        },
      };
    }

    it('★較正済(k_samples>0)の業務開始 → configVehicle{vehicleK=clampedK} を post', () => {
      const rw = recordingWorker();
      Meter.setMapMatcher(rw);
      globalThis.window = globalThis;
      globalThis.DK_VEHICLE_PROFILE = { maker: 'X', model: 'Y', k: 1.02, k_samples: 1 };
      startBusiness(Meter);
      const cv = rw.posts.filter((p) => p && p.type === 'configVehicle');
      expect(cv.length).toBeGreaterThan(0);
      expect(cv[cv.length - 1].vehicleK).toBeCloseTo(1.02, 6); // 測定K(VK_MAX内)を通知
    });

    it('★未較正(k_samples無) → configVehicle{vehicleK=0} (pipeline 従来自動・byte不変)', () => {
      const rw = recordingWorker();
      Meter.setMapMatcher(rw);
      globalThis.window = globalThis;
      globalThis.DK_VEHICLE_PROFILE = { maker: 'X', model: 'Y' }; // k_samples 無
      startBusiness(Meter);
      const cv = rw.posts.filter((p) => p && p.type === 'configVehicle');
      expect(cv.length).toBeGreaterThan(0);
      expect(cv[cv.length - 1].vehicleK).toBe(0); // 焼かない=自動
    });

    it('★calibrateVehicleK 確定 → configVehicle を post (次業務から測定K反映)', () => {
      const rw = recordingWorker();
      Meter.setMapMatcher(rw);
      setProfile(1.0);
      startBusiness(Meter);
      for (let i = 0; i < 100; i++) rw._dispatch(deltaResult(100)); // raw=10000 (meter は rw を listen)
      const before = rw.posts.filter((p) => p && p.type === 'configVehicle').length;
      const r = Meter.calibrateVehicleK(10200);
      expect(r.ok).toBe(true);
      const after = rw.posts.filter((p) => p && p.type === 'configVehicle').length;
      expect(after).toBeGreaterThan(before); // 較正確定で post 発火
    });

    it('★meter距離は依然 ×1.0(cert-K配線後も二重適用ゼロ・契約不変)', () => {
      const rw = recordingWorker();
      Meter.setMapMatcher(rw);
      globalThis.window = globalThis;
      globalThis.DK_VEHICLE_PROFILE = { maker: 'X', model: 'Y', k: 1.02, k_samples: 1 };
      startBusiness(Meter);
      for (let i = 0; i < 5; i++) rw._dispatch(deltaResult(100));
      // meter は k を距離に乗じない(×1.0)=raw合計 500 のまま(cert-K は pipeline 側で別途)
      expect(Meter.getState().business_distance_m).toBeCloseTo(500, 2);
    });
  });

  // ★Factory較正(既存実測データ由来・型式別)★: 未較正でも 196号RTK採点済型式は工場較正Kを適用
  //   = 既存データを実機で再採取させない。個体較正があればそちら優先。
  describe('factory較正 (既存データ由来・型式別)', () => {
    function recordingWorker() {
      const posts = [];
      const handlers = [];
      return {
        posts,
        addEventListener(t, h) {
          if (t === 'message') handlers.push(h);
        },
        removeEventListener(t, h) {
          const i = handlers.indexOf(h);
          if (i >= 0) handlers.splice(i, 1);
        },
        postMessage(m) {
          posts.push(m);
        },
        _dispatch(data) {
          for (const h of handlers) h({ data });
        },
      };
    }
    it('★未較正のMG33S(モコ)→ factory K=1.018 を post (既存196号RTKデータ由来・再走行不要)', () => {
      const rw = recordingWorker();
      Meter.setMapMatcher(rw);
      globalThis.window = globalThis;
      globalThis.DK_VEHICLE_PROFILE = { katashiki: 'MG33S', model: 'モコ', k: 1, k_samples: 0 };
      startBusiness(Meter);
      const cv = rw.posts.filter((p) => p && p.type === 'configVehicle');
      expect(cv.length).toBeGreaterThan(0);
      expect(cv[cv.length - 1].vehicleK).toBeCloseTo(1.018, 4); // factory K(モコ)
    });
    it('★個体較正(k_samples>0)があれば factory より優先 (個体実測 > model prior)', () => {
      const rw = recordingWorker();
      Meter.setMapMatcher(rw);
      globalThis.window = globalThis;
      globalThis.DK_VEHICLE_PROFILE = { katashiki: 'MG33S', k: 1.01, k_samples: 2 };
      startBusiness(Meter);
      const cv = rw.posts.filter((p) => p && p.type === 'configVehicle');
      expect(cv[cv.length - 1].vehicleK).toBeCloseTo(1.01, 4); // 個体較正優先(factory 1.018でない)
    });
    it('★未知型式の未較正 → 0 (factory無し=従来自動・byte不変)', () => {
      const rw = recordingWorker();
      Meter.setMapMatcher(rw);
      globalThis.window = globalThis;
      globalThis.DK_VEHICLE_PROFILE = { katashiki: 'UNKNOWN99', k: 1, k_samples: 0 };
      startBusiness(Meter);
      const cv = rw.posts.filter((p) => p && p.type === 'configVehicle');
      expect(cv[cv.length - 1].vehicleK).toBe(0);
    });
  });
});
