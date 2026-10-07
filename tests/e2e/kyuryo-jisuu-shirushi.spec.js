// ============================================================
// ★★見張り：時数を 入れる 画面も 使わない 印の 業務を 出さない★★ 2026-10-07
//
//   司さん「前からある2つもやれ」の 続き（対立役 10-07）
//   ★前★ 計算（payroll-daily）は 印の 業務を 飛ばして 同じ日・同じ車の 手入力 ¥7,000 を 使うのに、
//         時数の 画面は 印の 業務を「メーターの 車」と 見て ¥0 と 出し、手入力の 欄を 隠した
//   ★物差し★ 印の 業務 ＋ 同じ日・同じ車の 手入力 で、手入力の 売上の 欄が 出る・¥0 の 行が 出ない
//
//   ★★わざと壊して 赤に なるのを 見た（2026-10-07 実測）★★
//     renderDays の excluded の 絞りを 外す ⇒ ★赤★（手入力の 欄が 0）
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

test('★印の 業務と 同じ日・同じ車の 手入力は 時数の 画面に 手入力として 出る★', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  let hi = '';
  let dev = '';
  let sid = '';
  await openKyuryo(page, (f) => {
    const s = f.shifts[0];
    hi = s.started_at.slice(0, 10);
    dev = s.device_id;
    sid = s.shift_id;
    s.excluded = true;
    s.fare_total_yen = 0;
    f.manualDays = (f.manualDays || []).filter((m) => !(m.work_date === hi && m.device_id === dev));
    f.manualDays.push({
      company_id: f.settings[0].company_id,
      work_date: hi,
      device_id: dev,
      sales_yen: 7000,
      hours: 0,
    });
    return f;
  });
  await page.click('.tab[data-tab="hours"]');
  await page.waitForTimeout(800);
  const r = await page.evaluate(
    (a) => {
      const box = document.getElementById('days');
      const man = box.querySelectorAll(
        'input[data-man-date="' + a.hi + '"][data-man-dev="' + a.dev + '"][data-man-f="sales_yen"]'
      );
      return {
        hiAru: box.textContent.length > 0,
        man: man.length,
        val: man[0] ? man[0].value : null,
        // ★印の 業務 その物（shift_id）の 行★
        meter: box.querySelectorAll('input[data-sid="' + a.sid + '"]').length,
      };
    },
    { hi: hi, dev: dev, sid: sid }
  );
  // eslint-disable-next-line no-console
  console.log('★時数★ ' + JSON.stringify(r));
  expect(r.hiAru, '★時数の 画面が 空＝何も 見ていない★').toBe(true);
  expect(r.man, '★手入力の 売上の 欄が 出ない（印の 業務に 隠された）★').toBe(1);
  expect(Number(String(r.val).replace(/,/g, '')), '★手入力の 額が 違う★').toBe(7000);
  expect(r.meter, '★印の 業務が メーターの 車として 出ている★').toBe(0);
  expect(err, '★画面が 落ちた★').toEqual([]);
});
