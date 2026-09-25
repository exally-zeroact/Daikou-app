'use strict';
// ============================================================
// ★★組み上がった 紙を ★本物の 字★ で PDF に 描く★★ 2026-09-26
//
//   ★司さん★「PDFの見せ方や作り方は既存の代行請求書やKyuallyやRakunallyと
//             一緒にして変なものが出んようにしたんか？」
//             「★なんで完成形があるのに確かめてやらんのど★」
//
//   ★★前は 絵にして 貼っていた★★（html2canvas → JPEG → jsPDF）
//     実測（2026-09-25）… 1枚 224,518〜567,182B ／ 給料の 日ごと 2枚で 1,134,363B
//     司さんの 線「ええとこ200kBぐらい」を ★9種 全部 超えていた★。
//     絵の 質を 一番 落としても 1枚 190,898B が 限界（しかも ぼける）。
//     ⇒ ★構造が おかしい★（司さん 2026-09-05 と 同じ 話）。
//
//   ★★完成形＝代行請求書 と Rakually の やり方★★
//     pdf-lib で ★本物の 字を 描く★ ＋ lib/font-slim.js で 字体を 軽くする
//     （実測 … 代行請求書 1通 3,084,654B → ★82,435B★）
//     ・道具は 4repo と ★同じバイト★（lib/pdf-slim.js・lib/font-slim.js）
//     ・太字は ★微小ずらし 重ね描き★（字体は Regular 1本だけ・代行請求書と 同じ）
//     ・見張り tests/pdf-font-weight.test.mjs（全アプリ 共通）
//
//   ★★どうやって 同じ 見た目を 保つか★★
//     ★並べ方は ブラウザに 任せたまま★＝板（div.dk-kami）の 中身は 1行も 変えない。
//     板を 画面の 外に 置いて ★1つ1つの 位置を 実測★し、その 座標に
//     pdf-lib で 塗り・罫・字を 置き直す。
//     ⇒ 表の 幅や 折り返しの 決まりを ★2度 書かない★（作る道を 2本に しない）。
//
//   ★字体を 画面にも 使う★＝@font-face で 同じ BIZ UDP ゴシックを 読ませる。
//     読ませないと ★画面の 字幅と 紙の 字幅が ずれて 枠から はみ出す★。
//
//   ★見張り★ tests/e2e/kami-pdf-dasu.spec.js（PDFの バイト列と 大きさ）
// ============================================================

(function (global) {
  const PT = 0.75; // 1px = 0.75pt
  // ★字の 下端（ベースライン）★＝実測で 決めた（下の 見張りが 絵で 確かめている）
  const BASE = 0.82;
  const FONT_URL = 'vendor/fonts/BIZUDPGothic-Regular.ttf';
  const KAZOKU = 'DKKami';

  let _dougu = null; // 借りている 道具（1回だけ 読む）
  let _font = null; // 字体の バイト列

  function _script(src, aru) {
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

  // ★押した 時だけ 読む★（CDN では なく vendor／版を 固定する為）
  function yomu() {
    if (_dougu) return _dougu;
    _dougu = Promise.all([
      _script('vendor/pdf-lib.min.js', function () {
        return !!global.PDFLib;
      }),
      _script('vendor/fontkit.umd.min.js', function () {
        return !!global.fontkit;
      }),
      // ★font-slim は pdf-slim より 先★（後だと 1枚目だけ 重い紙が 出る）
      _script('lib/font-slim.js', function () {
        return !!global.FontSlim;
      }).then(function () {
        return _script('lib/pdf-slim.js', function () {
          return !!global.PdfSlim;
        });
      }),
      fetch(FONT_URL)
        .then(function (r) {
          if (!r.ok) throw new Error(FONT_URL + ' ' + r.status);
          return r.arrayBuffer();
        })
        .then(function (b) {
          _font = new Uint8Array(b);
        }),
    ])
      .then(function () {
        // ★画面にも 同じ 字体を 使わせる★（字幅を 紙と 揃える）
        if (global.FontFace && document.fonts) {
          const ff = new FontFace(KAZOKU, 'url(' + FONT_URL + ')');
          return ff.load().then(function (f) {
            document.fonts.add(f);
          });
        }
        return null;
      })
      .catch(function (e) {
        _dougu = null; // ★失敗は 次に 押した時に 取り直す★
        throw e;
      });
    return _dougu;
  }

  function _iro(s) {
    const m = String(s || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const a = m[1].split(',').map(function (x) {
      return parseFloat(x);
    });
    return { r: a[0] / 255, g: a[1] / 255, b: a[2] / 255, a: a.length > 3 ? a[3] : 1 };
  }
  function _shiroi(c) {
    return c.r > 0.985 && c.g > 0.985 && c.b > 0.985;
  }

  // ============================================================
  // ★板 1枚を 測る★＝塗り／罫／字 の 3つの 並びに する
  //   ★測るのは 1回だけ★（PdfSlim は 描く手を 2回 呼ぶので 測り直さない）
  // ============================================================
  function hakaru(ita, kata) {
    ita.style.position = 'fixed';
    ita.style.left = '-99999px';
    ita.style.top = '0';
    ita.style.width = kata.bw + 'px';
    ita.style.height = kata.bh + 'px';
    ita.style.background = '#fff';
    document.body.appendChild(ita);

    const out = { w: kata.w, h: kata.h, nuri: [], sen: [], ji: [] };
    try {
      const r0 = ita.getBoundingClientRect();
      const X = function (px) {
        return (px - r0.left) * PT;
      };
      const Y = function (px) {
        return (kata.bh - (px - r0.top)) * PT;
      };

      // ── ①塗り と ②罫 ──────────────────────────
      Array.prototype.forEach.call(ita.querySelectorAll('*'), function (el) {
        if (el.tagName === 'STYLE') return;
        const r = el.getBoundingClientRect();
        if (r.width < 0.5 || r.height < 0.5) return;
        const cs = getComputedStyle(el);
        const bg = _iro(cs.backgroundColor);
        if (bg && bg.a > 0.02 && !_shiroi(bg)) {
          out.nuri.push({
            x: X(r.left),
            y: Y(r.bottom),
            w: r.width * PT,
            h: r.height * PT,
            c: bg,
          });
        }
        [
          ['Top', r.left, r.top, r.right, r.top],
          ['Bottom', r.left, r.bottom, r.right, r.bottom],
          ['Left', r.left, r.top, r.left, r.bottom],
          ['Right', r.right, r.top, r.right, r.bottom],
        ].forEach(function (s) {
          const w = parseFloat(cs['border' + s[0] + 'Width']) || 0;
          if (w < 0.2) return;
          const c = _iro(cs['border' + s[0] + 'Color']);
          if (!c || c.a < 0.02) return;
          out.sen.push({
            x1: X(s[1]),
            y1: Y(s[2]),
            x2: X(s[3]),
            y2: Y(s[4]),
            t: w * PT,
            c: c,
          });
        });
      });

      // ── ③字 ──────────────────────────────────
      const tw = document.createTreeWalker(ita, NodeFilter.SHOW_TEXT, null);
      let n;
      while ((n = tw.nextNode())) {
        const s = n.nodeValue;
        if (!s || !s.trim()) continue;
        const oya = n.parentElement;
        if (!oya || oya.tagName === 'STYLE') continue;
        const cs = getComputedStyle(oya);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const size = parseFloat(cs.fontSize) || 12;
        const futoi = (parseInt(cs.fontWeight, 10) || 400) >= 600;
        const c = _iro(cs.color) || { r: 0, g: 0, b: 0, a: 1 };

        const ran = document.createRange();
        ran.selectNodeContents(n);
        const rects = ran.getClientRects();
        if (!rects.length) continue;

        if (rects.length === 1) {
          out.ji.push({
            s: s,
            x: X(rects[0].left),
            y: Y(rects[0].top) - size * PT * BASE,
            size: size * PT,
            b: futoi,
            c: c,
          });
          continue;
        }
        // ★折り返した 字★＝1文字ずつ 位置を 見て 行に 分ける
        //   （数が 入り切らない 時だけ 起きる。切らずに 折り返す 決まり）
        let ima = null;
        for (let i = 0; i < s.length; i++) {
          const r2 = document.createRange();
          r2.setStart(n, i);
          r2.setEnd(n, i + 1);
          const rr = r2.getBoundingClientRect();
          if (!rr.width && !rr.height) continue;
          if (!ima || Math.abs(rr.top - ima.top) > 1) {
            ima = { top: rr.top, left: rr.left, s: '' };
            out.ji.push({
              s: '',
              x: X(rr.left),
              y: Y(rr.top) - size * PT * BASE,
              size: size * PT,
              b: futoi,
              c: c,
              _i: ima,
            });
          }
          ima.s += s[i];
        }
        out.ji.forEach(function (j) {
          if (j._i) {
            j.s = j._i.s;
            delete j._i;
          }
        });
      }
    } finally {
      try {
        document.body.removeChild(ita);
      } catch (_) {
        /* もう 消えている */
      }
    }
    return out;
  }

  // ★字体に 無い字は 落とさず 印に する★（黙って 消さない）
  function _sanitize(str, font) {
    let out = '';
    for (const ch of String(str)) {
      if (ch === '\n' || ch === '\r') continue;
      try {
        font.widthOfTextAtSize(ch, 10);
        out += ch;
      } catch (_) {
        out += '〓';
      }
    }
    return out;
  }

  // ============================================================
  // ★出す★ itas … [{ el: 板のdiv, muki: 'tate'|'yoko' }, …]
  // ============================================================
  function dasu(itas, namae, A4) {
    itas = [].concat(itas || []);
    if (!itas.length) return Promise.reject(new Error('出す 紙が ありません'));
    return yomu()
      .then(function () {
        // ★字体が 効いてから 測る★（効く前に 測ると 幅が ずれる）
        return document.fonts && document.fonts.ready ? document.fonts.ready : null;
      })
      .then(function () {
        const kami = itas.map(function (x) {
          const kata = A4[x.muki === 'yoko' ? 'yoko' : 'tate'];
          return hakaru(x.el, kata);
        });

        // ★描く手＝PdfSlim が 2回 呼ぶ（1回目は 使う字を 拾うだけ）★
        //   ⇒ ★2回とも 同じ物を 描く★（測り直さない）
        function draw(doc, font) {
          const rgb = global.PDFLib.rgb;
          kami.forEach(function (k) {
            const page = doc.addPage([k.w, k.h]);
            k.nuri.forEach(function (o) {
              page.drawRectangle({
                x: o.x,
                y: o.y,
                width: o.w,
                height: o.h,
                color: rgb(o.c.r, o.c.g, o.c.b),
              });
            });
            k.sen.forEach(function (o) {
              page.drawLine({
                start: { x: o.x1, y: o.y1 },
                end: { x: o.x2, y: o.y2 },
                thickness: o.t,
                color: rgb(o.c.r, o.c.g, o.c.b),
              });
            });
            k.ji.forEach(function (o) {
              const str = _sanitize(o.s, font);
              const opt = {
                x: o.x,
                y: o.y,
                size: o.size,
                font: font,
                color: rgb(o.c.r, o.c.g, o.c.b),
              };
              page.drawText(str, opt);
              // ★太字＝微小ずらし 重ね描き★（代行請求書 invoice-pdf.js と 同じ やり方）
              if (o.b) {
                const d = o.size * 0.025;
                page.drawText(str, Object.assign({}, opt, { x: o.x + d }));
                page.drawText(str, Object.assign({}, opt, { x: o.x + d * 2 }));
              }
            });
          });
        }

        return global.PdfSlim.build({
          PDFLib: global.PDFLib,
          fontkit: global.fontkit,
          fontBytes: _font,
          draw: draw,
        });
      })
      .then(function (bytes) {
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        // ★blob を 新しいタブで 開く★（iOS の 不具合よけ・給与アプリと 同じ）
        const w = global.open(url, '_blank');
        if (!w) {
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
  }

  const api = { PT: PT, BASE: BASE, FONT_URL: FONT_URL, yomu: yomu, hakaru: hakaru, dasu: dasu };
  if (typeof global !== 'undefined') global.KamiEgaku = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
