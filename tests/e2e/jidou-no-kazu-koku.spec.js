// ============================================================
// 自動で 入っている 数（placeholder）を 濃く 2026-10-19（司さん）
//   「入力の自動反映されてる数値が薄くて分かりにくい」
//   守る 事：給料（kyuryo.html）と 入力（nyuryoku.html）の 両方で
//     ①placeholder の 色が 説明の 字と 同じ --muted（ブラウザ 既定の 薄い 灰で ない）・透けない
//     ②打った 値の 色（--ink）とは 違う＝自動か 打ったかは 見分けが 付く
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

async function iro(page, sel) {
  return page.evaluate((s) => {
    const i = document.querySelector(s);
    const ph = getComputedStyle(i, '::placeholder');
    const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
    const d = document.createElement('div');
    d.style.color = muted;
    document.body.appendChild(d);
    const mutedRgb = getComputedStyle(d).color;
    d.remove();
    return { ph: ph.color, op: ph.opacity, ji: getComputedStyle(i).color, muted: mutedRgb };
  }, sel);
}

test('入力の 画面：自動の 数は --muted の 濃さ・打った 値とは 違う 色', async ({ page }) => {
  await hiraku(page);
  const r = await iro(page, '[data-uri-sid="s1"]');
  expect(r.ph).toBe(r.muted);
  expect(r.op).toBe('1');
  expect(r.ph).not.toBe(r.ji);
});

test('給料の 画面：自動の 数は --muted の 濃さ', async ({ page }) => {
  await page.route('**/js/dk-session.js*', (rt) =>
    rt.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: stub() })
  );
  await page.route('**/auth/v1/**', (rt) =>
    rt.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
  await page.goto('/kyuryo.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const i = document.createElement('input');
    i.className = 'hrs';
    i.id = '__ph';
    i.placeholder = '7.75';
    document.body.appendChild(i);
  });
  const r = await iro(page, '#__ph');
  expect(r.ph).toBe(r.muted);
  expect(r.op).toBe('1');
});
