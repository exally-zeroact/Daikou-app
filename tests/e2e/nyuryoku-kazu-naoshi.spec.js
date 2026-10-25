// ============================================================
// ★★メーターの 車にも 回数・実車距離・総走行距離の 欄（メーターの 数が 自動で 入り・直せる）★★ 2026-10-25
//
//   司さん「入力のドロップダウンの中身でなぜつかさしか回数、実車距離、総走行距離がない？
//          全部の車に自動反映できるもので（修正できるように）つけろよ」
//   前は メーターの 記録が 無い 車（手で 入れる 車）だけに 欄が 在った。
//
//   合格の 判定（先に 決めた）：
//     ①1回 走った 車に 3つの 欄・薄い 字＝メーターの 数（回・km）
//     ②打つと dk_shift_edits の その 1列だけ 送る（距離は m）・空に すると null（メーターに 戻す）
//     ③2回 走った 車は 回ごとに 3つ（業務ごとの 鍵）
//     ④読めない 字は 送らず 字で 知らせる
//
//   わざと 壊した 記録は 下の 各 試験の 頭に 書く
// ============================================================
const { test, expect } = require('@playwright/test');
const K = require('./nyuryoku-souko.js');

const HI = '2026-08-01';
const S2 = '00000000-0000-4000-a000-000000000002'; // 2号車 8/1（1回）
function zairyou() {
  return K.zairyou((F) => {
    const s = F.shifts.find((x) => x.shift_id === S2);
    s.actual_total_m = 12345;
    s.total_distance_m = 30000;
  });
}
const kz = (c, sid, col) => c.locator('input[data-kazu-sid="' + sid + '"][data-kz="' + col + '"]');

// わざと壊す：shaHitotsu の 1回の 車の kazuMeterHtml を 外す ⇒ ★赤★（欄が 0）
//             nyuryoku の dk_shifts の select から 距離の 列を 外す ⇒ ★赤★（薄い 字が 0）
test('★① ② 1回 走った 車に メーターの 数・打つと その 列だけ 送る・空で メーターに 戻す★', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await K.nyuryokuWoHiraku(page, zairyou(), HI);
  const c2 = await K.akeru(page, K.CAR2);
  await expect(kz(c2, S2, 'trip_count_naoshi')).toHaveAttribute('placeholder', '2');
  await expect(kz(c2, S2, 'actual_total_m_naoshi')).toHaveAttribute('placeholder', '12.3');
  await expect(kz(c2, S2, 'total_distance_m_naoshi')).toHaveAttribute('placeholder', '30');
  await expect(kz(c2, S2, 'trip_count_naoshi')).toHaveValue('');

  await K.utsu(kz(c2, S2, 'trip_count_naoshi'), '3');
  await K.machi(page);
  await K.utsu(kz(c2, S2, 'actual_total_m_naoshi'), '15.25');
  await K.machi(page);
  let F2 = await page.evaluate(() => window.__F);
  let e = F2.edits.find((x) => x.shift_id === S2);
  expect(e.trip_count_naoshi).toBe(3);
  expect(e.actual_total_m_naoshi).toBe(15250);
  expect('total_distance_m_naoshi' in e, '★触って いない 列まで 送った★').toBe(false);
  expect('hours' in e || 'uriage_yen' in e, '★他の 列を 送った★').toBe(false);

  // 空に すると メーターに 戻す（null）
  await K.utsu(kz(c2, S2, 'trip_count_naoshi'), '');
  await K.machi(page);
  F2 = await page.evaluate(() => window.__F);
  e = F2.edits.find((x) => x.shift_id === S2);
  expect(e.trip_count_naoshi).toBeNull();
  expect(e.actual_total_m_naoshi).toBe(15250);
  expect(err, '画面の エラー').toEqual([]);
});

// わざと壊す：kaiHtml の kazuMeterHtml を 外す ⇒ ★赤★（回ごとの 欄が 0）
test('★③ 2回 走った 車は 回ごとに 3つの 欄（業務ごとの 鍵）★', async ({ page }) => {
  await K.nyuryokuWoHiraku(page, zairyou(), HI);
  const c1 = await K.akeru(page, K.CAR1);
  await expect(c1.locator('input[data-kazu-sid]')).toHaveCount(6);
  await expect(kz(c1, K.S1, 'trip_count_naoshi')).toHaveAttribute('placeholder', '3');
  await expect(kz(c1, K.S9, 'trip_count_naoshi')).toHaveAttribute('placeholder', '1');
  await K.utsu(kz(c1, K.S9, 'total_distance_m_naoshi'), '8');
  await K.machi(page);
  const F2 = await page.evaluate(() => window.__F);
  expect(
    F2.edits.find((x) => x.shift_id === K.S1),
    '1回目には 書かない'
  ).toBeUndefined();
  expect(F2.edits.find((x) => x.shift_id === K.S9).total_distance_m_naoshi).toBe(8000);
});

// わざと壊す：saveKazuRan の yomuKazu の 門を 外す ⇒ ★赤★（字を 送った）
test('★④ 読めない 字は 送らず 字で 知らせる★', async ({ page }) => {
  await K.nyuryokuWoHiraku(page, zairyou(), HI);
  const c2 = await K.akeru(page, K.CAR2);
  await K.utsu(kz(c2, S2, 'trip_count_naoshi'), '2.5');
  await K.machi(page);
  await K.utsu(kz(c2, S2, 'actual_total_m_naoshi'), '-3');
  await K.machi(page);
  const calls = await page.evaluate(() =>
    window.__calls.filter((x) => String(x.p).indexOf('dk_shift_edits') === 0)
  );
  expect(calls.length, '★読めない 字を 送った★').toBe(0);
  await expect(page.locator('body')).toContainText('回数は 0以上の 整数で 入れてください');
  await expect(page.locator('body')).toContainText('距離は 0以上の km の 数で 入れてください');
});
