/* global showScreen, updateStartButtonsGate, onBusinessStart, onMainBtn, onBusinessEnd */
// tests/e2e/stationary-real-pipeline.spec.js
//
// ★設計変更宣言 (2026-05-28・新構造対応): e2e stationary を「isStationary 注入」 から
//   「実 GPS pipeline 経由」 に置換。context.setGeolocation で navigator.geolocation の
//   watchPosition を駆動し・実 gps.js (Fix③ throttle 含む) → 実 gps-worker.js (Fix①②) →
//   実 meter.js を通して isStationary を ★worker に判定させる★。
//
//   従来 (stationary-no-increase.spec.js): Meter.update({isStationary:true}) を直接注入し・
//     meter のゲートだけ検証していた (= 判定プロセスは通らない)。
//   本 spec: setGeolocation で raw GPS を流し・accel は注入しない (= iOS DeviceMotion 拒否相当・
//     Fix① の位置半径 fallback 経路) で・creep=0 を実 pipeline で確認する。
//
//   絶対ルール準拠: js/*.js 本体は 1 byte 不変・e2e の test 追加のみ。

import { test, expect } from '@playwright/test';

test('stationary-real-pipeline: setGeolocation 経由で実 GPS層を駆動・creep=0 (注入なし)', async ({
  browser,
}) => {
  const context = await browser.newContext({
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

  // 業務開始 (Business.start → Meter.setBusinessActive(true))
  await page.evaluate(() => {
    if (typeof onBusinessStart === 'function') onBusinessStart();
  });
  await page.waitForTimeout(200);
  // 代行開始 (Meter.start・running=true) は呼ばない (= 空車 phase で creep 検証)
  // ただし GPS.start 経路を発火させるため onMainBtn 経由で Meter.start を呼ぶ
  await page.evaluate(() => {
    if (typeof onMainBtn === 'function') onMainBtn();
    if (typeof Meter !== 'undefined' && typeof Meter.start === 'function') Meter.start();
  });
  await page.waitForTimeout(300);

  // 事前 setDistance なし (= 完全ゼロから start) で・business_distance_m を観測
  const before = await page.evaluate(() => {
    const s = Meter.getState();
    return { dist: s.distance_m, biz: s.business_distance_m || 0 };
  });

  // ★ setGeolocation で同位置を小漂流付きで 8 秒間流す (= watchPosition 駆動)
  //   accel は注入しない → 実 GPS pipeline で・accel-null fallback (Fix①(c) 位置半径) 経路。
  //   posStationary は 5 秒継続 + radius<3m で確定する設計。
  const baseLat = 33.84;
  const baseLng = 132.7656;
  // 微小 drift (= 1.5m 程度) を入れた 8 ポジションを 1 秒間隔で流す
  // (drift < radius 3m なので posStationary=true 確定が期待値)
  for (let i = 0; i < 8; i++) {
    // ±1.5m の微小 drift (簡略: 緯度方向)
    const dLat = (((i % 4) - 1.5) * 1.5) / 111132.954;
    await context.setGeolocation({
      latitude: baseLat + dLat,
      longitude: baseLng,
      accuracy: 5,
    });
    await page.waitForTimeout(1000);
  }

  const after = await page.evaluate(() => {
    const s = Meter.getState();
    const ls =
      typeof window !== 'undefined' && window._lastStationary != null
        ? window._lastStationary
        : null;
    return {
      dist: s.distance_m,
      biz: s.business_distance_m || 0,
      lastStationary: ls,
    };
  });

  // ★creep=0 gate: 8 秒の同位置 setGeolocation で business_distance_m が増えない
  //   (= 実 gps-worker.js の posStationary fallback が isStationary=true を返し・
  //    meter の haversine 業務経路 (L351 isStationary gate) で加算 0)
  // (許容: 微小 drift 由来で 1m 程度の累積は想定範囲・誤判定なら 数 m〜数十 m 級に膨らむ)
  const creepBiz = after.biz - before.biz;
  const creepDist = after.dist - before.dist;
  expect(creepDist).toBeLessThanOrEqual(2); // 距離 (5 経路) も creep=0
  expect(creepBiz).toBeLessThanOrEqual(5); // 業務総走行・小 drift 由来の僅少加算は許容

  // 業務終了
  page.once('dialog', (d) => d.accept());
  await page.evaluate(() => {
    if (typeof onBusinessEnd === 'function') onBusinessEnd();
  });
  await context.close();
});
