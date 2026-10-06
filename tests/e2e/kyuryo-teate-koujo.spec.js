// ============================================================
// ★★見張り：給料の 手当・控除＝明細の 紙に 内わけが 出て 合計が 動く・画面から 足せる★★ 2026-10-06
//
//   司さん「ア」＝手当・控除は 会社に 残る分も 動かす
//   ★押す物の一覧（先に書く）★ 1. 明細 2. その 人の「手当・控除」 3. 円を 打って「足す」
//
//   ★★わざと壊して 赤に なるのを 見た（2026-10-06 実測）★★
//     紙の 見出しの 下の 内わけ（adjGyou）を 外す ⇒ ★赤★（差引 支給 が 出ない）
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

async function goukei(page) {
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const t = (document.getElementById('slips') || document.body).textContent;
    const m = [...t.matchAll(/合計\s*¥\s*(\d{1,3}(?:,\d{3})*)/g)];
    return m.map((x) => Number(x[1].replace(/,/g, ''))).reduce((a, b) => a + b, 0);
  });
}

test('★手当 500・控除 3,000 ⇒ 紙に 内わけ・合計は −2,500★', async ({ browser }) => {
  const p1 = await browser.newPage();
  await p1.setViewportSize({ width: 390, height: 844 });
  await openKyuryo(p1);
  const mae = await goukei(p1);

  const p2 = await browser.newPage();
  await p2.setViewportSize({ width: 390, height: 844 });
  await openKyuryo(p2, (f) => {
    // ★その 月に ずらした 後の 日付と 人で 作る★（材料は 開く 前に 今の 月へ ずらされている）
    const w = f.workHours[0];
    f.adjustments = [
      {
        adj_id: 'a1',
        employee_id: w.employee_id,
        work_date: w.work_date,
        kind: 'teate',
        label: 'ガソリン代',
        yen: 500,
      },
      {
        adj_id: 'a2',
        employee_id: w.employee_id,
        work_date: w.work_date,
        kind: 'koujo',
        label: '前借り',
        yen: 3000,
      },
    ];
    return f;
  });
  const ato = await goukei(p2);
  const ji = await p2.evaluate(() => (document.getElementById('slips') || {}).textContent || '');
  // eslint-disable-next-line no-console
  console.log('★合計★ 前=' + mae + ' 後=' + ato);
  expect(mae, '★明細の 合計が 読めていない★').toBeGreaterThan(0);
  expect(ato - mae, '★手当 500・控除 3,000 で 合計が −2,500 に ならない★').toBe(-2500);
  expect(ji, '★紙に 差引 支給 が 出ていない★').toContain('差引 支給');
  expect(ji, '★手当の 名前が 出ていない★').toContain('ガソリン代');
  expect(ji, '★控除の 名前が 出ていない★').toContain('前借り');
  await p1.close();
  await p2.close();
});

test('★「手当・控除」から 足すと 倉庫へ 送る★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await openKyuryo(page);
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.__okutta = [];
    const S = window.DKSession;
    const moto = S.rest;
    S.rest = function (s, p, o) {
      if (o && o.method) window.__okutta.push({ p: p, m: o.method, body: o.body });
      return moto.apply(this, arguments);
    };
  });
  const b = page.locator('[data-meisai-adj]').first();
  await expect(b, '★「手当・控除」の ボタンが 無い★').toBeVisible();
  await b.click();
  const panel = page.locator('.adj-panel').first();
  await expect(panel).toBeVisible();
  await panel.locator('[data-adj-f="kind"]').selectOption('koujo');
  await panel.locator('[data-adj-f="label"]').fill('制服代');
  await panel.locator('[data-adj-f="yen"]').fill('2000');
  await panel.locator('[data-adj-add]').click();
  await page.waitForTimeout(800);
  const okutta = await page.evaluate(() => window.__okutta);
  const o = okutta.filter((x) => String(x.p).indexOf('dk_pay_adjustments') === 0 && x.m === 'POST');
  // eslint-disable-next-line no-console
  console.log('★送った★ ' + JSON.stringify(o.map((x) => x.body)));
  expect(o.length, '★足すを 押しても 送っていない★').toBe(1);
  const body = JSON.parse(o[0].body);
  expect(body.kind).toBe('koujo');
  expect(body.label).toBe('制服代');
  expect(body.yen).toBe(2000);
  expect(body.employee_id, '★誰の 分か 付いていない★').toBeTruthy();
  expect(body.company_id, '★会社が 付いていない★').toBeTruthy();
  expect(err, '★画面が 落ちた★').toEqual([]);
});

// ★★給料表（日ごと・個別）の 日の 合計 ＝ 期の 合計★★（対立役 10-06：日ごとに 手当・控除が 入らず 同じ 紙の 上で 合わなかった）
//   わざと壊す（10-06 実測）：kamiHito の「手当・控除も その 日の 金額に 入れる」を 外す ⇒ ★赤★
test('★給料表：手当・控除が 在っても 日の 合計 ＝ 期の 合計★', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openKyuryo(page, (f) => {
    const w = f.workHours[0];
    f.adjustments = [
      {
        adj_id: 'a1',
        employee_id: w.employee_id,
        work_date: w.work_date,
        kind: 'teate',
        label: 'ガソリン代',
        yen: 500,
      },
      {
        adj_id: 'a2',
        employee_id: w.employee_id,
        work_date: w.work_date,
        kind: 'koujo',
        label: '前借り',
        yen: 3000,
      },
    ];
    return f;
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.__hito = null;
    const moto = window.KamiHyou.kyuryoHi;
    window.KamiHyou.kyuryoHi = function (k, d) {
      window.__hito = JSON.parse(JSON.stringify(d.hito));
      return moto.apply(this, arguments);
    };
    window.KamiPdf.dasu = () => Promise.resolve({ mai: 1, size: 1 });
  });
  await page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => (d.open = true));
  });
  await page.locator('#kamiHi').click();
  await page.waitForTimeout(1500);
  const hito = await page.evaluate(() => window.__hito);
  expect(hito, '★給料表（日ごと）が 組まれなかった★').toBeTruthy();
  const zure = hito
    .map((p) => ({
      na: p.name,
      hi: Math.round((p.hi || []).reduce((a, b) => a + (b || 0), 0)),
      kikan: Math.round((p.kikan || []).reduce((a, b) => a + (b || 0), 0)),
    }))
    .filter((x) => Math.abs(x.hi - x.kikan) > 1);
  // eslint-disable-next-line no-console
  console.log('★日の 合計と 期の 合計が 違う 人★ ' + JSON.stringify(zure));
  expect(zure, '★日の 合計と 期の 合計が 合わない（手当・控除が 日に 入っていない）★').toEqual([]);
});

// ★★外した 人の 手当・控除は 知らせる★★（対立役 10-06：給料の 総額には 入るのに どの 明細にも 出ない）
//   わざと壊す（10-06 実測）：adjChui を 空に する ⇒ ★赤★
test('★外した 人に 手当・控除が 在ると 知らせが 出る★', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openKyuryo(page, (f) => {
    const w = f.workHours[0];
    f.adjustments = [
      {
        adj_id: 'z1',
        employee_id: 'kieta-hito',
        work_date: w.work_date,
        kind: 'teate',
        label: '待機',
        yen: 1200,
      },
    ];
    return f;
  });
  await page.waitForTimeout(1500);
  const ji = await page.evaluate(() => {
    const el = document.querySelector('.adj-chui');
    return el ? el.textContent : '';
  });
  // eslint-disable-next-line no-console
  console.log('★知らせ★ ' + ji);
  expect(ji, '★外した 人の 手当・控除の 知らせが 無い★').toContain('外した 人');
  expect(ji).toContain('1,200');
});

// ★★外した 人の 手当と 控除が 同じ 額でも 知らせる★★（対立役 10-06：打ち消して 0円 だと 知らせが 消えた）
//   わざと壊す（10-06 実測）：知らせの 判定を 額（nokori）に 戻す ⇒ ★赤★
test('★外した 人の 手当 1,000・控除 1,000（打ち消し）でも 知らせが 出る★', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openKyuryo(page, (f) => {
    const w = f.workHours[0];
    f.adjustments = [
      {
        adj_id: 'z1',
        employee_id: 'kieta-hito',
        work_date: w.work_date,
        kind: 'teate',
        label: '待機',
        yen: 1000,
      },
      {
        adj_id: 'z2',
        employee_id: 'kieta-hito',
        work_date: w.work_date,
        kind: 'koujo',
        label: '前借り',
        yen: 1000,
      },
    ];
    return f;
  });
  await page.waitForTimeout(1500);
  const ji = await page.evaluate(() => {
    const el = document.querySelector('.adj-chui');
    return el ? el.textContent : '';
  });
  // eslint-disable-next-line no-console
  console.log('★知らせ（打ち消し）★ ' + ji);
  expect(ji, '★打ち消すと 知らせが 消えた★').toContain('2件');
});
