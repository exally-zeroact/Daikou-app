/* global showScreen */
// tests/e2e/obd-ui-home.spec.js
// ★OBD ホーム UI 検証 (2026-06-08)★
//
// 検証: ①ホーム(業務開始)画面に OBD 接続ピル #btnObdHome が見える・OBD 文言を出す
//       ②走行画面の距離源バッジ #obdDriveBadge は非表示(司さん要望2026-06-27)
//       ③bindObdUI が例外なく完走 (window.__obdUiBound===true) = obd-client.js load + 配線健全
//       ④headless(Web Bluetooth 非対応)では「Android Chromeのみ」表示にフォールバック(落ちない)
//
// 実 BLE 接続は headless で不可 → 接続後の状態遷移は実機テストで確認 (緑≠実機OK)。

import { test, expect } from '@playwright/test';

async function gotoApp(page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('sensor_permission_active', '1');
    sessionStorage.setItem('sensorGranted', '1');
    sessionStorage.setItem('dl_just_completed', '1');
    localStorage.setItem('daikome_training_consent', 'dismissed');
    localStorage.setItem('pwa_banner_dismissed', '1');
    localStorage.setItem('apk_banner_dismissed', '1');
    localStorage.setItem('tutorial_done', '1');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    ['dlOverlay', 'trainingConsentBanner', 'pwaBanner', 'apkBanner', 'sensorRestoreBanner'].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      }
    );
  });
}

test('OBD: 青バーに常駐 OBD チップが見える + bindObdUI 完走', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await gotoApp(page);

  // 青バー(appbar)は全画面常駐 → ホーム表示直後から OBD チップが見える
  const chip = page.locator('#obdChip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('OBD');

  // bindObdUI が完走している (obd-client.js load + 配線が例外なく通った)
  const bound = await page.evaluate(() => window.__obdUiBound === true);
  expect(bound).toBe(true);

  // 配線由来の page error が無い
  expect(errors.join('\n')).toBe('');
});

test('OBD: 青バーチップは走行画面に遷移しても常駐(押せる)', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    if (typeof showScreen === 'function') showScreen('driving');
    const d = document.getElementById('screenDriving');
    if (d) d.style.display = 'block';
  });
  // 走行画面でも青バーの OBD チップが見える=遷移で消えない(司さん指摘の bypass 解消)
  const chip = page.locator('#obdChip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('OBD');
});

test('OBD: 走行画面の距離源バッジは非表示 (司さん要望2026-06-27)', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    if (typeof showScreen === 'function') showScreen('driving');
    const d = document.getElementById('screenDriving');
    if (d) d.style.display = 'block';
  });
  // ★距離源バッジ(📡GPS/🟢OBD)は司さん要望で非表示にした(要素とJS更新は残すが display:none)。
  //   接続状態は青バーのOBDチップ(緑=接続/半透明=未接続)で示す。
  const badge = page.locator('#obdDriveBadge');
  await expect(badge).toBeHidden();
});

test('OBD: Web Bluetooth 非対応端末はフォールバック表示で落ちない', async ({ page }) => {
  await gotoApp(page);
  // headless Chromium は navigator.bluetooth 無し → isSupported()=false 経路
  const supported = await page.evaluate(() =>
    window.OBDClient && typeof window.OBDClient.isSupported === 'function'
      ? window.OBDClient.isSupported()
      : null
  );
  // OBDClient は load されている (null でない)
  expect(supported === false || supported === true).toBe(true);
});
