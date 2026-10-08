// ============================================================
// ★★入力の 日は 日本の 外の 端末でも 日本時間★★ 2026-10-08（司さん「対応させろや」）
//   ★この ファイルだけ わざと 時間帯を 日本の 外（ロサンゼルス）に する★＝tests/unit/tokei-tomeru-nara-jikantai-mo.test.js の ③ が 名指しで 外す
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function stub(shifts) {
  const moto = fs.readFileSync(path.join(ROOT, 'js', 'dk-session.js'), 'utf8');
  const D = {
    co: { company_id: 'c1', name: 'ZERO代行' },
    SH: shifts || [],
    K: [{ kind_id: 'toll', label: '高速代', sort_order: 10, active: true }],
  };
  return (
    moto +
    ';(function(){var D=' +
    JSON.stringify(D) +
    ';var S=window.DKSession;window.__okutta=[];' +
    'function rows(p){ if(p.indexOf("dk_expense_kinds")===0)return D.K;' +
    ' if(p.indexOf("dk_device_labels")===0)return [{company_id:"c1",device_id:"d1",label:"4987",sort_order:1}];' +
    // ★倉庫と 同じ 読み方★ 2026-10-08（対立役：gte・lt を 1つずつ 効かせ、時間帯 無しの 字は UTC＝本物の 倉庫と 同じ・desc は 並べる）
    ' if(p.indexOf("dk_shifts")===0){ var qq=decodeURIComponent(p);' +
    ' var hasi=function(k){var m=new RegExp("[?&]started_at="+k+"\\.([^&]+)").exec(qq); if(!m)return null; var v=m[1]; if(!/(Z|[+-]\\d\\d:?\\d\\d)$/.test(v))v+="Z"; return +new Date(v);};' +
    ' var f=hasi("gte"), t=hasi("lt");' +
    ' var a=D.SH.filter(function(x){var d=+new Date(x.started_at); return (f===null||d>=f)&&(t===null||d<t);});' +
    ' if(/order=started_at\\.desc/.test(qq))a=a.slice().sort(function(x,y){return +new Date(y.started_at)-+new Date(x.started_at);});' +
    ' return a;} return [];}' +
    'S.ensure=function(){return Promise.resolve({access_token:"t"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return D.co.company_id;};S.pickCompany=function(){return {mode:"one",company:D.co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([D.co]);}});};' +
    'S.rest=function(s,p,o){ if(o&&o.method)window.__okutta.push({saki:p,method:o.method,body:o.body}); return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve("");},json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function hiraku(page, gamen, shifts) {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: stub(shifts),
    })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
  // ★会社設定は DKSession を 通さず 自分で fetch する★ ので 通信を 差し替える
  await page.route('**/rest/v1/**', (r) => {
    const u = r.request().url();
    let body = '[]';
    if (u.indexOf('dk_expense_kinds') >= 0) {
      body = JSON.stringify([
        { company_id: 'c1', kind_id: 'toll', label: '高速代', sort_order: 10, active: true },
        { company_id: 'c1', kind_id: 'bridge', label: '橋代', sort_order: 20, active: true },
      ]);
    } else if (u.indexOf('dk_companies') >= 0) {
      body = JSON.stringify([{ company_id: 'c1', name: 'ZERO代行' }]);
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: body });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/' + gamen, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
}

test.describe('★日本の 外の 端末★', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('★★③-6 走った 日へ は 日本時間の 日（端末が ロサンゼルスでも）★★', async ({ page }) => {
    await hiraku(page, 'nyuryoku.html', [
      { shift_id: 's1', device_id: 'd1', started_at: '2026-09-19T18:30:00+00:00' },
    ]);
    await page.fill('#hiSel', '2026-09-03');
    await page.dispatchEvent('#hiSel', 'change');
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => ({
      ji: (document.getElementById('btnLastRun') || {}).textContent || '',
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }));
    // eslint-disable-next-line no-console
    console.log('★外の 端末★ ' + JSON.stringify(r));
    expect(r.tz, '★端末が 日本の 外で ない＝空回り★').toBe('America/Los_Angeles');
    expect(r.ji, '★端末の 時計の 日（9/19）で 出た★').toContain('09/20');
  });
});
