// ============================================================
// ★★見張り：従業員の 自分の 給料明細（本人の 画面）＝PC（巻き棒が 幅を 取る）でも 紙の 右が 切れない★★ 2026-10-20
//   対立役 止2：紙を 入れると 縦の 巻き棒が 出て 幅が 縮む（resize は 起きない）＝右 14px が 切れた
//   試験の chromium は 既定で 巻き棒を 隠す＝この 形が 起きない ⇒ この ファイルだけ 隠さずに 開く
//   （launchOptions は ファイルの 頭で しか 変えられない＝別の ファイル）
//   ★★わざと壊して 赤に なるのを 見た（2026-10-20 実測）★★
//     紙を 入れた 後の 測り直しを 外す ……… ★2本 赤★（800×500・1000×500 で 右が 切れる）
//     戻した 後 … ★2本 緑★
// ============================================================
const { test, expect } = require('@playwright/test');
const { hiraku, hakaru } = require('./honnin-harness');

test.use({
  launchOptions: {
    ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--host-resolver-rules=MAP *.supabase.co ~NOTFOUND'],
  },
});
for (const [w, h] of [
  [800, 500],
  [1000, 500],
]) {
  test(`★本人の 紙：PC ${w}×${h} で 右が 切れない★`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await hiraku(page);
    const bou = await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth);
    expect(bou, '★巻き棒が 幅を 取っていない＝この 形を 測っていない★').toBeGreaterThan(0);
    const m = await hakaru(page);
    expect(m.maisu, '★紙が 1枚も 無い＝何も 測っていない★').toBeGreaterThan(0);
    expect(m.page, '★ページが 横に はみ出している★').toBeLessThanOrEqual(0);
    expect(m.migi, '★紙が 右で 切れている（見切れ）★').toBeLessThanOrEqual(1);
  });
}
