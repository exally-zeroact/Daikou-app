// ============================================================
// ★★本人の 明細：手入力の 日の 足した 実費を 返さない 古い 関数なら 止める★★ 2026-10-20（司さん「揃えろ」）
//   事務所の 給料は 手入力の 日の 足した 実費（expenses）を 引く（js/payroll-daily.js）。
//   本人の 関数（dk_kyuryo_get）が 古いと expenses が 来ず、本人だけ 引かれずに 高く 出る＝黙って ずれる。
//   ⇒ 関数は 印 tebikiJippi を 返す。無ければ 止めて 知らせる（10-14 の uriageNaoshi と 同じ 形）
//   わざと壊す：kyuryo.html の tebikiJippi の 止めを 外す ⇒ 赤
// ============================================================
const { test, expect } = require('@playwright/test');
const { hiraku, maeNoTsuki } = require('./honnin-harness');

test('本人の 明細：印 tebikiJippi が 無い 返事なら 紙を 出さず 止める', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await hiraku(page, null, { tebikiJippi: undefined });
  await maeNoTsuki(page);
  await expect(page.locator('#slips')).not.toContainText('読み込み中');
  await expect(page.locator('#slips')).toContainText('手入力の 日の 実費を 読めなかった');
  await expect(page.locator('#hnKami'), '★止めたのに 紙が 出た★').toHaveCount(0);
});

test('本人の 明細：印が 在れば 紙を 出す（止めっぱなしに しない）', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await hiraku(page, null, {});
  await maeNoTsuki(page);
  await expect(page.locator('#slips')).not.toContainText('読み込み中');
  await expect(page.locator('#slips')).not.toContainText('手入力の 日の 実費を 読めなかった');
});
