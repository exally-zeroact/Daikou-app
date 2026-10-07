// ============================================================
// ★★見張り：事務所の 給料画面＝PDF と 同じ 紙を そのまま 見せる★★ 2026-10-05
//
//   司さん「PDFつくっとんやけんそれを見せろやぼけ」「何をくどくど訳わからんこと見せとんど」
//          「見切れてめちゃくちゃな所あるし」
//   ★前★ 紙とは 別に 画面用の 横の表・縦の一覧を 組んでいた＝PDF と 違う 物・横に はみ出す。
//   ★今★ 明細の 箱に ★印刷・PDF と 同じ 紙（__paper.build）★を 幅ぴったりに 縮めて 入れる。
//         紙を 押すと その人の PDF。紙の 上は チェック・名前・QR・送る の 1行だけ。
//
//   ★押す物の一覧（先に書く）★ 1. 給料を 開く 2. 紙を 押す
//
//   ★★わざと壊して 赤に なるのを 見た（2026-10-05 実測）★★
//     kyuryo.html を 前の 形（画面用の 表）に 戻す ⇒ ★赤★（紙が 0枚）
//   ★10-05 対立役に 叩かれて 締めた★（前は 次の 3つで 緑の まま だった）
//     紙を 二重に 描く ⇒ ★赤★（枚数が 合わない）／枠の 高さを 縮める ⇒ ★赤★（下が 切れる）
//     幅が 変わっても 描き直さない ⇒ ★赤★（右が 切れる）
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

test('★事務所の 明細＝PDF と 同じ 紙・見切れない・押すと PDF★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await openKyuryo(page);
  await page.waitForTimeout(1500);

  const ninzu = await page.locator('#slips .slip').count();
  expect(ninzu, '★明細が 1枚も 無い＝この 見張りは 何も 見ていない★').toBeGreaterThan(0);
  const kami = page.locator('#slips .kami-mado .hn-kami-waku');
  // ★枚数は ちょうど★（多くても 赤＝二重に 描いていない）10-05 対立役
  const hazu = await page.evaluate(() => {
    let n = 0;
    // ★日と 車の 両方で 分けた 後の 枚数★（10-07：日だけ 数えると 車で 分けた 紙が 抜ける）
    for (let i = 0; i < window.__paper.ninzu(); i++) n += window.__paper.sheets(i).length;
    return n;
  });
  expect(hazu, '★数える 物が 0＝空回り★').toBeGreaterThan(0);
  expect(await kami.count(), '★明細の 紙の 枚数が 合わない（無い／二重）★').toBe(hazu);
  // ★画面用の 表（前の 形）は もう 出さない★
  expect(
    await page.locator('#slips .yoko, #slips .tate').count(),
    '★画面用の 表が 残っている★'
  ).toBe(0);

  // ★見切れない★＝ページも 紙の 枠も 横に はみ出さない
  const hami = await page.evaluate(() => {
    const d = document.documentElement;
    const waku = Array.from(document.querySelectorAll('#slips .hn-kami-waku'));
    return {
      page: d.scrollWidth - d.clientWidth,
      waku: Math.max(
        0,
        ...waku.map((w) => {
          const r = w.firstElementChild.getBoundingClientRect();
          return Math.round(r.right - w.getBoundingClientRect().right);
        })
      ),
    };
  });
  expect(hami.page, '★ページが 横に はみ出している★').toBeLessThanOrEqual(0);
  expect(hami.waku, '★紙が 枠から はみ出している（見切れる）★').toBeLessThanOrEqual(1);
  // ★下も 切れない★＝紙の 中の 字の 一番 下が 枠の 中（10-05 対立役：枠の 高さを 縮めても 緑だった）
  const shita = await page.evaluate(() =>
    Math.max(
      ...Array.from(document.querySelectorAll('#slips .hn-kami-waku')).map((w) => {
        const wb = w.getBoundingClientRect().bottom;
        const b = Math.max(
          ...Array.from(w.querySelectorAll('td,th,div')).map(
            (x) => x.getBoundingClientRect().bottom
          )
        );
        return Math.round(b - wb);
      })
    )
  );
  expect(shita, '★紙の 下が 枠で 切れている★').toBeLessThanOrEqual(1);
  // ★幅を 変えても 切れない★（PC で 開いて 窓を 縮める・横向き→縦向き）
  // ★広い 画面で 描いてから 縮める★（PC で 開いて 窓を 縮める 形）
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(400);
  await page.selectOption('#hitoSel', { index: 1 }); // 1280 の 幅で 描き直させる
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  const hami2 = await page.evaluate(() => {
    const w = document.querySelector('#slips .hn-kami-waku');
    return Math.round(
      w.firstElementChild.getBoundingClientRect().right - w.getBoundingClientRect().right
    );
  });
  expect(hami2, '★幅を 変えたら 紙の 右が 切れた★').toBeLessThanOrEqual(1);

  // ★紙の 中身は 印刷と 同じ 作り（名前が 紙に 書いてある）★
  const na = await page.locator('#slips .kami-ue-na').first().textContent();
  await expect(kami.first()).toContainText(String(na).trim());

  // ★押すと その人の PDF★（紙は 作らせず、何人ぶん 作るかの 知らせで 見る）
  await page.route(/pdf-lib|fontkit|font-slim|pdf-slim|\.ttf/, () => {});
  await kami.first().click();
  await page.waitForTimeout(500);
  expect(
    (await page.locator('#msg').textContent()) || '',
    '★紙を 押しても 1人ぶんの PDF に ならない★'
  ).toContain('（1人ぶん）');
  expect(err, '★画面が 落ちた★').toEqual([]);
});
