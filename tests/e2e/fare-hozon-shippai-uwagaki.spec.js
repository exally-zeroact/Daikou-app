// ============================================================
// ★料金の 画面の「保存」が、保存の 失敗の 知らせを「保存しました」で 上書きしない★（2026-10-11）
//
//   saveAll は saveExtras・saveDiscounts の 結果を 見ずに「保存しました」を 出していた。
//   書けない 時は 2つが 出した「保存できませんでした…」が すぐ 消され、運転手は 保存できたと 思う。
// ============================================================
/* eslint-disable no-undef -- page.evaluate() 内はブラウザ(page)コンテキストの app グローバルを参照する */
import { test, expect } from '@playwright/test';

test('書けない 時は「保存しました」を 出さず、失敗の 知らせが 残る', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window._fare_saveAll === 'function');
  await page.evaluate(() => {
    window.__dame = 0;
    Storage.prototype.setItem = function () {
      window.__dame++;
      const e = new Error('QuotaExceededError');
      e.name = 'QuotaExceededError';
      throw e;
    };
    window._fare_saveAll();
  });
  expect(await page.evaluate(() => window.__dame)).toBe(2);
  const t = page.locator('#_fare_toast');
  await expect(t).toContainText('保存できませんでした');
  await expect(t).not.toContainText('保存しました');
});

test('書ける 時は「保存しました」', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window._fare_saveAll === 'function');
  await page.evaluate(() => window._fare_saveAll());
  await expect(page.locator('#_fare_toast')).toHaveText('保存しました');
});
