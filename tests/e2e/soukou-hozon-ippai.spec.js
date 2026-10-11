// ============================================================
// ★走行中に 端末の 保存場所が 一杯でも、走行の 刻みが 例外を 撒かない★（2026-10-11）
//
//   走行中の 刻み（uiTimer・100ms）は daikou_driving_state を 書く 時に 捕まえて いなかった。
//   保存場所が 一杯だと 毎秒10回 例外が 上がっていた（Sentry にも 流れる）。
//   運転手への 知らせは 同じ 時に 落ちる Business.save の onHozonShippai（1業務に1回）が 出すので、
//   ここでは 新しい 知らせを 作らない。その 知らせが 出る事も 一緒に 縛る。
// ============================================================
/* eslint-disable no-undef -- page.evaluate() 内はブラウザ(page)コンテキストの app グローバル(appState/startUiTimer 等)を参照する */
import { test, expect } from '@playwright/test';

test('保存場所が 一杯の 走行中: 刻みは 例外を 出さず、業務の 保存失敗の 知らせが 出る', async ({
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
  await page.waitForFunction(() => typeof Business !== 'undefined' && typeof Meter !== 'undefined');
  await page.evaluate(() => {
    Business.start();
    appState = 'driving';
    extras = [];
    surchargeOn = false;
    Meter.start();
    if (typeof startUiTimer === 'function') startUiTimer();
  });
  await page.waitForTimeout(300);

  // ここから 保存場所が 一杯（どの 鍵も 書けない）
  await page.evaluate(() => {
    window.__ippai = 0;
    Storage.prototype.setItem = function () {
      window.__ippai++;
      const e = new Error('QuotaExceededError');
      e.name = 'QuotaExceededError';
      throw e;
    };
  });
  await page.waitForTimeout(1000);
  // 業務の 保存（本番では 1秒ごと）も 同じ 時に 落ちる
  await page.evaluate(() => Business.save());

  const ippai = await page.evaluate(() => window.__ippai);
  expect(ippai, '刻みが 書こうとしていない＝この 試験が 何も 見ていない').toBeGreaterThan(5);
  const quota = pageErrors.filter((m) => /Quota/i.test(m));
  expect(quota, '走行の 刻みが 例外を 撒いた: ' + JSON.stringify(pageErrors)).toEqual([]);
  await expect(page.locator('#toast')).toContainText('保存できませんでした', { timeout: 3000 });
});
