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
    // Stryker sandbox の line offset 吸収のため window を ±10 line 拡張
    // 2026-05-26 Phase A+B (map-matcher tentativeDistanceM +28行) で block が L3035 へ移動・window 同期
    // 2026-05-27 Phase2-a (gap routing guard + 定数追加) で block が L3085 へ移動・window 同期
    // 2026-05-29 partial commit 早期化 (raw haver tentative ~50 行追加) で block が L3121 へ移動・window 同期
    // 2026-05-29 PM real-trace 残存 creep 解析 (= freeze 条件拡張 effectively stationary):
    //   旧: if (msg.isStationary === true) で freeze
    //   新: const _effectivelyStationary = msg.isStationary === true || _lowSpeed; if (_effectivelyStationary)
    //   anchor regex / pattern を新 block 構造に合わせ更新・window slice 同期 (= L3159 へ移動)。
    // 2026-05-30 白紙書き直し 第四弾 (= pipeline-distance 並列統合・importScripts + tracker manager ~58 行
    //   を上流に additive 追加): block が L3251 へ移動・window slice を (3240,3300) へ同期。
    //   freeze block (= mmIncrementM=0 / tentativeIncrementM=0 / _effectivelyStationary 宣言) は prod 1byte 不変。
    // 2026-05-30 古スマホ対応 ① (= decoder メモリ LRU・decoders Map 上流に ~42 行 additive 追加):
    //   block が L3297 へ移動・window slice を (3280,3340) へ同期。freeze block 自体は prod 1byte 不変。
    // ★白紙書き直し (2026-05-31・L1 配線: 距離源を Viterbi 確定 snap へ一本化)★
    //   旧: 行アンカー window slice(3280,3340) で freeze block を検出 (= 行 shift で false-fail)。
    //   2026-05-31 L1 配線で _confirmedRoadDelta に _vitSnap 抽出 (~20 行) + getPipelineBreakdown
    //   診断 handler (~25 行) を上流に additive 追加したため freeze block が下流へ移動した。
    //   行アンカーをやめ ★構造 (= if (_effectivelyStationary) block 本体に mmIncrementM=0 /
    //   tentativeIncrementM=0 / _effectivelyStationary 宣言があること)★ で検出する (drift 耐性向上・
    //   sibling meter-isStationary-anchor.test.js と同方式)。freeze block は ★prod 1byte 不変★。
    const idx = source.indexOf('if (_effectivelyStationary)');
    if (idx < 0) {
      throw new Error('map-matcher.js に if (_effectivelyStationary) 未検出 (drift detected)');
    }
    // freeze block 本体 (= 直前の宣言行を含むため idx-200 から +400 文字を対象 window とする)。
    const window = source.slice(Math.max(0, idx - 200), idx + 400);
    if (!/mmIncrementM\s*=\s*0/.test(window)) {
      throw new Error('effectively-stationary block に mmIncrementM = 0 代入 未検出');
    }
    if (!/tentativeIncrementM\s*=\s*0/.test(window)) {
      throw new Error('effectively-stationary block に tentativeIncrementM = 0 代入 未検出');
    }
    if (
      !/_effectivelyStationary\s*=\s*msg\.isStationary\s*===\s*true\s*\|\|\s*_lowSpeed/.test(window)
    ) {
      throw new Error(
        'effectively-stationary block に _effectivelyStationary 宣言 (= isStationary OR _lowSpeed) 未検出'
      );
    }
  });

  it('B-static2: 強制 0 化が postMessage 直前 (= 出力直前) に配置', () => {
    const source = loadSource();
    // ★白紙書き直し (2026-05-31・L1 配線): 行アンカーをやめ ★構造 (文字 offset)★ で
    //   「freeze block (if (_effectivelyStationary)) → その後の self.postMessage」の順序と近接を検証。
    //   freeze block 自体・出力経路は prod 1byte 不変・L1 配線は freeze 上流の snap 受け渡しのみ。
    const lines = source.split('\n');
    let forceZeroLineNo = -1;
    let postMessageLineNo = -1;
    for (let i = 0; i < lines.length; i++) {
      if (forceZeroLineNo < 0 && /if\s*\(\s*_effectivelyStationary\s*\)/.test(lines[i])) {
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
