// tests/e2e/okuru-sw-keiyu.spec.js
// ============================================================
// ★service worker が 画面を 握っている 時も、業務終了の 売上が 事務所へ 出て行く★ 2026-10-17
//
//   ★なぜ 要るか★ WebKit（iPhone の Safari の 中身）で 初めて 回すと、shuryo-tsuzukeru-okuru が
//     「1回目の POST が 出ない」で 赤に なった（service worker あり 8回中 2回・なし 8回中 0回・手元の webkit）。
//     要求を 全部 並べると、POST dk-sync-jobs 自体は 出ていて、page.route に 捕まらずに 外へ 向かっていた。
//     ＝WebKit では service worker が 握る 画面の 要求に page.route が 効かない 事が ある（試験の 道具の 癖）。
//     sw.js は GET 以外を 触らない（sw.js:391）ので、アプリの 送りは ブラウザが そのまま 出す。
//   ⇒ shuryo-tsuzukeru-okuru は service worker を 止めて 中身を 数える 形に した。
//     ★代わりに ここで「service worker が 握っていても POST が 出る」を 縛る★（page.route を 使わず、出て行く 要求を 見る）。
//   ★外の 網まで 出た 事も 見る★ 画面が 要求を 出した だけでは 足りない。service worker が 偽の 返事で 飲むと
//     客の 画面は 送れた 形に なるのに 事務所へ 届かない（対立役 10-17・前の 形は それでも 緑だった）。
//     ＝返事が service worker から 来ていない 事と、送りが 外の 網で 落ちた（＝外まで 出た）事を 数える。
//   ★本物の 倉庫には 届かない★ 試験の 設定が 外を 止めている（chromium＝playwright.config.js の host-resolver-rules、
//     webkit の 組が 在る 時は その 設定の 届かない 代理）。止めが 無い 設定で 回すと 本物の 倉庫へ 出るので、その 形では 回さない。
//
//   ★わざと壊して 赤に なった 記録（2026-10-17）★
//     js/job-sync.js の 送り（fetch の 呼び出し）を 止める ⇒ この 試験と shuryo-tsuzukeru-okuru が 赤（chromium・webkit とも 4本中 4本）。戻すと 緑。
//     sw.js の fetch の 頭で POST dk-sync-jobs に 偽の 200 を 返す ⇒ この 試験が chromium・webkit とも 赤（「service worker が 返事を 作った」）。shuryo-tsuzukeru-okuru は 緑の まま＝ここだけが 捕まえる。
//     止め（host-resolver-rules）の 無い chromium の 設定で 回す ⇒ 送る 前の 確かめで 赤（「倉庫の 住所へ 届いてしまう」・POST は 出ない）。
//     sw.js が POST を Response.error() で 飲む ⇒ chromium・webkit とも 赤（「試験の 止めで 落ちていない」）。
// ============================================================
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 390, height: 844 } });

test('service worker が 握っていても 業務終了の POST が 3件 入って 出て行く', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('sensor_permission_active', '1');
    sessionStorage.setItem('sensorGranted', '1');
    sessionStorage.setItem('dl_just_completed', '1');
    localStorage.setItem('daikome_training_consent', 'dismissed');
    localStorage.setItem('pwa_banner_dismissed', '1');
    localStorage.setItem('apk_banner_dismissed', '1');
    localStorage.setItem('tutorial_done', '1');
    localStorage.setItem('dk_license_company', 'e2e-kaisha');
    localStorage.setItem('dk_sync_company', 'e2e-kaisha');
    localStorage.setItem('DAIKOME_DEVICE_ID', 'e2e-tanmatsu');
  });
  const deta = [];
  const yokyu = [];
  const okuriKa = (r) => r.method() === 'POST' && r.url().includes('/dk-sync-jobs');
  page.on('request', (r) => {
    if (okuriKa(r)) {
      let b = {};
      try {
        b = JSON.parse(r.postData() || '{}');
      } catch (_) {
        b = {};
      }
      deta.push(b);
      yokyu.push(r);
    }
  });
  // ★外の 網まで 出たか★（service worker が 偽の 返事で 飲み込むと、画面は 送れた 形に なるが 事務所へ 届かない）
  //   試験の 中では 本物の 倉庫へ 届かない 様に 止めてある ので、外まで 出た 送りは「網で 落ちた」形で 見える。
  const amiMadeDeta = [];
  page.on('requestfailed', (r) => {
    if (okuriKa(r)) amiMadeDeta.push(r);
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // ★service worker が 画面を 握るまで 待つ★（握っていない 時の 緑は この 試験の 意味が 無い）
  await expect
    .poll(
      () => page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller)),
      {
        timeout: 15000,
        message: '★service worker が 画面を 握っていない＝この 試験の 前提が 無い★',
      }
    )
    .toBe(true);

  // ★送る 前に、倉庫の 住所へ 届かない 事を 確かめる★ 2026-10-17（対立役 N1）
  //   前は「届いた 後で 赤」だけで、止め（chromium の host-resolver-rules・webkit の 代理）が 無い 設定で 回すと
  //   本番の 倉庫へ 代行 3件 入りの POST が 出た。害の 無い GET（無い 関数の 名前）で 落ちる 事を 見て、落ちなければ 送らずに 赤。
  const sbUrl = (fs
    .readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-config.js'), 'utf8')
    .match(/https:\/\/[a-z0-9]{20}\.supabase\.co/) || [])[0];
  expect(sbUrl, '★js/dk-config.js から 倉庫の 住所が 読めない★').toBeTruthy();
  const todoita = await page.evaluate(async (u) => {
    try {
      await fetch(u + '/functions/v1/zz-todokanai-kakunin', { mode: 'no-cors', cache: 'no-store' });
      return true;
    } catch (_) {
      return false;
    }
  }, sbUrl);
  expect(todoita, '★倉庫の 住所へ 届いてしまう（止めの 無い 設定）＝送らずに 止める★').toBe(false);

  await page.evaluate(() => {
    ['dlOverlay', 'trainingConsentBanner', 'pwaBanner', 'apkBanner', 'sensorRestoreBanner'].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      }
    );
    window.Business.start();
    if (typeof window.appState !== 'undefined') window.appState = 'idle';
    if (typeof window.showScreen === 'function') window.showScreen('idle');
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) window.Business.onTripEnd(1000, 2000, Date.now() + i);
  });
  page.once('dialog', (d) => d.accept());
  await page.evaluate(() => window.onBusinessEnd());

  await expect
    .poll(() => deta.length, {
      timeout: 10000,
      message: '★service worker が 握る 画面で 業務終了の POST が 出ない★',
    })
    .toBeGreaterThan(0);
  const s = (deta[0].shifts || [])[0] || {};
  expect((s.trips || []).length, '★出て行った POST に 代行が 3件 入っていない★').toBe(3);

  // ★service worker が 返事を 作っていない★（対立役 10-17：sw.js が POST を 偽の 200 で 飲むと、前の 形は 緑だった）
  const swNoHenji = [];
  for (const r of yokyu) {
    const res = await r.response().catch(() => null);
    if (res && res.fromServiceWorker()) swNoHenji.push(r.url());
  }
  expect(
    swNoHenji,
    '★業務終了の 送りに service worker が 返事を 作った＝事務所へ 届いていない★'
  ).toEqual([]);
  await expect
    .poll(() => amiMadeDeta.length, {
      timeout: 10000,
      message: '★業務終了の 送りが 外の 網まで 出ていない★',
    })
    .toBeGreaterThan(0);
  // ★落ちた 訳が 試験の 止めの 字で ある 事★ 2026-10-17（対立役 N2）
  //   service worker が Response.error() 等で 偽の 失敗を 返しても「網で 落ちた」に 数えて 緑に なった。
  //   chromium＝住所を 引かせない（ERR_NAME_NOT_RESOLVED）・webkit＝届かない 代理（Could not connect）だけを 外まで 出た 証しに する。
  const wake = amiMadeDeta.map((r) => (r.failure() || {}).errorText || '');
  expect(
    wake.some((w) => /ERR_NAME_NOT_RESOLVED|Could not connect/.test(w)),
    '★送りが 試験の 止めで 落ちていない（別の 所で 飲まれた）：' + JSON.stringify(wake) + '★'
  ).toBe(true);
});
