// ★物差し★ 2026-08-28 … ★①タクシー認定モードの線（過大ゼロ）で 判定しています★
//   ・この見張りが 赤にするのは ★distance_m ≤ 真距離（過大不可）★ を 破った時（この file 自身に そう書いてある）
//   ・★代行は 検定対象外★＝法として「真距離を超えるな」は 課されていません。
//     代行の実上限は ★DM Light／タイヤ真値 ＋0.5〜6%★ という 緩い天井（係数 1.0085 で わざと上乗せ）。
//   ⇒★ここが赤でも「代行で 過大請求している」とは 限りません★。
//     うちは ★内側の約束★として 過大ゼロを 守っています（2026-08-23 の誤読を 二度と させない為 明記）。
// tests/integration/meter-loadfill.test.js
// ★loadfill 回帰ガード (2026-06-07 新規)★
//
// 検証対象: js/meter.js gap補完ブロックの「道路ロード中 loadfill」分岐。
//   実機 2026-06-06夜 Android 1回目 -9.2% の真因 = 代行開始時に現在県の道路が
//   約37秒未ロードで序盤が snap できず距離が消える (gap補完は dt>=5s の穴しか
//   埋めず通常 1Hz 移動 dt≈1s を取りこぼし)。
//   修正 = roadsLoading (mmWorker あり・roadsLoaded ack ゼロ) の間は minGapSec=0 で
//   通常移動も speed×時間 (160km/h cap・認定メーター準拠) で計上 (distanceSource='loadfill')。
//   roadsLoaded ack で外側条件 false → snap (pipelineDeltaM) に排他切替 = 二重計上なし。
//
// 絶対ルール準拠:
//   distance_m/calcFare 不可侵 (本テストは挙動の固定化のみ)。never-over: 速度 cap 160km/h。
//   実トレース忠実検証は tests/replay-realtrace/clocked-harness.js (vitest 外・vm 直載り不安定のため)。

const path = require('path');
const METER_JS_PATH = path.join(__dirname, '..', '..', 'js', 'meter.js');

function loadMeter() {
  delete require.cache[require.resolve(METER_JS_PATH)];
  return require(METER_JS_PATH);
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

const BASE_TS = 1714100000000;
function gps(sec, speedKmh = 36, extra = {}) {
  return {
    lat: 33.84,
    lng: 132.7656,
    accuracy: 5,
    speedKmh,
    isStationary: false,
    timestamp: BASE_TS + sec * 1000,
    ...extra,
  };
}

describe('meter loadfill (道路ロード中の通常移動計上・dt≈1s)', () => {
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

  it('★ roadsLoading 中は 1Hz 通常移動を speed×時間で計上 (distanceSource=loadfill)', () => {
    // roadsLoaded ack なし = ロード中。36km/h = 10m/s × dt1s → 10m/点。
    Meter.update(gps(0)); // 初回は last_timestamp 無しで gap 計算なし
    Meter.update(gps(1));
    Meter.update(gps(2));
    Meter.update(gps(3));
    const s = Meter.getState();
    expect(s.distance_m).toBeCloseTo(30, 6); // 10m × 3区間
    expect(s.distanceSource).toBe('loadfill');
  });

  it('★ roadsLoaded ack 後は GPS 単独で距離が動かない (snap 排他切替=二重計上なし)', () => {
    Meter.update(gps(0));
    Meter.update(gps(1)); // loadfill +10m
    fw._dispatch({ type: 'roadsLoaded', ok: true, pref: 'ehime' });
    Meter.update(gps(2));
    Meter.update(gps(3)); // ロード完了後の GPS 単独 → 加算ゼロ
    expect(Meter.getState().distance_m).toBeCloseTo(10, 6);
    // 距離駆動は pipeline delta に切替
    fw._dispatch({ type: 'mmResult', pipelineDeltaM: 25, snapped: true, committed: true });
    const s = Meter.getState();
    expect(s.distance_m).toBeCloseTo(35, 6);
    expect(s.distanceSource).toBe('pipeline');
  });

  it('worker 不在 (mmWorker=null) は従来どおり dt<5s を計上しない (loadfill 非発火)', () => {
    Meter.setMapMatcher(null);
    Meter.update(gps(0));
    Meter.update(gps(1));
    Meter.update(gps(2));
    expect(Meter.getState().distance_m).toBe(0); // gap補完は dt>=5s のみ (既存挙動不変)
  });

  it('worker 不在の dt>=5s gap は従来 gap 補完 (distanceSource=gap・既存挙動不変)', () => {
    Meter.setMapMatcher(null);
    Meter.update(gps(0));
    Meter.update(gps(10)); // dt=10s × 10m/s = 100m
    const s = Meter.getState();
    expect(s.distance_m).toBeCloseTo(100, 6);
    expect(s.distanceSource).toBe('gap');
  });

  it('never-over: loadfill の速度は 160km/h に clamp (異常 speed で過大計上しない)', () => {
    Meter.update(gps(0, 300));
    Meter.update(gps(1, 300)); // 300km/h → 160km/h = 44.44m/s
    expect(Meter.getState().distance_m).toBeCloseTo(160 / 3.6, 4);
  });

  it('running=false では loadfill 発火しない (running gate 不可侵)', () => {
    Meter.stop();
    Meter.update(gps(0));
    Meter.update(gps(1));
    expect(Meter.getState().distance_m).toBe(0);
  });

  it('isStationary 点では loadfill 発火しない (停止 creep ゼロ維持)', () => {
    Meter.update(gps(0));
    Meter.update(gps(1, 36, { isStationary: true }));
    Meter.update(gps(2, 0));
    expect(Meter.getState().distance_m).toBe(0);
  });

  it('business_active 中は business_distance_m にも同額計上', () => {
    Meter.setBusinessActive(true);
    Meter.update(gps(0));
    Meter.update(gps(1));
    const s = Meter.getState();
    expect(s.distance_m).toBeCloseTo(10, 6);
    expect(s.business_distance_m).toBeCloseTo(10, 6);
  });
});
