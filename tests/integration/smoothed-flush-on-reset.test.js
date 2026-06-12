// tests/integration/smoothed-flush-on-reset.test.js
// ★smoothedRawMode 出荷 STEP1 (2026-06-07・テストツール先行)★
//
// 検証対象: 業務終了 (= main が worker へ 'reset' を post) で、smoothedRawMode の
//   遅延バッファ末尾 (未確定 h 点) が tracker.flush() で確定され、
//   mmResult.pipelineDeltaM として post されてから _resetPipelineTrackers される配線。
//
//   - 走行中に業務終了した場合の末尾取りこぼし (実測 0〜12.9m・過小方向) を flush が回収する。
//   - ★課金 gate (running/business_active) は不可侵★: 実フローでは businessEnd が gate を
//     閉じてから 'reset' を送るため flush delta は課金に入らない (= 過大方向リスク ゼロ)。
//     本テストは worker 側配線 (flush が出る・reset で完全初期化) のみを固定化する。
//
// 実 map-matcher.js + 実 pipeline-distance.js を worker-sim で通す (再実装禁止)。

const path = require('path');
const fs = require('fs');
const { createMapMatcherWorker, loadPrefRoadsData } = require('../replay-mm-worker/worker-sim');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'realtest3-Android.slim.json');

// 実トレースから「移動中サンプルが連続する窓」を切り出す (末尾も移動中 = flush 対象 tail を作る)
function movingWindow(n) {
  const all = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    .filter((x) => x && Number.isFinite(x.lat) && Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);
  const win = [];
  for (const s of all) {
    if (typeof s.spd === 'number' && s.spd >= 4) {
      win.push(s);
      if (win.length >= n) break;
    } else if (win.length > 0 && win.length < n) {
      win.length = 0; // 連続移動窓のみ採用
    }
  }
  if (win.length < n) throw new Error('moving window not found');
  return win;
}

function driveAndCollect(worker, samples) {
  const results = [];
  const onMsg = (e) => {
    if (e.data && e.data.type === 'mmResult') results.push(e.data);
  };
  worker.on(onMsg);
  for (const g of samples) {
    worker.sendMessage({
      type: 'gps',
      lat: g.lat,
      lng: g.lng,
      accuracy: g.acc,
      speedKmh: g.spd >= 0 ? g.spd * 3.6 : null,
      headingDeg: null,
      altitude: 0,
      timestamp: g.t,
      isStationary: false,
    });
  }
  worker.off(onMsg);
  return results;
}

function sumPipeline(results) {
  let s = 0;
  for (const m of results)
    if (typeof m.pipelineDeltaM === 'number' && m.pipelineDeltaM > 0) s += m.pipelineDeltaM;
  return s;
}

describe('smoothedRawMode flush-on-reset (業務終了の末尾確定配線)', () => {
  let worker;
  beforeAll(() => {
    worker = createMapMatcherWorker({ debug: false });
    const roadsData = loadPrefRoadsData('ehime');
    worker.sendMessage({ type: 'configPlatform', isIOS: false });
    worker.sendMessage({ type: 'loadRoads', pref: 'ehime', roadsData });
  });

  it('★ DEFAULTS.smoothedRawMode が true (出荷有効化)', () => {
    const PD = require(path.join(__dirname, '..', '..', 'js', 'pipeline-distance.js'));
    expect(PD.DEFAULTS && PD.DEFAULTS.smoothedRawMode).toBe(true);
  });

  it('★ 走行中 reset で flush delta が mmResult.pipelineDeltaM として届く + tracker 完全初期化', () => {
    const samples = movingWindow(40); // 末尾も移動中 = 遅延バッファに未確定 tail が残る
    const run1 = driveAndCollect(worker, samples);
    const d1 = sumPipeline(run1);
    expect(d1).toBeGreaterThan(50); // 走行 40 点で距離が出ている (配線生存確認)

    // 業務終了: reset → flush mmResult が「reset 送信後」に届く
    const afterReset = [];
    const onMsg = (e) => {
      if (e.data && e.data.type === 'mmResult') afterReset.push(e.data);
    };
    worker.on(onMsg);
    worker.sendMessage({ type: 'reset' });
    worker.off(onMsg);
    const flushMsgs = afterReset.filter(
      (m) => typeof m.pipelineDeltaM === 'number' && m.pipelineDeltaM > 0
    );
    // 末尾は移動中なので flush delta > 0 が必ず出る (実測 tail 0〜12.9m 級・上限は緩く 200m)
    expect(flushMsgs.length).toBe(1);
    expect(flushMsgs[0].pipelineDeltaM).toBeGreaterThan(0);
    expect(flushMsgs[0].pipelineDeltaM).toBeLessThan(200);
    expect(flushMsgs[0].committed).toBe(true);

    // reset 後にもう一度 reset → flush 済 + tracker 初期化済なので flush delta は出ない
    const afterReset2 = [];
    const onMsg2 = (e) => {
      if (e.data && e.data.type === 'mmResult') afterReset2.push(e.data);
    };
    worker.on(onMsg2);
    worker.sendMessage({ type: 'reset' });
    worker.off(onMsg2);
    expect(sumPipeline(afterReset2)).toBe(0);

    // ★再走で 0 から累積 (= reset で完全初期化・leak なし): 同一 stream で同等距離
    const run2 = driveAndCollect(worker, samples);
    const d2 = sumPipeline(run2);
    expect(Math.abs(d2 - d1)).toBeLessThan(Math.max(5, d1 * 0.05));
    worker.sendMessage({ type: 'reset' });
  }, 60000); // 実 worker + routing で suite 並列負荷時に 5s を超えるため (単体 ~2s)

  it('★ 減速→停止で「遅延確定中の走行 delta」が停止0化に握り潰されない (時間軸ズレ bug 回帰)', () => {
    // 平滑モードは delta が h(2) サンプル遅れて確定する。worker の「実質停止 (spd<2km/h) で
    // pipelineDeltaM=0 化」二重保険が ★現在 message の時間軸★ で効くと、停止のたびに直前の
    // 走行区間 delta (確定が停止 message 上に乗る) が消え、市街地 (停止多数) で系統過小になる。
    // creep ガードはエンジン側 (ZUPT + smoothDopplerCapRatio・中心点 spd の正しい時間軸) が担う。
    // 走行 12 点 + 停止 10 点: 末尾 ~2 sample 分 (確定が停止 message 上に乗る) が全体の ~18% を
    // 占めるため、bug があれば live が batch を大きく割って確実に検出できる。
    const moving = movingWindow(12);
    const last = moving[moving.length - 1];
    const stopped = [];
    for (let k = 1; k <= 10; k++) {
      stopped.push({ lat: last.lat, lng: last.lng, t: last.t + k * 1000, acc: 8, spd: 0 });
    }
    const all = moving.concat(stopped);

    // エンジン truth (batch・全点): 停止部は creep 0 で、走行部の平滑距離が全額入る
    const PD = require(path.join(__dirname, '..', '..', 'js', 'pipeline-distance.js'));
    global.window = global;
    global.self = global;
    /* eslint-disable no-eval */
    eval(fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'roads-decoder.js'), 'utf8'));
    eval(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'roads-ehime.js'), 'utf8'));
    /* eslint-enable no-eval */
    const dec = new global.RoadDecoder(global.ROADS_EHIME);
    dec.buildOffsetTable();
    const batch = PD.computeDistance(all, dec, {}).distance_m;
    expect(batch).toBeGreaterThan(50);

    // 実 worker 経由: 停止 message 上で確定する走行 delta が消えない = batch とほぼ一致
    const results = driveAndCollect(worker, all);
    const live = sumPipeline(results);
    expect(live).toBeGreaterThan(batch * 0.92); // bug 時は末尾走行 ~2 sample 分 (~18%) が丸ごと消え大きく割れる
    expect(live).toBeLessThan(batch * 1.02 + 1); // 過大方向にも出ない (creep ガード生存)
    worker.sendMessage({ type: 'reset' });
  }, 60000);

  it('softReset では flush しない (= trip 跨ぎで二重計上しない・窓維持)', () => {
    const samples = movingWindow(40);
    driveAndCollect(worker, samples);
    const after = [];
    const onMsg = (e) => {
      if (e.data && e.data.type === 'mmResult') after.push(e.data);
    };
    worker.on(onMsg);
    worker.sendMessage({ type: 'softReset' });
    worker.off(onMsg);
    expect(sumPipeline(after)).toBe(0);
    worker.sendMessage({ type: 'reset' });
  }, 60000);
});
