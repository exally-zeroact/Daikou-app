// ============================================================
// ★★人ごとの 歩合・最低保証・役割の「何日から」★★ 2026-10-18（docs/nannichi-kara-hito.md）
//   司さん 10-17「その日より前は前の値」「1週間前の日付で設定したら遡って変わるようにしろよ」
//
//   ★物差し★
//     ① 記録（2日目から 最低保証 99999）⇒ 1日目の 額は 前の まま・2日目だけ 99999 以上
//     ② 記録が 読めない ⇒ 明細を 出さず 止める（列の 値で 出さない）
//     ③ 従業員：日付を 選んで 最低保証を 直す ⇒ 記録に その 日から で 足す（人の 列は 書かない）
//     ④ 従業員：日付を 空（最初から）で 直す ⇒ 人の 列に 書く（記録は 書かない）
//   わざと壊して 赤（10-18 実測）：empOn を 列の まま 返す ⇒ ① 赤／記録の 読みの 数え札を 外す ⇒ ② 赤
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

function hiNoKazu(page) {
  return page.evaluate(() => {
    const e = window.__paper.emp(0);
    return {
      id: e.employee_id,
      ari: e.cells.filter((c) => c.pay > 0).map((c) => ({ d: c.date, pay: c.pay })),
    };
  });
}

test('① 記録の 日から 後だけ 新しい 最低保証（前の 日は 前の 額）', async ({ page }) => {
  const err = [];
  page.on('pageerror', (x) => err.push(x.message));
  await openKyuryo(page);
  const moto = await hiNoKazu(page);
  expect(moto.ari.length, '★働いた 日が 2日 要る★').toBeGreaterThanOrEqual(2);
  const hi2 = moto.ari[1].d;
  const page2 = await page.context().newPage();
  page2.on('pageerror', (x) => err.push(x.message));
  await openKyuryo(page2, (f) => {
    f.rireki = [
      { rireki_id: 'r1', employee_id: moto.id, key: 'pay_floor', from_date: hi2, value: 99999 },
    ];
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

test('② 記録が 読めない ⇒ 明細を 出さずに 止める', async ({ page }) => {
  const err = [];
  page.on('pageerror', (x) => err.push(x.message));
  await openKyuryo(
    page,
    (f) => {
      f.__yomenai = ['dk_hito_rireki'];
      return f;
    },
    { matanai: true }
  );
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({
    err: (document.getElementById('err') || {}).textContent || '',
    yen: document.querySelectorAll('#slips .slip .yen, #slips .hn-kami-waku').length,
    riyuu: (window.CTX && window.CTX.yakuDameRiyuu) || '',
  }));
  // eslint-disable-next-line no-console
  console.log('★②★ ' + JSON.stringify(r));
  expect(r.err + r.riyuu, '★止めた 訳が 出ていない★').toContain('変えた 記録を 読めませんでした');
  expect(r.yen, '★読めないのに 明細が 出た★').toBe(0);
  expect(err).toEqual([]);
});

async function empWoHiraku(page, f0) {
  await openKyuryo(page, f0);
  await page.evaluate(() => {
    window.__okutta = [];
    const S = window.DKSession;
    const moto = S.rest;
    S.rest = function (s, p, o) {
      if (o && o.method && o.method !== 'GET') {
        window.__okutta.push({ p: String(p), m: o.method, b: o.body ? JSON.parse(o.body) : null });
        if (String(p).indexOf('dk_hito_rireki') === 0) {
          const b = o.body ? JSON.parse(o.body) : {};
          return Promise.resolve({
            ok: true,
            status: 201,
            json: () => Promise.resolve([Object.assign({ rireki_id: 'neo' }, b)]),
          });
        }
      }
      return moto.apply(this, arguments);
    };
  });
  await page.click('.tab[data-tab="emp"]');
  await page.waitForSelector('#empBody [data-hi]', { state: 'visible' });
}

test('③ 日付を 選んで 最低保証を 直す ⇒ その 日から の 記録に 足す（人の 列は 書かない）', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (x) => err.push(x.message));
  await empWoHiraku(page);
  const hi = await page.$eval('#empBody [data-hi]', (i) => i.value);
  expect(hi, '★既定の 日（今日の 日本時間）が 入っていない★').toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await page.fill('#empBody [data-hi]', '2026-01-15');
  await page.dispatchEvent('#empBody [data-hi]', 'change');
  const yuka = '#empBody [data-f="pay_floor"]';
  await page.fill(yuka, '1300');
  await page.press(yuka, 'Tab');
  await page.waitForTimeout(500);
  const o = await page.evaluate(() => window.__okutta);
  // eslint-disable-next-line no-console
  console.log('★③★ ' + JSON.stringify(o));
  const rk = o.filter((x) => x.p.indexOf('dk_hito_rireki') === 0);
  expect(rk.length).toBe(1);
  expect(rk[0].m).toBe('POST');
  expect(rk[0].b).toMatchObject({ key: 'pay_floor', from_date: '2026-01-15', value: 1300 });
  expect(o.filter((x) => x.p.indexOf('dk_employees') === 0).length, '★人の 列まで 書いた★').toBe(0);
  expect(err).toEqual([]);
});

test('④ 日付を 空（最初から）で 直す ⇒ 人の 列に 書く（記録は 書かない）', async ({ page }) => {
  const err = [];
  page.on('pageerror', (x) => err.push(x.message));
  await empWoHiraku(page);
  await page.fill('#empBody [data-hi]', '');
  await page.dispatchEvent('#empBody [data-hi]', 'change');
  const yuka = '#empBody [data-f="pay_floor"]';
  await page.fill(yuka, '1300');
  await page.press(yuka, 'Tab');
  await page.waitForTimeout(500);
  const o = await page.evaluate(() => window.__okutta);
  expect(o.filter((x) => x.p.indexOf('dk_hito_rireki') === 0).length).toBe(0);
  const em = o.filter((x) => x.p.indexOf('dk_employees') === 0);
  expect(em.length).toBe(1);
  expect(em[0].b.pay_floor).toBe(1300);
  expect(err).toEqual([]);
});
