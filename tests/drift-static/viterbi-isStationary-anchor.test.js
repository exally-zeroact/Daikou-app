// tests/drift-static/viterbi-isStationary-anchor.test.js
//
// ★設計変更宣言 Phase 6-7 (2026-05-21・(M) 分離・司さん採択):
//   旧: tests/property/viterbi-isstationary-force-zero.test.js 内に・行アンカー線 ±10 の
//       静的 grep (B-static1 / B-static2) が混在。
//   新: 本 file へ切出し・通常 vitest では実行・Stryker run では exclude。
//
//   block コードは旧 file から **byte 不変** で移動。
//
//   旧 file 由来 (= tests/property/viterbi-isstationary-force-zero.test.js):
//     B-static1 → 本 file の it 'B-static1'
//     B-static2 → 本 file の it 'B-static2'

'use strict';

const fs = require('fs');
const path = require('path');

const MAP_MATCHER_JS_PATH = path.join(__dirname, '..', '..', 'js', 'map-matcher.js');

function loadSource() {
  return fs.readFileSync(MAP_MATCHER_JS_PATH, 'utf8');
}

describe('drift-static: map-matcher.js L3007 isStationary 強制 0 化 block 位置 (旧 viterbi-isstationary-force-zero.test.js B-static1/B-static2)', () => {
  it('B-static1: map-matcher.js L3007 周辺に強制 0 化 block 存在 (drift 検出)', () => {
    const source = loadSource();
    const lines = source.split('\n');
    // Stryker sandbox の line offset 吸収のため window を ±10 line 拡張 (= 2990-3025)
    const window = lines.slice(2990, 3025).join('\n');
    if (!/if\s*\(\s*msg\.isStationary\s*===\s*true\s*\)/.test(window)) {
      throw new Error(
        'map-matcher.js L3007 周辺 (±10) に if (msg.isStationary === true) 未検出 (drift detected)'
      );
    }
    if (!/mmIncrementM\s*=\s*0/.test(window)) {
      throw new Error('map-matcher.js L3007 周辺 (±10) に mmIncrementM = 0 代入 未検出');
    }
    if (!/tentativeIncrementM\s*=\s*0/.test(window)) {
      throw new Error('map-matcher.js L3007 周辺 (±10) に tentativeIncrementM = 0 代入 未検出');
    }
  });

  it('B-static2: 強制 0 化が postMessage 直前 (= 出力直前) に配置', () => {
    const source = loadSource();
    const lines = source.split('\n');
    let forceZeroLineNo = -1;
    let postMessageLineNo = -1;
    for (let i = 2980; i < 3050 && i < lines.length; i++) {
      if (/if\s*\(\s*msg\.isStationary\s*===\s*true\s*\)/.test(lines[i])) {
        forceZeroLineNo = i + 1;
      }
      if (forceZeroLineNo > 0 && /self\.postMessage\s*\(/.test(lines[i])) {
        postMessageLineNo = i + 1;
        break;
      }
    }
    if (forceZeroLineNo < 0) {
      throw new Error('isStationary 強制 0 化 block 未検出');
    }
    if (postMessageLineNo < 0) {
      throw new Error('postMessage 呼出未検出 (= 強制 0 化後の出力経路欠落)');
    }
    if (postMessageLineNo <= forceZeroLineNo) {
      throw new Error(
        '配置違反: 強制 0 化 (L' +
          forceZeroLineNo +
          ') の前に postMessage (L' +
          postMessageLineNo +
          ') が来ている'
      );
    }
    // 出力直前 (= 30 line 以内) に配置されていることを確認
    if (postMessageLineNo - forceZeroLineNo > 30) {
      throw new Error(
        '強制 0 化と postMessage の距離が大きすぎる (' +
          (postMessageLineNo - forceZeroLineNo) +
          ' lines)・出力経路に副作用が挿入された可能性'
      );
    }
  });
});
