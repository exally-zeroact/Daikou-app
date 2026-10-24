// ============================================================
// ★★3回 続けて 間違えて 止まった 人・作り直し★★ 2026-10-20（docs/pw-4keta.md）
//   司さん 10-19「新しく URL や QR コードを 作成し直す」＝作り直すと token も 替わる
//   わざと壊す：一覧の x.tomatta を 見ない ⇒ 赤（「止まっています」が 出ない）
//   2026-10-24 一覧を 外し 明細の 見せる 窓へ 移した。わざと壊す：haifuOkuru の 止まった 人の 門を 外す ⇒ 赤（写した）／
//              窓の 作り直しで 描き直さない（haifuMadoNaoshi を 外す）⇒ 赤（古い 窓の まま）
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
  // ★★2026-10-24 給料の 設定の 配る 一覧は 外した（司さん「配るは明細からできるからのけろ」）★★
  //   ⇒「止まっています」と「作り直す」は 明細の「QRを 見せる」の 窓の 中。止まった 人の「送る」は 共有せず その 窓を 出す（対立役 S3）
  const JIRO = '46a60d53-02b7-47ef-829e-6fd03cee1a31';
  await page.goto('/kyuryo.html?henshu=1');
  await page.waitForTimeout(1800);
  await page.locator('.tab[data-tab="slip"]').click();
  await page.waitForTimeout(500);
  // 送る：止まった 人の 死んだ リンクを 送らない（コピーも しない）
  await page.evaluate(() => navigator.clipboard.writeText('mae'));
  await page
    .locator('[data-meisai-okuru="' + JIRO + '"]')
    .first()
    .click();
  await expect(page.locator('#haifuMiseTomatta')).toContainText(
    '3回 続けて 間違えて 止まっています'
  );
  expect(
    await page.evaluate(() => navigator.clipboard.readText()),
    '★止まった 人の リンクを 写した★'
  ).toBe('mae');
  expect(await page.locator('#haifuMise svg').count(), '★止まった 人に 古い QR を 見せた★').toBe(0);
  await page.locator('#haifuMise').click({ position: { x: 5, y: 5 } });
  // 見せる：同じ 窓
  await page
    .locator('[data-meisai-qr="' + JIRO + '"]')
    .first()
    .click();
  await expect(page.locator('#haifuMiseTomatta')).toContainText(
    '3回 続けて 間違えて 止まっています'
  );
  // 作り直す（1人ぶんの 取り直しは 通信で 落ちる＝それでも 新しい token に なる）・押しても 窓は 閉じない
  await page.evaluate(() => (window.__hitoriOchiru = true));
  await page.click('#haifuMise [data-mado-sai="' + JIRO + '"]');
  await page.waitForTimeout(800);
  const url = await page.locator('#haifuMiseQr').getAttribute('data-url-mihari');
  // eslint-disable-next-line no-console
  console.log('★作り直した 後の URL★ ' + url);
  expect(url).toContain('aaaabbbbccccddddeeeeffff00001111');
  expect(url, '★作り直した 初回コードが 無い★').toContain('&c=NEW11111');
  expect(url, '★古い token の リンクが 残った★').not.toContain('3b7433a6dddd4444eeee5555ffff6666');
  await expect(page.locator('#haifuMise')).not.toContainText('3回 続けて 間違えて 止まっています');
});
