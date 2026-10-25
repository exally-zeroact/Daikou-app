// ============================================================
// ★★本人の 明細を 送る（範囲＝この 期間｜1か月分・PDF・明細の コピー・字で 送る）★★ 2026-10-25
//
//   ★司さんの言葉★
//     「LINEで配るやなくて送るやけど？代行請求書アプリでは全社や各々分けてLINEで送れるやろが？
//       従業員のページやから送るとしたら1ヶ月分をまとめてや選択してるものだけ明細をコピーやLINEなどで送れるようにするべきやろ」
//
//   ★偽の 倉庫★ 月3回（10/1〜10/10・10/11〜10/20・10/21〜10/31）・今日 10/21
//     10/5 と 10/15 に 1時間ずつ（売上 10,005円・歩合 0.3）＝紙の 合計は 各 ¥2,851（端数 在り）／10/21〜 は まだ 記録 無し
//     ＝1か月の 合計は 期間ごとに 丸めてから 足す（紙の 額の 和）
//   ★比べる 相手は 紙（期間の 札を 押して 出た 画面の 明細）と 期間ごとの PDF＝同じ 計算を 2回 なぞらない（対立役 止3）★
// ============================================================
const { test, expect } = require('@playwright/test');
const { EMP, SET } = require('./honnin-harness');

test.use({ timezoneId: 'Asia/Tokyo' });

const SHIFTS = ['2026-10-05', '2026-10-15'].map((d, i) => ({
  shift_id: 's' + i,
  device_id: 'd1',
  started_at: d + 'T12:00:00+09:00',
  ended_at: d + 'T13:00:00+09:00',
  fare_total_yen: 10005,
  elapsed_sec: 3600,
  trip_count: 1,
}));
const HOURS = ['2026-10-05', '2026-10-15'].map((d) => ({
  work_date: d,
  employee_id: 'e1',
  device_id: 'd1',
  hours: 1,
}));

async function akeru(page, mazeru, copyMode, chips) {
  await page.addInitScript((m) => {
    window.__copy = [];
    window.__share = [];
    const cb = {
      writeText: (t) => {
        window.__copy.push(t);
        if (m === 'dame') return Promise.reject(new Error('dame'));
        if (m === 'kaeranai') return new Promise(() => {});
        return Promise.resolve();
      },
    };
    Object.defineProperty(navigator, 'clipboard', { value: cb, configurable: true });
    Object.defineProperty(navigator, 'share', {
      value: (d) => {
        window.__share.push(d);
        return Promise.resolve();
      },
      configurable: true,
    });
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
  }, copyMode || 'ok');
  await page.route('**/rest/v1/rpc/dk_kyuryo_{verify,fuda}', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, name: EMP.name }),
    })
  );
  await page.route('**/rest/v1/rpc/dk_kyuryo_get', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        emp: EMP,
        settings: [Object.assign({}, SET, { roles: { 甲: { rate: 0.3, floor: 0 } } })],
        labels: [
          { company_id: 'c1', device_id: 'd1', label: '1466', sort_order: 1, show_in_slip: true },
        ],
        shifts: SHIFTS,
        edits: [],
        workHours: HOURS,
        adjustments: [],
        rireki: [],
        yakuRireki: [],
        uriageRireki: [],
        shimeRireki: [],
        uriageNaoshi: true,
        tebikiJippi: true,
        kazuNaoshi: true,
        manualDays: [],
        ...(mazeru || {}),
      }),
    })
  );
  await page.route('**/rest/v1/dk_**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await page.clock.setFixedTime(new Date('2026-10-21T12:00:00+09:00'));
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto('/kyuryo.html?t=TOK');
  await page.waitForTimeout(800);
  await page.fill('#hnPw', '1234');
  await page.click('#hnGo');
  await expect(page.locator('#slips .hn-chip')).toHaveCount(chips === undefined ? 3 : chips);
  if (chips === 0) await expect(page.locator('#hnKami .hn-kami-waku').first()).toBeVisible();
}
// 紙（画面の 明細）の 合計の 額＝別の 道（コピーの 字と 比べる 相手）
//   紙の 1枚目の「合計」の 額（¥ だけの 字の 塊）
async function kamiNoGaku(page, k) {
  await page.locator('#slips .hn-chip').nth(k).click();
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const w = document.querySelector('#hnKami .hn-kami-waku');
    if (!w) return NaN;
    const el = Array.from(w.querySelectorAll('*')).find(
      (x) => x.children.length === 0 && /^¥[\d,]+$/.test((x.textContent || '').trim())
    );
    return el ? Number(el.textContent.trim().slice(1).replace(/,/g, '')) : NaN;
  });
}
const gakuOf = (v) => v;
const yenJi = (v) => '¥' + v.toLocaleString('en-US');

// わざと壊す：hnTsukiNoKi の aru を employees[0] の 有無に 戻す ⇒ ★赤★（まだ 来て いない 10/21〜 が ¥0 で 入る）
// わざと壊す：hnMeisaiJi の 合計を 足してから 丸める ⇒ ★赤★（合計が 紙の 和と 違う）
test('① 1か月分の コピー：記録の 在る 期間だけ・額は 紙と 同じ・合計は 紙の 和（丸めてから 足す）', async ({
  page,
}) => {
  await akeru(page);
  const g0 = gakuOf(await kamiNoGaku(page, 0));
  const g1 = gakuOf(await kamiNoGaku(page, 1));
  expect(g0).toBeGreaterThan(0);
  expect(g1).toBeGreaterThan(0);
  await expect(page.locator('.hn-hani-b')).toHaveCount(2);
  await expect(page.locator('.hn-hani-b.on')).toHaveText('この 期間');
  await page.click('.hn-hani-b[data-hani="tsuki"]');
  await expect(page.locator('.hn-hani-b.on')).toHaveText('1か月分');
  await expect(page.locator('#hnPdf')).toHaveText('1か月分の PDFを 開く（保存・印刷）');
  await page.click('#hnCopy');
  await expect(page.locator('#hnCopyMsg')).toHaveText(
    'コピーしました。LINE などに 貼り付けて 送れます。'
  );
  const ji = await page.evaluate(() => window.__copy[0]);
  // eslint-disable-next-line no-console
  console.log(ji);
  expect((ji.match(/【給料明細】/g) || []).length, '★記録の 無い 期間（10/21〜）が 入った★').toBe(
    2
  );
  expect(ji).toContain('10/1 〜 10/10');
  expect(ji).toContain('10/11 〜 10/20');
  expect(ji).not.toContain('10/21');
  expect(ji, '★¥0 の 明細が 入った★').not.toMatch(/差引 支給 ¥0\b/);
  expect(ji).toContain('＝ 差引 支給 ' + yenJi(g0));
  expect(ji).toContain('見張り太郎');
  expect(ji, '★合計が 紙の 額の 和で ない★').toContain('1か月の 差引 支給 合計 ' + yenJi(g0 + g1));
});

test('② この 期間の コピー：見ている 期間だけ・合計の 行は 出さない', async ({ page }) => {
  await akeru(page);
  const g1 = gakuOf(await kamiNoGaku(page, 1));
  await page.click('#hnCopy');
  await expect(page.locator('#hnCopyMsg')).toContainText('コピーしました');
  const ji = await page.evaluate(() => window.__copy[0]);
  expect((ji.match(/【給料明細】/g) || []).length).toBe(1);
  expect(ji).toContain('10/11 〜 10/20');
  expect(ji).toContain('＝ 差引 支給 ' + yenJi(g1));
  expect(ji).not.toContain('1か月の');
});

// わざと壊す：honninCopy で writeText の 返りを 待たずに「コピーしました」⇒ ★赤★
test('③ コピーが 効かない・返らない 端末は 字を 選べる 箱に 出す（「コピーしました」と 言わない）', async ({
  page,
}) => {
  await akeru(page, null, 'dame');
  await page.click('#hnCopy');
  await expect(page.locator('#hnCopyHako')).toBeVisible();
  await expect(page.locator('#hnCopyMsg')).toHaveText(
    '下の 字を 長押しして「コピー」を 押してください。'
  );
  expect(await page.locator('#hnCopyHako').inputValue()).toContain('【給料明細】');
});
test('③b コピーが 3秒 返らない 時も 箱に 出す', async ({ page }) => {
  await akeru(page, null, 'kaeranai');
  await page.click('#hnCopy');
  await page.clock.runFor(3500);
  await expect(page.locator('#hnCopyHako')).toBeVisible();
  await expect(page.locator('#hnCopyMsg')).not.toContainText('コピーしました');
});

test('④ 字で 送る：共有の 画面に 同じ 字を 渡す（LINE などを 選ぶ）', async ({ page }) => {
  await akeru(page);
  await page.click('.hn-hani-b[data-hani="tsuki"]');
  await page.click('#hnJiOkuru');
  await expect.poll(() => page.evaluate(() => window.__share.length)).toBe(1);
  const d = await page.evaluate(() => window.__share[0]);
  expect((d.text.match(/【給料明細】/g) || []).length).toBe(2);
});

// わざと壊す：hnTsukiNoKi の「記録が 在るのに 行が 無い」止めを 外す ⇒ ★赤★（10/11〜 が 黙って 抜けた 合計を 出す）
test('⑤ 記録が 在るのに 計算できない 期間が 在れば 1か月分は 止めて 訳を 出す（黙って 飛ばさない）', async ({
  page,
}) => {
  await akeru(page);
  await page.evaluate(() => {
    const moto = window.PayrollDaily.report;
    window.PayrollDaily.report = function (dates) {
      const r = moto.apply(this, arguments);
      if ((dates || []).indexOf('2026-10-15') >= 0) return Object.assign({}, r, { employees: [] });
      return r;
    };
  });
  await page.click('.hn-hani-b[data-hani="tsuki"]');
  await page.click('#hnCopy');
  await expect(page.locator('#hnPdfErr')).toContainText(
    '10/11 〜 10/20 の 明細を 計算できませんでした'
  );
  expect(await page.evaluate(() => window.__copy.length), '★抜けた 合計を コピーした★').toBe(0);
  await page.click('#hnPdf');
  await expect(page.locator('#hnPdfErr')).toContainText('計算できませんでした');
  await expect(page.locator('#hnPdfMiru')).toHaveCount(0);
});

// ★1か月分の PDF の ページ数＝期間ごとに 作った PDF の ページ数の 和★（別の 道＝期間ごとに 今の 道で 作って 数える・対立役 止3）
//   わざと壊す：honninPdf の 1か月分で 最後の 期間だけ 入れる ⇒ ★赤★
async function pdfNoMaisu(page) {
  await page.click('#hnPdf');
  await expect(page.locator('#hnPdfMiru .hn-pdf-miru-kami').first()).toBeVisible({
    timeout: 30000,
  });
  await page.waitForTimeout(500);
  const n = await page.locator('#hnPdfMiru .hn-pdf-miru-kami').count();
  await page.click('#hnPdfTojiru');
  await expect(page.locator('#hnPdfMiru')).toHaveCount(0);
  return n;
}
test('⑥ 1か月分の PDF は 記録の 在る 期間の 紙を 全部（ページ数＝期間ごとの PDF の 和）・範囲を 替えたら 作り直す', async ({
  page,
}) => {
  await akeru(page);
  await page.locator('#slips .hn-chip').nth(0).click();
  const p0 = await pdfNoMaisu(page);
  await page.locator('#slips .hn-chip').nth(1).click();
  const p1 = await pdfNoMaisu(page);
  expect(p0).toBeGreaterThan(0);
  await page.click('.hn-hani-b[data-hani="tsuki"]');
  await expect(page.locator('#hnPdf')).toHaveText('1か月分の PDFを 開く（保存・印刷）');
  const pt = await pdfNoMaisu(page);
  expect(pt, '★1か月分の ページ数が 期間ごとの 和で ない★').toBe(p0 + p1);
  // 範囲を 戻すと 見ている 期間だけ（作った 1か月分を 渡さない）
  await page.click('.hn-hani-b[data-hani="ki"]');
  await expect(page.locator('#hnPdf')).toHaveText('PDFを 開く（保存・印刷）');
  expect(await pdfNoMaisu(page)).toBe(p1);
});

test('⑦ 期間が 1つの 月は 範囲の 切り替えを 出さない', async ({ page }) => {
  await akeru(
    page,
    {
      settings: [
        Object.assign({}, SET, {
          period_shime: { kind: 'tsuki', hi: [31], nazuke: 'shime' },
          roles: { 甲: { rate: 0.3, floor: 0 } },
        }),
      ],
    },
    null,
    0
  );
  await expect(page.locator('.hn-hani-b')).toHaveCount(0);
  await expect(page.locator('#hnCopy')).toBeVisible();
});
