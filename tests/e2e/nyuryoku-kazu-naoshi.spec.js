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
  await K.utsu(kz(c2, S2, 'actual_total_m_naoshi'), '15.2');
  await K.machi(page);
  let F2 = await page.evaluate(() => window.__F);
  let e = F2.edits.find((x) => x.shift_id === S2);
  expect(e.trip_count_naoshi).toBe(3);
  expect(e.actual_total_m_naoshi).toBe(15200);
  expect('total_distance_m_naoshi' in e, '★触って いない 列まで 送った★').toBe(false);
  expect('hours' in e || 'uriage_yen' in e, '★他の 列を 送った★').toBe(false);

  // 空に すると メーターに 戻す（null）
  await K.utsu(kz(c2, S2, 'trip_count_naoshi'), '');
  await K.machi(page);
  F2 = await page.evaluate(() => window.__F);
  e = F2.edits.find((x) => x.shift_id === S2);
  expect(e.trip_count_naoshi).toBeNull();
  expect(e.actual_total_m_naoshi).toBe(15200);
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
  await expect(page.locator('body')).toContainText(
    '距離は 0以上の km の 数（小数は 1桁まで）で 入れてください'
  );
});

// ★⑤ 距離は 小数 1桁まで★ 2026-10-25（欄に 出す 細かさと 揃える＝打った 数と 出る 数が ずれない）
//   わざと壊す：yomuKazu の 距離の 形を (\.\d+)? に 戻す ⇒ ★赤★（15.25 を 送った）
test('★⑤ 距離の 小数 2桁は 送らず 字で 知らせる★', async ({ page }) => {
  await K.nyuryokuWoHiraku(page, zairyou(), HI);
  const c2 = await K.akeru(page, K.CAR2);
  await K.utsu(kz(c2, S2, 'actual_total_m_naoshi'), '15.25');
  await K.machi(page);
  const calls = await page.evaluate(() =>
    window.__calls.filter((x) => String(x.p).indexOf('dk_shift_edits') === 0)
  );
  expect(calls.length, '★小数 2桁を 送った★').toBe(0);
  await expect(page.locator('body')).toContainText(
    '距離は 0以上の km の 数（小数は 1桁まで）で 入れてください'
  );
});

// ★⑥ メーターの 3倍を 超える 数も 止めずに 入れ、欄の 下に 注意を 出す★ 2026-10-25（司さん「全て最適解でやれ」）
//   メーター 12.3km の 3倍を 超える 50km。注意は 保存の 失敗の 赤い 箱（#err）に 出さない
//   わざと壊す：kazuHintHtml の 注意（kazuChuui）を 外す ⇒ ★赤★（注意が 出ない）
const okuttaKazu = (page) =>
  page.evaluate(
    () => window.__calls.filter((x) => String(x.p).indexOf('dk_shift_edits') === 0).length
  );
const chuui = (c) => c.locator('.kazu-chuui');
test('★⑥ メーターの 3倍を 超える 数は すぐ 入り、欄の 下に 注意が 出る・直すと 消える★', async ({
  page,
}) => {
  await K.nyuryokuWoHiraku(page, zairyou(), HI);
  const c2 = await K.akeru(page, K.CAR2);
  const ran = kz(c2, S2, 'actual_total_m_naoshi');
  await K.utsu(ran, '50');
  await K.machi(page);
  expect(await okuttaKazu(page), '★止めた（入らなかった）★').toBe(1);
  const F2 = await page.evaluate(() => window.__F);
  expect(F2.edits.find((x) => x.shift_id === S2).actual_total_m_naoshi).toBe(50000);
  await expect(chuui(c2)).toHaveCount(1);
  await expect(chuui(c2)).toContainText('50km は メーター（12.3km）の 3倍を 超えています');
  await expect(page.locator('#err'), '★保存の 失敗の 箱に 出した★').not.toContainText('50km');
  // メーターの 3倍 以内（30km）に 直すと 注意は 消える
  await K.utsu(ran, '30');
  await K.machi(page);
  expect(await okuttaKazu(page)).toBe(2);
  await expect(chuui(c2)).toHaveCount(0);
});

// ★⑦ 打って すぐ 日を 変えても 数は 入り、戻ると 注意が 出たまま（入っている 数から 描く）★（対立役 2回目 止-A）
//   わざと壊す：kazuMeterHtml で kazuHintHtml に v を 渡さない ⇒ ★赤★（戻った 時に 注意が 出ない）
test('★⑦ 打って すぐ 日を 変えても 入り、戻ると 注意が 残っている★', async ({ page }) => {
  await K.nyuryokuWoHiraku(page, zairyou(), HI);
  const c2 = await K.akeru(page, K.CAR2);
  const ran = kz(c2, S2, 'actual_total_m_naoshi');
  await ran.fill('50');
  await page.click('#nextD'); // 欄を 離れる＝change が 走り、そのまま 日を 変える
  await K.machi(page);
  expect(await okuttaKazu(page), '★日を 変えたら 打った 数が 消えた★').toBe(1);
  await page.click('#prevD');
  await page.waitForFunction(() => !document.getElementById('tomeJi'));
  const c2b = await K.akeru(page, K.CAR2);
  await expect(kz(c2b, S2, 'actual_total_m_naoshi')).toHaveValue('50');
  await expect(chuui(c2b)).toHaveCount(1);
});

// ★⑧ 読めない 字の 赤い 字は 正しい 数を 打てば 消える★（対立役 2回目 止-B の 仲間）
//   わざと壊す：saveKazuRan の 保存の 後の hozonDekita(…:katachi) を 外す ⇒ ★赤★（赤い 字が 残る）
test('★⑧ 読めない 字の 後に 正しい 数を 打つと 赤い 字が 消える★', async ({ page }) => {
  await K.nyuryokuWoHiraku(page, zairyou(), HI);
  const c2 = await K.akeru(page, K.CAR2);
  const ran = kz(c2, S2, 'actual_total_m_naoshi');
  await K.utsu(ran, 'abc');
  await K.machi(page);
  await expect(page.locator('#err')).toContainText(
    '距離は 0以上の km の 数（小数は 1桁まで）で 入れてください'
  );
  await K.utsu(ran, '50');
  await K.machi(page);
  await expect(page.locator('#err')).not.toContainText(
    '距離は 0以上の km の 数（小数は 1桁まで）で 入れてください'
  );
  expect(await okuttaKazu(page)).toBe(1);
});

// ★⑨ メーターが 0 の 業務は 1回の 目安（300km）で 注意（「メーター（0km）の 3倍」と 出さない）★（対立役 3回目 任-2）
//   わざと壊す：kazuChuui の 比べる 相手の 分け（hikaku）を いつも true に ⇒ ★赤★（「メーター（0km）」が 出る）
test('★⑨ メーターが 0 の 業務は 300km を 超えると「1回の 目安」の 注意★', async ({ page }) => {
  const F = K.zairyou((G) => {
    const s = G.shifts.find((x) => x.shift_id === S2);
    s.actual_total_m = 0;
  });
  await K.nyuryokuWoHiraku(page, F, HI);
  const c2 = await K.akeru(page, K.CAR2);
  const ran = kz(c2, S2, 'actual_total_m_naoshi');
  await K.utsu(ran, '250');
  await K.machi(page);
  await expect(chuui(c2)).toHaveCount(0);
  await K.utsu(ran, '301');
  await K.machi(page);
  await expect(chuui(c2)).toContainText('301km は 1回の 目安（300km）を 超えています');
  await expect(chuui(c2)).not.toContainText('メーター（0km）');
});

// ★⑩ 列が 在るかを 通信で 確かめられない 時は 欄を 黙って 消さず 訳を 出す★（2026-10-25 対立役 任4）
//   わざと壊す：kazuMeterHtml の KAZU_YOMENAI の 訳を 外す ⇒ ★赤★（何も 出ない）
test('★⑩ 直しの 列を 通信で 読めない 時は 「読めませんでした」を 出す★', async ({ page }) => {
  await K.nyuryokuWoHiraku(page, zairyou(), HI, {
    yomiDame: ['dk_shift_edits?select=trip_count_naoshi'],
  });
  const c2 = await K.akeru(page, K.CAR2);
  await expect(c2.locator('input[data-kazu-sid]')).toHaveCount(0);
  await expect(c2.locator('.kazu-yomenai')).toContainText('直しを 読めませんでした（通信）');
});

// ★⑪ 通信が 切れて 投げた 時も「読めませんでした」・列が 無い（400）線では 何も 出さない★（対立役 任1）
//   わざと壊す：問い合わせの catch を「return 'nai'」に ⇒ ★赤★（投げた 時に 黙る）／400 の 分けを 外す ⇒ ★赤★（列が 無い 線で 毎日 赤い 字）
for (const [na, st, deru] of [
  ['通信が 切れて 投げた', 'throw', true],
  ['列が 無い 線（400）', 400, false],
]) {
  test('★⑪ ' + na + ' 時の 直しの 欄★', async ({ page }) => {
    await K.nyuryokuWoHiraku(page, zairyou(), HI, {
      yomiDame: ['dk_shift_edits?select=trip_count_naoshi'],
      yomiSt: st,
    });
    const c2 = await K.akeru(page, K.CAR2);
    await expect(c2.locator('input[data-kazu-sid]')).toHaveCount(0);
    await expect(c2.locator('.kazu-yomenai')).toHaveCount(deru ? 1 : 0);
  });
}
