// ============================================================
// ★★時数・乗った人を 入力の 画面で 入れる★★ 2026-10-23
//
//   司さん「給料の時数を入れるを入力の各車ごとに経費の下に時数、乗った人（時数を自由に今のように）して
//           給料タブは確認と従業員の設定だけにして」
//
//   合格の 判定（先に 決めた）：
//     ①入力で 乗った人と 時数を 入れて 保存 → 給料の 明細の 額が、前の 給料の「時数を入れる」で
//       同じ 入力を した 時と 同じ 額（KIJUN＝be349791a の 給料の 画面で 測った 額）
//     ②2回 走った 車で 時間が 二重に ならない（回ごとの 欄・回ごとの 鍵）
//     ③手で 入れた 車で 時数を 入れた 後に 電子決済を 打っても 時数が 0 に 戻らない
//     ④畳んだ 見出しに 入れ漏れの 印
//   守り：同じ 人を 別の 車に 押すと（会社・日・人）の 鍵で 黙って 車が 移る＝保存中は 札を 止める
//
//   わざと 壊した 記録は 下の 各 試験の 頭に 書く
// ============================================================
const { test, expect } = require('@playwright/test');
const K = require('./nyuryoku-souko.js');

const HI = '2026-08-01';
// ★前の 給料の「時数を入れる」で 同じ 入力を した 時の 額★（be349791a＋部品の 切り出しで 実測 2026-10-23）
//   入力＝1号車 1回目の 時間 8h・太郎を 1号車（時間 空）・次郎を 2号車（6.5h）
//   太郎＝8/1（8＋2回目 1）9h ＋ 8/2 9.5h／次郎 6.5h／三郎は 8/2 だけ（触らない）
const KIJUN = {
  [K.TARO]: { totalPay: 18500, totalHours: 18.5 },
  [K.JIRO]: { totalPay: 6500, totalHours: 6.5 },
  [K.SABURO]: { totalPay: 11400, totalHours: 9.5 },
};

function nashi(o) {
  const x = Object.assign({}, o);
  delete x.updated_at;
  return x;
}

test('★① 入力で 入れた 乗った人・時数 ⇒ 給料の 明細が 前の 給料の 画面と 同じ 額★', async ({
  page,
  browser,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  const F = K.zairyou();
  await K.nyuryokuWoHiraku(page, F, HI);
  // 1号車を 開いて 1回目の 時数を 8
  const c1 = await K.akeru(page, K.CAR1);
  await K.utsu(c1.locator('input[data-hours-sid="' + K.S1 + '"]'), '8');
  await K.machi(page);
  // 太郎を 1号車に（時間は 空＝車と 同じ）
  await c1.locator('[data-chip-emp="' + K.TARO + '"]').click();
  await K.machi(page);
  // 2号車を 開いて 次郎（6.5h）
  const c2 = await K.akeru(page, K.CAR2);
  await c2.locator('[data-chip-emp="' + K.JIRO + '"]').click();
  await K.machi(page);
  await K.utsu(c2.locator('input[data-wh-emp="' + K.JIRO + '"]'), '6.5');
  await K.machi(page);

  const F2 = await page.evaluate(() => window.__F);
  // 送った 行は 前の 給料の 画面と 同じ 形（同じ 表・同じ 鍵・同じ 列）
  const wh = F2.workHours.filter((w) => w.work_date === HI).map(nashi);
  expect(wh).toEqual(
    expect.arrayContaining([
      { company_id: K.CO, work_date: HI, employee_id: K.TARO, device_id: K.CAR1, hours: 0 },
      { company_id: K.CO, work_date: HI, employee_id: K.JIRO, device_id: K.CAR2, hours: 6.5 },
    ])
  );
  expect(wh.length).toBe(2);
  const ed = F2.edits.map(nashi);
  expect(ed).toEqual([{ shift_id: K.S1, company_id: K.CO, hours: 8 }]);

  // 同じ 倉庫で 給料の 画面を 開く
  const p2 = await browser.newPage();
  const gaku = await K.kyuryoNoGaku(p2, F2);
  expect(gaku).toEqual(KIJUN);
  await p2.close();
  expect(err, '画面の エラー').toEqual([]);
});

// わざと壊す（2026-10-23 実測）：nyuryoku の kaiHtml を 回ごとで なく 最後の 業務だけに 時数の 欄を 出す ⇒ ★赤★
test('★② 2回 走った 車は 回ごとに 時数・売上の 欄＝時間が 二重に ならない★', async ({
  page,
  browser,
}) => {
  const F = K.zairyou();
  await K.nyuryokuWoHiraku(page, F, HI);
  const c1 = await K.akeru(page, K.CAR1);
  // 回ごとの 欄が 2つ（業務ごとの 鍵）
  await expect(c1.locator('input[data-hours-sid]')).toHaveCount(2);
  await expect(c1.locator('input[data-uri-sid]')).toHaveCount(2);
  // 薄い 字＝その 回の メーターの 時間（9h と 1h）
  await expect(c1.locator('input[data-hours-sid="' + K.S1 + '"]')).toHaveAttribute(
    'placeholder',
    '9'
  );
  await expect(c1.locator('input[data-hours-sid="' + K.S9 + '"]')).toHaveAttribute(
    'placeholder',
    '1'
  );
  // 2回目だけ 2h に 直す
  await K.utsu(c1.locator('input[data-hours-sid="' + K.S9 + '"]'), '2');
  await K.machi(page);
  await c1.locator('[data-chip-emp="' + K.TARO + '"]').click();
  await K.machi(page);
  // 乗った人の 薄い 字＝車の 時間（9＋2＝11h。二重なら 13 や 20）
  await expect(c1.locator('input[data-wh-emp="' + K.TARO + '"]')).toHaveAttribute(
    'placeholder',
    '11'
  );
  // 2回目の 売上を 直す（回ごと）
  await K.utsu(c1.locator('input[data-uri-sid="' + K.S9 + '"]'), '1500');
  await K.machi(page);
  const F2 = await page.evaluate(() => window.__F);
  const ed = {};
  F2.edits.forEach((e) => (ed[e.shift_id] = e));
  expect(ed[K.S1], '1回目には 書かない').toBeUndefined();
  expect(ed[K.S9].hours).toBe(2);
  expect(ed[K.S9].uriage_yen).toBe(1500);
  const p2 = await browser.newPage();
  const gaku = await K.kyuryoNoGaku(p2, F2);
  // 太郎＝8/1 11h ＋ 8/2 9.5h
  expect(gaku[K.TARO].totalHours).toBe(20.5);
  await p2.close();
});

// わざと壊す（2026-10-23 実測）：jippi-hozon.js saveTebiki の hours の 枝を 消す ⇒ hours が expenses に 入り ★赤★
test('★③ 手で 入れた 車：時数を 入れた 後に 電子決済を 打っても 時数は 0 に 戻らない★', async ({
  page,
}) => {
  const F = K.zairyou();
  // 8/3 は 走った 記録が 無い 日
  await K.nyuryokuWoHiraku(page, F, '2026-08-03');
  const c2 = await K.akeru(page, K.CAR2);
  await K.utsu(c2.locator('input[data-dev="' + K.CAR2 + '"][data-f="hours"]'), '5');
  await K.machi(page);
  await K.utsu(c2.locator('input[data-dev="' + K.CAR2 + '"][data-f="denshi_yen"]'), '300');
  await K.machi(page);
  await K.utsu(c2.locator('input[data-dev="' + K.CAR2 + '"][data-f="sales_yen"]'), '8000');
  await K.machi(page);
  const F2 = await page.evaluate(() => window.__F);
  const m = F2.manualDays.filter((x) => x.work_date === '2026-08-03' && x.device_id === K.CAR2);
  expect(m.length).toBe(1);
  expect(m[0].hours, '★時数が 0 に 戻った★').toBe(5);
  expect(m[0].denshi_yen).toBe(300);
  expect(m[0].sales_yen).toBe(8000);
  expect(m[0].expenses || {}, '時数を 実費に 入れない').not.toHaveProperty('hours');
  // 送った 全部の 行が 時数を 持ち越している（同じ 写し・同じ 鍵 d:日:車）
  const okuri = await page.evaluate(() =>
    window.__calls.filter((c) => /^dk_manual_days\?on_conflict/.test(c.p)).map((c) => c.b.hours)
  );
  expect(okuri).toEqual([5, 5, 5]);
});

// わざと壊す（2026-10-23 実測）：shirushiHtml の noriNashi の 印を 出さない ⇒ ★赤★
test('★④ 畳んだ 見出しに 入れ漏れの 印（乗った人なし・売上 未入力）・自分の 車には 出さない★', async ({
  page,
}) => {
  const F = K.zairyou((G) => {
    // 8/3 に 2号車へ 次郎（時間 3h）＝売上 未入力
    G.workHours.push({
      company_id: K.CO,
      work_date: '2026-08-03',
      employee_id: K.JIRO,
      device_id: K.CAR2,
      hours: 3,
    });
  });
  await K.nyuryokuWoHiraku(page, F, HI);
  const c1 = K.kuruma(page, K.CAR1);
  const c2 = K.kuruma(page, K.CAR2);
  // 畳んだ まま
  await expect(c1).not.toHaveClass(/\baku\b/);
  await expect(c1.locator('.sha-naka')).toBeHidden();
  await expect(c1.locator('.sha-atama .shirushi')).toContainText(['乗った人なし']);
  await expect(c2.locator('.sha-atama .shirushi')).toContainText(['乗った人なし']);
  // 1号車に 太郎を 乗せると 印が 消える
  await K.akeru(page, K.CAR1);
  await c1.locator('[data-chip-emp="' + K.TARO + '"]').click();
  await K.machi(page);
  await expect(c1.locator('.sha-atama .shirushi')).toHaveCount(0);
  await expect(c2.locator('.sha-atama .shirushi')).toContainText(['乗った人なし']);

  // 自分の 車（給料の 設定の owner_device_id）には 印を 出さない
  const F3 = K.zairyou((G) => {
    G.settings[0].owner_device_id = K.CAR2;
  });
  await K.nyuryokuWoHiraku(page, F3, HI);
  await expect(K.kuruma(page, K.CAR2).locator('.sha-atama .shirushi')).toHaveCount(0);
  await expect(K.kuruma(page, K.CAR1).locator('.sha-atama .shirushi')).toContainText([
    '乗った人なし',
  ]);

  // 走っていない 日に 乗った人が 居て 売上が 無い 車＝売上 未入力
  await K.nyuryokuWoHiraku(page, F, '2026-08-03');
  await expect(K.kuruma(page, K.CAR2).locator('.sha-atama .shirushi')).toContainText([
    '売上 未入力',
  ]);
});

// わざと壊す（2026-10-23 実測）：noriTomeru を 何も しない 関数に ⇒ 2号車の 札が 押せて ★赤★
test('★⑤ 乗った人の 保存中は 札を 止める（別の 車に 黙って 移さない）★', async ({ page }) => {
  const F = K.zairyou();
  await K.nyuryokuWoHiraku(page, F, HI, { osoi: { dk_work_hours: 1500 } });
  const c1 = await K.akeru(page, K.CAR1);
  const c2 = await K.akeru(page, K.CAR2);
  await c1.locator('[data-chip-emp="' + K.TARO + '"]').click();
  // 返事を 待つ 間は 2号車の 札も 押せない
  await expect(c2.locator('[data-chip-emp="' + K.TARO + '"]')).toBeDisabled();
  await expect(c2.locator('[data-chip-emp="' + K.JIRO + '"]')).toBeDisabled();
  await page.waitForTimeout(2200);
  // 済んだら 太郎は 2号車の 札から 消え、他の 人は 押せる
  await expect(c2.locator('[data-chip-emp="' + K.TARO + '"]')).toHaveCount(0);
  await expect(c2.locator('[data-chip-emp="' + K.JIRO + '"]')).toBeEnabled();
  const F2 = await page.evaluate(() => window.__F);
  const taro = F2.workHours.filter((w) => w.work_date === HI && w.employee_id === K.TARO);
  expect(taro.map((w) => w.device_id)).toEqual([K.CAR1]);
});

test('★⑥ 1台 2人で 札を 消す・✕ で 外すと 戻る★', async ({ page }) => {
  const F = K.zairyou();
  await K.nyuryokuWoHiraku(page, F, HI);
  const c1 = await K.akeru(page, K.CAR1);
  await c1.locator('[data-chip-emp="' + K.TARO + '"]').click();
  await K.machi(page);
  await c1.locator('[data-chip-emp="' + K.JIRO + '"]').click();
  await K.machi(page);
  await expect(c1.locator('[data-chip-emp]')).toHaveCount(0);
  await expect(c1.locator('.crewrow')).toHaveCount(2);
  await c1.locator('[data-del-emp="' + K.JIRO + '"]').click();
  await K.machi(page);
  await expect(c1.locator('.crewrow')).toHaveCount(1);
  await expect(c1.locator('[data-chip-emp="' + K.JIRO + '"]')).toHaveCount(1);
  const del = await page.evaluate(() => window.__calls.filter((c) => c.m === 'DELETE'));
  expect(del.length).toBe(1);
  expect(del[0].p).toContain('dk_work_hours?company_id=eq.');
  expect(del[0].p).toContain('employee_id=eq.' + K.JIRO);
});

// わざと壊す（2026-10-23 実測）：render の WH から 車を 足す 所を 消す ⇒ 車の 無い 人が 見えず ★赤★
test('★⑦ どの 車にも 付いていない 人・記録の 無い 車の 人も 出す（給料に 入るのに 見えない 人を 作らない）★', async ({
  page,
}) => {
  const F = K.zairyou((G) => {
    G.workHours.push({
      company_id: K.CO,
      work_date: HI,
      employee_id: K.SABURO,
      device_id: '',
      hours: 4,
    });
    G.workHours.push({
      company_id: K.CO,
      work_date: HI,
      employee_id: K.JIRO,
      device_id: 'nai-kuruma',
      hours: 2,
    });
  });
  await K.nyuryokuWoHiraku(page, F, HI);
  const kara = K.kuruma(page, '');
  await expect(kara.locator('.sha-atama')).toContainText('車が 決まっていない 人');
  await expect(kara.locator('.sha-atama .shirushi')).toContainText(['車が 決まっていない']);
  await K.akeru(page, '');
  await expect(kara.locator('[data-del-emp="' + K.SABURO + '"]')).toHaveCount(1);
  const nai = K.kuruma(page, 'nai-kuruma');
  await expect(nai.locator('.sha-atama .shirushi')).toContainText(['この日の 記録なし']);
});

// わざと壊す（2026-10-23 実測）：hozonDekinai の akeru を 消す ⇒ 畳んだ まま ★赤★
test('★⑧ 保存が 失敗したら その 車を 開く（畳んだ 所で 失敗させない）★', async ({ page }) => {
  const F = K.zairyou();
  await K.nyuryokuWoHiraku(page, F, HI, {
    osoi: { dk_shift_edits: 800 },
    dame: ['dk_shift_edits'],
  });
  const c1 = await K.akeru(page, K.CAR1);
  await K.utsu(c1.locator('input[data-hours-sid="' + K.S1 + '"]'), '8');
  // 返事が 来る 前に 畳む
  await c1.locator('.sha-atama').click();
  await expect(c1).not.toHaveClass(/\baku\b/);
  await page.waitForTimeout(1300);
  await expect(c1).toHaveClass(/\baku\b/);
  await expect(page.locator('#err')).toContainText('時数を 保存できませんでした');
});

test('★⑨ 新しい 車を 足す・手入力を 消す（給料の 画面から 移した 口）★', async ({ page }) => {
  const F = K.zairyou();
  await K.nyuryokuWoHiraku(page, F, '2026-08-03');
  page.once('dialog', (d) => d.accept('3号車'));
  await page.click('#btnNewCar');
  await K.machi(page);
  const shin = page.locator('#shaList .sha.aku', { hasText: '3号車' });
  await expect(shin).toHaveCount(1);
  const lab = await page.evaluate(() =>
    window.__calls.filter((c) => /^dk_device_labels/.test(c.p)).map((c) => c.b.label)
  );
  expect(lab).toEqual(['3号車']);
  // 同じ 名前は 作らない
  page.once('dialog', (d) => d.accept('3号車'));
  await page.click('#btnNewCar');
  await expect(page.locator('#err')).toContainText('もう あります');

  // 2号車に 手で 売上を 入れてから 消す
  const c2 = await K.akeru(page, K.CAR2);
  await K.utsu(c2.locator('input[data-dev="' + K.CAR2 + '"][data-f="sales_yen"]'), '5000');
  await K.machi(page);
  // 行が できたら 消す ボタンが 出る
  page.once('dialog', (d) => d.accept());
  await c2.locator('[data-man-del="' + K.CAR2 + '"]').click();
  await K.machi(page);
  const del = await page.evaluate(() =>
    window.__calls.filter((c) => c.m === 'DELETE').map((c) => c.p)
  );
  expect(del.some((p) => /^dk_manual_days\?company_id=eq\..*device_id=eq\./.test(p))).toBe(true);
  await expect(c2.locator('[data-man-del="' + K.CAR2 + '"]')).toBeHidden();
  const F2 = await page.evaluate(() => window.__F);
  expect(
    F2.manualDays.filter((m) => m.work_date === '2026-08-03' && m.device_id === K.CAR2)
  ).toEqual([]);
});

// 2026-10-07 の 守り（kyuryo-jisuu-shirushi から 移した）：計算は 使わない 印の 業務を 飛ばして
//   同じ 日・同じ 車の 手入力 ¥7,000 を 使う＝入力の 画面も その 車を 手入力の 車と して 出す（メーターの ¥0 に しない）
test('★⑩ 使わない 印の 業務と 同じ 日・同じ 車の 手入力は 手入力の 車と して 出る★', async ({
  page,
}) => {
  const F = K.zairyou((G) => {
    G.shifts.forEach((x) => {
      if (x.shift_id === '00000000-0000-4000-a000-000000000002') {
        x.excluded = true;
        x.fare_total_yen = 0;
      }
    });
    G.manualDays.push({
      company_id: K.CO,
      work_date: HI,
      device_id: K.CAR2,
      sales_yen: 7000,
      hours: 6,
      expenses: { kabc: 500 },
    });
  });
  await K.nyuryokuWoHiraku(page, F, HI);
  const c2 = await K.akeru(page, K.CAR2);
  await expect(c2.locator('input[data-dev="' + K.CAR2 + '"][data-f="sales_yen"]')).toHaveValue(
    '7000'
  );
  await expect(c2.locator('input[data-dev="' + K.CAR2 + '"][data-f="hours"]')).toHaveValue('6');
  await expect(c2.locator('input[data-hours-sid]')).toHaveCount(0);
  // 時数を 直しても 会社が 足した 実費（expenses）は 消えない（給料の 画面の 10-20 の 守りと 同じ）
  await K.utsu(c2.locator('input[data-dev="' + K.CAR2 + '"][data-f="hours"]'), '7');
  await K.machi(page);
  const F2 = await page.evaluate(() => window.__F);
  const m = F2.manualDays.filter((x) => x.work_date === HI && x.device_id === K.CAR2)[0];
  expect(m.hours).toBe(7);
  expect(m.sales_yen).toBe(7000);
  expect(m.expenses).toEqual({ kabc: 500 });
});

// ★★⑤ 乗った人の 時数：「1,5」「1-2」「7 5」は 送らない（15・1・75 時間に しない）・「6.5」は 送る★★ 2026-10-30（対立役 任2）
//   わざと壊す：nyuryoku.html saveNori の 門の yomuKm を 外す ⇒ ★赤 1本★（1-2 が 1時間・2026-10-30 実測）
test('★⑤ 乗った人の 時数の 崩れた 字は 送らない★', async ({ page }) => {
  const F = K.zairyou();
  await K.nyuryokuWoHiraku(page, F, HI);
  const c2 = await K.akeru(page, K.CAR2);
  await c2.locator('[data-chip-emp="' + K.JIRO + '"]').click();
  await K.machi(page);
  const ran = c2.locator('input[data-wh-emp="' + K.JIRO + '"]');
  const jikan = () =>
    page.evaluate(
      (a) =>
        window.__F.workHours
          .filter((w) => w.work_date === a.hi && w.employee_id === a.emp)
          .map((w) => w.hours),
      { hi: HI, emp: K.JIRO }
    );
  const mae = await jikan();
  for (const ji of ['1,5', '1-2', '7 5']) {
    await K.utsu(ran, ji);
    await K.machi(page);
    // eslint-disable-next-line no-console
    console.log('★⑤★ ' + ji + ' ' + JSON.stringify(await jikan()));
    expect(await jikan(), '★乗った人の 時数に「' + ji + '」を 送った★').toEqual(mae);
    await expect(page.locator('#err')).toContainText('時数は');
  }
  await K.utsu(ran, '6.5');
  await K.machi(page);
  expect(await jikan(), '★「6.5」を 送っていない★').toEqual([6.5]);
});
