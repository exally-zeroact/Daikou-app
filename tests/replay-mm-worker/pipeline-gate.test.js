// tests/replay-mm-worker/pipeline-gate.test.js
//
// ★設計変更宣言 (2026-05-28・新構造対応): 「計測のみ」 を卒業した threshold ゲート。
//   既存 index.test.js (rev2 計測のみ) は・配線 sanity だけで・距離が倍化しても緑だった。
//   本 file は・runner.js の新 option useGpsWorker:true で実 gps-worker.js (Fix①②) を挿入し・
//   creep > 基準 or DER > 基準 で ★FAIL★ する閾値ゲート化を実現する。
//
//   gates:
//     ・creep gate: low-speed-stop の停止 phase で・state.distance_m が増えない
//                   (= 実 Fix① 判定経由で停止判定が正しく機能している)
//     ・freeze gate: 各 fixture で・committedDistanceM > 0 (= worker が全 reject していない)
//     ・runaway gate: DER (=|committed-expected|/expected) < 2.0 (= 200% 過大/過少 を超えない)
//   ★絶対ルール準拠: distance_m / calcFare / running gate は 1 byte 不変。

'use strict';

const path = require('path');

const { loadPrefRoadsData } = require('./worker-sim');
const { runReplay } = require('./runner');
const { loadSyntheticFixture } = require('./fixture-loader');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fmt(n) {
  return typeof n === 'number' ? n.toFixed(2) : 'n/a';
}

describe('Phase 1 (★新構造) gate: useGpsWorker + threshold ゲート (creep / freeze / runaway を FAIL 判定)', () => {
  // ─── ゲート 1: low-speed-stop creep (= Fix① 経由で停止判定→creep=0) ───
  it('gate-1 low-speed-stop: useGpsWorker で停止 phase の distance_m delta = 0 (creep=0)', async () => {
    const fixture = loadSyntheticFixture(path.join(FIXTURES_DIR, 'low-speed-stop.json'));
    const data = loadPrefRoadsData(fixture.meta.prefecture);
    const result = await runReplay(fixture, data, {
      useGpsWorker: true,
      captureStateSnapshots: true,
    });
    const totalSteps = result.gpsSamples.length;
    const stationarySet = new Set((fixture.meta.stationary_step_indices || []).map(Number));
    // 停止 step (= stationarySet 内) の最初の step での distance_m を記録・最後の停止 step 末で比較
    let firstStat = -1,
      lastStat = -1;
    for (let i = 0; i < totalSteps; i++) {
      if (stationarySet.has(i)) {
        if (firstStat < 0) firstStat = i;
        lastStat = i;
      }
    }
    if (firstStat < 0) {
      throw new Error('gate-1: fixture に停止 step が無い');
    }
    // ★smoothedRawMode 対応 (2026-06-07)★: 平滑距離は h(2) サンプル遅れて確定するため、停止突入直後の
    //   数 step には「停止直前の実走行区間」の delta が正当に計上される (= creep ではない・一回限り・
    //   committed ≤ expected で過大なし)。creep 測定は確定遅延 (h+1=3 step) 経過後から行い、
    //   それ以降の ★純停止 creep = 0★ は従来通り厳格に gate する (エンジン検証: 純停止 creep 0.00m)。
    const BOOK_DELAY_STEPS = 3; // smoothWindow3 → h=1 (+余裕)。窓を縮めても確定遅延は h+1=2 ≤ 3 で安全側
    const creepFrom = Math.min(firstStat + BOOK_DELAY_STEPS, lastStat);
    const beforeStat = result.stateSnapshots[creepFrom].after.distance_m;
    const afterStat = result.stateSnapshots[lastStat].after.distance_m;
    const creepM = afterStat - beforeStat;
    const ctx =
      `firstStat=${firstStat} lastStat=${lastStat} ` +
      `dist[before=${fmt(beforeStat)} after=${fmt(afterStat)} creep=${fmt(creepM)}m] ` +
      `committed=${fmt(result.committedDistanceM)} expected=${fmt(result.expectedDistanceM)}`;
    if (creepM > 1) {
      throw new Error(`gate-1 FAIL: 停止 phase で creep=${fmt(creepM)}m > 1m | ${ctx}`);
    }
  }, 60000);

  // ─── ゲート 2: 各 fixture で freeze 検知 (= worker が全 reject ⇒ committed = 0) ───
  const FREEZE_FIXTURES = [
    'low-speed-stop.json',
    'parallel-frontage.json',
    'y-fork.json',
    'uturn.json',
    'overpass-vs-ground.json',
    'reverse-oneway.json',
    'intersection-cross.json',
    'ramp-merge.json',
  ];
  for (const file of FREEZE_FIXTURES) {
    it(`gate-2 ${file}: useGpsWorker で committed > 0 (= 完全 freeze していない)`, async () => {
      const fixture = loadSyntheticFixture(path.join(FIXTURES_DIR, file));
      const data = loadPrefRoadsData(fixture.meta.prefecture);
      const result = await runReplay(fixture, data, { useGpsWorker: true });
      const committed = result.committedDistanceM;
      const expected = result.expectedDistanceM;
      const ctx = `committed=${fmt(committed)} expected=${fmt(expected)}`;
      if (!(committed > 0)) {
        throw new Error(`gate-2 FAIL: ${file} で committed=0 (full freeze) | ${ctx}`);
      }
    }, 60000);
  }

  // ─── ゲート 3: 各 fixture で runaway 検知 (= DER > 2.0 = 200% 過大/過少) ───
  const RUNAWAY_FIXTURES = FREEZE_FIXTURES;
  for (const file of RUNAWAY_FIXTURES) {
    it(`gate-3 ${file}: useGpsWorker で DER < 2.0 (= 200% 過大/過少を超えない)`, async () => {
      const fixture = loadSyntheticFixture(path.join(FIXTURES_DIR, file));
      const data = loadPrefRoadsData(fixture.meta.prefecture);
      const result = await runReplay(fixture, data, { useGpsWorker: true });
      const committed = result.committedDistanceM;
      const expected = result.expectedDistanceM;
      const der = expected > 0 ? Math.abs(committed - expected) / expected : 0;
      const ctx = `committed=${fmt(committed)} expected=${fmt(expected)} DER=${fmt(der)}`;
      if (der >= 2.0) {
        throw new Error(`gate-3 FAIL: ${file} で DER=${fmt(der)} >= 2.0 | ${ctx}`);
      }
    }, 60000);
  }

  // ─── ゲート 4: 移動 fixture で・worker が ≥10% emit している (= 半凍結検知) ───
  //   gps-worker の Doppler-sanity / accuracy / jump ゲートが・合成 noise を過剰 reject する場合・
  //   distance が極端に under する。10% 未満 emit は・「実機相当でも凍結する設定」 とみなし FAIL。
  it('gate-4 parallel-frontage: useGpsWorker で・mmResults.length >= 7 (= 70 step × 10%)', async () => {
    const fixture = loadSyntheticFixture(path.join(FIXTURES_DIR, 'parallel-frontage.json'));
    const data = loadPrefRoadsData(fixture.meta.prefecture);
    const result = await runReplay(fixture, data, { useGpsWorker: true });
    // mmResults は Worker B からの commit 数 (= meter が update された step に対応)
    // 完全 freeze だと mmResults=0・10% 以上発火していれば実機相当の reject パターンとみなす
    const ctx = `mmResults=${result.mmResults.length} gpsSamples=${result.gpsSamples.length}`;
    if (!(result.mmResults.length >= 7)) {
      throw new Error(`gate-4 FAIL: mmResults=${result.mmResults.length} < 7 (半凍結) | ${ctx}`);
    }
  }, 60000);
});
