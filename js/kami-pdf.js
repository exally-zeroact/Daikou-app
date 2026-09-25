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
//   ★中身は ここに 書かない★
//     この 1本が 持つのは ★紙 → PDF の 段取りだけ★。
//     何を 印刷するかは 呼ぶ側が ★出来上がりの div（板）★ を 渡す。
//     ＝画面ごとに 別々の PDF の 作り方を 書かない（作る道を 2本に しない）。
//
//   ★寸法（給料画面 kyuryo.html で 実証済みの 数字を そのまま）★
//     1px = 0.75pt。★板の 12px = 紙の 9pt★ だから 板では 13px 以上を 使う。
//       A4縦 … 595×842pt ＝ 板 794×1123px
//       A4横 … 842×595pt ＝ 板 1123×794px
//
//   ★見張り★ tests/unit/kami-pdf.test.js
// ============================================================

(function (global) {
  const PX2PT = 0.75;
  const A4 = {
    tate: { w: 595, h: 842, bw: 794, bh: 1123, muki: 'portrait' },
    yoko: { w: 842, h: 595, bw: 1123, bh: 794, muki: 'landscape' },
  };

  // ★html2canvas は 中の <link>/画像が 返らないと いつまでも 返らない★
  //   ⇒ 時間切れを 付ける（給料画面と 同じ 30秒）
  const MACHI_MS = 30000;

  let _libs = null;

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

  // ★押した 時だけ 読む★（CDN では なく vendor／版を 固定する為）
  function yomu() {
    if (_libs) return _libs;
    function one(src, aru) {
      return new Promise(function (ok, ng) {
        if (aru()) return ok();
        const el = document.createElement('script');
        el.src = src;
        el.onload = function () {
          aru() ? ok() : ng(new Error(src));
        };
        el.onerror = function () {
          ng(new Error(src));
        };
        document.head.appendChild(el);
      });
    }
    _libs = Promise.all([
      one('vendor/html2canvas.min.js', function () {
        return !!global.html2canvas;
      }),
      one('vendor/jspdf.umd.min.js', function () {
        return !!(global.jspdf && global.jspdf.jsPDF);
      }),
    ]).catch(function (e) {
      _libs = null; // ★失敗は 次に 押した時に 取り直す★
      throw e;
    });
    return _libs;
  }

  // ★板を 絵に する★（画面の 外に 置いてから 撮る＝画面が チラつかない）
  function _ita2e(ita, kata) {
    ita.style.position = 'fixed';
    ita.style.left = '-99999px';
    ita.style.top = '0';
    ita.style.width = kata.bw + 'px';
    ita.style.height = kata.bh + 'px';
    ita.style.background = '#fff';
    document.body.appendChild(ita);
    function katazuke() {
      try {
        document.body.removeChild(ita);
      } catch (_) {
        /* もう 消えている */
      }
    }
    return _matsu(
      global
        .html2canvas(ita, {
          scale: 2, // ★≒192dpi★（紙にして 字が 潰れない）
          backgroundColor: '#ffffff',
          useCORS: true,
          width: kata.bw,
          height: kata.bh,
          windowWidth: kata.bw,
          windowHeight: kata.bh,
        })
        .then(function (c) {
          katazuke();
          return c;
        })
        .catch(function (e) {
          katazuke();
          throw e;
        }),
      MACHI_MS,
      'html2canvas'
    ).catch(function (e) {
      katazuke(); // ★時間切れで 抜けた 時も 板を 残さない★
      throw e;
    });
  }

  function _oku(doc, canvas, kata) {
    // 板が もう A4 の 比なので ★紙いっぱいに 置くだけ★
    doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, kata.w, kata.h);
  }

  // ============================================================
  // ★出す★ itas … [{ el: 板のdiv, muki: 'tate'|'yoko' }, …]
  //   ★何枚でも 1つの PDF★（複数人＝複数ページ／給料画面と 同じ 決まり）
  // ============================================================
  function dasu(itas, namae) {
    itas = [].concat(itas || []);
    if (!itas.length) return Promise.reject(new Error('出す 紙が ありません'));
    return yomu().then(function () {
      let doc = null;
      let tsugi = Promise.resolve();
      itas.forEach(function (x) {
        tsugi = tsugi.then(function () {
          const kata = A4[x.muki === 'yoko' ? 'yoko' : 'tate'];
          return _ita2e(x.el, kata).then(function (c) {
            if (!doc) {
              doc = new global.jspdf.jsPDF({
                orientation: kata.muki,
                unit: 'pt',
                format: [kata.w, kata.h],
              });
            } else {
              doc.addPage([kata.w, kata.h], kata.muki);
            }
            _oku(doc, c, kata);
          });
        });
      });
      return tsugi.then(function () {
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        // ★blob を 新しいタブで 開く★（iOS の 不具合よけ・給与アプリと 同じ）
        const w = global.open(url, '_blank');
        if (!w) {
          // ★窓を 塞がれている 端末★＝保存に 逃がす
          const a = document.createElement('a');
          a.href = url;
          a.download = (namae || '紙') + '.pdf';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 60000);
        return { mai: itas.length, size: blob.size };
      });
    });
  }

  const api = { A4: A4, PX2PT: PX2PT, MACHI_MS: MACHI_MS, yomu: yomu, dasu: dasu };
  if (typeof global !== 'undefined') global.KamiPdf = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
