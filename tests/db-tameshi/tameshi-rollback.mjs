// テスト線の 倉庫だけ・必ず rollback で 終わる 問い合わせを 投げる（本番の 向き先なら 投げない）
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const { readToken } = await import(pathToFileURL(path.join(root, 'scripts', 'db-token.mjs')).href);
const src = fs.readFileSync(path.join(root, 'js', 'dk-config.js'), 'utf8');
const ref = src.match(/https:\/\/([a-z0-9]{20})\.supabase\.co/)[1];
if (ref === 'tnfwipbgfgjaymlszeid') throw new Error('本番には 投げない');
// 頭の 注釈（-- の 行）は 外して 見る・投げる
const q = fs
  .readFileSync(process.argv[3], 'utf8')
  .split(/\r?\n/)
  .filter((l) => !/^\s*--/.test(l))
  .join('\n');
if (!/^\s*begin;/i.test(q) || !/rollback;\s*$/i.test(q)) throw new Error('begin; … rollback; で 囲う 事');
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
console.log(r.status, ref.slice(0, 4) + '…', JSON.stringify(await r.json()));
