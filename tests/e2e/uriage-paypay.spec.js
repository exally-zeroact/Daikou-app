// ============================================================
// ★★PayPay を 打つ 所は「入力」タブ★★ 2026-09-06
//
//   ★司さんの言葉★「入力タブは」
//
//   ★何が 悪かったか★
//     日ごとの PayPay を ★月次集計★に 付けてしまった。
//     司さんが 毎日 打つのは ★売上表の「入力」★。
//     ⇒ 打つ 所が 2か所に 在ると ★どちらが 本当か 分からなく なる★。
//
//   ★決めた 事★
//     打つ … ★売上表の「入力」だけ★（ここで 見張る）
//     見る … 月次集計（★打つ 欄は 置かない★＝paypay-higoto.spec.js で 見張る）
//
//   ★形★ 1日ぶんが 1かたまり
//     ┌ 3/1(日)              PayPay [    ] ← ★日の 帯★
//     │ 4987   高速[] 橋[] その他[] …
//     └ 1234   高速[] 橋[] …
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-06 実測）★★
//     ①PayPay の 欄も 実費と 同じ 所へ 送る … ★赤★（棚へ 0本）
//     ②日の 帯を 出さない ……………………… ★赤★（帯0・欄0）
//     ③前に 入れた 分を 読まない …………… ★赤★（3,200 が 空に なる）
//     戻した後 … ★緑★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const KINDS = [
  { kind_id: 'toll', label: '高速代', sort_order: 10, active: true },
  { kind_id: 'bridge', label: '橋代', sort_order: 20, active: true },
];
// ★2日ぶん × 車2台★（日の 帯が 2本／車の 行が 3本 出る はず）
const SH = [
  {
    shift_id: 's1',
    device_id: 'd1',
    started_at: '2026-09-02T10:00:00Z',
    ended_at: '2026-09-02T18:00:00Z',
    fare_total_yen: 18800,
    trip_count: 9,
    actual_total_m: 54700,
    total_distance_m: 124700,
  },
  {
    shift_id: 's2',
    device_id: 'd2',
    started_at: '2026-09-02T11:00:00Z',
    ended_at: '2026-09-02T19:00:00Z',
    fare_total_yen: 9000,
    trip_count: 4,
    actual_total_m: 21000,
    total_distance_m: 50000,
  },
  {
    shift_id: 's3',
    device_id: 'd1',
    started_at: '2026-09-03T10:00:00Z',
    ended_at: '2026-09-03T18:00:00Z',
    fare_total_yen: 7000,
    trip_count: 3,
    actual_total_m: 15000,
    total_distance_m: 40000,
  },
];
const PPD = [{ company_id: 'c1', pay_date: '2026-09-02', paypay_yen: 3200 }];

// ★打った 物が どこへ 行ったか 数える★（本物の 倉庫には 出しません）
function stub() {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: 'c1', name: 'ZERO代行' };
  return (
    moto +
    ';(function(){var co=' +
    JSON.stringify(co) +
    ';var K=' +
    JSON.stringify(KINDS) +
    ';var SH=' +
    JSON.stringify(SH) +
    ';var PPD=' +
    JSON.stringify(PPD) +
    ';var S=window.DKSession;window.__okutta=[];' +
    'function rows(p){ if(p.indexOf("dk_expense_kinds")===0)return K; if(p.indexOf("dk_shifts")===0)return SH;' +
    ' if(p.indexOf("dk_day_extras")===0)return PPD;' +
    ' if(p.indexOf("dk_device_labels")===0)return [{company_id:"c1",device_id:"d1",label:"4987",sort_order:1},{company_id:"c1",device_id:"d2",label:"1234",sort_order:2}]; return [];}' +
    'S.ensure=function(){return Promise.resolve({access_token:"t"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p,o){ if(o&&o.method)window.__okutta.push({saki:p,method:o.method,body:o.body});' +
    ' return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve("");},json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function hiraku(page) {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: stub(),
    })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/uriage.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2400);
  await page.click('#segIn');
  await page.waitForTimeout(600);
}

test('★★① 入力タブに 日ごとの PayPay の 欄が 在る★★', async ({ page }) => {
  await hiraku(page);
  const r = await page.evaluate(() => ({
    obi: document.querySelectorAll('#kamiBody tr.hi-obi').length,
    pp: document.querySelectorAll('#kamiBody [data-ppd]').length,
    kuruma: document.querySelectorAll('#kamiBody tr:not(.hi-obi)').length,
    hi: [...document.querySelectorAll('#kamiBody [data-ppd]')].map((x) =>
      x.getAttribute('data-ppd')
    ),
    atai: [...document.querySelectorAll('#kamiBody [data-ppd]')].map((x) => x.value),
  }));
  // eslint-disable-next-line no-console
  console.log('★入力タブ★ ' + JSON.stringify(r));
  expect(r.obi, '★日の 帯が 2本 出るはず（9/2 と 9/3）★').toBe(2);
  expect(r.pp, '★PayPay の 欄は 日に 1つ★').toBe(2);
  expect(r.kuruma, '★車の 行は 3本 出るはず★').toBe(3);
  expect(r.hi, '★帯が 日ごとに なっていません★').toEqual(['2026-09-02', '2026-09-03']);
  expect(r.atai[0], '★前に 入れた 3,200 が 出ていません★').toBe('3200');
  expect(r.atai[1], '★入れていない 日は 空★').toBe('');
});

test('★★② 打つと 日ごとの 棚へ 行く（元データは 触らない）★★', async ({ page }) => {
  await hiraku(page);
  await page.fill('#kamiBody [data-ppd="2026-09-03"]', '4500');
  await page.locator('#kamiBody [data-ppd="2026-09-03"]').blur();
  await page.waitForTimeout(500);
  const okutta = await page.evaluate(() => window.__okutta || []);
  // eslint-disable-next-line no-console
  console.log('★送った 先★ ' + JSON.stringify(okutta.map((x) => x.saki)));
  const pp = okutta.filter((x) => x.saki.indexOf('dk_day_extras') === 0);
  expect(pp.length, '★日ごとの 棚へ 行っていません★').toBe(1);
  const body = JSON.parse(pp[0].body);
  expect(body.pay_date, '★日が 違います★').toBe('2026-09-03');
  expect(body.paypay_yen, '★打った 額が 違います★').toBe(4500);
  expect(body.company_id, '★会社が 入っていません★').toBe('c1');
  // ★元データには 1行も 書かない★
  expect(
    okutta.filter((x) => /dk_shifts|dk_trips|dk_work_hours|dk_employees/.test(x.saki)).length,
    '★元データに 書いています★'
  ).toBe(0);
});

test('★★③ 実費は 前と 同じ 所へ 行く（巻き添えに なっていない）★★', async ({ page }) => {
  await hiraku(page);
  const kou = page.locator('#kamiBody tr:not(.hi-obi)').first().locator('input.yen').first();
  await kou.fill('1200');
  await kou.blur();
  await page.waitForTimeout(500);
  const okutta = await page.evaluate(() => window.__okutta || []);
  const ed = okutta.filter((x) => x.saki.indexOf('dk_shift_edits') === 0);
  // eslint-disable-next-line no-console
  console.log('★実費の 送り先★ ' + JSON.stringify(ed.map((x) => JSON.parse(x.body))));
  expect(ed.length, '★実費が 保存に 行っていません★').toBe(1);
  expect(JSON.parse(ed[0].body).toll_yen, '★高速代が 入っていません★').toBe(1200);
  expect(
    okutta.filter((x) => x.saki.indexOf('dk_day_extras') === 0).length,
    '★実費を 打ったのに PayPay の 棚へ 行っています★'
  ).toBe(0);
});
