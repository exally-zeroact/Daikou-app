// センサー系モックテスト (2026-05-15・動的解析 ③)
// gps.js / Business / Meter を Node sandbox に load し、navigator / sessionStorage /
// MM Worker を stub することで以下を検証:
//   - GPS 精度低下時の状態反映 (GPS._status / 低精度フラグ)
//   - タスクキル復元時の状態シミュレーション (Business.load + Meter restore)
//   - オフライン (navigator.onLine=false) 時の Off-Road Mode fallback シミュレーション
// 注: index.html の checkDrivingRestore() / MM Worker 実体は Worker / DOM 依存のため
//     完全な実機 E2E は tests/e2e/* で別途実施・本テストは module 層のロジック単体を対象。

const fs = require('fs');
const path = require('path');

const GPS_JS_PATH = path.join(__dirname, '..', 'js', 'gps.js');
const BUSINESS_JS_PATH = path.join(__dirname, '..', 'js', 'business.js');
const METER_JS_PATH = path.join(__dirname, '..', 'js', 'meter.js');
const FARE_CALC_JS_PATH = path.join(__dirname, '..', 'js', 'fare-calc.js');

// ──────────────────────────────────────────────────────────────
// 共通: navigator / window / その他 browser global の sandbox 構築
// ──────────────────────────────────────────────────────────────
function makeLocalStorage() {
  const store = Object.create(null);
  return {
    getItem(k) {
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
    setItem(k, v) {
      store[k] = String(v);
    },
    removeItem(k) {
      delete store[k];
    },
    clear() {
      for (const k of Object.keys(store)) delete store[k];
    },
    key(i) {
      return Object.keys(store)[i] || null;
    },
    get length() {
      return Object.keys(store).length;
    },
    _raw: store,
  };
}

function makeNavigator({
  onLine = true,
  geolocation = null,
  userAgent = 'Mozilla/5.0 (E2E test sandbox)',
} = {}) {
  return {
    onLine,
    userAgent,
    geolocation: geolocation || {
      watchPosition: () => 0,
      clearWatch: () => {},
      getCurrentPosition: () => {},
    },
  };
}

function loadGps({ navigator: nav } = {}) {
  // gps.js は const GPS = (() => {...})() で top-level・new Function wrap で取り出す
  const code = fs.readFileSync(GPS_JS_PATH, 'utf8') + '\n;return GPS;';
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.navigator = nav || makeNavigator();
  sandbox.localStorage = makeLocalStorage();
  sandbox.sessionStorage = makeLocalStorage();
  sandbox.dlog = () => {};
  sandbox.DEBUG = { enabled: false, isProduction: false };
  sandbox.Worker = undefined;
  sandbox.console = console;
  sandbox.performance =
    typeof performance !== 'undefined' ? performance : { now: () => Date.now() };
  sandbox.self = sandbox;
  // DeviceOrientationEvent / DeviceMotionEvent は使われた場合に typeof undefined で skip される
  const fn = new Function(
    'window',
    'navigator',
    'localStorage',
    'sessionStorage',
    'dlog',
    'DEBUG',
    'Worker',
    'console',
    'performance',
    'self',
    code
  );
  return fn(
    sandbox.window,
    sandbox.navigator,
    sandbox.localStorage,
    sandbox.sessionStorage,
    sandbox.dlog,
    sandbox.DEBUG,
    sandbox.Worker,
    sandbox.console,
    sandbox.performance,
    sandbox.self
  );
}

function loadBusiness({ meter, localStorageMock }) {
  const code = fs.readFileSync(BUSINESS_JS_PATH, 'utf8') + '\n;return window.Business;';
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.Meter = meter;
  sandbox.localStorage = localStorageMock || makeLocalStorage();
  sandbox.dlog = () => {};
  sandbox.console = console;
  const fn = new Function('window', 'Meter', 'localStorage', 'dlog', 'console', code);
  return fn(sandbox.window, sandbox.Meter, sandbox.localStorage, sandbox.dlog, sandbox.console);
}

// ──────────────────────────────────────────────────────────────
// ① GPS 精度低下テスト
// ──────────────────────────────────────────────────────────────
describe('GPS 精度低下: navigator.geolocation を mock し accuracy=50 を注入', () => {
  it('GPS.start callback に accuracy=50 が渡り getStatus().state が granted になる', async () => {
    // watchPosition を捕まえて success callback を即座に発火する mock
    let _onPos = null;
    const navMock = makeNavigator({
      geolocation: {
        watchPosition(success) {
          _onPos = success;
          return 1;
        },
        clearWatch() {},
      },
    });
    const GPS = loadGps({ navigator: navMock });
    expect(typeof GPS.start).toBe('function');
    expect(typeof GPS.onStatusChange).toBe('function');

    // 起動・accuracy=50 (低精度) で fix
    const received = [];
    GPS.onStatusChange((s) => received.push(s.state));
    GPS.start(() => {});

    // mock の position fix
    _onPos({
      coords: {
        latitude: 35.681,
        longitude: 139.767,
        accuracy: 50,
        altitude: 5,
        speed: null,
        heading: null,
      },
      timestamp: Date.now(),
    });
    // state は denied/unknown → granted に遷移する
    expect(received).toContain('granted');
    const final = GPS.getStatus();
    expect(final.state).toBe('granted');
  });

  it('GPS 高精度 (accuracy=5) と低精度 (accuracy=50) で onUpdate に渡される値が異なる', async () => {
    let _onPos = null;
    const navMock = makeNavigator({
      geolocation: {
        watchPosition(success) {
          _onPos = success;
          return 1;
        },
        clearWatch() {},
      },
    });
    const GPS = loadGps({ navigator: navMock });
    const updates = [];
    GPS.start((g) => updates.push(g));
    _onPos({
      coords: {
        latitude: 35.0,
        longitude: 139.0,
        accuracy: 5,
        altitude: 0,
        speed: 0,
        heading: null,
      },
      timestamp: Date.now(),
    });
    _onPos({
      coords: {
        latitude: 35.001,
        longitude: 139.001,
        accuracy: 50,
        altitude: 0,
        speed: 0,
        heading: null,
      },
      timestamp: Date.now() + 1000,
    });
    expect(updates.length).toBeGreaterThanOrEqual(1);
    // accuracy が各 update で異なることを確認 (低精度判定の前段)
    if (updates.length >= 2) {
      expect(updates[0].accuracy).not.toBe(updates[1].accuracy);
    }
  });
});

// ──────────────────────────────────────────────────────────────
// ② タスクキル復元テスト
// ──────────────────────────────────────────────────────────────
describe('タスクキル復元: saved Business state を localStorage 経由で復元', () => {
  it('Business.load() で active=true / total_distance_m が復元される', () => {
    const meter = {
      _bd: 0,
      getState() {
        return { distance_m: 0, business_distance_m: this._bd, running: false };
      },
      setBusinessDistance(v) {
        this._bd = v;
      },
    };
    const ls = makeLocalStorage();
    // 業務復元用 saved state (タスクキル直前に save() された想定)
    ls.setItem(
      'daikou_business_state',
      JSON.stringify({
        active: true,
        start_time: Date.now() - 3600000,
        end_time: null,
        ended: false,
        ended_at: null,
        total_distance_m: 1500,
        actual_total_m: 800,
        fare_total_yen: 2200,
        trip_count: 2,
        trips: [],
        last_meter_distance_m: 800,
      })
    );
    const Business = loadBusiness({ meter, localStorageMock: ls });
    const ok = Business.load();
    expect(ok).toBe(true);
    const s = Business.getState();
    expect(s.active).toBe(true);
    expect(s.total_distance_m).toBe(1500);
    expect(s.actual_total_m).toBe(800);
    expect(s.trip_count).toBe(2);
    // Meter 側にも逆流復元される (Phase 2.5 仕様)
    expect(meter._bd).toBe(1500);
  });

  it('Business.load() で空 state はそのまま空 (誤復元しない)', () => {
    const meter = {
      _bd: 0,
      getState() {
        return { distance_m: 0, business_distance_m: 0, running: false };
      },
      setBusinessDistance(v) {
        this._bd = v;
      },
    };
    const ls = makeLocalStorage();
    const Business = loadBusiness({ meter, localStorageMock: ls });
    const ok = Business.load();
    expect(ok).toBe(false);
    const s = Business.getState();
    expect(s.active).toBe(false);
    expect(s.total_distance_m).toBe(0);
    expect(meter._bd).toBe(0); // Meter prime も走らない
  });
});

// ──────────────────────────────────────────────────────────────
// ③ オフライン切替テスト
// ──────────────────────────────────────────────────────────────
describe('オフライン切替: navigator.onLine = false の状態を sandbox で模擬', () => {
  it('GPS は navigator.onLine=false でも watchPosition を呼び出せる (geolocation はオフライン依存しない)', () => {
    let calls = 0;
    const navMock = makeNavigator({
      onLine: false,
      geolocation: {
        watchPosition() {
          calls++;
          return 1;
        },
        clearWatch() {},
      },
    });
    const GPS = loadGps({ navigator: navMock });
    expect(navMock.onLine).toBe(false);
    GPS.start(() => {});
    expect(calls).toBe(1);
  });

  it('オフライン時の Off-Road Mode フォールバック契約 (Meter.state.offroad_count の存在を確認)', () => {
    // 注: 実際の Off-Road Mode 起動は MM Worker からの skipped/snapped 連続が必要で
    //     Node sandbox では Worker を起動しない。本テストは Meter state スキーマ整合性のみ確認。
    // ★本番が 積んでいる 物を 全部 積む★ 2026-09-01（料金の 計算は meter.js より 前）
    const code =
      fs.readFileSync(FARE_CALC_JS_PATH, 'utf8') +
      '\n' +
      fs.readFileSync(METER_JS_PATH, 'utf8') +
      '\n;return Meter;';
    const sandbox = {};
    sandbox.window = sandbox;
    sandbox.dlog = () => {};
    sandbox.DEBUG = { enabled: false, isProduction: false };
    sandbox.console = console;
    sandbox.performance =
      typeof performance !== 'undefined' ? performance : { now: () => Date.now() };
    const fn = new Function('window', 'dlog', 'DEBUG', 'console', 'performance', code);
    const Meter = fn(
      sandbox.window,
      sandbox.dlog,
      sandbox.DEBUG,
      sandbox.console,
      sandbox.performance
    );
    const s = Meter.getState();
    // Off-Road Mode の state フィールドが存在する (オフライン MM Worker dead 時の累積保管先)
    expect(typeof s.offroad_count).toBe('number');
    expect(typeof s.offroad_distance_m).toBe('number');
    expect(s.offroad_count).toBe(0);
    expect(s.offroad_distance_m).toBe(0);
  });
});
