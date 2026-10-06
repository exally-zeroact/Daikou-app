// ============================================================
// ★★見張り：給料の設定「ほかの払い方」＝打って 保存すると 倉庫に 入り 明細の 額が 変わる★★ 2026-10-06
//
//   司さん「この給料の決め方やったら対応できんやつもあることないか？」→「対応できるように対立でやれ」
//   ★押す物の一覧（先に書く）★ 1. 給料の設定 2. ほかの払い方 を 開く 3. 1回 いくら に 300 4. 保存する 5. 明細
//
//   ★★わざと壊して 赤に なるのを 見た（2026-10-06 実測）★★
//     保存の 中身から pay_extra を 外す ⇒ ★赤★（倉庫に 入らない）
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

async function goukei(page) {
  await page.locator('.tab[data-tab="slip"]').click();
  await page.waitForTimeout(800);
  // ★明細の 紙に 出る「合計 ¥◯」を 全員ぶん 足す★（画面の 明細は PDF と 同じ 紙）
  return page.evaluate(() => {
    const t = (document.getElementById('slips') || document.body).textContent;
    // ★円は 3桁 区切りまで★（後ろの 時間「7.75」を 円に くっつけて 読まない）
    const m = [...t.matchAll(/合計\s*¥\s*(\d{1,3}(?:,\d{3})*)/g)];
    return m.map((x) => Number(x[1].replace(/,/g, ''))).reduce((a, b) => a + b, 0);
  });
}

test('★ほかの払い方：1回 いくら を 打って 保存 ⇒ 倉庫に 入り 明細の 額が 増える★', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await openKyuryo(page);
  await page.waitForTimeout(1500);
  const mae = await goukei(page);

  await page.locator('.tab[data-tab="set"]').click();
  await page.waitForTimeout(500);
  await expect(page.locator('#hokaHarai'), '★「ほかの払い方」が 無い★').toHaveCount(1);
  await expect(page.locator('#hokaHarai'), '★畳まれていない★').not.toHaveAttribute('open', '');
  await page.locator('#hokaHarai > summary').click();
  const kaisu = page.locator('#hokaBody [data-hk="kaisu"]');
  expect(await kaisu.count(), '★役割ごとの「1回 いくら」が 無い★').toBeGreaterThan(0);

  await page.evaluate(() => {
    window.__okutta = [];
    const S = window.DKSession;
    const moto = S.rest;
    S.rest = function (s, p, o) {
      if (o && o.method) window.__okutta.push({ p: p, body: o.body });
      return moto.apply(this, arguments);
    };
  });
  await kaisu.first().fill('300');
  await kaisu.first().dispatchEvent('change');
  await page.locator('#btnSaveSet').click();
  await page.waitForTimeout(800);
  const okutta = await page.evaluate(() => window.__okutta);
  const set = okutta.filter((x) => String(x.p).indexOf('dk_payroll_settings') === 0);
  expect(set.length, '★保存を 押しても 給料の設定を 送っていない★').toBeGreaterThan(0);
  const b = JSON.parse(set[set.length - 1].body);
  // eslint-disable-next-line no-console
  console.log('★送った pay_extra★ ' + JSON.stringify(b.pay_extra));
  // ★1回 いくら は 会社で 1つ（1台 あたり）★ 司さん 10-06「回数距離は1台としてやろが」
  expect(b.pay_extra && b.pay_extra.kaisu, '★1回 300 円（1台 あたり）が 入っていない★').toBe(300);
  expect(b.roles, '★役割の 歩合・保証が 消えた★').toBeTruthy();
  expect(mae, '★明細の 合計が 読めていない★').toBeGreaterThan(0);
  expect(err, '★画面が 落ちた★').toEqual([]);
});

// ★倉庫に 入った 設定で 明細の 額が 変わる★（保存の 後の 読み直しは 作り物の 倉庫では 古い 行が 返るので
//   ★入った 後の 倉庫★を 作って 開き直し、入る 前と 比べる）
test('★倉庫に 1回 いくら が 入っていると 明細の 額が 増える★', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openKyuryo(page);
  await page.waitForTimeout(1500);
  const mae = await goukei(page);
  // ★別の タブで 開く★（同じ タブで 開き直すと 前の 作り物の 倉庫が 答える）
  const page2 = await page.context().newPage();
  await page2.setViewportSize({ width: 390, height: 844 });
  await openKyuryo(page2, (f) => {
    // ★材料の 日は どれも 最低保証が 勝つ（10-06 node で 実測：歩合＋1回の 分 ＜ 保証）★
    //   ⇒「比べる 側」（既定）では 額が 変わらないのが 正しい。ここは「比べた 後で 足す」で 見る
    f.settings[0].pay_extra = { kaisu: 300, kasanAto: true };
    return f;
  });
  await page2.waitForTimeout(1500);
  const ato = await goukei(page2);
  // eslint-disable-next-line no-console
  console.log('★明細の 合計★ 前=' + mae + ' 後=' + ato);
  expect(mae, '★明細の 合計が 読めていない★').toBeGreaterThan(0);
  // ★手で 足した 答え（1台 として）★
  //   8/1：車01 3回×300＝900（甲 1人）・車02 2回×300＝600（甲 1人）
  //   8/2：車01 2回×300＝600 を 甲(30%)・乙(25%) の 比で 327.27／272.73
  //   人ごとに 丸めて 1,227＋600＋273 ＝ 2,100（前の 作り＝2人とも 全部 なら 2,700）
  expect(ato - mae, '★1台の 額が 手で 足した 2,100 円と 違う（2倍に なっていないか）★').toBe(2100);
  // ★明細の 紙に 内わけ（うち 1回・1km の 分）が 出る★ 2026-10-06
  const ji = await page2.evaluate(() => (document.getElementById('slips') || {}).textContent || '');
  expect(ji, '★紙に「1回・1km の 分」の 内わけが 出ていない★').toContain('1回・1km の 分');
});

test('★ほかの払い方を 開かずに 保存しても 前の 設定は 消えない★', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openKyuryo(page, (f) => {
    f.settings[0].pay_extra = { kaisu: 250, wariHi: {}, kyoriShu: 'sou' };
    return f;
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.__okutta = [];
    const S = window.DKSession;
    const moto = S.rest;
    S.rest = function (s, p, o) {
      if (o && o.method) window.__okutta.push({ p: p, body: o.body });
      return moto.apply(this, arguments);
    };
  });
  await page.locator('.tab[data-tab="set"]').click();
  await page.waitForTimeout(400);
  await page.locator('#btnSaveSet').click();
  await page.waitForTimeout(800);
  const okutta = await page.evaluate(() => window.__okutta);
  const set = okutta.filter((x) => String(x.p).indexOf('dk_payroll_settings') === 0);
  const b = JSON.parse(set[set.length - 1].body);
  // eslint-disable-next-line no-console
  console.log('★開かずに 保存★ ' + JSON.stringify(b.pay_extra));
  expect(b.pay_extra && b.pay_extra.kyoriShu, '★前の 設定（全部の 距離）が 消えた★').toBe('sou');
  expect(b.pay_extra.kaisu, '★前の 設定（1回 250円・1台 あたり）が 消えた★').toBe(250);
});

// ★★夜の 割増を 画面で 決めて 保存 ⇒ 倉庫へ 時間帯・倍率・掛け方が 入る★★ 2026-10-06
//   わざと壊す（10-06 実測）：hokaYomu で yakan を 読まない ⇒ ★赤★
test('★夜の 割増：時間帯 22:00〜05:00・×1.25 を 保存すると 倉庫へ 入る★', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openKyuryo(page);
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.__okutta = [];
    const S = window.DKSession;
    const moto = S.rest;
    S.rest = function (s, p, o) {
      if (o && o.method) window.__okutta.push({ p: p, body: o.body });
      return moto.apply(this, arguments);
    };
  });
  await page.locator('.tab[data-tab="set"]').click();
  await page.locator('#hokaHarai > summary').click();
  const m = page.locator('#hokaBody [data-hk="yMult"]');
  await m.fill('1.25');
  await m.dispatchEvent('change');
  await page.locator('#hokaBody [data-hk="yMode"]').selectOption('zentai');
  await page.locator('#btnSaveSet').click();
  await page.waitForTimeout(800);
  const okutta = await page.evaluate(() => window.__okutta);
  const set = okutta.filter((x) => String(x.p).indexOf('dk_payroll_settings') === 0);
  const b = JSON.parse(set[set.length - 1].body);
  // eslint-disable-next-line no-console
  console.log('★夜の 割増★ ' + JSON.stringify(b.pay_extra && b.pay_extra.yakan));
  expect(b.pay_extra.yakan, '★夜の 割増が 入っていない★').toEqual({
    kara: '22:00',
    made: '05:00',
    mult: 1.25,
    mode: 'zentai',
  });
});
