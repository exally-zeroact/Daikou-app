// ============================================================
// ★★役割の 決まり（歩合・最低保証）の「何日から」★★ 2026-10-18（docs/nannichi-kara-yaku.md）
//   司さん 10-17「その日より前は前の値」「1週間前の日付で設定したら遡って変わるようにしろよ」
//
//   ★物差し★
//     ① 記録（2日目から 甲の 最低保証 99999）⇒ 1日目の 額は 前の まま・2日目だけ 99999 以上
//     ② 記録が 読めない ⇒ 明細を 出さず 止める
//     ③ 設定：日付を 選んで 最低保証を 直す ⇒ dk_yaku_rireki に その 日から で 足す（設定は 書かない）
//     ④ 設定：日付を 空（最初から）で 直して 保存 ⇒ 設定の 列に 書く（記録は 書かない）
//     ⑤ 欄が 記録の 値を 出した まま 別の 欄を 直して 保存 ⇒ 列は 元の 値の まま（対立役 2回目 直1）
//     ⑥ 空・全角・負の 数は 書かない（対立役 2回目 止2）
//     ⑦ 決まりに 無い 役割の 記録が 残っている ⇒ 明細を 止め、設定に 出して 消せる（対立役 2回目 止1）
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

const KOU = (f) => {
  f.emps = (f.emps || []).map((e) =>
    Object.assign({}, e, { role: '甲', pay_rate: null, pay_floor: null })
  );
  return f;
};

function hiNoKazu(page) {
  return page.evaluate(() => {
    const e = window.__paper.emp(0);
    return { ari: e.cells.filter((c) => c.pay > 0).map((c) => ({ d: c.date, pay: c.pay })) };
  });
}

test('① 記録の 日から 後だけ 新しい 最低保証（前の 日は 前の 額）', async ({ page }) => {
  const err = [];
  page.on('pageerror', (x) => err.push(x.message));
  await openKyuryo(page, KOU);
  const moto = await hiNoKazu(page);
  expect(moto.ari.length, '★働いた 日が 2日 要る★').toBeGreaterThanOrEqual(2);
  const hi2 = moto.ari[1].d;
  const page2 = await page.context().newPage();
  page2.on('pageerror', (x) => err.push(x.message));
  await openKyuryo(page2, (f) => {
    KOU(f);
    f.yakuRireki = [{ rireki_id: 'y1', yaku: '甲', key: 'floor', from_date: hi2, value: 99999 }];
    return f;
  });
  const ato = await hiNoKazu(page2);
  // eslint-disable-next-line no-console
  console.log('★①★ ' + JSON.stringify({ moto: moto.ari.slice(0, 2), ato: ato.ari.slice(0, 2) }));
  expect(ato.ari[0].pay, '★記録の 日より 前の 額が 変わった★').toBe(moto.ari[0].pay);
  expect(ato.ari[1].pay, '★記録の 日から 新しい 最低保証が 効いていない★').toBeGreaterThanOrEqual(
    99999
  );
  expect(err).toEqual([]);
});

async function tomatta(page) {
  await page.waitForTimeout(2500);
  return page.evaluate(() => ({
    err: (document.getElementById('err') || {}).textContent || '',
    yen: document.querySelectorAll('#slips .slip .yen, #slips .hn-kami-waku').length,
    riyuu: document.body.innerText,
  }));
}

test('② 記録が 読めない ⇒ 明細を 出さずに 止める', async ({ page }) => {
  const err = [];
  page.on('pageerror', (x) => err.push(x.message));
  await openKyuryo(
    page,
    (f) => {
      f.__yomenai = ['dk_yaku_rireki'];
      return f;
    },
    { matanai: true }
  );
  const r = await tomatta(page);
  // eslint-disable-next-line no-console
  console.log('★②★ ' + JSON.stringify(r));
  expect(r.err + r.riyuu, '★止めた 訳が 出ていない★').toContain(
    '役割の 決まりの 変えた 記録を 読めませんでした'
  );
  expect(r.yen, '★読めないのに 明細が 出た★').toBe(0);
  expect(err).toEqual([]);
});

async function setWoHiraku(page, f0) {
  await openKyuryo(page, f0);
  await page.evaluate(() => {
    window.__okutta = [];
    const S = window.DKSession;
    const moto = S.rest;
    S.rest = function (s, p, o) {
      if (o && o.method && o.method !== 'GET') {
        const b = o.body ? JSON.parse(o.body) : null;
        window.__okutta.push({ p: String(p), m: o.method, b: b });
        const j = [Object.assign({ rireki_id: 'neo' }, b || {})];
        return Promise.resolve({
          ok: true,
          status: 201,
          text: () => Promise.resolve(JSON.stringify(j)),
          json: () => Promise.resolve(j),
        });
      }
      return moto.apply(this, arguments);
    };
  });
  await page.click('.tab[data-tab="set"]');
  await page.waitForSelector('#roleBody [data-yh="甲"]', { state: 'visible' });
}
const okutta = (page) => page.evaluate(() => window.__okutta);
const kiroku = (o) => o.filter((x) => x.p.indexOf('dk_yaku_rireki') === 0);
const settei = (o) => o.filter((x) => x.p.indexOf('dk_payroll_settings') === 0);
const HI_IN = '#roleBody [data-yh="甲"]';
const FLOOR = '#roleBody [data-role="甲"][data-f="floor"]';

test('③ 日付を 選んで 最低保証を 直す ⇒ 記録に 足す（設定は 書かない）', async ({ page }) => {
  const err = [];
  page.on('pageerror', (x) => err.push(x.message));
  await setWoHiraku(page);
  expect(await page.$eval(HI_IN, (i) => i.value), '★既定の 日が 無い★').toMatch(
    /^\d{4}-\d{2}-\d{2}$/
  );
  await page.fill(HI_IN, '2026-01-15');
  await page.dispatchEvent(HI_IN, 'change');
  await page.fill(FLOOR, '1300');
  await page.press(FLOOR, 'Tab');
  await page.waitForTimeout(600);
  const o = await okutta(page);
  // eslint-disable-next-line no-console
  console.log('★③★ ' + JSON.stringify(o));
  expect(kiroku(o).length).toBe(1);
  expect(kiroku(o)[0].m).toBe('POST');
  expect(kiroku(o)[0].b).toMatchObject({
    yaku: '甲',
    key: 'floor',
    from_date: '2026-01-15',
    value: 1300,
  });
  expect(settei(o).length, '★設定の 列まで 書いた★').toBe(0);
  expect(err).toEqual([]);
});

test('④ 日付を 空（最初から）で 直して 保存 ⇒ 設定の 列に 書く（記録は 書かない）', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (x) => err.push(x.message));
  await setWoHiraku(page);
  await page.fill(HI_IN, '');
  await page.dispatchEvent(HI_IN, 'change');
  await page.fill(FLOOR, '1300');
  await page.press(FLOOR, 'Tab');
  await page.waitForTimeout(300);
  await page.click('#btnSaveSet');
  await page.waitForTimeout(800);
  const o = await okutta(page);
  expect(kiroku(o).length).toBe(0);
  const st = settei(o).filter((x) => x.m === 'POST');
  expect(st.length).toBe(1);
  expect(st[0].b.roles['甲'].floor).toBe(1300);
  expect(err).toEqual([]);
});

test('⑤ 欄が 記録の 値を 出した まま 別の 欄を 直して 保存 ⇒ 列は 元の 値の まま', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (x) => err.push(x.message));
  let moto = null;
  await setWoHiraku(page, (f) => {
    moto = JSON.parse(JSON.stringify(f.settings[0].roles['甲']));
    f.yakuRireki = [
      { rireki_id: 'y1', yaku: '甲', key: 'floor', from_date: '2000-01-01', value: 5000 },
    ];
    return f;
  });
  expect(await page.$eval(FLOOR, (i) => i.value), '★欄に 今日に 効く 値が 出ていない★').toBe(
    '5000'
  );
  await page.fill('#resPool', '7');
  await page.dispatchEvent('#resPool', 'change');
  await page.click('#btnSaveSet');
  await page.waitForTimeout(800);
  const st = settei(await okutta(page)).filter((x) => x.m === 'POST');
  expect(st.length).toBe(1);
  expect(st[0].b.roles['甲'], '★記録の 値が 列に 書かれた★').toEqual(moto);
  expect(err).toEqual([]);
});

test('⑥ 空・全角・負の 数は 書かない', async ({ page }) => {
  const err = [];
  page.on('pageerror', (x) => err.push(x.message));
  await setWoHiraku(page);
  for (const v of ['', '０．５', '-1']) {
    await page.fill(FLOOR, v);
    await page.press(FLOOR, 'Tab');
    await page.waitForTimeout(300);
  }
  const o = await okutta(page);
  expect(kiroku(o).length, '★数で ない 字を 書いた★').toBe(0);
  expect(settei(o).length).toBe(0);
  expect(await page.$eval('#err', (e) => e.textContent)).toContain('半角の 数');
  expect(err).toEqual([]);
});

test('⑦ 決まりに 無い 役割の 記録が 残っている ⇒ 明細を 止め、設定に 出して 消せる', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (x) => err.push(x.message));
  const F = (f) => {
    f.yakuRireki = [
      { rireki_id: 'y9', yaku: '丙', key: 'rate', from_date: '2026-01-01', value: 0.9 },
    ];
    return f;
  };
  await openKyuryo(page, F, { matanai: true });
  const r = await tomatta(page);
  // eslint-disable-next-line no-console
  console.log('★⑦★ ' + JSON.stringify(r));
  expect(r.err + r.riyuu).toContain('「丙」');
  expect(r.yen, '★残った 記録が 在るのに 明細が 出た★').toBe(0);
  const page2 = await page.context().newPage();
  page2.on('pageerror', (x) => err.push(x.message));
  await page2.goto('about:blank');
  await openKyuryo(page2, F, { matanai: true });
  await page2.waitForTimeout(2500);
  await page2.evaluate(() => {
    window.__okutta = [];
    const S = window.DKSession;
    const moto = S.rest;
    S.rest = function (s, p, o) {
      if (o && o.method && o.method !== 'GET') {
        window.__okutta.push({ p: String(p), m: o.method });
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ rireki_id: 'y9' }]),
        });
      }
      return moto.apply(this, arguments);
    };
  });
  await page2.click('.tab[data-tab="set"]');
  await page2.waitForSelector('#roleBody [data-yk-del="y9"]', { state: 'visible' });
  await page2.click('#roleBody [data-yk-del="y9"]');
  await page2.waitForTimeout(500);
  const o = await page2.evaluate(() => window.__okutta);
  expect(o).toEqual([{ p: 'dk_yaku_rireki?rireki_id=eq.y9', m: 'DELETE' }]);
  expect(err).toEqual([]);
});

// ★打っただけで 保存して いない 積立が、日付を 変えても 消えない★（対立役 3回目 直2）
//   わざと壊して 赤：日付の 欄の 手で renderRoles を renderSet に 戻す ⇒ 積立が 5 に 戻って 赤
test('⑧ 打った 積立は 日付を 変えても 消えず、その 値で 保存', async ({ page }) => {
  const err = [];
  page.on('pageerror', (x) => err.push(x.message));
  await setWoHiraku(page);
  await page.fill('#resPool', '6');
  await page.fill(HI_IN, '2026-01-15');
  await page.dispatchEvent(HI_IN, 'change');
  await page.click('#roleBody [data-yrk="甲"]');
  await page.waitForTimeout(300);
  expect(await page.$eval('#resPool', (i) => i.value), '★打った 積立が 消えた★').toBe('6');
  await page.click('#btnSaveSet');
  await page.waitForTimeout(800);
  const st = settei(await okutta(page)).filter((x) => x.m === 'POST');
  expect(st.length).toBe(1);
  expect(st[0].b.reserve_pool_rate).toBeCloseTo(0.06, 6);
  expect(err).toEqual([]);
});

// ★保存 前に 名前を 直しても 記録で 止めない（記録は 今の 名前へ 付いていく）★（対立役 3回目 直1）
test('⑨ 名前を 直して まだ 保存して いない 間も 止めず、欄は 記録の 値', async ({ page }) => {
  const err = [];
  page.on('pageerror', (x) => err.push(x.message));
  await setWoHiraku(page, (f) => {
    f.yakuRireki = [
      { rireki_id: 'y1', yaku: '甲', key: 'floor', from_date: '2000-01-01', value: 5000 },
    ];
    return f;
  });
  const na = page.locator('[data-role="甲"][data-f="name"]');
  await na.fill('丁');
  await na.press('Tab');
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({
    riyuu: document.body.innerText,
    floor: (document.querySelector('#roleBody [data-role="丁"][data-f="floor"]') || {}).value,
    kazu: (document.querySelector('#roleBody [data-yrk="丁"]') || {}).textContent,
  }));
  // eslint-disable-next-line no-console
  console.log('★⑨★ ' + JSON.stringify(r));
  expect(r.riyuu, '★名前を 直しただけで 止めた★').not.toContain('記録が 残っています');
  expect(r.floor).toBe('5000');
  expect(r.kazu).toContain('1');
  expect(err).toEqual([]);
});
