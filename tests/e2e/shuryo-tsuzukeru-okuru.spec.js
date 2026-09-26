// tests/e2e/shuryo-tsuzukeru-okuru.spec.js
// ============================================================
// ★本物のブラウザで [業務終了] → (アプリが 自分で 送信) → ★[続ける]ボタンを 押す★
//   → [業務終了] → ★事務所へ 出て行く POST の 中身★ を 読む（2026-09-26）★
//
//   司さん「従業員が オフラインで 使って Wi-Fi 繋いでから 業務終了したら
//           何件か（はっきり分からない）減ることがある」
//
// ★なぜ 単体試験だけでは 足りないか★
//   単体は Business.resume() を ★直に 呼ぶ★。客が 触るのは ★[続ける] ボタン★。
//   途中の onBusinessResume() が 落ちても 単体は 緑のまま 通る。
//   （2026-05 に 実際に そこで TypeError が 出て 売上 ¥0 に なった 事が
//     index.html:8968 の 注記に 残っている）
//   ⇒ ここでは ★ボタンを click し・アプリが 自分で 出す 通信を 横取りして 中身を 数える★。
//     送信は 手で 呼ばない … 業務終了の 後は `_syncAfterEnd()`（index.html:10620）が
//     ★アプリの 側から★ 送る。そこを そのまま 通す。
//
// ★わざと壊して 赤に なる事を 見た (2026-09-26)★
//   js/business.js の resume() から `_unsealSynced(state.start_time);` を 消す
//     ⇒ ★2回目の POST が 出ない★（勤務が 選ばれない）で 赤。戻すと 緑。
// ============================================================
const { test, expect } = require('@playwright/test');

// ★運転手と 同じ 縦の スマホ画面で 測る★
//   横画面だと #screenBusinessReport の [続ける] は display:none !important に なり、
//   代わりに #btnResumeLandscape が 出る（index.html:3477）。
//   ★既定の 1280x720 は 横画面★なので、そのままだと 客が 押す ボタンを 押せない。
test.use({ viewport: { width: 390, height: 844 } });

test('[終了]→送信→[続ける]→[終了] で 続きの 代行が 事務所へ 出て行く', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('sensor_permission_active', '1');
    sessionStorage.setItem('sensorGranted', '1');
    sessionStorage.setItem('dl_just_completed', '1');
    localStorage.setItem('daikome_training_consent', 'dismissed');
    localStorage.setItem('pwa_banner_dismissed', '1');
    localStorage.setItem('apk_banner_dismissed', '1');
    localStorage.setItem('tutorial_done', '1');
    // ★会社で 活性化 済みの 端末★でないと job-sync は 何も 送らない
    localStorage.setItem('dk_license_company', 'e2e-kaisha');
    localStorage.setItem('dk_sync_company', 'e2e-kaisha');
    localStorage.setItem('DAIKOME_DEVICE_ID', 'e2e-tanmatsu');
  });

  // ★出て行く 通信を 横取りする（アプリの 本物の fetch が 通る）★
  const okutta = [];
  await page.route('**/dk-sync-jobs**', async (route) => {
    let body = {};
    try {
      body = JSON.parse(route.request().postData() || '{}');
    } catch (_) {
      body = {};
    }
    okutta.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      // サーバは 受け取った 勤務を accepted で 返す（本物と 同じ 形）
      body: JSON.stringify({
        ok: true,
        accepted: (body.shifts || []).map((s) => s.start_time),
      }),
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    ['dlOverlay', 'trainingConsentBanner', 'pwaBanner', 'apkBanner', 'sensorRestoreBanner'].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      }
    );
    // ★業務開始は ライセンスの 門で 止まる（この紙の 主役では ない）★
    //   確かめたいのは ★[続ける] ボタン から 先★。業務は 画面と 同じ関数で 立ち上げる。
    window.Business.start();
    if (typeof window.appState !== 'undefined') window.appState = 'idle';
    if (typeof window.showScreen === 'function') window.showScreen('idle');
  });
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(() => window.Business.getState().active),
    '業務が 始まっていない＝前提が 崩れている'
  ).toBe(true);

  // 代行を 3件（支払いボタンが 呼ぶ 本物の API。GPS が 無いので ここだけ 直に 呼ぶ）
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) window.Business.onTripEnd(1000, 2000, Date.now() + i);
  });

  // ★[業務終了]★ … ボタンの 出方は 画面の 進み具合に 依るので、
  //   既に 在る tests/e2e/flow-standard.spec.js と 同じく ★ボタンの 中身★を 呼ぶ。
  //   （この紙が 確かめたいのは ★[続ける] から 先★。そこは 下で 本当に click する）
  page.once('dialog', (d) => d.accept());
  await page.evaluate(() => window.onBusinessEnd());

  // ★アプリが 自分で 送る★のを 待つ（手で sync を 呼ばない）
  await expect
    .poll(() => okutta.length, { timeout: 8000, message: '1回目の POST が 出ない＝前提が 崩れた' })
    .toBe(1);
  expect(okutta[0].shifts[0].trips.length, '1回目に 3件 出ていない').toBe(3);

  // ★[続ける] ボタンを 押す（ここが 客の道）★
  //   画面の 出し方は アプリ自身の showScreen を 使う（style を 手で いじらない）。
  await page.evaluate(() => {
    if (typeof window.showScreen === 'function') window.showScreen('businessReport');
  });
  await page.waitForTimeout(200);
  const tsuzukeru = page.locator('.btn-business-resume').first();
  await expect(tsuzukeru, '★[続ける] ボタンが 見えていない★').toBeVisible();
  await expect(tsuzukeru, '★[続ける] ボタンが 画面に 無い★').toHaveCount(1);
  await tsuzukeru.click();
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(() => window.Business.getState().active),
    '★[続ける] を 押しても 業務が 動き出していない★'
  ).toBe(true);

  // もう 2件 → 合計 5件
  await page.evaluate(() => {
    for (let i = 0; i < 2; i++) window.Business.onTripEnd(1500, 3000, Date.now() + 100 + i);
  });

  // ★もう一度 [業務終了]★
  page.once('dialog', (d) => d.accept());
  await page.evaluate(() => window.onBusinessEnd());

  await expect
    .poll(() => okutta.length, {
      timeout: 8000,
      message: '★2回目の POST が 出ない＝続きが 事務所から 消える★',
    })
    .toBe(2);

  const nikaime = okutta[1].shifts[0];
  expect(nikaime.trips.length, '★代行が 5件 出ていない（減っている）★').toBe(5);
  expect(nikaime.trip_count, '★数え札も 5 でないと 食い違う★').toBe(5);
  expect(nikaime.start_time, '★同じ勤務として 置き換わること★').toBe(
    okutta[0].shifts[0].start_time
  );
  expect(Number(nikaime.fare_total_yen), '★売上も 続きの分まで 出ていない★').toBeGreaterThan(
    Number(okutta[0].shifts[0].fare_total_yen)
  );
});
