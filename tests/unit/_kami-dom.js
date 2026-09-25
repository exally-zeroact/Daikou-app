'use strict';
// ============================================================
// ★★試験だけで 使う ごく小さい HTML 読み★★ 2026-09-25
//
//   ★なぜ 自前か★
//     紙の 部品（js/kami-kumu.js）は `document.createElement` と `innerHTML` を 使う。
//     この repo の 試験は ★environment:'node'★ で 揃っている（vitest.config.js:15）。
//     jsdom を 足すと ★借り物が 1本 増える★ ので、
//     ★試験が 要る 分だけ★（textContent と querySelectorAll）を 自前で 持つ。
//
//   ★出来る 事だけ★
//     ・textContent … 字を 全部 つなげて 返す（&amp; 等は 戻す）
//     ・querySelectorAll('tag') / ('.class') … その 2つだけ
//   ★出来ない 事★ 入れ子の 細かい 選び方・style の 解釈（要る様に なったら jsdom を 足す）
// ============================================================

function modosu(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

// <style> の 中身は 字に 数えない（紙の 字では ない）
function sujiNuki(html) {
  return String(html).replace(/<style[\s\S]*?<\/style>/gi, '');
}

function ji(html) {
  return modosu(sujiNuki(html).replace(/<[^>]*>/g, ''));
}

// タグ1つ分を 取り出す（入れ子は 数えて 合わせる）
function hirou(html, tag) {
  const out = [];
  const re = new RegExp('<' + tag + '(\\s[^>]*)?>', 'gi');
  let m;
  while ((m = re.exec(html))) {
    const start = m.index;
    let i = re.lastIndex;
    let fukasa = 1;
    const naka = new RegExp('<(/?)' + tag + '(\\s[^>]*)?>', 'gi');
    naka.lastIndex = i;
    let m2;
    while (fukasa > 0 && (m2 = naka.exec(html))) {
      fukasa += m2[1] === '/' ? -1 : 1;
      i = naka.lastIndex;
    }
    out.push({
      zen: html.slice(start, i),
      naka: html.slice(m.index + m[0].length, i - (tag.length + 3)),
    });
  }
  return out;
}

function tsutsumu(zen, naka) {
  return {
    outerHTML: zen,
    innerHTML: naka,
    get textContent() {
      return ji(naka);
    },
    querySelectorAll: function (sel) {
      return erabu(naka, sel);
    },
  };
}

function erabu(html, sel) {
  sel = String(sel).trim();
  if (sel.charAt(0) === '.') {
    const kurasu = sel.slice(1);
    const out = [];
    const re = new RegExp(
      '<([a-z0-9]+)([^>]*\\sclass="[^"]*\\b' + kurasu + '\\b[^"]*")[^>]*>',
      'gi'
    );
    let m;
    while ((m = re.exec(html))) {
      const t = hirou(html.slice(m.index), m[1]);
      out.push(tsutsumu(t.length ? t[0].zen : m[0], t.length ? t[0].naka : ''));
    }
    return out;
  }
  return hirou(html, sel).map(function (x) {
    return tsutsumu(x.zen, x.naka);
  });
}

function parseHTML(html) {
  return {
    get textContent() {
      return ji(html);
    },
    querySelectorAll: function (sel) {
      return erabu(html, sel);
    },
  };
}

module.exports = { parseHTML: parseHTML, ji: ji };
