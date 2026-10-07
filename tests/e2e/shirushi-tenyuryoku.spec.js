// ============================================================
// ★★見張り：使わない 印の 業務は「その日 走った」に 数えない★★ 2026-10-07
//
//   司さん「前からある2つもやれ」の 残り（対立役 10-07 ⑤⑥）
//   ★材料★ 1/10 に 1号車の 印の 業務（0円・電子決済 500 が 打ってある）＋ 同じ日・同じ車の 手入力 7,000
//   ★物差し★
//     売上表（uriage）・月次集計の 売上表（shukei）は 手入力の 7,000 を 数える（印の 業務に 隠されない）
//     （印の 業務に 打った 電子決済・請求書の 扱いは お金の 出方＝司さんに 訊く。材料の 500 は 残すが 見ない）
//
//   ★★わざと壊して 赤に なるのを 見た（2026-10-07 実測）★★
//     uriage の「走った」判定から excluded を 外す ⇒ ★赤★（7,000 が 出ない）
//     shukei の kyoriMoto の「走った」判定から excluded を 外す ⇒ ★赤★（距離 9.0km が 出ない）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CO = '11111111-2222-3333-4444-555555555555';
test.use({ timezoneId: 'Asia/Tokyo' });

const T = {
  dk_shifts: [
    {
      shift_id: 'sx',
      device_id: 'd1',
      started_at: '2026-01-10T20:00:00+09:00',
      ended_at: '2026-01-10T21:00:00+09:00',
      elapsed_sec: 3600,
      fare_total_yen: 0,
      trip_count: 0,
      actual_total_m: 0,
      total_distance_m: 0,
      excluded: true,
    },
  ],
  dk_shift_edits: [{ shift_id: 'sx', toll_yen: 0, bridge_yen: 0, other_yen: 0, denshi_yen: 500 }],
  dk_manual_days: [
    {
      company_id: CO,
      work_date: '2026-01-10',
      device_id: 'd1',
      sales_yen: 7000,
      hours: 0,
      trip_count: 2,
      total_distance_m: 9000,
    },
  ],
  dk_device_labels: [{ device_id: 'd1', label: '1号車', sort_order: 1 }],
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
async function hiraku(page, url) {
  await page.clock.setFixedTime(new Date('2026-01-20T12:00:00+09:00'));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(),
    })
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}

test('★売上表（uriage）：印の 業務と 同じ日・同じ車の 手入力 7,000 を 数える★', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await hiraku(page, '/uriage.html');
  const kami = page.locator('#kamiMado .kami-mise-waku');
  await expect(kami.first(), '★紙が 出ない★').toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(500);
  const ji = ((await kami.first().textContent()) || '').replace(/\s+/g, ' ');
  expect(ji, '★手入力の 7,000 が 印の 業務に 隠された★').toContain('7,000');
  expect(err).toEqual([]);
});

test('★月次集計（shukei）：手入力 7,000 と 距離 9.0km を 数える（印の 業務に 隠されない）★', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await hiraku(page, '/shukei.html');
  await page.waitForFunction(
    () => document.getElementById('yearLabel').textContent === '2026年',
    null,
    {
      timeout: 15000,
    }
  );
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector('[data-uri="year"]').click());
  await page.evaluate(() => document.querySelector('[data-kyori="year"]').click());
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({
    uri: (document.getElementById('uriBody') || {}).textContent || '',
    ky: (document.getElementById('kyoriBody') || {}).textContent || '',
  }));
  // eslint-disable-next-line no-console
  console.log('★月次★ ' + JSON.stringify(r));
  expect(r.uri, '★手入力の 7,000 が 隠された★').toContain('7,000');
  expect(r.ky, '★手入力の 距離 9.0km が 隠された★').toContain('9.0');
  // ★印の 業務に 打った 電子決済・請求書を 月次で どう 扱うかは 司さんに 訊いている（10-07）＝ここでは 見ない★
  expect(err).toEqual([]);
});
