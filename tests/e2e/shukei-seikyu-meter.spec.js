// ============================================================
// ★★月次の 請求書＝打っていない 車は メーターで 請求書を 押した 額★★ 2026-10-30
//
//   司さん 10-29「メーターの方で請求書押してるんやから請求書も自動で反映されるようにしろ」
//   決まり＝★車×日★：打った 車は 打った 額（0＝請求書 なし）・打っていない 車は 窓 dk_meisai_gyoumu_goukei の 額
//           1台も 打っていない 日は 今まで 通り 請求書アプリの 明細の 日の 合計（車に 結べない 手入れの 明細も 入る）
//   ★下がるのは 現金だけ★（売上は 60,000 の まま）
//
//   10/3：d1（s1）売上 53,300・d2（s2）売上 6,700＝60,000
//
//   ★★わざと壊して 赤に なるのを 見た（2026-10-30 実測）★★
//     打っていない 車を メーターの 額で なく 0 に する（g += cs[k].utta ? cs[k].ji : 0）⇒ ★赤 4本★（⑥⑧⑨⑩）
//     ⑦（誰も 打っていない 日）は 緑の まま＝今まで 通りの 道
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
    started_at: '2026-10-03T20:00:00+09:00',
    ended_at: '2026-10-04T03:00:00+09:00',
    elapsed_sec: 25200,
    fare_total_yen: 53300,
    trip_count: 10,
    actual_total_m: 50000,
    total_distance_m: 90000,
  },
  {
    shift_id: 's2',
    device_id: 'd2',
    started_at: '2026-10-03T21:00:00+09:00',
    ended_at: '2026-10-04T02:00:00+09:00',
    elapsed_sec: 18000,
    fare_total_yen: 6700,
    trip_count: 2,
    actual_total_m: 8000,
    total_distance_m: 12000,
  },
];
const LABELS = [
  { device_id: 'd1', label: '4987', sort_order: 1 },
  { device_id: 'd2', label: '1466', sort_order: 2 },
];

function tsukuru(dir, hyou) {
  const moto = fs.readFileSync(path.join(dir, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: '見張り用' };
  const T = Object.assign({ dk_shifts: SHIFTS, dk_device_labels: LABELS }, hyou);
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
    'S.softList=function(s,p,st){(window.__yomi=window.__yomi||[]).push(String(p));if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function hiraku(page, hyou) {
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00+09:00'));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(__dirname, hyou),
    })
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
  const kami = page.locator('#kamiMado .kami-mise-waku');
  await expect(kami.first(), '★紙が 出ない★').toBeVisible({ timeout: 15000 });
  await page.selectOption('#kamiTsuki', '10');
  await page.locator('#kamiUriM').click();
  await page.waitForTimeout(400);
  const ji = ((await kami.first().textContent()) || '').replace(/\s+/g, ' ');
  const shirase = await page.evaluate(() => {
    const el = document.getElementById('seikyuShirase');
    return el && el.style.display !== 'none' ? el.textContent : '';
  });
  const yomi = await page.evaluate(() => window.__yomi || []);
  return { ji, shirase, yomi };
}

const ED = (s1, s2) => [
  { shift_id: 's1', toll_yen: 0, bridge_yen: 0, other_yen: 0, denshi_yen: 0, seikyu_yen: s1 },
  { shift_id: 's2', toll_yen: 0, bridge_yen: 0, other_yen: 0, denshi_yen: 0, seikyu_yen: s2 },
];
const MS = (goukei, date) => ({ date: date || '2026-10-03', goukei: goukei });
const GY = (sid, goukei, date) => ({ shift_id: sid, date: date || '2026-10-03', goukei: goukei });

for (const [na, hyou, kitai] of [
  [
    // 前は 打った 額だけ（10,000）＝d2 の メーターの 5,000 が 抜けて 現金 50,000
    '⑥ d1 に 打った・d2 は 空＝d2 は メーターの 額',
    {
      dk_shift_edits: ED(10000, null),
      dk_meisai_gyoumu_goukei: [GY('s1', 9000), GY('s2', 5000), GY('s2', 999, '2026-10-04')],
      dk_meisai_hi_goukei: [MS(14000), MS(999, '2026-10-04')],
    },
    {
      seikyu: '15,000',
      genkin: '45,000',
      nai: ['50,000', '45,999'],
      shirase: '15,000円／アプリ 14,000円',
    },
  ],
  [
    // 1台も 打っていない 日＝明細の 日の 合計（車に 結べない 手入れの 明細 7,000 も 入る）＝今まで 通り
    '⑦ 誰も 打っていない＝明細の 日の 合計',
    {
      dk_shift_edits: ED(null, null),
      dk_meisai_gyoumu_goukei: [GY('s1', 5000)],
      dk_meisai_hi_goukei: [MS(12000)],
    },
    { seikyu: '12,000', genkin: '48,000', nai: ['55,000'], shirase: '' },
  ],
  [
    // 0＝この 車は 請求書 なし（メーターの 4,000 を 使わない）
    '⑧ d1 に 0・d2 は 空＝5,000',
    {
      dk_shift_edits: ED(0, null),
      dk_meisai_gyoumu_goukei: [GY('s1', 4000), GY('s2', 5000)],
      dk_meisai_hi_goukei: [MS(9000)],
    },
    { seikyu: '5,000', genkin: '55,000', nai: ['51,000'], shirase: '5,000円／アプリ 9,000円' },
  ],
  [
    // 車に 結べない 明細（手で 足した 3,000）を 事務所が 車に 打った 形（本番 10-24 と 同じ）
    '⑨ 結べない 明細は 打った 日に 内訳で 知らせる',
    {
      dk_shift_edits: ED(8000, null),
      dk_meisai_gyoumu_goukei: [GY('s1', 5000), GY('s2', 2000)],
      dk_meisai_hi_goukei: [MS(10000)],
    },
    { seikyu: '10,000', genkin: '50,000', nai: ['52,000'], shirase: '' },
  ],
]) {
  test('★請求書 ' + na + '★', async ({ page }) => {
    const err = [];
    page.on('pageerror', (e) => err.push(e.message));
    const r = await hiraku(page, hyou);
    // eslint-disable-next-line no-console
    console.log('★' + na + '★ 知らせ=' + JSON.stringify(r.shirase));
    expect(err, '★画面が 落ちました★').toEqual([]);
    expect(
      r.yomi.some((p) => p.indexOf('dk_meisai_gyoumu_goukei') === 0),
      '★業務ごとの 窓を 読んでいない★'
    ).toBe(true);
    expect(r.ji, '★10月の 売上表の 紙では ない★').toContain('2026年 10月');
    expect(r.ji, '★売上が 変わった（請求書で 売上を 下げては いけない）★').toContain('60,000');
    expect(r.ji, '★請求書が ' + kitai.seikyu + ' で ない★').toContain(kitai.seikyu);
    expect(r.ji, '★現金が ' + kitai.genkin + ' で ない★').toContain(kitai.genkin);
    (kitai.nai || []).forEach((x) => {
      expect(r.ji, '★間違えた 時の 数 ' + x + ' が 出ている★').not.toContain(x);
    });
    if (kitai.shirase) expect(r.shirase, '★食い違いの 知らせが 違う★').toContain(kitai.shirase);
    else expect(r.shirase, '★食い違いが 無いのに 知らせが 出た★').toBe('');
  });
}

test('★請求書 ⑩ 食い違いの 知らせに 車に 結べない 額が 出る★', async ({ page }) => {
  const r = await hiraku(page, {
    dk_shift_edits: ED(8000, null),
    dk_meisai_gyoumu_goukei: [GY('s1', 5000), GY('s2', 2000)],
    dk_meisai_hi_goukei: [MS(11000)],
  });
  // eslint-disable-next-line no-console
  console.log('★⑩★ 知らせ=' + JSON.stringify(r.shirase));
  expect(r.shirase).toContain('10,000円／アプリ 11,000円');
  expect(r.shirase, '★車に 結べない 4,000円 が 出ない★').toContain('車に 結べない 4,000円');
});
