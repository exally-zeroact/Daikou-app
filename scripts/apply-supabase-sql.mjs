// ============================================================
// scripts/apply-supabase-sql.mjs
// ★Supabase の倉庫にSQLを当てる（司さんが画面に貼らなくていいように）2026-08-01★
//
//   使い方:
//     node scripts/apply-supabase-sql.mjs --probe
//         → 鍵と向き先が生きているかだけ確かめる（何も変えない）
//     node scripts/apply-supabase-sql.mjs supabase/apply-shared-dk-payroll.sql ...
//         → 門番(scripts/sql-guard.mjs)を通ったファイルだけ当てる
//     node scripts/apply-supabase-sql.mjs --honban supabase/….sql
//         → ★向き先が本番の時は --honban を付けた時だけ当てる★（2026-10-17・付けないと1文字も当てない）
//
//   ▼安全のしくみ
//     ・向き先は ★js/dk-config.js から読む★（このrepoの向き先以外には当たらない）
//     ・門番を1つでも落ちたら ★1文字も当てない★（途中まで当たるのが一番困る）
//     ・当てた後に棚と列を数えて APPLY RESULT: OK / NG を出す
//   ▼鍵（Supabase Personal Access Token）は %TEMP% のファイルから読む。画面に出さない。
// ============================================================
/* eslint-env node */
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guard } from './sql-guard.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// ★本番の止め★（2026-10-17 対立役 N7）前は本番の手元で走らせると、そのまま本番に当たった。
//   当てる時（--probe で無い時）に、向き先が本番で --honban が無ければ止める。知らない倉庫も止める。
//   判じは scripts/honban-tome.mjs の 1か所（書く 道具 3本で 同じ 物を 使う）。
import { HONBAN_REF, honbanNoTome as tome0 } from './honban-tome.mjs';
export function honbanNoTome(ref, args) {
  return tome0(ref, args, args.includes('--probe'));
}

// 当てた ファイルの 名前を ATO_NO_KAKUNIN の 鍵の 形（repo の 根から・/ 区切り）に 揃える
//   前は 打った 字の まま 引き、「./supabase/…」で 打つと 確かめが 0本の まま OK に なった（対立役 10-17）
export function kagiNoNa(f) {
  return path.relative(ROOT, path.resolve(ROOT, f)).split(path.sep).join('/');
}

// ★ファイルごとの当てた後の確かめ★（2026-10-17 対立役 N7）棚の数だけでは、窓の列や守りが入ったか分からない。
//   q を読んで ok(rows) が true の時だけ OK。
export const ATO_NO_KAKUNIN = {
  'supabase/apply-shime-rireki.sql': [
    {
      w: '窓 public.dk_shime_rireki が security_invoker=true',
      q: "select count(*)::int as n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relname='dk_shime_rireki' and 'security_invoker=true' = any(c.reloptions)",
      ok: (rows) => rows?.[0]?.n === 1,
    },
    {
      w: 'daikome.dk_shime_rireki に 持ち主の policy が 4本',
      q: "select count(*)::int as n from pg_policies where schemaname='daikome' and tablename='dk_shime_rireki'",
      ok: (rows) => rows?.[0]?.n === 4,
    },
    {
      w: '同じ 会社・同じ 日の unique（on_conflict=company_id,from_date が 効く）',
      q: "select count(*)::int as n from pg_constraint where conname='dk_shime_rireki_uq' and contype='u'",
      ok: (rows) => rows?.[0]?.n === 1,
    },
  ],
  'supabase/apply-jugyoin-taishoku.sql': [
    {
      w: 'dk_employees（窓）に retired_on が在る',
      q: "select count(*)::int as n from information_schema.columns where table_schema='public' and table_name='dk_employees' and column_name='retired_on'",
      ok: (rows) => rows?.[0]?.n === 1,
    },
    {
      w: '窓 public.dk_employees が security_invoker=true',
      q: "select count(*)::int as n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relname='dk_employees' and 'security_invoker=true' = any(c.reloptions)",
      ok: (rows) => rows?.[0]?.n === 1,
    },
  ],
};

// ─── 鍵 ─────────────────────────────────────────────
// ★探し場所は scripts/db-token.mjs 1箇所だけ (2026-08-02)★
//   道具ごとに書くとズレる。実際にズレて、鍵が有るのに「無い」と誤診断した。
export { readToken } from './db-token.mjs';
import { readToken } from './db-token.mjs';

// ─── 向き先（このrepoの dk-config.js が唯一の正）───────────
function readProjectRef() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'dk-config.js'), 'utf8');
  const m = src.match(/https:\/\/([a-z0-9]{20})\.supabase\.co/);
  if (!m) throw new Error('js/dk-config.js から向き先を読めなかった');
  return m[1];
}

async function runSql(ref, token, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (_) {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

// ─── 本体 ───────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const probeOnly = args.includes('--probe');
  const files = args.filter((a) => !a.startsWith('--'));

  const key = readToken();
  if (!key) {
    console.error(
      'NG: 鍵が見つからない。%TEMP%\\daikome-db-token.json に {"token":"sbp_…"} を置く。'
    );
    process.exit(1);
  }
  const ref = readProjectRef();
  console.log(
    `向き先: ${ref === HONBAN_REF ? '★本番★ ' : ''}${ref}  /  鍵: ${key.from}（中身は出さない）`
  );
  const tome = honbanNoTome(ref, args);
  if (tome) {
    console.error(tome);
    process.exit(3);
  }

  // ① 鍵と向き先が生きているか（何も変えない読み取りだけ）
  const probe = await runSql(
    ref,
    key.token,
    "select count(*)::int as n from pg_tables where schemaname in ('public','daikome') and tablename like 'dk\\_%'"
  );
  if (!probe.ok) {
    console.error('NG: 倉庫に届かない', probe.status, JSON.stringify(probe.body).slice(0, 300));
    process.exit(1);
  }
  console.log(`いま dk_ の棚は ${probe.body?.[0]?.n} 個ある`);
  if (probeOnly) {
    console.log('PROBE RESULT: OK');
    return;
  }
  if (!files.length) {
    console.error('NG: 当てるファイルが指定されていない');
    process.exit(1);
  }

  // ② 門番 — 1つでも落ちたら1文字も当てない
  const loaded = [];
  let blocked = false;
  for (const f of files) {
    const sql = fs.readFileSync(path.resolve(ROOT, f), 'utf8');
    const g = guard(sql);
    console.log(`\n■ ${f}`);
    console.log(`  触る棚: ${g.tables.join(', ') || '(なし)'}`);
    if (!g.ok) {
      blocked = true;
      g.reasons.forEach((r) => console.log(`  ✗ ${r}`));
    } else {
      console.log('  ✓ 足すだけ（消す/書き換えるは無し・dk_ の棚だけ）');
      loaded.push({ f, sql });
    }
  }
  if (blocked) {
    console.error('\nNG: 門番で止まった。1文字も当てていない。');
    process.exit(1);
  }

  // ③ 当てる
  for (const { f, sql } of loaded) {
    const r = await runSql(ref, key.token, sql);
    if (!r.ok) {
      console.error(`\nNG: ${f} で失敗`, r.status, JSON.stringify(r.body).slice(0, 500));
      process.exit(1);
    }
    console.log(`\n適用: ${f} → OK`);
  }

  // ④ 当たったかを数えて確かめる
  const check = await runSql(
    ref,
    key.token,
    `select t.tablename, t.rowsecurity as rls,
            (select count(*)::int from pg_policies p
              where p.schemaname=t.schemaname and p.tablename=t.tablename) as policies
       from pg_tables t
      where t.schemaname in ('public','daikome') and t.tablename like 'dk\\_%'
      order by t.tablename`
  );
  const cols = await runSql(
    ref,
    key.token,
    `select table_name, column_name from information_schema.columns
      where table_schema in ('public','daikome') and table_name='dk_shift_edits' and column_name='hours'`
  );

  console.log('\n― 当てた後の状態 ―');
  (check.body || []).forEach((r) =>
    console.log(`  ${r.tablename}  RLS=${r.rls}  ポリシー${r.policies}本`)
  );
  console.log(`  dk_shift_edits.hours = ${cols.body?.length ? 'あり' : 'なし'}`);
  let atoNg = 0;
  for (const { f } of loaded) {
    for (const k of ATO_NO_KAKUNIN[kagiNoNa(f)] || []) {
      const r = await runSql(ref, key.token, k.q);
      const ok = r.ok && k.ok(r.body);
      if (!ok) atoNg++;
      console.log(`  ${ok ? '在り' : '★無し★'}  ${k.w}`);
    }
  }

  const need = [
    'dk_device_labels',
    'dk_sales_settings',
    'dk_employees',
    'dk_work_hours',
    'dk_payroll_settings',
  ];
  const have = new Set((check.body || []).map((r) => r.tablename));
  const missing = need.filter((t) => !have.has(t));
  const allRls = (check.body || []).every((r) => r.rls === true);

  if (missing.length || !allRls || !cols.body?.length || atoNg) {
    console.error(
      `\nAPPLY RESULT: NG  足りない棚=${missing.join(',') || 'なし'} / RLS全部on=${allRls}`
    );
    process.exit(1);
  }
  console.log('\nAPPLY RESULT: OK');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error('NG:', e && e.message ? e.message : e);
    process.exit(1);
  });
}
