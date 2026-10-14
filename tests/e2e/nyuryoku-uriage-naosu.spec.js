// ============================================================
// 入力の 画面で メーターの 車の 売上を 直す 2026-10-14
//
//   司さん「金額の修正もできんやないか」（前は「メーターから 読めています（ここでは 変えられません）」）
//   給料の 時数を入れる と 同じ 列（dk_shift_edits.uriage_yen）。1回だけ 走った 日は 直せる。
//   2回 以上 走った 日は 合計しか 出せない ので 給料の 画面で 1回ずつ（字で 案内）。
//
//   ★わざと壊して 赤に なるのを 見た（2026-10-14 実測）★
//     欄を 足す 前の nyuryoku.html に 戻す ⇒ 赤（欄が 無い・送らない）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const LABELS = [{ company_id: 'c1', device_id: 'd1', label: '1466', sort_order: 1 }];
const SH = [
  {
    shift_id: 's1',
    device_id: 'd1',
    started_at: '2026-09-02T10:00:00+09:00',
    ended_at: '2026-09-02T18:00:00Z',
    fare_total_yen: 28700,
    trip_count: 9,
  },
];

function stub() {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: 'c1', name: 'ZERO代行' };
  return (
    moto +
    ';(function(){var co=' +
    JSON.stringify(co) +
    ';var L=' +
    JSON.stringify(LABELS) +
    ';var SH=' +
    JSON.stringify(SH) +
    ';window.__calls=[];var S=window.DKSession;' +
    'function rows(p){ if(p.indexOf("dk_shifts")===0)return SH; if(p.indexOf("dk_device_labels")===0)return L; return [];}' +
    'S.ensure=function(){return Promise.resolve({access_token:"t"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p,o){var m=(o&&o.method)||"GET";if(m!=="GET")window.__calls.push({p:p,m:m,b:o&&o.body?JSON.parse(o.body):null});' +
    'return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve("");},json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function hiraku(page) {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: stub() })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/nyuryoku.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await page.fill('#hiSel', '2026-09-02');
  await page.dispatchEvent('#hiSel', 'change');
  await page.waitForTimeout(1200);
}
async function utsu(page, v) {
  await page.evaluate((x) => {
    const i = document.querySelector('[data-uri-sid="s1"]');
    i.value = x;
    i.dispatchEvent(new Event('change'));
  }, v);
  await page.waitForTimeout(400);
}
const posts = (page) =>
  page.evaluate(() => window.__calls.filter((c) => c.p.indexOf('dk_shift_edits') === 0));

test('1回だけ 走った 車の 売上を 直せる（「8,000」＝8000・空で メーターに 戻る・字は 止める）', async ({
  page,
}) => {
  await hiraku(page);
  const i = page.locator('[data-uri-sid="s1"]');
  await expect(i).toBeEnabled();
  await expect(i).toHaveAttribute('placeholder', '28700');
  await utsu(page, '8,000');
  await utsu(page, '');
  let p = await posts(page);
  expect(p.map((x) => x.b.uriage_yen)).toEqual([8000, null]);
  expect(Object.keys(p[0].b), '売上の 保存で 実費の 列を 送った').not.toContain('toll_yen');
  await utsu(page, '-1');
  await expect(page.locator('#err')).toContainText('0以上の 整数');
  p = await posts(page);
  expect(p, '読めない 字で 送った').toHaveLength(2);
});
