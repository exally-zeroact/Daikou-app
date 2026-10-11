// ============================================================
// ★設定画面の 外で 出す 知らせが 見える★（2026-10-12）
//
//   window._showToast の 箱（_st_settingsToast）は #overlaySettings の 中で、閉じていると 見えない。
//   業務終了の「事務所に送りました（n件）」や 便の 直しの「直しました」は 設定画面の 外で 呼ばれ、
//   一度も 運転手に 見えていなかった。設定画面が 閉じている 時は 走行画面の #toast へ 出す。
// ============================================================
/* eslint-disable no-undef -- page.evaluate() 内はブラウザ(page)コンテキストの app グローバルを参照する */
import { test, expect } from '@playwright/test';

async function hiraku(page) {
  await page.goto('/index.html', { waitUntil: 'load' });
  await page.waitForFunction(
    () => typeof window._showToast === 'function' && typeof Business !== 'undefined'
  );
}

test('業務終了の「事務所に送りました」が 走行画面の トーストに 見える', async ({ page }) => {
  await hiraku(page);
  await page.evaluate(() => {
    Business.start();
    Business.end();
    window.JobSync = { sync: () => Promise.resolve({ ok: true, sent: 2 }) };
    _syncAfterEnd();
  });
  const t = page.locator('#toast');
  await expect(t).toContainText('事務所に送りました（2件）', { timeout: 3000 });
  await expect(t).toBeVisible();
});

test('設定画面が 開いている 時は 今まで 通り 設定画面の 箱に 出す', async ({ page }) => {
  await hiraku(page);
  await page.evaluate(() => {
    window.showOverlay('settings');
    window._showToast('設定の 知らせ');
  });
  await expect(page.locator('#_st_settingsToast')).toHaveText('設定の 知らせ');
  await expect(page.locator('#_st_settingsToast')).toBeVisible();
});
