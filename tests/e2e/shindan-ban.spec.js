// tests/e2e/shindan-ban.spec.js
// ============================================================
// ★診断の 画面に「この端末の版」と ★新しい／古いの 見立て★ が 出るか（2026-09-26）★
//
//   司さん「バージョンは何が正解なんど」
//   ★端末が どの版で 動いているかを 見る 場所が 1つも 無かった★。
//   画面に 在ったのは window.DAIKOME_APP_VERSION = '1.0.0'（★手で書いた 固定値★）だけ。
//
//   ★さらに 刻印は 押すたびに 変わる★（f50463c → 26efefd）。
//   ＝「この番号が 正解」と 人に 覚えさせるのが そもそも 間違い。
//   ⇒ ★画面が くらべて 判じる★。人は ★見立ての 1行★ だけ 読めばよい。
//
//   出す 物（3行）
//     ①この端末が 持っている 棚の 名前（受け取った版）
//     ②網から 引いた sw.js の 中の 名前（配られている版）
//     ③★見立て★ … 新しい／古い／まだ棚が無い／くらべられない
//
// ★わざと壊して 赤に なる事を 見た (2026-09-26)★
//   ・fetch('sw.js') を 'sw-nai.js' に する → 「②が 読めない」で ★赤★
//   ・見立ての `mine.indexOf(live) >= 0` を `>= 1` に する → 「新しい」が 出ず ★赤★
//   どちらも 戻すと 緑。
// ============================================================
const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 390, height: 844 } });

// 今 配られている 刻印（実物の sw.js から 取る・真似ない）
async function honmonoNoKokuin(page) {
  return page.evaluate(async () => {
    const t = await (await fetch('sw.js', { cache: 'no-store' })).text();
    const m = t.match(/daikome-[0-9a-f]{7,}/);
    return m ? m[0] : null;
  });
}

const gyou = (page, i) => page.locator('#tVer tr').nth(i).locator('td.v');

test('診断: 3行 出る／②は 実物の sw.js と 同じ 字', async ({ page }) => {
  await page.goto('/shindan.html', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#tVer tr'), '★3行 出ていない★').toHaveCount(3);
  await expect(page.locator('#tVer tr').nth(0).locator('td.k')).toContainText('この端末');
  await expect(page.locator('#tVer tr').nth(1).locator('td.k')).toContainText('正解');
  await expect(page.locator('#tVer tr').nth(2).locator('td.k')).toContainText('見立て');

  const live = await honmonoNoKokuin(page);
  expect(live, 'sw.js に 刻印が 無い＝前提が 崩れている').toMatch(/^daikome-[0-9a-f]{7,}$/);
  await expect(gyou(page, 1), '★画面の 値と 実物が 違う★').toHaveText(live, { timeout: 10000 });

  // どの行も ★「…読んでいます」のまま 止まらない★（黙って 空にしない）
  for (const i of [0, 1, 2]) {
    await expect(gyou(page, i)).not.toHaveText('…読んでいます', { timeout: 10000 });
  }
});

test('診断: 棚が 無い端末は「まだ 棚が 無い」', async ({ page }) => {
  await page.goto('/shindan.html', { waitUntil: 'domcontentloaded' });
  await expect(gyou(page, 2), '★棚が 無いのに そう 言っていない★').toContainText('まだ 棚が 無い', {
    timeout: 10000,
  });
});

test('診断: 配られている版と 同じ 棚を 持つ端末は「新しい」', async ({ page }) => {
  await page.goto('/shindan.html', { waitUntil: 'domcontentloaded' });
  const live = await honmonoNoKokuin(page);
  await page.evaluate((k) => caches.open(k), live); // 受け取った事に する
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(gyou(page, 0)).toContainText(live, { timeout: 10000 });
  await expect(gyou(page, 2), '★同じなのに「新しい」と 出ない★').toContainText('★新しい★', {
    timeout: 10000,
  });
  await expect(gyou(page, 2)).not.toContainText('古い');
});

test('診断: 別の 刻印の 棚しか 無い端末は「古い」', async ({ page }) => {
  await page.goto('/shindan.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => caches.open('daikome-0000000')); // ★在り得ない 古い 刻印★
  await page.reload({ waitUntil: 'domcontentloaded' });

  const live = await honmonoNoKokuin(page);
  expect(live, '実物の 刻印が 0000000 だと この試験が 意味を 失う').not.toBe('daikome-0000000');
  await expect(gyou(page, 2), '★古いのに 気づいていない★').toContainText('★古い★', {
    timeout: 10000,
  });
  await expect(gyou(page, 2)).toContainText('開き直して');
});
