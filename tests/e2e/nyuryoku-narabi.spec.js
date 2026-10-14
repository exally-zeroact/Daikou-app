// ============================================================
// 入力の 画面の 車の 並び＝会社設定の「並び」の 順 2026-10-14
//
//   司さん「入力のとこの並びもめちゃくちゃやろがぼけ」
//   前は 倉庫から 札を 読んだ 順の まま 並べていた（並びの 数を 見ていなかった）。
//   ⇒ js/car-name.js の sortIds（売上・給料・請求書と 同じ 1か所）で 並べる。
//
//   ★わざと壊して 赤に なるのを 見た（2026-10-14 実測）★
//     並べ替える 前の nyuryoku.html に 戻す ⇒ 赤（倉庫が 返した 順の まま）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// 倉庫が 返す 順は わざと 並びの 順と 違う 形にする
const LABELS = [
  { company_id: 'c1', device_id: 'd3', label: '1173', sort_order: 3 },
  { company_id: 'c1', device_id: 'd1', label: '1466', sort_order: 1 },
  { company_id: 'c1', device_id: 'd2', label: '4987', sort_order: 2 },
];
const SH = ['d3', 'd2', 'd1'].map((d, i) => ({
  shift_id: 's' + i,
  device_id: d,
  started_at: '2026-09-02T10:00:00+09:00',
  ended_at: '2026-09-02T18:00:00Z',
  fare_total_yen: 10000 + i,
  trip_count: 3,
  actual_total_m: 10000,
  total_distance_m: 20000,
}));

function stub(sh) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: 'c1', name: 'ZERO代行' };
  return (
    moto +
    ';(function(){var co=' +
    JSON.stringify(co) +
    ';var L=' +
    JSON.stringify(LABELS) +
    ';var SH=' +
    JSON.stringify(sh || SH) +
    ';var S=window.DKSession;' +
    'function rows(p){ if(p.indexOf("dk_shifts")===0)return SH; if(p.indexOf("dk_device_labels")===0)return L; return [];}' +
    'S.ensure=function(){return Promise.resolve({access_token:"t"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p,o){return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve("");},json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

test('入力の 車は 会社設定の 並びの 順', async ({ page }) => {
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
  const sha = await page.evaluate(() =>
    [...document.querySelectorAll('#shaList .sha-na')].map((x) => x.textContent.trim())
  );
  expect(sha).toEqual(['1466', '4987', '1173']);
});

test('走った 車が 1台も 無い 日も 会社設定の 並びの 順', async ({ page }) => {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: stub([]) })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/nyuryoku.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  // 業務を 1本も 返さない 倉庫＝走った 車が 0台の 日
  await page.fill('#hiSel', '2026-09-05');
  await page.dispatchEvent('#hiSel', 'change');
  await page.waitForTimeout(1200);
  const sha = await page.evaluate(() =>
    [...document.querySelectorAll('#shaList .sha-na')].map((x) => x.textContent.trim())
  );
  expect(sha).toEqual(['1466', '4987', '1173']);
});

// 2026-10-14 対立役：使わない 印の 業務が 在る 車にも「メーターの 記録が ありません」と 出た（字が 嘘）
test('使わない 印の 業務が 在る 車は「使わない 印」と 書く（記録が 無い とは 書かない）', async ({
  page,
}) => {
  const sh = SH.map((x) => (x.device_id === 'd3' ? Object.assign({}, x, { excluded: true }) : x));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: stub(sh) })
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
  const r = await page.evaluate(() =>
    [...document.querySelectorAll('#shaList .sha')].map((b) => ({
      na: (b.querySelector('.sha-na') || {}).textContent,
      hint: [...b.querySelectorAll('.hint')].map((h) => h.textContent).join(' '),
    }))
  );
  const d3 = r.find((x) => (x.na || '').trim() === '1173');
  expect(d3, '1173 の 箱が 無い').toBeTruthy();
  expect(d3.hint).toContain('使わない');
  expect(d3.hint).not.toContain('メーターの 記録が ありません');
});
