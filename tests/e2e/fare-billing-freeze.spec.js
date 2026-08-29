// ★物差し★ 2026-08-28 … ★確定（凍結）後に 距離が 増えないか を 見ています★
//   ・タクシー認定モード／代行モード の どちらの線でも ありません。
//   ・「確定した後に 1m でも 増えたら 赤」＝★どちらの採点でも 許されない★（司さんの実機報告が 起点）。
/* global showScreen, updateStartButtonsGate, onBusinessStart, onMainBtn */
// 確定(到着)後の課金距離 凍結 回帰テスト (2026-07-23)
// バグ: 確定を押しても精算終了(空車)まで distance_m が加算され続け、停車中のGPS空白復帰等で
//       走ってない距離が総額に乗る過大請求(司さん実機報告「最終にバババ→総額が増えた」)。
// 修正: 確定=freezeBilling で distance_m 加算を凍結・走行に戻る=unfreezeBilling で解除。
import { test, expect } from '@playwright/test';

async function setup(page) {
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
    if (typeof showScreen === 'function') showScreen('businessStart');
    const bs = document.getElementById('screenBusinessStart');
    if (bs) bs.style.display = 'flex';
    if (typeof updateStartButtonsGate === 'function') updateStartButtonsGate();
    if (typeof onBusinessStart === 'function') onBusinessStart();
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    if (typeof onMainBtn === 'function') onMainBtn();
    if (Meter.start) Meter.start();
  });
  await page.waitForTimeout(200);
}

test('確定(freezeBilling)後は distance_m が加算されない・走行に戻る(unfreeze)で再開', async ({
  page,
}) => {
  await setup(page);
  const r = await page.evaluate(() => {
    const out = {};
    Meter.setDistance(0);
    let ts = Date.now();
    // 代行中: 60km/h で走る
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: ts,
    });
    for (let i = 1; i <= 3; i++) {
      ts += 1000;
      Meter.update({
        lat: 33.84 + i * 0.00015,
        lng: 132.7656,
        accuracy: 5,
        speedKmh: 60,
        isStationary: false,
        timestamp: ts,
      });
    }
    out.atConfirm = +Meter.getState().distance_m.toFixed(1);

    // ★確定 = freezeBilling
    Meter.freezeBilling();
    out.frozenFlag = Meter.getState().billing_frozen === true;

    out.waitAtConfirm = +(Meter.getState().wait_sec || 0).toFixed(1);
    // 確定後(支払中): 20秒GPS空白→復帰(速度60誤検出)。凍結中なので加算されないはず。
    ts += 20000;
    Meter.update({
      lat: 33.8405,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: ts,
    });
    // さらに通常走行の点も来るが凍結中は無視
    ts += 1000;
    Meter.update({
      lat: 33.8407,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: ts,
    });
    // 停車点(速度0)も注入=待機時間も凍結中は伸びないはず
    for (let i = 0; i < 3; i++) {
      ts += 5000;
      Meter.update({
        lat: 33.8407,
        lng: 132.7656,
        accuracy: 5,
        speedKmh: 0,
        isStationary: true,
        timestamp: ts,
      });
    }
    out.afterFreeze = +Meter.getState().distance_m.toFixed(1);
    out.waitAfterFreeze = +(Meter.getState().wait_sec || 0).toFixed(1);

    // ★走行に戻る = unfreezeBilling → 再び加算されるはず
    Meter.unfreezeBilling();
    out.unfrozenFlag = Meter.getState().billing_frozen === false;
    ts += 1000;
    Meter.update({
      lat: 33.8409,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: ts,
    });
    ts += 1000;
    Meter.update({
      lat: 33.8411,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: ts,
    });
    out.afterUnfreeze = +Meter.getState().distance_m.toFixed(1);
    return out;
  });

  // 凍結フラグが立つ
  expect(r.frozenFlag).toBe(true);
  // ★核心★: 確定(凍結)後は distance_m が1mも増えない (旧実装では +330m 過大注入していた)
  expect(r.afterFreeze).toBe(r.atConfirm);
  // 待機時間も凍結後は伸びない (確定で総額=距離+待機とも完全ロック)
  expect(r.waitAfterFreeze).toBe(r.waitAtConfirm);
  // 解除フラグが下りる
  expect(r.unfrozenFlag).toBe(true);
  // 走行に戻ると再び加算される
  expect(r.afterUnfreeze).toBeGreaterThan(r.atConfirm);
});

test('確定→精算終了(reset)で凍結解除され次の代行に持ち越さない', async ({ page }) => {
  await setup(page);
  const r = await page.evaluate(() => {
    Meter.setDistance(0);
    const ts = Date.now();
    Meter.update({
      lat: 33.84,
      lng: 132.7656,
      accuracy: 5,
      speedKmh: 60,
      isStationary: false,
      timestamp: ts,
    });
    Meter.freezeBilling();
    const frozen = Meter.getState().billing_frozen;
    // 精算終了相当: stop + reset
    Meter.stop();
    Meter.reset();
    const afterReset = Meter.getState().billing_frozen;
    // 次の代行開始
    Meter.start();
    const afterStart = Meter.getState().billing_frozen;
    return { frozen, afterReset, afterStart };
  });
  expect(r.frozen).toBe(true);
  expect(r.afterReset).toBe(false); // reset で解除
  expect(r.afterStart).toBe(false); // 代行開始でも解除(安全ベルト)
});
