// ============================================================
// ★★見張り：給料の 合計＝明細の 差引支給の 全員分（件G）・明細に 載らない 手当・控除の 帯★★ 2026-10-23
//
//   偽の 会社：3人・端数が 出る 歩合・手当 1件・名簿に いない 人の 控除 333円 1件・月3回 締め
//   ★物差し★（node で 同じ 部品を 呼んで 出す）
//     明細の 差引支給＝人ごとの totalPay を Math.round ⇒ 回ごとに 全員分 足す
//   月次集計：9月の 給料の 欄 ＝ 3回分の 和・会社に 残る分 ＝ 売上 − その 和 − 積立・帯「1件」
//   給料タブ：みんなの給料 ＝ 明細の 紙の 合計を 全員分 足した 額 ＝ 物差し・帯「1件」
//
//   ★★わざと壊して 赤に なるのを 見た（2026-10-23 実測）★★
//     直す 前の 版（be349791a の js・kyuryo.html・shukei.html）⇒ ★赤★（帯が 無い・給料の 欄が 物差しと 違う）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { openKyuryo } = require('./kyuryo-harness');

const ROOT = path.join(__dirname, '..', '..');
globalThis.PayrollPeriod = require(path.join(ROOT, 'js', 'payroll-period.js'));
globalThis.DaikoPayroll = require(path.join(ROOT, 'js', 'daiko-payroll.js'));
globalThis.UriageAgg = require(path.join(ROOT, 'js', 'uriage-agg.js'));
const PD = require(path.join(ROOT, 'js', 'payroll-daily.js'));

const CO = '11111111-2222-3333-4444-555555555555';
test.use({ timezoneId: 'Asia/Tokyo' });

// ── 偽の 会社 ──
const emps = [1, 2, 3].map((i) => ({
  company_id: CO,
  employee_id: 'e' + i,
  name: '人' + i,
  role: '2種',
  sort_order: i,
  active: true,
}));
const md = [];
const wh = [];
for (let d = 1; d <= 30; d++) {
  const dt = '2026-09-' + String(d).padStart(2, '0');
  md.push({
    company_id: CO,
    work_date: dt,
    device_id: 'carA',
    sales_yen: 12347 + d * 7,
    hours: 3.3,
  });
  md.push({
    company_id: CO,
    work_date: dt,
    device_id: 'carB',
    sales_yen: 9871 + d * 3,
    hours: 2.7,
  });
  wh.push({ company_id: CO, work_date: dt, employee_id: 'e1', device_id: 'carA', hours: 0 });
  wh.push({ company_id: CO, work_date: dt, employee_id: 'e2', device_id: 'carB', hours: 0 });
  if (d % 2)
    wh.push({ company_id: CO, work_date: dt, employee_id: 'e3', device_id: 'carA', hours: 1.7 });
}
const adj = [
  {
    adj_id: 'a1',
    company_id: CO,
    work_date: '2026-09-05',
    employee_id: 'e1',
    kind: 'teate',
    label: '待機',
    yen: 1000,
  },
  {
    adj_id: 'a2',
    company_id: CO,
    work_date: '2026-09-06',
    employee_id: 'ghost',
    kind: 'koujo',
    label: '前借り',
    yen: 333,
  },
];
const SET = { company_id: CO, period_end_mode: 'thirds', period_start_day: 1 };

// ★物差し★
const ctx = PD.buildCtx({
  shifts: [],
  edits: [],
  workHours: wh,
  manualDays: md,
  adjustments: adj,
  labels: [],
  employees: emps,
  payrollSettings: SET,
  salesSettings: null,
});
const ps = globalThis.PayrollPeriod.periodsOf(2026, 9, { kata: ctx.settings.periodKata });
const MEISAI = ps.map((p) =>
  PD.report(p.dates, ctx).employees.reduce((a, e) => a + Math.round(e.totalPay), 0)
);
const MEISAI_ZEN = MEISAI.reduce((a, b) => a + b, 0);
const yenNo = (s) => Number(String(s || '').replace(/[^0-9-]/g, ''));

const T = {
  dk_employees: emps,
  dk_manual_days: md,
  dk_work_hours: wh,
  dk_pay_adjustments: adj,
  dk_payroll_settings: [SET],
  dk_device_labels: [],
};
function shukeiSession() {
  const moto = fs.readFileSync(path.join(ROOT, 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: '見張り用' };
  return (
    moto +
    ';(function(){var S=window.DKSession;var co=' +
    JSON.stringify(co) +
    ';var T=' +
    JSON.stringify(T) +
    ';' +
    'function rows(p){var na=String(p).split("?")[0];return T[na]||[];}' +
    'S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co,list:[co]};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

test('★月次集計：9月の 給料 ＝ 明細の 差引支給の 全員分・帯が 出る★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.clock.setFixedTime(new Date('2026-09-05T12:00:00+09:00'));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: shukeiSession(),
    })
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('#tbody3 tr[data-m="9"]'), null, {
    timeout: 15000,
  });
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const tds = (sel) =>
      Array.prototype.map.call(document.querySelectorAll(sel + ' td'), (x) => x.textContent);
    const obi = document.getElementById('meisaiGaiObi');
    return {
      kyu: tds('#tbody3 tr[data-m="9"]'),
      nokori: tds('#tbody2 tr[data-m="9"]'),
      obi: obi ? obi.textContent : null,
      obiMieru: !!obi && getComputedStyle(obi).display !== 'none',
    };
  });
  // eslint-disable-next-line no-console
  console.log('★月次★ ' + JSON.stringify({ r, MEISAI, MEISAI_ZEN }));
  expect(r.kyu.slice(1, 4).map(yenNo), '★回の 欄が 明細の 和と 違う★').toEqual(MEISAI);
  expect(yenNo(r.kyu[4]), '★月の 欄が 明細の 和と 違う★').toBe(MEISAI_ZEN);
  // 会社に 残る分 ＝ 売上 − 給料 − 積立（画面の 字から）
  const [, uri, kyu, tsumi, nokori] = r.nokori.map(yenNo);
  expect(kyu).toBe(MEISAI_ZEN);
  expect(
    Math.abs(nokori - (uri - kyu - tsumi)),
    '★会社に 残る分が 式と 合わない★'
  ).toBeLessThanOrEqual(1);
  expect(r.obiMieru, '★明細に 載らない 手当・控除の 帯が 出ない★').toBe(true);
  expect(r.obi).toBe('明細に載らない手当・控除が1件あります（合計に入れていません）');
  expect(err).toEqual([]);
});

test('★給料タブ：みんなの給料 ＝ 明細の 紙の 合計の 全員分 ＝ 物差し・帯が 出る★', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.clock.setFixedTime(new Date('2026-09-05T12:00:00+09:00'));
  await page.setViewportSize({ width: 1280, height: 900 });
  await openKyuryo(page, () => ({
    settings: [SET],
    emps: emps,
    labels: [],
    shifts: [],
    edits: [],
    workHours: wh,
    manualDays: md,
    adjustments: adj,
  }));
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const goukei = Array.prototype.map.call(document.querySelectorAll('#slips .kami-mado'), (k) => {
      const m = /合計\s*¥\s*(\d{1,3}(?:,\d{3})*)/.exec(k.textContent);
      return m ? Number(m[1].replace(/,/g, '')) : null;
    });
    const t = (document.getElementById('slips') || document.body).textContent;
    const minna = /みんなの給料 ¥(\d{1,3}(?:,\d{3})*)/.exec(t);
    const obi = document.getElementById('meisaiGaiObi');
    return {
      label: (document.getElementById('monthLabel') || {}).textContent || '',
      goukei,
      minna: minna ? Number(minna[1].replace(/,/g, '')) : null,
      obi: obi ? obi.textContent : null,
      obiMieru: !!obi && getComputedStyle(obi).display !== 'none',
    };
  });
  // eslint-disable-next-line no-console
  console.log('★給料タブ★ ' + JSON.stringify({ r, MEISAI }));
  expect(r.label).toContain('9/1 〜 9/10');
  expect(r.goukei.length, '★明細が 3人分 出ない★').toBe(3);
  const wa = r.goukei.reduce((a, b) => a + b, 0);
  expect(wa, '★明細の 紙の 合計の 和が 物差しと 違う★').toBe(MEISAI[0]);
  expect(r.minna, '★みんなの給料が 明細の 和と 違う★').toBe(MEISAI[0]);
  expect(r.obiMieru, '★明細に 載らない 手当・控除の 帯が 出ない★').toBe(true);
  expect(r.obi).toBe('明細に載らない手当・控除が1件あります（合計に入れていません）');
  expect(err).toEqual([]);
});
