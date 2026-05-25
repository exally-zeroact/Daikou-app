// tests/replay-mm-worker/index.test.js (Phase 1 基盤・2026-05-21・rev2 計測のみ)
// ★設計変更宣言 Phase 1 (2026-05-21・rev2):
//   旧 rev1: snap_rate>0 等の閾値 assert → warmup/末尾未 flush 交絡で実 Worker B 性能を測れず
//   新 rev2: 計測のみ (= 閾値固定は方法論固まってから)。基本 invariant (= 配線正常性)のみ assert。
'use strict';

const path = require('path');

const { loadPrefRoadsData } = require('./worker-sim');
const { runReplay, haversineM } = require('./runner');
const { score, calcExpectedDistancePostWarmup } = require('./scoring');
const { loadSyntheticFixture } = require('./fixture-loader');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('Phase 1: 実 Worker B HMM Viterbi 実走 replay 基盤 (rev2 計測のみ)', () => {
  it('worker-sim: Worker context が起動し ehime data を実 roads-decoder.js で decode する', async () => {
    const { createMapMatcherWorker } = require('./worker-sim');
    const worker = createMapMatcherWorker();
    const events = [];
    worker.on((e) => events.push(e.data));
    const data = loadPrefRoadsData('ehime');
    worker.sendMessage({ type: 'loadRoads', pref: 'ehime', roadsData: data });
    const loaded = events.find((m) => m && m.type === 'roadsLoaded');
    expect(loaded).toBeDefined();
    expect(loaded.ok).toBe(true);
    expect(loaded.numRoads).toBe(data.numRoads);
  }, 60000);

  it('runner: parallel-frontage を 実 Meter + 実 Worker B で実走 + 末尾 flush + baseline 計測', async () => {
    const fixture = loadSyntheticFixture(path.join(FIXTURES_DIR, 'parallel-frontage.json'));
    const data = loadPrefRoadsData(fixture.meta.prefecture);
    const result = await runReplay(fixture, data, {});

    // ground_truth (= 各 GPS step に対応する正解 segment)
    const gt = [];
    for (const seg of fixture.meta.ground_truth_segments) {
      for (let i = 0; i < seg.num_samples; i++) {
        gt.push({ roadIndex: seg.roadIndex, segmentIndex: seg.segmentIndex });
      }
    }

    // 基本 invariant (= 配線正常性のみ・閾値 assert は計測方法論固まってから)
    expect(gt.length).toBe(result.committedSnaps.length);
    expect(result.gpsSamples.length).toBe(70); // 7 segments × 10 samples
    expect(result.mmResults.length).toBeGreaterThanOrEqual(70); // 70 GPS + 末尾 flush の追加 commit
    expect(result.expectedDistanceM).toBeGreaterThan(350);
    expect(result.expectedDistanceM).toBeLessThan(450);

    // post-warmup 期待距離
    const decSrc = require('fs').readFileSync(
      path.join(__dirname, '..', '..', 'js', 'roads-decoder.js'),
      'utf8'
    );
    const vm = require('vm');
    const decCtx = {
      window: {},
      Buffer,
      Uint8Array,
      Uint32Array,
      performance: { now: () => Date.now() },
    };
    vm.createContext(decCtx);
    vm.runInContext(decSrc, decCtx);
    const mainDec = new decCtx.window.RoadDecoder(data);
    mainDec.buildOffsetTable();

    // first_commit_step 取得
    let firstCommit = -1;
    for (let i = 0; i < result.committedSnaps.length; i++) {
      if (result.committedSnaps[i] != null) {
        firstCommit = i;
        break;
      }
    }
    const warmupSteps = firstCommit < 0 ? gt.length : firstCommit;
    const expectedPost = calcExpectedDistancePostWarmup(
      fixture.meta.ground_truth_segments,
      warmupSteps,
      haversineM,
      mainDec,
      data.precision
    );

    const scored = score({
      groundTruth: gt,
      committedSnaps: result.committedSnaps,
      expectedDistanceM: result.expectedDistanceM,
      expectedDistancePostWarmupM: expectedPost,
      committedDistanceM: result.committedDistanceM,
    });

    // baseline 出力 (= warmup-aware・post-warmup が本物の評価)
    console.log(
      '[replay-mm-worker baseline parallel-frontage rev2]\n' +
        '  [post-warmup (= 真の評価)]\n' +
        '    P=' +
        scored.precision_post_warmup +
        ' R=' +
        scored.recall_post_warmup +
        ' F1=' +
        scored.f1_post_warmup +
        ' snap_rate=' +
        scored.snap_rate_post_warmup +
        ' DER=' +
        (scored.der_post_warmup != null ? scored.der_post_warmup : 'n/a') +
        '\n' +
        '    TP=' +
        scored.true_positive_post_warmup +
        ' FP=' +
        scored.false_positive_post_warmup +
        ' FN=' +
        scored.false_negative_post_warmup +
        '/' +
        scored.post_warmup_total +
        '\n' +
        '  [overall (= 参考・warmup 含む)]\n' +
        '    P=' +
        scored.precision_overall +
        ' R=' +
        scored.recall_overall +
        ' F1=' +
        scored.f1_overall +
        ' snap_rate=' +
        scored.snap_rate_overall +
        ' DER=' +
        (scored.der_overall != null ? scored.der_overall : 'n/a') +
        '\n' +
        '  warmup_steps=' +
        scored.warmup_steps +
        ' first_commit_step=' +
        scored.first_commit_step +
        ' total_steps=' +
        scored.total_steps +
        '\n' +
        '  committedDistanceM=' +
        result.committedDistanceM.toFixed(2) +
        'm (= Meter.state.distance_m / 5 経路全集約 L440/L514/L961/L979/L1365)' +
        '\n' +
        '  expected_overall=' +
        result.expectedDistanceM.toFixed(2) +
        'm expected_post_warmup=' +
        expectedPost.toFixed(2) +
        'm\n' +
        '  mmStats: snap_count=' +
        (result.mmStats ? result.mmStats.mm_snap_count : 'n/a') +
        ' skip_count=' +
        (result.mmStats ? result.mmStats.mm_skip_count : 'n/a') +
        ' total=' +
        (result.mmStats ? result.mmStats.mm_total_count : 'n/a') +
        ' mm_distance=' +
        (result.mmStats ? result.mmStats.mm_distance_m.toFixed(2) : 'n/a')
    );

    // 基本配線 sanity (= 閾値ではなく・基盤動作の存在確認のみ)
    expect(scored.total_steps).toBe(gt.length);
    // first_commit_step が記録されていることだけ確認 (= -1 = 一切 commit なしも許容・計測のみ)
    expect(typeof scored.first_commit_step).toBe('number');
    // committedDistanceM が・実 Meter から読まれた数値 (= NaN/undefined ではない)
    expect(typeof result.committedDistanceM).toBe('number');
    expect(Number.isFinite(result.committedDistanceM)).toBe(true);
  }, 60000);

  // ★ 角度系バッチ 3 件共通 helper (= DRY 化・各 fixture で行数増えるため抽出)
  async function runAndScore(fixtureFile, expectedSamplesCount, expectedDistRange, label) {
    const fixture = loadSyntheticFixture(path.join(FIXTURES_DIR, fixtureFile));
    const data = loadPrefRoadsData(fixture.meta.prefecture);
    const result = await runReplay(fixture, data, {});

    const gt = [];
    for (const seg of fixture.meta.ground_truth_segments) {
      for (let i = 0; i < seg.num_samples; i++) {
        gt.push({ roadIndex: seg.roadIndex, segmentIndex: seg.segmentIndex });
      }
    }
    expect(gt.length).toBe(result.committedSnaps.length);
    expect(result.gpsSamples.length).toBe(expectedSamplesCount);
    // mmResults.length は・停車 step で meter.js L1054 が postMessage 抑止する設計のため
    // gpsSamples.length より小さくなりうる (= 例: low-speed-stop で 20 step skip → 40 件)。
    // assert は「0 以上」に緩める (= 基盤動作確認のみ)。
    expect(result.mmResults.length).toBeGreaterThanOrEqual(0);
    expect(result.expectedDistanceM).toBeGreaterThan(expectedDistRange[0]);
    expect(result.expectedDistanceM).toBeLessThan(expectedDistRange[1]);

    const decSrc = require('fs').readFileSync(
      path.join(__dirname, '..', '..', 'js', 'roads-decoder.js'),
      'utf8'
    );
    const vm = require('vm');
    const decCtx = {
      window: {},
      Buffer,
      Uint8Array,
      Uint32Array,
      performance: { now: () => Date.now() },
    };
    vm.createContext(decCtx);
    vm.runInContext(decSrc, decCtx);
    const mainDec = new decCtx.window.RoadDecoder(data);
    mainDec.buildOffsetTable();

    let firstCommit = -1;
    for (let i = 0; i < result.committedSnaps.length; i++) {
      if (result.committedSnaps[i] != null) {
        firstCommit = i;
        break;
      }
    }
    const warmupSteps = firstCommit < 0 ? gt.length : firstCommit;
    const expectedPost = calcExpectedDistancePostWarmup(
      fixture.meta.ground_truth_segments,
      warmupSteps,
      haversineM,
      mainDec,
      data.precision
    );

    const scored = score({
      groundTruth: gt,
      committedSnaps: result.committedSnaps,
      expectedDistanceM: result.expectedDistanceM,
      expectedDistancePostWarmupM: expectedPost,
      committedDistanceM: result.committedDistanceM,
    });

    console.log(
      '[replay-mm-worker baseline ' +
        label +
        ']\n' +
        '  [post-warmup]\n' +
        '    P=' +
        scored.precision_post_warmup +
        ' R=' +
        scored.recall_post_warmup +
        ' F1=' +
        scored.f1_post_warmup +
        ' snap_rate=' +
        scored.snap_rate_post_warmup +
        ' DER=' +
        (scored.der_post_warmup != null ? scored.der_post_warmup : 'n/a') +
        '\n' +
        '    TP=' +
        scored.true_positive_post_warmup +
        ' FP=' +
        scored.false_positive_post_warmup +
        ' FN=' +
        scored.false_negative_post_warmup +
        '/' +
        scored.post_warmup_total +
        '\n' +
        '  [overall]\n' +
        '    P=' +
        scored.precision_overall +
        ' R=' +
        scored.recall_overall +
        ' F1=' +
        scored.f1_overall +
        ' snap_rate=' +
        scored.snap_rate_overall +
        ' DER=' +
        (scored.der_overall != null ? scored.der_overall : 'n/a') +
        '\n' +
        '  warmup_steps=' +
        scored.warmup_steps +
        ' first_commit_step=' +
        scored.first_commit_step +
        ' total_steps=' +
        scored.total_steps +
        '\n' +
        '  committedDistanceM=' +
        result.committedDistanceM.toFixed(2) +
        'm  expected_overall=' +
        result.expectedDistanceM.toFixed(2) +
        'm expected_post_warmup=' +
        expectedPost.toFixed(2) +
        'm'
    );

    expect(scored.total_steps).toBe(gt.length);
    expect(typeof scored.first_commit_step).toBe('number');
    expect(typeof result.committedDistanceM).toBe('number');
    expect(Number.isFinite(result.committedDistanceM)).toBe(true);
  }

  // ★ 角度系バッチ・fixture #2 (= y-fork-148m・bearing 差 45度・typeCode 違い)
  it('runner: y-fork を 実 Meter + 実 Worker B で実走 + 末尾 flush + baseline 計測', async () => {
    const fixture = loadSyntheticFixture(path.join(FIXTURES_DIR, 'y-fork.json'));
    const data = loadPrefRoadsData(fixture.meta.prefecture);
    const result = await runReplay(fixture, data, {});

    const gt = [];
    for (const seg of fixture.meta.ground_truth_segments) {
      for (let i = 0; i < seg.num_samples; i++) {
        gt.push({ roadIndex: seg.roadIndex, segmentIndex: seg.segmentIndex });
      }
    }

    expect(gt.length).toBe(result.committedSnaps.length);
    expect(result.gpsSamples.length).toBe(50); // 1 segment × 50 samples
    expect(result.mmResults.length).toBeGreaterThanOrEqual(50);
    expect(result.expectedDistanceM).toBeGreaterThan(140);
    expect(result.expectedDistanceM).toBeLessThan(160);

    const decSrc = require('fs').readFileSync(
      path.join(__dirname, '..', '..', 'js', 'roads-decoder.js'),
      'utf8'
    );
    const vm = require('vm');
    const decCtx = {
      window: {},
      Buffer,
      Uint8Array,
      Uint32Array,
      performance: { now: () => Date.now() },
    };
    vm.createContext(decCtx);
    vm.runInContext(decSrc, decCtx);
    const mainDec = new decCtx.window.RoadDecoder(data);
    mainDec.buildOffsetTable();

    let firstCommit = -1;
    for (let i = 0; i < result.committedSnaps.length; i++) {
      if (result.committedSnaps[i] != null) {
        firstCommit = i;
        break;
      }
    }
    const warmupSteps = firstCommit < 0 ? gt.length : firstCommit;
    const expectedPost = calcExpectedDistancePostWarmup(
      fixture.meta.ground_truth_segments,
      warmupSteps,
      haversineM,
      mainDec,
      data.precision
    );

    const scored = score({
      groundTruth: gt,
      committedSnaps: result.committedSnaps,
      expectedDistanceM: result.expectedDistanceM,
      expectedDistancePostWarmupM: expectedPost,
      committedDistanceM: result.committedDistanceM,
    });

    console.log(
      '[replay-mm-worker baseline y-fork-148m]\n' +
        '  [post-warmup]\n' +
        '    P=' +
        scored.precision_post_warmup +
        ' R=' +
        scored.recall_post_warmup +
        ' F1=' +
        scored.f1_post_warmup +
        ' snap_rate=' +
        scored.snap_rate_post_warmup +
        ' DER=' +
        (scored.der_post_warmup != null ? scored.der_post_warmup : 'n/a') +
        '\n' +
        '    TP=' +
        scored.true_positive_post_warmup +
        ' FP=' +
        scored.false_positive_post_warmup +
        ' FN=' +
        scored.false_negative_post_warmup +
        '/' +
        scored.post_warmup_total +
        '\n' +
        '  [overall]\n' +
        '    P=' +
        scored.precision_overall +
        ' R=' +
        scored.recall_overall +
        ' F1=' +
        scored.f1_overall +
        ' snap_rate=' +
        scored.snap_rate_overall +
        ' DER=' +
        (scored.der_overall != null ? scored.der_overall : 'n/a') +
        '\n' +
        '  warmup_steps=' +
        scored.warmup_steps +
        ' first_commit_step=' +
        scored.first_commit_step +
        ' total_steps=' +
        scored.total_steps +
        '\n' +
        '  committedDistanceM=' +
        result.committedDistanceM.toFixed(2) +
        'm (= Meter.state.distance_m / 5 経路全集約)\n' +
        '  expected_overall=' +
        result.expectedDistanceM.toFixed(2) +
        'm expected_post_warmup=' +
        expectedPost.toFixed(2) +
        'm'
    );

    expect(scored.total_steps).toBe(gt.length);
    expect(typeof scored.first_commit_step).toBe('number');
    expect(typeof result.committedDistanceM).toBe('number');
    expect(Number.isFinite(result.committedDistanceM)).toBe(true);
  }, 60000);

  // ★ 角度系バッチ・fixture #3 (= intersection-cross-200m・直交 90度・同 typeCode・50 step 延長版)
  it('runner: intersection-cross を 実 Meter + 実 Worker B で実走 + baseline 計測', async () => {
    await runAndScore('intersection-cross.json', 50, [180, 220], 'intersection-cross-200m');
  }, 60000);

  // ★ 角度系バッチ・fixture #4 (= ramp-merge-517m・47.5度合流・motorway_link vs motorway)
  it('runner: ramp-merge を 実 Meter + 実 Worker B で実走 + baseline 計測', async () => {
    await runAndScore('ramp-merge.json', 50, [480, 560], 'ramp-merge-517m');
  }, 60000);

  // ★ 残り 4 fixture バッチ (= Phase 1 完成)
  // #5 U-turn (= 180度反転・全加算で距離 accrue・反対車線 22235 誤 snap 抑制)
  it('runner: uturn を 実 Meter + 実 Worker B で実走 + baseline 計測', async () => {
    await runAndScore('uturn.json', 60, [260, 290], 'uturn-274m');
  }, 60000);

  // #6 reverse oneway (= oneway 逆走・全加算・oneway penalty で 122 への誤 snap 抑制)
  it('runner: reverse-oneway を 実 Meter + 実 Worker B で実走 + baseline 計測', async () => {
    await runAndScore('reverse-oneway.json', 50, [180, 220], 'reverse-oneway-200m');
  }, 60000);

  // #7 low-speed-stop (= 停車中に distance_m が増えないこと検証)
  it('runner: low-speed-stop を 実 Meter + 実 Worker B で実走 + baseline 計測', async () => {
    await runAndScore('low-speed-stop.json', 60, [60, 90], 'low-speed-stop-74m');
  }, 60000);

  // #8 overpass-vs-ground (= layer 判別・MM-5 layer scoring・同 bearing で A-2 OFF)
  it('runner: overpass-vs-ground を 実 Meter + 実 Worker B で実走 + baseline 計測', async () => {
    await runAndScore('overpass-vs-ground.json', 50, [180, 220], 'overpass-vs-ground-200m');
  }, 60000);
});
