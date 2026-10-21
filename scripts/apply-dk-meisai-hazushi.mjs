// ============================================================
// scripts/apply-dk-meisai-hazushi.mjs
// ★「端末が 外した」明細の 記録の 表（daikome.dk_meisai_hazushi）を 倉庫に 作る★ 2026-10-22
//
//   ★なぜ 専用の 道具か（対立役 止1）★
//     supabase/apply-dk-meisai-hazushi.sql は SQL の 門（scripts/sql-guard.mjs）を 通らない
//     （revoke・public の 窓・消す/書き換える 札）。門を 通そうと revoke を 抜くと、この 倉庫の 既定の 権限
//     （pg_default_acl：daikome にも public にも anon=arwdDxtm）で ★誰でも 読み書き できる 表★に なる。
//     ⇒ 門は そのまま、この 1枚だけを ★1つの 取引で★ 当て、当てた 後に 権限を 数で 読み戻す。
//
//   ★当てる 物★ supabase/apply-dk-meisai-hazushi.sql を 丸ごと（表・RLS・revoke・grant・窓・security_invoker）
//     ＋ notify pgrst, 'reload schema'（PostgREST の 名簿の 読み直し＝無いと 関数が 表を 見つけられない）
//
//   ★当てた 後に 見る 事（どれか 1つでも 違えば ★NG★）★
//     ・表の RLS が 有効・方針 0本
//     ・anon／authenticated は 表にも 窓にも select／insert が 無い（has_table_privilege が false）
//     ・service_role は 表にも 窓にも select／insert が 在る
//     ・窓の security_invoker が true
//
//   ★本番★ --honban を 付けた 時だけ（scripts/honban-tome.mjs）・--honban なのに 向き先が 本番で ない 時は 止める
//
//   使い方:
//     node scripts/apply-dk-meisai-hazushi.mjs                 … 見るだけ（今の 形を 数える）
//     node scripts/apply-dk-meisai-hazushi.mjs --ateru         … テストの 倉庫に 当てる
//     node scripts/apply-dk-meisai-hazushi.mjs --ateru --honban … 本番に 当てる（本番の 手元で）
// ============================================================
/* eslint-env node */
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readToken, whereWeLooked } from './db-token.mjs';
import { HONBAN_REF, honbanNoTome } from './honban-tome.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_FILE = path.join(ROOT, 'supabase', 'apply-dk-meisai-hazushi.sql');

// ★当てる 字★（紙を そのまま・取引で 包み・名簿の 読み直しを 足す）
export function okuruJi(sql) {
  const s = String(sql || '').replace(/\r\n/g, '\n');
  if (!/create table if not exists daikome\.dk_meisai_hazushi/.test(s))
    throw new Error('表を 作る 字が 無い');
  if (!/revoke all on daikome\.dk_meisai_hazushi from anon, authenticated;/.test(s))
    throw new Error('表の revoke が 無い（誰でも 読み書き できる 表に なる）');
  if (!/revoke all on public\.dk_meisai_hazushi from anon, authenticated;/.test(s))
    throw new Error('窓の revoke が 無い');
  if (/\b(drop|truncate|delete\s+from)\b/i.test(s.replace(/--[^\n]*/g, '')))
    throw new Error('消す 字が 在る');
  return ['begin;', s.trim(), "notify pgrst, 'reload schema';", 'commit;'].join('\n');
}

// ★読み戻した 形の 門★＝止める 訳の 一覧（空なら OK）
export function katachiNoMon(k) {
  const ng = [];
  if (!k) return ['表が 無い'];
  if (k.rls !== true) ng.push('表の RLS が 有効で ない');
  if (Number(k.hoshin) !== 0) ng.push('表に 方針が ' + k.hoshin + '本 在る（0本の 筈）');
  for (const x of [
    't_anon_s',
    't_anon_i',
    't_auth_s',
    't_auth_i',
    'v_anon_s',
    'v_anon_i',
    'v_auth_s',
    'v_auth_i',
  ])
    if (k[x] !== false) ng.push(x + ' が 開いている（anon／authenticated は 何も 持たない 筈）');
  for (const x of ['t_sr_s', 't_sr_i', 'v_sr_s', 'v_sr_i'])
    if (k[x] !== true) ng.push(x + ' が 閉じている（service_role は 読み書き 要る）');
  if (k.invoker !== true) ng.push('窓の security_invoker が true で ない');
  return ng;
}
// ★--honban なのに 向き先が 本番で ない 時は 止める★（テスト線の 手元で 打って 本番に 当てた つもりに ならない）
export function honbanNoMuki(ref, args) {
  if (args.includes('--honban') && ref !== HONBAN_REF)
    return 'NG: --honban なのに 向き先が 本番で ない（js/dk-config.js は ' + ref + '）';
  return null;
}

const YOMU = `select
  (select relrowsecurity from pg_class where oid = to_regclass('daikome.dk_meisai_hazushi')) rls,
  (select count(*)::int from pg_policies where schemaname = 'daikome' and tablename = 'dk_meisai_hazushi') hoshin,
  has_table_privilege('anon', 'daikome.dk_meisai_hazushi', 'select') t_anon_s,
  has_table_privilege('anon', 'daikome.dk_meisai_hazushi', 'insert') t_anon_i,
  has_table_privilege('authenticated', 'daikome.dk_meisai_hazushi', 'select') t_auth_s,
  has_table_privilege('authenticated', 'daikome.dk_meisai_hazushi', 'insert') t_auth_i,
  has_table_privilege('service_role', 'daikome.dk_meisai_hazushi', 'select') t_sr_s,
  has_table_privilege('service_role', 'daikome.dk_meisai_hazushi', 'insert') t_sr_i,
  has_table_privilege('anon', 'public.dk_meisai_hazushi', 'select') v_anon_s,
  has_table_privilege('anon', 'public.dk_meisai_hazushi', 'insert') v_anon_i,
  has_table_privilege('authenticated', 'public.dk_meisai_hazushi', 'select') v_auth_s,
  has_table_privilege('authenticated', 'public.dk_meisai_hazushi', 'insert') v_auth_i,
  has_table_privilege('service_role', 'public.dk_meisai_hazushi', 'select') v_sr_s,
  has_table_privilege('service_role', 'public.dk_meisai_hazushi', 'insert') v_sr_i,
  coalesce((select 'security_invoker=true' = any(reloptions) from pg_class where oid = to_regclass('public.dk_meisai_hazushi')), false) invoker,
  (select count(*)::int from daikome.dk_meisai_hazushi) gyou`;
const ARU_KA = `select to_regclass('daikome.dk_meisai_hazushi') is not null as t, to_regclass('public.dk_meisai_hazushi') is not null as v`;

function readProjectRef() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'dk-config.js'), 'utf8');
  const m = src.match(/https:\/\/([a-z0-9]{20})\.supabase\.co/);
  if (!m) throw new Error('js/dk-config.js から向き先を読めなかった');
  return m[1];
}
async function runSql(ref, token, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'daikome-apply-dk-meisai-hazushi',
    },
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

async function main() {
  const args = process.argv.slice(2);
  const ateru = args.includes('--ateru');
  const t = readToken();
  if (!t) {
    console.error('NG: 鍵が無い（探した所: ' + whereWeLooked().join(' / ') + '）');
    process.exit(2);
  }
  const ref = readProjectRef();
  const muki = honbanNoMuki(ref, args);
  if (muki) {
    console.error(muki);
    process.exit(3);
  }
  const tome = honbanNoTome(ref, args, !ateru);
  if (tome) {
    console.error(tome);
    process.exit(3);
  }
  console.log(
    '向き先: ' + (ref === HONBAN_REF ? '★本番★' : 'テスト') + ' ' + ref + ' ／ 鍵: ' + t.from
  );
  const okuru = okuruJi(fs.readFileSync(SQL_FILE, 'utf8'));
  const a = await runSql(ref, t.token, ARU_KA);
  const aru = a.ok && a.body && a.body[0] ? a.body[0] : {};
  console.log('当てる 前: 表 ' + (aru.t ? '在る' : '無い') + ' ／ 窓 ' + (aru.v ? '在る' : '無い'));
  if (!ateru) {
    if (aru.t && aru.v) {
      const k = (await runSql(ref, t.token, YOMU)).body[0];
      const ng = katachiNoMon(k);
      console.log(ng.length ? '形: ★' + ng.join('・') + '★' : '形: OK（行 ' + k.gyou + '）');
    }
    console.log('見るだけ（当てるには --ateru）');
    return;
  }
  const r = await runSql(ref, t.token, okuru);
  if (!r.ok) {
    console.error('NG: 当てられなかった ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 300));
    process.exit(4);
  }
  const k = (await runSql(ref, t.token, YOMU)).body[0];
  const ng = katachiNoMon(k);
  console.log('当てた 後: ' + JSON.stringify(k));
  console.log('\nKAKUNIN: ' + (ng.length ? '★NG★ ' + ng.join('・') : 'OK'));
  if (ng.length) process.exit(5);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error('NG: ' + (e && e.message ? e.message : e));
    process.exit(1);
  });
}
