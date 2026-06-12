// tests/integration/mm-drain-after-start.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step P0-③ / 全32件)
//
// 検証対象: meter.js _drainMmUntil 500ms drain window (L357 / L619 / L1475)
//   Meter.start() で _drainMmUntil = Date.now() + 500 を設定。
//   _onMmWorkerMessage で Date.now() < _drainMmUntil なら mmIncrementM の
//   state.distance_m / state.business_distance_m への加算をスキップ。
//   mm_distance_m (stats) は加算する。
//
// 背景: 0.17km 誤加算事象 (2026-05-15 司さん報告) 再発防止。
//   業務開始 → 空車 phase で Worker B queue に mmIncrementM 残骸が溜まり、
//   代行開始直後 (Meter.start()) の event loop tick で main thread に届く race。
//   _drainMmUntil で 500ms 期間は破棄する設計。
//
// 絶対ルール準拠:
//   js/meter.js は触らない absolute。本 test は fake worker で main 側経路を検証。

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
  };
}

// Worker B mock (= meter-mm-priority.js makeFakeWorker と同じ pattern)
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

// ★白紙書き直し (2026-05-30・clean-rebuild-pipeline): 距離駆動は pipelineDeltaM に移行。
//   drain window 仕様 (= start 直後 500ms は加算 skip・stats のみ更新) は不変。
//   引数 incrementM を pipelineDeltaM として渡す (= 旧 mmIncrementM 駆動と同じ意味論)。
function mkMmResult(incrementM, opts) {
  opts = opts || {};
  return {
    type: 'mmResult',
    pipelineDeltaM: incrementM,
    tentativeIncrementM: opts.tentativeIncrementM || 0,
    snapped: opts.snapped !== false,
    committed: opts.committed !== false,
    isStationary: opts.isStationary || false,
    timestamp: opts.timestamp || Date.now(),
  };
}

describe('mm-drain-after-start (meter.js L357 + L619 _drainMmUntil)', () => {
  let Meter, fakeWorker;
  let realDateNow;

  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig(DEFAULT_FARE_CONFIG);
    Meter.reset();
    fakeWorker = makeFakeWorker();
    Meter.setMapMatcher(fakeWorker);
    // ★ Phase 2: business_distance_m 加算は business_active gate に変更されたため・test 環境で true 化
    if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
    realDateNow = Date.now;
  });

  afterEach(() => {
    Date.now = realDateNow;
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('Meter.start() 直後の mmResult (= drain 中) は state.distance_m に加算されない', () => {
    Meter.start(); // _drainMmUntil = Date.now() + 500
    fakeWorker._dispatch(mkMmResult(100));
    const s = Meter.getState();
    expect(s.distance_m).toBe(0);
  });

  it('Meter.start() 直後の mmResult (= drain 中) は state.business_distance_m に加算されない', () => {
    Meter.start();
    fakeWorker._dispatch(mkMmResult(100));
    const s = Meter.getState();
    expect(s.business_distance_m).toBe(0);
  });

  it('drain 中でも state.mm_distance_m (stats) は加算される (L367)', () => {
    Meter.start();
    fakeWorker._dispatch(mkMmResult(100));
    const s = Meter.getState();
    // stats 用 mm_distance_m は drain 中でも加算される (= 監視用)
    expect(s.mm_distance_m).toBe(100);
  });

  it('_setDrainMmUntil(0) で drain 即時無効化すれば mmResult が distance_m / business_distance_m に加算', () => {
    // ★設計変更宣言 (2026-05-24・司さん採用指示・道路 snap 構成):
    //   mm commit で・distance_m / business_distance_m 両方加算する設計に変更。
    //   gate: distance_m = state.running / business_distance_m = state.business_active
    //   本 test は・beforeEach で・setBusinessActive(true) 設定済 (= 業務 active 模擬)
    //   Meter.start() で・running=true
    //   → 両方加算される
    Meter.start();
    Meter._setDrainMmUntil(0); // drain 即時無効化
    fakeWorker._dispatch(mkMmResult(100));
    const s = Meter.getState();
    expect(s.distance_m).toBe(100);
    // ★ 道路 snap 構成: business_active=true で・mm commit で 100 加算 ★
    expect(s.business_distance_m).toBe(100);
  });

  it('Meter.start() から 500ms 以降の mmResult は加算される (= drain 期間終了)', () => {
    const fakeNow = realDateNow();
    Date.now = () => fakeNow;
    Meter.start(); // _drainMmUntil = fakeNow + 500
    // 501ms 経過した状態
    Date.now = () => fakeNow + 501;
    fakeWorker._dispatch(mkMmResult(100));
    const s = Meter.getState();
    expect(s.distance_m).toBe(100);
  });

  it('Meter.start() から 499ms (= 境界内) の mmResult は加算されない', () => {
    const fakeNow = realDateNow();
    Date.now = () => fakeNow;
    Meter.start();
    Date.now = () => fakeNow + 499;
    fakeWorker._dispatch(mkMmResult(100));
    const s = Meter.getState();
    expect(s.distance_m).toBe(0);
  });

  it('Meter.start() から 500ms ちょうど (= 境界・<比較で境界外) の mmResult は加算される', () => {
    const fakeNow = realDateNow();
    Date.now = () => fakeNow;
    Meter.start();
    Date.now = () => fakeNow + 500; // < _drainMmUntil で false (= 加算対象)
    fakeWorker._dispatch(mkMmResult(100));
    const s = Meter.getState();
    expect(s.distance_m).toBe(100);
  });

  it('drain 中に複数 mmResult を受信 → 全て破棄・累積加算なし', () => {
    Meter.start();
    fakeWorker._dispatch(mkMmResult(50));
    fakeWorker._dispatch(mkMmResult(75));
    fakeWorker._dispatch(mkMmResult(25));
    const s = Meter.getState();
    expect(s.distance_m).toBe(0);
    expect(s.business_distance_m).toBe(0);
    // ただし mm_distance_m (stats) には累積
    expect(s.mm_distance_m).toBe(150);
  });

  it('drain 終了後の mmResult は通常通り累積加算される', () => {
    const fakeNow = realDateNow();
    Date.now = () => fakeNow;
    Meter.start();
    // drain 中 (500ms 内)
    fakeWorker._dispatch(mkMmResult(100)); // 加算なし
    // drain 終了後 (501ms 経過)
    Date.now = () => fakeNow + 501;
    fakeWorker._dispatch(mkMmResult(50));
    fakeWorker._dispatch(mkMmResult(30));
    const s = Meter.getState();
    // 80m (= 50+30) のみ加算
    expect(s.distance_m).toBe(80);
  });

  it('★符号別検証: drain 中の mmIncrementM=0 / 負値 は早期 return (加算判定対象外)', () => {
    Meter.start();
    fakeWorker._dispatch(mkMmResult(0)); // mmIncrementM > 0 で false → drain チェックに到達しない
    fakeWorker._dispatch(mkMmResult(-5)); // 負値も同様
    const s = Meter.getState();
    expect(s.distance_m).toBe(0);
    expect(s.mm_distance_m).toBe(0);
  });

  it('Meter.start() 後 Meter.stop() を呼んでも _drainMmUntil は影響を受けない', () => {
    Meter.start();
    Meter.stop();
    // stop() 後でも _drainMmUntil は active (= L619 設定値のまま)
    // ただし state.running=false で _onMmWorkerMessage 内の running ガードに当たる可能性
    // ここでは drain 動作のみ検証
    fakeWorker._dispatch(mkMmResult(100));
    const s = Meter.getState();
    // stop() 後 running=false なので加算なし (drain か running ガードのいずれか)
    expect(s.distance_m).toBe(0);
  });
});
