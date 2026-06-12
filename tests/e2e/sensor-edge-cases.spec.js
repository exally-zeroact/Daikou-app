/* global showScreen, updateStartButtonsGate, onBusinessStart, onMainBtn, onBusinessEnd */
// tests/e2e/sensor-edge-cases.spec.js
// ZEROact 共通テスト基盤 Stage 4 (2026-05-18 新規) — センサー異常値ガード E2E
//
// シナリオ群:
//   1. accuracy>50m の GPS で _trackHaversineBetweenGps / _calculateOffRoadIncrement が skip
//      (= 高 accuracy 値由来の誤加算が distance_m に流入しない)
//   2. GPS jump (= 物理速度上限超過) で _trackHaversineBetweenGps が物理上限 skip
//   3. GPS 空白 5 秒で gap fill 発火 (= L824 distance_m += filled)
//   4. GPS 空白中 lastSpeedKmh=0 で gap fill 停止 (= L744 null 返却)
//
// ★ bug-patterns/gps-accuracy.yml (GPS-ACC-001) + sensor-dropout.yml (SENS-DROP-001) 対応

import { test, expect } from '@playwright/test';

async function setupBusinessPage(page) {
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
  await page.evaluate(() => {
    if (typeof onBusinessStart === 'function') onBusinessStart();
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    if (typeof onMainBtn === 'function') onMainBtn();
    if (typeof Meter !== 'undefined' && typeof Meter.start === 'function') Meter.start();
  });
  await page.waitForTimeout(200);
}

async function teardownPage(page) {
  page.once('dialog', (d) => d.accept());
  await page.evaluate(() => {
    if (typeof onBusinessEnd === 'function') onBusinessEnd();
  });
}

test('sensor-edge: accuracy>50m の GPS で gap fill 経路が動作・他経路は accuracy ガード適用', async ({
  page,
}) => {
  await setupBusinessPage(page);

  const result = await page.evaluate(() => {
    Meter.setDistance(0);
    const baseTs = Date.now();
    // 初回: accuracy=5 で state.last_gps セット (= 通常 GPS)
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: baseTs,
    });
    const afterStep1 = Meter.getState().distance_m;

    // 2 ステップ目: accuracy=60 (= >50m) で 1 秒後
    // L254-255 / L302-303 のガードで _haverAccumSinceLastCommit / Off-Road 加算なし
    Meter.update({
      lat: 33.84001,
      lng: 132.7656,
      accuracy: 60,
      speedKmh: 60,
      isStationary: false,
      timestamp: baseTs + 1000,
    });
    const afterStep2 = Meter.getState().distance_m;

    // 3 ステップ目も accuracy=60・1 秒後 (= dtSec=1・gap fill 閾値 5 未満)
    Meter.update({
      lat: 33.84002,
      lng: 132.7656,
      accuracy: 60,
      speedKmh: 60,
      isStationary: false,
      timestamp: baseTs + 2000,
    });
    const afterStep3 = Meter.getState().distance_m;

    return { afterStep1, afterStep2, afterStep3 };
  });

  // E2E は実 mmWorker あり・道路未ロード (roadsLoading) のため loadfill (2026-06-07 新設) が
  // dtSec=1 でも speed×時間 (60km/h×1s≈16.7m) を計上する。★加算は speed×時間のみで
  // GPS 直線 (haversine) は混入しない保証は不変★ (accuracy=60 でも速度由来のみ)。
  expect(result.afterStep1).toBe(0);
  expect(result.afterStep2).toBeGreaterThan(10);
  expect(result.afterStep2).toBeLessThan(25);
  expect(result.afterStep3).toBeGreaterThan(25);
  expect(result.afterStep3).toBeLessThan(45);

  await teardownPage(page);
});

test('sensor-edge: GPS jump (物理速度上限超過) で haversine buffer に加算されない', async ({
  page,
}) => {
  await setupBusinessPage(page);

  const result = await page.evaluate(() => {
    Meter.setDistance(0);
    const baseTs = Date.now();
    // 初期座標
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: baseTs,
    });

    // 1 秒後に 500m ジャンプ (= 速度換算 1800 km/h・物理上限 160 km/h を遥かに超過)
    // _trackHaversineBetweenGps の物理上限ガード (= 160/3.6*1 + 5 ≈ 49.4m) で skip
    Meter.update({
      lat: 33.84 + 0.0045, // 約 500m 北
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: baseTs + 1000,
    });
    const afterJump = Meter.getState().distance_m;

    return { afterJump };
  });

  // ★500m ジャンプ直線が混入していないことが本質★ (= 加算は speed×時間のみ)。
  // E2E は roadsLoading のため loadfill が speed×時間 (60km/h×1s≈16.7m) を計上する
  // (2026-06-07 新設)。ジャンプ由来の ~500m が乗らないことを上限 50m で保証。
  expect(result.afterJump).toBeGreaterThan(10);
  expect(result.afterJump).toBeLessThan(50);

  await teardownPage(page);
});

test('sensor-edge: GPS 空白 5 秒以上で gap fill 発火・distance_m 増加', async ({ page }) => {
  await setupBusinessPage(page);

  const result = await page.evaluate(() => {
    Meter.setDistance(0);
    const baseTs = Date.now();
    // 初期 GPS (= speedKmh=60 で state.last_speed_kmh セット)
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: baseTs,
    });
    const beforeGap = Meter.getState().distance_m;

    // 10 秒後 (= dtSec=10 > GAP_THRESHOLD_SEC=5) → gap fill 発火
    Meter.update({
      lat: 33.84001,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: baseTs + 10000,
    });
    const afterGap = Meter.getState().distance_m;
    const distanceSource = Meter.getState().distanceSource;

    return { beforeGap, afterGap, distanceSource };
  });

  expect(result.beforeGap).toBe(0);
  // 60 km/h × 10 sec = 166.7m (= 物理上限 clamp 内)
  expect(result.afterGap).toBeGreaterThan(100);
  expect(result.afterGap).toBeLessThan(500);
  // E2E は実 mmWorker あり・道路未ロード (roadsLoading) のため 'loadfill' (2026-06-07 新設)
  expect(result.distanceSource).toBe('loadfill');

  await teardownPage(page);
});

test('sensor-edge: GPS 空白中 lastSpeedKmh=0 で gap fill 停止 (= 停車中 GPS 消失で誤加算しない)', async ({
  page,
}) => {
  await setupBusinessPage(page);

  const result = await page.evaluate(() => {
    Meter.setDistance(0);
    const baseTs = Date.now();
    // 初期 GPS (= speedKmh=0 で state.last_speed_kmh=0)
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 0,
      isStationary: false,
      timestamp: baseTs,
    });
    const beforeGap = Meter.getState().distance_m;

    // 10 秒後 (= dtSec=10 > GAP_THRESHOLD_SEC=5) だが lastSpeedKmh=0 で gap fill null 返却
    Meter.update({
      lat: 33.84001,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 0,
      isStationary: false,
      timestamp: baseTs + 10000,
    });
    const afterGap = Meter.getState().distance_m;

    return { beforeGap, afterGap };
  });

  // 停車中 GPS 消失では gap fill が null 返却・distance_m 不変
  expect(result.beforeGap).toBe(0);
  expect(result.afterGap).toBe(0);

  await teardownPage(page);
});
