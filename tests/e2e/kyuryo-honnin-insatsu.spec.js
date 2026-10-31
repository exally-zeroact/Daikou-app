// ============================================================
// ★★本人の 明細の「📄 印刷 / 送る」＝PC は 新しい 窓・スマホは 保存★★ 2026-11-01（司さん 指示②）
//   見本＝daikou-seikyu exportInvoicePDF の !insatsuSumaho の 道（tests/e2e/insatsu-okuru-hitotsu.spec.js）
//   ・PC＝新しい 窓で PDF を 開く（印刷・保存は その 画面から）／窓を 止められたら 保存に 落ちる
//   ・スマホ（iPhone）・ホーム画面の アプリ＝保存（PDF の 画面が 開き 共有から LINE・プリント）
//   わざと壊す：insatsuSumaho を いつも true ⇒ ★赤★（PC で 窓が 開かない）／いつも false ⇒ ★赤★（iPhone で 保存されない）
//              窓が 開いた 後も 保存する ⇒ ★赤★（PC で 2本）／窓を 止められた 時に 保存しない ⇒ ★赤★
// ============================================================
const { test, expect, devices } = require('@playwright/test');
const { hiraku } = require('./honnin-harness');

test.use({ timezoneId: 'Asia/Tokyo' });

// tome＝窓を 止められた（window.open が null を 返す）
async function nise(page, tome) {
  await page.addInitScript((tome) => {
    window.__mado = [];
    window.__dl = [];
    HTMLAnchorElement.prototype.click = function () {
      window.__dl.push({ name: this.download, href: this.href });
    };
    window.open = function (u, t) {
      window.__mado.push({ u: String(u), t: String(t) });
      return tome ? null : { closed: false };
    };
  }, !!tome);
}
const kazu = (page) =>
  page.evaluate(() => ({ mado: window.__mado.length, dl: window.__dl.length }));

// 窓で 開いた blob の 中身が PDF か（型と 頭の 字）
async function madoNoPdf(page) {
  return page.evaluate(async () => {
    const r = await fetch(window.__mado[0].u);
    const b = await r.blob();
    const head = new TextDecoder().decode(new Uint8Array(await b.slice(0, 5).arrayBuffer()));
    return { type: b.type, head, size: b.size };
  });
}

test('★PC は 新しい 窓で PDF を 開く（ダウンロードだけに しない）★', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await nise(page, false);
  await hiraku(page);
  await page.click('#hnPdf');
  await expect.poll(() => page.evaluate(() => window.__mado.length), { timeout: 30000 }).toBe(1);
  const m = await page.evaluate(() => window.__mado[0]);
  expect(m.u).toMatch(/^blob:/);
  expect(m.t).toBe('_blank');
  const p = await madoNoPdf(page);
  expect(p.type).toBe('application/pdf');
  expect(p.head).toBe('%PDF-');
  await page.waitForTimeout(500);
  expect((await kazu(page)).dl, '★PC で 窓を 開いたのに 保存も した★').toBe(0);
  await expect(page.locator('#hnPdfAnnai')).toHaveText(
    'PDFを開きました（印刷・保存は その画面から）'
  );
});

// ★作り 途中に 押した 道（hnPdfTsukuru の .then から 出す）も PC は 窓★（設計前 対立役 注1 2026-11-01：
//   上の 1本は 作り済みの 道だけ。紙を 描く 道具を 4秒 遅らせて 作り終わる 前に 押す）
//   わざと壊す：.then の 道だけ 保存に する ⇒ ★赤★
test('★PC で 作り 途中に 押しても 出来たら 窓で 開く（保存しない）★', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await nise(page, false);
  await page.route('**/js/kami-egaku.js', async (r) => {
    await new Promise((ok) => setTimeout(ok, 4000));
    await r.continue();
  });
  await hiraku(page, undefined, undefined, true);
  await expect(page.locator('#hnPdf')).toBeEnabled({ timeout: 20000 });
  await page.click('#hnPdf');
  await expect(
    page.locator('#hnPdf'),
    '作り済みの 道を 通った（作り 途中に なっていない）'
  ).toHaveText('PDF作成中…');
  await expect.poll(() => page.evaluate(() => window.__mado.length), { timeout: 40000 }).toBe(1);
  await page.waitForTimeout(500);
  expect((await kazu(page)).dl, '★作り 途中の 道で 保存も した★').toBe(0);
  await expect(page.locator('#hnPdfAnnai')).toHaveText(
    'PDFを開きました（印刷・保存は その画面から）'
  );
});

test('★PC で 窓を 止められたら 保存に 落ちる★', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await nise(page, true);
  await hiraku(page);
  await page.click('#hnPdf');
  await expect.poll(() => page.evaluate(() => window.__dl.length), { timeout: 30000 }).toBe(1);
  const k = await kazu(page);
  expect(k.mado, '窓を 試していない').toBe(1);
  expect(await page.evaluate(() => window.__dl[0].name)).toMatch(/^給料明細_.*\.pdf$/);
  await expect(page.locator('#hnPdfAnnai')).toContainText('LINE');
});

test.describe('iPhone', () => {
  test.use({
    userAgent: devices['iPhone 13'].userAgent,
    viewport: devices['iPhone 13'].viewport,
    isMobile: true,
    hasTouch: true,
  });
  test('★スマホは 保存（PDF の 画面が 開く）・新しい 窓は 開かない★', async ({ page }) => {
    await nise(page, false);
    await hiraku(page);
    await page.click('#hnPdf');
    await expect.poll(() => page.evaluate(() => window.__dl.length), { timeout: 30000 }).toBe(1);
    await page.waitForTimeout(500);
    expect((await kazu(page)).mado, '★スマホで 新しい 窓を 開いた★').toBe(0);
  });
});

test('★ホーム画面の アプリは PC の 字でも 保存・窓は 開かない★', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
  });
  await nise(page, false);
  await hiraku(page);
  await page.click('#hnPdf');
  await expect.poll(() => page.evaluate(() => window.__dl.length), { timeout: 30000 }).toBe(1);
  await page.waitForTimeout(500);
  expect((await kazu(page)).mado, '★ホーム画面で 新しい 窓を 開いた★').toBe(0);
});
