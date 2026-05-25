// 標準業務フロー E2E (2026-05-15・動的解析 ②)
// 業務開始 → 代行開始 → 業務終了 のクリック経路を headless chromium で再現
// Geolocation は実機 GPS 不能のため未モック・短時間走行で内部 timer/state 遷移確認のみ
import { test, expect } from '@playwright/test';

test('flow-standard: 業務開始 → 代行開始 → 業務終了 サマリー表示', async ({ page }) => {
  // 許可済み状態 + DL/banner 各種スキップを sessionStorage / localStorage 注入
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
  // DL overlay / 各種 banner を強制非表示 (E2E 上は MM pipeline を起動しないため)
  await page.evaluate(() => {
    const ids = ['dlOverlay', 'trainingConsentBanner', 'pwaBanner', 'apkBanner', 'sensorRestoreBanner'];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    // E2E 上は MM warmup pipeline を待たない・業務開始ボタンを強制表示
    if (typeof showScreen === 'function') showScreen('businessStart');
    const _bs = document.getElementById('screenBusinessStart');
    if (_bs) _bs.style.display = 'flex';
    const _btn = document.querySelector('#screenBusinessStart .btn-business-start');
    if (_btn) _btn.style.display = '';
    if (typeof updateStartButtonsGate === 'function') updateStartButtonsGate();
  });

  // 業務開始 → 代行開始 を直接ハンドラ呼出 (E2E では UI 表示状態が pipeline 進捗に依存するため
  // クリックではなく公開関数を直接呼ぶ・全 OS で同じ・本テストは「フロー疎通」確認に絞る)
  await page.evaluate(() => {
    if (typeof onBusinessStart === 'function') onBusinessStart();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    if (typeof onMainBtn === 'function') onMainBtn();
  });

  // Meter 起動確認のため 500ms 待機
  await page.waitForTimeout(500);

  // 業務終了 (確認 dialog 承認 + 直接ハンドラ呼出)
  page.once('dialog', (d) => d.accept());
  await page.evaluate(() => {
    if (typeof onBusinessEnd === 'function') onBusinessEnd();
  });
  await page.waitForTimeout(200);

  // 業務終了後の到達状態を確認 (screenBusinessReport が表示 or appState='businessReport')
  // E2E では Meter が GPS なしで実車にならないため、実距離 0 で業務終了する経路を踏む。
  // 司さん仕様: onBusinessEnd → screenBusinessReport へ遷移するため appState を直接確認。
  const finalState = await page.evaluate(() => {
    return {
      appState: typeof appState !== 'undefined' ? appState : null,
      reportVisible: (() => {
        const el = document.getElementById('screenBusinessReport');
        return el ? getComputedStyle(el).display !== 'none' : false;
      })(),
      fareEl: (() => {
        const el = document.getElementById('fareTotalYen');
        return el ? (el.textContent || '').toString() : null;
      })(),
    };
  });
  // 業務終了が走った証跡: appState=businessReport もしくは screenBusinessReport visible
  expect(
    finalState.appState === 'businessReport' || finalState.reportVisible === true
  ).toBe(true);
  // #fareTotalYen 要素は home に存在し ¥ 表示 (toLocaleString) の数値が入る
  expect(finalState.fareEl).not.toBeNull();
});
