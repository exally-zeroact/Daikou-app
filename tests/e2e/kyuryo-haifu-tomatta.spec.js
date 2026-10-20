// ============================================================
// ★★3回 続けて 間違えて 止まった 人・作り直し★★ 2026-10-20（docs/pw-4keta.md）
//   司さん 10-19「新しく URL や QR コードを 作成し直す」＝作り直すと token も 替わる
//   わざと壊す：一覧の x.tomatta を 見ない ⇒ 赤（「止まっています」が 出ない）
//              作り直しの 返りで HAIFU を 差し替えない ⇒ 赤（1人ぶんが 落ちると 古い token の まま）
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
    tomatta: true,
    sort_order: 2,
  },
];
test('★止まった 人の 札に「止まっています」・作り直すと すぐ 新しい リンクに 差し替える★', async ({
  page,
  context,
}) => {
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
    '    if(window.__hitoriOchiru)return Promise.reject(new Error("tsushin"));' +
    '    return Promise.resolve({ok:true,json:function(){return Promise.resolve(h?{ok:true,hito:h}:{ok:false,reason:"not_yours"});}});}' +
    '  if(String(p).indexOf("rpc/dk_kyuryo_haifu")===0)return Promise.resolve({json:function(){return Promise.resolve({ok:true,list:' +
    JSON.stringify(LIST) +
    '});}});' +
    '  if(String(p).indexOf("rpc/dk_kyuryo_saihakkou")===0)return Promise.resolve({json:function(){return Promise.resolve({ok:true,init_code:"NEW11111",token:"aaaabbbbccccddddeeeeffff00001111"});}});' +
    '  return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();';
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: tsugi })
  );
  page.on('pageerror', (e) => {
    throw e;
  });
  // ★★2026-09-06 給料は「見るだけ」に なりました★★（司さん）
  //   「設定画面の 中に チップで 車、料金、従業員マスタ つくったら 各ページ 見やすくなるやろ」
  //   ⇒ ★「従業員」「給料の設定」は ?henshu=1 の 時だけ 出ます★
  //     （会社設定 →「車」「従業員」チップから 来る 道）
  await page.goto('/kyuryo.html?henshu=1');
  await page.waitForTimeout(1800);
  await page.locator('.tab[data-tab="set"]').click();
  await page.waitForTimeout(600);
  await page.waitForSelector('#haifuList');
  // 2人とも 配る（1人ぶんの 口）
  for (let i = 0; i < 5 && (await page.locator('[data-hhito]').count()) > 0; i++) {
    await page.locator('[data-hhito]').first().click();
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(600);
  await expect(page.locator('#haifuList')).toContainText('3回 続けて 間違えて 止まっています');
  // 作り直す（1人ぶんの 取り直しは 通信で 落ちる＝それでも 新しい token に なる）
  await page.evaluate(() => (window.__hitoriOchiru = true));
  await page.click('[data-hsai="46a60d53-02b7-47ef-829e-6fd03cee1a31"]');
  await page.waitForTimeout(800);
  const urls = await page
    .locator('[data-url-mihari]')
    .evaluateAll((l) => l.map((e) => e.getAttribute('data-url-mihari')));
  // eslint-disable-next-line no-console
  console.log('★作り直した 後の URL★ ' + JSON.stringify(urls));
  expect(urls.some((u) => u.includes('aaaabbbbccccddddeeeeffff00001111'))).toBe(true);
  expect(
    urls.some((u) => u.includes('3b7433a6dddd4444eeee5555ffff6666')),
    '★古い token の リンクが 残った★'
  ).toBe(false);
  await expect(page.locator('#haifuList')).not.toContainText('3回 続けて 間違えて 止まっています');
});
