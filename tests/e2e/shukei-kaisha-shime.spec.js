// ============================================================
// ★★月次集計の「◯月」＝会社の 締めの 期間★★ 2026-10-24（司さん「会社の締め日も決めれるようにしとかないかんな」
//   「締め日は給料やなくて会社の締めのことな。給料は給料のとこで設定できるやろが」）
//
//   ★合格★
//   ① 20日締めの 偽の 会社：10月＝9/21〜10/20 の 売上・実費・請求書・電子決済・給料（名前の 日が その 期間の 回）
//      画面の 題・月の 選び・紙に 期間の 日付の 字（9/21 〜 10/20）／今日（10/24）の 月＝11月
//   ② 5日締め × 給料 25日締め：1月に 前の 年の 11/26〜12/25 の 回が 入る（読む 日が 前の 年の 11月まで 下がる）
//   ③ 締め日の 列が 読めない（行は 在るのに 列が 無い）＝末日に 倒さず 止めて 訳を 出す
//   偽の 倉庫は 日付の 絞り（gte/lt/lte）を 本物と 同じに 効かせる（読む 日の 幅の 戻りも 捕まえる）
//
//   ★わざと壊して 赤を 見た（2026-10-24）★
//     直す 前の shukei.html・js（origin/main）⇒ ①〜④ 全部 赤
//     紙の 月の 選びの 今日の 月を 暦の 月（getMonth() + 1）に 戻す ⇒ ① 赤（11 の はずが 10）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CO = '11111111-2222-3333-4444-555555555555';
test.use({ timezoneId: 'Asia/Tokyo' });

const D = require('../../js/payroll-daily.js');
require('../../js/payroll-period.js'); // KaishaKikan（会社の 締め日の 決まり）
const G = require('../../js/getsuji-agg.js');

const EMP = [{ employee_id: 'e1', name: '見本一四', role: '2種', active: true, sort_order: 1 }];
function shift(id, hi, yen) {
  return {
    shift_id: id,
    device_id: 'd1',
    started_at: hi + 'T20:00:00+09:00',
    ended_at: hi + 'T23:00:00+09:00',
    elapsed_sec: 10800,
    fare_total_yen: yen,
    trip_count: 1,
    actual_total_m: 1000,
    total_distance_m: 2000,
  };
}
function souko(o) {
  return {
    dk_shifts: o.shifts,
    dk_shift_edits: o.edits || [],
    dk_device_labels: [{ device_id: 'd1', label: '1号車', sort_order: 1 }],
    dk_employees: EMP,
    dk_work_hours: o.hours || [],
    dk_payroll_settings: o.payroll ? [Object.assign({ company_id: CO }, o.payroll)] : [],
    dk_sales_settings: [
      Object.assign(
        {
          company_id: CO,
          deduct_toll: true,
          deduct_bridge: true,
          deduct_other: false,
          other_label: 'その他',
        },
        o.sales
      ),
    ],
    dk_day_extras: o.denshi || [],
  };
}

// ★偽の 倉庫★ 表の 名前で 行を 返し、日付の 絞り（gte/gt/lte/lt）を 効かせる
function tsukuru(T) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: '見張り用' };
  return (
    moto +
    ';(function(){var S=window.DKSession;var co=' +
    JSON.stringify(co) +
    ';var T=' +
    JSON.stringify(T) +
    ';window.__yonda=[];' +
    'function rows(p){window.__yonda.push(String(p));var na=String(p).split("?")[0];var r=T[na]||[];' +
    'var q=String(p).split("?")[1]||"";q.split("&").forEach(function(kv){var i=kv.indexOf("=");if(i<0)return;' +
    'var col=kv.slice(0,i);var v=decodeURIComponent(kv.slice(i+1));var m=/^(gte|gt|lte|lt)\\.(.*)$/.exec(v);if(!m)return;' +
    'r=r.filter(function(x){if(!(col in x))return true;var a=String(x[col]);var b=m[2];' +
    'return m[1]==="gte"?a>=b:m[1]==="gt"?a>b:m[1]==="lte"?a<=b:a<b;});});return r;}' +
    'S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co,list:[co]};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}
async function hiraku(page, T, ima) {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.clock.setFixedTime(new Date(ima));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(T),
    })
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => /年$/.test(document.getElementById('yearLabel').textContent),
    null,
    {
      timeout: 15000,
    }
  );
  await page.waitForTimeout(900);
  return err;
}
const gyou = (page, id, tsuki) =>
  page.evaluate(
    ([id2, t]) => {
      const tr = [...document.querySelectorAll('#' + id2 + ' tr')].find(
        (x) => x.firstElementChild && x.firstElementChild.textContent.trim() === t
      );
      return tr ? [...tr.children].map((c) => c.textContent.trim()) : null;
    },
    [id, tsuki]
  );
const yen = (v) => Math.round(v).toLocaleString('en-US');

// ── ① 20日締め ──
const T20 = souko({
  shifts: [
    shift('s1', '2026-09-15', 5000), // 9月（8/21〜9/20）
    shift('s2', '2026-09-25', 10000), // 10月（9/21〜10/20）
    shift('s3', '2026-10-05', 20000), // 10月
    shift('s4', '2026-10-25', 40000), // 11月（10/21〜11/20）
  ],
  edits: [{ shift_id: 's2', toll_yen: 500, bridge_yen: 0, other_yen: 0, seikyu_yen: 3000 }],
  hours: [{ work_date: '2026-09-25', employee_id: 'e1', device_id: 'd1', hours: 5 }],
  sales: { kaisha_shime_hi: 20 },
  denshi: [{ pay_date: '2026-09-28', denshi_yen: 1000 }],
});
// ★物差し（給料）★ 同じ 材料を 本物の エンジンで（20日締め・月3回＝9/21〜9/30 の 回）
function kyuryo10() {
  const raw = {
    shifts: T20.dk_shifts,
    edits: T20.dk_shift_edits,
    labels: T20.dk_device_labels,
    employees: EMP,
    workHours: T20.dk_work_hours,
    payrollSettings: null,
    salesSettings: T20.dk_sales_settings[0],
  };
  const yr = G.year(2026, D.buildCtx(raw), [], { hi: 20 });
  return yr.months[9].payTotal;
}

test('★① 20日締め：10月＝9/21〜10/20（売上・実費・請求書・電子決済・給料）★', async ({ page }) => {
  const err = await hiraku(page, T20, '2026-10-24T12:00:00+09:00');
  const kyu = kyuryo10();
  expect(kyu, '物差しの 給料が 0（材料の 作りが 悪い）').toBeGreaterThan(0);

  // 売上の 表（月／売上／経費／未収／現金）
  const m10 = await gyou(page, 'tbody', '10月');
  const m9 = await gyou(page, 'tbody', '9月');
  const m11 = await gyou(page, 'tbody', '11月');
  // eslint-disable-next-line no-console
  console.log('★売上の 表★ ' + JSON.stringify({ m9, m10, m11 }));
  expect(m10, '10月＝9/25（10,000 − 高速 500）＋10/5（20,000）').toEqual([
    '10月',
    '29,500',
    '500',
    '4,000',
    '25,500',
  ]);
  expect(m9[1], '9月＝9/15 だけ').toBe('5,000');
  expect(m11[1], '11月＝10/25').toBe('40,000');

  // 給料の 表
  const k10 = await gyou(page, 'tbody3', '10月');
  const k9 = await gyou(page, 'tbody3', '9月');
  expect(k10[k10.length - 1], '10月の 給料＝9/21〜9/30 の 回').toBe(yen(kyu));
  expect(k9[k9.length - 1], '9月の 給料＝0').toBe('—');

  // 期間の 字・今日の 月（10/24 ⇒ 11月）
  const r = await page.evaluate(() => ({
    note: document.getElementById('kikanNote').textContent,
    noteMieru: getComputedStyle(document.getElementById('kikanNote')).display !== 'none',
    kamiTsuki: document.getElementById('kamiTsuki').value,
    opt10: [...document.querySelectorAll('#kamiTsuki option')][9].textContent,
  }));
  // eslint-disable-next-line no-console
  console.log('★字★ ' + JSON.stringify(r));
  expect(r.noteMieru).toBe(true);
  expect(r.note).toContain('20日');
  expect(r.note).toContain('9/21 〜 10/20');
  expect(r.kamiTsuki, '★今日（10/24）の 月は 11月★').toBe('11');
  expect(r.opt10).toContain('9/21 〜 10/20');

  // 紙（月次集計）＝10月を 選ぶ
  await page.selectOption('#kamiTsuki', '10');
  await page.waitForTimeout(600);
  const kami = await page.evaluate(() => document.getElementById('kamiMado').textContent);
  expect(kami, '紙の 題に 期間の 字').toContain('2026年 10月（9/21 〜 10/20）');
  expect(kami).toContain('29,500');

  // 売上表の 紙（日ごと）＝9/21 から 並ぶ
  await page.evaluate(() => document.querySelector('#kamiSeg [data-shu="uriM"]').click());
  await page.waitForTimeout(600);
  const kami2 = await page.evaluate(() => document.getElementById('kamiMado').textContent);
  expect(kami2).toContain('9/21');
  expect(kami2).toContain('2026年 10月（9/21 〜 10/20）');

  // 細かい 表：月を 10月に・内訳の 題・日ごとの 売上／距離／電子決済
  await page.evaluate(() => {
    document.getElementById('motoHyou').open = true;
    const s = document.getElementById('tsukiSel');
    s.value = '10';
    s.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(300);
  const one = await page.evaluate(() => document.getElementById('oneTtl').textContent);
  expect(one).toBe('2026年 10月（9/21 〜 10/20）の内訳');
  await page.evaluate(() => document.querySelector('[data-uri="day"]').click());
  await page.waitForTimeout(200);
  const uriHi = await page.evaluate(() => document.getElementById('uriBody').textContent);
  expect(uriHi).toContain('9/25');
  expect(uriHi).toContain('10/5');
  expect(uriHi, '10/25 は 11月').not.toContain('10/25');
  await page.evaluate(() => document.querySelector('[data-kyori="day"]').click());
  await page.waitForTimeout(200);
  const kyHi = await page.evaluate(() => document.getElementById('kyoriBody').textContent);
  expect(kyHi).toContain('9/25');
  expect(kyHi).not.toContain('10/25');
  await page.evaluate(() => document.getElementById('dkSegD').click());
  await page.waitForTimeout(200);
  const dk = await page.evaluate(() =>
    [...document.querySelectorAll('#dkBody tr')].map((t) => t.textContent)
  );
  expect(dk[0]).toContain('9/21');
  expect(dk[dk.length - 1]).toContain('10/20');
  expect(dk.find((x) => x.indexOf('9/28') === 0)).toContain('1,000');

  expect(err, 'JSエラー').toEqual([]);
});

test('★② 5日締め × 給料 25日締め：1月に 前の 年の 11/26〜12/25 の 回が 入る★', async ({ page }) => {
  const T = souko({
    shifts: [shift('a1', '2025-11-28', 30000), shift('a2', '2026-01-03', 8000)],
    hours: [{ work_date: '2025-11-28', employee_id: 'e1', device_id: 'd1', hours: 6 }],
    sales: { kaisha_shime_hi: 5 },
    payroll: {
      period_end_mode: 'shime',
      period_shime: { kind: 'tsuki', hi: [25], nazuke: 'shime' },
    },
  });
  const err = await hiraku(page, T, '2026-01-03T12:00:00+09:00');
  const raw = {
    shifts: T.dk_shifts,
    edits: [],
    labels: T.dk_device_labels,
    employees: EMP,
    workHours: T.dk_work_hours,
    payrollSettings: T.dk_payroll_settings[0],
    salesSettings: T.dk_sales_settings[0],
  };
  const yr = G.year(2026, D.buildCtx(raw), [], { hi: 5 });
  const kyu = yr.months[0].payTotal;
  expect(kyu, '物差しの 給料が 0').toBeGreaterThan(0);
  const y = await page.evaluate(() => ({
    nen: document.getElementById('yearLabel').textContent,
    err: document.getElementById('err').textContent,
    yonda: (window.__yonda || []).filter((p) => p.indexOf('dk_shifts') === 0),
  }));
  // eslint-disable-next-line no-console
  console.log('★5日締め★ ' + JSON.stringify(y).slice(0, 400));
  expect(y.nen).toBe('2026年');
  expect(y.err, '止まった').toBe('');
  expect(y.yonda[0], '読む 日が 前の 年の 11月まで 下がる').toContain(
    encodeURIComponent('2025-11-01')
  );
  const k1 = await gyou(page, 'tbody3', '1月');
  expect(k1[k1.length - 1], '1月の 給料＝前の 年の 11/26〜12/25 の 回').toBe(yen(kyu));
  const u1 = await gyou(page, 'tbody', '1月');
  expect(u1[1], '1月の 売上＝12/6〜1/5＝1/3 だけ').toBe('8,000');
  expect(err).toEqual([]);
});

test('★③ 締め日の 列が 読めない ⇒ 末日に 倒さず 止める★', async ({ page }) => {
  const T = souko({ shifts: [shift('b1', '2026-10-05', 20000)], sales: {} });
  delete T.dk_sales_settings[0].kaisha_shime_hi; // 行は 在るのに 列が 無い（倉庫に 列が まだ 無い・読み足し忘れ）
  const err = await hiraku(page, T, '2026-10-24T12:00:00+09:00');
  const r = await page.evaluate(() => ({
    err: document.getElementById('err').textContent,
    tbody: document.getElementById('tbody').textContent,
    kami: document.getElementById('kamiMsg').textContent,
    mado: document.getElementById('kamiMado').textContent,
  }));
  // eslint-disable-next-line no-console
  console.log('★読めない★ ' + JSON.stringify(r));
  expect(r.err).toContain('締め日');
  expect(r.tbody, '売上の 表を 出さない').toBe('');
  expect(r.kami).toContain('締め日');
  expect(r.mado).toBe('');
  expect(err).toEqual([]);
});

test('★④ 末日の 会社（列が null）は 暦の 月の まま★', async ({ page }) => {
  const T = souko({
    shifts: T20.dk_shifts,
    edits: T20.dk_shift_edits,
    sales: { kaisha_shime_hi: null },
  });
  await hiraku(page, T, '2026-10-24T12:00:00+09:00');
  const m10 = await gyou(page, 'tbody', '10月');
  expect(m10[1], '10月＝10/5＋10/25').toBe('60,000');
  const r = await page.evaluate(() => ({
    note: getComputedStyle(document.getElementById('kikanNote')).display,
    kamiTsuki: document.getElementById('kamiTsuki').value,
    opt10: [...document.querySelectorAll('#kamiTsuki option')][9].textContent,
  }));
  expect(r.note).toBe('none');
  expect(r.kamiTsuki).toBe('10');
  expect(r.opt10).toBe('10月');
});
