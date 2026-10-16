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
  // ★倉庫（*.supabase.co）へは 圏外と 同じ 失敗を 返す★ 2026-10-17
  //   WebKit の 組は 本物の 倉庫へ 行かせない 為に 外を 届かない 代理に 向けている。代理で 落ちた 事前問い合わせを、
  //   WebKit は アプリが 捕まえた 後でも「…due to access control checks.」の page エラーとして 出し、Linux の CI で 2回とも 赤だった。
  //   手元の webkit で 測った：捕まえた 失敗は abort なら page エラー 0件・捕まえない 失敗は abort でも「TypeError: Load failed」で 赤
  //   ＝この 見張りは アプリの 捕まえていない 失敗を 今まで通り 赤に する。service worker が 握っても 効く 様に context で 止める。
  //   ★わざと壊して 赤に なった 記録（2026-10-17）★ 止め先の 字を 変えて 1本も 止まらない 形に する ⇒ 赤
  //     （「倉庫への 要求が 1本も 止まっていない」・chromium で 確かめた）。戻すと 緑。
  let tometa = 0;
  await page.context().route(/\.supabase\.co\//, (r) => {
    tometa++;
    return r.abort('internetdisconnected');
  });
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
  // ★止めが 1回も 効いていない まま 緑に しない★（倉庫への 要求が 出て、圏外の 失敗を 返した 後で エラーを 数える・指示役）
  await expect
    .poll(() => tometa, {
      timeout: 10000,
      message: '★倉庫への 要求が 1本も 止まっていない（この 見張りの 前提が 無い）★',
    })
    .toBeGreaterThan(0);
  await page.waitForTimeout(500);
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
