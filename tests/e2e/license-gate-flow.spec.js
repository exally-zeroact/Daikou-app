// ライセンス会社URL/署名方式(STEP3) 実ブラウザ配線テスト (2026-07-27)。
//   scripts(nacl/license-v2/license-activate)読込・ゲートON/OFF・活性化・「業務中は絶対止めない」を検証。
//   ★fetchはmock(本番Edge Function/席を消費しない)。トークンは実秘密鍵署名の固定値。★
import { test, expect } from '@playwright/test';

const REAL_TOKEN =
  'eyJjb21wYW55X2lkIjoidGVzdC1jbyIsImRldmljZV9pZCI6InRlc3QtZGV2IiwidmluIjoiIiwic3RhdHVzIjoib24iLCJleHAiOjQxMDI0NDQ4MDAwMDB9.qimvECoMnLyFglSQU79LmtLVk65nP2mlb62A3tXtse7-ZFKZRB5HVUiSvyUTKNBFuoM1H1B2tq6mPTWyDCWYBQ';

async function boot(page) {
  await page.addInitScript(() => {
    localStorage.setItem('daikome_training_consent', 'dismissed');
    localStorage.setItem('pwa_banner_dismissed', '1');
    localStorage.setItem('apk_banner_dismissed', '1');
    localStorage.setItem('tutorial_done', '1');
    sessionStorage.setItem('sensor_permission_active', '1');
    sessionStorage.setItem('sensorGranted', '1');
  });
}

test('scripts(nacl/LicenseV2/LicenseActivate)読込 + pageエラー無し', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await boot(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const defs = await page.evaluate(() => ({
    nacl: !!(window.nacl && window.nacl.sign),
    la: typeof window.LicenseActivate,
    verify: !!(window.LicenseV2 && window.LicenseV2.verifyLicenseTokenEmbedded),
  }));
  expect(defs.nacl).toBe(true);
  expect(defs.la).toBe('object');
  expect(defs.verify).toBe(true);
  expect(errs).toEqual([]);
});

test('ゲートON + 無ライセンス: allowed=false / 業務中(running)は allowed=true(絶対止めない)', async ({
  page,
}) => {
  await boot(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  const r = await page.evaluate(async () => {
    localStorage.setItem('DK_LICENSE_GATE_ON', '1');
    localStorage.removeItem('dk_license_token');
    await window.LicenseActivate._refresh();
    const off = window.LicenseActivate.checkBeforeBusinessStart(false);
    const on = window.LicenseActivate.checkBeforeBusinessStart(true);
    return { offAllowed: off.allowed, offState: off.state, onAllowed: on.allowed };
  });
  expect(r.offAllowed).toBe(false);
  expect(r.offState).toBe('unlicensed');
  expect(r.onAllowed).toBe(true);
});

test('活性化(mock): 会社URLで有効化→active/allowed・トークンcache', async ({ page }) => {
  await page.addInitScript((tok) => {
    const orig = window.fetch;
    window.fetch = async (url, opt) => {
      if (String(url).includes('dk-issue-license'))
        return { json: async () => ({ ok: true, token: tok }) };
      return orig(url, opt);
    };
  }, REAL_TOKEN);
  await boot(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  const r = await page.evaluate(async () => {
    const a = await window.LicenseActivate.activate('b0abbb5305c61686ed939e0f48737641');
    const g = window.LicenseActivate.checkBeforeBusinessStart(false);
    return {
      ok: a.ok,
      state: g.state,
      allowed: g.allowed,
      cached: !!localStorage.getItem('dk_license_token'),
    };
  });
  expect(r.ok).toBe(true);
  expect(r.state).toBe('active');
  expect(r.allowed).toBe(true);
  expect(r.cached).toBe(true);
});

test('活性化(mock): 台数上限 seat_limit は弾く(有効にならない)', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.fetch;
    window.fetch = async (url, opt) => {
      if (String(url).includes('dk-issue-license'))
        return { json: async () => ({ ok: false, reason: 'seat_limit', seat_limit: 4 }) };
      return orig(url, opt);
    };
  });
  await boot(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  const r = await page.evaluate(async () => {
    const a = await window.LicenseActivate.activate('b0abbb5305c61686ed939e0f48737641');
    const g = window.LicenseActivate.checkBeforeBusinessStart(false);
    return { ok: a.ok, reason: a.reason, allowed: g.allowed };
  });
  expect(r.ok).toBe(false);
  expect(r.reason).toBe('seat_limit');
  expect(r.allowed).toBe(false);
});
