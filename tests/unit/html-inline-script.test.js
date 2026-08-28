// ============================================================
// ★HTMLの中のJSが「動く形」になっているか★ 2026-08-25
//
//   ★なぜ要るか（実際に踏んだ2つ）★
//     ①2026-08-12（代行請求）… <script> の中でエスケープを落として ★アプリが1行も動かない★
//     ②2026-08-21（代行請求）… 代入が `= "";` で終わり、後ろの連結が
//       ★誰にも渡らない ただの式★になっていた。一覧から1件も直せず ★本番で4日★。
//       ★構文は正しいので lint も試験も緑のまま★だった。
//
//   ★なぜ このrepoにも要るか★
//     ・eslint は HTML の中の <script> を ★見ない★
//     ・vitest の試験は HTML を ★文字として読む★だけで 実行しない
//     ＝★「緑」は「動く」ではない★
//     決まり（全アプリ）：★構文を解析する見張りを全アプリに★
//     ⇒ 代行請求に在った物を このrepoにも置く。
//
//   ★この見張りがする事★
//     ①<script> が ★構文として通るか★
//     ②★誰にも渡らない式★（書いたのに どこにも届かない行）が無いか
// ============================================================
const fs = require('fs');
const path = require('path');

let acorn;
beforeAll(async () => {
  acorn = await import('acorn');
});

const ROOT = path.resolve(__dirname, '..', '..');

// 客に出る画面（大きい物・毎日 触る物）
const FILES = [
  'index.html',
  'kyuryo.html',
  'dashboard.html',
  'uriage.html',
  'shukei.html',
  'login.html',
  'settings.html',
  'fare.html',
  'history.html',
];

// ★JS の <script> だけを見る★
//   type が無い／text/javascript／module だけが JS。
//   ★application/ld+json（検索エンジン向けの説明書き）は JS ではない★ ので見ない。
//   （2026-08-25 実測：index.html の JSON-LD を JS として読んで 嘘の赤を出した）
// ★HTML のコメントの中は見ない★
//   コメントに 「旧 fine-jp.js の <script> ロードは削除」のような文があり、
//   それを 本物の <script> と読んで ★嘘の赤★ を出した（2026-08-25 実測）。
//   行番号がずれないように ★改行だけ残して消す★。
function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}
function inlineScripts(rawHtml) {
  const html = stripComments(rawHtml);
  const out = [];
  const RE = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = RE.exec(html))) {
    const attr = m[1] || '';
    if (/\bsrc=/.test(attr)) continue; // 外のファイルは別で見る
    const t = (attr.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (t && !/^(text\/javascript|module|application\/javascript)$/i.test(t)) continue;
    out.push({ code: m[2], line: html.slice(0, m.index).split('\n').length });
  }
  return out;
}

function syntaxError(code) {
  try {
    // eslint-disable-next-line no-new-func
    new Function(code);
    return null;
  } catch (e) {
    return e.message;
  }
}

// ★誰にも渡らない式★＝書いても何も起きない形だけを拾う
//   拾う  : 文字列や数の連結・計算・比較（"a" + b / 1 + 2 / x === y）
//   拾わない: 関数呼び出し・代入・new・await など（副作用が有りうる）
const DEAD = new Set(['BinaryExpression', 'TemplateLiteral', 'ArrayExpression']);

function deadExpressions(code, baseLine, parse) {
  const found = [];
  let ast;
  try {
    ast = parse(code, { ecmaVersion: 'latest', locations: true });
  } catch (_) {
    return found; // 構文は上の試験が見る
  }
  const walk = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'ExpressionStatement' && node.expression && DEAD.has(node.expression.type)) {
      found.push({
        行: (baseLine || 0) + (node.loc ? node.loc.start.line - 1 : 0),
        さわり: code.slice(node.start, Math.min(node.end, node.start + 70)).replace(/\s+/g, ' '),
      });
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === 'string') walk(v);
    }
  };
  walk(ast);
  return found;
}

describe('★HTMLの中のJSが 動く形になっている★', () => {
  it('見張りが本物か（わざと壊した物を弾く）', () => {
    expect(syntaxError('var a = 1;'), '通る物を弾いている').toBe(null);
    expect(syntaxError('function f( {'), '壊れた物を通している').not.toBe(null);
    // 2026-08-21 に実際に作ってしまったのと同じ形
    const bad = 'var a=1; document.title = ""; "</div>" + a + "x";';
    expect(
      deadExpressions(bad, 1, acorn.parse).length,
      '★誰にも渡らない式を見逃している★'
    ).toBeGreaterThan(0);
    expect(
      deadExpressions('var a = "x" + 1; f(a);', 1, acorn.parse).length,
      '正しい物を弾いている'
    ).toBe(0);
  });

  it.each(FILES)('%s … <script> が構文として通る', (f) => {
    const p = path.join(ROOT, f);
    // ★2026-08-28: 前は 黙って return＝★無い画面は 何も見ずに緑★でした。
    //   ⇒ 見るはずの画面が 消えた／名前が変わった時に 気づけません。
    expect(fs.existsSync(p), '★見るはずの画面が 在りません: ' + f + '★').toBe(true);
    const ss = inlineScripts(fs.readFileSync(p, 'utf8'));
    for (const s of ss) {
      const e = syntaxError(s.code);
      expect(e, `★${f} の ${s.line} 行あたりの <script> が壊れている★ ${e || ''}`).toBe(null);
    }
  });

  it.each(FILES)('%s … 誰にも渡らない式が無い', (f) => {
    const p = path.join(ROOT, f);
    // ★2026-08-28: 前は「無ければ return」＝★何も見ずに緑★でした。
    //   FILES は ★今 9本とも 両repoに 在る★（2026-08-28 実測）。
    //   画面を1枚 消したなら ★FILES からも 消してください★（黙って緑にしない）。
    expect(fs.existsSync(p), '★' + f + ' が 在りません（FILES を 直してください）★').toBe(true);
    const html = fs.readFileSync(p, 'utf8');
    const all = [];
    for (const s of inlineScripts(html)) all.push(...deadExpressions(s.code, s.line, acorn.parse));
    const doc = all
      .map((x) => `  ${f} の ${x.行} 行あたり: ${x.さわり}`)
      .slice(0, 3)
      .join('\n');
    expect(all.length, `★誰にも渡らない式が ${all.length} 件★\n${doc}`).toBe(0);
  });
});
