#!/usr/bin/env node
'use strict';

// tests/compare-baseline.js
// data/test-results/latest.json と tests/baselines/*.json を比較し
// regression を検出する (距離 1% 超 / snap 率 0.97 未満 で fail)
//
// 使い方:
//   node tests/compare-baseline.js
//   exit 0 = pass / 1 = fail / 2 = setup error

const fs = require('fs');
const path = require('path');

const LATEST = path.join(__dirname, '..', 'data', 'test-results', 'latest.json');
const BASELINE_DIR = path.join(__dirname, 'baselines');

const DER_THRESHOLD = 0.01;     // 1% 超で fail
const SNAP_THRESHOLD = 0.97;    // 97% 未満で fail

function main(){
  if(!fs.existsSync(LATEST)){
    console.error('[compare] latest.json not found - run replay-mm.js first');
    process.exit(2);
  }
  const latest = JSON.parse(fs.readFileSync(LATEST, 'utf8'));
  const failures = [];
  const warnings = [];

  for(const fix of latest.fixtures){
    const blPath = path.join(BASELINE_DIR, fix.name + '.json');
    if(!fs.existsSync(blPath)){
      warnings.push(fix.name + ': baseline 未登録 (新規 fixture?) → tests/baselines/' + fix.name + '.json を作成してください');
      continue;
    }
    const bl = JSON.parse(fs.readFileSync(blPath, 'utf8'));
    const dDist = Math.abs(fix.mm_distance_m - bl.mm_distance_m);
    const dRatio = bl.mm_distance_m > 0 ? dDist / bl.mm_distance_m : 0;
    if(dRatio > DER_THRESHOLD){
      failures.push(fix.name + ': baseline と距離差 ' + (dRatio * 100).toFixed(2) +
        '% (current ' + fix.mm_distance_m + 'm / baseline ' + bl.mm_distance_m + 'm)');
    }
    if(fix.snap_rate < SNAP_THRESHOLD){
      failures.push(fix.name + ': snap 成功率 ' + (fix.snap_rate * 100).toFixed(1) +
        '% < threshold ' + (SNAP_THRESHOLD * 100) + '%');
    }
    if(bl.snap_rate != null && (bl.snap_rate - fix.snap_rate) > 0.02){
      failures.push(fix.name + ': snap 率が baseline より ' +
        ((bl.snap_rate - fix.snap_rate) * 100).toFixed(1) + 'pt 低下');
    }
  }

  if(latest.summary.distance_error_ratio_overall > 0.02){
    failures.push('overall DER ' +
      (latest.summary.distance_error_ratio_overall * 100).toFixed(2) + '% > 2%');
  }

  for(const w of warnings) console.warn('[compare][warn] ' + w);
  for(const f of failures) console.error('[compare][fail] ' + f);

  if(failures.length === 0){
    console.log('[compare] PASS (' + latest.fixtures.length + ' fixtures)');
    process.exit(0);
  } else {
    console.error('[compare] FAIL (' + failures.length + ' issues)');
    process.exit(1);
  }
}

if(require.main === module) main();
