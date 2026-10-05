// ============================================================
// ★★見張り：月次集計＝PDF と 同じ 紙を そのまま 見せる★★ 2026-10-05
//
//   司さん「PDFつくっとんやけんそれを見せろやぼけ」「何をくどくど訳わからんこと見せとんど」
//   ★前★ ボタン 4つ＋説明。押すと PDF が 出るだけ。画面には 細かい 表が 5箱 並んでいた。
//   ★今★ 月と 紙の 種類を 選ぶと ★その 紙が 画面に 出る★。押すと PDF。表は 畳む（消していない）。
//
//   ★押す物の一覧（先に書く）★ 1. 月次集計を 開く 2. 紙の 種類 3. 紙を 押す
//
//   ★★わざと壊して 赤に なるのを 見た（2026-10-05 実測）★★
//     shukei.html を 前の 形に 戻す ⇒ ★赤★（紙が 0枚）
//   ★10-05 対立役に 叩かれて 締めた★ 縮めた 紙を そのまま PDF へ ⇒ ★赤★／幅が 変わっても 描き直さない ⇒ ★赤★
//     年を 変えた 直後に 古い 紙が 残る ⇒ ★赤★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CO = '11111111-2222-3333-4444-555555555555';

// ★2台 × 2日（1月）＋ 別の月（3月）★
const SHIFTS = [
  {
    shift_id: 's1',
    device_id: 'd1',
    started_at: '2026-01-05T20:00:00+09:00',
    ended_at: '2026-01-06T04:00:00+09:00',
    elapsed_sec: 28800,
    fare_total_yen: 40000,
    trip_count: 12,
    actual_total_m: 80000,
    total_distance_m: 150000,
  },
  {
    shift_id: 's2',
    device_id: 'd2',
    started_at: '2026-01-05T20:00:00+09:00',
    ended_at: '2026-01-06T04:00:00+09:00',
    elapsed_sec: 28800,
    fare_total_yen: 25000,
    trip_count: 8,
    actual_total_m: 50000,
    total_distance_m: 90000,
  },
  {
    shift_id: 's3',
    device_id: 'd1',
    started_at: '2026-03-10T20:00:00+09:00',
    ended_at: '2026-03-11T04:00:00+09:00',
    elapsed_sec: 28800,
    fare_total_yen: 31000,
    trip_count: 9,
    actual_total_m: 61000,
    total_distance_m: 110000,
  },
];
// ★高速代（実費）★＝売上から 引かれる
const EDITS = [{ shift_id: 's1', toll_yen: 3000, bridge_yen: 0, other_yen: 0, hours: 8 }];
const LABELS = [
  { device_id: 'd1', label: '4987', sort_order: 1 },
  { device_id: 'd2', label: '1466', sort_order: 2 },
];
// ★請求書払い★（1/5 に 6,000円）
const TRIPS = [
  { fare_yen: 6000, started_at: '2026-01-05T21:00:00+09:00', payment_type: 'invoice' },
];
// ★電子決済（日ごと）★（1/5 に 4,000円）
const DAY_EXTRAS = [{ pay_date: '2026-01-05', denshi_yen: 4000 }];

// ★手で 足した 答え★（紙と 突き合わせる）
//   1月の 売上 ＝ (40000 − 3000) + 25000 ＝ 62,000
//   1月の 実費 ＝ 3,000 ／ 請求書 6,000 ／ 電子決済 4,000 ／ 現金 ＝ 62,000 − 10,000 ＝ 52,000
const KOTAE = { uriage: 62000, keihi: 3000, seikyu: 6000, denshi: 4000, genkin: 52000 };

function tsukuru(dir) {
  const moto = fs.readFileSync(path.join(dir, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: '見張り用' };
  const hyou = {
    dk_shifts: SHIFTS,
    dk_shift_edits: EDITS,
    dk_device_labels: LABELS,
    dk_trips: TRIPS,
    dk_day_extras: DAY_EXTRAS,
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

test('★月次集計＝紙を そのまま 見せる・はみ出さない・押すと PDF・表は 畳む★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(__dirname),
    })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
  const kami = page.locator('#kamiMado .kami-mise-waku');
  await expect(kami.first(), '★開いても 紙が 出ない★').toBeVisible({ timeout: 15000 });
  await expect(page.locator('#motoHyou'), '★細かい 表が 畳まれていない★').not.toHaveAttribute(
    'open',
    ''
  );

  // ★紙の 中身が 材料どおり★（1月の 月次集計の 紙に 手で 足した 売上と 現金が 出る）
  await page.selectOption('#kamiTsuki', '1');
  await page.waitForTimeout(300);
  const ji1 = (await kami.first().textContent()) || '';
  expect(ji1, '★1月の 紙に 売上が 出ていない★').toContain(KOTAE.uriage.toLocaleString('ja-JP'));
  expect(ji1, '★1月の 紙に 現金が 出ていない★').toContain(KOTAE.genkin.toLocaleString('ja-JP'));

  // 紙の 種類を 変えると 紙が 変わる
  const mae = await kami.first().textContent();
  await page.locator('#kamiUriM').click();
  await page.waitForTimeout(300);
  expect(await kami.first().textContent(), '★売上表を 選んでも 紙が 変わらない★').not.toBe(mae);

  // はみ出さない
  const hami = await page.evaluate(() => {
    const d = document.documentElement;
    const w = document.querySelector('#kamiMado .kami-mise-waku');
    const r = w.firstElementChild.getBoundingClientRect();
    return {
      page: d.scrollWidth - d.clientWidth,
      waku: Math.round(r.right - w.getBoundingClientRect().right),
    };
  });
  expect(hami.page, '★ページが 横に はみ出している★').toBeLessThanOrEqual(0);
  expect(hami.waku, '★紙が 枠から はみ出している（見切れる）★').toBeLessThanOrEqual(1);

  // 押すと PDF（紙は 作らせず 横取り）
  await page.evaluate(() => {
    window.__dasu = 0;
    window.__ikiteru = null;
    window.KamiPdf.dasu = function (itas) {
      window.__dasu++;
      // ★押した 時は 紙を 作り直して 渡す★（画面で 縮めた 板を 渡すと 測り直しが ずれる・画面の 紙も 消える）
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
  // ★下も 切れない・幅を 変えても 切れない★
  const shita = await page.evaluate(() => {
    const w = document.querySelector('#kamiMado .kami-mise-waku');
    const b = Math.max(
      ...Array.from(w.querySelectorAll('td,th,div')).map((x) => x.getBoundingClientRect().bottom)
    );
    return Math.round(b - w.getBoundingClientRect().bottom);
  });
  expect(shita, '★紙の 下が 枠で 切れている★').toBeLessThanOrEqual(1);
  // ★広い 画面で 描いてから 縮める★
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(400);
  await page.locator('#kamiMonth').click(); // 1280 の 幅で 描き直させる
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  const hami2 = await page.evaluate(() => {
    const w = document.querySelector('#kamiMado .kami-mise-waku');
    return Math.round(
      w.firstElementChild.getBoundingClientRect().right - w.getBoundingClientRect().right
    );
  });
  expect(hami2, '★幅を 変えたら 紙の 右が 切れた★').toBeLessThanOrEqual(1);
  // ★年を 変えたら 古い 年の 紙を 残さない★（押すと 札と 数の 年が 食い違った）
  //   押した その 瞬間は 紙が 0枚（読み込み中）か、もう 新しい 年の 紙の どちらか で なければ 赤
  const ima = Number(
    ((await page.locator('#yearLabel').textContent()) || '').replace(/[^0-9]/g, '')
  );
  const sugu = await page.evaluate(() => {
    document.getElementById('prevY').click();
    const w = document.querySelector('#kamiMado .kami-mise-waku');
    return w ? w.textContent : '';
  });
  expect(
    sugu === '' || sugu.indexOf(String(ima - 1) + '年') >= 0,
    '★年を 変えた 直後に 古い 年の 紙が 残っている★'
  ).toBe(true);
  await page.waitForTimeout(800);
  expect(
    (await kami.first().textContent()) || '',
    '★年を 変えたのに 新しい 年の 紙に ならない★'
  ).toContain(String(ima - 1) + '年');
  expect(err, '★画面が 落ちた★').toEqual([]);
});
