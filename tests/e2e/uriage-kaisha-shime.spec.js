// ============================================================
// ★★売上表の「月」も 会社の 締めの 期間★★ 2026-10-24（司さん「会社の締め日」・月次集計と 同じ 期間）
//   ① 20日締め：開いた 日（10/24）の 月＝11月・前へ 送ると 10月＝9/21〜10/20 の 業務だけ（題と 紙に 期間の 字）
//   ② 末日（列が null）：今まで 通りの 暦の 月
//   ③ 締め日の 列が 読めない ⇒ 末日に 倒さず 売上と 紙を 止める
//   偽の 倉庫は 日付の 絞り（gte/lt）を 効かせる（読む 幅が 前の 月の 頭まで 下がったかも 縛る）
//   ★わざと壊して 赤を 見た（2026-10-24）★ 直す 前の uriage.html・js（origin/main）⇒ ① ③ 赤／② 緑（末日は 前と 同じ）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CO = '11111111-2222-3333-4444-555555555555';
test.use({ timezoneId: 'Asia/Tokyo' });

function shift(id, hi, yen) {
  return {
    shift_id: id,
    device_id: 'd1',
    started_at: hi + 'T20:00:00+09:00',
    total_distance_m: 2000,
    actual_total_m: 1000,
    fare_total_yen: yen,
    trip_count: 1,
  };
}
const SHIFTS = [
  shift('s1', '2026-09-15', 5000),
  shift('s2', '2026-09-25', 10000),
  shift('s3', '2026-10-05', 20000),
  shift('s4', '2026-10-25', 40000),
];
function tsukuru(sales) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: '見張り用' };
  const T = {
    dk_shifts: SHIFTS,
    dk_shift_edits: [{ shift_id: 's2', toll_yen: 500, bridge_yen: 0, other_yen: 0 }],
    dk_device_labels: [{ device_id: 'd1', label: '1号車', sort_order: 1 }],
    dk_sales_settings: sales,
    dk_expense_kinds: [],
    dk_uriage_rireki: [],
    dk_manual_days: [],
  };
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
    'r=r.filter(function(x){if(!(col in x))return true;var a=new Date(String(x[col])).getTime();var b=new Date(m[2]).getTime();' +
    'return m[1]==="gte"?a>=b:m[1]==="gt"?a>b:m[1]==="lte"?a<=b:a<b;});});return r;}' +
    'S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co,list:[co]};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}
async function hiraku(page, sales) {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.clock.setFixedTime(new Date('2026-10-24T12:00:00+09:00'));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(sales),
    })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/uriage.html', { waitUntil: 'domcontentloaded' });
  await yomiOwari(page);
  return err;
}
async function yomiOwari(page) {
  await page.waitForFunction(
    () =>
      document.querySelector('#kamiMado .kami-mise-waku') ||
      /出せません/.test((document.getElementById('kamiMsg') || {}).textContent || ''),
    null,
    { timeout: 15000 }
  );
  await page.waitForTimeout(300);
}
const miru = (page) =>
  page.evaluate(() => ({
    dai: document.getElementById('monthLabel').textContent,
    kami: document.getElementById('kamiMado').textContent,
    msg: document.getElementById('kamiMsg').textContent,
    err: document.getElementById('err').textContent,
  }));

const S20 = [
  {
    company_id: CO,
    deduct_toll: true,
    deduct_bridge: true,
    deduct_other: false,
    other_label: 'その他',
    kaisha_shime_hi: 20,
  },
];

test('★① 20日締め：10/24 に 開くと 11月・10月＝9/21〜10/20★', async ({ page }) => {
  const err = await hiraku(page, S20);
  const a = await miru(page);
  // eslint-disable-next-line no-console
  console.log('★11月★ ' + JSON.stringify(a).slice(0, 300));
  expect(a.dai).toBe('2026年11月（10/21 〜 11/20）');
  expect(a.kami).toContain('40,000');
  await page.click('#prevM');
  await yomiOwari(page);
  const b = await miru(page);
  // eslint-disable-next-line no-console
  console.log('★10月★ ' + JSON.stringify(b).slice(0, 400));
  expect(b.dai).toBe('2026年10月（9/21 〜 10/20）');
  expect(b.kami, '10月の 売上＝9,500＋20,000').toContain('29,500');
  expect(b.kami).toContain('2026年 10月（9/21 〜 10/20）');
  expect(b.kami).toContain('9/21');
  expect(b.kami, '9/15 は 9月').not.toContain('5,000');
  expect(b.kami, '10/25 は 11月').not.toContain('40,000');
  const yonda = await page.evaluate(() =>
    (window.__yonda || []).filter((p) => p.indexOf('dk_shifts') === 0).pop()
  );
  expect(yonda, '読む 幅は 前の 月の 頭から').toContain(
    encodeURIComponent(new Date('2026-09-01T00:00:00+09:00').toISOString())
  );
  expect(err).toEqual([]);
});

test('★② 末日（null）：暦の 月の まま★', async ({ page }) => {
  await hiraku(page, [Object.assign({}, S20[0], { kaisha_shime_hi: null })]);
  const a = await miru(page);
  expect(a.dai).toBe('2026年10月');
  expect(a.kami, '10月＝10/5＋10/25').toContain('60,000');
});

test('★③ 締め日の 列が 読めない ⇒ 止める★', async ({ page }) => {
  const s = Object.assign({}, S20[0]);
  delete s.kaisha_shime_hi;
  await hiraku(page, [s]);
  const a = await miru(page);
  // eslint-disable-next-line no-console
  console.log('★読めない★ ' + JSON.stringify(a).slice(0, 300));
  expect(a.err).toContain('締め日');
  expect(a.msg).toContain('締め日');
  expect(a.kami).toBe('');
});
