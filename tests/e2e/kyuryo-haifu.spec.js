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
    employee_id: 'e1',
    name: 'テスト太郎',
    token: '7c4383b6aaaa1111bbbb2222cccc3333',
    init_code: '07041B0C',
    pw_ari: false,
    sort_order: 1,
  },
  {
    employee_id: 'e2',
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
  await page.locator('#btnHaifu').click();
  await page.waitForTimeout(900);
  const n = await page.locator('#haifuList .card').count();
  const svg = await page.locator('#haifuList svg').count();
  const url = await page.locator('#haifuList .note').first().textContent();
  // eslint-disable-next-line no-console
  console.log('★出た人数★ ' + n + ' ／ QR ' + svg + '個');
  // eslint-disable-next-line no-console
  console.log('★1人目の 字★ ' + String(url).trim().slice(0, 60));
  const u2 = await page.evaluate(() =>
    [...document.querySelectorAll('#haifuList .note')]
      .map((e) => e.textContent.trim())
      .filter((t) => t.indexOf('http') >= 0)
  );
  // eslint-disable-next-line no-console
  u2.forEach((t) => console.log('   URL … ' + t.slice(0, 100)));
  expect(n, '★人ごとの 枚数が 合いません★').toBe(2);
  expect(svg, '★QRが 出ていません★').toBe(2);
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
  const url1 = await page.locator('[data-hcopy]').first().getAttribute('data-hcopy');
  expect(url1, '★URL に 初回コードが 埋まっていません★').toContain('&c=07041B0C');

  // ★★紙（PDF）が 本当に 出るか★★ 2026-09-04
  //   ★「ボタンが 在る」で 終わらせない★＝★出た紙の 大きさと 形★まで 見る。
  //   ★jsPDF の 字では 日本語が 出ない★（doc.getFontList に 日本語が 1つも 無い・実測）
  //   ⇒ 板(HTML)を html2canvas で 絵にして 貼る 形＝★絵が 貼れないと 紙は 極端に 小さくなる★
  const dl = page.waitForEvent('download', { timeout: 60000 });
  await page.locator('#btnHaifuPrint').click();
  const d = await dl;
  const os = require('os');
  const p2 = path.join(os.tmpdir(), 'kyuryo-QR-mihari.pdf');
  await d.saveAs(p2);
  const atama = fs.readFileSync(p2).slice(0, 5).toString('latin1');
  const ookisa = fs.statSync(p2).size;
  // eslint-disable-next-line no-console
  console.log('★出た紙★ ' + d.suggestedFilename() + ' ／ ' + ookisa + ' バイト ／ 頭 ' + atama);
  expect(atama, '★PDF の 形に なっていない★').toBe('%PDF-');
  expect(ookisa, '★紙が 小さすぎる＝絵が 貼れていない（中身が 無い）★').toBeGreaterThan(50000);
  fs.unlinkSync(p2);

  // ★コピー★
  await page.locator('[data-hcopy]').first().click();
  await page.waitForTimeout(300);
  expect(
    await page.locator('[data-hcopy]').first().textContent(),
    '★URLを 写せていません★'
  ).toContain('コピーしました');

  // ★★絵は「押す前の 顔」で 撮る★★ 2026-09-04（指示役の 指摘）
  //   ★前は 押した 直後（1.5秒だけ「コピーしました」に なる 間）に 撮っていました★
  //   ⇒ 絵を 見た 人に ★ボタンの 字が 2通り 在る★ように 見えていました（★私の 撮り方が 悪い★）
  //   ⇒ ★字が 元（コピー）に 戻るまで 待ってから 撮ります★
  await page.waitForFunction(
    () => {
      const b = document.querySelector('[data-hcopy]');
      return b && b.textContent.indexOf('コピーしました') < 0;
    },
    { timeout: 5000 }
  );
  expect(
    await page.locator('[data-hcopy]').first().textContent(),
    '★字が 元に 戻っていません★'
  ).toContain('コピー');

  await page.locator('#haifuList').scrollIntoViewIfNeeded();
  await page
    .locator('#haifuList')
    .locator('xpath=ancestor::div[contains(@class,"card")][1]')
    .screenshot({ path: OUT + 'shot-haifu.png' });
});
