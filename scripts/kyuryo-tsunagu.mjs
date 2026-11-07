// ============================================================
// ★給料の 動き（js/kyuryo.js・8千行）を 節ごとの 枚（kyuryo-src/）に 割って 置く★ 2026-11-07
//   2026-11-08 件3 で 共通の 道具（scripts/gamen-tsunagu.mjs）の 呼び口に した。名・字・挙動は 件2 の まま（足した 物は 1つ：--mae が 枚の 形＝尻の 改行・BOM・CR を 見て 止める＝厳しくなる 向き）。
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
//   使い方：
//     node scripts/kyuryo-tsunagu.mjs --check   … ①② を 作業木で 見る（ずれたら exit 1）
//     node scripts/kyuryo-tsunagu.mjs --modosu  … 作業木の js を 割って kyuryo-src を 書く
//     node scripts/kyuryo-tsunagu.mjs --mae     … pre-commit（lint-staged の 前）
//     node scripts/kyuryo-tsunagu.mjs --ato     … pre-commit（lint-staged の 後）
// ============================================================
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import { makeGamen } from './gamen-tsunagu.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'js/kyuryo.js';
const MIDASHI = /^ {2}\/\/ ★★/;
const KOMENTO = /^ {2}\/\//;

// ★割る★ 見出し「  // ★★」の 行で 切る。見出しの 真上に 続く コメントの 塊は その 節に 入れる
//   （前の 根の 文の 終わりより 下に 限る＝文の 途中では 切らない・taiketsu 注5）
function wariKyuryo(js) {
  if (js.includes('\r')) throw new Error(`${FILE} に CR が 在る（LF で 書く）`);
  const lines = js.split('\n');
  const body = acorn.parse(js, { ecmaVersion: 'latest', locations: true }).body[0].expression.callee
    .body.body;
  const owari = body.map((s) => s.loc.end.line - 1); // 0 始まりの 行
  const cuts = [0];
  lines.forEach((l, i) => {
    if (!MIDASHI.test(l)) return;
    const mae = Math.max(-1, ...owari.filter((e) => e < i));
    if (body.some((s) => s.loc.start.line - 1 < i && i <= s.loc.end.line - 1)) {
      throw new Error(`${FILE}:${i + 1} の 見出しが 根の 文の 途中に 在る（ここでは 割れない）`);
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
  if (lines[lines.length - 1] !== '') throw new Error(`${FILE} の 最後に 改行が 無い`);
  cuts.push(lines.length - 1);
  const parts = [];
  for (let k = 0; k < cuts.length - 1; k++)
    parts.push(lines.slice(cuts[k], cuts[k + 1]).join('\n') + '\n');
  return parts;
}

const G = makeGamen({
  root: ROOT,
  file: FILE,
  src: 'kyuryo-src',
  haba: 100, // 初めは 100 ずつ 空ける＝間に 99枚・尻に 足す 時は 10 ずつ（taiketsu 注10）
  exts: ['js'],
  wari: wariKyuryo,
  midashi: (p) => {
    const m = p.split('\n').find((l) => MIDASHI.test(l));
    return m ? m.trim() : null;
  },
  midashiNashiWaChikasa: false, // 見出しの 無い 枚（頭）は「（頭）」で 当てる＝件2 の まま
  mokujiAtama: [
    '# kyuryo-src の 目次（scripts/kyuryo-tsunagu.mjs が 書く・手で 直さない）',
    '',
    '配る 物は js/kyuryo.js。この 枚は 同じ 字を 節で 切った 物。直すのは どちらでも よい（門が もう 一方を 作り直す）。',
    '',
    '| 枚 | js/kyuryo.js の 行 | 見出し |',
    '|---|---|---|',
  ],
  mokujiMidashi: (p) => {
    const m = p.split('\n').find((l) => MIDASHI.test(l));
    return m
      ? m
          .replace(/^ {2}\/\/ /, '')
          .replace(/\|/g, '｜')
          .trim()
      : '（頭・殻の 始まり）';
  },
  dougu: 'scripts/kyuryo-tsunagu.mjs',
  sei: 'js', // 門の 文言の「js を 正に…」＝件2 の 字の まま
  mon: '★給料の js の 門で 止めました★',
  na: 'kyuryo-tsunagu',
});

export const { JS, SRC, MOKUJI, wari, na, namae, tsunagu, mokuji, zure, mae, ato } = G;

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) G.cli(process.argv);
