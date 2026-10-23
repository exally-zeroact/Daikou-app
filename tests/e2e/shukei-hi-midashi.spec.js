// ============================================================
// ★★見張り：日ごとの 表の 左の 見出しが 折れない・日の 升目が はみ出さない★★ 2026-10-23
//
//   司さん（iPhone の 写真）電子決済で 受け取った 分の 日ごとの 表で 見出し「2026年 10月の 日」が
//   3段に 折れて 見切れ、日の 升目「10/27(火)」が 左の 列から はみ出して いた。
//   ★同じ 形★ 売上・距離の 日ごとの 表も「10月の 日」が 2段に 折れていた（44px の 列）。
//   ★物差し★ 390px（webkit も）で 3つの 日ごとの 表とも
//     ①左の 見出しが 1行 ②日の 升目で 字が はみ出さない ③見出しに 月が 出ている
//   ★月・年の 表は 今まで通り 細い 列（shukei-tsuki-no-hashira.spec.js が 見る）
//   ★わざと壊して 赤に なるのを 見た★ 直す 前の 版で 赤（見出し 2〜3段・電子決済の 日の 升目 はみ出し）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CO = '11111111-2222-3333-4444-555555555555';
const SHIFTS = [];
for (const d of [1, 17, 27, 31]) {
  const dd = String(d).padStart(2, '0');
  SHIFTS.push({
    shift_id: 's' + d,
    device_id: 'd1',
    started_at: '2026-10-' + dd + 'T20:00:00+09:00',
    ended_at: '2026-10-' + dd + 'T23:00:00+09:00',
    elapsed_sec: 10800,
    fare_total_yen: 1298210,
    trip_count: 18,
    actual_total_m: 8712700,
    total_distance_m: 15881800,
  });
}
const T = {
  dk_shifts: SHIFTS,
  dk_device_labels: [{ device_id: 'd1', label: '4987', sort_order: 1 }],
  dk_day_extras: [{ pay_date: '2026-10-27', denshi_yen: 123000 }],
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
    ';function rows(p){var na=String(p).split("?")[0];return T[na]||[];}' +
    'S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

function hakaru(page, thead, tbody) {
  return page.evaluate(
    ([th, tb]) => {
      const h = document.getElementById(th);
      const b = document.getElementById(tb);
      const t0 = h && h.querySelector('th');
      if (!t0 || !b) return null;
      const r = document.createRange();
      r.selectNodeContents(t0);
      const gyou = new Set(Array.from(r.getClientRects()).map((x) => Math.round(x.top))).size;
      let kire = 0;
      const kireta = [];
      let kazu = 0;
      b.querySelectorAll('tr').forEach((tr) => {
        if (tr.children.length < 2) return;
        kazu++;
        const td = tr.children[0];
        if (td.scrollWidth > td.clientWidth + 1) {
          kire++;
          if (kireta.length < 3) kireta.push(td.textContent.trim());
        }
      });
      return { ji: t0.textContent.trim(), gyou, kire, kireta, kazu };
    },
    [thead, tbody]
  );
}

test('★390px：日ごとの 表（売上・距離・電子決済）の 見出しが 1行・日の 升目が はみ出さない★', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(),
    })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#motoHyou > summary').click({ timeout: 15000 });
  await page.locator('#kyoriTbl').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1000);
  // 10月を 選ぶ（月ごとの 表の 行を 押す＝shukei-tsuki-no-hashira と 同じ 道）
  await page.locator('#segUri').click();
  await page.waitForTimeout(200);
  await page.locator('#tbody [data-m="10"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-uri="day"]').click();
  await page.locator('[data-kyori="day"]').click();
  await page.locator('#dkSegD').click();
  await page.waitForTimeout(500);

  for (const [th, tb, na] of [
    ['uriHead', 'uriBody', '売上・日ごと'],
    ['kyoriHead', 'kyoriBody', '距離・日ごと'],
    ['dkHead', 'dkBody', '電子決済・日ごと'],
  ]) {
    const m = await hakaru(page, th, tb);
    expect(m, '★' + na + ' の 表が 見つからない★').not.toBeNull();
    expect(m.kazu, '★' + na + '：日の 行が 出ていない（測れていない）★').toBeGreaterThan(1);
    expect(m.ji, '★' + na + '：見出しに 月が 出ていない★').toContain('10月');
    expect(m.gyou, '★' + na + '：見出し「' + m.ji + '」が ' + m.gyou + '段に 折れている★').toBe(1);
    expect(
      m.kire,
      '★' + na + '：日の 升目が はみ出している ' + JSON.stringify(m.kireta) + '★'
    ).toBe(0);
  }
  expect(err, '★画面が 落ちた★').toEqual([]);
});
