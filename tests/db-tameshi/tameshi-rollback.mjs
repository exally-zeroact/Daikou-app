// テスト線の 倉庫だけ・必ず rollback で 終わる 問い合わせを 投げる
//   ★向き先は 白名簿★（scripts/honban-tome.mjs の TEST_REF だけ＝本番も 知らない 倉庫も 投げない）2026-10-17
//   ★終わり値を 丸めない★ 2026-10-17：前は 倉庫が 誤り（400）を 返しても 終わり値 0 だった。
//     倉庫の 誤り＝4／結果が 0行（数える 表が 空＝何も 確かめて いない）＝6
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const { readToken } = await import(pathToFileURL(path.join(root, 'scripts', 'db-token.mjs')).href);
const { TEST_REF } = await import(
  pathToFileURL(path.join(root, 'scripts', 'honban-tome.mjs')).href
);
const src = fs.readFileSync(path.join(root, 'js', 'dk-config.js'), 'utf8');
const ref = src.match(/https:\/\/([a-z0-9]{20})\.supabase\.co/)[1];
if (ref !== TEST_REF)
  throw new Error('テストの 倉庫 以外には 投げない（' + ref.slice(0, 4) + '…）');
// 頭の 注釈（-- の 行）は 外して 見る・投げる
const q = fs
  .readFileSync(process.argv[3], 'utf8')
  .split(/\r?\n/)
  .filter((l) => !/^\s*--/.test(l))
  .join('\n');
if (!/^\s*begin;/i.test(q) || !/rollback;\s*$/i.test(q))
  throw new Error('begin; … rollback; で 囲う 事');
if (/\bcommit\b/i.test(q)) throw new Error('commit は 書かない');
const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + readToken().token,
    'Content-Type': 'application/json',
    'User-Agent': 'dk-tameshi',
  },
  body: JSON.stringify({ query: q }),
});
const body = await r.json().catch(() => null);
console.log(r.status, ref.slice(0, 4) + '…', JSON.stringify(body));
// ★process.exit で すぐ 終わらせない★（Windows の Node は 通信を 閉じている 途中だと 落ちて 終わり値 127 に なる）
if (!r.ok) {
  console.error('NG: 倉庫が 誤りを 返した（' + r.status + '）');
  process.exitCode = 4;
} else if (!Array.isArray(body) || body.length === 0) {
  console.error('NG: 結果が 0行（何も 確かめて いない）');
  process.exitCode = 6;
}
