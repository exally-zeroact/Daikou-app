// ============================================================
// ★★本人の 明細：回数・距離の 直しを 返さない 古い 関数なら 止める★★ 2026-10-25
//   司さん「全部の車に自動反映できるもので（修正できるように）つけろよ」＝事務所が メーターの 車の 回数・距離を 直せる。
//   事務所の 給料は 直した 数（dk_shift_edits の *_naoshi）で 回数歩合・距離歩合を 出す（UriageAgg.kazuOf）。
//   本人の 関数（dk_kyuryo_get）が 古いと 直しが 来ず、本人だけ メーターの 数で 出る＝黙って ずれる。
//   ⇒ 関数は 印 kazuNaoshi を 返す。無ければ 止めて 知らせる（tebikiJippi・uriageNaoshi と 同じ 形）
//   わざと壊す：kyuryo.html の kazuNaoshi の 止めを 外す ⇒ 赤
// ============================================================
const { test, expect } = require('@playwright/test');
const { hiraku } = require('./honnin-harness');

test('本人の 明細：印 kazuNaoshi が 無い 返事なら 紙を 出さず 止める', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await hiraku(page, null, { kazuNaoshi: undefined });
  await page.click('#hnMae');
  await expect(page.locator('#slips')).not.toContainText('読み込み中');
  await expect(page.locator('#slips')).toContainText('回数・距離の 直しを 読めなかった');
  await expect(page.locator('#hnKami'), '★止めたのに 紙が 出た★').toHaveCount(0);
});

test('本人の 明細：印が 在れば 紙を 出す（止めっぱなしに しない）', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await hiraku(page, null, {});
  await page.click('#hnMae');
  await expect(page.locator('#slips')).not.toContainText('読み込み中');
  await expect(page.locator('#slips')).not.toContainText('回数・距離の 直しを 読めなかった');
});
