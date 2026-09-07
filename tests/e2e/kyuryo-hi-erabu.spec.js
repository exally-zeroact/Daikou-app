// ============================================================
// ★★時数を入れる＝日を 選んで その日だけ 見せる★★ 2026-09-06（司さん）
//
//   ★司さんの言葉★
//     「代行請求書アプリのようにカレンダーで日付選んでできるようにしろ
//       その日だけ見せてスッキリさせろ」
//
//   ★前★ 期間の 日を ★全部 縦に 並べていた★（1〜10日なら 10日ぶん）
//     ⇒ 実測 高さ ★1,493px★（390px の 画面で 4画面ぶん）
//   ★今★ ★日の 札を 押すと その日だけ★／「全部」で 今まで通り
//     ⇒ 実測 高さ ★140px★（10日 → 1日）
//   ★打ってある 日には ●★（開かなくても 分かる）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-06 実測）★★
//     ①絞りを 外す（全部 出す）……… ★赤★
//     ②日の 札を 出さない ………… ★赤★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);
const CO = FIX.settings[0].company_id;

function sess() {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: 'ZERO代行' };
  return (
    moto +
    ';(function(){var F=' +
    JSON.stringify(FIX) +
    ';var co=' +
    JSON.stringify(co) +
    ';' +
    'function rows(p){ if(p.indexOf("dk_employees")===0)return F.emps||[]; if(p.indexOf("dk_device_labels")===0)return F.labels||[];' +
    ' if(p.indexOf("dk_payroll_settings")===0)return F.settings||[]; if(p.indexOf("dk_shifts")===0)return F.shifts||[];' +
    ' if(p.indexOf("dk_shift_edits")===0)return F.edits||[]; if(p.indexOf("dk_work_hours")===0)return F.workHours||[];' +
    ' if(p.indexOf("dk_manual_days")===0)return F.manualDays||[]; return [];}' +
    'var S=window.DKSession;S.ensure=function(){return Promise.resolve({access_token:"t"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p,o){return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve("");},json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

test('★★日を 選ぶと その日だけ 出る（短く なる）★★', async ({ page }) => {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: sess(),
    })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/kyuryo.html#hours', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    const b = document.querySelector('.tab[data-tab="hours"]');
    if (b && b.onclick) b.onclick();
  });
  await page.waitForTimeout(700);
  const zenbu = await page.evaluate(() => ({
    fuda: document.querySelectorAll('#hibar .hib').length,
    ari: document.querySelectorAll('#hibar .hib.ari').length,
    hi:
      document.querySelectorAll('#days [data-date]').length ||
      document.getElementById('days').children.length,
    takasa: document.getElementById('days').getBoundingClientRect().height,
  }));
  // eslint-disable-next-line no-console
  console.log('★全部★ ' + JSON.stringify(zenbu));
  // ★2つ目の 札（＝最初の 日）を 押す★
  await page.evaluate(() => {
    const b = document.querySelectorAll('#hibar .hib')[1];
    if (b) b.click();
  });
  await page.waitForTimeout(500);
  const hitotsu = await page.evaluate(() => ({
    hi:
      document.querySelectorAll('#days [data-date]').length ||
      document.getElementById('days').children.length,
    takasa: document.getElementById('days').getBoundingClientRect().height,
    erabi: (document.querySelector('#hibar .hib.on') || {}).textContent || '',
  }));
  // eslint-disable-next-line no-console
  console.log('★1日だけ★ ' + JSON.stringify(hitotsu));
  expect(zenbu.fuda, '★日の 札が 出ていません★').toBeGreaterThan(1);
  expect(hitotsu.hi, '★1日だけに なっていません★').toBe(1);
  expect(hitotsu.takasa, '★短く なっていません★').toBeLessThan(zenbu.takasa);
});
