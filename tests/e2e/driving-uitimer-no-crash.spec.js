// 走行中 uiTimer クラッシュ回帰ガード E2E (2026-05-30)
//   Sentry DAIKOME-4 "ReferenceError: Can't find variable: total" (本番 index.html:6981) の再発防止。
//   _renderMeterReadout 一本化で uiTimer 内の fare/extraTotal/total 算出が消え、参照だけ残り
//   走行中の setInterval(100ms) が毎 tick throw していた。setInterval の throw はテストを
//   落とさない (= flow-standard が緑のまま見逃した) ため、★page.on('pageerror') で能動捕捉★する。
//
//   ★このテストは index.html インライン JS が eslint no-undef 検査外であることの保険でもある。★
/* eslint-disable no-undef -- page.evaluate() 内はブラウザ(page)コンテキストの app グローバル(appState/startUiTimer 等)を参照する */
import { test, expect } from '@playwright/test';

test('driving-uitimer-no-crash: 代行開始後の uiTimer が ReferenceError を投げない (Sentry DAIKOME-4 回帰)', async ({
  page,
}) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message ? err.message : err)));

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
    if (typeof updateStartButtonsGate === 'function') updateStartButtonsGate();
  });

  // ★uiTimer を確実に起動する★: E2E headless では onMainBtn() が blockIfSensorNotGranted()
  //   でブロックされ driving に入らない (= uiTimer 未起動で crash を見逃す)。よって
  //   appState=driving + Meter.start() + startUiTimer() を直接呼び、本番の走行ループを忠実に再現する。
  await page.evaluate(() => {
    appState = 'driving';
    extras = [];
    surchargeOn = false;
    if (typeof Meter !== 'undefined' && typeof Meter.start === 'function') Meter.start();
    if (typeof startUiTimer === 'function') startUiTimer();
  });

  // ★uiTimer(100ms) を十分回す★: 6981 の総走行 localStorage 保存・6969 FB 送信 を含む
  //   走行分岐が ReferenceError なく回ることを確認 (= Sentry DAIKOME-4 の発火点)。
  await page.waitForTimeout(800);

  // 確定画面分岐 (appState==='fare') の total 参照も踏む (6947-6948)。
  await page.evaluate(() => {
    appState = 'fare';
  });
  await page.waitForTimeout(400);

  const relevant = pageErrors.filter((m) =>
    /Can't find variable|is not defined|ReferenceError/i.test(m)
  );
  expect(
    relevant,
    '走行中/確定画面の uiTimer が ReferenceError を投げた (Sentry DAIKOME-4 系再発): ' +
      JSON.stringify(pageErrors)
  ).toEqual([]);
});
