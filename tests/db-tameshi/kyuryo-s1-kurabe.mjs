// ★S1 の 比べ★ 2026-10-17（対立役 S1・指示役：司さんに 訊く 前の 材料）
//   dk_kyuryo_get は 直し（edits）を「返す 勤務と 同じ 日付の 窓」に 絞った（288328307）。
//   今いる人の 額が 変わらない 事を、本物の 計算（js/payroll-daily.js の buildCtx・report）に 3通りで 通して 数える：
//     A＝本人の 画面（関数の 返り そのまま）
//     B＝絞る 前（edits だけ 会社の 直し 全部に 差し替え）
//     C＝事務所の 画面（会社の 人・勤務時間・手当控除を 全員ぶん・直し 全部）
//   A＝B なら 絞りで 額は 動かない。A＝C なら 本人と 事務所が 同じ。
//   使い方：node tests/db-tameshi/kyuryo-s1-kurabe.mjs <worktree>（テスト線の 倉庫だけ・rollback で 終わる）
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] || '.');
const require = createRequire(import.meta.url);
const PD = require(path.join(root, 'js', 'payroll-daily.js'));
const { readToken } = await import(pathToFileURL(path.join(root, 'scripts', 'db-token.mjs')).href);
const src = fs.readFileSync(path.join(root, 'js', 'dk-config.js'), 'utf8');
const ref = src.match(/https:\/\/([a-z0-9]{20})\.supabase\.co/)[1];
if (ref === 'tnfwipbgfgjaymlszeid') throw new Error('本番には 投げない');
const q = fs
  .readFileSync(path.join(root, 'tests', 'db-tameshi', 'kyuryo-s1-kurabe.rollback.sql'), 'utf8')
  .split(/\r?\n/)
  .filter((l) => !/^\s*--/.test(l))
  .join('\n');
if (!/^\s*begin;/i.test(q) || !/rollback;\s*$/i.test(q)) throw new Error('begin; … rollback; で 囲う 事');
if (/\bcommit\b/i.test(q)) throw new Error('commit は 書かない');
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + readToken().token,
    'Content-Type': 'application/json',
    'User-Agent': 'dk-tameshi',
  },
  body: JSON.stringify({ query: q }),
});
const rows = await res.json();
if (!res.ok || !Array.isArray(rows)) throw new Error('倉庫 ' + res.status + ' ' + JSON.stringify(rows).slice(0, 300));

function hibi(m) {
  const d0 = new Date(m + 'T00:00:00Z');
  const out = [];
  for (let d = new Date(d0); d.getUTCMonth() === d0.getUTCMonth(); d.setUTCDate(d.getUTCDate() + 1))
    out.push(d.toISOString().slice(0, 10));
  return out;
}
function gaku(raw, dates, eid) {
  const rep = PD.report(dates, PD.buildCtx(raw));
  const row = rep.employees.find((e) => e && e.employee_id === eid);
  return row ? { pay: row.totalPay, h: row.totalHours, d: row.workedDays } : null;
}

let kumi = 0, ok = 0, AeqB = 0, AeqC = 0, dameFn = 0, editSa = 0, kiku = 0;
for (const r of rows) {
  kumi++;
  const g = r.g || {};
  const m = String(r.m).slice(0, 10);
  if (g.ok !== true) {
    dameFn++;
    console.log('関数が ok で ない', String(r.employee_id).slice(0, 8), m, g.reason);
    continue;
  }
  const base = {
    employees: g.emp ? [g.emp] : [],
    labels: g.labels || [],
    payrollSettings: (g.settings || [])[0] || null,
    salesSettings: g.salesSettings || null,
    shifts: g.shifts || [],
    edits: g.edits || [],
    workHours: g.workHours || [],
    manualDays: g.manualDays || [],
    crew: g.crew,
    adjustments: g.adjustments || [],
  };
  const dates = hibi(m);
  const A = gaku(base, dates, r.employee_id);
  const B = gaku(Object.assign({}, base, { edits: r.all_edits }), dates, r.employee_id);
  const C = gaku(
    Object.assign({}, base, {
      edits: r.all_edits,
      employees: r.jim_emps,
      workHours: r.jim_wh,
      adjustments: r.jim_adj,
      crew: undefined,
    }),
    dates,
    r.employee_id
  );
  // ★空回りで ない 印★ 窓の 中の 直しを 抜くと 額が 変わる＝直しが 本当に 計算に 効いている 組の 数
  const D = gaku(Object.assign({}, base, { edits: [] }), dates, r.employee_id);
  if (JSON.stringify(A) !== JSON.stringify(D)) kiku++;
  editSa += (r.all_edits || []).length - base.edits.length;
  const ab = JSON.stringify(A) === JSON.stringify(B);
  const ac = JSON.stringify(A) === JSON.stringify(C);
  if (A) ok++;
  if (ab) AeqB++;
  if (ac) AeqC++;
  if (!ab || !ac)
    console.log('ずれ', String(r.employee_id).slice(0, 8), m, 'A', JSON.stringify(A), 'B', JSON.stringify(B), 'C', JSON.stringify(C));
}
console.log(
  `組 ${kumi}（関数が ok で ない ${dameFn}・額が 出た ${ok}）／A=B ${AeqB}／A=C ${AeqC}／絞りで 外れた 直しの 行 延べ ${editSa}／直しが 額に 効いた 組 ${kiku}`
);
