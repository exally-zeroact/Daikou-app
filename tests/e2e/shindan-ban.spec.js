// tests/e2e/shindan-ban.spec.js
// ============================================================
// ★診断の 画面に「この端末の版」が 出るか（2026-09-26）★
//
//   司さん「バージョンは何が正解なんど」
//   ★それまで 端末が どの版で 動いているかを 見る 場所が 1つも 無かった★。
//   画面に 在ったのは window.DAIKOME_APP_VERSION = '1.0.0'（★手で書いた 固定値★）だけ
//   ＝押すたびに 変わらない ので 新旧の 見分けに 使えない。
//
//   出す 物は 2つ。★この 2つが 違う＝その端末は まだ 古い★。
//     ①この端末が 持っている 棚の 名前（受け取った版）
//     ②網から 引いた sw.js の 中の 名前（配られている版＝正解）
//
// ★わざと壊して 赤に なる事を 見た (2026-09-26)★
//   shindan.html の fetch('sw.js') を fetch('sw-nai.js') に 変える
//     ⇒ 「配られている版」が daikome-… に ならず ★赤★。戻すと 緑。
// ============================================================
const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 390, height: 844 } });

test('診断: 配られている版（正解）が daikome-xxxxxxx で 出る', async ({ page }) => {
  await page.goto('/shindan.html', { waitUntil: 'domcontentloaded' });

  const hyou = page.locator('#tVer');
  await expect(hyou, '★版の 表が 無い★').toHaveCount(1);

  // 2行（この端末 / 配られている版）
  await expect(hyou.locator('tr')).toHaveCount(2);
  await expect(hyou.locator('tr').nth(0).locator('td.k')).toContainText('この端末');
  await expect(hyou.locator('tr').nth(1).locator('td.k')).toContainText('正解');

  // ★網から 引いた sw.js の 刻印が そのまま 出る★
  const haishin = hyou.locator('tr').nth(1).locator('td.v');
  await expect(haishin, '★配られている版が 読めていない★').toHaveText(/^daikome-[0-9a-f]{7,}$/, {
    timeout: 10000,
  });

  // 出た 値が ★本物の sw.js と 同じ★か（真似ずに 実物と 突き合わせる）
  const honmono = await page.evaluate(async () => {
    const t = await (await fetch('sw.js', { cache: 'no-store' })).text();
    const m = t.match(/daikome-[0-9a-f]{7,}/);
    return m ? m[0] : null;
  });
  expect(honmono, 'sw.js に 刻印が 無い＝前提が 崩れている').toMatch(/^daikome-[0-9a-f]{7,}$/);
  await expect(haishin, '★画面の 値と 実物が 違う★').toHaveText(honmono);

  // この端末の 行は ★必ず 何か 出す★（読めない時も 黙って 空にしない）
  const tanmatsu = hyou.locator('tr').nth(0).locator('td.v');
  await expect(tanmatsu).not.toHaveText('');
  await expect(tanmatsu).not.toHaveText('…読んでいます', { timeout: 10000 });
});
