// ============================================================
// ★運転手の 画面（index.html・1万8千行）を 塊と 節ごとの 枚（index-src/）に 割って 置く★ 2026-11-08 件3
//
//   ★なぜ 配る 物を 割らないか★（設計 v0/v1 を taiketsu が 止め 計6 で 止めた）
//     index.html を 割って 配ると、今 端末に 居る 古い SW が 裏で 新しい html を 古い 控えへ 入れ、
//     割った css/js が 控えに 無い まま 圏外で 開くと 真っ白に なる。html と 本体が 別々に 控えられ 版が 混ざる。
//   ⇒ 配る 物は 今の まま index.html 1枚（sw.js・vercel.json・試験の 読み方は 1字も 変えない）。
//     index-src/ は ★同じ 字を 行で 切っただけ★ の 写し（読む・直す・枚ごとの git log の ため）。
//
//   ★切る 所★
//     ①塊の 境目：行頭の <style …> / <script …>（複数行の 開きタグも 可）の 開きタグの 行までは .html 側、
//       中身は 別の 枚（style＝.css・script＝.js・ld+json＝.json）、閉じの 行（</style> </script>）から .html 側。
//       src= の script・1行で 閉じる script は .html 側の まま。
//     ②節：.html は「<!-- ★」・.css は「/* ★」・.js は「// ★★」の 行の 前（js は 根の 文の 途中では 切らない）。
//     ③長い 枚（NAGAI 行 超え）は 区切りの 良い 所（js＝根の 文の 頭・css＝括弧の 外の 空行・html＝空行）で 切る。
//     ※長い 塊の 中で 大きく 足すと、③の 切れ目が 後ろへ ずれて 数枚の 中身が 動く（taiketsu 注2・120行で 10枚）＝写しの 履歴だけの 話で 配る 物は 同じ。
//   ★読めない 塊は 止める★（件3 設計前 taiketsu 止2）：src= で ない script は acorn、ld+json は JSON.parse。
//
//   使い方：node scripts/index-tsunagu.mjs --check | --modosu [--furinaosu] | --mae | --ato
// ============================================================
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import { makeGamen } from './gamen-tsunagu.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'index.html';
export const NAGAI = 400; // これより 長い 枚は 切る
const KIJUN = 250; // 切る 時は 枚の 頭から この 行より 後ろの 区切りで
const SHIRI_NOKOSU = 50; // 尻に これより 短い 切れ端を 残さない

const MIDASHI = {
  html: /^\s*<!-- ★/,
  css: /^\s*\/\* ★/,
  js: /^\s*\/\/ ★★/,
  json: null,
};
const JS_KOMENTO = /^\s*\/\//;

// html の 1行から 注釈（<!-- … -->）の 外の 字を 取り出す（注釈は 行を 跨ぐ）
function komentoSoto(l, inCom) {
  let soto = '';
  let i = 0;
  while (i < l.length) {
    if (inCom) {
      const e = l.indexOf('-->', i);
      if (e < 0) return { soto, inCom: true };
      i = e + 3;
      inCom = false;
    } else {
      const s = l.indexOf('<!--', i);
      if (s < 0) {
        soto += l.slice(i);
        break;
      }
      soto += l.slice(i, s);
      i = s + 4;
      inCom = true;
    }
  }
  return { soto, inCom };
}

function yomeruKa(kind, text, gyo, atama) {
  if (kind === 'json') {
    try {
      JSON.parse(text);
    } catch (e) {
      throw new Error(`${FILE}:${gyo} の ld+json が 読めない（${e.message}）`);
    }
    return null;
  }
  if (kind !== 'js') return null;
  const module = /\btype\s*=\s*["']?module\b/i.test(atama || '');
  try {
    return acorn.parse(text, {
      ecmaVersion: 'latest',
      sourceType: module ? 'module' : 'script',
      locations: true,
      allowHashBang: false,
    });
  } catch (e) {
    throw new Error(`${FILE}:${gyo} の script が 読めない（${e.message}）`);
  }
}

function shurui(tag, atama, gyo) {
  if (tag === 'style') return 'css';
  const m = atama.match(/\btype\s*=\s*["']?([^"'\s>]+)/i);
  const t = m ? m[1].toLowerCase() : '';
  if (t === '' || t === 'text/javascript' || t === 'module' || t === 'application/javascript')
    return 'js';
  if (t === 'application/ld+json') return 'json';
  throw new Error(`${FILE}:${gyo} の script の type="${t}" は 知らない（割り方を 決めて から）`);
}

// ①塊に 分ける：[{s, e, kind, ast}]（行は 0 始まり・e は 含まない）
function katamari(L, N) {
  const segs = [];
  let hs = 0;
  let inCom = false;
  let i = 0;
  while (i < N) {
    const l = L[i];
    const m = !inCom && l.match(/^\s*<(style|script)\b/i);
    if (m) {
      const tag = m[1].toLowerCase();
      // 開きタグの 終わり（最初の >）まで 行を 進める
      const lt = l.indexOf('<');
      let j = i;
      let gt = l.indexOf('>', lt);
      while (gt < 0) {
        j++;
        if (j >= N) throw new Error(`${FILE}:${i + 1} の <${tag} が 閉じない`);
        gt = L[j].indexOf('>');
      }
      const atama = L.slice(i, j + 1).join('\n');
      const ato = L[j].slice(gt + 1);
      const tojiRe = new RegExp(`</${tag}`, 'i');
      if (tojiRe.test(ato)) {
        // 同じ 行で 閉じる（src= ・1行の script）＝.html 側の まま。中身が 在れば 読めるかだけ 見る
        const naka = ato.slice(0, ato.search(tojiRe));
        if (naka.trim()) {
          if (/\bsrc\s*=/i.test(atama))
            throw new Error(`${FILE}:${i + 1} の src= の script に 中身が 在る`);
          yomeruKa(shurui(tag, atama, i + 1), naka, i + 1, atama);
        }
        i = j + 1;
        continue;
      }
      if (ato.trim() !== '')
        throw new Error(`${FILE}:${j + 1} の <${tag}> の 後ろに 字が 在る（中身は 次の 行から）`);
      if (/\bsrc\s*=/i.test(atama))
        throw new Error(`${FILE}:${i + 1} の src= の script が 同じ 行で 閉じない`);
      const kind = shurui(tag, atama, i + 1);
      let k = j + 1;
      while (k < N && !tojiRe.test(L[k])) k++;
      if (k >= N) throw new Error(`${FILE}:${i + 1} の <${tag}> に 閉じが 無い`);
      if (!new RegExp(`^\\s*</${tag}>\\s*$`, 'i').test(L[k]))
        throw new Error(`${FILE}:${k + 1} の </${tag}> の 行に 他の 字が 在る`);
      segs.push({ s: hs, e: j + 1, kind: 'html' });
      if (k > j + 1) {
        const text = L.slice(j + 1, k).join('\n') + '\n';
        segs.push({ s: j + 1, e: k, kind, ast: yomeruKa(kind, text, j + 2, atama) });
      }
      hs = k;
      i = k + 1;
      continue;
    }
    // 行の 途中の 開きタグは 割れない（注釈の 中は よい）
    const r = komentoSoto(l, inCom);
    if (/<(style|script)\b/i.test(r.soto) && !/^\s*<(style|script)\b/i.test(l))
      throw new Error(`${FILE}:${i + 1} の 行の 途中に <style>/<script> が 在る（行頭に 置く）`);
    inCom = r.inCom;
    i++;
  }
  segs.push({ s: hs, e: N, kind: 'html' });
  return segs.filter((g) => g.e > g.s);
}

// 長い 枚を 区切りの 良い 所で 切る（cuts は 枚の 頭の 行・soft は 切ってよい 行・soft2 は soft が 無い 時の 二番手）
function nagaiWoKiru(cuts, e, soft, soft2 = []) {
  const out = [];
  const bounds = [...cuts, e];
  for (let q = 0; q < bounds.length - 1; q++) {
    let a = bounds[q];
    const b = bounds[q + 1];
    out.push(a);
    while (b - a > NAGAI) {
      const ok = (x) => x >= a + KIJUN && x <= b - SHIRI_NOKOSU;
      const c = soft.find(ok) ?? soft2.find(ok);
      if (c === undefined) break;
      out.push(c);
      a = c;
    }
  }
  return out;
}

// ②③ 塊の 中を 切る（返すのは 枚の 頭の 行）
function setsu(L, g) {
  const { s, e, kind } = g;
  const re = MIDASHI[kind];
  if (kind === 'json') return [s];
  if (kind === 'html') {
    const cuts = [s];
    const soft = [];
    let inCom = false;
    for (let i = s; i < e; i++) {
      if (i > s && !inCom && re.test(L[i])) cuts.push(i);
      if (i > s && !inCom && L[i].trim() === '') soft.push(i);
      inCom = komentoSoto(L[i], inCom).inCom;
    }
    return nagaiWoKiru(cuts, e, soft);
  }
  if (kind === 'css') {
    const cuts = [s];
    const soft = [];
    const soft2 = [];
    let fukasa = 0;
    let inCom = false;
    for (let i = s; i < e; i++) {
      if (i > s && fukasa === 0 && !inCom && re.test(L[i])) cuts.push(i);
      if (i > s && fukasa === 0 && !inCom && L[i].trim() === '') soft.push(i);
      else if (i > s && !inCom && L[i].trim() === '') soft2.push(i);
      // 注釈の 外の 括弧を 数える
      let t = L[i];
      let soto = '';
      let p = 0;
      while (p < t.length) {
        if (inCom) {
          const z = t.indexOf('*/', p);
          if (z < 0) {
            p = t.length;
            break;
          }
          p = z + 2;
          inCom = false;
        } else {
          const z = t.indexOf('/*', p);
          if (z < 0) {
            soto += t.slice(p);
            break;
          }
          soto += t.slice(p, z);
          p = z + 2;
          inCom = true;
        }
      }
      for (const ch of soto) fukasa += ch === '{' ? 1 : ch === '}' ? -1 : 0;
      if (fukasa < 0) fukasa = 0;
    }
    return nagaiWoKiru(cuts, e, soft, soft2);
  }
  // js：根の 文（1つの IIFE だけなら その 中の 文）の 途中では 切らない
  let roots = g.ast.body;
  if (roots.length === 1) {
    let x = roots[0].type === 'ExpressionStatement' ? roots[0].expression : null;
    if (x && x.type === 'UnaryExpression') x = x.argument;
    if (
      x &&
      x.type === 'CallExpression' &&
      /FunctionExpression$/.test(x.callee.type) &&
      x.callee.body.type === 'BlockStatement'
    )
      roots = x.callee.body.body;
  }
  const st = roots.map((r) => s + r.loc.start.line - 1);
  const en = roots.map((r) => s + r.loc.end.line - 1);
  const naka = (i) => st.some((a, q) => a < i && i <= en[q]);
  // 文の 真上の コメントは その 文の 枚に 入れる（前の 文の 終わり・前の 切れ目より 下に 限る）
  const noboru = (i, sita) => {
    let c = i;
    while (c - 1 > sita && JS_KOMENTO.test(L[c - 1]) && !re.test(L[c - 1]) && !naka(c - 1)) c--;
    return c;
  };
  const cuts = [s];
  for (let i = s + 1; i < e; i++) {
    if (!re.test(L[i]) || naka(i)) continue;
    const mae = Math.max(cuts[cuts.length - 1], ...en.filter((x) => x < i));
    const c = noboru(i, mae);
    if (c > cuts[cuts.length - 1]) cuts.push(c);
  }
  const soft = [];
  st.forEach((a, q) => {
    const mae = Math.max(s, q > 0 ? en[q - 1] : s);
    const c = noboru(a, mae);
    if (c > s && !naka(c)) soft.push(c);
  });
  soft.sort((x, y) => x - y);
  // 二番手＝根の 文の 中の 見出しの 行（1つの 関数が 長い 時・写しなので 文の 途中でも 繋ぐと 同じ 字）
  const soft2 = [];
  for (let i = s + 1; i < e; i++) if (re.test(L[i]) && naka(i)) soft2.push(i);
  return nagaiWoKiru(cuts, e, [...new Set(soft)], soft2);
}

export function wariIndex(t) {
  if (t.charCodeAt(0) === 0xfeff) throw new Error(`${FILE} の 頭に BOM が 在る`);
  if (t.includes('\r')) throw new Error(`${FILE} に CR が 在る（LF で 書く）`);
  if (!t.endsWith('\n')) throw new Error(`${FILE} の 最後に 改行が 無い`);
  const L = t.split('\n');
  const N = L.length - 1;
  const parts = [];
  const exts = [];
  for (const g of katamari(L, N)) {
    const heads = setsu(L, g);
    heads.forEach((a, q) => {
      const b = q + 1 < heads.length ? heads[q + 1] : g.e;
      parts.push(L.slice(a, b).join('\n') + '\n');
      exts.push(g.kind);
    });
  }
  return { parts, exts };
}

const midashiOf = (p, ext) => {
  const re = MIDASHI[ext];
  if (!re) return null;
  const m = p.split('\n').find((l) => re.test(l));
  return m ? m.trim() : null;
};

const G = makeGamen({
  root: ROOT,
  file: FILE,
  src: 'index-src',
  haba: 20, // 枚は 約300＝100 ずつ だと 9999 を 超える
  exts: ['html', 'css', 'js', 'json'],
  wari: wariIndex,
  midashi: midashiOf,
  midashiNashiWaChikasa: true, // 見出しの 無い 枚は 中身の 近さで 当てる（件3 設計前 taiketsu 注1）
  mokujiAtama: [
    '# index-src の 目次（scripts/index-tsunagu.mjs が 書く・手で 直さない）',
    '',
    '配る 物は index.html。この 枚は 同じ 字を 塊（html・css・js・json）と 節で 切った 物。直すのは どちらでも よい（門が もう 一方を 作り直す）。',
    '',
    '| 枚 | index.html の 行 | 見出し |',
    '|---|---|---|',
  ],
  mokujiMidashi: (p, ext) => {
    const m = midashiOf(p, ext);
    const kiru = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
    if (m)
      return kiru(
        m
          .replace(/^(<!--|\/\*|\/\/)\s*/, '')
          .replace(/(-->|\*\/)\s*$/, '')
          .replace(/\|/g, '｜')
          .trim(),
        80
      );
    const ichi = p.split('\n').find((l) => l.trim()) || '';
    return `（見出し無し）${kiru(ichi.trim().replace(/\|/g, '｜'), 50)}`;
  },
  dougu: 'scripts/index-tsunagu.mjs',
  sei: 'index.html',
  mon: '★index.html の 門で 止めました★',
  na: 'index-tsunagu',
});

export const { JS, SRC, MOKUJI, wari, wariX, na, namae, tsunagu, mokuji, zure, mae, ato } = G;

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) G.cli(process.argv);
