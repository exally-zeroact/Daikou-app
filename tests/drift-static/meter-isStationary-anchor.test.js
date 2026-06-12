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
  it('B3: meter.js update() 入口に isStationary 早期 return が存在 (= 停車中 距離不変)', () => {
    // ★白紙書き直し (2026-05-30・clean-rebuild-pipeline)★
    //   旧: 行アンカー window slice で early return を検出 (= 行 shift で false-fail)。
    //   新: 距離駆動が pipeline 単一経路化したため行番号は大きく変動。
    //       「function update(gpsResult)」 の本体冒頭から最初の数十行内に
    //       if (gpsResult.isStationary) { _updateMapMatching(gpsResult); return; } が
    //       存在することを ★構造で★ 検出する (= 行アンカー非依存・drift 耐性向上)。
    const source = loadSource(METER_JS_PATH);
    const updIdx = source.indexOf('function update(gpsResult)');
    if (updIdx < 0) {
      throw new Error('meter.js に function update(gpsResult) が存在しない');
    }
    // update() 本体冒頭 ~1500 文字 を対象 window とする (= early return は冒頭にある)。
    const window = source.slice(updIdx, updIdx + 1500);
    if (!/if\s*\(\s*gpsResult\.isStationary\s*\)/.test(window)) {
      throw new Error(
        'update() 冒頭に if (gpsResult.isStationary) パターン未検出 (drift detected)'
      );
    }
    if (!/_updateMapMatching\s*\(\s*gpsResult\s*\)/.test(window)) {
      throw new Error(
        'update() 冒頭 isStationary block に _updateMapMatching(gpsResult) 呼出 未検出'
      );
    }
    if (!/return\s*;/.test(window)) {
      throw new Error('update() 冒頭 isStationary block に early return ; 未検出');
    }
  });

  it('B4: map-matcher.js に effectively-stationary 強制 0 化 (mmIncrementM/tentativeIncrementM) pattern が存在', () => {
    // ★白紙書き直し (2026-05-31・L1/L2/L3 連結性拘束配線)★
    //   旧: 行アンカー window slice(3240,3300) で freeze block を検出 (= 行 shift で false-fail)。
    //   2026-05-31 L1 配線で距離源を _confirmedRoadDelta ヘルパへ抽出 (= 上流に関数追加 + inline 短縮)・
    //   freeze block が下流へ移動したため、行アンカーをやめ ★構造 (= if (_effectivelyStationary) block
    //   本体に mmIncrementM=0 / tentativeIncrementM=0 が両方あること)★ で検出する (drift 耐性向上)。
    //   freeze block (= prod 停車中 距離 0 化ロジック) は ★1 byte 不変★・配線変更は freeze 上流のみ。
    const source = loadSource(MAP_MATCHER_JS_PATH);
    const idx = source.indexOf('if (_effectivelyStationary)');
    if (idx < 0) {
      throw new Error(
        'map-matcher.js に if (_effectivelyStationary) pattern 未検出 (drift detected)'
      );
    }
    // freeze block 本体 ~400 文字 を対象 window とする (= mmIncrementM=0 / tentativeIncrementM=0 は冒頭)。
    const window = source.slice(idx, idx + 400);
    if (!/mmIncrementM\s*=\s*0/.test(window)) {
      throw new Error('effectively-stationary block に mmIncrementM = 0 代入 未検出');
    }
    if (!/tentativeIncrementM\s*=\s*0/.test(window)) {
      throw new Error('effectively-stationary block に tentativeIncrementM = 0 代入 未検出');
    }
  });
});
