// ============================================================
// scripts/apply-kyuryo-saihakkou.mjs
// ★給料の 本人リンクを 配る 倉庫の 関数 3本（一覧・作り直す・1人ぶん）を 当てる★ 2026-10-16 → 10-17
//
//   ★なぜ 専用の 道具か★（apply-kyuryo-get.mjs と 同じ 訳）
//     SQL の 門（sql-guard.mjs）は 関数を 作る SQL を 通さない。門は 緩めず、この 3本だけ 字で 切り出して 当てる。
//   ★10-17 に 変えた 事★ 司さん「向こうが URL 消すまで 見れないかん・退職者のページからでもURLの配付ができないかん」
//     ・dk_kyuryo_saihakkou … 辞めた 人にも 作り直せる（10-16 の「辞めた 人には 作り直さない」を 外した）
//     ・dk_kyuryo_haifu_hitori … 辞めた 人にも 1人ぶん 配れる（前は 今いる人だけ＝作り直した 後に 取り出せなかった・対立役 S1）
//     ・dk_kyuryo_haifu … 一覧に 辞めた 人も 出す（リンクを 持っている 人だけ・作るのは 今いる人だけ のまま）
//     見える 範囲は 本人の 関数 dk_kyuryo_get が 決める（辞めた 人は 働いたか 手当・控除が 在る 月だけ）
//
//   ★守り★
//     ・SQL の ファイルから ★その 関数の 塊だけ★ 切り出す（grant 等は 当てない・前から 在る）
//     ・切り出した 字に 別の 文が 紛れていない（$fn$ の 外に ; が 1つ だけ）・security definer・search_path 固定
//     ・中身に drop・truncate・alter・grant・revoke・create・delete が 無い。insert は dk_kyuryo_pub への on conflict do nothing だけ
//     ・向き先は js/dk-config.js・判じは scripts/honban-tome.mjs（白名簿・本番は --honban の 時だけ）
//     ・当てた 後 ★倉庫に 入った 関数の 字を 読み戻して★ 在って ほしい 字・無くて ほしい 字を 数える（KAKUNIN）
//
//   使い方:
//     node scripts/apply-kyuryo-saihakkou.mjs                 … 見るだけ
//     node scripts/apply-kyuryo-saihakkou.mjs --ateru         … テスト線で 当てる
//     node scripts/apply-kyuryo-saihakkou.mjs --ateru --honban … 本番で 当てる（本番の 手元で）
// ============================================================
/* eslint-env node */
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readToken, whereWeLooked } from './db-token.mjs';
import { HONBAN_REF, honbanNoTome } from './honban-tome.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const KANSUU = [
  {
    na: 'dk_kyuryo_saihakkou',
    sig: 'dk_kyuryo_saihakkou(uuid)',
    file: 'supabase/apply-kyuryo-haifu.sql',
    atama: 'create or replace function public.dk_kyuryo_saihakkou(p_employee_id uuid)',
    insertOk: false,
    ARU: [["'not_yours'", 'よその 会社の 人は 作り直さない']],
    NAI: [["'taishoku'", '辞めた 人を 断る 古い 版（10-16）']],
  },
  {
    na: 'dk_kyuryo_haifu_hitori',
    sig: 'dk_kyuryo_haifu_hitori(uuid)',
    file: 'supabase/apply-kyuryo-haifu-hitori.sql',
    atama: 'create or replace function public.dk_kyuryo_haifu_hitori(p_employee_id uuid)',
    insertOk: true,
    ARU: [["'not_yours'", 'よその 会社の 人は 配らない']],
    NAI: [
      ['coalesce(e.active, true) = true', '今いる人だけに 配る 古い 版（辞めた 人を 配れない）'],
    ],
  },
  {
    na: 'dk_kyuryo_haifu',
    sig: 'dk_kyuryo_haifu()',
    file: 'supabase/apply-kyuryo-haifu.sql',
    atama: 'create or replace function public.dk_kyuryo_haifu()',
    insertOk: true,
    ARU: [
      [
        'coalesce(e.active, true) as active, e.retired_on',
        '一覧に 辞めた 印を 返す（辞めた 人も 出す）',
      ],
      ['    and coalesce(e.active, true) = true\n  on conflict', '新しく 作るのは 今いる人だけ'],
    ],
    NAI: [],
  },
];

export function kiridasu(sql, k) {
  const s = String(sql).replace(/\r\n/g, '\n');
  const a0 = s.indexOf(k.atama + '\n');
  if (a0 < 0) throw new Error(k.na + ' の 塊が 見つからない');
  const owari = s.indexOf('\n$fn$;', a0);
  if (owari < 0) throw new Error(k.na + ' の 終わりが 見つからない');
  const block = s.slice(a0, owari + '\n$fn$;'.length);
  const a = block.indexOf('$fn$');
  const b = block.lastIndexOf('$fn$');
  if (a < 0 || a === b) throw new Error('$fn$ の 囲いが 読めない');
  const soto = block.slice(0, a) + block.slice(b + 4);
  if ((soto.match(/;/g) || []).length !== 1) throw new Error('囲いの 外に 別の 文が 在る');
  if (!/security definer/.test(block.slice(0, a))) throw new Error('security definer が 無い');
  if (!/set search_path = daikome, public, extensions/.test(block.slice(0, a)))
    throw new Error('search_path を 固定していない');
  const naka = block.slice(a + 4, b).replace(/--[^\n]*/g, '');
  const ng = naka.match(/\b(delete|drop|truncate|alter|grant|revoke|create)\b/i);
  if (ng) throw new Error(k.na + ' に ' + ng[0] + ' が 在る');
  const ins = naka.match(/\binsert\b[\s\S]*?;/gi) || [];
  if (ins.length && !k.insertOk) throw new Error(k.na + ' に insert が 在る');
  for (const i of ins) {
    if (
      !/insert into daikome\.dk_kyuryo_pub\b/i.test(i) ||
      !/on conflict[\s\S]*do nothing/i.test(i)
    )
      throw new Error(k.na + ' の insert が dk_kyuryo_pub の on conflict do nothing で ない');
  }
  return block;
}

export function kazoeru(def, k) {
  const d = String(def || '').replace(/\r\n/g, '\n');
  const aru = k.ARU.map(([x, w]) => ({ x, w, ok: d.includes(x) }));
  const nai = k.NAI.map(([x, w]) => ({ x, w, ok: !d.includes(x) }));
  return { aru, nai, ok: d.length > 0 && aru.every((x) => x.ok) && nai.every((x) => x.ok) };
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
      'User-Agent': 'daikome-apply-kyuryo-haifu',
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
    `select pg_get_functiondef('public.${k.sig}'::regprocedure) as d`
  );
  if (!r.ok) throw new Error(k.na + ' を 読み戻せない: ' + r.status);
  return (r.body && r.body[0] && r.body[0].d) || '';
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
  // ★本番の 止め★ 判じは scripts/honban-tome.mjs の 1か所（白名簿）。--ateru の 時は 倉庫に 届く 前に 止める
  const tome = honbanNoTome(ref, args, !ateru);
  if (tome) {
    console.error(tome);
    process.exit(3);
  }
  console.log(
    '向き先: ' + (ref === HONBAN_REF ? '★本番★' : 'テスト') + ' ' + ref + ' ／ 鍵: ' + t.from
  );
  // 当てる 前に 3本とも 切り出し、3本とも 読み戻す（途中まで 当たるのを 避ける）
  const blocks = KANSUU.map((k) => kiridasu(fs.readFileSync(path.join(ROOT, k.file), 'utf8'), k));
  for (const k of KANSUU) {
    console.log('\n■ ' + k.na);
    dasu('前', kazoeru(await yomimodosu(ref, t.token, k), k));
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
  // ★3本を 1つの 取引で 当てる★（1本目だけ 新しい版に なって 止まるのを 避ける・対立役 N2）
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
  let ng = 0;
  for (const k of KANSUU) {
    console.log('\n■ ' + k.na);
    const ato = kazoeru(await yomimodosu(ref, t.token, k), k);
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
