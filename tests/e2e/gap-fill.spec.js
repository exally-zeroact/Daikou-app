/* global showScreen, updateStartButtonsGate, onBusinessStart, onMainBtn, onBusinessEnd */
// tests/e2e/gap-fill.spec.js
// ZEROact 共通テスト基盤 (2026-05-17 新規・Stage 1 Step D) — ダイコメ E2E
//
// シナリオ: 走行中に dtSec >= 5 秒 GPS 空白を作る → gap fill (L824) 発火 → distance_m 増加
//
// 検証対象: meter.js L812 GAP_THRESHOLD_SEC=5 以上で
//          L824 state.distance_m += filled (= speed × time / GPS 直線非依存)
//
// ★ 絶対ルール準拠:
//   gap fill は GPS 直線距離ではなく「最後の speedKmh × dtSec」を採用 (絶対ルール適用範囲内)。

import { test, expect } from '@playwright/test';

test('gap-fill: dtSec >= 5 秒の GPS 空白で gap fill 発火・distance_m 増加', async ({ page }) => {
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

  // gap fill 発火パターン:
  //   step1: 走行中 GPS (速度 60km/h) → state.last_* 初期化
  //   step2: 同方向に進んだ GPS を timestamp 10 秒後で渡す → dtSec=10 で L812 発火
  //          gap fill: speed_kmh (60) / 3.6 × 10 = 166.7m が distance_m に加算
  const result = await page.evaluate(() => {
    Meter.setDistance(0);
    const baseTs = Date.now();
    // step1: 初期 GPS (state.last_* セット用・speedKmh=60)
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: baseTs,
    });
    const afterStep1 = Meter.getState().distance_m;

    // step2: 10 秒後 (= dtSec=10 で GAP_THRESHOLD_SEC=5 超過) → gap fill 発火
    Meter.update({
      lat: 33.84001, // 約 1m 北方向
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: baseTs + 10000,
    });
    const afterStep2 = Meter.getState().distance_m;
    const distanceSource = Meter.getState().distanceSource;

    return { afterStep1, afterStep2, distanceSource };
  });

  // step1 では distance_m 不変 (= Worker B 不在で mmIncrementM 来ない)
  expect(result.afterStep1).toBe(0);

  // step2 で gap fill が発火・distance_m が増加 (= speed 60km/h × 10s = 166.7m)
  // 物理上限 160km/h clamp + 5m 余裕で 160/3.6*10 + 5 = 449.4m が上限
  expect(result.afterStep2).toBeGreaterThan(100);
  expect(result.afterStep2).toBeLessThan(500);

  // distanceSource: E2E は実 mmWorker あり・道路未ロード (roadsLoading) のため 'loadfill'
  // (= 2026-06-07 loadfill 新設・worker 完全不在時のみ 'gap'。計上量の式は同一 speed×時間)
  expect(result.distanceSource).toBe('loadfill');

  // 業務終了
  page.once('dialog', (d) => d.accept());
  await page.evaluate(() => {
    if (typeof onBusinessEnd === 'function') onBusinessEnd();
  });
});
