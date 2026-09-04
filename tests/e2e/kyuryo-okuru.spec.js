// ============================================================
// ★★「送る」＝共有シート／使えない台は コピー★★ 2026-09-04（司さん）
//
//   ★司さんの言葉★「★コピーのとこを 送るにして LINEや メールとかで 送れるように 出来るん？★」
//                   「★送るに 変えて★」
//
//   ★実測（2026-09-04）★
//     私の 試験の 台（Playwright/Chromium・Windows）… ★navigator.share は 使えません★
//     ⇒ ★だから 2通り 作って 2通りとも 押します★
//       ①共有シートが 使える台 … ★共有シートが 出る★（中身も 見る）
//       ②使えない台 …………… ★コピーに 落ちる★（今までと 同じ）
//     ★本物の iPhone で 共有シートが 出るかは 司さんの 実機でしか 分かりません★
//     （ここで 見るのは ★振り分けが 正しいか★と ★送る 中身★）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-04 実測）★★
//     ①共有シートを 呼ばない（いつも コピー）… ★赤★
//     ②送る 中身から リンクを 外す ………… ★赤★
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
    employee_id: FIX.emps[0].employee_id,
    name: FIX.emps[0].name,
    token: '7c4383b6aaaa1111bbbb2222cccc3333',
    init_code: '07041B0C',
    pw_ari: false,
    sort_order: 1,
  },
];

function tsukuru(dir) {
  const moto = fs.readFileSync(path.join(dir, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: FIX.settings[0].company_id, name: '見張り用' };
  return (
    moto +
    ';(function(){var F=' +
    JSON.stringify(FIX) +
    ';var co=' +
    JSON.stringify(co) +
    ';var L=' +
    JSON.stringify(LIST) +
    ';' +
    'function rows(p){ if(p.indexOf("dk_employees")===0)return F.emps||[]; if(p.indexOf("dk_device_labels")===0)return F.labels||[];' +
    ' if(p.indexOf("dk_payroll_settings")===0)return F.settings||[]; if(p.indexOf("dk_shifts")===0)return F.shifts||[];' +
    ' if(p.indexOf("dk_shift_edits")===0)return F.edits||[]; if(p.indexOf("dk_work_hours")===0)return F.workHours||[];' +
    ' if(p.indexOf("dk_manual_days")===0)return F.manualDays||[]; return [];}' +
    'var S=window.DKSession;S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p,o){' +
    '  if(String(p).indexOf("rpc/dk_kyuryo_haifu_hitori")===0){var eid=JSON.parse(o.body).p_employee_id;var h=null;L.forEach(function(y){if(y.employee_id===eid)h=y;});' +
    '    return Promise.resolve({ok:true,json:function(){return Promise.resolve(h?{ok:true,hito:h}:{ok:false,reason:"not_yours"});}});}' +
    '  return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function hiraku(page, share) {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(__dirname),
    })
  );
  // ★共有シートが 在る台／無い台 を 作る★（本物の 端末の 代わり）
  await page.addInitScript((aru) => {
    window.__SHARE__ = [];
    if (aru) {
      navigator.share = function (d) {
        window.__SHARE__.push(d);
        return Promise.resolve();
      };
    } else {
      try {
        delete navigator.share;
      } catch (e) {
        /* 元から 無い */
      }
    }
  }, share);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/kyuryo.html');
  await page.waitForTimeout(1800);
  await page.locator('.tab[data-tab="set"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-hhito]').first().click();
  await page.waitForTimeout(700);
}

test('★共有シートが 使える台＝押すと 共有シートが 出る★', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await hiraku(page, true);
  const b = page.locator('[data-hokuru]').first();
  expect(await b.textContent(), '★字が「送る」に なっていません★').toContain('送る');
  await b.click();
  await page.waitForTimeout(700);
  const d = await page.evaluate(() => window.__SHARE__);
  console.log('★共有シートに 渡した 物★ ' + JSON.stringify(d));
  expect(d.length, '★共有シートを 呼んでいません★').toBe(1);
  expect(d[0].url, '★リンクを 渡していません★').toContain('kyuryo.html?t=');
  expect(d[0].url, '★初回コードが 入っていません★').toContain('&c=');
  expect(d[0].text, '★誰の 分か 書いていません★').toContain(FIX.emps[0].name);
  expect(d[0].text, '★本人にだけ と 言っていません★').toContain('本人にだけ');
  expect(err, '★画面が 落ちました★').toEqual([]);
  await page.waitForTimeout(900);
  expect(await b.textContent(), '★字が 元に 戻っていません★').toContain('送る');
});

test('★共有シートが 無い台＝コピーに 落ちる★', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await hiraku(page, false);
  const b = page.locator('[data-hokuru]').first();
  await b.click();
  await page.waitForTimeout(500);
  console.log('★押した 後の 字★ ' + (await b.textContent()).trim());
  expect(await b.textContent(), '★コピーに 落ちていません★').toContain('コピーしました');
  const naka = await page.evaluate(() => navigator.clipboard.readText());
  console.log('★コピーした 中身★ ' + naka.slice(0, 90));
  expect(naka, '★リンクが 入っていません★').toContain('kyuryo.html?t=');
  expect(naka, '★誰の 分か 書いていません★').toContain(FIX.emps[0].name);
  expect(err, '★画面が 落ちました★').toEqual([]);
  await page.waitForTimeout(1400);
  expect(await b.textContent(), '★字が 元に 戻っていません★').toContain('送る');
});
