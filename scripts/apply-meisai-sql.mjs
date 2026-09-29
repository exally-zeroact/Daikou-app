// ============================================================
// scripts/apply-meisai-sql.mjs
// ★請求明細(daikou.meisai)だけに 足すだけの SQL を 当てる★ 2026-09-29
//
//   ★なぜ 別の 道具に したか★
//     ふつうの scripts/apply-supabase-sql.mjs は
//     ★daikome の 部屋の dk_ で 始まる 棚しか 通さない★（他アプリを 触らない ため）。
//     それは ★正しい★ので 1文字も 緩めない。
//     だが `daikou.meisai` の `dk_ref` は ★ダイコメが 書いた 鍵★で、
//     それを 守る 索引を 張るのは ★ダイコメの 仕事★。
//     ⇒ ★門は 同じ物を 借りて（scripts/sql-guard.mjs）、部屋と 棚だけ 変えた★
//       専用の 道具を 1本 立てた。こちらは ★meisai 以外 何も 触れない★。
//
//   ★請求書アプリの repo で やらない 訳★
//     `C:\Users\zeroa\daikou-seikyu-test` の CLAUDE.md に
//     ★「ここの倉庫は DB-test。本番の倉庫を見てはいけない」★ と 書いてある。
//     本番の 複製は 手元に 無い。⇒ 本番へ 当てられない。
//
//   使い方（★読むだけの 確かめ★→★当てる★）:
//     node scripts/apply-meisai-sql.mjs --probe
//     node scripts/apply-meisai-sql.mjs supabase/apply-meisai-dkref-index.sql
//
//   ▼安全のしくみ（どれか1つでも 落ちたら ★1文字も 当てない★）
//     ・向き先は ★js/dk-config.js から読む★（このrepoの向き先以外には当たらない）
//     ・★ファイル名は supabase/apply-meisai-*.sql だけ★（他の SQL を 巻き込まない）
//     ・門番 scripts/sql-guard.mjs を ★部屋=daikou / 棚=meisai★ で 通す
//       ＝消す/書き換える 文は 通さない・meisai 以外の 棚は 通さない
//     ・当てた後に ★索引の 一覧を 出す★（入ったかを 目でなく 機械で）
//   ▼鍵は %TEMP% のファイルから読む。画面に出さない。
// ============================================================
/* eslint-env node */
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guard } from './sql-guard.mjs';
import { readToken, whereWeLooked } from './db-token.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEYA = 'daikou'; // 触ってよい部屋
const TANA = 'meisai'; // 触ってよい棚（前方一致）
const NAMAE = /^supabase[\\/]apply-meisai-[\w-]+\.sql$/; // 当ててよいファイル名

function projectRef() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'dk-config.js'), 'utf8');
  const m = src.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  if (!m) throw new Error('js/dk-config.js から 向き先が 読めない');
  return m[1];
}

async function toi(token, ref, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // ★User-Agent が 無いと Cloudflare が 1010 で 弾く（2026-09 実測）★
      'User-Agent': 'daikome-meisai-sql',
    },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(res.status + ' ' + body.slice(0, 300));
  try {
    return JSON.parse(body);
  } catch (_) {
    return [];
  }
}

const sakuin = (token, ref) =>
  toi(
    token,
    ref,
    "select indexname, indexdef from pg_indexes where schemaname='daikou' and tablename='meisai' order by indexname"
  );

async function main() {
  const args = process.argv.slice(2);
  const kagi = readToken();
  if (!kagi || !kagi.token) {
    throw new Error('鍵が見つからない（探した所: ' + whereWeLooked().join(' / ') + '）');
  }
  const token = kagi.token;
  const ref = projectRef();
  console.log(`向き先: ${ref}  /  鍵: ${kagi.from}（中身は出さない）`);
  console.log(`触ってよい: ${HEYA}.${TANA}*  だけ`);

  const ima = await sakuin(token, ref);
  console.log(`いま ${HEYA}.${TANA} の 索引は ${ima.length} 本`);
  ima.forEach((x) => console.log('   ' + x.indexname));

  const files = args.filter((a) => !a.startsWith('--'));
  if (args.includes('--probe') || !files.length) {
    console.log('\nPROBE RESULT: OK（何も当てていない）');
    console.log('使い方: node scripts/apply-meisai-sql.mjs supabase/apply-meisai-<なにか>.sql');
    return;
  }

  // ─── 門番（1つでも 落ちたら 1文字も 当てない）───────────
  let tomatta = false;
  const tabas = [];
  for (const f of files) {
    const rel = path.relative(ROOT, path.resolve(ROOT, f)).replace(/\\/g, '/');
    console.log(`\n■ ${rel}`);
    if (!NAMAE.test(rel) && !NAMAE.test(rel.replace(/\//g, path.sep))) {
      console.log('  ✗ ★名前が supabase/apply-meisai-*.sql では ない★');
      tomatta = true;
      continue;
    }
    const sql = fs.readFileSync(path.resolve(ROOT, f), 'utf8');
    // ★madoPublic:false★ この道具は 棚=meisai なので、窓(view)を public に 許すと
    //   ★public.meisai（事務所が 読む 素通しの 窓）の 差し替えが 名前として 当たってしまう★。
    //   この道具に 窓を 配る 用は 無い ので 一律で 止める（2026-09-29）。
    const g = guard(sql, { room: HEYA, prefix: TANA, madoPublic: false });
    console.log(`  触る棚: ${g.tables.join(', ') || '(なし)'}`);
    if (!g.ok) {
      g.reasons.forEach((r) => console.log('  ✗ ' + r));
      tomatta = true;
      continue;
    }
    console.log('  ✓ 足すだけ（消す/書き換えるは無し・' + HEYA + '.' + TANA + ' だけ）');
    tabas.push({ rel, sql });
  }
  if (tomatta) {
    console.log('\nAPPLY RESULT: NG（門で 止めた・★1文字も 当てていない★）');
    process.exitCode = 1;
    return;
  }

  for (const t of tabas) {
    await toi(token, ref, t.sql);
    console.log(`\n適用: ${t.rel} → OK`);
  }

  const ato = await sakuin(token, ref);
  console.log(`\n― 当てた後の 索引 ${ato.length} 本 ―`);
  ato.forEach((x) => console.log('   ' + x.indexname + '  ' + x.indexdef.slice(0, 120)));
  console.log('\nAPPLY RESULT: OK');
}

main().catch((e) => {
  console.error('NG: ' + e.message);
  process.exitCode = 1;
});
