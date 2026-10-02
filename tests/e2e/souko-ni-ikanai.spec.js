// ============================================================
// ★★見張り：試験から 本物の 倉庫（*.supabase.co）へ 1本も 届かない★★ 2026-10-02
//
//   本番の repo の 試験で 実測：アプリを 開くだけで 本物の 本番倉庫へ 4本 出ていた
//   （dk-fare-config / dk_check_device_license / ★dk-issue-license★ / dk-customers）。
//   ＝試験が 本番の 倉庫に 端末の 許可を 書き込める 形。
//   playwright.config.js の --host-resolver-rules で 住所を「見つからない」に した。
//   ここでは ★アプリを 開いて 倉庫へ 届いた 数が 0★ を 数える（設定の 字では なく 通信で 見る）。
//
//   ★わざと壊して 赤に なるのを 見た（2026-10-02 実測）★
//     設定を 外す ⇒ 届いた 4 ／ 落ちた 0 ⇒ ★赤★
//     設定 在り   ⇒ 届いた 0 ／ 落ちた 4 ⇒ 緑
// ============================================================
const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 390, height: 844 } });

test('★アプリを 開いても 本物の 倉庫へ 1本も 届かない★', async ({ page }) => {
  const kazu = { todoita: 0, ochita: 0 };
  page.on('requestfinished', (r) => {
    if (/\.supabase\.co\//.test(r.url())) kazu.todoita++;
  });
  page.on('requestfailed', (r) => {
    if (/\.supabase\.co\//.test(r.url())) kazu.ochita++;
  });
  await page.addInitScript(() => {
    sessionStorage.setItem('sensorGranted', '1');
    sessionStorage.setItem('dl_just_completed', '1');
    localStorage.setItem('tutorial_done', '1');
    localStorage.setItem('dk_license_company', 'e2e-kaisha');
    localStorage.setItem('DAIKOME_DEVICE_ID', 'e2e-tanmatsu');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // ★空回り していない★＝アプリは 倉庫へ 行こうと している（落ちた 数が 1本 以上）
  await expect
    .poll(() => kazu.ochita + kazu.todoita, {
      timeout: 15000,
      message: '★アプリが 倉庫へ 1本も 行こうと しない＝この 見張りは 何も 見ていない★',
    })
    .toBeGreaterThan(0);
  await page.waitForTimeout(2000);
  expect(kazu.todoita, '★試験から 本物の 倉庫へ 届いた（本番の 倉庫を 触る 恐れ）★').toBe(0);
});
