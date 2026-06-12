// overlay SPA 動作確認 E2E (2026-05-15・動的解析 ②)
// bottom-nav 設定タップ → #overlaySettings 表示 → 閉じる → 非表示
import { test, expect } from '@playwright/test';

test('flow-overlay: 設定タブ → overlaySettings 表示・URL 不変・閉じて非表示', async ({ page }) => {
  // ★設計変更宣言 (2026-05-19・司さん指示 landscape bottom-nav 非表示対応):
  //   司さん画像イメージ準拠で landscape では bottom-nav display: none に設定。
  //   default Desktop Chrome viewport (= 1280×720 landscape) では bottom-nav タブが
  //   非表示で test fail するため・portrait viewport (= 390×844) で実行。
  await page.setViewportSize({ width: 390, height: 844 });
  // E2E 上は MM pipeline を起動しないため・各種オーバーレイ/バナーを抑止
  await page.addInitScript(() => {
    sessionStorage.setItem('sensor_permission_active', '1');
    sessionStorage.setItem('sensorGranted', '1');
    sessionStorage.setItem('dl_just_completed', '1');
    localStorage.setItem('pwa_banner_dismissed', '1');
    localStorage.setItem('apk_banner_dismissed', '1');
    localStorage.setItem('tutorial_done', '1');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const ids = [
      'dlOverlay',
      'trainingConsentBanner',
      'pwaBanner',
      'apkBanner',
      'sensorRestoreBanner',
    ];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  });
  const startUrl = page.url();

  // appbar-nav 設定タブ (index 2) をタップ
  //   ★2026-06-05・ナビを青バー(appbar)へ統合: bottom-nav 撤去・.appbar-nav に移設。
  //   index は [0]業務/[1]使い方/[2]設定。
  const navSettings = page.locator('.appbar-nav .nav-item').nth(2);
  await navSettings.waitFor({ state: 'visible', timeout: 10000 });
  await navSettings.click();

  // #overlaySettings が visible
  const overlay = page.locator('#overlaySettings');
  await expect(overlay).toHaveClass(/\bshow\b/, { timeout: 5000 });

  // URL は変化しない (SPA・page reload なし)
  expect(page.url()).toBe(startUrl);

  // ESC または overlay 外クリックで閉じる動作を試す
  //   注: 現コードベースには ESC ハンドラ・背景クリック close は未実装。
  //       代わりに 業務タブ (nav-item:nth(0)) クリックで hideAllOverlays() が走る経路を確認。
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  const stillShown = await overlay.evaluate((el) => el.classList.contains('show'));
  if (stillShown) {
    // ESC で閉じなければ業務タブで閉じる (= MA-6 設計)
    await page.locator('.appbar-nav .nav-item').nth(0).click();
  }
  await expect(overlay).not.toHaveClass(/\bshow\b/, { timeout: 5000 });
});
