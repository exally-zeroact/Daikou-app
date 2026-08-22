// ============================================================
// scripts/sql-guard.mjs
// ★共有本番の倉庫にSQLを当てる前の門番（純ロジック・テスト対象）2026-08-01★
//
//   ダイコメの倉庫 tnfwipbgfgjaymlszeid には
//   ★Kyually本番 / Exally本番 / 代行請求（明細1000件超）の実データが同居している★。
//   だから「足すだけ」以外は絶対に通さない。ここはその関所。
//
//   ▼止める物
//     ・消す/書き換える系（drop / truncate / delete / update / insert / revoke / drop column）
//     ・dk_ で始まらない棚をいじる物（他アプリの棚に触れない）
//   ▼通す物
//     create table / create index / alter table ... add column / enable row level security /
//     create policy / comment on / select（確認用）
//
//   ※ migrate-standalone.sql は drop policy を含むので★ここで弾かれるのが正しい★
//     （あれは新しい空プロジェクト用。共有本番には持ち込まない）
// ============================================================

// コメントと文字列リテラルを消す（regex が中身に引っかからないように）
export function stripNoise(sql) {
  let s = String(sql == null ? '' : sql);
  s = s.replace(/\$\$[\s\S]*?\$\$/g, ' $do$ '); // do $$ ... $$ は中身を見ない印を残す
  s = s.replace(/--[^\n]*/g, ' '); // 行コメント
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' '); // ブロックコメント
  s = s.replace(/'(?:[^']|'')*'/g, "''"); // 文字列
  s = s.replace(/"(?:[^"]|"")*"/g, '""'); // 引用識別子
  return s;
}

const DANGER = [
  {
    name: 'drop',
    re: /\bdrop\s+(table|policy|column|index|schema|view|function|trigger|type|database|role)\b/i,
  },
  { name: 'truncate', re: /\btruncate\b/i },
  { name: 'delete', re: /\bdelete\s+from\b/i },
  { name: 'update', re: /\bupdate\s+[a-z_][\w.]*\s+set\b/i },
  { name: 'insert', re: /\binsert\s+into\b/i },
  { name: 'revoke', re: /\brevoke\b/i },
  { name: 'alter-drop', re: /\balter\s+table\s+[^;]*\bdrop\b/i },
  { name: 'do-block', re: /\$do\$/ }, // 中身を読めない塊は通さない
];

// 危ない書き方が入っていないか
export function findDangerous(sql) {
  const s = stripNoise(sql);
  const hits = [];
  for (const d of DANGER) {
    const m = s.match(d.re);
    if (m) hits.push({ kind: d.name, at: m[0].replace(/\s+/g, ' ').trim() });
  }
  return hits;
}

// このSQLが作り変える棚の名前をぜんぶ拾う
export function findTargetTables(sql) {
  const s = stripNoise(sql);
  const out = new Set();
  const pats = [
    /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][\w]*)/gi,
    /\balter\s+table\s+(?:if\s+exists\s+)?([a-z_][\w]*)/gi,
    /\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?[\w]+\s+on\s+([a-z_][\w]*)/gi,
    /\bcreate\s+policy\s+[\w]+\s+on\s+([a-z_][\w]*)/gi,
    /\bcomment\s+on\s+column\s+([a-z_][\w]*)\./gi,
    /\bcomment\s+on\s+table\s+([a-z_][\w]*)/gi,
  ];
  for (const re of pats) {
    let m;
    while ((m = re.exec(s)) !== null) out.add(m[1].toLowerCase());
  }
  return Array.from(out).sort();
}

// ★門★ 通すか止めるか
export function guard(sql, opts) {
  const prefix = (opts && opts.prefix) || 'dk_';
  const reasons = [];

  const danger = findDangerous(sql);
  for (const d of danger)
    reasons.push('消す/書き換える書き方が入っている: ' + d.kind + ' → ' + d.at);

  const tables = findTargetTables(sql);
  const foreign = tables.filter((t) => t.indexOf(prefix) !== 0);
  for (const t of foreign) reasons.push('他アプリの棚に触ろうとしている: ' + t);

  if (!tables.length && !/\bselect\b/i.test(stripNoise(sql))) {
    reasons.push('何をする物か読み取れない（棚も select も無い）');
  }

  return { ok: reasons.length === 0, reasons, tables, danger };
}
