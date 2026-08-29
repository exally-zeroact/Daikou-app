// ★物差し★ 2026-08-28 … ★①タクシー認定モードの線（過大ゼロ）で 判定しています★
//   ・この見張りが 赤にするのは ★distance_m ≤ 真距離（過大不可）★ を 破った時（この file 自身に そう書いてある）
//   ・★代行は 検定対象外★＝法として「真距離を超えるな」は 課されていません。
//     代行の実上限は ★DM Light／タイヤ真値 ＋0.5〜6%★ という 緩い天井（係数 1.0085 で わざと上乗せ）。
//   ⇒★ここが赤でも「代行で 過大請求している」とは 限りません★。
//     うちは ★内側の約束★として 過大ゼロを 守っています（2026-08-23 の誤読を 二度と させない為 明記）。
// tests/integration/speed-src-doppler-only.test.js
// ★speedSrc 貫通 (2026-06-07・STEP1 テスト先行)★
//
// 真因 (0606night SE 業務1 -64m 実測): gps.js は欠落 Doppler を haversine 代用速度
// ('hav') で置換して送るが、エンジンの gap 補完は「spd 既知 → spd×dt (Doppler fill)」を使う。
// 代用速度は gap 跨ぎで「既知の微速」になり、straight 補完 (69.5m) を spd×dt (4.1m) で
// 潰して ★過小★ を作る。エンジン検証は常に生 Doppler (-1=不明) の fixture で行われており、
// 「hav は不明として扱う」がエンジン契約。
//
// 修正 = speedSrc を gps-worker 出力 → meter 転送 → map-matcher で貫通し、
// ★エンジンの sample.spd には本物の Doppler ('dop') のみ渡す★ (hav → -1=不明)。

const path = require('path');
const { createMapMatcherWorker, loadPrefRoadsData } = require('../replay-mm-worker/worker-sim');
const { createGpsWorker } = require('../worker/gps-worker-sim');

const METER_JS_PATH = path.join(__dirname, '..', '..', 'js', 'meter.js');
function loadMeter() {
  delete require.cache[require.resolve(METER_JS_PATH)];
  return require(METER_JS_PATH);
}
function mockGPS() {
  globalThis.GPS = { calcDistance: () => 0, calcDistance3D: () => 0, setRoadType: () => {} };
}

// 愛媛 bbox 内の基準点 (実 fixture 走行域)
const BASE = { lat: 34.0658, lng: 132.997 };
const T0 = 1714000000000;

function gapScenario(src) {
  // P0,P1: 微動 (1s) → 6s gap で ~80m 北へ → P3,P4: 微動 (平滑 h=2 の確定用)
  const spdMps = 0.9; // 「既知の微速」(hav 代用が作る値)
  const mk = (lat, lng, t) => ({
    type: 'gps',
    lat,
    lng,
    timestamp: t,
    accuracy: 8,
    speedKmh: spdMps * 3.6,
    speedSrc: src,
    headingDeg: null,
    altitude: 0,
    isStationary: false,
  });
  return [
    mk(BASE.lat, BASE.lng, T0),
    mk(BASE.lat + 0.00001, BASE.lng, T0 + 1000),
    mk(BASE.lat + 0.00073, BASE.lng, T0 + 7000), // +6s で ~80m (gap 補完対象)
    mk(BASE.lat + 0.00074, BASE.lng, T0 + 8000),
    mk(BASE.lat + 0.00075, BASE.lng, T0 + 9000),
  ];
}

function runWorkerB(msgs) {
  const worker = createMapMatcherWorker({ debug: false });
  worker.sendMessage({ type: 'configPlatform', isIOS: false });
  worker.sendMessage({ type: 'loadRoads', pref: 'ehime', roadsData: loadPrefRoadsData('ehime') });
  let sum = 0;
  worker.on((e) => {
    const m = e.data;
    if (m && m.type === 'mmResult' && typeof m.pipelineDeltaM === 'number' && m.pipelineDeltaM > 0)
      sum += m.pipelineDeltaM;
  });
  for (const m of msgs) worker.sendMessage(m);
  worker.sendMessage({ type: 'reset' }); // flush 込み
  return sum;
}

describe('speedSrc 貫通 (hav 代用速度はエンジンに「不明」として渡す)', () => {
  it('★ worker B: src=hav の gap 跨ぎは straight 補完 (微速×dt で潰さない)', () => {
    const havTotal = runWorkerB(gapScenario('hav'));
    // 80m gap が straight で入る (過小バグ時は ~5m 台に潰れる)
    expect(havTotal).toBeGreaterThan(60);
    expect(havTotal).toBeLessThan(120); // never-over: chord 大幅超えはしない
  });

  it('★ worker B: src=dop の同条件は Doppler fill (spd×dt) = 既存 never-over 維持', () => {
    const dopTotal = runWorkerB(gapScenario('dop'));
    // 本物の Doppler 0.9m/s × 6s ≈ 5.4m 級 (gap は速度が真実・チャンバー判定はエンジン規則)
    expect(dopTotal).toBeLessThan(30);
  });

  it('★ gps-worker: 出力に speedSrc を echo する', () => {
    const gw = createGpsWorker({ debug: false });
    gw.sendMessage({ type: 'init', data: { config: {}, debug: false } });
    const feed = (src, t) =>
      gw.sendMessage({
        type: 'position',
        data: {
          lat: BASE.lat,
          lng: BASE.lng,
          accuracy: 8,
          speedKmh: 10,
          heading: null,
          altitude: 0,
          now: t,
          compassHeading: null,
          accelData: null,
          accelSamples: [],
          gyroData: null,
          gyroSamples: [],
          speedSrc: src,
        },
      });
    feed('dop', T0);
    feed('hav', T0 + 1000);
    const out = gw.getResults();
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[out.length - 2].speedSrc).toBe('dop');
    expect(out[out.length - 1].speedSrc).toBe('hav');
  });

  it('★ meter: worker B への gps 転送に speedSrc を含める (走行/停車 両経路)', () => {
    mockGPS();
    const Meter = loadMeter();
    Meter.reset();
    const posted = [];
    const fw = {
      addEventListener() {},
      removeEventListener() {},
      postMessage(m) {
        posted.push(m);
      },
    };
    Meter.setMapMatcher(fw);
    // roadsLoaded 扱いにする (= _updateMapMatching が post する条件)
    // fake worker は listener を捨てるので直接 roadsLoaded を流せない → addEventListener 捕捉版
    const handlers = [];
    const fw2 = {
      addEventListener(t, h) {
        if (t === 'message') handlers.push(h);
      },
      removeEventListener() {},
      postMessage(m) {
        posted.push(m);
      },
    };
    Meter.setMapMatcher(fw2);
    for (const h of handlers) h({ data: { type: 'roadsLoaded', ok: true, pref: 'ehime' } });
    Meter.start();
    posted.length = 0;
    Meter.update({
      lat: BASE.lat,
      lng: BASE.lng,
      accuracy: 8,
      speedKmh: 30,
      speedSrc: 'hav',
      isStationary: false,
      timestamp: T0,
    });
    Meter.update({
      lat: BASE.lat,
      lng: BASE.lng,
      accuracy: 8,
      speedKmh: 0,
      speedSrc: 'dop',
      isStationary: true,
      timestamp: T0 + 1000,
    });
    const gpsMsgs = posted.filter((m) => m && m.type === 'gps');
    expect(gpsMsgs.length).toBe(2);
    expect(gpsMsgs[0].speedSrc).toBe('hav');
    expect(gpsMsgs[1].speedSrc).toBe('dop');
    Meter.reset();
    delete globalThis.GPS;
  });
});
