// ============================================================
// ★★見張り：事務所の 給料＝月と 名前で 選んで、その人の 明細を PDFで 見る★★ 2026-10-03
//
//   司さん「代行請求書アプリの請求書ページと同じ見せ方で月と名前で選んでPDFで見れるように」
//          「ごちゃごちゃしとる スッキリさせろ」
//   ★前★ 全員の 明細が 縦に 並び、箱 2つ・ボタン 6つ。1人 見るには 探して チェック。
//   ★今★ 月の 箱に「名前」の 選ぶ欄。選ぶと その人の 明細だけ。出す 所は 箱 1つ・表の ボタン 1つ。
//         まとめた 表（月ごと・日ごと・個別・年ごと）は 畳んで しまう（消していない）。
//
//   ★押す物の一覧（先に書く）★ 1. 名前の 選ぶ欄 2.「明細を PDFで 見る」 3. 全員に 戻す
//
//   ★★わざと壊して 赤に なるのを 見た（2026-10-03 実測）★★
//     renderSlips の「名前で 選んでいれば その人だけ」を 外す ⇒ ★赤★（明細が 3枚の まま）
//     printAll の「名前で 選んでいれば その人だけ」を 外す ⇒ ★赤★（3人ぶん）
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

test('★名前を 選ぶと その人の 明細だけ・PDF も その人だけ★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await openKyuryo(page);
  await page.waitForTimeout(1500);

  const sel = page.locator('#hitoSel');
  await expect(sel, '★名前の 選ぶ欄が 無い★').toBeVisible();
  const opts = await sel.locator('option').allTextContents();
  const zenin = opts.length - 1;
  expect(zenin, '★選べる 人が 2人 未満＝この 見張りは 何も 見ていない★').toBeGreaterThan(1);
  expect(await page.locator('#slips .slip').count()).toBe(zenin);

  // ★スッキリ★ 表の ボタンは「明細を PDFで 見る」だけ・まとめた 表は 畳まれている
  await expect(page.locator('#btnPrint')).toBeVisible();
  await expect(
    page.locator('#btnPrintSel'),
    '★選んでいないのに「選んだ人」が 出ている★'
  ).toBeHidden();
  await expect(page.locator('#kamiTsuki'), '★まとめた 表が 畳まれていない★').toBeHidden();

  // ① 名前を 選ぶ ⇒ その人の 明細だけ
  const namae = opts[2];
  await sel.selectOption({ index: 2 });
  await page.waitForTimeout(300);
  const slips = page.locator('#slips .slip');
  await expect(slips, '★名前を 選んでも 全員の 明細が 出ている★').toHaveCount(1);
  await expect(slips.first()).toContainText(namae);

  // ② 「明細を PDFで 見る」⇒ その人だけ（紙は 作らせず、何人ぶん 作るかの 知らせで 見る）
  await page.route(/pdf-lib|fontkit|font-slim|pdf-slim|\.ttf/, () => {});
  await page.locator('#btnPrint').click();
  await page.waitForTimeout(500);
  const shirase = (await page.locator('#msg').textContent()) || '';
  expect(shirase, '★名前を 選んだのに 1人ぶんに なっていない★').toContain('（1人ぶん）');

  // ③ 全員に 戻す
  await sel.selectOption({ index: 0 });
  await page.waitForTimeout(300);
  await expect(page.locator('#slips .slip')).toHaveCount(zenin);

  // ④ まとめた 表は 開けば 使える（消していない）
  await page.locator('#kamiCard > summary').click();
  await expect(page.locator('#kamiTsuki')).toBeVisible();
  await expect(page.locator('#kamiKojin')).toBeVisible();

  expect(err, '★画面が 落ちた★').toEqual([]);
});

// ★10-03 対立役が 見つけた（前からの 穴）★ チェックを 付けて 月を 変えると チェックは 消えるのに
//   「選んだ 1人を 印刷」が 残り、押すと ★全員ぶん★ 出た。時数の 画面にも 名前の 欄が 出て 何も 絞らなかった。
//   ★わざと壊して 赤（10-03 実測）★ renderSlips の setTimeout(nurikae) を 外す ⇒ 赤（ボタンが 残る）
test('★月を 変えたら「選んだ人を 印刷」は 消える／時数の 画面に 名前の 欄は 出ない★', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await openKyuryo(page);
  await page.waitForTimeout(1500);
  await page.locator('.slip-pick').first().check();
  await page.waitForTimeout(200);
  await expect(page.locator('#btnPrintSel')).toBeVisible();
  await page.locator('#nextM').click();
  await page.waitForTimeout(1500);
  await expect(
    page.locator('#btnPrintSel'),
    '★チェックが 消えたのに「選んだ人を 印刷」が 残っている★'
  ).toBeHidden();
  await page.locator('#prevM').click();
  await page.waitForTimeout(1500);
  // 時数の 画面
  await page.getByText('時数を入れる').first().click();
  await page.waitForTimeout(800);
  await expect(page.locator('#monthCard')).toBeVisible();
  await expect(
    page.locator('#hitoSel'),
    '★時数の 画面に 絞らない 名前の 欄が 出ている★'
  ).toBeHidden();
  expect(err).toEqual([]);
});
