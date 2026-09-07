'use strict';
// ============================================================
// ★★画面に 出す 字は「電子決済」★★ 2026-09-08
//
//   ★司さん★「PayPayやなくて電子決済にして」
//
//   ★決めた 事★
//     ・★お客さん（司さん）に 見える 字★ … ★電子決済★
//       ★2026-09-08 に もっと きつく した★（司さん「書いてるとこ全部」）
//       ⇒ ★例として 添えるのも だめ★＝画面に PayPay の 字を 1つも 出さない
//     ・★倉庫の 列の 名前★ ……………… ★paypay_yen の まま★
//       ⇒ 名前を 変えると ★前に 入れた 分が 読めなくなる★（事故）
//
//   ★見る 範囲（先に 数えた）★
//     お客さんに 見える 字を 持つ 事務所の 画面 … ★3枚★
//       ①nyuryoku.html（打つ 所）
//       ②shukei.html（見る 所）
//       ③uriage.html（道順の 1行）
//     ⇒ この 3枚の ★HTMLの 本文（<script> の 外）★を 見ます。
//       （中の 変数名 PP / paypay_yen は 見ません＝変えては いけない 物）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-08 実測）★★
//     ①見出しを「PayPay で受け取った分」に 戻す … ★赤★
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const GAMEN = ['nyuryoku.html', 'shukei.html', 'uriage.html'];

// ★<script> の 中は 見ない★（中の 名前は 変えては いけない）
function honbun(f) {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  return s.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
}

describe('★画面に 出す 字は「電子決済」★', () => {
  it('★① 3枚とも 本文が 読めている★（0本を 見て 緑に しない）', () => {
    GAMEN.forEach((f) => {
      expect(honbun(f).length, '★' + f + ' の 本文が 読めません★').toBeGreaterThan(500);
    });
  });

  it('★② 「電子決済」の 字が 3枚とも 在る★', () => {
    GAMEN.forEach((f) => {
      expect(
        honbun(f).indexOf('電子決済'),
        '★' + f + ' に 電子決済 の 字が ありません★'
      ).toBeGreaterThan(0);
    });
  });

  it('★③ 画面に PayPay の 字が 1つも 無い★', () => {
    const warui = [];
    GAMEN.forEach((f) => {
      const h = honbun(f);
      const re = /PayPay/g;
      let m;
      while ((m = re.exec(h))) {
        warui.push(f + ' … 「' + h.slice(m.index - 20, m.index + 20).trim() + '」');
      }
    });
    expect(
      warui,
      '★PayPay の 字が 画面に 残っています★ ⇒ 司さん「PayPayって書いてるとこ全部電子決済にしてな」'
    ).toEqual([]);
  });

  it('★④ 倉庫の 列の 名前は 変えていない（paypay_yen）★', () => {
    const s = fs.readFileSync(path.join(ROOT, 'js', 'jippi-hozon.js'), 'utf8');
    expect(
      s.indexOf('paypay_yen'),
      '★倉庫の 列の 名前を 変えています★ ⇒ ★前に 入れた 分が 読めなくなります★'
    ).toBeGreaterThan(0);
  });
});
