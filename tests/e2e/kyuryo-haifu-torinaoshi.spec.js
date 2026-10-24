// ============================================================
// ★★別の 端末で 作り直された 後も 古い リンクを 配らない★★ 2026-10-20（docs/pw-4keta.md・対立役 本番前 直2・N1・N3・N4）
//   作り直すと token が 替わる＝事務所の 別の 画面の 控え（HAIFU）は 古い まま
//   2026-10-24 給料の 設定の 配る 一覧を 外した＝明細の「QRを 見せる」「送る」で 見る（前の ⑤ は ② に 入った）
//   わざと壊す：visibilitychange の 取り直しを 外す ⇒ ① 赤 ／ 見せる 前の 取り直しを 外す ⇒ ② 赤 ／
//              取れなかった 時の 訳を 外す ⇒ ③ 赤 ／ 戻った 時の 取り直しで 赤字を 出す ⇒ ④ 赤
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
async function haifuWoHiraku(page, context) {
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
    '    if(h&&window.__hitoriAtarashii)h=Object.assign({},h,{token:window.__hitoriAtarashii});' +
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
  //   ⇒ 明細の「QRを 見せる」で 1人（太郎）を 配って 控え（HAIFU）に 入れる。控えの リンクは 明細の「送る」で 写した 中身で 見る
  await page.goto('/kyuryo.html?henshu=1');
  await page.waitForTimeout(1800);
  await page.locator('.tab[data-tab="slip"]').click();
  await page.waitForTimeout(500);
  await page
    .locator('[data-meisai-qr="' + TARO + '"]')
    .first()
    .click();
  await page.waitForSelector('#haifuMiseQr');
  await page.locator('#haifuMise').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(200);
}
const TARO = 'ec8d275b-38c0-4d9f-b471-eeb10226a6a9';
// 控えの リンク＝明細の「送る」（控えに 居れば 取り直さずに 写す）で 写した 中身
const okuruNaka = async (page) => {
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page
    .locator('[data-meisai-okuru="' + TARO + '"]')
    .first()
    .click();
  await page.waitForTimeout(300);
  return page.evaluate(() => navigator.clipboard.readText());
};
const madoUrl = (page) => page.locator('#haifuMiseQr').getAttribute('data-url-mihari');
const ATARASHII = 'cccc1111dddd2222eeee3333ffff4444';

test('① 画面に 戻ると 配る 控えを 取り直す（別の 端末の 作り直しを 拾う）', async ({
  page,
  context,
}) => {
  await haifuWoHiraku(page, context);
  await page.evaluate((t) => (window.__hitoriAtarashii = t), ATARASHII);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(800);
  const naka = await okuruNaka(page);
  expect(naka, '★送る 中身が 古い リンク★').toContain(ATARASHII);
});
// わざと壊す：meisaiQr で 控えに 居れば そのまま 見せる（取り直さない）⇒ 赤
test('② 明細の「QRを 見せる」は 見せる 前に 取り直す', async ({ page, context }) => {
  await haifuWoHiraku(page, context);
  await page.evaluate((t) => (window.__hitoriAtarashii = t), ATARASHII);
  await page
    .locator('[data-meisai-qr="' + TARO + '"]')
    .first()
    .click();
  await page.waitForTimeout(800);
  expect(await madoUrl(page)).toContain(ATARASHII);
  await expect(page.locator('#haifuMiseFurui')).toHaveCount(0);
});
test('③ 取り直しが 落ちたら 見せる 窓に その 事を 出す', async ({ page, context }) => {
  await haifuWoHiraku(page, context);
  await page.evaluate(() => (window.__hitoriOchiru = true));
  await page
    .locator('[data-meisai-qr="' + TARO + '"]')
    .first()
    .click();
  await expect(page.locator('#haifuMiseFurui')).toContainText('新しいか 確かめられませんでした');
});
test('④ 画面に 戻った 時の 取り直しが 落ちても 赤字を 出さない', async ({ page, context }) => {
  await haifuWoHiraku(page, context);
  await page.evaluate(() => (window.__hitoriOchiru = true));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(800);
  await expect(page.locator('#err')).not.toContainText('配れませんでした');
});
