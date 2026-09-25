// ============================================================
// ★★月次集計の 画面から 出せる 紙 4種 ＝ ★実際に 押して 中身を 読む★★★ 2026-09-25
//
//   ★司さん★「集計全部を…月で選んだら 項目別で その場で A4サイズPDFで 見せれるようにしろ」
//             「売上表は月毎、年ごとで…現金、請求書、電子決済、経費の欄で見れるようにしとけや」
//             「回数や距離はまた別項目で作れや」
//
//   ★★これが 見つけた 本物の 穴（2026-09-25）★★
//     月次集計の 紙の「車ごと」が ★ずっと 空だった★。
//     画面の 中で `ctx.byDate[日].cars` を 回していたが ★そんな 物は 無い★
//     （実物は `ctx.byDate[日][車のID]`）。
//     ⇒ ★部品の 単体試験は 全部 緑★だった＝渡す 手前で 0台に なっていたから。
//     ⇒ ★画面の ボタンを 押して 出た 紙を 読む★ 門が 要る。
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-25 実測・1つずつ 手で）★★
//     ①kamiCarsOf を `by[hi].cars` に 戻す ………………… ★赤★「4987 が 出ていません」
//     ②kamiUriageHi の 請求書を 足さない ………………… ★赤★「日ごとの お金が 合っていません」
//     ③kamiSoukouNenData の 月ごとを 1000で 割らない … ★赤★「1月の 行が ありません」
//
//   ★★一度 ②③が ★緑のまま★ だった（同じ日・直した）★★
//     はじめ `ji`（紙 ぜんぶの 字）に「6,000」「191.0」が 在るかで 見ていた。
//     ⇒ ★上の 札や 合計の 行にも 同じ 字が 在る★ので 壊しても 緑だった。
//     ⇒ ★行ごとに 升目を 取り出して 名指しで 突き合わせる★ 形に 直した。
//     ⇒ [[feedback_kowashita_no_ni_akaku_naranai_wa_mazu_kowarete_iru_ka]]
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

async function hiraku(page) {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(__dirname),
    })
  );
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#kamiCard').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1500);

  // ★PDF に する 手前で 紙を 横取りする★
  //   ＝html2canvas を 走らせずに ★組み上がった 板の 字★ を 読む（速い・確かめたいのは 中身）
  await page.evaluate(() => {
    window.__kami = [];
    window.KamiPdf.dasu = function (itas) {
      window.__kami = [].concat(itas || []).map(function (x) {
        return {
          muki: x.muki,
          ji: x.el.textContent,
          // ★行ごとに 升目を 取る★＝「どこかに その 字が 在る」では 見張りに ならない
          //   （2026-09-25 実測：文字で 探す やり方だと わざと 壊しても 緑のままだった）
          gyou: [].slice.call(x.el.querySelectorAll('tr')).map(function (tr) {
            return [].slice.call(tr.children).map(function (td) {
              return td.textContent.trim();
            });
          }),
        };
      });
      return Promise.resolve({ mai: window.__kami.length, size: 1 });
    };
  });
}

// ★先頭の 升目が これで 始まる 行★を 1本 取る（無ければ null）
function gyouOf(kami, atama) {
  const hit = (kami.gyou || []).filter((r) => r.length > 1 && r[0].indexOf(atama) === 0);
  return hit.length ? hit[0] : null;
}

async function osu(page, id, tsuki) {
  if (tsuki) await page.selectOption('#kamiTsuki', String(tsuki));
  await page.evaluate(() => {
    window.__kami = [];
  });
  await page.locator('#' + id).click();
  await page.waitForTimeout(600);
  return await page.evaluate(() => window.__kami);
}

test('★4つの ボタンで それぞれの 紙が 出る（中身を 読む）★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await hiraku(page);

  // ── ①月次集計（この月）──────────────────────
  const getsuji = await osu(page, 'kamiMonth', 1);
  // eslint-disable-next-line no-console
  console.log(
    '★月次集計★ ' + JSON.stringify({ mai: getsuji.length, muki: getsuji[0] && getsuji[0].muki })
  );
  expect(getsuji.length, '★月次集計の 紙が 出ていません★').toBe(1);
  expect(getsuji[0].muki).toBe('tate');
  expect(getsuji[0].ji).toContain('月次集計');
  // ★★車ごとが 空に なっていないか★★（2026-09-25 に ここが 空だった）
  LABELS.forEach((l) => {
    expect(getsuji[0].ji, '★月次集計の 車ごとに「' + l.label + '」が 出ていません★').toContain(
      l.label
    );
  });
  expect(getsuji[0].ji, '★請求書の 数が 違います★').toContain('6,000');

  // ── ②売上表（この月）──────────────────────
  const uriM = await osu(page, 'kamiUriM', 1);
  // eslint-disable-next-line no-console
  console.log(
    '★売上表・月★ ' + JSON.stringify({ mai: uriM.length, muki: uriM[0] && uriM[0].muki })
  );
  expect(uriM.length, '★売上表（月）の 紙が 出ていません★').toBe(1);
  expect(uriM[0].muki, '★売上表（月）は A4横★').toBe('yoko');
  expect(uriM[0].ji).toContain('売上表（月ごと）');
  // ★司さんの 4つの 欄★
  ['現金', '請求書', '電子決済', '経費'].forEach((w) => {
    expect(uriM[0].ji, '★「' + w + '」の 欄が ありません★').toContain(w);
  });
  // ★★日ごとの 行を 名指しで 読む★★（1/5 に 全部 入れた）
  //   列＝日 / 売上 / 現金 / 請求書 / 電子決済 / 経費
  const h5 = gyouOf(uriM[0], '1/5');
  // eslint-disable-next-line no-console
  console.log('★1/5 の 行★ ' + JSON.stringify(h5));
  expect(h5, '★日ごとの 表に 1/5 の 行が ありません★').not.toBeNull();
  expect(h5.slice(1), '★日ごとの お金が 合っていません★').toEqual([
    KOTAE.uriage.toLocaleString('ja-JP'),
    KOTAE.genkin.toLocaleString('ja-JP'),
    KOTAE.seikyu.toLocaleString('ja-JP'),
    KOTAE.denshi.toLocaleString('ja-JP'),
    KOTAE.keihi.toLocaleString('ja-JP'),
  ]);

  // ★車ごとの 行＝車 / 売上 / 経費★（現金・請求書・電子決済は 車ごとには 無い）
  const c1 = gyouOf(uriM[0], '4987');
  // eslint-disable-next-line no-console
  console.log('★4987 の 行★ ' + JSON.stringify(c1));
  expect(c1, '★車ごとの 表に 4987 が ありません★').not.toBeNull();
  expect(c1, '★車ごとの 売上／経費が 合っていません★').toEqual(['4987', '37,000', '3,000']);
  // ★車ごとも 出ている★
  LABELS.forEach((l) => {
    expect(uriM[0].ji, '★売上表の 車ごとに「' + l.label + '」が 出ていません★').toContain(l.label);
  });

  // ── ③売上表（年ぶん）──────────────────────
  const uriY = await osu(page, 'kamiYear');
  // eslint-disable-next-line no-console
  console.log(
    '★売上表・年★ ' + JSON.stringify({ mai: uriY.length, muki: uriY[0] && uriY[0].muki })
  );
  expect(uriY.length).toBe(1);
  expect(uriY[0].ji).toContain('売上表（年ごと）');
  expect(uriY[0].ji, '★1月が ありません★').toContain('1月');
  expect(uriY[0].ji, '★3月の 分が 入っていません★').toContain('3月');

  // ── ④回数・距離（年ぶん）────────────────────
  const sou = await osu(page, 'kamiSoukouN');
  // eslint-disable-next-line no-console
  console.log('★回数距離・年★ ' + JSON.stringify({ mai: sou.length, muki: sou[0] && sou[0].muki }));
  expect(sou.length).toBe(1);
  expect(sou[0].ji).toContain('回数・距離（年ごと）');
  // ★月ごとの 行を 名指しで 読む★（列＝月 / 回数 / 実車km / 総走行km / 迎え戻りkm）
  //   1月 … 12+8=20回 ／ 実車 (80+50)km=130.0 ／ 総走行 (150+90)km=240.0 ／ 迎え戻り 110.0
  //   3月 … 9回 ／ 61.0 ／ 110.0 ／ 49.0
  const m1 = gyouOf(sou[0], '1月');
  const m3 = gyouOf(sou[0], '3月');
  const gou = gyouOf(sou[0], '合計');
  // eslint-disable-next-line no-console
  console.log('★1月/3月/合計★ ' + JSON.stringify([m1, m3, gou]));
  expect(m1, '★1月の 行が ありません★').toEqual(['1月', '20', '130.0', '240.0', '110.0']);
  expect(m3, '★3月の 行が ありません★').toEqual(['3月', '9', '61.0', '110.0', '49.0']);
  expect(gou, '★合計が 合っていません★').toEqual(['合計', '29', '191.0', '350.0', '159.0']);

  expect(err, '★画面が 落ちています★').toEqual([]);
});
