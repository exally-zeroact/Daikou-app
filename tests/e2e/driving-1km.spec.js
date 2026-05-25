/* global showScreen, updateStartButtonsGate, onBusinessStart, onMainBtn, onBusinessEnd, appState */
// tests/e2e/driving-1km.spec.js
// ZEROact 共通テスト基盤 (2026-05-17 新規・Stage 1 Step D) — ダイコメ E2E
//
// シナリオ: 業務開始 → 代行開始 → setDistance で 1km 到達 → 業務終了
//
// 実装方針 (既存 flow-standard.spec.js と同様):
//   ・実 GPS chain (gps.js → Worker A → Meter → Worker B Viterbi) を full warmup させると
//     CI で 30 秒+ かつ memory 重い → setDistance を直接呼んで疎通確認
//   ・本 spec は「Meter.start() → setDistance 1000m → calcFare 計算 → businessEnd」
//     のフロー疎通を verify
//   ・実走 GPS chain の確認は実車テストで担保

import { test, expect } from '@playwright/test';

test('driving-1km: setDistance 1000m → fare_yen 計算 → businessEnd フロー疎通', async ({
  page,
}) => {
  // permission / banner 抑制 (= flow-standard.spec.js 準拠)
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

  // banner / overlay 強制非表示
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

  // 業務開始 → 代行開始 (= 既存 flow と同じ public 関数呼出)
  await page.evaluate(() => {
    if (typeof onBusinessStart === 'function') onBusinessStart();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    if (typeof onMainBtn === 'function') onMainBtn();
    // 保険: E2E では UI 表示状態が pipeline 進捗依存のため Meter.start を直接呼ぶ
    if (typeof Meter !== 'undefined' && typeof Meter.start === 'function') Meter.start();
  });
  await page.waitForTimeout(300);

  // Meter.setDistance で 1km 到達状態を作る
  // (= 実走行 GPS chain の代替・課金ロジック疎通確認用)
  const result = await page.evaluate(() => {
    if (typeof Meter === 'undefined') return { error: 'Meter undefined' };
    Meter.setDistance(1000);
    const state = Meter.getState();
    return {
      distance_m: state.distance_m,
      fare_yen: state.fare_yen,
      running: state.running,
    };
  });

  // 期待: distance_m=1000 / fare_yen=1300 (= base_fare 1000m まで) / running=true
  expect(result.distance_m).toBe(1000);
  expect(result.fare_yen).toBe(1300);
  expect(result.running).toBe(true);

  // さらに走行: setDistance(1420) で base + add_fare 1 回分
  const result2 = await page.evaluate(() => {
    Meter.setDistance(1420);
    return Meter.getState();
  });
  expect(result2.distance_m).toBe(1420);
  // 1420m = base (1300) + add_fare 1 回 (1000m + 420m) = 1400
  expect(result2.fare_yen).toBe(1400);

  // 業務終了
  page.once('dialog', (d) => d.accept());
  await page.evaluate(() => {
    if (typeof onBusinessEnd === 'function') onBusinessEnd();
  });
  await page.waitForTimeout(200);

  // 業務終了後の appState 確認
  const finalState = await page.evaluate(() => {
    return {
      appState: typeof appState !== 'undefined' ? appState : null,
      reportVisible: (() => {
        const el = document.getElementById('screenBusinessReport');
        return el ? getComputedStyle(el).display !== 'none' : false;
      })(),
    };
  });
  expect(finalState.appState === 'businessReport' || finalState.reportVisible === true).toBe(true);
});
