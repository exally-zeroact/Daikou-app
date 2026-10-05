// ============================================================
// ★★見張り：売上表＝PDF と 同じ 紙を そのまま 見せる★★ 2026-10-05
//
//   司さん「PDFつくっとんやけんそれを見せろやぼけ」「何をくどくど訳わからんこと見せとんど」
//   ★前★ 罫線の 表＋説明＋札の 一覧。PDF は「回数・距離」1枚を 押すと 出るだけ。
//   ★今★ 「売上」「回数・距離」を 選ぶと ★その 紙が 画面に 出る★。押すと PDF。
//         細かい 表と 実費を 直す 欄は 畳む（消していない：入力の 画面が「売上表で 1回ずつ 直して」と 案内）
//
//   ★押す物の一覧（先に書く）★ 1. 売上表を 開く 2. 紙の 種類 3. 紙を 押す 4. 畳んだ 所を 開く
//
//   ★★わざと壊して 赤に なるのを 見た（2026-10-05 実測）★★
//     render() の kamiMiseru() を 外す ⇒ ★赤★「開いても 紙が 出ない」
//     紙の 部品（js/kami-*.js）を 本体の 後ろで 読む（前の 置き場）⇒ ★赤★（読み込みに 失敗 と 出て 紙 0枚）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CO = '11111111-2222-3333-4444-555555555555';
// ★時計を 1月20日に 止める★（今日が 何月かを 持ち込まない）＋ 時間帯も 日本に
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
  {
    shift_id: 's2',
    device_id: 'd2',
    started_at: '2026-01-06T20:00:00+09:00',
    fare_total_yen: 25000,
    trip_count: 8,
    actual_total_m: 50000,
    total_distance_m: 90000,
  },
];
// ★高速代 3,000（既定で 引く）＋ 会社が 足した 実費 500（足した 物は いつも 引く）★
const EDITS = [
  { shift_id: 's1', toll_yen: 3000, bridge_yen: 0, other_yen: 0 },
  { shift_id: 's2', toll_yen: 0, bridge_yen: 0, other_yen: 0, expenses: { kmx1: 500 } },
];
const LABELS = [
  { device_id: 'd1', label: '4987', sort_order: 1 },
  { device_id: 'd2', label: '1466', sort_order: 2 },
];
// ★手で 足した 答え★ 売上 ＝ (40000 − 3000) + (25000 − 500) ＝ 61,500／実費 3,500
const KOTAE = { uriage: 61500, jippi: 3500 };

function tsukuru(dir) {
  const moto = fs.readFileSync(path.join(dir, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: '見張り用' };
  const hyou = { dk_shifts: SHIFTS, dk_shift_edits: EDITS, dk_device_labels: LABELS };
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

test('★売上表＝紙を そのまま 見せる・はみ出さない・押すと PDF・表と 実費の 欄は 畳む★', async ({
  page,
}) => {
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/uriage.html', { waitUntil: 'domcontentloaded' });
  const kami = page.locator('#kamiMado .kami-mise-waku');
  await expect(kami.first(), '★開いても 紙が 出ない★').toBeVisible({ timeout: 15000 });
  await expect(page.locator('#motoHyou'), '★細かい 表が 畳まれていない★').not.toHaveAttribute(
    'open',
    ''
  );

  // ★紙の 中身が 材料どおり★（足した 実費も 引いた 売上）
  const ji1 = (await kami.first().textContent()) || '';
  // eslint-disable-next-line no-console
  console.log('★売上の 紙★ ' + ji1.replace(/\s+/g, ' ').slice(0, 160));
  expect(ji1, '★売上の 紙では ない★').toContain('売上表（車ごと・日ごと）');
  expect(ji1, '★売上（足した 実費も 引いた 後）が 出ていない★').toContain(
    KOTAE.uriage.toLocaleString('ja-JP')
  );
  expect(ji1, '★実費が 出ていない★').toContain(KOTAE.jippi.toLocaleString('ja-JP'));
  expect(ji1, '★1月の 紙では ない★').toContain('2026年 1月');

  // 紙の 種類を 変えると 回数・距離の 紙
  await page.locator('#kamiSoukou').click();
  await page.waitForTimeout(300);
  const ji2 = (await kami.first().textContent()) || '';
  expect(ji2, '★回数・距離を 選んでも 紙が 変わらない★').toContain('回数・距離（月ごと）');
  expect(ji2, '★回数（12+8）が 出ていない★').toContain('20');
  await page.locator('#kamiUri').click();
  await page.waitForTimeout(300);

  // はみ出さない（右も 下も）
  const hami = await page.evaluate(() => {
    const d = document.documentElement;
    const w = document.querySelector('#kamiMado .kami-mise-waku');
    const r = w.firstElementChild.getBoundingClientRect();
    const b = Math.max(
      ...Array.from(w.querySelectorAll('td,th,div')).map((x) => x.getBoundingClientRect().bottom)
    );
    return {
      page: d.scrollWidth - d.clientWidth,
      waku: Math.round(r.right - w.getBoundingClientRect().right),
      shita: Math.round(b - w.getBoundingClientRect().bottom),
    };
  });
  expect(hami.page, '★ページが 横に はみ出している★').toBeLessThanOrEqual(0);
  expect(hami.waku, '★紙の 右が 枠で 切れている★').toBeLessThanOrEqual(1);
  expect(hami.shita, '★紙の 下が 枠で 切れている★').toBeLessThanOrEqual(1);

  // 押すと PDF（紙は 作り直して 渡す）
  await page.evaluate(() => {
    window.__dasu = 0;
    window.__ikiteru = null;
    window.__na = '';
    window.KamiPdf.dasu = function (itas, na) {
      window.__dasu++;
      window.__na = na;
      window.__ikiteru = [].concat(itas || []).some(function (x) {
        return x.el.isConnected || !!x.el.style.transform;
      });
      return Promise.resolve({ mai: 1, size: 1 });
    };
  });
  await kami.first().click();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__dasu), '★紙を 押しても PDF に ならない★').toBe(1);
  expect(
    await page.evaluate(() => window.__ikiteru),
    '★画面で 縮めた 紙を そのまま PDF に 渡している★'
  ).toBe(false);
  expect(await page.evaluate(() => window.__na), '★PDF の 名前が 売上表で ない★').toContain(
    '売上表_2026-01'
  );

  // ★広い 画面で 描いてから 縮める★
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(600);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  const hami2 = await page.evaluate(() => {
    const w = document.querySelector('#kamiMado .kami-mise-waku');
    return Math.round(
      w.firstElementChild.getBoundingClientRect().right - w.getBoundingClientRect().right
    );
  });
  expect(hami2, '★幅を 変えたら 紙の 右が 切れた★').toBeLessThanOrEqual(1);

  // ★畳んだ 所を 開くと 実費を 直す 欄が 使える★（入力の 画面が ここへ 案内している）
  await page.locator('#motoHyou > summary').click();
  await page.locator('#motoHyou .rmore').first().click();
  await page.waitForTimeout(300);
  const ran = await page.locator('#motoHyou input[data-f]').count();
  expect(ran, '★畳んだ 所を 開いても 実費の 欄が 無い★').toBeGreaterThan(0);

  // ★月を 変えた 直後に 前の 月の 紙を 残さない★
  const sugu = await page.evaluate(() => {
    document.getElementById('prevM').click();
    const w = document.querySelector('#kamiMado .kami-mise-waku');
    return w ? w.textContent : '';
  });
  expect(
    sugu === '' || sugu.indexOf('2025年 12月') >= 0,
    '★月を 変えた 直後に 前の 月の 紙が 残っている★'
  ).toBe(true);
  expect(err, '★画面が 落ちた★').toEqual([]);
});
