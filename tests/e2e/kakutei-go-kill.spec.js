// ============================================================
// ★確定した 後に アプリが 落ちても、開き直すと 確定画面・確定額の まま★（2026-10-11）
//
//   前は checkDrivingRestore の Meter.start() で 料金の 凍結が 外れ、走行画面に 戻っていた。
//   停車中の 待機と 動いた 距離が 確定額の 上に 積み増され、客の 払いが 確定額より 上がりえた。
//   メーターの 控え（dk_meter_snapshot）の billing_frozen を 同じ 代行の 時だけ 戻し、確定画面へ 戻す。
// ============================================================
/* eslint-disable no-undef -- page.evaluate() 内はブラウザ(page)コンテキストの app グローバルを参照する */
import { test, expect } from '@playwright/test';

test('確定 → 落ちる → 開き直す で 確定画面・同じ 額・凍結の まま', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('sensor_permission_active', '1');
    sessionStorage.setItem('sensorGranted', '1');
    sessionStorage.setItem('dl_just_completed', '1');
    localStorage.setItem('daikome_training_consent', 'dismissed');
    localStorage.setItem('pwa_banner_dismissed', '1');
    localStorage.setItem('apk_banner_dismissed', '1');
    localStorage.setItem('tutorial_done', '1');
  });
  await page.goto('/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof Business !== 'undefined' && typeof Meter !== 'undefined');
  const mae = await page.evaluate(() => {
    Business.start();
    Business.onTripStart(35, 135, 10);
    appState = 'driving';
    extras = [];
    surchargeOn = false;
    Meter.start();
    Meter.setDistance(3000);
    if (typeof startUiTimer === 'function') startUiTimer();
    onSend(); // 確定
    _saveMeterSnapshot();
    Business.save();
    return {
      appState,
      frozen: Meter.getState().billing_frozen,
      fare: Meter.getState().fare_yen,
    };
  });
  expect(mae.appState).toBe('fare');
  expect(mae.frozen).toBe(true);
  await page.waitForTimeout(300); // 刻みが daikou_driving_state を 書く

  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof Meter !== 'undefined' && appState !== 'idle', null, {
    timeout: 5000,
  });
  const ato = await page.evaluate(() => ({
    appState,
    frozen: Meter.getState().billing_frozen,
    fare: Meter.getState().fare_yen,
  }));
  expect(ato.appState).toBe('fare');
  expect(ato.frozen).toBe(true);
  expect(ato.fare).toBe(mae.fare);
});

test('確定 → 走行に戻る → すぐ 落ちる で 走行画面・凍結なし', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('sensor_permission_active', '1');
    sessionStorage.setItem('sensorGranted', '1');
    sessionStorage.setItem('dl_just_completed', '1');
    localStorage.setItem('daikome_training_consent', 'dismissed');
    localStorage.setItem('pwa_banner_dismissed', '1');
    localStorage.setItem('apk_banner_dismissed', '1');
    localStorage.setItem('tutorial_done', '1');
  });
  await page.goto('/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof Business !== 'undefined' && typeof Meter !== 'undefined');
  await page.evaluate(() => {
    Business.start();
    Business.onTripStart(35, 135, 10);
    appState = 'driving';
    extras = [];
    surchargeOn = false;
    Meter.start();
    Meter.setDistance(3000);
    if (typeof startUiTimer === 'function') startUiTimer();
    onSend(); // 確定
    _saveMeterSnapshot(); // 確定の 間に GPS が 来て 控えに「確定」が 書かれた
    Business.save();
    cancelFare(); // 走行に戻る → 次の GPS の 前に 落ちる
    // 落ちる＝画面が 隠れる・pagehide での 書き直しは 起きない（ここから 先は 書かせない）
    window.removeEventListener('pagehide', _saveMeterSnapshot);
    _saveMeterSnapshot = function () {};
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof Meter !== 'undefined' && appState !== 'idle', null, {
    timeout: 5000,
  });
  const ato = await page.evaluate(() => ({ appState, frozen: Meter.getState().billing_frozen }));
  expect(ato.appState).toBe('driving');
  expect(ato.frozen).toBe(false);
});
