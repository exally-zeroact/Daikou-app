// ============================================================
// ★★事務所が 従業員へ 配る（QR・URL）★★ 2026-09-03（司さん）
//
//   ★ここで 見張る 事★
//     ①「配る」を 押すと ★人ごとに 1枚★ 出る（QRも 人数ぶん）
//     ②★パスワードを まだ 決めていない人だけ★ URL に 初回コード(&c=)が 付く
//       ⇒★決めた人の URL に 初回コードを 付けない★（付けると パスワードを 上書きできてしまう）
//     ③画面に ★★（星）が 字として 出ていない★（絵を 開いて 気づいた・2026-09-03）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-04 実測）★★
//     ①決めた人にも 初回コードを 付ける … ★1本 赤★
//     ②QRを 出すのを やめる ……………… ★1本 赤★
//   ★★③紙（PDF）が 本当に 出るか も 押す★★ 2026-09-04
//     ★jsPDF の 字では 日本語が 出ない★（doc.getFontList に 日本語が 1つも 無い・実測）
//     ⇒ ★この画面の 他の 紙と 同じ★＝板(HTML)を html2canvas で 絵にして 貼る 形に した。
//     ★紙に URL の 字も 出す★＝QRが 読めない 端末の 逃げ道（絵を 見て 気づいた）
//     戻した後 … ★緑★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);
const OUT = 'C:/Users/zeroa/dk-tokei-2026-09-02/tokei/';
const LIST = [
  {
    employee_id: 'ec8d275b-38c0-4d9f-b471-eeb10226a6a9',
    name: 'テスト太郎',
    token: '7c4383b6aaaa1111bbbb2222cccc3333',
    init_code: '07041B0C',
    pw_ari: false,
    sort_order: 1,
  },
  {
    employee_id: '46a60d53-02b7-47ef-829e-6fd03cee1a31',
    name: 'テスト次郎',
    token: '3b7433a6dddd4444eeee5555ffff6666',
    init_code: null,
    pw_ari: true,
    sort_order: 2,
  },
];
test('★配る＝人ごとに QRとURL／初回コードは 未設定の人だけ★', async ({ page, context }) => {
  await page.setViewportSize({ width: 430, height: 950 });
  // ★「写す」は ブラウザの 許可が 要る★（許可が 無いと ここで 落ちる・2026-09-04 実測）
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const tsugi =
    moto +
    ';(function(){var F=' +
    JSON.stringify(FIX) +
    ';' +
    'var co={company_id:F.settings[0].company_id,name:"見張り用"};' +
    'function rows(p){' +
    ' if(p.indexOf("dk_employees")===0)return F.emps||[];' +
    ' if(p.indexOf("dk_device_labels")===0)return F.labels||[];' +
    ' if(p.indexOf("dk_payroll_settings")===0)return F.settings||[];' +
    ' if(p.indexOf("dk_shifts")===0)return F.shifts||[];' +
    ' if(p.indexOf("dk_shift_edits")===0)return F.edits||[];' +
    ' if(p.indexOf("dk_work_hours")===0)return F.workHours||[];' +
    ' if(p.indexOf("dk_manual_days")===0)return F.manualDays||[];' +
    ' return [];}' +
    'var S=window.DKSession;S.ensure=function(){return Promise.resolve({token:"dummy"});};' +
    'S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};' +
    'S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p,o){' +
    // ★1人ぶんの 口★（2026-09-04 司さん「従業員毎に 配るんやないんか」）
    //   ★一覧に 居る 2人だけ 鍵を 返す★／3人目は not_yours ＝「まだ 配っていません」の まま
    '  if(String(p).indexOf("rpc/dk_kyuryo_haifu_hitori")===0){' +
    '    var eid=JSON.parse(o.body).p_employee_id;var L=' +
    JSON.stringify(LIST) +
    ';var h=null;L.forEach(function(y){if(y.employee_id===eid)h=y;});' +
    '    return Promise.resolve({ok:true,json:function(){return Promise.resolve(h?{ok:true,hito:h}:{ok:false,reason:"not_yours"});}});}' +
    '  if(String(p).indexOf("rpc/dk_kyuryo_haifu")===0)return Promise.resolve({json:function(){return Promise.resolve({ok:true,list:' +
    JSON.stringify(LIST) +
    '});}});' +
    '  if(String(p).indexOf("rpc/dk_kyuryo_saihakkou")===0)return Promise.resolve({json:function(){return Promise.resolve({ok:true,init_code:"NEW11111"});}});' +
    '  return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();';
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: tsugi })
  );
  page.on('pageerror', (e) => {
    throw e;
  });
  await page.goto('/kyuryo.html');
  await page.waitForTimeout(1800);
  await page.locator('.tab[data-tab="set"]').click();
  await page.waitForTimeout(600);
  // ★★配るのは 人ごと★★ 2026-09-04（司さん「従業員毎に 配るんやないんか」）
  //   ★全員に 効く ボタンは 在りません★＝★人ごとの〔配る〕を 押す★
  expect(await page.locator('#btnHaifu').count(), '★全員に 効く「配る」が 戻っています★').toBe(0);
  // ★★配る前の 顔★★（従業員 全員が 出て、みんな「まだ 配っていません」）
  await page.locator('#haifuList').scrollIntoViewIfNeeded();
  await page
    .locator('#haifuList')
    .locator('xpath=ancestor::div[contains(@class,"card")][1]')
    .screenshot({ path: 'C:/Users/zeroa/dk-tokei-2026-09-02/tokei/shot-haifu-mae.png' });
  const machi = await page.locator('[data-hhito]').count();
  // eslint-disable-next-line no-console
  console.log('★まだ 配っていない人★ ' + machi + '人');
  expect(machi, '★人ごとの「配る」が 出ていません★').toBeGreaterThan(0);
  for (let i = 0; i < machi; i++) {
    await page.locator('[data-hhito]').first().click();
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(900);
  const n = await page.locator('#haifuList .card').count();
  const svg = await page.locator('#haifuList svg').count();
  const url = await page.locator('#haifuList .note').first().textContent();
  // eslint-disable-next-line no-console
  console.log('★出た人数★ ' + n + ' ／ QR ' + svg + '個');
  // eslint-disable-next-line no-console
  console.log('★1人目の 字★ ' + String(url).trim().slice(0, 60));
  // ★★URL は 画面に 出しません★★（2026-09-04 司さん「一気に 見せる メリット ないやろが」）
  //   ⇒ 渡す 中身は ★「送る」ボタンが 持っている★ ので そこから 取る
  const u2 = await page.evaluate(() =>
    [...document.querySelectorAll('#haifuList [data-hokuru]')].map((e) =>
      e.getAttribute('data-url-mihari')
    )
  );
  // eslint-disable-next-line no-console
  u2.forEach((t) => console.log('   URL … ' + t.slice(0, 100)));
  // ★★一覧は 従業員 全員★★ 2026-09-04（司さん「従業員毎に 配るんやないんか」）
  //   ★配る前から 名前が 出る★＝誰に 配ってあるかが 一目で 分かる
  //   ⇒ 札の 数 ＝ ★今 居る 従業員の 数★（この 見本は 3人）
  const inHito = await page.evaluate(() => (window.__EMP_KAZU__ = null));
  void inHito;
  expect(n, '★札が 従業員の 数と 合いません★').toBe(3);
  // ★鍵が 出来ているのは 2人だけ★（この 見本の 決め）
  expect(u2.length, '★鍵の 数が 合いません★').toBe(2);
  // ★残り 1人は「まだ 配っていません」★
  expect(
    await page.locator('#haifuList [data-hhito]').count(),
    '★まだ 配っていない人が 出ていません★'
  ).toBe(1);
  // ★★2026-09-04（司さん）「一気に 見せる メリット ないやろが」★★
  //   ★一覧には QR を 出さない★（小さくて 読めない／全員ぶんを 撮られる）
  //   ⇒ 出すのは ★1人ずつ「大きく 見せる」★の 時だけ
  expect(svg, '★一覧に QR が 並んでいます（1人ずつ 見せる 決まりです）★').toBe(0);
  const ichiranJi = await page.locator('#haifuList').innerText();
  expect(ichiranJi, '★一覧に URL が 出ています★').not.toContain('kyuryo.html?t=');
  // ★初回コードは 未設定の人だけ★
  expect(u2[0], '★未設定の人の URL に 初回コードが ありません★').toContain('&c=07041B0C');
  expect(u2[1], '★もう決めた人の URL に 初回コードが 付いています★').not.toContain('&c=');
  // ★画面に 星が 字として 出ていない★
  const hoshi = await page.evaluate(() => document.getElementById('haifuList').innerText || '');
  expect(hoshi.indexOf(String.fromCharCode(9733)), '★星が 字として 出ています★').toBe(-1);

  // ★★初回コードを 画面に 出さない★★ 2026-09-04（司さん）
  //   ★「初回コードなんか Rakunally でやってなかろが」★
  //   ★Rakunally の 実物（kyuyo/js/app.js:4301）も コードそのものは 1文字も 出さない★
  //   ⇒ ★事務所の 人に 見えてしまう★／★本人が 打つ 必要も 無い（?c= に 埋めてある）★
  //   ⇒ ★渡すのは リンク（QR）1つだけ＝リンクが 鍵★
  const naka = await page.locator('#haifuList').innerText();
  expect(naka, '★画面に 初回コードの 字が 出ています★').not.toContain('初回コード');
  // ★URL は 出します★＝★これが 渡す 物★（Rakunally も readonly の 入力欄で 出している）
  //   ★URL の 中に ?c= が 在るのは そのまま★＝★リンクが 鍵★。
  //   ★別立ての「初回コード ◯◯◯◯」を 出さない★のが 今回の 直しです
  //   （別に 出すと「2つ目の 鍵」に 見えて、本人が 打つ 物だと 思われる）
  expect(naka, '★リンクが 鍵だと 言っていません★').toContain('リンクは 本人にだけ 渡してください');
  // ★URL の 中（?c=）には 在る事★＝本人は 打たなくてよい（上の u2 で 見ている）
  const url1 = await page.locator('[data-hokuru]').first().getAttribute('data-url-mihari');
  expect(url1, '★URL に 初回コードが 埋まっていません★').toContain('&c=07041B0C');

  // ★★「全員分の QRを 印刷」を やめました★★ 2026-09-04（司さん「これいらんやろが」）
  //   ★渡し方は 2つだけ★
  //     ・その場に 居る人 … その人の「大きく 見せる」＝読ませるだけ
  //     ・居ない人 ……… その人の「送る」＝LINE・メール等で 送る
  //   ★紙は 1度も 要りません★（司さん「なんで 印刷せないかんのど」）
  //   ⇒ ★ボタンが 戻っていない事★を 見る（前は 紙が 出るかを 見ていた）
  expect(
    await page.locator('#btnHaifuPrint').count(),
    '★「全員分の QRを 印刷」が 戻っています★'
  ).toBe(0);
  expect(
    await page.locator('#paneSet').innerText(),
    '★印刷の ボタンの 字が 残っています★'
  ).not.toContain('全員分の QRを 印刷');

  // ★送る（この 台では 共有シートが 無いので コピーに 落ちる）★
  await page.locator('[data-hokuru]').first().click();
  await page.waitForTimeout(300);
  expect(
    await page.locator('[data-hokuru]').first().textContent(),
    '★URLを 写せていません★'
  ).toContain('コピーしました');

  // ★★絵は「押す前の 顔」で 撮る★★ 2026-09-04（指示役の 指摘）
  //   ★前は 押した 直後（1.5秒だけ「コピーしました」に なる 間）に 撮っていました★
  //   ⇒ 絵を 見た 人に ★ボタンの 字が 2通り 在る★ように 見えていました（★私の 撮り方が 悪い★）
  //   ⇒ ★字が 元（送る）に 戻るまで 待ってから 撮ります★
  await page.waitForFunction(
    () => {
      const b = document.querySelector('[data-hokuru]');
      return b && b.textContent.indexOf('コピーしました') < 0;
    },
    { timeout: 5000 }
  );
  expect(
    await page.locator('[data-hokuru]').first().textContent(),
    '★字が 元に 戻っていません★'
  ).toContain('送る');

  await page.locator('#haifuList').scrollIntoViewIfNeeded();
  await page
    .locator('#haifuList')
    .locator('xpath=ancestor::div[contains(@class,"card")][1]')
    .screenshot({ path: OUT + 'shot-haifu.png' });
});
