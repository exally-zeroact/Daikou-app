'use strict';
// ============================================================
// ★★紙（A4）を PDF に して 出す — ★どの画面からも 同じ この1本★★★ 2026-09-25
//
//   ★司さん★「集計全部を 代行請求書や Castally のように 月で選んだら
//             項目別で その場で A4サイズPDFで 見せれるようにしろ」
//
//   ★なぜ 自前で PDF を 組むか（司さん 2026-08-05 決定・蒸し返さない）★
//     `window.print()` だと ★紙の 下に URL・日付・ページ番号が 必ず 出て 消せない★。
//     `@page{margin:0}` でも CSS でも 消えない（iPhone も PC も）。
//     ⇒ ★自分で A4 を 組んで PDF に する★＝足跡が 出ない。
//     ⇒ ★新しい 窓を 開かない★（開くと 戻れない）。blob を 新しいタブで 開く。
//
//   ★★作り方を 変えた★★ 2026-09-26（司さん「なんで完成形があるのに確かめてやらんのど」）
//     ★前★ html2canvas で ★絵にして★ jsPDF に 貼っていた。
//        実測（2026-09-25）… 1枚 224,518〜567,182B／給料の日ごと 2枚で 1,134,363B
//        司さんの 線「ええとこ200kBぐらい」を ★9種 全部 超えていた★。
//        絵なので ★字を 選べない・探せない★し、拡大すると ぼける。
//     ★今★ 代行請求書・Rakually と 同じ★pdf-lib で 本物の 字を 描く★
//        ＋ lib/font-slim.js で 字体を 軽くする（道具は 4repo と 同じバイト）
//        ⇒ js/kami-egaku.js。この 1本は ★段取りだけ★ を 持つ。
//
//   ★寸法（給料画面 kyuryo.html で 実証済みの 数字を そのまま）★
//     1px = 0.75pt。★板の 12px = 紙の 9pt★ だから 板では 13px 以上を 使う。
//       A4縦 … 595×842pt ＝ 板 794×1123px
//       A4横 … 842×595pt ＝ 板 1123×794px
//
//   ★見張り★ tests/unit/kami-pdf.test.js ・ tests/e2e/kami-pdf-dasu.spec.js
// ============================================================

(function (global) {
  const PX2PT = 0.75;
  const A4 = {
    tate: { w: 595, h: 842, bw: 794, bh: 1123, muki: 'portrait' },
    yoko: { w: 842, h: 595, bw: 1123, bh: 794, muki: 'landscape' },
  };

  // ★字体や 道具が 返らない 時の 時間切れ★（給料画面と 同じ 30秒）
  const MACHI_MS = 30000;

  function _matsu(p, ms, na) {
    return new Promise(function (ok, ng) {
      const t = setTimeout(function () {
        ng(new Error(na + ' が ' + Math.round(ms / 1000) + '秒で 返りませんでした'));
      }, ms);
      p.then(
        function (v) {
          clearTimeout(t);
          ok(v);
        },
        function (e) {
          clearTimeout(t);
          ng(e);
        }
      );
    });
  }

  let _egaku = null;

  // ★描く 1本を 読む★（押した 時だけ）
  function yomu() {
    if (_egaku) return _egaku;
    _egaku = new Promise(function (ok, ng) {
      if (global.KamiEgaku) return ok(global.KamiEgaku);
      const el = document.createElement('script');
      el.src = 'js/kami-egaku.js';
      el.onload = function () {
        global.KamiEgaku ? ok(global.KamiEgaku) : ng(new Error('js/kami-egaku.js'));
      };
      el.onerror = function () {
        ng(new Error('js/kami-egaku.js'));
      };
      document.head.appendChild(el);
    })
      .then(function (E) {
        return E.yomu().then(function () {
          return E;
        });
      })
      .catch(function (e) {
        _egaku = null; // ★失敗は 次に 押した時に 取り直す★
        throw e;
      });
    return _egaku;
  }

  // ============================================================
  // ★出す★ itas … [{ el: 板のdiv, muki: 'tate'|'yoko' }, …]
  //   ★何枚でも 1つの PDF★（複数人＝複数ページ／給料画面と 同じ 決まり）
  // ============================================================
  function dasu(itas, namae) {
    itas = [].concat(itas || []);
    if (!itas.length) return Promise.reject(new Error('出す 紙が ありません'));
    return _matsu(
      yomu().then(function (E) {
        return E.dasu(itas, namae, A4);
      }),
      MACHI_MS,
      'PDF'
    );
  }

  const api = { A4: A4, PX2PT: PX2PT, MACHI_MS: MACHI_MS, yomu: yomu, dasu: dasu };
  if (typeof global !== 'undefined') global.KamiPdf = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
