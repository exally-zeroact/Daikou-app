// ============================================================
// scripts/apply-home-city-kansuu.mjs
// ★地元の市を 持ち主が 保存する 倉庫の 関数（dk_set_home_city）を 当てる★ 2026-10-24
//
//   ★なぜ 専用の 道具か★（apply-yaku-namae.mjs と 同じ 訳）
//     SQL の 門（sql-guard.mjs）は 関数を 作る SQL を 通さない。門は 緩めず、この 1本だけ 字で 切り出して 当てる。
//     切り出し・数え・呼べる 人の 読みは apply-yaku-namae.mjs の 物を 使う（守りを 1か所に）。
//   ★守り★
//     ・SQL の ファイルから ★その 関数の 塊だけ★ 切り出す（$fn$ の 外に ; が 1つ だけ・security definer・search_path 固定）
//     ・中身に drop・truncate・alter・grant・revoke・create・delete・insert・execute が 無い。
//       update は ★daikome.dk_companies だけ★（書く 列が home_city だけかは KAKU_RETSU で 数える）
//     ・呼べる 人は ★道具が 書く 決まった 2文★（PUBLIC・anon から 外し authenticated に）
//     ・向き先は js/dk-config.js・判じは scripts/honban-tome.mjs（白名簿・本番は --honban の 時だけ）
//     ・当てた 後 ★倉庫に 入った 関数の 字と 呼べる 人を 読み戻して★ 数える（KAKUNIN）
//
//   使い方:
//     node scripts/apply-home-city-kansuu.mjs                  … 見るだけ
//     node scripts/apply-home-city-kansuu.mjs --ateru          … テスト線で 当てる
//     node scripts/apply-home-city-kansuu.mjs --ateru --honban … 本番で 当てる（本番の 手元で・許しの 後）
// ============================================================
/* eslint-env node */
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kazoeru, kengenOk, kiridasu } from './apply-yaku-namae.mjs';
import { readToken, whereWeLooked } from './db-token.mjs';
import { HONBAN_REF, honbanNoTome } from './honban-tome.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const K = {
  na: 'dk_set_home_city',
  sig: 'dk_set_home_city(uuid,text)',
  file: 'supabase/apply-home-city-kansuu.sql',
  atama: 'create or replace function public.dk_set_home_city(p_company uuid, p_city text)',
  kakeru: ['daikome.dk_companies'],
  ARU: [
    ['c.owner_id = auth.uid()', '自分の 会社だけ'],
    ['set home_city = v', '書くのは home_city だけ'],
    ['get diagnostics n = row_count', '書けた 行の 数を 返す'],
  ],
  NAI: [
    ['status', 'status（止める 仕組み）を 書かない'],
    ['seat_limit', '席の 数を 書かない'],
  ],
};
export const KENGEN = [
  'revoke all on function public.dk_set_home_city(uuid, text) from public, anon;',
  'grant execute on function public.dk_set_home_city(uuid, text) to authenticated;',
];

// ★書く 列は home_city だけ★（set の 後ろ・where の 前に 書いた 列を 数える）
export function kakuRetsu(block) {
  const out = [];
  const re = /\bupdate\b[\s\S]*?\bset\b([\s\S]*?)\bwhere\b/gi;
  let m;
  while ((m = re.exec(String(block)))) {
    for (const part of m[1].split(',')) {
      const c = part.split('=')[0].trim().replace(/"/g, '').toLowerCase();
      if (c) out.push(c);
    }
  }
  return out;
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
      'User-Agent': 'daikome-apply-home-city',
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
                       and a.privilege_type = 'EXECUTE') as pub,
            (select count(*)::int from pg_policies where schemaname = 'daikome'
                and tablename = 'dk_companies' and cmd = 'UPDATE' and qual not like '%is_dk_admin%') as owner_upd`
  );
  if (!r.ok) return { d: '', anon: null, auth: null, pub: null, owner_upd: null };
  return (r.body && r.body[0]) || { d: '' };
}

function dasu(kotoba, kz, kg) {
  kz.aru.forEach((x) =>
    console.log('  ' + kotoba + ' ' + (x.ok ? '在り' : '★無し★') + '  ' + x.x + '  … ' + x.w)
  );
  kz.nai.forEach((x) =>
    console.log('  ' + kotoba + ' ' + (x.ok ? '無し' : '★在り★') + '  ' + x.x + '  … ' + x.w)
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
  console.log(
    '  ' + kotoba + ' dk_companies の 運営で ない update の policy: ' + kg.owner_upd + '（0 で ある 事）'
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
  const tome = honbanNoTome(ref, args, !ateru);
  if (tome) {
    console.error(tome);
    process.exit(3);
  }
  console.log(
    '向き先: ' + (ref === HONBAN_REF ? '★本番★' : 'テスト') + ' ' + ref + ' ／ 鍵: ' + t.from
  );
  const block = kiridasu(fs.readFileSync(path.join(ROOT, K.file), 'utf8'), K);
  const retsu = kakuRetsu(block);
  if (retsu.join(',') !== 'home_city') throw new Error('書く 列が home_city だけで ない: ' + retsu);
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
  const ok = kz.ok && kengenOk(ato) && ato.owner_upd === 0;
  console.log('\nKAKUNIN: ' + (ok ? 'OK' : '★NG★'));
  if (!ok) process.exit(5);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error('NG: ' + (e && e.message ? e.message : e));
    process.exit(1);
  });
}
