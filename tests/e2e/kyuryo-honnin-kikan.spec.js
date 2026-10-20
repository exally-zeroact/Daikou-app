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

// ★★段の 境の 幅も 見る＝240〜430px を 1px ずつ★★ 2026-10-20（本番前の 対立役 直1）
//   ★前★ 字の 大きさを 400/380/340px の 段で 変えていた＝試験の 5つの 幅（390/375/360/320/280）は 緑でも
//   段の 境の すぐ 上で「字×1.1 が 入る」を 破った（月3回 282〜312・401〜403px／締め日 10・20・25 は 291〜315・341〜342・381〜382・401〜406px
//   ＝iPhone 16 Pro/17 の 402px も）。
//   ★今★ 字の 大きさを ボタンの 並びの 幅から 続けて 決める（段を 作らない）。310px 以下は 2つ＋1つに 折る（300px が CI の Linux で 赤・03f4873）。選んだ ボタンは 太字に しない。
//   一番 広い 字の ボタンを 選んだ 形で 測る（太字の 分 広がる 形を 見る・対立役 直3）。
//   ★わざと壊して 赤に なるのを 見た（2026-10-20 実測）★ 段の 形（前の kyuryo.html）… 締め日 35幅・月3回 34幅 赤
const SCAN = [
  [
    '締め日 10・20・25 の 12月',
    '2025-12-15T12:00:00+09:00',
    { period_shime: { kind: 'tsuki', hi: [10, 20, 25], nazuke: 'shime' } },
    '12/21〜12/25',
  ],
  ['月3回', '2026-10-05T12:00:00+09:00', undefined, '10/21〜10/31'],
];
for (const [na, hi, set, hiroi] of SCAN) {
  test(`★期間の ボタン：${na}・240〜430px を 1px ずつ★`, async ({ page }) => {
    test.setTimeout(240000);
    await page.clock.setFixedTime(new Date(hi));
    await page.setViewportSize({ width: 430, height: 844 });
    await hiraku(page, set);
    await jitaiKotei(page);
    // ★一番 広い 字が 出ている＝短い 字で 緑に ならない★（対立役 直2）
    const hiroiChip = page.locator('#slips .hn-chip', { hasText: hiroi });
    await expect(hiroiChip, '★一番 広い 期間の 字が 無い＝この 形を 測っていない★').toHaveCount(1);
    await hiroiChip.click();
    await expect(page.locator('#slips .hn-chip.on')).toHaveText(hiroi);
    // ★選んだ ボタンも 字の 太さは 同じ（太字で 広がらない）★
    const futosa = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#slips .hn-chip')).map(
        (c) => getComputedStyle(c).fontWeight
      )
    );
    expect(new Set(futosa).size, '★選んだ ボタンだけ 字の 太さが 違う★').toBe(1);
    const dame = [];
    let mita = 0;
    for (let w = 240; w <= 430; w++) {
      await page.setViewportSize({ width: w, height: 844 });
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      );
      const m = await hakaru(page);
      const haba = await page.evaluate(() => document.documentElement.clientWidth);
      // ★字の 大きさは 1px 刻み（半端な 大きさは CI の Linux だけで 崩れた・fd4f830）★
      const hanpa = await page.evaluate(
        () =>
          Array.from(document.querySelectorAll('#slips .hn-chip')).filter(
            (c) => parseFloat(getComputedStyle(c).fontSize) % 1 !== 0
          ).length
      );
      if (hanpa) dame.push(`${w}px 字の 大きさが 半端 ${hanpa}`);
      // ★320px（iPhone SE 初代 等）は 前の 10px より 小さく しない（本番前の 対立役：8.8 で 割ると 9px に 縮んだ）★
      if (w === 320) {
        const fs = await page.evaluate(() =>
          Math.min(
            ...Array.from(document.querySelectorAll('#slips .hn-chip')).map((c) =>
              parseFloat(getComputedStyle(c).fontSize)
            )
          )
        );
        if (fs < 10) dame.push(`320px 字が ${fs}px（前は 10px）`);
      }
      // ★その 幅で 開けた 回数を 数える（setViewportSize が 効かずに 430px の まま 測るのを 緑に しない・対立役 直2）★
      if (haba === w) mita++;
      else dame.push(`${w}px のはずが ${haba}px`);
      const gyou = w <= 310 ? 2 : 1;
      if (m.chips !== 3 || m.gyou !== gyou || m.jiHami || m.jiYoyuu || m.chipMigi > 0 || m.page > 0)
        dame.push(
          `${w}px 行${m.gyou} はみ${m.jiHami} ゆとり無し${m.jiYoyuu} 右${m.chipMigi} 頁${m.page}`
        );
    }
    expect(mita, '★その 幅で 見た 数が 違う★').toBe(191);
    expect(dame, '★この 幅で 期間の ボタンが 崩れる★').toEqual([]);
  });
}
