/* global showScreen, updateStartButtonsGate, onBusinessStart, onMainBtn, onBusinessEnd */
// tests/e2e/stationary-no-increase.spec.js
// ZEROact 共通テスト基盤 (2026-05-17 新規・Stage 1 Step D) — ダイコメ E2E
//
// シナリオ: 業務開始 → setDistance(500) → isStationary=true GPS を流す → distance_m 不変確認
//
// 検証対象: meter.js L790 update() 入口の isStationary 早期 return path
// 補強: tests/property/isstationary-no-increase.test.js (B1/B2/B3) と二重防御

import { test, expect } from '@playwright/test';

test('stationary-no-increase: 停車中 isStationary=true GPS で distance_m 完全不変', async ({
  page,
}) => {
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

  // 業務開始 → 代行開始
  await page.evaluate(() => {
    if (typeof onBusinessStart === 'function') onBusinessStart();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    if (typeof onMainBtn === 'function') onMainBtn();
    if (typeof Meter !== 'undefined' && typeof Meter.start === 'function') Meter.start();
  });
  await page.waitForTimeout(300);

  // 事前 distance_m=500 セット → isStationary GPS シーケンスを 10 step 流す
  const result = await page.evaluate(() => {
    Meter.setDistance(500);
    const before = Meter.getState().distance_m;
    const baseTs = Date.now();
    // 同座標を 1Hz 相当で 10 step 流す (= isStationary=true 確定相当)
    for (let i = 0; i < 10; i++) {
      Meter.update({
        lat: 33.84,
        lng: 132.7656,
        accuracy: 5,
        speedKmh: 0,
        isStationary: true,
        timestamp: baseTs + i * 1000,
      });
    }
    const after = Meter.getState().distance_m;
    return { before, after };
  });

  // 期待: 完全不変
  expect(result.before).toBe(500);
  expect(result.after).toBe(500);

  // 業務終了
  page.once('dialog', (d) => d.accept());
  await page.evaluate(() => {
    if (typeof onBusinessEnd === 'function') onBusinessEnd();
  });
});
