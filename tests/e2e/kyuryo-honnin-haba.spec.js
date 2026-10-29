// ============================================================
// ★★見張り：従業員の 自分の 給料明細（本人の 画面）の 紙が 見切れない★★ 2026-10-20
//
//   司さん（スマホの 絵つき）「給料明細の表が見切れとんは直したんやないんか…
//          事務所の直した時に一緒にやってない」
//   ★前★ 紙を 0.62倍 より 縮めず 横に 送らせた＝スマホでは 右が 切れて 見えた。
//   ★今★ 事務所（kamiMadoNuru）と 同じく 紙 1枚を 幅ぴったりに 縮める。
//         幅が 変わったら（向きを 変えた）描き直す。紙を 入れた 後の 幅（PC の 巻き棒）でも 測り直す。
//
//   ★押す物の一覧（先に書く）★ 1. リンクを 開く 2. パスワードを 入れて「見る」 3. ◀（前の 月）
//   ★★わざと壊して 赤に なるのを 見た（2026-10-20 実測）★★
//     縮め方を 前の 0.62倍 下限に 戻す ……………………… ★4本 赤★（390/375/320・1280→390）
//     待っている 描き直しを 走る 時に 見直さない・月を 送る 時に 捨てない … ★1本 赤★（縮めて すぐ ◀）
//     戻した 後 … ★6本 緑★
// ============================================================
const { test, expect } = require('@playwright/test');
const { hiraku, hakaru, maeNoTsuki } = require('./honnin-harness');

function kirenai(m) {
  expect(m.maisu, '★紙が 1枚も 無い＝何も 測っていない★').toBeGreaterThan(0);
  expect(m.page, '★ページが 横に はみ出している★').toBeLessThanOrEqual(0);
  expect(m.migi, '★紙が 右で 切れている（見切れ）★').toBeLessThanOrEqual(1);
  expect(m.shita, '★紙の 下が 切れている★').toBeLessThanOrEqual(1);
}

for (const haba of [390, 375, 320]) {
  test(`★本人の 紙：${haba}px で 右も 下も 切れない★`, async ({ page }) => {
    await page.setViewportSize({ width: haba, height: 844 });
    await hiraku(page);
    kirenai(await hakaru(page));
  });
}

test('★本人の 紙：広い 画面で 開いてから 縮めても（向きを 変えても）右が 切れない★', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await hiraku(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  kirenai(await hakaru(page));
});

// ★止めた 文が 出ている 時に 幅が 変わっても 前の 月の 紙を 出さない★（対立役 S2）
test('★本人の 紙：止めた 文の 時に 向きを 変えても 文の まま★', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await hiraku(page, null, { uriageNaoshi: undefined });
  await maeNoTsuki(page);
  await expect(page.locator('#slips')).not.toContainText('読み込み中');
  await expect(page.locator('#hnKami')).toHaveCount(0);
  const mae = await page.locator('#slips').innerText();
  await page.setViewportSize({ width: 320, height: 844 });
  await page.waitForTimeout(600);
  await expect(page.locator('#hnKami'), '★止めた 文の 後に 紙が 出た★').toHaveCount(0);
  expect(await page.locator('#slips').innerText()).toBe(mae);
});

// ★縮めて すぐ 月を 送っても 待っている 描き直しが 止めた 文を 上書きしない★（対立役 止1：
//   前は 9月の 見出しの 下に 10月の 紙が 出た）
test('★本人の 紙：縮めて すぐ ◀ で 止めた 文に なっても 前の 月の 紙を 出さない★', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await hiraku(page, null, { uriageNaoshi: undefined });
  await page.setViewportSize({ width: 320, height: 844 });
  await maeNoTsuki(page);
  await page.waitForTimeout(800);
  await expect(page.locator('#slips')).not.toContainText('読み込み中');
  await expect(page.locator('#hnKami'), '★止めた 文の 後に 前の 月の 紙が 出た★').toHaveCount(0);
});
