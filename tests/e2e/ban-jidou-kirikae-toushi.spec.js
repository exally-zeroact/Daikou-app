// tests/e2e/ban-jidou-kirikae-toushi.spec.js
// ============================================================
// ★服(sw.js)を ★本当に★ すり替えて、触らずに 画面が 読み直すか（2026-09-28）★
//
//   司さん「タスクキルせな バージョンが 更新されないのを どうにかしろ」
//
//   ban-jidou-kirikae.spec.js は ★判定の 関数★ だけ を 見る。
//   ここは ★通し★＝
//     服を 差し替える → install → skipWaiting → activate → claim
//     → controllerchange → ★画面が 自分で 読み直す★ → 新しい 棚が 出来る
//   までを 1本で 通す。★判定が 正しくても 配線が 切れていたら 動かない★ため。
//
// ★やり方（1回 遠回りして たどり着いた）★
//   はじめ Playwright の context.route で すり替えようとして ★出来なかった★。
//   ★route は 登録の 1回目の sw.js しか 横取りしない★
//   （reg.update() の 取りに行きは 服自身が 出すので 通らない。
//     実測：横取り 回数 1 のまま・installing/waiting とも false）。
//   ⇒ 「機械では 無理」と 書きかけたが ★それは 間違い★だった。
//     ★この試験が 自分で 網（http サーバ）を 立てて /sw.js だけ 覚えの上で 返す★ ので できる。
//     ★repo の ファイルは 1バイトも 触らない★（落ちても 汚れない）。
//
// ★実測（2026-09-28）★
//   ・何も せず 待つ ………………… ★304 秒★で 自分で 読み直した（5分ごとの 見に行き）
//   ・アプリに 戻る（裏→表）……… ★3 秒★（司さんが 実際に する 動き）
//   ⇒ この紙は 速い方（裏→表）で 見る。遅い方は CI が 長く なるので 置かない。
//
// ★わざと壊して 赤に なる事を 見た (2026-09-28)★
//   index.html の controllerchange の 中の `_atotemawashi('controllerchange');` を 消す
//     ⇒ 読み直しが 来ず ★赤★。戻すと 緑。
// ============================================================
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const ROOT = path.join(__dirname, '..', '..');
const PORT = 3199;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
};

test.use({ viewport: { width: 390, height: 844 } });

test('服を 新しくして アプリに 戻ると ★タスクキルせずに★ 自分で 読み直す', async ({ page }) => {
  let swBody = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  expect(swBody, 'sw.js に 刻印が 無い＝前提が 崩れている').toMatch(/const CACHE_NAME = '[^']+';/);

  // ★「無い時に 黙って 緑」の 見張り（tests/unit/nai-toki-midori.test.js）に
  //   引っかからない 書き方に する＝★existsSync の すぐ後ろに 素の return; を 置かない★。
  //   ここの 404 は 「試験を 飛ばす」では なく ★網の 返事★ だが、
  //   ★機械には 見分けが つかない★ので ★例外を 足さずに 形を 変える★。
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent((req.url || '/').split('?')[0]);
    if (u === '/sw.js') {
      res.writeHead(200, {
        'Content-Type': MIME['.js'],
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      });
      res.end(swBody);
    } else {
      const rel = u === '/' ? 'index.html' : u.replace(/^\/+/, '');
      const f = path.join(ROOT, rel);
      const aru = f.startsWith(ROOT) && fs.existsSync(f) && !fs.statSync(f).isDirectory();
      if (!aru) {
        res.writeHead(404).end('nai');
      } else {
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(f)] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        fs.createReadStream(f).pipe(res);
      }
    }
  });

  try {
    await new Promise((r) => srv.listen(PORT, r));

    let yominaoshi = 0;
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) yominaoshi++;
    });
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem('sensor_permission_active', '1');
        sessionStorage.setItem('sensorGranted', '1');
        localStorage.setItem('tutorial_done', '1');
        localStorage.setItem('daikome_training_consent', 'dismissed');
      } catch (_) {
        /* ignore */
      }
    });

    await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 60000 });
    const yomi1 = yominaoshi;
    expect(
      await page.evaluate(() =>
        typeof window.__swYominaoshiteYoiKa === 'function' ? window.__swYominaoshiteYoiKa() : null
      ),
      '前提: 新しい code が 入っていない'
    ).toEqual({ ok: true, wake: 'business_nashi' });

    // ★服を すり替える（ここから 画面には 一切 触らない）★
    swBody = swBody.replace(
      /const CACHE_NAME = '[^']+';/,
      "const CACHE_NAME = 'daikome-swaptest';"
    );

    // ★司さんが 実際に する 動き＝アプリを 裏に やって 戻す★
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await expect
      .poll(() => yominaoshi, {
        timeout: 40000,
        message: '★服を 新しくしても 画面が 読み直さない＝タスクキルしないと 変わらない★',
      })
      .toBeGreaterThan(yomi1);

    await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 40000 });
    await expect
      .poll(
        async () => {
          try {
            return await page.evaluate(() => caches.keys());
          } catch (_) {
            return [];
          }
        },
        { timeout: 40000, message: '★新しい 棚が 出来ていない★' }
      )
      .toContain('daikome-swaptest');
  } finally {
    await new Promise((r) => srv.close(r));
  }
});
