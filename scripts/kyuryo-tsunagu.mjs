// ============================================================
// ★給料の 動き（js/kyuryo.js・8千行）を 節ごとの 枚（kyuryo-src/）に 割って 置く★ 2026-11-07
//
//   ★なぜ要るか★
//     js/kyuryo.js は 丸ごと 1つの IIFE。読む・直す・直しの 履歴（枚ごとの git log）を 節で 見たい。
//     けれど 枚を 別の <script> に 分けると、起動の 時に 後ろの 節の 関数を 呼ぶ 所が 在り
//     （257行 → honninStart）読まれる 前の 関数を 呼んで 落ちる。
//   ⇒ 配る 物は 今の まま js/kyuryo.js 1枚。kyuryo-src/ は ★同じ 字を 行で 切っただけ★ の 写し。
//
//   ★いつも 成り立つ 2つ★（試験 tests/unit/kyuryo-tsunagu.test.js が 縛る）
//     ①kyuryo-src/*.js を 名の 順に 繋ぐ ＝ js/kyuryo.js（バイト 一致）
//     ②kyuryo-src ＝ wari(js/kyuryo.js)（決まった 所で 割った 物・目次 MOKUJI.md も）
//
//   ★どちらを 直しても よい★（.husky/pre-commit が もう 一方を 作り直す）
//     ・kyuryo-src/ の 枚を 直す → --mae が 繋いで js を 書く
//     ・js/kyuryo.js を 直す       → --ato が 割り直して kyuryo-src を 書く
//     ・両方を 直して 中身が ずれる → 止める（片方の 直しが 黙って 消えるので・設計前 taiketsu 止1）
//     ・stage していない 直しが 在る → 止める（別の 件の 書きかけを 混ぜない・taiketsu 注2）
//
//   使い方：
//     node scripts/kyuryo-tsunagu.mjs --check   … ①② を 作業木で 見る（ずれたら exit 1）
//     node scripts/kyuryo-tsunagu.mjs --modosu  … 作業木の js を 割って kyuryo-src を 書く
//     node scripts/kyuryo-tsunagu.mjs --mae     … pre-commit（lint-staged の 前）
//     node scripts/kyuryo-tsunagu.mjs --ato     … pre-commit（lint-staged の 後）
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as acorn from 'acorn';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const JS = 'js/kyuryo.js';
export const SRC = 'kyuryo-src';
export const MOKUJI = 'MOKUJI.md';
const MIDASHI = /^ {2}\/\/ ★★/;
const KOMENTO = /^ {2}\/\//;

// ★割る★ 見出し「  // ★★」の 行で 切る。見出しの 真上に 続く コメントの 塊は その 節に 入れる
//   （前の 根の 文の 終わりより 下に 限る＝文の 途中では 切らない・taiketsu 注5）
export function wari(js) {
  if (js.includes('\r')) throw new Error(`${JS} に CR が 在る（LF で 書く）`);
  const lines = js.split('\n');
  const body = acorn.parse(js, { ecmaVersion: 'latest', locations: true }).body[0].expression.callee
    .body.body;
  const owari = body.map((s) => s.loc.end.line - 1); // 0 始まりの 行
  const cuts = [0];
  lines.forEach((l, i) => {
    if (!MIDASHI.test(l)) return;
    const mae = Math.max(-1, ...owari.filter((e) => e < i));
    if (body.some((s) => s.loc.start.line - 1 < i && i <= s.loc.end.line - 1)) {
      throw new Error(`${JS}:${i + 1} の 見出しが 根の 文の 途中に 在る（ここでは 割れない）`);
    }
    let c = i;
    while (
      c - 1 > mae &&
      c - 1 > cuts[cuts.length - 1] &&
      KOMENTO.test(lines[c - 1]) &&
      !MIDASHI.test(lines[c - 1])
    )
      c--;
    cuts.push(c);
  });
  if (lines[lines.length - 1] !== '') throw new Error(`${JS} の 最後に 改行が 無い`);
  cuts.push(lines.length - 1);
  const parts = [];
  for (let k = 0; k < cuts.length - 1; k++)
    parts.push(lines.slice(cuts[k], cuts[k + 1]).join('\n') + '\n');
  return parts;
}

export const na = (k) => String(k * 10).padStart(3, '0') + '.js';
const NA = /^\d{3}\.js$/;
const midashi = (p) => {
  const m = p.split('\n').find((l) => MIDASHI.test(l));
  return m ? m.trim() : '（頭）';
};

// ★枚の 名を 引き継ぐ★（設計前 taiketsu 止2）
//   名を 並び順で 付け直すと、間に 節を 足した 時に 後ろの 枚が みな「名は そのまま・中身は 隣の 節」に なり
//   枚ごとの git log が 混ざる。⇒ 見出しの 字で 前の 枚に 当て、当たらない 物は 同じ 間に 在った 前の 名を 順に 使い、
//   それでも 余る（新しい 節）時だけ 間の 番号（015 等）を 付ける。前の 枚が 無い 時は 000,010,…。
export function namae(parts, oldNames = [], oldParts = []) {
  if (!oldNames.length) return parts.map((_, k) => na(k));
  const num = (n) => Number(n.slice(0, 3));
  const oldH = new Map();
  oldParts.forEach((p, k) => {
    const h = midashi(p);
    if (!oldH.has(h)) oldH.set(h, []);
    oldH.get(h).push(oldNames[k]);
  });
  const as = parts.map(() => null);
  const tsukatta = new Set();
  let mae = -1;
  parts.forEach((p, k) => {
    const c = (oldH.get(midashi(p)) || []).find((n) => !tsukatta.has(n) && num(n) > mae);
    if (c) {
      as[k] = c;
      tsukatta.add(c);
      mae = num(c);
    }
  });
  // 当たらない 物の 並び（同じ 当たりの 間）ごとに：前の 名の 余り → 新しい 番号
  let k = 0;
  while (k < parts.length) {
    if (as[k]) {
      k++;
      continue;
    }
    let e = k;
    while (e < parts.length && !as[e]) e++;
    const lo = k > 0 ? num(as[k - 1]) : -1;
    const hi = e < parts.length ? num(as[e]) : 1000;
    const amari = oldNames.filter((n) => !tsukatta.has(n) && num(n) > lo && num(n) < hi);
    const m = e - k;
    const ireru = [];
    for (let i = 0; i < m; i++) {
      if (i < amari.length) ireru.push(num(amari[i]));
      else ireru.push(null);
    }
    // 新しい 番号は 前後の 間を 等しく 割る
    for (let i = 0; i < m; i++) {
      if (ireru[i] !== null) continue;
      const a = i > 0 ? ireru[i - 1] : lo;
      let j = i;
      while (j < m && ireru[j] === null) j++;
      const b = j < m ? ireru[j] : hi;
      const cnt = j - i;
      if (b - a - 1 < cnt)
        throw new Error(`枚の 番号の 間が 足りない（${a} と ${b} の 間に ${cnt}枚）`);
      for (let q = 0; q < cnt; q++) ireru[i + q] = a + Math.floor(((b - a) * (q + 1)) / (cnt + 1));
      i = j - 1;
    }
    ireru.forEach((v, q) => {
      as[k + q] = String(v).padStart(3, '0') + '.js';
      tsukatta.add(as[k + q]);
    });
    k = e;
  }
  return as;
}

export function tsunagu(parts) {
  return parts.join('');
}

export function mokuji(parts, names = parts.map((_, k) => na(k))) {
  let gyo = 1;
  const out = [
    '# kyuryo-src の 目次（scripts/kyuryo-tsunagu.mjs が 書く・手で 直さない）',
    '',
    '配る 物は js/kyuryo.js。この 枚は 同じ 字を 節で 切った 物。直すのは どちらでも よい（門が もう 一方を 作り直す）。',
    '',
    '| 枚 | js/kyuryo.js の 行 | 見出し |',
    '|---|---|---|',
  ];
  parts.forEach((p, k) => {
    const n = p.split('\n').length - 1;
    const m = p.split('\n').find((l) => MIDASHI.test(l));
    const t = m
      ? m
          .replace(/^ {2}\/\/ /, '')
          .replace(/\|/g, '｜')
          .trim()
      : '（頭・殻の 始まり）';
    out.push(`| ${names[k]} | ${gyo}–${gyo + n - 1} | ${t} |`);
    gyo += n;
  });
  return out.join('\n') + '\n';
}

// 作業木の kyuryo-src（*.js の 名の 順）
function yomuSrc(root) {
  const d = path.join(root, SRC);
  if (!fs.existsSync(d)) return { names: [], parts: [], moku: null };
  const names = fs
    .readdirSync(d)
    .filter((n) => n.endsWith('.js'))
    .sort();
  const mp = path.join(d, MOKUJI);
  return {
    names,
    parts: names.map((n) => fs.readFileSync(path.join(d, n), 'utf8')),
    moku: fs.existsSync(mp) ? fs.readFileSync(mp, 'utf8') : null,
  };
}

// ①② の ずれを 数える（空なら 正しい）
export function zure(js, names, parts, moku) {
  const z = [];
  const want = wari(js);
  if (tsunagu(parts) !== js) z.push(`${SRC} を 繋いだ 物 ≠ ${JS}`);
  if (!names.every((n) => NA.test(n))) z.push(`枚の 名が 3桁の 数で ない`);
  if (names.length !== want.length) z.push(`枚の 数 ${names.length} ≠ 割った 物 ${want.length}`);
  else {
    want.forEach((p, k) => p !== parts[k] && z.push(`${SRC}/${names[k]} ≠ 割った 物`));
    if (moku !== mokuji(want, names)) z.push(`${SRC}/${MOKUJI} が ずれている`);
  }
  return z;
}

function kaku(root, parts, names) {
  const d = path.join(root, SRC);
  fs.mkdirSync(d, { recursive: true });
  const nokosu = new Set(names);
  for (const n of fs.readdirSync(d))
    if (n.endsWith('.js') && !nokosu.has(n)) fs.rmSync(path.join(d, n));
  parts.forEach((p, k) => {
    const f = path.join(d, names[k]);
    if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== p) fs.writeFileSync(f, p);
  });
  const m = mokuji(parts, names);
  const mp = path.join(d, MOKUJI);
  if (!fs.existsSync(mp) || fs.readFileSync(mp, 'utf8') !== m) fs.writeFileSync(mp, m);
}

// ---- git の index と HEAD の 字（pre-commit 用・作業木は 信じない＝taiketsu 注2） ----
// 試験の 一時 repo では 呼ぶ 側が GIT_* を 外した env を 渡す（tests/lib/kari-git.js・本物の repo を 書き換えない）。
// 門（pre-commit）では 渡さない＝git が 渡す GIT_INDEX_FILE 等で 本物の index を 見る。
let KANKYO;
const git = (root, args, opt = {}) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    env: KANKYO,
    ...opt,
  });
const aru = (root, rev) => {
  try {
    git(root, ['cat-file', '-e', rev], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
function srcAt(root, rev) {
  // rev＝'' は index、'HEAD' は HEAD
  const ls =
    rev === ''
      ? git(root, ['ls-files', '--', SRC])
      : aru(root, 'HEAD')
        ? git(root, ['ls-tree', '-r', '--name-only', 'HEAD', '--', SRC])
        : '';
  const names = ls
    .split('\n')
    .filter((p) => p.endsWith('.js'))
    .map((p) => p.slice(SRC.length + 1))
    .sort();
  return { names, parts: names.map((n) => git(root, ['show', `${rev}:${SRC}/${n}`])) };
}
function jsAt(root, rev) {
  if (rev === 'HEAD' && !aru(root, 'HEAD')) return null;
  try {
    return git(root, ['show', `${rev}:${JS}`]);
  } catch {
    return null;
  }
}
function stageNoMama(root) {
  try {
    git(root, ['diff', '--quiet', '--', JS, SRC]);
  } catch {
    return false;
  }
  // stage していない 新しい 枚（未追跡）も 書きかけ
  return git(root, ['ls-files', '--others', '--exclude-standard', '--', SRC]).trim() === '';
}
const onaji = (a, b) =>
  a.names.join(',') === b.names.join(',') && a.parts.every((p, k) => p === b.parts[k]);

export function mae(root = ROOT, env = undefined) {
  KANKYO = env;
  const sI = srcAt(root, ''),
    sH = srcAt(root, 'HEAD');
  const jI = jsAt(root, ''),
    jH = jsAt(root, 'HEAD');
  const srcKawari = !onaji(sI, sH),
    jsKawari = jI !== jH;
  if (!srcKawari && !jsKawari) return { kekka: 'sawaranai' };
  if (!stageNoMama(root)) {
    return {
      kekka: 'tomeru',
      riyuu: `${JS} か ${SRC}/ に stage していない 直しが 在る（作り直すと 一緒に commit に 入る）→ stage するか 戻す`,
    };
  }
  if (srcKawari) {
    const cat = tsunagu(sI.parts);
    if (jsKawari && jI !== cat) {
      return {
        kekka: 'tomeru',
        riyuu: `${SRC}/ と ${JS} を 両方 直していて 中身が ずれている（片方の 直しが 消える）→ どちらか 1つに して もう 一方は 戻す（js を 正にするなら node scripts/kyuryo-tsunagu.mjs --modosu）`,
      };
    }
    if (cat !== jI) {
      fs.writeFileSync(path.join(root, JS), cat);
      git(root, ['add', '--', JS]);
      return { kekka: 'js-wo-kaita' };
    }
  }
  return { kekka: 'tooru' };
}

export function ato(root = ROOT, env = undefined) {
  KANKYO = env;
  const jI = jsAt(root, ''),
    jH = jsAt(root, 'HEAD');
  const sI = srcAt(root, ''),
    sH = srcAt(root, 'HEAD');
  if (jI === jH && onaji(sI, sH)) return { kekka: 'sawaranai' };
  if (jI === null) return { kekka: 'tomeru', riyuu: `${JS} が index に 無い` };
  const parts = wari(jI);
  const mokuI = (() => {
    try {
      return git(root, ['show', `:${SRC}/${MOKUJI}`]);
    } catch {
      return null;
    }
  })();
  if (zure(jI, sI.names, sI.parts, mokuI).length === 0) return { kekka: 'tooru' };
  kaku(root, parts, namae(parts, sI.names, sI.parts));
  git(root, ['add', '-A', '--', SRC]);
  return { kekka: 'src-wo-kaita' };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv[2];
  if (a === '--check') {
    const js = fs.readFileSync(path.join(ROOT, JS), 'utf8');
    const s = yomuSrc(ROOT);
    const z = zure(js, s.names, s.parts, s.moku);
    if (z.length) {
      console.error(
        `★kyuryo-src と js/kyuryo.js が ずれています★\n  ${z.slice(0, 10).join('\n  ')}\n  → node scripts/kyuryo-tsunagu.mjs --modosu（js を 正に する 時）`
      );
      process.exit(1);
    }
  } else if (a === '--modosu') {
    const parts = wari(fs.readFileSync(path.join(ROOT, JS), 'utf8'));
    const s = yomuSrc(ROOT);
    kaku(ROOT, parts, namae(parts, s.names, s.parts));
    console.error(`${SRC}/ を ${JS} から 書いた`);
  } else if (a === '--mae' || a === '--ato') {
    let r;
    try {
      r = a === '--mae' ? mae() : ato();
    } catch (e) {
      r = { kekka: 'tomeru', riyuu: `${e.message}（何も 書いていない）` };
    }
    if (r.kekka === 'tomeru') {
      console.error(`★給料の js の 門で 止めました★ ${r.riyuu}`);
      process.exit(1);
    }
    if (r.kekka !== 'sawaranai' && r.kekka !== 'tooru')
      console.error(`kyuryo-tsunagu ${a}: ${r.kekka}`);
  } else {
    console.error('使い方: --check | --modosu | --mae | --ato');
    process.exit(2);
  }
}
