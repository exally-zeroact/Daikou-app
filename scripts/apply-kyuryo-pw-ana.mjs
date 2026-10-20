// ============================================================
// scripts/apply-kyuryo-pw-ana.mjs
// ★本人の パスワードを 照らす 関数 3本（dk_kyuryo_pw_set・dk_kyuryo_verify・dk_kyuryo_get）を 当てる★ 2026-10-19
//   ★pw_set★ 前は `r.init_code <> p_init`＝p_init が null だと 初回コードを 知らなくても パスワードを 決められた（odan 10-19）
//   ★穴★ 前は `r.pw_hash <> crypt(p_pw, r.pw_hash)`＝p_pw が null だと crypt も null で 比べが 真に ならず、
//     パスワード 無しで「合っている」に なった（token を 持つ 人なら 明細が 見えた）。
//     ⇒ `p_pw is null or r.pw_hash is distinct from crypt(p_pw, r.pw_hash)`（司さん 10-19「先に塞げ」）
//   ★守り★（apply-kyuryo-saihakkou.mjs の kiridasu・kazoeru を そのまま 使う）
//     ・SQL の ファイルから その 関数の 塊だけ 切り出す・3本を 1つの 取引で 当てる
//     ・当てた 後 倉庫から 読み戻して、新しい 照らし方が 在り・古い 照らし方が 無い かを 数える（KAKUNIN）
//   使い方:
//     node scripts/apply-kyuryo-pw-ana.mjs                  … 見るだけ
//     node scripts/apply-kyuryo-pw-ana.mjs --ateru          … テスト線で 当てる
//     node scripts/apply-kyuryo-pw-ana.mjs --ateru --honban … 本番で 当てる（本番の 手元で）
// ============================================================
/* eslint-env node */
/* eslint-disable no-console */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readToken, whereWeLooked } from './db-token.mjs';
import { HONBAN_REF, honbanNoTome } from './honban-tome.mjs';
import { kiridasu, kazoeru } from './apply-kyuryo-saihakkou.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ATARASHII = 'if p_pw is null or r.pw_hash is distinct from crypt(p_pw, r.pw_hash) then';
const FURUI = 'if r.pw_hash <> crypt(p_pw, r.pw_hash) then';

export const KANSUU = [
  {
    na: 'dk_kyuryo_pw_set',
    mae: 'bd49d3778bc954d95030df2cb8d6fbc2',
    ato: '44286601d5660d650c35a53391f4425d',
    sig: 'dk_kyuryo_pw_set(text, text, text)',
    file: 'supabase/apply-kyuryo-honnin-kansuu.sql',
    atama:
      'create or replace function public.dk_kyuryo_pw_set(p_token text, p_init text, p_pw text)',
    insertOk: false,
    ARU: [
      [
        'if p_init is null or r.init_code is distinct from p_init then',
        '空（null）の 初回コードは 必ず 違う',
      ],
    ],
    NAI: [
      [
        'if r.init_code <> p_init then',
        'null で 素通りする 古い 比べ（初回コード 無しで 決められた）',
      ],
    ],
  },
  {
    na: 'dk_kyuryo_verify',
    mae: 'cdd72d7f0bd69af8fd0e3a43c12bd5aa',
    ato: '1d81c8812b1133ddc8f020ec09414fa3',
    sig: 'dk_kyuryo_verify(text, text)',
    file: 'supabase/apply-kyuryo-honnin-kansuu.sql',
    atama: 'create or replace function public.dk_kyuryo_verify(p_token text, p_pw text)',
    insertOk: false,
    ARU: [[ATARASHII, '空（null）の パスワードは 必ず 違う']],
    NAI: [[FURUI, 'null で 素通りする 古い 照らし方']],
  },
  {
    na: 'dk_kyuryo_get',
    mae: '67f50ede14a319cf3d8614bda7e8df40',
    ato: '695e805f903928247b788f3f22e9d563',
    sig: 'dk_kyuryo_get(text, text, date, date)',
    file: 'supabase/apply-kyuryo-honnin-kansuu.sql',
    atama:
      'create or replace function public.dk_kyuryo_get(p_token text, p_pw text, p_from date, p_to date)',
    insertOk: false,
    ARU: [
      [ATARASHII, '空（null）の パスワードは 必ず 違う'],
      ["'shimeRireki'", '締めの 記録を 返す（10-19 の 版の まま）'],
    ],
    NAI: [[FURUI, 'null で 素通りする 古い 照らし方']],
  },
];

// ★md5 の 門★（対立役 本番前 S2）：当てる 前の 倉庫が mae（10-19 の 本番・テスト）か ato（もう 直した）で、
//   切り出した 塊が ato で なければ 止める＝別の 席が 別の 版に した 関数を 黙って 上書きしない
export function honbunMd5(block) {
  const a = block.indexOf('$fn$');
  const b = block.lastIndexOf('$fn$');
  return crypto
    .createHash('md5')
    .update(block.slice(a + 4, b))
    .digest('hex');
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
      'User-Agent': 'daikome-apply-kyuryo-pw-ana',
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
    `select pg_get_functiondef('public.${k.sig}'::regprocedure) as d, md5(p.prosrc) as m from pg_proc p where p.oid = 'public.${k.sig}'::regprocedure`
  );
  if (!r.ok) throw new Error(k.na + ' を 読み戻せない: ' + r.status);
  const row = (r.body && r.body[0]) || {};
  return { d: row.d || '', m: row.m || '' };
}
function dasu(kotoba, kz) {
  kz.aru.forEach((x) =>
    console.log('  ' + kotoba + ' ' + (x.ok ? '在り' : '★無し★') + '  ' + x.x + '  … ' + x.w)
  );
  kz.nai.forEach((x) =>
    console.log('  ' + kotoba + ' ' + (x.ok ? '無し' : '★在る★') + '  ' + x.x + '  … ' + x.w)
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
  const blocks = KANSUU.map((k) => kiridasu(fs.readFileSync(path.join(ROOT, k.file), 'utf8'), k));
  let mon = 0;
  for (let i = 0; i < KANSUU.length; i++) {
    const k = KANSUU[i];
    const y = await yomimodosu(ref, t.token, k);
    console.log('\n■ ' + k.na + '  md5(前)=' + y.m);
    dasu('前', kazoeru(y.d, k));
    const bm = honbunMd5(blocks[i]);
    if (bm !== k.ato) {
      console.error('  ★門★ 当てる 塊の md5 ' + bm + ' が 決めた 版（' + k.ato + '）と 違う');
      mon++;
    }
    if (y.m !== k.mae && y.m !== k.ato) {
      console.error(
        '  ★門★ 倉庫の 今の md5 が 前の 版でも 直した 版でも ない＝別の 版が 入っている'
      );
      mon++;
    }
  }
  if (mon) {
    console.error('\nNG: md5 の 門で 止めた（' + mon + '）。当てていない');
    process.exit(6);
  }
  if (!ateru) {
    console.log('\n見るだけ（当てるには --ateru）');
    return;
  }
  // ★4桁の 件（2026-10-20）の 後は この 道具で 当てない★（pw_miss の 列が 在る 倉庫に 古い 形を 運ばない・対立役 直2）
  //   当てるのは scripts/apply-kyuryo-pw-4keta.mjs（列・窓・関数 6本を 1つの 取引で・md5 の 門つき）
  {
    const c = await runSql(
      ref,
      t.token,
      "select count(*)::int as n from information_schema.columns where table_schema = 'daikome' and table_name = 'dk_kyuryo_pub' and column_name = 'pw_miss'"
    );
    if (!c.ok || !c.body || !c.body[0] || c.body[0].n !== 0) {
      console.error(
        'NG: この 倉庫は 4桁の 件が 入って いる（または 列を 確かめられない）。scripts/apply-kyuryo-pw-4keta.mjs で 当てて ください'
      );
      process.exit(7);
    }
  }
  const r = await runSql(ref, t.token, 'begin;\n' + blocks.join('\n') + '\ncommit;');
  if (!r.ok) {
    console.error(
      'NG: 当てられなかった（1つの 取引なので 1本も 変わっていない筈） ' +
        r.status +
        ' ' +
        JSON.stringify(r.body).slice(0, 300)
    );
    process.exit(4);
  }
  console.log('\n当てた時刻: ' + new Date().toISOString());
  let ng = 0;
  for (const k of KANSUU) {
    const y = await yomimodosu(ref, t.token, k);
    console.log('\n■ ' + k.na + '  md5(後)=' + y.m);
    const ato = kazoeru(y.d, k);
    dasu('後', ato);
    if (!ato.ok) ng++;
  }
  console.log('\nKAKUNIN: ' + (ng ? '★NG★ ' + ng + '本' : 'OK'));
  if (ng) process.exit(5);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error('NG: ' + (e && e.message ? e.message : e));
    process.exit(1);
  });
}
