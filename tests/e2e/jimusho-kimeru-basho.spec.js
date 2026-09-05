// ============================================================
// ★★決める所は 会社設定に 集める★★ 2026-09-05（司さん）
//   「会社の設定で 料金 触るようにしろや」
//   「設定画面の 中に チップで 車、料金、従業員マスタ つくったら 各ページ 見やすくなるやろ」
//
//   ★やり方★ ★出し方だけ 分ける★（中身は 動かさない＝壊さない）
//     ・料金表 …… 見るだけ／?henshu=1 で 決める
//     ・給料 …… 明細・時数だけ／?henshu=1 で「従業員」「給料の設定（車）」も 出る
//     ・会社設定 … チップ 4つ（会社／車／料金／従業員）＋それぞれの 入口
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-05 実測）★★
//     ①給料で いつも 全部の タブを 出す ………… ★赤★（①の 段）
//     ②会社設定の 入口の 行き先を 変える ……… ★赤★（③の 段）
//     ③チップを 1つ 消す ………………………… ★赤★（③の 段）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);
const CO = FIX.settings[0].company_id;
const KAISHA = {
  company_id: 'c1',
  name: 'ZERO代行',
  status: 'on',
  url_token: 'tok1',
  home_city: '今治市',
  owner_id: 'u1',
};

function kyuryoSess() {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: '見張り用' };
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
    'var S=window.DKSession;S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function kyuryoHiraku(page, ura) {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: kyuryoSess(),
    })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  // ★★同じ 画面で # だけ 変えても 読み直しません★★（実際に 踏んだ）
  //   ⇒ ★毎回 about:blank を 通してから 開く★＝新しく 読み直される
  await page.goto('about:blank');
  await page.goto('/kyuryo.html' + (ura || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2400);
}

function tabYomu(page) {
  return page.evaluate(() => ({
    tab: [...document.querySelectorAll('.tab')]
      .filter((b) => b.offsetWidth > 0)
      .map((b) => b.textContent.trim() + (b.classList.contains('on') ? '★' : '')),
  }));
}

test('★★① 給料は ふだん「明細」「時数を入れる」だけ★★', async ({ page }) => {
  await kyuryoHiraku(page);
  const r = await tabYomu(page);
  // eslint-disable-next-line no-console
  console.log('★給料（見るだけ）★ ' + JSON.stringify(r));
  expect(r.tab.length, '★タブの 数が 違います★').toBe(2);
  expect(r.tab.join(','), '★決める タブが 出ています★').not.toContain('従業員');
  expect(r.tab.join(','), '★決める タブが 出ています★').not.toContain('給料の設定');
});

test('★★② ?henshu=1 で「従業員」「給料の設定」も 出る★★', async ({ page }) => {
  await kyuryoHiraku(page, '?henshu=1#emp');
  const r = await tabYomu(page);
  // eslint-disable-next-line no-console
  console.log('★従業員を 決める★ ' + JSON.stringify(r));
  expect(r.tab.length, '★決める タブが 出ていません★').toBe(4);
  expect(r.tab.join(','), '★従業員の タブが 選ばれていません★').toContain('従業員★');

  await kyuryoHiraku(page, '?henshu=1#set');
  const r2 = await tabYomu(page);
  // eslint-disable-next-line no-console
  console.log('★車を 決める★ ' + JSON.stringify(r2));
  expect(r2.tab.join(','), '★給料の設定が 選ばれていません★').toContain('給料の設定★');
});

test('★★③ 会社設定に チップ 4つと 入口が 在る★★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const stub =
    moto +
    ';(function(){var co=' +
    JSON.stringify(KAISHA) +
    ';var S=window.DKSession;if(!S)return;' +
    'S.ensure=function(){return Promise.resolve({access_token:"t",user:{id:"u1"}});};' +
    'S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};' +
    'S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(String(p||"").indexOf("dk_companies")===0?[co]:[]);}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(String(p||"").indexOf("dk_companies")===0?[co]:[]);};})();';
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: stub })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'u1', email: 'x@example.com' }),
    })
  );
  await page.route('**/rest/v1/**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(r.request().url().indexOf('dk_companies') >= 0 ? [KAISHA] : []),
    })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);

  const r = await page.evaluate(() => ({
    chip: [...document.querySelectorAll('[data-chip]')].map((b) => b.textContent.trim()),
    // ★押した 1つだけ 出る★
    mieru: [...document.querySelectorAll('[data-pane]')]
      .filter((d) => d.offsetHeight > 0)
      .map((d) => d.getAttribute('data-pane')),
  }));
  // eslint-disable-next-line no-console
  console.log('★会社設定★ ' + JSON.stringify(r));
  expect(r.chip, '★チップが 4つ ありません★').toEqual(['会社', '車', '料金', '従業員']);
  expect(r.mieru.length, '★出ているのが 1つでは ありません★').toBe(1);

  // ★入口の 行き先★（ここが 崩れると 決められなく なる）
  const iki = await page.evaluate(() =>
    [...document.querySelectorAll('[data-pane] a.btn')].map((a) => a.getAttribute('href'))
  );
  // eslint-disable-next-line no-console
  console.log('★入口★ ' + JSON.stringify(iki));
  expect(iki, '★車の 入口が ありません★').toContain('kyuryo.html?henshu=1#set');
  expect(iki, '★料金の 入口が ありません★').toContain('ryokinhyou.html?henshu=1');
  expect(iki, '★従業員の 入口が ありません★').toContain('kyuryo.html?henshu=1#emp');

  expect(err, '★画面が 落ちました★').toEqual([]);
});
