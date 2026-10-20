// ============================================================
// ★★手で 入れた 日の「会社が 足した 実費」も 売上から 引く★★ 2026-10-20（司さん「揃えろ」）
//   前は 手入力の 日は 3列（高速・橋・その他）だけを 引き、入力の 画面で 打てる 足した 実費（expenses）を
//   売上表・給料・月次で 引いていなかった（js/payroll-daily.js）。
//   ★給料の 画面で 手入力の 日を 打つと 手元の 行を 送った 中身で 置き換え、expenses（と 距離）が 消えていた★
//   （メーターの 日は 10-14 に 直した 形＝重ねる）。
//
//   ★物差し★ 足した 実費 200,000 の 手入力の 日で 時数を 打つ ⇒ その 日の 字が
//            「同じ 行を 初めから 読んだ 時」と 同じ（足した 実費が 引かれた まま）
//   わざと壊す：saveManual を 送った 中身で 置き換える 形に 戻す ⇒ 赤
//              buildCtx の expenses を 外す ⇒ 赤（足した 実費が 引かれない＝初めから 読んだ 時と 同じ でも 額が 違う）
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

let HI = '';
let DEV = '';
function tebiki(hours) {
  return (f) => {
    const jst = (s) => new Date(new Date(s).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const s0 = f.shifts[Math.floor(f.shifts.length / 2)]; // 期間の 中の 日（先頭は 前の 期間の 端に なる）
    HI = jst(s0.started_at);
    const tsukau = new Set(
      f.shifts.filter((s) => jst(s.started_at) === HI).map((s) => s.device_id)
    );
    DEV = (f.labels || []).map((l) => l.device_id).find((d) => !tsukau.has(d)) || 'manual-tebiki1';
    if (!(f.labels || []).some((l) => l.device_id === DEV))
      f.labels = (f.labels || []).concat([{ device_id: DEV, label: '手入力の車', sort_order: 99 }]);
    f.manualDays = (f.manualDays || []).concat([
      {
        work_date: HI,
        device_id: DEV,
        sales_yen: 300000, // 歩合が 最低保証より 勝つ 大きさ
        hours: hours,
        toll_yen: 0,
        bridge_yen: 0,
        other_yen: 0,
        expenses: { kabc: 200000 },
      },
    ]);
    return f;
  };
}

async function hiNoJi(page) {
  return page.evaluate(() => {
    const out = [];
    for (let i = 0; i < window.__paper.ninzu(); i++)
      out.push(
        window.__paper
          .emp(i)
          .cells.map((c) => c.date + ':' + c.pay)
          .join(',')
      );
    return out.join('|');
  });
}

test('手入力の 日で 時数を 打っても 足した 実費は 引かれた まま（初めから 読んだ 時と 同じ）', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await openKyuryo(page, tebiki(8));
  await page.evaluate(() => {
    const b = document.querySelector('.tab[data-tab="hours"]');
    if (b && b.onclick) b.onclick();
  });
  const ran = page.locator(
    '[data-man-f="hours"][data-man-date="' + HI + '"][data-man-dev="' + DEV + '"]'
  );
  await expect(ran, '★手入力の 日の 欄が 無い（材料が 違う）★').toHaveCount(1);
  await ran.fill('6');
  await ran.dispatchEvent('change');
  await page.waitForTimeout(1200);
  const uchita = await hiNoJi(page);

  const page2 = await page.context().newPage();
  page2.on('pageerror', (e) => err.push(e.message));
  await openKyuryo(page2, tebiki(6));
  const hajime = await hiNoJi(page2);

  const page3 = await page.context().newPage();
  await openKyuryo(page3, (f) => {
    const g = tebiki(6)(f);
    g.manualDays = g.manualDays.map((m) =>
      m.expenses ? Object.assign({}, m, { expenses: {} }) : m
    );
    return g;
  });
  const hikanai = await hiNoJi(page3);
  // eslint-disable-next-line no-console
  console.log(
    '★' +
      HI +
      ' ' +
      DEV +
      '★ 同じ=' +
      (uchita === hajime) +
      ' 足した実費で変わる=' +
      (hajime !== hikanai)
  );
  expect(hajime, '★足した 実費で 給料が 変わらない（試験が 空振り）★').not.toBe(hikanai);
  expect(uchita, '★打った 後に 足した 実費が 消えた★').toBe(hajime);
  expect(err).toEqual([]);
});
