'use strict';
// ============================================================
// ★倉庫の住所(js/dk-config.js)は 古い物を先に返してはいけない★ 2026-08-21
//
//   ▼実際に起きた事（本番の倉庫のログ・2026-08-21）
//     referer=https://daikou-app-test.vercel.app から
//     POST /rest/v1/rpc/dk_check_device_license が
//     14:40:33 / 14:42:33 / 14:48:15（Android）に届いていた。
//     ＝ ★テスト版のメーターが 本番の倉庫を触っていた★。
//     原因は sw.js が dk-config.js を staleWhileRevalidate（＝まず古い物を返す）で
//     配っていた事。テスト線は 2026-08-05 23:27 まで本番の倉庫を指しており、
//     ★その古い紙がスマホの中で生き続けた★。
//
//   ▼固定する事
//     1. dk-config.js 専用の分岐が在る
//     2. その分岐が ★fetch を先にやる（network-first）★・no-store で取る
//     3. ★取れなかった時だけ cache を使う★（完全オフライン前提を壊さない）
//     4. その分岐は ★既定のSWRより前★に在る（後ろだと一生通らない）
// ============================================================
const fs = require('fs');
const path = require('path');

const SW = fs.readFileSync(path.resolve(__dirname, '..', '..', 'sw.js'), 'utf8');

describe('★倉庫の住所は溜め込んだ物を先に出さない★', () => {
  const at = SW.indexOf("req.url.indexOf('/js/dk-config.js')");

  it('dk-config.js 専用の分岐が在る', () => {
    expect(at, '★dk-config.js の分岐が無い＝古い住所で動く★').toBeGreaterThan(-1);
  });

  it('★ネットを先に見る（fetch が caches.match より前）★', () => {
    const block = SW.slice(at, at + 900);
    expect(block).toMatch(/fetch\(req,\s*\{\s*cache:\s*'no-store'\s*\}\)/);
    expect(block.indexOf('fetch(req')).toBeLessThan(block.indexOf('caches.match'));
  });

  it('★取れなかった時だけ 溜め込んだ物を使う（圏外でも止めない）★', () => {
    const block = SW.slice(at, at + 900);
    expect(block).toMatch(/\.catch\(/);
    expect(block).toMatch(/caches\.match\(req\)/);
  });

  it('★既定のSWRより前に在る（後ろだと一生通らない）★', () => {
    const swrAt = SW.lastIndexOf('e.respondWith(staleWhileRevalidate(req));');
    expect(swrAt).toBeGreaterThan(-1);
    expect(at, '★dk-config の分岐が既定のSWRより後ろにある★').toBeLessThan(swrAt);
  });

  it('圏外で入れ直せるように 先読みの一覧には残す', () => {
    expect(SW).toContain("'/js/dk-config.js',");
  });
});
