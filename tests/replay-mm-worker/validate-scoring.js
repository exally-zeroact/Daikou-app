#!/usr/bin/env node
'use strict';

// validate-scoring.js (Phase2-b 検証ユーティリティ・2026-05-27)
// 実 Worker B Viterbi を ground-truth fixture で実走し・F1/snap_rate/DER/distance を標準出力。
// scoring 改善 (Phase2-b) の前後で本スクリプトを実行し・回帰がないことを数値で比較する。
// (replay-mm-worker/index.test.js は console 抑制 + 閾値 assert なしのため・本 CLI で baseline を見る)
//   使い方: node tests/replay-mm-worker/validate-scoring.js

const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { loadPrefRoadsData } = require('./worker-sim');
const { runReplay, haversineM } = require('./runner');
const { score, calcExpectedDistancePostWarmup } = require('./scoring');
const { loadSyntheticFixture } = require('./fixture-loader');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const FIXTURES = [
  'parallel-frontage',
  'y-fork',
  'intersection-cross',
  'ramp-merge',
  'uturn',
  'reverse-oneway',
  'low-speed-stop',
  'overpass-vs-ground',
];

function buildMainDec(data) {
  const decSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'js', 'roads-decoder.js'),
    'utf8'
  );
  const decCtx = {
    window: {},
    Buffer,
    Uint8Array,
    Uint32Array,
    performance: { now: () => Date.now() },
  };
  vm.createContext(decCtx);
  vm.runInContext(decSrc, decCtx);
  const dec = new decCtx.window.RoadDecoder(data);
  dec.buildOffsetTable();
  return dec;
}

(async () => {
  for (const name of FIXTURES) {
    const fixture = loadSyntheticFixture(path.join(FIXTURES_DIR, name + '.json'));
    const data = loadPrefRoadsData(fixture.meta.prefecture);
    const result = await runReplay(fixture, data, {});
    const gt = [];
    for (const seg of fixture.meta.ground_truth_segments) {
      for (let i = 0; i < seg.num_samples; i++) {
        gt.push({ roadIndex: seg.roadIndex, segmentIndex: seg.segmentIndex });
      }
    }
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
      buildMainDec(data),
      data.precision
    );
    const s = score({
      groundTruth: gt,
      committedSnaps: result.committedSnaps,
      expectedDistanceM: result.expectedDistanceM,
      expectedDistancePostWarmupM: expectedPost,
      committedDistanceM: result.committedDistanceM,
    });
    console.log(
      name.padEnd(20) +
        ' F1=' +
        String(s.f1_post_warmup).padEnd(6) +
        ' DERoverall=' +
        String(s.der_overall != null ? s.der_overall : 'n/a').padEnd(8) +
        ' (committed=' +
        result.committedDistanceM.toFixed(1) +
        'm vs expFull=' +
        result.expectedDistanceM.toFixed(1) +
        'm)' +
        ' | DERpost=' +
        String(s.der_post_warmup != null ? s.der_post_warmup : 'n/a').padEnd(8) +
        ' (expPost=' +
        expectedPost.toFixed(1) +
        'm warmup=' +
        s.warmup_steps +
        'step)'
    );
  }
})();
