// ============================================================
// ★★売上表：事務所が 直した 回数・距離（dk_shift_edits の *_naoshi）で 出す★★ 2026-10-25
//   司さん「全部の車に自動反映できるもので（修正できるように）つけろよ」（入力の 画面で メーターの 車も 直せる）
//   ★車ごとの 行（UriageAgg.byDevice）も 1回ごとの 行（uriage.html shiftLine）も UriageAgg.kazuOf の 1か所★
//   わざと壊す：uriage.html shiftLine の kazuOf に 直しを 渡さない（kazuOf(s, null)）⇒ ★赤★（1回の 行が 12件・直した の 字が 無い）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CO = '11111111-2222-3333-4444-555555555555';
test.use({ timezoneId: 'Asia/Tokyo' });

const SHIFTS = [
  {
    shift_id: 's1',
    device_id: 'd1',
    started_at: '2026-01-05T20:00:00+09:00',
    fare_total_yen: 40000,
    trip_count: 12,
    actual_total_m: 80000,
    total_distance_m: 150000,
  },
];
// 回数 12→15・実車 80km→81.5km（総走行は メーターの まま）
const EDITS = [{ shift_id: 's1', trip_count_naoshi: 15, actual_total_m_naoshi: 81500 }];
const LABELS = [{ device_id: 'd1', label: '4987', sort_order: 1 }];

function tsukuru() {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: '見張り用' };
  const hyou = {
    dk_shifts: SHIFTS,
    dk_shift_edits: EDITS,
    dk_device_labels: LABELS,
    dk_sales_settings: [{ company_id: CO, kaisha_shime_hi: null }],
  };
  return (
    moto +
    ';(function(){var S=window.DKSession;var co=' +
    JSON.stringify(co) +
    ';var T=' +
    JSON.stringify(hyou) +
    ';' +
    'function rows(p){var na=String(p).split("?")[0];return T[na]||[];}' +
    'S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

test('★売上表：車ごとの 行と 1回ごとの 行が 直した 回数・実車距離で 出る★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.clock.setFixedTime(new Date('2026-01-20T12:00:00+09:00'));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(),
    })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/uriage.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#motoHyou > summary').click({ timeout: 15000 });
  // 車の 名前は 入力欄の 値（字では 探せない）＝名前の 欄を 持つ 行
  const gyou = page
    .locator('#motoHyou .row')
    .filter({ has: page.locator('input.carname[data-dev="d1"]') })
    .first();
  await expect(gyou.locator('.rsub'), '★車ごとの 行が 直した 数で ない★').toContainText(
    '15件　実車 81.5 km　総走行 150.0 km'
  );
  await gyou.locator('.rmore').click();
  const sub = gyou.locator('.rdetail .dsub').first();
  await expect(sub, '★1回ごとの 行が 直した 数で ない★').toContainText('15件　実車 81.5 km');
  await expect(sub).toContainText('（直した）');
  expect(err, '★画面が 落ちた★').toEqual([]);
});
