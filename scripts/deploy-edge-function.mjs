// ============================================================
// scripts/deploy-edge-function.mjs
// ★倉庫の 関数（Edge Function）を 配る★ 2026-09-29
//
//   ★なぜ 要るか（2026-09-29 に 数えた）★
//     関数は ★repo に push しても 配られない★。
//     実測: `dk-sync-jobs` は 本番 版15／テスト 版5 で
//     ★どちらも 2026-09-11 から 更新なし★ だった。
//     ＝★「入った」と「使える」は 別★。直しても 配らなければ 客には 届かない。
//     supabase CLI は 手元に 入っていない ので Management API で 配る。
//
//   使い方:
//     node scripts/deploy-edge-function.mjs --probe dk-sync-jobs   … 今の版を 見るだけ
//     node scripts/deploy-edge-function.mjs dk-sync-jobs           … 配る
//
//   ▼安全のしくみ
//     ・向き先は ★js/dk-config.js から読む★（このrepoの向き先以外には 配らない）
//     ・配るのは ★git が 持っている 中身★（★手元の 書きかけを 配らない★）
//       ＝ `git show HEAD:<path>` で 取り出す。未commit が 在れば ★止める★
//     ・配る前と 後の ★版と 更新時刻★ を 出す（上がったかを 目でなく 機械で）
//     ・verify_jwt は ★今の 設定を そのまま 引き継ぐ★（勝手に 開けない／閉じない）
//   ▼鍵は %TEMP% のファイルから読む。画面に出さない。
// ============================================================
/* eslint-env node */
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readToken, whereWeLooked } from './db-token.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function projectRef() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'dk-config.js'), 'utf8');
  const m = src.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  if (!m) throw new Error('js/dk-config.js から 向き先が 読めない');
  return m[1];
}

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });

async function api(token, ref, suffix, init) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}${suffix}`, {
    ...(init || {}),
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'daikome-deploy',
      ...((init && init.headers) || {}),
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(res.status + ' ' + body.slice(0, 400));
  try {
    return JSON.parse(body);
  } catch (_) {
    return {};
  }
}

const ima = (token, ref, slug) => api(token, ref, `/functions/${slug}`);

async function main() {
  const args = process.argv.slice(2);
  const slug = args.filter((a) => !a.startsWith('--'))[0];
  if (!slug) throw new Error('関数の 名前を 渡す（例: dk-sync-jobs）');

  const kagi = readToken();
  if (!kagi || !kagi.token) {
    throw new Error('鍵が見つからない（探した所: ' + whereWeLooked().join(' / ') + '）');
  }
  const token = kagi.token;
  const ref = projectRef();
  console.log(`向き先: ${ref}  /  鍵: ${kagi.from}（中身は出さない）`);

  const mae = await ima(token, ref, slug);
  console.log(
    `いまの ${slug}: 版=${mae.version}  更新=${new Date(mae.updated_at).toISOString().slice(0, 16)}  verify_jwt=${mae.verify_jwt}`
  );

  const dir = `supabase/functions/${slug}`;
  const files = git('ls-files', dir)
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
  if (!files.length) throw new Error(`git に ${dir} の ファイルが 無い`);

  // ★手元の 書きかけを 配らない★
  const yogore = git('status', '--porcelain', '--', dir).trim();
  if (yogore) {
    console.log('★未commit が 在る（配らない）★\n' + yogore);
    throw new Error('先に commit する（配るのは git が 持っている 中身だけ）');
  }

  if (args.includes('--probe')) {
    console.log('\n配る 予定の ファイル:');
    files.forEach((f) => console.log('   ' + f + '  ' + git('show', `HEAD:${f}`).length + ' B'));
    console.log('\nPROBE RESULT: OK（何も 配っていない）');
    return;
  }

  const fd = new FormData();
  fd.append(
    'metadata',
    JSON.stringify({
      name: slug,
      entrypoint_path: `${dir}/index.ts`,
      verify_jwt: mae.verify_jwt, // ★今の 設定を そのまま★
    })
  );
  for (const f of files) {
    const body = git('show', `HEAD:${f}`);
    fd.append('file', new Blob([body], { type: 'application/typescript' }), f);
  }

  await api(token, ref, `/functions/deploy?slug=${encodeURIComponent(slug)}`, {
    method: 'POST',
    body: fd,
  });

  const ato = await ima(token, ref, slug);
  console.log(
    `\n配った あと: 版=${ato.version}  更新=${new Date(ato.updated_at).toISOString().slice(0, 16)}  状態=${ato.status}`
  );
  if (!(Number(ato.version) > Number(mae.version))) {
    console.log('★版が 上がっていない＝配られていない★');
    process.exitCode = 1;
    return;
  }
  console.log('DEPLOY RESULT: OK');
}

main().catch((e) => {
  console.error('NG: ' + e.message);
  process.exitCode = 1;
});
