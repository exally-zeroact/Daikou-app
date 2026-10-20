// ============================================================
// 本人の 画面（kyuryo.html?t=<token>）を 偽の 倉庫で 開く 道具 2026-10-20
//   本人の 画面の 試験（期間の ボタン・紙の 幅 など）が 使う
// ============================================================
const { expect } = require('@playwright/test');

const EMP = {
  employee_id: 'e1',
  company_id: 'c1',
  name: '見張り太郎',
  role: '甲',
  active: true,
  sort_order: 1,
};
const SET = {
  company_id: 'c1',
  period_start_day: 21,
  period_end_mode: 'thirds',
  period_days: 11,
  show_car_sales: true,
  roles: { 甲: { rate: 0.3, floor: 1000 } },
};

// set: 締めの 形を 変える／nidome: 2回目 以降の 取りの 返事を 変える（止めた 文の 道）
async function hiraku(page, set, nidome) {
  let kai = 0;
  await page.route('**/rest/v1/rpc/dk_kyuryo_verify', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, name: EMP.name }),
    })
  );
  await page.route('**/rest/v1/rpc/dk_kyuryo_get', (r) => {
    kai++;
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        emp: EMP,
        settings: [Object.assign({}, SET, set || {})],
        labels: [
          { company_id: 'c1', device_id: 'd1', label: '1466', sort_order: 1, show_in_slip: true },
          { company_id: 'c1', device_id: 'd2', label: '4987', sort_order: 2, show_in_slip: true },
          { company_id: 'c1', device_id: 'd3', label: '1173', sort_order: 3, show_in_slip: true },
        ],
        shifts: [],
        edits: [],
        workHours: [],
        adjustments: [],
        rireki: [],
        yakuRireki: [],
        uriageRireki: [],
        shimeRireki: [],
        uriageNaoshi: true,
        manualDays: [],
        ...(kai > 1 && nidome ? nidome : {}),
      }),
    });
  });
  await page.route('**/rest/v1/dk_**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await page.goto('/kyuryo.html?t=TOK');
  await page.waitForTimeout(800);
  await page.fill('#hnPw', '1234');
  await page.click('#hnGo');
  await expect(page.locator('#hnKami .hn-kami-waku').first()).toBeVisible();
}

// ★期間の ボタンの 字は repo に 置いた 字体（BIZ UDPゴシック）で 測る★ 2026-10-20
//   機械ごとの 字体で 幅が 変わる（手元の Windows「10/1 〜 10/10」13px＝79.5px・CI の Linux はもっと 広い）。
//   司さんの iPhone の 絵では 同じ 字が 約 99px、この 字体で 97.1px ＝ ほぼ 同じ ⇒ この 字体に 揃えて 1割の ゆとりを 見る
async function jitaiKotei(page) {
  await page.addStyleTag({
    content:
      "@font-face{font-family:'KakuninBIZ';src:url('/vendor/fonts/BIZUDPGothic-Regular.ttf')}" +
      "#slips .hn-chip{font-family:'KakuninBIZ' !important}",
  });
  await page.evaluate(() => document.fonts.load("13px 'KakuninBIZ'"));
  await page.waitForFunction(() => document.fonts.check("13px 'KakuninBIZ'"));
}

// 期間の ボタンが 1行か・字が はみ出さないか・紙が 右／下で 切れないか
async function hakaru(page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    const chips = Array.from(document.querySelectorAll('#slips .hn-chip'));
    const tops = chips.map((c) => Math.round(c.getBoundingClientRect().top));
    const waku = Array.from(document.querySelectorAll('#hnKami .hn-kami-waku'));
    return {
      chips: chips.length,
      gyou: new Set(tops).size,
      jiHami: chips.filter((c) => c.scrollWidth > c.clientWidth + 1).length,
      // ★字の 幅を 1.1倍 しても ボタンの 中に 入るか★（jitaiKotei の 字体で 測った 時の ゆとり 1割）
      jiYoyuu: chips.filter((c) => {
        const r = document.createRange();
        r.selectNodeContents(c);
        const ji = r.getBoundingClientRect().width;
        const cs = getComputedStyle(c);
        const naka = c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        return ji * 1.1 > naka;
      }).length,
      chipMigi: Math.max(
        0,
        ...chips.map((c) => Math.round(c.getBoundingClientRect().right - d.clientWidth))
      ),
      page: d.scrollWidth - d.clientWidth,
      maisu: waku.length,
      migi: Math.max(
        0,
        ...waku.map((w) =>
          Math.round(
            w.firstElementChild.getBoundingClientRect().right - w.getBoundingClientRect().right
          )
        )
      ),
      shita: Math.max(
        -9999,
        ...waku.map((w) => {
          const wb = w.getBoundingClientRect().bottom;
          const b = Math.max(
            ...Array.from(w.querySelectorAll('td,th,div')).map(
              (x) => x.getBoundingClientRect().bottom
            )
          );
          return Math.round(b - wb);
        })
      ),
    };
  });
}

module.exports = { EMP, SET, hiraku, hakaru, jitaiKotei };
