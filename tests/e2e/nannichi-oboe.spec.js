// ============================================================
// ★★「何日から」で 選んだ 日は 画面を 行き来しても その 日の うちは 残る★★ 2026-10-25
//
//   司さん「今日従業員を足して何日からってのを2026/10/1に設定したのに画面変えて入力からやるとまた2026/10/25に
//          もどってる 他の所もこうゆうのがないか確認して直せ」
//   ⇒ 人（従業員の 表）・締め（給料の 設定）・役割の 決まり の 3か所（kyuryo.html の hiOboe*）
//   ★日が 変われば 今日に 戻る★（何週間も 前の 日付が 残って 気付かずに 過去の 月を 書き換えない）
//
//   わざと壊す：hiOboeHiku が いつも null を 返す ⇒ ★赤★（開き直すと 今日に 戻る＝司さんの 形）
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

test.use({ timezoneId: 'Asia/Tokyo' });
const KYOU = new Date('2026-10-25T12:00:00+09:00');
const ASU = new Date('2026-10-26T12:00:00+09:00');

async function hiraku(page, ura, ji) {
  await page.clock.setFixedTime(ji || KYOU);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openKyuryo(page, null, { ura });
}
async function erabu(page, sel, v) {
  await page.locator(sel).fill(v);
  await page.locator(sel).dispatchEvent('change');
  await page.waitForTimeout(300);
}
async function hitoNoHi(page) {
  await page.click('.tab[data-tab="emp"]');
  const el = page.locator('#empBody [data-hi]').first();
  await el.waitFor({ state: 'visible' });
  return el;
}

test('① 人の「何日から」：10/1 を 選んで 画面を 開き直しても 10/1 の まま', async ({ page }) => {
  await hiraku(page, '?henshu=1');
  const el = await hitoNoHi(page);
  expect(await el.inputValue()).toBe('2026-10-25');
  const id = await el.getAttribute('data-hi');
  await erabu(page, '#empBody [data-hi="' + id + '"]', '2026-10-01');
  // 別の 画面へ 行って 戻る（同じ 端末・同じ 日）
  await page.goto('about:blank');
  await hiraku(page, '?henshu=1');
  await hitoNoHi(page);
  await expect(page.locator('#empBody [data-hi="' + id + '"]')).toHaveValue('2026-10-01');
});

test('② 給料の 締めの「何日から」：空（最初から）を 選んで 開き直しても 空の まま', async ({
  page,
}) => {
  await hiraku(page, '?henshu=1#set');
  await page.waitForSelector('#pHi', { state: 'visible' });
  expect(await page.inputValue('#pHi')).toBe('2026-10-25');
  await erabu(page, '#pHi', '');
  await page.goto('about:blank');
  await hiraku(page, '?henshu=1#set');
  await page.waitForSelector('#pHi', { state: 'visible' });
  await expect(page.locator('#pHi')).toHaveValue('');
});

test('③ 役割の 決まりの「何日から」：10/1 を 選んで 開き直しても 10/1 の まま', async ({
  page,
}) => {
  await hiraku(page, '?henshu=1#set');
  const el = page.locator('#roleBody [data-yh]').first();
  await el.waitFor({ state: 'visible' });
  const r = await el.getAttribute('data-yh');
  await erabu(page, '#roleBody [data-yh="' + r + '"]', '2026-10-01');
  await page.goto('about:blank');
  await hiraku(page, '?henshu=1#set');
  const el2 = page.locator('#roleBody [data-yh="' + r + '"]');
  await el2.waitFor({ state: 'visible' });
  await expect(el2).toHaveValue('2026-10-01');
});

// ★次の 日は 今日に 戻す★（古い 日付を 残して 過去の 月を 黙って 書き換えない）
//   わざと壊す：hiOboeYomu の「o.kyou === kyouJst()」の 比べを 外す ⇒ ★赤★（次の 日も 10/1）
test('④ 次の 日に 開くと 今日（10/26）に 戻る', async ({ page }) => {
  await hiraku(page, '?henshu=1');
  const el = await hitoNoHi(page);
  const id = await el.getAttribute('data-hi');
  await erabu(page, '#empBody [data-hi="' + id + '"]', '2026-10-01');
  await page.goto('about:blank');
  await hiraku(page, '?henshu=1', ASU);
  await hitoNoHi(page);
  await expect(page.locator('#empBody [data-hi="' + id + '"]')).toHaveValue('2026-10-26');
});

// ★会社ごとに 分ける★（別の 会社を 開くと その 会社の 覚え＝無ければ 今日）
//   わざと壊す：hiOboeKagi から 会社を 外す ⇒ ★赤★（別の 会社でも 10/1）
test('⑤ 別の 会社を 開くと 前の 会社で 選んだ 日は 出ない', async ({ page }) => {
  await hiraku(page, '?henshu=1');
  const el = await hitoNoHi(page);
  const id = await el.getAttribute('data-hi');
  await erabu(page, '#empBody [data-hi="' + id + '"]', '2026-10-01');
  await page.goto('about:blank');
  await page.clock.setFixedTime(KYOU);
  await openKyuryo(
    page,
    (f) => {
      const betsu = '00000000-0000-4000-8000-0000000000bb';
      (f.settings || []).forEach((s) => (s.company_id = betsu));
      (f.emps || []).forEach((e) => (e.company_id = betsu));
      return f;
    },
    { ura: '?henshu=1' }
  );
  await hitoNoHi(page);
  await expect(page.locator('#empBody [data-hi="' + id + '"]')).toHaveValue('2026-10-25');
});

// ★別の 窓が 後から 覚えを 書いても、この 窓は 画面の 日（最初に 描いた 日）で 保存する★（対立役 本番前 S1）
//   窓 B を 先に 開く（10/25）→ 窓 A で 10/1 を 選ぶ → 窓 B で 歩合を 直す ⇒ 記録は 10/25 から（10/1 から 書くと 過去が 黙って 変わる）
//   わざと壊す：empHi の「EMP_HI[id] = …」の 固定を 外す ⇒ ★赤★（from_date が 10/1）
test('⑥ 2つの 窓：もう 一方の 窓で 選んだ 日で 黙って 保存しない', async ({ page }) => {
  const B = await page.context().newPage();
  await hiraku(B, '?henshu=1');
  const elB = await hitoNoHi(B);
  const id = await elB.getAttribute('data-hi');
  await expect(elB).toHaveValue('2026-10-25');
  await hiraku(page, '?henshu=1');
  await hitoNoHi(page);
  await erabu(page, '#empBody [data-hi="' + id + '"]', '2026-10-01');
  // 窓 B の 保存を 控える
  await B.evaluate(() => {
    window.__okutta = [];
    const S = window.DKSession;
    const moto = S.rest;
    S.rest = function (s, p, o) {
      if (o && o.method === 'POST' && String(p).indexOf('dk_hito_rireki') === 0) {
        const b = o.body ? JSON.parse(o.body) : {};
        window.__okutta.push(b);
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve([Object.assign({ rireki_id: 'rk-b' }, b)]),
        });
      }
      return moto.apply(this, arguments);
    };
  });
  const ran = B.locator('#empBody [data-emp="' + id + '"][data-f="pay_rate"]');
  await ran.fill('0.55');
  await ran.press('Tab');
  await expect.poll(() => B.evaluate(() => window.__okutta.length)).toBe(1);
  const b = await B.evaluate(() => window.__okutta[0]);
  expect(b.key).toBe('pay_rate');
  expect(b.from_date, '★画面に 出ていない 日（別の 窓の 10/1）から 書いた★').toBe('2026-10-25');
  await expect(B.locator('#empBody [data-hi="' + id + '"]')).toHaveValue('2026-10-25');
  await B.close();
});

// ★開いた ままの 窓で 日が 変わったら、保存せず「何日から」を 今日に 戻して 知らせる★（対立役 本番前 2回目 S2）
//   10/25 に 開く → 時計を 10/27 に → 直す ⇒ 送らない・欄は 10/27・訳が 出る（10/25 から 黙って 書くと 過去の 明細が 変わる）
//   わざと壊す：hiHiGawari の 日の 比べを 外す（いつも false）⇒ ★赤★（10/25 から 書いた）
const HIGAWARI_JI = '日付が 変わったので 保存を 止めました';
const ASATTE = new Date('2026-10-27T12:00:00+09:00');
async function okuriWoHikaeru(page) {
  await page.evaluate(() => {
    window.__okutta = [];
    const S = window.DKSession;
    const moto = S.rest;
    S.rest = function (s, p, o) {
      if (o && o.method && o.method !== 'GET') {
        const b = o.body ? JSON.parse(o.body) : {};
        window.__okutta.push({ p: String(p), b: b });
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve([Object.assign({ rireki_id: 'rk-x' }, b)]),
        });
      }
      return moto.apply(this, arguments);
    };
  });
}
test('⑦ 人：開いた ままで 日が 変わったら 送らずに 今日へ 戻す', async ({ page }) => {
  await hiraku(page, '?henshu=1');
  const el = await hitoNoHi(page);
  const id = await el.getAttribute('data-hi');
  await expect(el).toHaveValue('2026-10-25');
  await okuriWoHikaeru(page);
  await page.clock.setFixedTime(ASATTE);
  const ran = page.locator('#empBody [data-emp="' + id + '"][data-f="pay_rate"]');
  await ran.fill('0.55');
  await ran.press('Tab');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__okutta.length), '★古い 日から 送った★').toBe(0);
  await expect(page.locator('#err')).toContainText(HIGAWARI_JI);
  await expect(page.locator('#empBody [data-hi="' + id + '"]')).toHaveValue('2026-10-27');
});
test('⑧ 給料の 締め：開いた ままで 日が 変わったら 保存せずに 今日へ 戻す', async ({ page }) => {
  await hiraku(page, '?henshu=1#set');
  await page.waitForSelector('#pHi', { state: 'visible' });
  await expect(page.locator('#pHi')).toHaveValue('2026-10-25');
  await okuriWoHikaeru(page);
  await page.clock.setFixedTime(ASATTE);
  await page.click('#btnSaveSet');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__okutta.length), '★古い 日で 保存した★').toBe(0);
  await expect(page.locator('#err')).toContainText(HIGAWARI_JI);
  await expect(page.locator('#pHi')).toHaveValue('2026-10-27');
});
test('⑨ 役割の 決まり：開いた ままで 日が 変わったら 送らずに 今日へ 戻す', async ({ page }) => {
  await hiraku(page, '?henshu=1#set');
  const yh = page.locator('#roleBody [data-yh]').first();
  await yh.waitFor({ state: 'visible' });
  const r = await yh.getAttribute('data-yh');
  await expect(yh).toHaveValue('2026-10-25');
  await okuriWoHikaeru(page);
  await page.clock.setFixedTime(ASATTE);
  const fl = page.locator('#roleBody [data-role="' + r + '"][data-f="floor"]');
  await fl.fill('1234');
  await fl.press('Tab');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__okutta.length), '★古い 日から 送った★').toBe(0);
  await expect(page.locator('#err')).toContainText(HIGAWARI_JI);
  await expect(page.locator('#roleBody [data-yh="' + r + '"]')).toHaveValue('2026-10-27');
});

// ★日が 変わった 後、保存より 先に 別の 読み出しが 走っても、選んだ 日を 黙って 今日に 替えて 保存しない★（対立役 本番前 3回目 S4）
//   選ぶ（10/1）→ 日が 10/27 に → 別の 欄を 触る（読み出しが 走る）→ 直す ⇒ 送らない・訳が 出る
//   前は 読み出しが 日の 変わりを 使い切って、保存の 前の 守りが「変わって いない」と 見て 10/27 から 書いた
//   わざと壊す：hiHiGawariTomeru の HI_GAWARI_MADA を 見ない（hiHiGawari() の 返りだけ 見る）⇒ ★赤★（10/27 から 送った）
async function shimeNoRanWoSawaru(page) {
  await page.locator('#pNazuke').dispatchEvent('input'); // kikanDashiwake → shimeHi（読み出し）
  await page.waitForTimeout(200);
}
test('⑩ 人：選んだ 後に 日が 変わり 別の 画面を 描いても、今日から 黙って 送らない', async ({
  page,
}) => {
  await hiraku(page, '?henshu=1');
  const el = await hitoNoHi(page);
  const id = await el.getAttribute('data-hi');
  await erabu(page, '#empBody [data-hi="' + id + '"]', '2026-10-01');
  await okuriWoHikaeru(page);
  await page.clock.setFixedTime(ASATTE);
  await page.click('.tab[data-tab="set"]');
  await page.waitForSelector('#pHi', { state: 'visible' });
  await shimeNoRanWoSawaru(page);
  await hitoNoHi(page);
  const ran = page.locator('#empBody [data-emp="' + id + '"][data-f="pay_rate"]');
  await ran.fill('0.55');
  await ran.press('Tab');
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(() => window.__okutta.length),
    '★選んだ 10/1 を 黙って 今日に 替えて 送った★'
  ).toBe(0);
  await expect(page.locator('#err')).toContainText(HIGAWARI_JI);
});
test('⑪ 役割：選んだ 後に 日が 変わり 締めの 欄を 触っても、今日から 黙って 送らない', async ({
  page,
}) => {
  await hiraku(page, '?henshu=1#set');
  const yh = page.locator('#roleBody [data-yh]').first();
  await yh.waitFor({ state: 'visible' });
  const r = await yh.getAttribute('data-yh');
  await erabu(page, '#roleBody [data-yh="' + r + '"]', '2026-10-01');
  await okuriWoHikaeru(page);
  await page.clock.setFixedTime(ASATTE);
  await shimeNoRanWoSawaru(page);
  const fl = page.locator('#roleBody [data-role="' + r + '"][data-f="floor"]');
  await fl.fill('1234');
  await fl.press('Tab');
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(() => window.__okutta.length),
    '★選んだ 10/1 を 黙って 今日に 替えて 送った★'
  ).toBe(0);
  await expect(page.locator('#err')).toContainText(HIGAWARI_JI);
});
test('⑫ 給料の 締め：選んだ 後に 日が 変わり 欄を 触っても、今日で 黙って 保存しない', async ({
  page,
}) => {
  await hiraku(page, '?henshu=1#set');
  await page.waitForSelector('#pHi', { state: 'visible' });
  await erabu(page, '#pHi', '2026-10-01');
  await okuriWoHikaeru(page);
  await page.clock.setFixedTime(ASATTE);
  await shimeNoRanWoSawaru(page);
  await page.click('#btnSaveSet');
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(() => window.__okutta.length),
    '★選んだ 10/1 を 黙って 今日に 替えて 保存した★'
  ).toBe(0);
  await expect(page.locator('#err')).toContainText(HIGAWARI_JI);
});

// ★止めるのは 日の 変わり 1回に つき 1回だけ★（2回目は 画面の 日＝今日で 書く・止めっぱなしに しない・対立役 4回目 任1）
//   わざと壊す：hiHiGawariTomeru で HI_GAWARI_MADA を 下ろさない ⇒ ★赤★（2回目も 送らない）
test('⑬ 人：止めた 後に もう一度 直すと 今日の 日で 1回 送る', async ({ page }) => {
  await hiraku(page, '?henshu=1');
  const el = await hitoNoHi(page);
  const id = await el.getAttribute('data-hi');
  await okuriWoHikaeru(page);
  await page.clock.setFixedTime(ASATTE);
  const ran = page.locator('#empBody [data-emp="' + id + '"][data-f="pay_rate"]');
  await ran.fill('0.55');
  await ran.press('Tab');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__okutta.length)).toBe(0);
  await expect(page.locator('#err')).toContainText(HIGAWARI_JI);
  const ran2 = page.locator('#empBody [data-emp="' + id + '"][data-f="pay_rate"]');
  await ran2.fill('0.56');
  await ran2.press('Tab');
  await expect
    .poll(() => page.evaluate(() => window.__okutta.length), { message: '★止めっぱなし★' })
    .toBe(1);
  const b = await page.evaluate(() => window.__okutta[0].b);
  expect(b.from_date).toBe('2026-10-27');
});
