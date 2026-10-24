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
  // ★★2026-10-24 給料の 設定の「従業員へ 配る」の 箱は 外した★★（司さん「配るは明細からできるからのけろ」）
  //   ⇒ 配るのは 明細の「QRを 見せる」「送る」。前の 守り（人ごと・初回コードは 未設定の 人だけ・星・初回コードの 字・
  //     全員に 効く ボタンが 無い）は 明細の 道で 見る
  await page.goto('/kyuryo.html?henshu=1');
  await page.waitForTimeout(1800);
  await page.locator('.tab[data-tab="set"]').click();
  await page.waitForTimeout(400);
  expect(
    await page.locator('#paneSet').innerText(),
    '★給料の 設定に 配るの 箱が 残っている★'
  ).not.toContain('従業員へ 配る');
  expect(await page.locator('#btnHaifu').count(), '★全員に 効く「配る」が 戻っています★').toBe(0);
  expect(
    await page.locator('#btnHaifuPrint').count(),
    '★「全員分の QRを 印刷」が 戻っています★'
  ).toBe(0);
  await page.locator('.tab[data-tab="slip"]').click();
  await page.waitForTimeout(500);
  // ★人ごとに 見せる★（その人の 分だけ 配る＝他の 人の 鍵は 作らない）
  const miseru = async (eid) => {
    await page
      .locator('[data-meisai-qr="' + eid + '"]')
      .first()
      .click();
    await page.waitForSelector('#haifuMise');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const o = document.getElementById('haifuMise');
      const q = document.getElementById('haifuMiseQr');
      return {
        url: q ? q.getAttribute('data-url-mihari') : null,
        svg: o.querySelectorAll('svg').length,
        ji: o.innerText || '',
      };
    });
    await page.locator('#haifuMise').click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(200);
    return r;
  };
  const taro = await miseru(LIST[0].employee_id);
  const jiro = await miseru(LIST[1].employee_id);
  // eslint-disable-next-line no-console
  console.log('★URL★ ' + taro.url + ' ／ ' + jiro.url);
  expect(taro.svg, '★QR が 出ていない★').toBe(1);
  expect(jiro.svg, '★QR が 出ていない★').toBe(1);
  // ★初回コードは 未設定の人だけ★
  expect(taro.url, '★未設定の人の URL に 初回コードが ありません★').toContain('&c=07041B0C');
  expect(jiro.url, '★もう決めた人の URL に 初回コードが 付いています★').not.toContain('&c=');
  // ★画面に 星が 字として 出ていない・初回コードの 字を 出さない・リンクが 鍵★
  [taro, jiro].forEach((x) => {
    expect(x.ji.indexOf(String.fromCharCode(9733)), '★星が 字として 出ています★').toBe(-1);
    expect(x.ji, '★画面に 初回コードの 字が 出ています★').not.toContain('初回コード');
    expect(x.ji, '★画面に URL の 字が 出ています★').not.toContain('kyuryo.html?t=');
    expect(x.ji, '★リンクが 鍵だと 言っていません★').toContain('リンクが 鍵');
  });
  // ★送る（この 台では 共有シートが 無いので コピーに 落ちる）★
  const okuru = page.locator('[data-meisai-okuru="' + LIST[0].employee_id + '"]').first();
  await okuru.click();
  await page.waitForTimeout(300);
  expect(await okuru.textContent(), '★URLを 写せていません★').toContain('コピーしました');
  const naka = await page.evaluate(() => navigator.clipboard.readText());
  expect(naka, '★送る 中身に 初回コードが 埋まっていません★').toContain('&c=07041B0C');
  await page.waitForFunction(
    (sel) => {
      const b = document.querySelector(sel);
      return b && b.textContent.indexOf('コピーしました') < 0;
    },
    '[data-meisai-okuru="' + LIST[0].employee_id + '"]',
    { timeout: 5000 }
  );
  expect(await okuru.textContent(), '★字が 元に 戻っていません★').toContain('送る');
});
