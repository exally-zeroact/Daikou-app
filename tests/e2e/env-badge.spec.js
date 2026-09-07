// tests/e2e/env-badge.spec.js
//
// ★★テスト環境の帯を「実物の画面」で 押して 測る★★ 2026-08-28
//
//   ★repo の設定は 触りません★
//     本番のふりをさせる時は ★配信の途中で js/dk-config.js だけ すり替えます★
//     （repo の値を 書き換えると ★テスト線が 本番の倉庫を向く事故★を 自分で 作ってしまう）
//
//   ★何を 測るか★
//     ①テスト（名札 test）… ★帯が 出る★／★文字が 1行で 割れていない★／★高さのぶん 中身が 下がる★
//     ②本番（名札 prod）… ★何も 出ない★（一番 高い事故が 起きない事の 実物での 確認）
//     ③名札が 無い／知らない値 … ★何も 出ない★（迷ったら 出さない）
//     ④帯の中のボタンは ★実際に 押せる★（pointer-events を auto に 戻している）
const { test, expect } = require('@playwright/test');

// ★配信の途中で 名札だけ すり替える★（repo の中身は 1文字も 変えない）
async function nafudaWo(page, env) {
  await page.route('**/js/dk-config.js', async (route) => {
    const res = await route.fetch();
    let body = await res.text();
    if (env === null) {
      body = body.replace(/const ENV = '[a-z]*';/, 'const ENV = undefined;');
    } else {
      body = body.replace(/const ENV = '[a-z]*';/, "const ENV = '" + env + "';");
    }
    await route.fulfill({ status: 200, contentType: 'application/javascript', body });
  });
}

const GAMEN = ['/dashboard.html', '/uriage.html', '/shukei.html', '/kyuryo.html', '/login.html'];

// ★事務所の画面は ログインが 無いと login.html へ 飛びます★（2026-08-28 実測・帯の話ではない）
//   ⇒ ★本物の dk-session.js の 後ろに 上書きを 足す★（既に在る手＝kyuryo-paper.spec.js と 同じ）
//   ★repo の中身は 1文字も 変えません★
const fs = require('fs');
const path = require('path');
async function loginZumi(page) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const tsugi =
    moto +
    ';(function(){' +
    'if(!window.DKSession)return;' +
    'window.DKSession.ensure=function(){return Promise.resolve({user:{id:"u1",email:"x@example.com"},token:"t"});};' +
    'window.DKSession.goLogin=function(){};' +
    'if(window.DKSession.rest)window.DKSession.rest=function(){return Promise.resolve([]);};' +
    '})();';
  // ★★外（本番の 倉庫）へ 出さない★★ 2026-09-06
  //   ★これは「赤を 緑に する 直し」では ありません★
  //   ★試験が 本番の 倉庫を 叩いていたのを 止めます★
  //   ★実測（2026-09-06）★
  //     dashboard.html:808 が SB_URL + '/auth/v1/user' を 直に 叩きます。
  //     ★手元（外へ 出られる）★ … 本番の supabase が ★403★
  //        ⇒ dashboard.html:1344 `if (!u || !u.id) return goLogin();`
  //        ⇒ ★login.html へ 飛ぶ★ ⇒ 帯を 見る前に 終わる（15秒 時間切れ）
  //     ★CI（外へ 出られない）★ … fetch が 落ちる ⇒ catch の 側 ⇒ 飛ばない ⇒ 緑
  //   ⇒★★手元の 赤も CI の 緑も、どちらも 中身を 見ていませんでした★★
  //   ⇒★手元でも CI でも ★同じ 道★ を 通す★
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'u1', email: 'mihari@example.com' }),
    })
  );

  await page.route('**/js/dk-session.js*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsugi,
    })
  );
}

test.describe('★テスト環境の帯（実物の画面）★', () => {
  test('①テスト＝帯が出る／文字が割れない／中身が下がる', async ({ page }) => {
    await nafudaWo(page, 'test');
    await loginZumi(page);
    await page.goto('/dashboard.html');
    const band = page.locator('#dkEnvBadge');
    await expect(band, '★テストなのに 帯が 出ていない★').toHaveCount(1);
    await expect(band).toContainText('テスト用（本番ではありません）');

    // ★文字が 1文字ずつ 縦に割れていないか＝高さで 見る★（flex/grid の箱に入れた時の 型）
    const h = await band.evaluate((e) => e.getBoundingClientRect().height);
    expect(h, '★帯が 高すぎます＝文字が 縦に 割れている疑い★').toBeLessThan(40);
    expect(h, '★帯の高さが 0＝出ていない★').toBeGreaterThan(10);

    // ★高さのぶん 中身が 下がっているか★
    const pad = await page.evaluate(
      () => parseFloat(getComputedStyle(document.body).paddingTop) || 0
    );
    expect(pad, '★帯のぶん 中身が 下がっていない（帯が 上の物を 隠す）★').toBeGreaterThanOrEqual(
      h - 1
    );
  });

  test('②本番＝何も出ない（一番 高い事故）', async ({ page }) => {
    await nafudaWo(page, 'prod');
    await loginZumi(page);
    for (const g of GAMEN) {
      await page.goto(g);
      await expect(
        page.locator('#dkEnvBadge'),
        '★本番の名札なのに 帯が 出た（' + g + '）★'
      ).toHaveCount(0);
    }
  });

  test('③名札が 無い／知らない値＝何も出ない（迷ったら 出さない）', async ({ page }) => {
    await nafudaWo(page, null);
    await loginZumi(page);
    await page.goto('/dashboard.html');
    await expect(page.locator('#dkEnvBadge'), '★名札が 無いのに 出た★').toHaveCount(0);

    await nafudaWo(page, 'staging');
    await page.goto('/dashboard.html');
    await expect(page.locator('#dkEnvBadge'), '★知らない値なのに 出た★').toHaveCount(0);
  });

  test('④事務所の帯のボタンは 実際に 押せる', async ({ page }) => {
    await nafudaWo(page, 'test');
    await loginZumi(page);
    await page.goto('/dashboard.html');
    await expect(page.locator('#dkEnvBadge'), '★帯が 出ていない★').toHaveCount(1, {
      timeout: 15000,
    });
    // ★1回で 読み切る★（locator ごしに 何度も 触ると、画面が 途中で 移った時に
    //   ★待ち続けて 時間切れ★になりました・2026-08-28 実際に 出た）
    const r = await page.evaluate(() => {
      const band = document.getElementById('dkEnvBadge');
      const a = band && band.querySelector('a');
      if (!a) return { aru: false };
      const st = getComputedStyle(a);
      const rc = a.getBoundingClientRect();
      const ue = document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2);
      return {
        aru: true,
        pe: st.pointerEvents,
        atari: !!(ue && (ue === a || a.contains(ue))),
        haba: rc.width,
      };
    });
    expect(r.aru, '★戻り先の ボタンが 無い★').toBe(true);
    // ★DOM に 在るだけでは 押せません★（帯は pointer-events:none）
    expect(r.pe, '★ボタンが 押せない（pointer-events が auto に 戻っていない）★').toBe('auto');
    expect(r.atari, '★ボタンの上に 別の物が 乗っていて 押せない★').toBe(true);
    expect(r.haba, '★ボタンの幅が 0＝見えていない★').toBeGreaterThan(10);
  });

  test('⑤メーターの帯には 押す物を 出さない（2026-08-25 司さん）', async ({ page }) => {
    await nafudaWo(page, 'test');
    await page.goto('/index.html');
    await expect(page.locator('#dkEnvBadge'), '★メーターに 帯が 出ていない★').toHaveCount(1);
    await expect(
      page.locator('#dkEnvBadge a'),
      '★メーターの帯に 押す物が 出ている★（引っ越しは 済んでいる）'
    ).toHaveCount(0);
  });
});
