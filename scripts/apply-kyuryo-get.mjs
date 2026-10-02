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

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_FILE = path.join(ROOT, 'supabase', 'apply-kyuryo-honnin-kansuu.sql');
const HONBAN_REF = 'tnfwipbgfgjaymlszeid';

// ★当てた 後に 在って ほしい 字／無くて ほしい 字★（倉庫から 読み戻した 関数で 数える）
export const ARU = [
  ['w.employee_id = r.employee_id', '勤務時間は 本人の 分だけ'],
  ['ed.shift_id, ed.toll_yen', '直しは 列を 名指し'],
  ['m.work_date, m.device_id, m.sales_yen', '手入力の日も 列を 名指し'],
  ['from daikome.dk_sales_settings ss', '売上から 何を 引くか（会社の 設定）を 返す（10-02 夜）'],
];
export const NAI = [
  ['to_jsonb(ed)', '直しを 行ごと 丸ごと'],
  ['to_jsonb(w)', '勤務時間を 行ごと 丸ごと'],
  ['to_jsonb(m)', '手入力の日を 行ごと 丸ごと'],
];

// ★dk_kyuryo_get の 1本だけを 切り出す★（他の 文が 紛れていたら 投げる）
export function kiridasu(sql) {
  const s = String(sql).replace(/\r\n/g, '\n');
  const re = /create or replace function public\.dk_kyuryo_get\(p_token text, p_pw text, p_from date, p_to date\)\n[\s\S]*?\n\$fn\$;/;
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
  const ng = naka.match(/\b(insert|update|delete|drop|truncate|alter|grant|revoke|create)\b/i);
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
  if (!r.ok) throw new Error('関数を 読み戻せない: ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  return (r.body && r.body[0] && r.body[0].d) || '';
}

function dasu(k) {
  k.aru.forEach((x) => console.log('  ' + (x.ok ? '在り' : '★無し★') + '  ' + x.k + '  … ' + x.w));
  k.nai.forEach((x) => console.log('  ' + (x.ok ? '無し' : '★在る★') + '  ' + x.k + '  … ' + x.w));
}

async function main() {
  const args = process.argv.slice(2);
  const ateru = args.includes('--ateru');
  const honban = args.includes('--honban');
  const t = readToken();
  if (!t) {
    console.error('NG: 鍵が無い（探した所: ' + whereWeLooked().join(' / ') + '）');
    process.exit(2);
  }
  const ref = readProjectRef();
  const basho = ref === HONBAN_REF ? '★本番★' : 'テスト';
  console.log('向き先: ' + basho + ' ' + ref + ' ／ 鍵: ' + t.from);

  console.log('\n■ 当てる 前（倉庫に 今 入っている 関数）');
  const mae = kazoeru(await yomimodosu(ref, t.token));
  dasu(mae);
  if (!ateru) {
    console.log('\n見るだけ（当てるには --ateru）。KAKUNIN: ' + (mae.ok ? 'OK' : 'まだ'));
    return;
  }
  if (ref === HONBAN_REF && !honban) {
    console.error('\nNG: 向き先が 本番。本番に 当てるのは --honban を 付けた 時だけ');
    process.exit(3);
  }
  const block = kiridasu(fs.readFileSync(SQL_FILE, 'utf8'));
  const r = await runSql(ref, t.token, block);
  if (!r.ok) {
    console.error('\nNG: 当てられなかった ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 300));
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
