// ============================================================
// scripts/apply-yaku-namae.mjs
// ★役割の 名前を 直す 倉庫の 関数（dk_yaku_namae_naoshi）を 当てる★ 2026-10-17
//
//   ★なぜ 専用の 道具か★（apply-kyuryo-saihakkou.mjs と 同じ 訳）
//     SQL の 門（sql-guard.mjs）は 関数を 作る SQL を 通さない。門は 緩めず、この 1本だけ 字で 切り出して 当てる。
//   ★守り★
//     ・SQL の ファイルから ★その 関数の 塊だけ★ 切り出す（$fn$ の 外に ; が 1つ だけ・security definer・search_path 固定）
//     ・中身に drop・truncate・alter・grant・revoke・create・delete・insert が 無い。update は
//       daikome.dk_payroll_settings と daikome.dk_employees と daikome.dk_yaku_rireki（10-18）だけ
//     ・呼べる 人は ★道具が 書く 決まった 2文★（PUBLIC・anon から 外し authenticated に）＝ファイルの 字を 当てない
//     ・向き先は js/dk-config.js・判じは scripts/honban-tome.mjs（白名簿・本番は --honban の 時だけ）
//     ・当てた 後 ★倉庫に 入った 関数の 字と 呼べる 人を 読み戻して★ 数える（KAKUNIN）
//
//   使い方:
//     node scripts/apply-yaku-namae.mjs                 … 見るだけ
//     node scripts/apply-yaku-namae.mjs --ateru         … テスト線で 当てる
//     node scripts/apply-yaku-namae.mjs --ateru --honban … 本番で 当てる（本番の 手元で・司さんの 許しの 後）
// ============================================================
/* eslint-env node */
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readToken, whereWeLooked } from './db-token.mjs';
import { HONBAN_REF, honbanNoTome } from './honban-tome.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const K = {
  na: 'dk_yaku_namae_naoshi',
  sig: 'dk_yaku_namae_naoshi(uuid,jsonb)',
  file: 'supabase/apply-yaku-namae.sql',
  atama: 'create or replace function public.dk_yaku_namae_naoshi(p_company_id uuid, p_map jsonb)',
  ARU: [
    ['c.owner_id = auth.uid()', '自分の 会社だけ'],
    ["'exists'", '直さない 役割の 名前と ぶつかる 時は 断る'],
    ['p_map ? e.role', '人の 役割を 倉庫の 側で 古い 名前を 条件に 直す（辞めた 人も）'],
    ["jsonb_set(v_extra, '{roles}'", '日給・段階歩合の 鍵も 一緒に 直す'],
    ['update daikome.dk_yaku_rireki y', '役割の 決まりの 記録の 名前も 同じ 取引で 直す'],
  ],
  NAI: [],
};
// 呼べる 人（道具が 書く・ファイルの 字は 当てない）
export const KENGEN = [
  'revoke all on function public.dk_yaku_namae_naoshi(uuid, jsonb) from public, anon;',
  'grant execute on function public.dk_yaku_namae_naoshi(uuid, jsonb) to authenticated;',
];

export function kiridasu(sql, k) {
  const s = String(sql).replace(/\r\n/g, '\n');
  const a0 = s.indexOf(k.atama + '\n');
  if (a0 < 0) throw new Error(k.na + ' の 塊が 見つからない');
  if (s.indexOf(k.atama + '\n', a0 + 1) >= 0) throw new Error(k.na + ' の 塊が 2つ 在る');
  const owari = s.indexOf('\n$fn$;', a0);
  if (owari < 0) throw new Error(k.na + ' の 終わりが 見つからない');
  const block = s.slice(a0, owari + '\n$fn$;'.length);
  const a = block.indexOf('$fn$');
  const b = block.lastIndexOf('$fn$');
  if (a < 0 || a === b) throw new Error('$fn$ の 囲いが 読めない');
  const soto = block.slice(0, a) + block.slice(b + 4);
  if ((soto.match(/;/g) || []).length !== 1) throw new Error('囲いの 外に 別の 文が 在る');
  // ★注釈を 外してから 判じる★（「security invoker -- security definer」の 様に 注釈の 字で 通さない・対立役 2026-10-17）
  const kesu = (x) => x.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
  const atama = kesu(block.slice(0, a));
  if (!/\bsecurity\s+definer\b/i.test(atama)) throw new Error('security definer が 無い');
  if (/\bsecurity\s+invoker\b/i.test(atama)) throw new Error('security invoker が 在る');
  if (!/set search_path = daikome, public, extensions/.test(atama))
    throw new Error('search_path を 固定していない');
  const naka = kesu(block.slice(a + 4, b));
  // execute（字を つないで 別の 文を 走らせる）も 断る
  const ng = naka.match(/\b(delete|drop|truncate|alter|grant|revoke|create|insert|execute)\b/i);
  if (ng) throw new Error(k.na + ' に ' + ng[0] + ' が 在る');
  // 書き換える 表は 引用符・空白を 外して 名前で 比べる（"daikome"."dk_companies" 等で すり抜けない）
  const ups =
    naka.match(/\bupdate\s+(?:only\s+)?(?:"[^"]+"|\w+)(?:\s*\.\s*(?:"[^"]+"|\w+))?/gi) || [];
  for (const u of ups) {
    const t = u
      .replace(/^update\s+(?:only\s+)?/i, '')
      .replace(/["\s]/g, '')
      .toLowerCase();
    // 書き換えて よい 表は k.kakeru（無ければ この 関数の 3つ）。地元の市の 関数（10-24）は dk_companies だけ
    const yoi = k.kakeru || [
      'daikome.dk_payroll_settings',
      'daikome.dk_employees',
      'daikome.dk_yaku_rireki', // 役割の 決まりの 記録（何日から 10-18）
    ];
    if (!yoi.includes(t))
      throw new Error(k.na + ' が ' + t + ' を 書き換える');
  }
  return block;
}

export function kazoeru(def, k) {
  const d = String(def || '').replace(/\r\n/g, '\n');
  const aru = k.ARU.map(([x, w]) => ({ x, w, ok: d.includes(x) }));
  const nai = k.NAI.map(([x, w]) => ({ x, w, ok: !d.includes(x) }));
  return { aru, nai, ok: d.length > 0 && aru.every((x) => x.ok) && nai.every((x) => x.ok) };
}

// 呼べる 人の 読み（anon と PUBLIC は 呼べない・authenticated は 呼べる）
export function kengenOk(r) {
  return !!r && r.anon === false && r.pub === false && r.auth === true;
}

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
      'User-Agent': 'daikome-apply-yaku-namae',
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

async function yomimodosu(ref, token, k) {
  const r = await runSql(
    ref,
    token,
    `select (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = '${k.na}' limit 1) as d,
            has_function_privilege('anon', 'public.${k.sig}', 'execute') as anon,
            has_function_privilege('authenticated', 'public.${k.sig}', 'execute') as auth,
            exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
                    aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     where n.nspname = 'public' and p.proname = '${k.na}' and a.grantee = 0
                       and a.privilege_type = 'EXECUTE') as pub`
  );
  if (!r.ok) {
    // 関数が まだ 無い 時は has_function_privilege が 転ぶ＝「無い」として 返す
    return { d: '', anon: null, auth: null, pub: null };
  }
  return (r.body && r.body[0]) || { d: '' };
}

function dasu(kotoba, kz, kg) {
  kz.aru.forEach((x) =>
    console.log('  ' + kotoba + ' ' + (x.ok ? '在り' : '★無し★') + '  ' + x.x + '  … ' + x.w)
  );
  console.log(
    '  ' +
      kotoba +
      ' 呼べる 人: anon=' +
      kg.anon +
      ' PUBLIC=' +
      kg.pub +
      ' authenticated=' +
      kg.auth +
      (kengenOk(kg) ? '' : '  ★決まりと 違う★')
  );
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
  // ★本番の 止め★ 判じは scripts/honban-tome.mjs の 1か所（白名簿）。--ateru の 時は 倉庫に 届く 前に 止める
  const tome = honbanNoTome(ref, args, !ateru);
  if (tome) {
    console.error(tome);
    process.exit(3);
  }
  console.log(
    '向き先: ' + (ref === HONBAN_REF ? '★本番★' : 'テスト') + ' ' + ref + ' ／ 鍵: ' + t.from
  );
  const block = kiridasu(fs.readFileSync(path.join(ROOT, K.file), 'utf8'), K);
  const mae = await yomimodosu(ref, t.token, K);
  console.log('\n■ ' + K.na);
  dasu('前', kazoeru(mae.d, K), mae);
  if (!ateru) {
    console.log('\n見るだけ（当てるには --ateru）');
    return;
  }
  // ★関数と 呼べる 人を 1つの 取引で★（関数だけ 出来て 誰でも 呼べる 間を 作らない）
  const r = await runSql(ref, t.token, 'begin;\n' + block + '\n' + KENGEN.join('\n') + '\ncommit;');
  if (!r.ok) {
    console.error(
      'NG: 当てられなかった（1つの 取引なので 何も 変わっていない筈） ' +
        r.status +
        ' ' +
        JSON.stringify(r.body).slice(0, 300)
    );
    process.exit(4);
  }
  const ato = await yomimodosu(ref, t.token, K);
  const kz = kazoeru(ato.d, K);
  console.log('\n■ ' + K.na);
  dasu('後', kz, ato);
  const ok = kz.ok && kengenOk(ato);
  console.log('\nKAKUNIN: ' + (ok ? 'OK' : '★NG★'));
  if (!ok) process.exit(5);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error('NG: ' + (e && e.message ? e.message : e));
    process.exit(1);
  });
}
