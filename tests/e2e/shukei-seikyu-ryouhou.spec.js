// ============================================================
// ★★見張り：請求書の 額は「入力で 打った 額」と「請求書アプリの 明細」の 両方に 対応★★ 2026-10-06
//
//   司さん「売り上げから請求書アプリに入ってるその日の金額を引く」「2は両方に対応しろ」「1A」（給料は 引かない）
//   ★Excel（代行計算表2026）の 10/3★ 売上 53,300 ／ 請求書 10,000 ／ 現金 43,300（売上表!AV7 ＝ 売上 − 請求書 − 電子決済）
//   ★決まり★ その日 どこかの 車に 打った 額が 在れば 打った 額、無ければ 請求書アプリの 明細。
//             両方に 違う 額が 在る 日は 知らせを 出す（黙って 片方を 捨てない）。
//             ★下がるのは 現金だけ★（売上は 53,300 の まま）
//
//   ★押す物の一覧（先に書く）★ 1. 月次集計を 開く 2. 月＝10月 3. 紙＝売上表
//
//   ★★わざと壊して 赤に なるのを 見た（2026-10-06 実測）★★
//     明細の 消した 行（deleted_at）も 数える ⇒ ★赤★（④ 現金が 43,300 で ない）
//     打った 額と 明細を 両方 足す ⇒ ★赤★（③ 現金が 31,300）
//     売上の 無い 日の 明細も 数える ⇒ ★赤★（⑤ 月の 現金が 38,300）
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
];
const LABELS = [{ device_id: 'd1', label: '4987', sort_order: 1 }];

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
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
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
  return { ji, shirase };
}

const ED = (seikyu) => [
  { shift_id: 's1', toll_yen: 0, bridge_yen: 0, other_yen: 0, denshi_yen: 0, seikyu_yen: seikyu },
];
const MS = (amount, deleted, date) => ({
  date: date || '2026-10-03',
  amount: amount,
  deleted_at: deleted ? '2026-10-04T00:00:00Z' : null,
});

for (const [na, hyou, kitai] of [
  ['① 入力で 打った 額だけ', { dk_shift_edits: ED(10000) }, { shirase: false }],
  ['② 請求書アプリの 明細だけ', { meisai: [MS(10000)] }, { shirase: false }],
  [
    '③ 両方に 違う 額（打った 額を 使い 知らせを 出す・足さない）',
    { dk_shift_edits: ED(10000), meisai: [MS(12000)] },
    { shirase: true, nai: ['31,300', '22,000'] },
  ],
  ['④ 消した 明細は 数えない', { meisai: [MS(10000), MS(7777, true)] }, { shirase: false }],
  [
    // ★売上の 無い 日の 明細は 数えない★（請求書アプリは 1月から・ダイコメの 売上は 8月から＝引くと 現金が マイナス）
    //   同じ 月（10/5）は 知らせに 出す／売上の 無い 月（7/10）は 黙って 数えない
    '⑤ 売上の 無い 日の 明細は 数えない',
    { meisai: [MS(10000), MS(5000, false, '2026-10-05'), MS(3000, false, '2026-07-10')] },
    { shirase: '10/5', nai: ['38,300', '35,300', '15,000'] },
  ],
]) {
  test('★請求書 ' + na + ' ⇒ 現金 43,300・売上 53,300 の まま★', async ({ page }) => {
    const err = [];
    page.on('pageerror', (e) => err.push(e.message));
    const r = await hiraku(page, hyou);
    // eslint-disable-next-line no-console
    console.log('★' + na + '★ 知らせ=' + JSON.stringify(r.shirase));
    expect(r.ji, '★10月の 売上表の 紙では ない★').toContain('2026年 10月');
    expect(r.ji, '★売上が 変わった（請求書で 売上を 下げては いけない）★').toContain('53,300');
    expect(r.ji, '★現金が Excel（43,300）と 違う★').toContain('43,300');
    expect(r.ji, '★請求書が 10,000 で ない★').toContain('10,000');
    // ★間違えた 時に 出る 数★（日の 行に 43,300 が 在っても 月の 合計が 違えば ここで 赤）
    (kitai.nai || []).forEach((x) => {
      expect(r.ji, '★間違えた 時の 数 ' + x + ' が 出ている★').not.toContain(x);
    });
    if (kitai.shirase === '10/5') {
      expect(r.shirase, '★売上の 無い 日の 明細を 知らせていない★').toContain('10/5');
      expect(r.shirase, '★売上の 無い 月まで 知らせている★').not.toContain('7/10');
    } else if (kitai.shirase) {
      expect(r.shirase, '★両方に 違う 額が 在るのに 知らせが 無い★').toContain('10/3');
      expect(r.shirase).toContain('12,000');
    } else {
      expect(r.shirase, '★食い違いが 無いのに 知らせが 出た★').toBe('');
    }
    expect(err, '★画面が 落ちた★').toEqual([]);
  });
}
