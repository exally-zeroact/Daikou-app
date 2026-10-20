// ============================================================
// ★★見張り：従業員の 自分の 給料明細（本人の 画面）の 期間の ボタンは 1行★★ 2026-10-20
//
//   司さん（スマホの 絵つき）「赤丸のところは1行にしろ」
//   ★前★ 期間の ボタン 3つが 2行に 折れた（iPhone の 字は Windows の 試験の 字より 2割 広い）。
//   試験は repo の 字体（BIZ UDPゴシック＝iPhone と ほぼ 同じ 幅）に 揃えて 測る（機械の 字体に 頼らない）。
//   ★今★ 3つ まで＝幅を 等分して 1行。4つ 以上（週1回・毎日）＝1行の まま 中で 横に 送る。
//
//   ★押す物の一覧（先に書く）★ 1. リンクを 開く 2. パスワードを 入れて「見る」 3. 期間の ボタン
//   ★★わざと壊して 赤に なるのを 見た（2026-10-20 実測・字体を BIZ UDPゴシックに 揃えた 後）★★
//     全部の 形を 等分で 詰める（4つ 以上も sukunai）……… ★4本 赤★（週1回・毎日 390/320）
//     字の 大きさの 段（400px 12px・340px 10px）を 外す …… ★4本 赤★（月3回・締め日 10/20/25 の 390/320）
//     380px 以下の 段（11px・空き 詰め）を 外す ……………… ★5本 赤★
//     選んだ 期間を 真ん中へ 送らない ……………………………… ★4本 赤★
//     「〜」の 前後の 空きを 残す ……………………………………… ★6本 赤★
//     300px 未満の 折り返しを 外す ………………………………… ★1本 赤★（280px で 字が はみ出す）
//     戻した 後 … ★12本 緑★
// ============================================================
const { test, expect } = require('@playwright/test');
const { hiraku, hakaru, jitaiKotei } = require('./honnin-harness');

async function ikkou(page, kazu) {
  await jitaiKotei(page);
  const m = await hakaru(page);
  expect(m.chips, '★期間の ボタンの 数が 違う＝この 形を 測っていない★').toBe(kazu);
  expect(m.gyou, '★期間の ボタンが 1行に 入っていない★').toBe(1);
  expect(m.jiHami, '★期間の ボタンの 字が はみ出している★').toBe(0);
  expect(m.jiYoyuu, '★iPhone と 同じ 幅の 字だと ボタンに 入らない（1割の ゆとり 無し）★').toBe(0);
  expect(m.chipMigi, '★期間の ボタンが 画面の 右へ はみ出している★').toBeLessThanOrEqual(0);
  expect(m.page, '★ページが 横に はみ出している★').toBeLessThanOrEqual(0);
}

for (const haba of [390, 375, 360, 320]) {
  test(`★期間の ボタン：月3回・${haba}px で 1行★`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-05T12:00:00+09:00'));
    await page.setViewportSize({ width: haba, height: 844 });
    await hiraku(page);
    await ikkou(page, 3);
    // 期間を 押しても 1行の まま
    await page.locator('#slips .hn-chip').nth(2).click();
    await expect(page.locator('#slips .hn-chip.on')).toHaveAttribute('data-k', '2');
    await ikkou(page, 3);
  });
}

// ★一番 長い 字＝両側が 2桁の 期間が 3つ（締め日 10・20・25 の 12月：11/26〜12/10 ほか）★（対立役 直1）
for (const haba of [390, 360, 320]) {
  test(`★期間の ボタン：締め日 10・20・25 の 12月・${haba}px で 1行★`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2025-12-15T12:00:00+09:00'));
    await page.setViewportSize({ width: haba, height: 844 });
    await hiraku(page, { period_shime: { kind: 'tsuki', hi: [10, 20, 25], nazuke: 'shime' } });
    await expect(page.locator('#slips .hn-chip').first()).toHaveText('11/26〜12/10');
    await ikkou(page, 3);
  });
}

// ★週1回・毎日（ボタンが 4つ 以上）は 1行の まま その 中で 横に 送る★（対立役 S1：全部 詰めると 字が 潰れた）
//   日付を 月の 真ん中に 止める（月初めだと 選ぶ ボタンが 左の 端に なり 真ん中へ 送るのを 見ない・対立役 直2）
const KATA = [
  ['週1回', { period_shime: { kind: 'shuu', youbi: 0, nazuke: 'shime' } }],
  ['毎日', { period_shime: { kind: 'hi' } }],
];
for (const [na, set] of KATA) {
  for (const haba of [390, 320]) {
    test(`★期間の ボタン：${na}・${haba}px で 1行・字が 潰れない・選んだ 期間が 見える★`, async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date('2026-10-15T12:00:00+09:00'));
      await page.setViewportSize({ width: haba, height: 844 });
      await hiraku(page, set);
      const m = await hakaru(page);
      expect(m.chips, '★ボタンが 4つ 以上 無い＝この 形を 測っていない★').toBeGreaterThanOrEqual(4);
      expect(m.gyou, '★期間の ボタンが 1行に 入っていない★').toBe(1);
      expect(m.jiHami, '★期間の ボタンの 字が はみ出している（潰れた）★').toBe(0);
      expect(m.page, '★ページが 横に はみ出している★').toBeLessThanOrEqual(0);
      const mieru = await page.evaluate(() => {
        const k = document.querySelector('#slips .hn-kikan');
        const on = k.querySelector('.hn-chip.on');
        const a = k.getBoundingClientRect();
        const b = on.getBoundingClientRect();
        return {
          naka: b.left >= a.left - 1 && b.right <= a.right + 1,
          hidari: Math.round(b.left - a.left),
          okutta: k.scrollLeft,
        };
      });
      expect(mieru.naka, '★選んで いる 期間の ボタンが 見えない★').toBe(true);
      // 真ん中の 期間なので 左の 端の ままでは ない（送っている）
      expect(mieru.okutta, '★選んだ 期間へ 送っていない★').toBeGreaterThan(0);
    });
  }
}

// ★300px 未満（折りたたみの 閉じた 画面）は 1行に しない＝折り返して 字を はみ出させない★（対立役 D1）
test('★期間の ボタン：締め日 10・20・25 の 12月・280px は 折り返して 字が はみ出さない★', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2025-12-15T12:00:00+09:00'));
  await page.setViewportSize({ width: 280, height: 653 });
  await hiraku(page, { period_shime: { kind: 'tsuki', hi: [10, 20, 25], nazuke: 'shime' } });
  await jitaiKotei(page);
  const m = await hakaru(page);
  expect(m.chips).toBe(3);
  expect(m.jiHami, '★期間の ボタンの 字が はみ出している★').toBe(0);
  expect(m.jiYoyuu, '★iPhone と 同じ 幅の 字だと ボタンに 入らない★').toBe(0);
  expect(m.chipMigi, '★期間の ボタンが 画面の 右へ はみ出している★').toBeLessThanOrEqual(0);
  expect(m.page, '★ページが 横に はみ出している★').toBeLessThanOrEqual(0);
});
