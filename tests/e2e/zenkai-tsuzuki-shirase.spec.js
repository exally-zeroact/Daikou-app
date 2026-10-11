// ============================================================
// ★「前回の続きから ◯円 / ◯km」が 走行画面に 本当に 出る★（2026-10-11）
//
//   メーターの 控え（dk_meter_snapshot）から 同じ 代行の 料金を 戻した 時、
//   js/meter-persist.js は「黙って 金額を 戻さない・運転手が 目で 見て 違えば 止められる」ために
//   知らせの 字を 返す。前は index.html が window._showToast（設定画面の 塊で 後から 置かれる・
//   箱も 設定画面の 中）を 呼んでいて、一度も 出ていなかった。
//   門（meter-persist-wiring）は 字の 有る無しだけを 見ていたので 緑の まま 割れていた。
//   ここでは 本物の 画面を 開き直し、#toast の 字と 見えているかで 縛る。
// ============================================================
/* global Business -- page.evaluate() 内は 画面の app グローバルを 読む */
const { test, expect } = require('@playwright/test');

test('タスクキルの 後に 開き直すと「前回の続きから」が 走行画面の トーストに 出る', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const plan = sessionStorage.getItem('zenkai_plan');
    if (!plan) return;
    sessionStorage.removeItem('zenkai_plan');
    const { biz, trip } = JSON.parse(plan);
    const now = Date.now();
    localStorage.setItem(
      'daikou_driving_state',
      JSON.stringify({ distance_m: 3000, fare_yen: 1850, saved_at: now - 5000, elapsed_sec: 900 })
    );
    localStorage.setItem(
      'dk_meter_snapshot',
      JSON.stringify({
        v: 1,
        saved_at: now - 5000,
        business_start_time: biz,
        trip_start_time: trip,
        distance_m: 3000,
        business_distance_m: 5000,
        elapsed_accumulated_sec: 900000,
        fare_yen: 1850,
        wait_sec: 0,
        running: true,
        business_active: true,
        billing_frozen: false,
      })
    );
  });
  await page.goto('/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof Business !== 'undefined' && typeof Meter !== 'undefined');
  await page.evaluate(() => {
    Business.start();
    Business.onTripStart(35, 135, 10);
    Business.save();
    sessionStorage.setItem(
      'zenkai_plan',
      JSON.stringify({
        biz: Business.getState().start_time,
        trip: Business.getCurrentTrip().start_time,
      })
    );
  });
  await page.reload({ waitUntil: 'load' });

  const toast = page.locator('#toast');
  await expect(toast).toContainText('前回の続きから', { timeout: 4000 });
  await expect(toast).toContainText('1,850円');
  await expect(toast).toContainText('3.0km');
  await expect(toast).toHaveClass(/show/);
  await expect(toast).toBeVisible();
});
