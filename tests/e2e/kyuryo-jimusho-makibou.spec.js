// ============================================================
// ★★見張り：事務所の 給料画面＝PC（巻き棒が 幅を 取る）でも 紙の 右が 切れない★★ 2026-10-20
//   本人の 画面で 直した 形（kyuryo-honnin-makibou・対立役 止2）と 同じ 穴が 事務所にも 在るか
//   kamiMadoNuru は 紙を 入れる 前に 幅を 測る＝紙を 入れて 縦の 巻き棒が 出ると 幅が 縮み、右が 切れる 見込み
//   試験の chromium は 既定で 巻き棒を 隠す＝この ファイルだけ 隠さずに 開く
//   ★★わざと壊して 赤に なるのを 見た（2026-10-20 実測・直す 前の 形に 戻して 測った）★★ 全員（800×500・1000×500・1280×600）は 緑＝人が 多いと 紙を 入れる 前から 巻き棒が 在る
//     1人・1000×900 ★1本 赤★（紙の 右が 14px 切れた）＝紙を 入れた 後に 巻き棒が 出る 形
//     kamiMadoNuru に「紙を 全部 入れた 後で 幅を 測り直す」を 足す … 緑。ただし 紙の 後で 下の 帯が 出て
//       ページが 伸びる 形（1000×1360・1100×1440）は まだ 15px 切れた（対立役）＝箱の 幅を ResizeObserver で 見張って 縮め直す
//     （1280×1000・1人 は 直す 前でも 箱の 幅が 変わらず 赤に なれない＝外した・対立役）
//   ★数（8本）★ 直す 前 5本 赤／1回 測り直すだけ 2本 赤（後から 伸びる 2本）／
//     ResizeObserver の 中で その場で 縮める 2本 赤（window の error に ResizeObserver loop）／次の 絵で 縮める 8本 緑
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

test.use({
  launchOptions: {
    ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--host-resolver-rules=MAP *.supabase.co ~NOTFOUND'],
  },
});
// 1人だけ＝紙を 入れる 前は ページが 短く 巻き棒が 無い（入れた 後に 出る）形も 見る
const hitori = (F) => {
  F.emps = (F.emps || []).slice(0, 1);
  return F;
};
for (const [w, h, naosu, na] of [
  [800, 500, null, '全員'],
  [1000, 500, null, '全員'],
  [1280, 600, null, '全員'],
  [1000, 900, hitori, '1人'],
  [1050, 900, hitori, '1人'],
  [1100, 900, hitori, '1人'],
  // 紙を 入れた 後に 下の 帯（js/jimusho-footer.js）が 出て ページが 伸び、巻き棒が 出る 形（対立役）
  [1000, 1360, hitori, '1人・後から 伸びる'],
  [1100, 1440, hitori, '1人・後から 伸びる'],
]) {
  test(`★事務所の 紙：PC ${w}×${h}・${na} で 右が 切れない★`, async ({ page }) => {
    // ★window の error も 数える★（ResizeObserver の 輪の 知らせは pageerror に 出ない・対立役）
    await page.addInitScript(() => {
      window.__errs = [];
      window.addEventListener('error', (e) => window.__errs.push(String(e.message)));
    });
    await page.setViewportSize({ width: w, height: h });
    await openKyuryo(page, naosu);
    await page.waitForTimeout(1500);
    const m = await page.evaluate(() => {
      const d = document.documentElement;
      const waku = Array.from(document.querySelectorAll('#slips .kami-mado .hn-kami-waku'));
      return {
        bou: window.innerWidth - d.clientWidth,
        maisu: waku.length,
        page: d.scrollWidth - d.clientWidth,
        migi: Math.max(
          0,
          ...waku.map((x) =>
            Math.round(
              x.firstElementChild.getBoundingClientRect().right - x.getBoundingClientRect().right
            )
          )
        ),
      };
    });
    expect(await page.evaluate(() => window.__errs), '★window の error が 出ている★').toEqual([]);
    expect(m.bou, '★巻き棒が 幅を 取っていない＝この 形を 測っていない★').toBeGreaterThan(0);
    expect(m.maisu, '★紙が 1枚も 無い＝何も 測っていない★').toBeGreaterThan(0);
    expect(m.page, '★ページが 横に はみ出している★').toBeLessThanOrEqual(0);
    expect(m.migi, '★紙が 右で 切れている（見切れ）★').toBeLessThanOrEqual(1);
  });
}
