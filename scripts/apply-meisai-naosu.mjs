// ============================================================
// scripts/apply-meisai-naosu.mjs
// ★事務所の 入力から 明細 1行の 額を 直す 倉庫の 関数（public.dk_meisai_naosu）を 当てる★ 2026-11-14 件⑧b
//
//   司さん（11-14）「お互い修正したら反映されるようにしろ」＝請求書アプリで 直す 向きの 逆。
//   ★なぜ 専用の 道具か★（apply-yaku-namae.mjs と 同じ 訳）
//     SQL の 門（sql-guard.mjs）は 関数を 作る SQL を 通さない。門は 緩めず、この 1本だけ 字で 切り出して 当てる。
//     切り出し・数え・呼べる 人の 読みは apply-yaku-namae.mjs の 物を 使う（守りを 1か所に）。
//   ★守り★
//     ・SQL の ファイルから ★その 関数の 塊だけ★ 切り出す（$fn$ の 外に ; が 1つ だけ・security definer・search_path ''）
//     ・中身に drop・truncate・alter・grant・revoke・create・delete・insert・execute が 無い。
//       update は ★daikou.meisai・daikome.dk_trips・daikome.dk_shifts・daikome.dk_shift_edits だけ★
//       書く 列は KAKU_RETSU だけ（距離・件数は 書かない）
//     ・呼べる 人は ★道具が 書く 決まった 2文★（PUBLIC・anon から 外し authenticated に）
//     ・向き先は js/dk-config.js・判じは scripts/honban-tome.mjs（白名簿・本番は --honban の 時だけ）
//     ・当てた 後 ★倉庫に 入った 関数の 字と 呼べる 人を 読み戻して★ 数える（KAKUNIN）
//
//   使い方:
//     node scripts/apply-meisai-naosu.mjs                  … 見るだけ
//     node scripts/apply-meisai-naosu.mjs --ateru          … テスト線で 当てる
//     node scripts/apply-meisai-naosu.mjs --ateru --honban … 本番で 当てる（本番の 手元で・許しの 後）
// ============================================================
/* eslint-env node */
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kazoeru, kengenOk, kiridasu } from './apply-yaku-namae.mjs';
import { kakuRetsu } from './apply-home-city-kansuu.mjs';
import { readToken, whereWeLooked } from './db-token.mjs';
import { HONBAN_REF, honbanNoTome } from './honban-tome.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const K = {
  na: 'dk_meisai_naosu',
  sig: 'dk_meisai_naosu(uuid,integer,integer)',
  file: 'supabase/apply-meisai-naosu.sql',
  atama:
    'create or replace function public.dk_meisai_naosu(p_meisai_id uuid, p_amount integer, p_hikae integer)',
  searchPath: "set search_path = ''",
  kakeru: ['daikou.meisai', 'daikome.dk_trips', 'daikome.dk_shifts', 'daikome.dk_shift_edits'],
  ARU: [
    ['v_uid uuid := auth.uid()', '呼んだ 人'],
    ['v_m.user_id is distinct from v_uid', 'その人の 明細だけ'],
    ['v_m.amount is distinct from p_hikae', '別の 画面で 直されていたら 書かない'],
    ['p_amount < 0', 'マイナスの 額は 断る'],
    ['c.owner_id = v_uid', 'その人の 会社だけ'],
    ['for no key update', '業務の 行に 鍵（合計が 互いを 落とさない）'],
    ["'Asia/Tokyo'", '車×日は 日本時間の 日'],
    ['ryokin_0_kimeta', '0円と 決めた 印（請求書アプリと 同じ）'],
  ],
  NAI: [
    ['distance', '距離を 触らない'],
    ['trip_count', '件数を 触らない'],
  ],
};
export const KENGEN = [
  'revoke all on function public.dk_meisai_naosu(uuid, integer, integer) from public, anon;',
  'grant execute on function public.dk_meisai_naosu(uuid, integer, integer) to authenticated;',
];
// 書いて よい 列（set の 後ろ・where の 前）
export const KAKU_RETSU = [
  'amount',
  'extra',
  'fare_yen',
  'fare_total_yen',
  'uriage_yen',
  'uriage_at',
  'seikyu_yen',
];

export function kakuRetsuOk(block) {
  const r = kakuRetsu(block);
  return r.length > 0 && r.every((c) => KAKU_RETSU.includes(c));
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
      'User-Agent': 'daikome-apply-meisai-naosu',
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
  if (!r.ok) return { d: '', anon: null, auth: null, pub: null };
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
  if (!kakuRetsuOk(block)) throw new Error('書く 列が 決まりの 外: ' + kakuRetsu(block));
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
