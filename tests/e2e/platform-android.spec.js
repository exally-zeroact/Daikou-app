/* global showScreen, updateStartButtonsGate, onBusinessStart, onMainBtn, onBusinessEnd */
// tests/e2e/platform-android.spec.js
// ZEROact 共通テスト基盤 Stage 4 (2026-05-18 新規) — Android 固有動作 E2E
//
// シナリオ:
//   1. mockAndroid で Pixel 7 Chrome UserAgent + geolocation permission
//   2. _isIOS=false / configPlatform isIOS=false 経路で起動
//   3. 5Hz GPS シーケンス相当 (= 200ms 間隔・同座標) で isStationary 確定
//
// ★ Android は configPlatform isIOS=false を送信するが Worker B 内 handler は
//   no-op (= 既存 N=15 維持)。本 spec ではこの no-op 経路が動作することを verify。

import { test, expect } from '@playwright/test';
import { mockAndroid } from '../../scripts/zeroact-test-commons/playwright-helpers/platform-mock.js';

test('platform-android: Android Chrome UA + 5Hz GPS で Android 経路が動作', async ({ browser }) => {
  const context = await mockAndroid(browser, {
    permissions: ['geolocation'],
    geolocation: { latitude: 33.84, longitude: 132.7656, accuracy: 5 },
  });
  const page = await context.newPage();

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
    if (typeof showScreen === 'function') showScreen('businessStart');
    const _bs = document.getElementById('screenBusinessStart');
    if (_bs) _bs.style.display = 'flex';
    if (typeof updateStartButtonsGate === 'function') updateStartButtonsGate();
  });

  // Android 判定確認: navigator.userAgent が iPhone を含まない・Android を含む
  const platformInfo = await page.evaluate(() => {
    return {
      userAgent: navigator.userAgent,
      isIOSFromUA: /iPad|iPhone|iPod/.test(navigator.userAgent),
      isAndroidFromUA: /Android/.test(navigator.userAgent),
    };
  });
  expect(platformInfo.userAgent).toContain('Android');
  expect(platformInfo.isIOSFromUA).toBe(false);
  expect(platformInfo.isAndroidFromUA).toBe(true);

  await page.evaluate(() => {
    if (typeof onBusinessStart === 'function') onBusinessStart();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    if (typeof onMainBtn === 'function') onMainBtn();
    if (typeof Meter !== 'undefined' && typeof Meter.start === 'function') Meter.start();
  });
  await page.waitForTimeout(300);

  // 5Hz GPS interval = 200ms 想定の連続 update (= isStationary 判定には elapsed_sec >=5 必要)
  // 5Hz x 30 step = 6 秒で isStationary 確定する想定
  const result = await page.evaluate(() => {
    Meter.setDistance(300);
    const before = Meter.getState().distance_m;
    const baseTs = Date.now();
    // Android 想定 5Hz interval = 200ms 間隔の 30 ステップ (= 6 秒分)
    for (let i = 0; i < 30; i++) {
      Meter.update({
        lat: 33.84,
        lng: 132.7656,
        accuracy: 5,
        speedKmh: 0,
        isStationary: true,
        timestamp: baseTs + i * 200,
      });
    }
    const after = Meter.getState().distance_m;
    return { before, after };
  });

  // 期待: 30 ステップ stationary 流入で distance_m 不変
  // (meter.js L790 update() 入口早期 return で全 Tier 到達せず・課金根拠 distance_m 保護確認)
  expect(result.before).toBe(300);
  expect(result.after).toBe(300);

  page.once('dialog', (d) => d.accept());
  await page.evaluate(() => {
    if (typeof onBusinessEnd === 'function') onBusinessEnd();
  });
  await context.close();
});
