// ============================================================
// ★★本人の 明細：辞めた 人の 記録の 無い 期・札が 切れた 後の 入れる 画面★★ 2026-10-30（本番前の 対立役 止1・止2）
//
//   止1 ★前★ 辞めた 人（active=false）の 記録の 無い 期で「計算できませんでした・会社に知らせて」と 嘘が 出た
//         （report は 辞めた 人の 行を 記録の 在る 期しか 返さない）・辞めた 月の「1か月分」は 丸ごと 止まった
//       ★今★ 写しの 中では 今いる 人と して 回す＝記録の 無い 期は ¥0 の 紙（司さん 10-29「記録なくても押せる開くようにしろや」）
//   止2 ★前★ 札が 切れた（fuda_kire）後の パスワードの 画面に 月の 欄が 出た まま 押せ、p_pw 無しで 倉庫を 呼び
//         「この リンクは 作り直されました」と 嘘が 出た（倉庫は p_pw 無しを 間違い 1回に 数える）
//       ★今★ 入れる 画面の 間は 上の 並び #hnBar を 隠す
//
//   ★わざと壊して 赤（2026-10-30 実測）★
//     hnKiNoE の 写しの active:true を 外す …… ★止1 が 赤★
//     honninStart の #hnBar を 隠す 所を 外す … ★止2 が 赤★
// ============================================================
const { test, expect } = require('@playwright/test');
const { EMP, getKotae } = require('./honnin-harness');

test.use({ timezoneId: 'Asia/Tokyo' });

const FUDA = 'ab'.repeat(24);
async function nise(page, getFn, log) {
  await page.route('**/rest/v1/dk_**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await page.route('**/rest/v1/rpc/dk_kyuryo_{verify,fuda}', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, name: EMP.name, fuda: FUDA, kigen: Date.now() + 864e5 }),
    })
  );
  await page.route('**/rest/v1/rpc/dk_kyuryo_get', (r) => {
    const b = JSON.parse(r.request().postData() || '{}');
    log.push(b.p_pw);
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(getFn(b)),
    });
  });
}
const gaku = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('#hnKami .hn-kami-waku')).map((w) => {
      const el = Array.from(w.querySelectorAll('*')).find(
        (x) => x.children.length === 0 && /^¥[\d,]+$/.test((x.textContent || '').trim())
      );
      return el ? Number(el.textContent.trim().slice(1).replace(/,/g, '')) : NaN;
    })
  );

test('止1 辞めた 人：記録の 無い 期は ¥0 の 紙・1か月分も 出る（「計算できませんでした」と 言わない）', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.clock.setFixedTime(new Date('2026-10-21T12:00:00+09:00'));
  const log = [];
  // 月3回（10/1〜10/10・10/11〜10/20・10/21〜10/31）・10/5 に 1時間 だけ 働いて 辞めた
  await nise(
    page,
    () =>
      Object.assign(getKotae({ roles: { 甲: { rate: 0.3, floor: 0 } } }), {
        emp: Object.assign({}, EMP, { active: false }),
        shifts: [
          {
            shift_id: 's0',
            device_id: 'd1',
            started_at: '2026-10-05T12:00:00+09:00',
            ended_at: '2026-10-05T13:00:00+09:00',
            fare_total_yen: 10005,
            elapsed_sec: 3600,
            trip_count: 1,
          },
        ],
        workHours: [{ work_date: '2026-10-05', employee_id: 'e1', device_id: 'd1', hours: 1 }],
      }),
    log
  );
  await page.goto('/kyuryo.html?t=TOK');
  await page.waitForTimeout(800);
  await page.fill('#hnPw', '1234');
  await page.click('#hnGo');
  await expect(page.locator('#hnKikanSel option')).toHaveCount(4);
  await expect(page.locator('#hnKami .hn-kami-waku').first()).toBeVisible();
  for (const v of ['1', '2']) {
    await page.locator('#hnKikanSel').selectOption(v);
    await expect(
      page.locator('#slips'),
      '★辞めた 人の 記録の 無い 期で 嘘の 訳★'
    ).not.toContainText('計算できませんでした');
    expect(await gaku(page), '★辞めた 後の 記録の 無い 期が ¥0 の 紙で ない★').toEqual([0]);
  }
  await page.locator('#hnKikanSel').selectOption('tsuki');
  await expect(page.locator('#slips')).not.toContainText('計算できませんでした');
  const g = await gaku(page);
  expect(g.length, '★1か月分の 紙が 3枚で ない★').toBe(3);
  expect(g[0], '★働いた 期の 額が 消えた★').toBeGreaterThan(0);
  expect(g.slice(1)).toEqual([0, 0]);
  await expect(page.locator('#hnPdf')).toBeEnabled();
});

test('止2 札が 切れた 後の 入れる 画面では 月の 欄を 出さない（p_pw 無しで 倉庫を 呼ばない）', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  const log = [];
  let kire = false;
  await nise(
    page,
    (b) => {
      if (String(b.p_pw).indexOf('fuda:') === 0 && kire) return { ok: false, reason: 'fuda_kire' };
      if (b.p_pw === null) return { ok: false, reason: 'bad_pw', nokori: 2 };
      return getKotae();
    },
    log
  );
  // 期限内の 札を 持った 端末（1回目の 読み込みだけ 置く）
  await page.addInitScript(
    ([f]) => {
      if (sessionStorage.getItem('__oita')) return;
      sessionStorage.setItem('__oita', '1');
      localStorage.setItem(
        'dkKyuFuda:TOK',
        JSON.stringify({ fuda: f, kigen: Date.now() + 3600e3 })
      );
    },
    [FUDA]
  );
  await page.goto('/kyuryo.html?t=TOK');
  await expect(page.locator('#hnKami .hn-kami-waku').first()).toBeVisible();
  kire = true;
  const sel = page.locator('#hnTsukiSel');
  const i = await sel.evaluate((s) => s.selectedIndex);
  await sel.selectOption({ index: i + 1 });
  await expect(page.locator('#hnPw'), '★札が 切れたのに 入れる 画面が 出ない★').toBeVisible();
  await expect(page.locator('#hnBar'), '★入れる 画面に 月の 欄が 出ている★').toBeHidden();
  await expect(page.locator('#hnTsukiSel')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(
    log.filter((x) => x === null || x === undefined).length,
    '★p_pw 無しで 倉庫を 呼んだ★'
  ).toBe(0);
  // パスワードを 入れ直せば 月の 欄が 戻る
  await page.fill('#hnPw', '1234');
  await page.click('#hnGo');
  await expect(page.locator('#hnTsukiSel')).toBeVisible();
  await expect(page.locator('#hnKami .hn-kami-waku').first()).toBeVisible();
});
