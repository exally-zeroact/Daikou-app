// ============================================================
// scripts/apply-kyuryo-get.mjs
// ★給料の 本人リンクの 倉庫の 関数 dk_kyuryo_get ★1本だけ★ を 当てる★ 2026-10-02
//
//   ★なぜ 専用の 道具か★
//     SQL の 門（sql-guard.mjs）は 09-29 から ★関数を 作る SQL を 通さない★（中身を 読めない）。
//     門を 緩めると 他の 全部の SQL にも 穴が 開く。⇒ ★門は そのまま★、
//     ★この 1本だけ★ を 字で 切り出して 当てる 道具を 別に 作った。
//
//   ★守り★
//     ・SQL ファイルから ★create or replace function public.dk_kyuryo_get(…) … $fn$;★ だけ 切り出す
//       （pw_set／verify／grant は 当てない＝今回 変えていない）
//     ・切り出した 字に ★別の 文が 紛れていない★ か 見る（$fn$ の 外に ; が 無い・drop/delete 等が 無い）
//     ・向き先は js/dk-config.js（この repo の 倉庫 以外には 当たらない）
//     ・★本番は --honban を 付けた 時だけ★
//     ・当てた 後 ★倉庫に 入った 関数の 字を 読み戻して★ 直した 字が 在るか 数える（KAKUNIN）
//
//   使い方:
//     node scripts/apply-kyuryo-get.mjs            … 見るだけ（今 倉庫に 入っている 関数を 数える）
//     node scripts/apply-kyuryo-get.mjs --ateru    … テスト線で 当てる
//     node scripts/apply-kyuryo-get.mjs --ateru --honban … 本番で 当てる
// ============================================================
/* eslint-env node */
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readToken, whereWeLooked } from './db-token.mjs';
import { HONBAN_REF, honbanNoTome } from './honban-tome.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_FILE = path.join(ROOT, 'supabase', 'apply-kyuryo-honnin-kansuu.sql');

// ★当てた 後に 在って ほしい 字／無くて ほしい 字★（倉庫から 読み戻した 関数で 数える）
export const ARU = [
  [
    'if p_pw is null or r.pw_hash is distinct from crypt(p_pw, r.pw_hash) then',
    '空（null）の パスワードは 必ず 違う（10-19 前は パスワード 無しで 開いた）',
  ],
  ['w.employee_id = r.employee_id', '勤務時間は 本人の 分だけ'],
  ['ed.shift_id, ed.toll_yen', '直しは 列を 名指し'],
  ['m.work_date, m.device_id, m.sales_yen', '手入力の日も 列を 名指し'],
  ['from daikome.dk_sales_settings ss', '売上から 何を 引くか（会社の 設定）を 返す（10-02 夜）'],
  ['m.actual_total_m, m.total_distance_m', '手入力の日の 距離を 返す（距離歩合・10-06）'],
  [
    'jsonb_agg(coalesce(hr.role, e.role',
    '乗った 人の 役だけ 返す・役は その 日の 記録（何日から・10-18）',
  ],
  ['from daikome.dk_hito_rireki h', '人の 変えた 記録を 読む（何日から・10-18）'],
  ["'rireki', (", '本人の 変えた 記録を 返す（何日から・10-18）'],
  ["'yakuRireki', (", '役割の 決まりの 変えた 記録を 返す（何日から・10-18）'],
  ["'uriageRireki', (", '売上から 引く 物の 変えた 記録を 返す（何日から・10-18）'],
  [
    'from daikome.dk_uriage_rireki u',
    '売上から 引く 物の 変えた 記録は 記録の 表から 読む（10-18）',
  ],
  ["'shimeRireki', (", '締めの 形の 変えた 記録を 返す（何日から・10-19）'],
  ['from daikome.dk_shime_rireki k', '締めの 形の 変えた 記録は 記録の 表から 読む（10-19）'],
  ['and a.employee_id = r.employee_id', '手当・控除は 本人の 分だけ（10-06）'],
  ["'taishoku'", '辞めた 人は 働いた 日を 含む 93 日 以内 だけ（会社の 売上を 見続けない・10-16）'],
  // ★'taishoku' の 字だけでは 62 日の 古い 版・p_to を 切らない 版・直しを 絞らない 版でも OK に なった（対立役 N7・10-17）★
  ['(p_to - p_from) > 93', '辞めた 人の 窓は 93 日まで（62 日の 古い 版で ない）'],
  ['select sh2.shift_id from daikome.dk_shifts sh2', '直し（edits）は 窓の 中の 勤務の 分だけ'],
  // 2026-10-17 司さん「向こうが URL 消すまで 見れないかん」＝手当・控除だけの 月も 通し、会社の 物と 手当・控除で 切る 日を 分ける（対立役 S2）
  ['select 1 from daikome.dk_pay_adjustments a', '辞めた 人は 手当・控除だけの 月も 通す'],
  [
    "p_to := least(p_to, (date_trunc('month', v_saigo_a)",
    '手当・控除は 最後に 働いたか 手当・控除が 在った 月の 次の 月の 末で 切る',
  ],
  [
    "v_kaisha_to := least(p_to, (date_trunc('month', v_saigo)",
    '会社の 物は 最後に 働いた 月の 次の 月の 末で 切る',
  ],
  [
    'v_kaisha_to := p_from - 1',
    '働いた 日が 無い 人は 会社の 物を 返さない（NULL で 全部 返る 穴を 塞ぐ）',
  ],
  [
    "and (sh.started_at at time zone 'Asia/Tokyo')::date between p_from and v_kaisha_to",
    '勤務（会社の 売上）は 会社の 物の 終わりの 日で 切る',
  ],
  ['m.work_date between p_from and v_kaisha_to', '手入力の 日も 会社の 物の 終わりの 日で 切る'],
];
export const NAI = [
  ['if r.pw_hash <> crypt(p_pw, r.pw_hash) then', 'null で 素通りする 古い 照らし方'],
  ['to_jsonb(ed)', '直しを 行ごと 丸ごと'],
  ['to_jsonb(w)', '勤務時間を 行ごと 丸ごと'],
  ['to_jsonb(m)', '手入力の日を 行ごと 丸ごと'],
];

// ★dk_kyuryo_get の 1本だけを 切り出す★（他の 文が 紛れていたら 投げる）
export function kiridasu(sql) {
  const s = String(sql).replace(/\r\n/g, '\n');
  const re =
    /create or replace function public\.dk_kyuryo_get\(p_token text, p_pw text, p_from date, p_to date\)\n[\s\S]*?\n\$fn\$;/;
  const m = s.match(re);
  if (!m) throw new Error('dk_kyuryo_get の 塊が 見つからない');
  const block = m[0];
  // $fn$ … $fn$ の 外側（頭の 宣言）に ; が 在れば 別の 文が 紛れている
  const a = block.indexOf('$fn$');
  const b = block.lastIndexOf('$fn$');
  if (a < 0 || a === b) throw new Error('$fn$ の 囲いが 読めない');
  const soto = block.slice(0, a) + block.slice(b + 4);
  if ((soto.match(/;/g) || []).length !== 1) throw new Error('囲いの 外に 別の 文が 在る');
  if (!/security definer/.test(block.slice(0, a))) throw new Error('security definer が 無い');
  if (!/set search_path = daikome, public, extensions/.test(block.slice(0, a)))
    throw new Error('search_path を 固定していない');
  // 中身に 書き換え／消す 字が 無い（この 関数は 読むだけ）
  const naka = block.slice(a + 4, b).replace(/--[^\n]*/g, '');
  const ng = naka.match(/\b(insert|delete|drop|truncate|alter|grant|revoke|create)\b/i);
  // ★update は 本人の 鍵の 行（続けて 間違えた 数）だけ★ 2026-10-20（4桁・3回で 止める）
  for (const u of naka.match(/\bupdate\b\s+\S+/gi) || []) {
    if (!/^update\s+daikome\.dk_kyuryo_pub$/i.test(u.trim()))
      throw new Error('読むだけの 関数に ' + u + ' が 在る');
  }
  if (ng) throw new Error('読むだけの 関数に ' + ng[0] + ' が 在る');
  return block;
}

export function kazoeru(def) {
  const d = String(def || '');
  const aru = ARU.map(([k, w]) => ({ k, w, ok: d.includes(k) }));
  const nai = NAI.map(([k, w]) => ({ k, w, ok: !d.includes(k) }));
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
      'User-Agent': 'daikome-apply-kyuryo-get',
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

async function yomimodosu(ref, token) {
  const r = await runSql(
    ref,
    token,
    "select pg_get_functiondef('public.dk_kyuryo_get(text,text,date,date)'::regprocedure) as d"
  );
  if (!r.ok)
    throw new Error(
      '関数を 読み戻せない: ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200)
    );
  return (r.body && r.body[0] && r.body[0].d) || '';
}

function dasu(k) {
  k.aru.forEach((x) => console.log('  ' + (x.ok ? '在り' : '★無し★') + '  ' + x.k + '  … ' + x.w));
  k.nai.forEach((x) => console.log('  ' + (x.ok ? '無し' : '★在る★') + '  ' + x.k + '  … ' + x.w));
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
  // ★本番の 止め★ 判じは scripts/honban-tome.mjs の 1か所（白名簿・知らない 倉庫も 止める・10-17）。--ateru の 時は 倉庫に 届く 前に 止める
  const tome = honbanNoTome(ref, process.argv.slice(2), !ateru);
  if (tome) {
    console.error(tome);
    process.exit(3);
  }
  const basho = ref === HONBAN_REF ? '★本番★' : 'テスト';
  console.log('向き先: ' + basho + ' ' + ref + ' ／ 鍵: ' + t.from);

  console.log('\n■ 当てる 前（倉庫に 今 入っている 関数）');
  const mae = kazoeru(await yomimodosu(ref, t.token));
  dasu(mae);
  if (!ateru) {
    console.log('\n見るだけ（当てるには --ateru）。KAKUNIN: ' + (mae.ok ? 'OK' : 'まだ'));
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
  const block = kiridasu(fs.readFileSync(SQL_FILE, 'utf8'));
  const r = await runSql(ref, t.token, block);
  if (!r.ok) {
    console.error(
      '\nNG: 当てられなかった ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 300)
    );
    process.exit(4);
  }
  console.log('\n■ 当てた 後（倉庫から 読み戻した 関数）');
  const ato = kazoeru(await yomimodosu(ref, t.token));
  dasu(ato);
  console.log('\nKAKUNIN: ' + (ato.ok ? 'OK' : '★NG★'));
  if (!ato.ok) process.exit(5);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error('NG: ' + (e && e.message ? e.message : e));
    process.exit(1);
  });
}
