// ============================================================
// ★★もう 配った リンク（印 openExternalBrowser=1 が 無い）を LINE の 中で 開いたら 印を 足して 開き直す★★ 2026-11-01
//   新しい リンクは haifuUrl が 印を 付ける（a250e4fb2）。前に 配った リンクは 印が 無い＝LINE の 中の ブラウザで 開き
//   PDF の 保存が 効かない 端末が 在る ⇒ kyuryo.html の hnGaibuWatasu が 印を 足して location.replace。
//   ★LINE が 外へ 渡すかは 実機では 未測定（見立て）★。ここで 見るのは うちの 頁の 動きだけ：
//     ・渡す 間は 倉庫（rest）も ログイン（auth）も 0回・login.html に 飛ばない（設計前 対立役 止1）
//     ・頁が 替わらなくても「ここで 見る」で その 場で 明細が 出る（止2）
//     ・c・henshu・# が 残る（URL の 型で 組む・注B1）／2回目は 渡さない（注B2）
//     ・印つき・LINE 以外は 何も しない
//   ★わざと壊して 赤（2026-11-01 手元 chromium 実測）★ 下の 3つ（設計前 対立役 注B3）
//     ① 起動の if を if (HONNIN && !hnGaibuWatasu()) { honninStart(); } else { に（渡す 時に else の ログインへ 落ちる）…… 1・2 番目が 赤
//     ② は 1 番目が 赤（# が 残らない）／③ は 1〜3 番目が 赤
//     ② URL の 型を やめ location.href + '&openExternalBrowser=1' に（# の 中に 印が 入る）
//     ③ UA の 判定を 常に 偽（return false）に
// ============================================================
const { test, expect } = require('@playwright/test');
const { EMP, getKotae } = require('./honnin-harness');

const LINE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.16.0';

test.use({ timezoneId: 'Asia/Tokyo' });

// 偽の 倉庫＋呼ばれた 物の 記録（印つきの 頁が 来る 前か 後か を 分ける）
async function kura(page) {
  const log = { mae: [], ato: [], docs: [] };
  let inTsuki = false;
  page.on('request', (r) => {
    const u = r.url();
    if (r.resourceType() === 'document') {
      log.docs.push(u);
      if (/openExternalBrowser=1/.test(u)) inTsuki = true;
      return;
    }
    if (/\/(rest|auth)\/v1\//.test(u)) (inTsuki ? log.ato : log.mae).push(u);
  });
  await page.route('**/rest/v1/rpc/dk_kyuryo_{verify,fuda,pw_set}', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, name: EMP.name }),
    })
  );
  await page.route('**/rest/v1/rpc/dk_kyuryo_get', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(getKotae()) })
  );
  await page.route('**/rest/v1/dk_**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  return log;
}

async function kamiMade(page) {
  await page.fill('#hnPw', '1234');
  await page.click('#hnGo');
  await expect(
    page.locator('#hnKami[data-hn-no]:not(.inv-loading) .sheet-pdf canvas').first(),
    '★明細の 紙が 出ません★'
  ).toBeVisible({ timeout: 30000 });
}

test.describe('LINE の 中', () => {
  test.use({ userAgent: LINE_UA });

  test('印なし⇒ 印を 足して 開き直す（c・henshu・# が 残る）・渡す 前は 倉庫も ログインも 0回', async ({
    page,
  }) => {
    const log = await kura(page);
    await page.goto('/kyuryo.html?t=TOK&henshu=1#a', { waitUntil: 'commit' });
    await page.waitForURL(/openExternalBrowser=1/, { timeout: 15000 });
    const u = new URL(page.url());
    expect(u.searchParams.get('t'), '★鍵が 落ちました★').toBe('TOK');
    expect(u.searchParams.get('henshu'), '★他の 引数が 落ちました★').toBe('1');
    expect(u.hash, '★# が 落ちたか 印が # に 入りました★').toBe('#a');
    expect(log.mae, '★渡す 前に 倉庫・ログインを 呼びました★').toEqual([]);
    await kamiMade(page);
    expect(page.url()).not.toMatch(/login\.html/);
    await expect(page.locator('#hnGaibu')).toHaveCount(0);
  });

  test('LINE が 頁を 替えない 時⇒「ここで 見る」で 入口が 出る・それまで 倉庫も ログインも 0回・login.html に 飛ばない', async ({
    page,
  }) => {
    const log = await kura(page);
    const watashita = [];
    // LINE が 開き直しを 横取りした 形＝印つきの 頁は 204（頁は 替わらない）
    await page.route(/kyuryo\.html\?.*openExternalBrowser=1/, (r) => {
      watashita.push(r.request().url());
      return r.fulfill({ status: 204, body: '' });
    });
    await page.goto('/kyuryo.html?t=TOK&c=C1', { waitUntil: 'commit' });
    await expect(page.locator('#hnGaibu'), '★外へ 渡す 案内が 出ません★').toBeVisible();
    await page.waitForTimeout(1500);
    expect(watashita.length, '★印を 足して 開き直していません★').toBe(1);
    const w = new URL(watashita[0]);
    expect(w.searchParams.get('c'), '★初回コードが 落ちました★').toBe('C1');
    expect(log.mae, '★渡す 間に 倉庫・ログインを 呼びました★').toEqual([]);
    expect(page.url()).not.toMatch(/login\.html/);
    await page.click('#hnGaibuKoko');
    await expect(page.locator('#hnGaibu')).toHaveCount(0);
    await expect(page.locator('#hnPw'), '★「ここで 見る」で 入口が 出ません★').toBeVisible({
      timeout: 15000,
    });
  });

  test('2回目は 渡さない（印が 落ちても 回り続けない）', async ({ page }) => {
    await kura(page);
    await page.route(/kyuryo\.html\?.*openExternalBrowser=1/, (r) =>
      r.fulfill({ status: 204, body: '' })
    );
    await page.goto('/kyuryo.html?t=TOK', { waitUntil: 'commit' });
    await expect(page.locator('#hnGaibu')).toBeVisible();
    await page.waitForTimeout(1000);
    await page.goto('/kyuryo.html?t=TOK');
    await expect(page.locator('#hnPw'), '★2回目も 渡しました★').toBeVisible({ timeout: 15000 });
    await expect(page.locator('#hnGaibu')).toHaveCount(0);
  });

  test('印つき⇒ 開き直さない', async ({ page }) => {
    const log = await kura(page);
    await page.goto('/kyuryo.html?t=TOK&openExternalBrowser=1');
    await kamiMade(page);
    expect(log.docs.length, '★印つきなのに 開き直しました★').toBe(1);
    await expect(page.locator('#hnGaibu')).toHaveCount(0);
  });
});

test('LINE 以外⇒ 印なしでも 開き直さない', async ({ page }) => {
  const log = await kura(page);
  await page.goto('/kyuryo.html?t=TOK');
  await kamiMade(page);
  expect(log.docs.length, '★LINE 以外で 開き直しました★').toBe(1);
  await expect(page.locator('#hnGaibu')).toHaveCount(0);
});
