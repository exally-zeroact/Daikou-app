// tests/drift-static/meter-isStationary-anchor.test.js
//
// ★設計変更宣言 Phase 6-7 (2026-05-21・(M) 分離・司さん採択):
//   旧: tests/property/isstationary-no-increase.test.js 内に・行アンカー線 ±10 の
//       静的 grep (B3 / B4) が混在。Stryker instrumentation で sandbox copy の行が
//       シフトし dry-run で false-fail していた。
//   新: 線アンカー block を本 file (= tests/drift-static/) に切出し・通常 vitest では
//       本 file を実行 (= 厳格度 ±10 完全保持) し・Stryker run では本 dir を exclude する
//       (= vitest.stryker.config.js exclude: 'tests/drift-static/**')。
//
//   絶対前提:
//     ・block コードは旧 file から **byte 不変** で移動 (= window slice index / regex /
//       error message / LINE_TOLERANCE すべて同一)
//     ・通常 CI (= npm test) で本 file が走り・行アンカー ±10 で同じ assertion 実行
//     ・mutation testing (= stryker) では sandbox 行シフト由来 false-fail を回避
//     ・prod 完全無変更 (= js/meter.js / js/map-matcher.js 1 byte も触らない)
//
//   旧 file 由来 (= tests/property/isstationary-no-increase.test.js):
//     describe '経路 1' の B3 → 本 file の it 'B3'
//     describe '経路 2' の B4 → 本 file の it 'B4'

'use strict';

const fs = require('fs');
const path = require('path');

const METER_JS_PATH = path.join(__dirname, '..', '..', 'js', 'meter.js');
const MAP_MATCHER_JS_PATH = path.join(__dirname, '..', '..', 'js', 'map-matcher.js');

function loadSource(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

describe('drift-static: meter.js L790 / map-matcher.js L3007 isStationary 早期 return (旧 isstationary-no-increase.test.js B3/B4)', () => {
  it('B3: meter.js L790 に update() 入口 isStationary 早期 return が存在', () => {
    const source = loadSource(METER_JS_PATH);
    const lines = source.split('\n');
    // L790 周辺で `if (gpsResult.isStationary)` パターン + early return を確認
    // Stryker sandbox の line offset 吸収のため window を ±10 line 拡張
    // 2026-05-18 更新 (Phase 3): L839 → L867 (+28) 移動・window 同期。
    // 2026-05-19 R1 更新 (Off-Road grace period): L867 → L884 (+17) 移動・window 同期。
    // 2026-05-24 更新 (道路 snap 構成・ZUPT helper 追加): L884 → L950 (+66) 移動・window 同期。
    // 2026-05-24 更新 (business preview 別回路・state 追加 + 別 if ブロック): L950 → L1006 (+56) 移動。
    // 2026-05-24 更新 (表示層 予測補間・state 追加 + 別ブロック): L1006 → L1039 (+33) 移動。
    const window = lines.slice(1024, 1058).join('\n');
    if (!/if\s*\(\s*gpsResult\.isStationary\s*\)/.test(window)) {
      throw new Error(
        'meter.js L790 周辺 (±10) に if (gpsResult.isStationary) パターン未検出 (drift detected)'
      );
    }
    if (!/_updateMapMatching\s*\(\s*gpsResult\s*\)/.test(window)) {
      throw new Error('meter.js L790 周辺 (±10) に _updateMapMatching(gpsResult) 呼出 未検出');
    }
    if (!/return\s*;/.test(window)) {
      throw new Error('meter.js L790 周辺 (±10) に early return ; 未検出');
    }
  });

  it('B4: map-matcher.js L3007 に msg.isStationary 強制 0 化 pattern が存在', () => {
    const source = loadSource(MAP_MATCHER_JS_PATH);
    const lines = source.split('\n');
    // L3007 周辺で if (msg.isStationary === true) { mmIncrementM = 0; tentativeIncrementM = 0; }
    // Stryker sandbox の line offset 吸収のため window を ±10 line 拡張 (= 2990-3025)
    const window = lines.slice(2990, 3025).join('\n');
    if (!/if\s*\(\s*msg\.isStationary\s*===\s*true\s*\)/.test(window)) {
      throw new Error(
        'map-matcher.js L3007 周辺 (±10) に if (msg.isStationary === true) pattern 未検出 (drift detected)'
      );
    }
    if (!/mmIncrementM\s*=\s*0/.test(window)) {
      throw new Error('map-matcher.js L3007 周辺 (±10) に mmIncrementM = 0 代入 未検出');
    }
    if (!/tentativeIncrementM\s*=\s*0/.test(window)) {
      throw new Error('map-matcher.js L3007 周辺 (±10) に tentativeIncrementM = 0 代入 未検出');
    }
  });
});
