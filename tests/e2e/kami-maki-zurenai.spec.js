// ============================================================
// ★★見張り：幅が 変わらない resize で 紙を 作り直さない・巻いた 位置が 飛ばない★★ 2026-10-23
//
//   司さん（iPhone の 写真）「下まで 巻くと 下の 帯が 画面の 途中に 浮く」「上に 大きな 空白」
//   ★測った 元（playwright webkit・iPhone 13 の 大きさ 390×664）★
//     月次集計：下まで 巻いて（scrollY 394）幅の 変わらない resize を 1回 起こす ⇒ 紙を 1回 作り直し ⇒ ★scrollY 0★
//     売上表 161 ⇒ 0／給料（事務所の 明細）1147 ⇒ 469
//     訳：①resize の 見張りが「前の 幅＝0」から 始まるので、最初の resize（iPhone は 帯の 伸び縮み・板の 開け閉めでも 起きる）で
//          幅が 同じでも 紙を 全部 作り直す
//         ②作り直しで 箱を 空にした 後に 幅を 読む（clientWidth）＝★紙の 無い 短い ページ★で 形を 決め直し、
//          巻いた 位置が その 短い ページの 底へ 詰められる（紙を 戻しても 位置は 戻らない）
//   ★測って 違った 見立て★ 紙の <style> の 漏れ＝どの 画面も 同じ 決め（* の 余白 0）を 先に 持つので 変わる 要素 0（762個中）／
//     横に 広い ページ＝scrollWidth 390＝幅 390・visualViewport.scale 1（5枚とも）
//   ★直し★ 幅が 本当に 変わった 時だけ 作り直す（描いた 時の 幅と 比べる）／作り直す 時は 箱の 高さを 保ったまま 入れ替える
//   ★わざと壊して 赤に なるのを 見た★ 直す 前の 版で 3本とも 赤（上の 数）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { openKyuryo } = require('./kyuryo-harness');

const CO = '11111111-2222-3333-4444-555555555555';
const SHIFTS = [];
for (let d = 1; d <= 28; d++) {
  const dd = String(d).padStart(2, '0');
  SHIFTS.push({
    shift_id: 's' + d,
    device_id: 'd' + (d % 3),
    started_at: '2026-10-' + dd + 'T20:00:00+09:00',
    ended_at: '2026-10-' + dd + 'T23:00:00+09:00',
    elapsed_sec: 10800,
    fare_total_yen: 20000 + d * 100,
    trip_count: 5,
    actual_total_m: 30000,
    total_distance_m: 50000,
  });
}
const T = {
  dk_shifts: SHIFTS,
  dk_shift_edits: [],
  dk_device_labels: [
    { device_id: 'd0', label: '4987', sort_order: 1 },
    { device_id: 'd1', label: '1466', sort_order: 2 },
    { device_id: 'd2', label: '1173', sort_order: 3 },
  ],
  dk_day_extras: [{ pay_date: '2026-10-05', denshi_yen: 3000 }],
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

// 下まで 巻いて、幅の 変わらない resize を 起こし、巻いた 位置と 紙の 作り直しを 数える
async function sokoDeResize(page, waku) {
  return page.evaluate(
    (sel) =>
      new Promise((ok) => {
        const mae = document.querySelector(sel);
        window.scrollTo(0, 1e6);
        setTimeout(() => {
          const y0 = window.scrollY;
          window.dispatchEvent(new Event('resize'));
          setTimeout(() => {
            ok({
              y0: y0,
              y1: window.scrollY,
              onaji: document.querySelector(sel) === mae, // 作り直すと 別の 枠に なる
            });
          }, 800);
        }, 400);
      }),
    waku
  );
}

for (const pg of ['shukei', 'uriage']) {
  test(`★${pg}：幅の 変わらない resize で 紙を 作り直さず、巻いた 位置が 飛ばない★`, async ({
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
    await page.setViewportSize({ width: 390, height: 664 });
    await page.goto('/' + pg + '.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#kamiMado .kami-mise-waku').first()).toBeVisible({
      timeout: 15000,
    });
    await page.waitForTimeout(500);
    const r = await sokoDeResize(page, '#kamiMado .kami-mise-waku');
    expect(r.y0, '★下まで 巻けていない（測れていない）★').toBeGreaterThan(50);
    expect(r.onaji, '★幅が 同じなのに 紙を 作り直した★').toBe(true);
    expect(Math.abs(r.y1 - r.y0), '★巻いた 位置が 飛んだ★').toBeLessThanOrEqual(1);

    // ★幅が 本当に 変わった 時は 作り直す★（横→縦で 紙の 右が 切れない＝前からの 決まり）・位置も 上へ 飛ばさない
    await page.evaluate(() => window.scrollTo(0, 1e6));
    await page.waitForTimeout(300);
    const mae = await page.evaluate(() => ({
      el: !!(window.__mae = document.querySelector('#kamiMado .kami-mise-waku')),
      y: window.scrollY,
    }));
    await page.setViewportSize({ width: 375, height: 664 });
    await page.waitForTimeout(800);
    const ato = await page.evaluate(() => ({
      kawatta: document.querySelector('#kamiMado .kami-mise-waku') !== window.__mae,
      y: window.scrollY,
      // 描き直した 後に 巻ける 一番 下（紙が 細く なると ページが 縮む＝本番は テスト線の 帯が 無い 分 さらに 短い）
      soko: document.documentElement.scrollHeight - window.innerHeight,
      migi: (function () {
        const w = document.querySelector('#kamiMado .kami-mise-waku');
        return Math.round(
          w.firstElementChild.getBoundingClientRect().right - w.getBoundingClientRect().right
        );
      })(),
    }));
    expect(mae.el).toBe(true);
    expect(ato.kawatta, '★幅が 変わったのに 紙を 作り直さない★').toBe(true);
    expect(ato.migi, '★幅を 変えたら 紙の 右が 切れた★').toBeLessThanOrEqual(1);
    // ★上へ 飛ばない＝元の 位置か、縮んだ ページの 一番 下に 居る★ 2026-10-24
    //   （前は「50 より 大きい」＝本番は 帯が 無く 縮んだ 底が 47 で 赤・飛んだ 訳では ない）
    expect(ato.soko, '★描き直した 後も 巻ける 高さが 在る★').toBeGreaterThan(20);
    expect(ato.y, '★幅を 変えて 描き直したら 一番 上へ 飛んだ★').toBeGreaterThanOrEqual(
      Math.min(mae.y, ato.soko) - 2
    );
    expect(err, '★画面が 落ちた★').toEqual([]);
  });
}

test('★給料（事務所の 明細）：幅の 変わらない resize で 紙を 作り直さず、巻いた 位置が 飛ばない★', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.setViewportSize({ width: 390, height: 664 });
  await openKyuryo(page);
  await expect(page.locator('#slips .hn-kami-waku').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(800);
  const r = await sokoDeResize(page, '#slips .hn-kami-waku');
  expect(r.y0, '★下まで 巻けていない（測れていない）★').toBeGreaterThan(50);
  expect(r.onaji, '★幅が 同じなのに 紙を 作り直した★').toBe(true);
  expect(Math.abs(r.y1 - r.y0), '★巻いた 位置が 飛んだ★').toBeLessThanOrEqual(1);
  // 幅が 変わったら 作り直す（前からの 決まり）
  await page.evaluate(() => (window.__mae = document.querySelector('#slips .hn-kami-waku')));
  await page.setViewportSize({ width: 375, height: 664 });
  await page.waitForTimeout(800);
  expect(
    await page.evaluate(() => document.querySelector('#slips .hn-kami-waku') !== window.__mae),
    '★幅が 変わったのに 紙を 作り直さない★'
  ).toBe(true);
  expect(err, '★画面が 落ちた★').toEqual([]);
});
