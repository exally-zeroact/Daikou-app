// ============================================================
// ★★売上が 無いのに 経費を 入れたら 警告★★ 2026-10-23
//
//   司さん「売上ないのに経費があるわけなかろが。売上なしで経費いれた時に売り上げがありませんって警告しろや」
//   守る 事：
//     ①売上 0 の 手入力の 車に 経費を 打つと、経費の 欄の そばに 赤い 字・畳んだ 見出しに「売上なし」
//     ②売上を 入れると 消える（打った 時に＝保存の 返事を 待たずに）
//     ③売上の 在る 車（手入力・メーター）に 経費を 打っても 出ない
//     ④メーターの 車で 売上 0 の 回に 経費が 在れば その 回に 出る（他の 回には 出ない）
//     保存は 止めない（警告だけ）
// ============================================================
const { test, expect } = require('@playwright/test');
const K = require('./nyuryoku-souko.js');

const JI = '売上がありません。売上を入れてから経費を入れてください。';
const HI2 = '2026-08-02'; // 1号車＝メーター 1回（11,200円）・2号車＝走っていない（手入力）

function keikoku(loc) {
  return loc.locator('.keihi-keikoku:visible', { hasText: JI });
}
function shirushi(k) {
  return k.locator('.sha-atama .shirushi', { hasText: '売上なし' });
}

test('★①② 売上 0 の 手入力の 車に 経費＝警告・見出しに 印／売上を 入れると 消える★', async ({
  page,
}) => {
  await K.nyuryokuWoHiraku(page, K.zairyou(), HI2);
  const c2 = await K.akeru(page, K.CAR2);
  await expect(keikoku(c2)).toHaveCount(0);
  await expect(shirushi(c2)).toHaveCount(0);
  const toll = c2.locator('input[data-dev="' + K.CAR2 + '"][data-f="toll"]');
  // 打った 時（離れる 前）に もう 出る
  await toll.fill('800');
  await expect(keikoku(c2)).toHaveCount(1);
  await expect(shirushi(c2)).toHaveCount(1);
  await toll.blur();
  await K.machi(page);
  // 保存は 止めない（倉庫に 入る）
  const m = await page.evaluate(
    (d) => window.__F.manualDays.filter((x) => x.device_id === d && x.work_date === '2026-08-02'),
    K.CAR2
  );
  expect(m.length).toBe(1);
  expect(Number(m[0].toll_yen)).toBe(800);
  await expect(keikoku(c2)).toHaveCount(1);
  await expect(shirushi(c2)).toHaveCount(1);
  // 畳んでも 見出しの 印は 見える
  await c2.locator('.sha-atama').click();
  await expect(shirushi(c2)).toBeVisible();
  await c2.locator('.sha-atama').click();
  // 売上を 入れると 消える（打った 時に）
  const uri = c2.locator('input[data-dev="' + K.CAR2 + '"][data-f="sales_yen"]');
  await uri.fill('5000');
  await expect(keikoku(c2)).toHaveCount(0);
  await expect(shirushi(c2)).toHaveCount(0);
  await uri.blur();
  await K.machi(page);
  await expect(keikoku(c2)).toHaveCount(0);
  await expect(shirushi(c2)).toHaveCount(0);
  // 売上を 0 に 戻すと また 出る
  await K.utsu(uri, '0');
  await K.machi(page);
  await expect(keikoku(c2)).toHaveCount(1);
  await expect(shirushi(c2)).toHaveCount(1);
});

test('★① 開いた 時（倉庫に 売上 0・経費 在り）も 畳んだ 見出しに 印★', async ({ page }) => {
  const F = K.zairyou((G) => {
    G.manualDays.push({
      company_id: K.CO,
      work_date: HI2,
      device_id: K.CAR2,
      sales_yen: 0,
      hours: 0,
      toll_yen: 0,
      bridge_yen: 1200,
      other_yen: 0,
      trip_count: 0,
      note: '',
    });
  });
  await K.nyuryokuWoHiraku(page, F, HI2);
  const c2 = K.kuruma(page, K.CAR2);
  await expect(shirushi(c2)).toBeVisible();
  await K.akeru(page, K.CAR2);
  await expect(keikoku(c2)).toHaveCount(1);
  // 経費を 0 に すると 消える
  await K.utsu(c2.locator('input[data-dev="' + K.CAR2 + '"][data-f="bridge"]'), '');
  await expect(keikoku(c2)).toHaveCount(0);
  await expect(shirushi(c2)).toHaveCount(0);
});

test('★③ 売上の 在る 車に 経費を 打っても 出ない（手入力・メーター）★', async ({ page }) => {
  await K.nyuryokuWoHiraku(page, K.zairyou(), HI2);
  // 手入力：先に 売上
  const c2 = await K.akeru(page, K.CAR2);
  await K.utsu(c2.locator('input[data-dev="' + K.CAR2 + '"][data-f="sales_yen"]'), '6000');
  await K.utsu(c2.locator('input[data-dev="' + K.CAR2 + '"][data-f="toll"]'), '900');
  await K.machi(page);
  await expect(keikoku(c2)).toHaveCount(0);
  await expect(shirushi(c2)).toHaveCount(0);
  // メーター 1回（11,200円）
  const c1 = await K.akeru(page, K.CAR1);
  const toll = c1.locator('input[data-sid][data-f="toll"]');
  await K.utsu(toll, '700');
  await K.machi(page);
  await expect(keikoku(c1)).toHaveCount(0);
  await expect(shirushi(c1)).toHaveCount(0);
  // 同じ メーターの 車で 売上を 0 に 直すと 出る・空（メーターの 額）に 戻すと 消える
  const uri = c1.locator('input[data-uri-sid]').first();
  await uri.fill('0');
  await expect(keikoku(c1)).toHaveCount(1);
  await expect(shirushi(c1)).toHaveCount(1);
  await uri.blur();
  await K.machi(page);
  await expect(keikoku(c1)).toHaveCount(1);
  await K.utsu(uri, '');
  await K.machi(page);
  await expect(keikoku(c1)).toHaveCount(0);
  await expect(shirushi(c1)).toHaveCount(0);
});

test('★④ メーターの 車で 売上 0 の 回に 経費が 在れば その 回に 出る★', async ({ page }) => {
  // 8/1 の 1号車＝2回 走った（S1 9,800円・S9 1,000円）。両方の 回に 経費＝回ごとの 欄に 経費が 出る
  const F = K.zairyou((G) => {
    G.edits.push({ shift_id: K.S1, company_id: K.CO, toll_yen: 500 });
    G.edits.push({ shift_id: K.S9, company_id: K.CO, toll_yen: 300 });
  });
  await K.nyuryokuWoHiraku(page, F, '2026-08-01');
  const c1 = await K.akeru(page, K.CAR1);
  const kai9 = c1.locator('.kai[data-kai-sid="' + K.S9 + '"]');
  const kai1 = c1.locator('.kai[data-kai-sid="' + K.S1 + '"]');
  await expect(kai9.locator('input[data-sid][data-f="toll"]')).toHaveValue('300');
  await expect(keikoku(c1)).toHaveCount(0);
  // 2回目の 売上を 0 に＝その 回にだけ 出る
  const uri9 = kai9.locator('input[data-uri-sid="' + K.S9 + '"]');
  await uri9.fill('0');
  await expect(keikoku(kai9)).toHaveCount(1);
  await expect(keikoku(kai1)).toHaveCount(0);
  await expect(shirushi(c1)).toHaveCount(1);
  await uri9.blur();
  await K.machi(page);
  await expect(keikoku(kai9)).toHaveCount(1);
  await expect(keikoku(kai1)).toHaveCount(0);
  await expect(shirushi(c1)).toHaveCount(1);
  // 売上を 入れると 消える
  await K.utsu(uri9, '2000');
  await K.machi(page);
  await expect(keikoku(c1)).toHaveCount(0);
  await expect(shirushi(c1)).toHaveCount(0);
});

test('★④ 2回 走って 両方 売上 0・上の 欄に 経費＝上の 欄に 出る★', async ({ page }) => {
  const F = K.zairyou((G) => {
    // 最後の 回（S1＝18時〜）に 経費＝上の 欄に 出る（別の 回には 額が 無い）
    G.edits.push({ shift_id: K.S9, company_id: K.CO, uriage_yen: 0 });
    G.edits.push({ shift_id: K.S1, company_id: K.CO, uriage_yen: 0, bridge_yen: 400 });
  });
  await K.nyuryokuWoHiraku(page, F, '2026-08-01');
  const c1 = K.kuruma(page, K.CAR1);
  await expect(shirushi(c1)).toBeVisible();
  await K.akeru(page, K.CAR1);
  const ue = c1.locator('.ran-ue');
  await expect(keikoku(ue)).toHaveCount(1);
  await expect(keikoku(c1)).toHaveCount(1); // 回ごとの 欄には 経費の 欄が 無い＝上の 1つだけ
  // 1回目に 売上を 打つと（打った 時に）消える
  const uri1 = c1.locator('input[data-uri-sid="' + K.S9 + '"]');
  await uri1.fill('3000');
  await expect(keikoku(c1)).toHaveCount(0);
  await expect(shirushi(c1)).toHaveCount(0);
});

test('★390幅の 絵（売上なしの 警告）★', async ({ page }, ti) => {
  test.skip(!process.env.KE_E, '絵は KE_E に 置き場を 渡した 時だけ');
  await K.nyuryokuWoHiraku(page, K.zairyou(), HI2);
  const c2 = await K.akeru(page, K.CAR2);
  await K.utsu(c2.locator('input[data-dev="' + K.CAR2 + '"][data-f="toll"]'), '800');
  await K.machi(page);
  await expect(keikoku(c2)).toHaveCount(1);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sw).toBeLessThanOrEqual(390);
  // 警告の 字を 画面の 真ん中へ（下の 帯に 隠れて いない 事を 絵で 見る）
  await keikoku(c2).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await page.screenshot({
    path: require('path').join(process.env.KE_E, ti.project.name + '-keikoku.png'),
  });
  // 見出しの 印（畳んだ 形）
  await c2.locator('.sha-atama').click();
  await c2.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await page.screenshot({
    path: require('path').join(process.env.KE_E, ti.project.name + '-midashi.png'),
  });
});
