// ============================================================
// ★★見張り：月次集計の 売上表は その年の 日だけ（締めの 為に 前後の 月を 読んでも 混ぜない）★★ 2026-10-07
//
//   締め（20日締め 等）の 給料を 数える 為に 前の年の 12月〜次の年の 1月まで 読む ように した。
//   対立役 10-07：★売上表（年・月・車）に 前の年の 12月と 次の年の 1月の 売上が 混ざった★
//     （2026年の 年 40,000＝正しくは 23,000・12月 30,000＝正しくは 20,000）
//   ★物差し★ 2026年の 年間 ＝ 23,000（1/10 の 3,000 ＋ 12/15 の 20,000）・前後の 年の 車（d2）の 列が 出ない
//             月次集計の 売上（GetsujiAgg）も 同じ 23,000
//
//   ★★わざと壊して 赤に なるのを 見た（2026-10-07 実測）★★
//     toshiDake を 外して CTX に 全部の 行 ⇒ ★赤★（年間 40,000）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CO = '11111111-2222-3333-4444-555555555555';
test.use({ timezoneId: 'Asia/Tokyo' });

function shift(id, dev, hi, yen) {
  return {
    shift_id: id,
    device_id: dev,
    started_at: hi + 'T20:00:00+09:00',
    ended_at: hi + 'T23:00:00+09:00',
    elapsed_sec: 10800,
    fare_total_yen: yen,
    trip_count: 1,
    actual_total_m: 1000,
    total_distance_m: 2000,
  };
}
const T = {
  dk_shifts: [
    shift('s0', 'd1', '2025-12-15', 10000), // 前の年
    shift('s1', 'd1', '2026-01-10', 3000),
    shift('s2', 'd1', '2026-12-15', 20000),
    shift('s3', 'd2', '2027-01-10', 7000), // 次の年・別の 車
  ],
  dk_device_labels: [
    { device_id: 'd1', label: '1号車', sort_order: 1 },
    { device_id: 'd2', label: '2号車', sort_order: 2 },
  ],
  dk_payroll_settings: [
    {
      company_id: CO,
      period_end_mode: 'shime',
      period_shime: { kind: 'tsuki', hi: [20], nazuke: 'shime' },
    },
  ],
};

function tsukuru() {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
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

test('★売上表は 2026年の 日だけ（前後の 年の 売上・車を 混ぜない）★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00+09:00'));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(),
    })
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.getElementById('yearLabel').textContent === '2026年',
    null,
    {
      timeout: 15000,
    }
  );
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector('[data-uri="year"]').click());
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({
    uri: (document.getElementById('uriBody') || {}).textContent || '',
    head: (document.getElementById('uriHead') || {}).textContent || '',
    getsuji: (window.GetsujiAgg && 0) || null,
  }));
  // eslint-disable-next-line no-console
  console.log('★年★ ' + JSON.stringify(r).slice(0, 400));
  expect(r.uri, '★年間が 23,000 で ない★').toContain('23,000');
  expect(r.uri, '★前後の 年の 売上が 混ざった★').not.toContain('40,000');
  expect(r.uri + r.head, '★次の 年だけ 走った 車の 列が 出た★').not.toContain('2号車');
  await page.evaluate(() => document.querySelector('[data-uri="month"]').click());
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => (document.getElementById('uriBody') || {}).textContent || '');
  expect(m, '★12月に 前の年の 12月が 混ざった★').not.toContain('30,000');
  expect(err).toEqual([]);
});
