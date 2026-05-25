// tests/e2e/install-offline-reopen-flow.spec.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step ㉚ / 全32件・真の完全網羅 2/4)
//
// 検証対象: PWA install → offline → reopen → 47県 cache 起動の完全 flow
//   sw.js PRECACHE で全国共通バンドル DL → offline 化 → reopen → アプリ起動
//
// 絶対ルール準拠:
//   js/sw.js は触らない absolute・E2E で動作のみ verify。
//
// 注: Playwright で SW 制御は context.setOffline で offline 化のみ・実 install フローは
//   ブラウザ依存で完全 reproduce 困難。本 spec は「offline 状態でも基本起動 + cache 利用」
//   の確認に focus。

import { test, expect } from '@playwright/test';

test('install→offline→reopen: SW + cache でオフラインでも起動可能', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  // ─── 段階 1: 通常起動 (= cache に PRECACHE) ──
  await page.addInitScript(() => {
    sessionStorage.setItem('sensor_permission_active', '1');
    sessionStorage.setItem('sensorGranted', '1');
    localStorage.setItem('daikome_training_consent', 'dismissed');
    localStorage.setItem('pwa_banner_dismissed', '1');
    localStorage.setItem('apk_banner_dismissed', '1');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // SW 登録待ち
  await page.waitForTimeout(2000);

  // SW が active であることを verify
  const swActive = await page.evaluate(async () => {
    if (!navigator.serviceWorker) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(reg && (reg.active || reg.installing || reg.waiting));
  });
  expect(swActive).toBe(true);

  // ─── 段階 2: cache 状態 verify ──
  const cacheNames = await page.evaluate(async () => {
    if (!('caches' in self)) return [];
    return await caches.keys();
  });
  // 少なくとも 1 つの daikome cache が存在
  const hasDaikomeCache = cacheNames.some((n) => /daikome/.test(n));
  expect(hasDaikomeCache).toBe(true);

  // ─── 段階 3: offline 化 + reopen ──
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });

  // offline でも HTML が読まれる (= SW cache から) ことを verify
  const titleAfter = await page.title();
  expect(titleAfter.length).toBeGreaterThan(0);

  // ─── 段階 4: 起動完了 verify (= Meter / Business 等のグローバル存在) ──
  await page.waitForTimeout(2000);
  const apiReady = await page.evaluate(() => ({
    Meter: typeof Meter !== 'undefined',
    Business: typeof Business !== 'undefined',
    GPS: typeof GPS !== 'undefined',
  }));
  // offline でも JS は cache から読まれて API が定義される
  expect(apiReady.Meter).toBe(true);
  expect(apiReady.Business).toBe(true);
  expect(apiReady.GPS).toBe(true);

  await context.setOffline(false);
  await context.close();
});
