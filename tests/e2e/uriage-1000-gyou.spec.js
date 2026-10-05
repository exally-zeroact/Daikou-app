// ============================================================
// ★★見張り：売上表は 1か月に 1000本 より 多く 走っても 全部 数える★★ 2026-10-06
//
//   司さん「気にかけてどうするんど解決策は」
//   売上表は 走った 記録（dk_shifts）を ★DKSession.rest で 直に★ limit=2000 と 頼んで 読んでいた
//   ＝倉庫が 1回 1000行で 切る 線（テスト線 max_rows=1000）では ★黙って 1000本で 切れた★（対立役 10-06）。
//   ⇒ 1000行 ずつ 全部 読む。
//
//   ★作り物の 倉庫も 本物と 同じく 1回 1000行で 切る★（limit と offset を 読む）
//   1,500本 × 100円 ＝ 150,000円（1000本で 切れたら 100,000円）
//
//   ★★わざと壊して 赤に なるのを 見た（2026-10-06 実測）★★
//     uriage.html の 1000行 ずつ 読む 所を 外して 1回だけ 読む ⇒ ★赤★（100,000 が 出る）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CO = '11111111-2222-3333-4444-555555555555';
test.use({ timezoneId: 'Asia/Tokyo' });

const N = 1500;
const SHIFTS = Array.from({ length: N }, (_, i) => ({
  shift_id: 's' + String(i).padStart(5, '0'),
  device_id: 'd1',
  started_at: '2026-01-' + String(1 + (i % 28)).padStart(2, '0') + 'T20:00:00+09:00',
  fare_total_yen: 100,
  trip_count: 1,
  actual_total_m: 1000,
  total_distance_m: 2000,
}));

function tsukuru(dir) {
  const moto = fs.readFileSync(path.join(dir, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: '見張り用' };
  const T = {
    dk_shifts: SHIFTS,
    dk_device_labels: [{ device_id: 'd1', label: '4987', sort_order: 1 }],
  };
  return (
    moto +
    ';(function(){var S=window.DKSession;var co=' +
    JSON.stringify(co) +
    ';var T=' +
    JSON.stringify(T) +
    ';window.__yonda=0;' +
    // ★本物と 同じく 1回 1000行で 切る★
    'function rows(p){p=String(p);var na=p.split("?")[0];var a=T[na]||[];' +
    ' var lm=/[?&]limit=(\\d+)/.exec(p),of=/[?&]offset=(\\d+)/.exec(p);' +
    ' var l=Math.min(lm?Number(lm[1]):1000,1000),o=of?Number(of[1]):0;' +
    ' if(na==="dk_shifts")window.__yonda++;return a.slice(o,o+l);}' +
    'S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co,list:[co]};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

test('★1か月 1,500本 走っても 売上表は 全部 数える（1000本で 切れない）★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.clock.setFixedTime(new Date('2026-01-20T12:00:00+09:00'));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(__dirname),
    })
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/uriage.html', { waitUntil: 'domcontentloaded' });
  const kami = page.locator('#kamiMado .kami-mise-waku');
  await expect(kami.first(), '★紙が 出ない★').toBeVisible({ timeout: 15000 });
  const ji = ((await kami.first().textContent()) || '').replace(/\s+/g, ' ');
  const yonda = await page.evaluate(() => window.__yonda);
  // eslint-disable-next-line no-console
  console.log('★読んだ 回数★ ' + yonda);
  expect(ji, '★1,500本 全部の 売上（150,000）が 出ていない★').toContain('150,000');
  expect(ji, '★1000本で 切れている（100,000）★').not.toContain('100,000');
  expect(yonda, '★1000行 ずつ 分けて 読んでいない★').toBeGreaterThanOrEqual(2);
  expect(err, '★画面が 落ちた★').toEqual([]);
});
