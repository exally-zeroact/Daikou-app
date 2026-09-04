// ============================================================
// ★★給料の設定は どこからでも 保存できる★★ 2026-09-04（司さん）
//
//   ★司さんの言葉★「見せたかも ごちゃごちゃして 何がどこにあるか 分からんし」
//
//   ★実測（2026-09-04）★ 給料の設定タブ ＝ ★3,457px（3.8画面ぶん）★
//     保存ボタンは 上から ★3,032px★ ＝ ★3.4画面 スクロールしないと 押せなかった★
//   ⇒ ★下に 貼り付けた★（sticky）＝直したら その場で 押せる。★押す手間は 増えない★
//   ★元の 保存ボタンは 消していない★（前から 在る物を 2段に 落とさない）
//   ★保存の 決まりは 1か所★＝下のボタンは ★元のボタンを 押すだけ★
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-04 実測）★★
//     ①貼り付け(sticky)を やめる … ★1本 赤★
//     ②下のボタンから 元を 呼ぶのを やめる … ★1本 赤★
//     戻した後 … ★緑★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);
test('★保存は どこからでも 押せる（下に 貼り付け）★', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const t =
    moto +
    ';(function(){var F=' +
    JSON.stringify(FIX) +
    ';var co={company_id:F.settings[0].company_id,name:"見張り用"};' +
    'function rows(p){ if(p.indexOf("dk_employees")===0)return F.emps||[]; if(p.indexOf("dk_device_labels")===0)return F.labels||[];' +
    ' if(p.indexOf("dk_payroll_settings")===0)return F.settings||[]; if(p.indexOf("dk_shifts")===0)return F.shifts||[];' +
    ' if(p.indexOf("dk_shift_edits")===0)return F.edits||[]; if(p.indexOf("dk_work_hours")===0)return F.workHours||[];' +
    ' if(p.indexOf("dk_manual_days")===0)return F.manualDays||[]; return [];}' +
    'var S=window.DKSession;S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();';
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: t })
  );
  await page.goto('/kyuryo.html');
  await page.waitForTimeout(1600);
  await page.locator('.tab[data-tab="set"]').click();
  await page.waitForTimeout(500);
  // ★下の 保存が いつでも 見えているか★
  const mieru = await page.evaluate(() => {
    const b = document.getElementById('btnSaveSet2');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return {
      ue: Math.round(r.top),
      mado: window.innerHeight,
      mieteru: r.top >= 0 && r.bottom <= window.innerHeight + 1,
    };
  });
  console.log('★下の 保存★ ' + JSON.stringify(mieru));
  expect(mieru, '★下の 保存ボタンが ありません★').toBeTruthy();
  expect(mieru.mieteru, '★下の 保存が 見えていません★').toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const m2 = await page.evaluate(() => {
    const b = document.getElementById('btnSaveSet2');
    const r = b.getBoundingClientRect();
    return { mieteru: r.top >= 0 && r.bottom <= window.innerHeight + 1 };
  });
  console.log('★一番 上に 居る時も 見えているか★ ' + JSON.stringify(m2));
  expect(m2.mieteru, '★一番 上に 居ると 保存が 消えます★').toBe(true);
  // ★下のボタンは 元のボタンを 押すだけ（決まりを 2か所に 書かない）★
  const yobu = await page.evaluate(() => {
    let yonda = 0;
    const b = document.getElementById('btnSaveSet');
    const moto = b.onclick;
    b.onclick = function () {
      yonda++;
    };
    document.getElementById('btnSaveSet2').onclick();
    b.onclick = moto;
    return yonda;
  });
  expect(yobu, '★下のボタンが 元のボタンを 押していません★').toBe(1);
  const r = await page.evaluate(() => {
    const b = document.getElementById('btnSaveSet');
    const rect = b.getBoundingClientRect();
    return {
      zenkou: Math.round(document.body.scrollHeight),
      botanY: Math.round(rect.top + window.scrollY),
      mado: window.innerHeight,
      hako: [...document.querySelectorAll('#paneSet > .card')].map((c) => ({
        na: (c.querySelector('.title') || {}).textContent || '?',
        h: Math.round(c.getBoundingClientRect().height),
      })),
    };
  });
  console.log(
    '★設定タブの 高さ★ ' +
      r.zenkou +
      'px ／ 窓 ' +
      r.mado +
      'px ＝ ★' +
      (r.zenkou / r.mado).toFixed(1) +
      '画面ぶん★'
  );
  console.log(
    '★保存ボタンの 位置★ 上から ' +
      r.botanY +
      'px ＝ ★' +
      (r.botanY / r.mado).toFixed(1) +
      '画面 スクロールしないと 押せない★'
  );
  r.hako.forEach((h) => console.log('   箱 ' + String(h.na).trim() + ' … ' + h.h + 'px'));
  await page.screenshot({ path: 'C:/Users/zeroa/dk-tokei-2026-09-02/tokei/shot-hozon.png' });
});
