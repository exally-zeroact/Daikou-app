// ============================================================
// ★本人の 画面を そのまま 写真に 撮る★ 2026-10-01
//
//   ★司さん★「ほんでパスワード設定してからの画面はどうなっとんど 見せろや」
//
//   ★なぜ 試験の 形で 撮るか★
//     本物の 画面を 本物の 道（kyuryo.html?t=…）で 開いて 撮る。
//     手で 似せた 絵を 出すと ★実物と 違う 物を 見せる★ 事に なる。
//     倉庫の 関数だけ 差し替える（返事の 形は 本物と 同じ）。
//
//   ★出す 絵（客の 画面だけ）★
//     1. honnin-1-hajimete.png … リンクを 開いた すぐ（パスワードを 決める）
//     2. honnin-2-mita.png     … ★パスワードを 決めた 後★（自分の 明細）
//
//   ※ 漏れの 合否は 別の 見張り（kyuryo-honnin.spec.js）が 見る。
//     ここが 見るのは ★空の 絵を 送らない★ 事。
//
//   ★★わざと壊して 赤に なるのを 見た（2026-10-01 実測）★★
//     壊す前 ……………………………………………… 赤 0 / 全 1
//     勤務の 時数(WORK)を 空に する ……………… ★赤 1 / 1★
//       出た字「★合計が ¥0＝中身の 無い 絵★」
//       ＝実際に 1回 やらかした 形（全部「—」の 絵を 送った）を 止める
//     戻した後 …………………………………………… 赤 0 / 全 1
// ============================================================
const { test, expect } = require('@playwright/test');
const path = require('path');

const EMP = {
  employee_id: 'e1',
  company_id: 'c1',
  name: '白石正人',
  role: '甲',
  active: true,
  sort_order: 1,
};
const SET = {
  company_id: 'c1',
  period_start_day: 21,
  period_end_mode: 'thirds', // ★10-07：前は 'month3'（知らない 値＝黙って 月3回）。今は 止まるので 本当の 値に
  period_days: 11,
  show_car_sales: true,
  roles: { 甲: { rate: 0.3, floor: 1000 } },
};
// ★中身が 空の 明細を 撮らない★
//   画面は ★今見ている 月★ を 出すので、勤務も ★今月★ に 置く。
//   （先月の 日付で 作ると 全部「—」の 空の 絵に なる）
const _ima = new Date();
const _hi = (d) =>
  new Date(Date.UTC(_ima.getFullYear(), _ima.getMonth(), d, 11, 0, 0)).toISOString();
const _owari = (d, h) =>
  new Date(Date.UTC(_ima.getFullYear(), _ima.getMonth(), d, h, 0, 0)).toISOString();
const SHIFTS = [
  {
    shift_id: 's1',
    company_id: 'c1',
    device_id: 'd1',
    started_at: _hi(2),
    ended_at: _owari(2, 19),
    fare_total_yen: 24800,
    trip_count: 9,
  },
  {
    shift_id: 's2',
    company_id: 'c1',
    device_id: 'd1',
    started_at: _hi(5),
    ended_at: _owari(5, 20),
    fare_total_yen: 31200,
    trip_count: 11,
  },
  {
    shift_id: 's3',
    company_id: 'c1',
    device_id: 'd1',
    started_at: _hi(8),
    ended_at: _owari(8, 18),
    fare_total_yen: 18600,
    trip_count: 7,
  },
];

// ★誰が 何時間 乗ったか★は dk_work_hours が 持つ。
//   これが 無いと 明細は 全部「—」に なる（実際 1回 そう なった）。
const _ymd = (d) => {
  const x = new Date(_ima.getFullYear(), _ima.getMonth(), d);
  return (
    x.getFullYear() +
    '-' +
    String(x.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(x.getDate()).padStart(2, '0')
  );
};
const WORK = [
  { work_date: _ymd(2), employee_id: 'e1', device_id: 'd1', hours: 8 },
  { work_date: _ymd(5), employee_id: 'e1', device_id: 'd1', hours: 9 },
  { work_date: _ymd(8), employee_id: 'e1', device_id: 'd1', hours: 7 },
];

async function nise(page, hajimete) {
  await page.route('**/rest/v1/rpc/dk_kyuryo_pw_set', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  );
  await page.route('**/rest/v1/rpc/dk_kyuryo_verify', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, name: EMP.name }),
    })
  );
  await page.route('**/rest/v1/rpc/dk_kyuryo_get', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        emp: EMP,
        settings: [SET],
        labels: [
          { company_id: 'c1', device_id: 'd1', label: '1466', sort_order: 1, show_in_slip: true },
        ],
        shifts: SHIFTS,
        edits: [],
        workHours: WORK,
        adjustments: [], // ★本物の 関数は 必ず 返す（10-07：返らない 時は 止める 様に した）★
        manualDays: [],
      }),
    })
  );
  await page.route('**/rest/v1/dk_**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await page.goto('/kyuryo.html?t=TOK' + (hajimete ? '&c=INIT12345' : ''));
  await page.waitForTimeout(1000);
}

const OUT = (n) => path.join('data', 'shashin', n);

test('★本人の 画面を 撮る（はじめて → 決めた後）★', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 }); // iPhone くらい
  await nise(page, true);

  // ① リンクを 開いた すぐ
  await expect(page.locator('#hnGo')).toHaveText('パスワードを 決める');
  await page.screenshot({ path: OUT('honnin-1-hajimete.png'), fullPage: true });

  // ② パスワードを 決めた 後
  await page.fill('#hnPw', 'abcd1234');
  await page.fill('#hnPw2', 'abcd1234');
  await page.click('#hnGo');
  await expect(page.locator('#slips')).toContainText(EMP.name, { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT('honnin-2-mita.png'), fullPage: true });

  // ★★空の 絵を 司さんに 送らない★★
  //   2026-10-01 に ★全部「—」・合計 ¥0 の 絵を 1枚 送って しまった★
  //   （仮の 勤務を 先月に 置いていた）。数で 止める。
  const naka = await page.evaluate(() => {
    const b = document.getElementById('slips');
    return { h: b.scrollHeight, ji: b.innerText || '' };
  });
  expect(naka.h, '★明細の 絵が 空です★').toBeGreaterThan(300);
  expect(naka.ji, '★名前が 出ていません★').toContain(EMP.name);
  expect(naka.ji, '★月を 選ぶ 所が 出ていません★').toContain('年');
  // ★合計が ¥0 の 絵は 出さない★（中身の 無い 絵を 見せない）
  expect(naka.ji.replace(/\s/g, ''), '★合計が ¥0＝中身の 無い 絵★').not.toContain('¥0');
  expect(naka.ji, '★金額が 1つも 出ていません★').toMatch(/[¥￥]\s?[1-9]/);
});
