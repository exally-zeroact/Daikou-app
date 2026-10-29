// ============================================================
// ★★本人の 明細を 送る（範囲＝期間ごと｜1か月分）★★ 2026-10-25／2026-10-29 作り直し
//
//   ★司さんの言葉★
//     「LINEで配るやなくて送るやけど？代行請求書アプリでは全社や各々分けてLINEで送れるやろが？
//       従業員のページやから送るとしたら1ヶ月分をまとめてや選択してるものだけ明細をコピーやLINEなどで送れるようにするべきやろ」
//     2026-10-29「赤丸のどこが代行請求書と同じ作りなんどぼけ勝手にごちゃごちゃさすなや記録なくても押せる開くようにしろや」
//       ⇒ 範囲は 上の 並びの 期間の 選ぶ 欄（「1か月分」＋ 期間ごと）・送るは「📄 印刷 / 送る」1つ
//         明細の コピー・字で 送る は 無くした／記録の 無い 期間も ¥0 の 紙を 出す（1か月分にも 入る）
//
//   ★偽の 倉庫★ 月3回（10/1〜10/10・10/11〜10/20・10/21〜10/31）・今日 10/21
//     10/5 と 10/15 に 1時間ずつ（売上 10,005円・歩合 0.3）＝紙の 合計は 各 ¥2,851（端数 在り）／10/21〜 は まだ 記録 無し（¥0）
//   ★比べる 相手は 期間ごとに 選んで 出た 紙と 期間ごとの PDF＝同じ 計算を 2回 なぞらない（対立役 止3）★
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

// kikan＝期間の 選ぶ 欄の 選べる 数（1か月分 ＋ 期間の 数・期間が 1つの 月は 1）
async function akeru(page, mazeru, kikan) {
  await page.addInitScript(() => {
    window.__dl = [];
    window.__kyouyu = [];
    HTMLAnchorElement.prototype.click = function () {
      window.__dl.push({ name: this.download, href: this.href });
    };
  });
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
  await expect(page.locator('#hnKikanSel option')).toHaveCount(kikan === undefined ? 4 : kikan);
  await expect(page.locator('#hnKami .hn-kami-waku').first()).toBeVisible();
}
// 画面の 紙 1枚ずつの「合計」の 額（¥ だけの 字の 塊の 1つ目）
async function kamiNoGaku(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('#hnKami .hn-kami-waku')).map((w) => {
      const el = Array.from(w.querySelectorAll('*')).find(
        (x) => x.children.length === 0 && /^¥[\d,]+$/.test((x.textContent || '').trim())
      );
      return el ? Number(el.textContent.trim().slice(1).replace(/,/g, '')) : NaN;
    })
  );
}
async function erabu(page, v) {
  await page.locator('#hnKikanSel').selectOption(v);
  await expect(page.locator('#hnKikanSel')).toHaveValue(v);
  await page.waitForTimeout(300);
}
// 作った PDF の ページ数（作った 物を 道具 pdf-lib で 開き直して 数える＝紙の 数え方と 別の 道）
async function pdfNoMaisu(page) {
  const n = await page.evaluate(() => window.__dl.length);
  await page.click('#hnPdf');
  await expect.poll(() => page.evaluate(() => window.__dl.length), { timeout: 30000 }).toBe(n + 1);
  return page.evaluate(async (i) => {
    const d = window.__dl[i];
    const buf = await (await fetch(d.href)).arrayBuffer();
    const doc = await window.PDFLib.PDFDocument.load(buf);
    return { name: d.name, maisu: doc.getPageCount() };
  }, n);
}

// わざと壊す：hnHaniNoKi の 1か月分で 最後の 期間だけ 入れる ⇒ ★赤★（紙の 数・額が 違う）
test('① 1か月分：画面に 期間ごとの 紙を 全部（記録の 無い 期間は ¥0）・額は 期間ごとの 紙と 同じ', async ({
  page,
}) => {
  await akeru(page);
  // 開いた 時は 今日を 含む 期…でなく 月3回は 最初の 期（今の 会社の 見え方）
  await expect(page.locator('#hnKikanSel')).toHaveValue('0');
  const g = [];
  for (const v of ['0', '1', '2']) {
    await erabu(page, v);
    const k = await kamiNoGaku(page);
    expect(k.length, '★期間ごとの 紙が 1枚で ない★').toBe(1);
    g.push(k[0]);
  }
  expect(g[0]).toBeGreaterThan(0);
  expect(g[1]).toBeGreaterThan(0);
  expect(g[2], '★記録の 無い 10/21〜 が ¥0 で ない★').toBe(0);
  await erabu(page, 'tsuki');
  const t = await kamiNoGaku(page);
  expect(t, '★1か月分の 紙が 期間ごとの 紙と 違う★').toEqual(g);
});

// ★1か月分の PDF の ページ数＝期間ごとに 作った PDF の ページ数の 和★（別の 道＝期間ごとに 今の 道で 作って 数える・対立役 止3）
//   わざと壊す：hnPdfTsukuru の 1か月分で 最後の 期間だけ 入れる ⇒ ★赤★
test('② 1か月分の PDF は 期間の 紙を 全部（ページ数＝期間ごとの PDF の 和）・範囲を 替えたら 作り直す', async ({
  page,
}) => {
  await akeru(page);
  const p = [];
  for (const v of ['0', '1', '2']) {
    await erabu(page, v);
    p.push((await pdfNoMaisu(page)).maisu);
  }
  expect(p[0]).toBeGreaterThan(0);
  expect(p[2], '★記録の 無い 期間の PDF が 0枚（押せる・開く が 効いていない）★').toBeGreaterThan(
    0
  );
  await erabu(page, 'tsuki');
  const t = await pdfNoMaisu(page);
  expect(t.maisu, '★1か月分の ページ数が 期間ごとの 和で ない★').toBe(p[0] + p[1] + p[2]);
  expect(t.name).toBe('給料明細_2026-10_1か月分_見張り太郎.pdf');
  // 範囲を 戻すと 見ている 期間だけ（作った 1か月分を 渡さない）
  await erabu(page, '1');
  const b = await pdfNoMaisu(page);
  expect(b.maisu).toBe(p[1]);
  expect(b.name).toBe('給料明細_2026-10_10-11〜10-20_見張り太郎.pdf');
});

// わざと壊す：hnKiNoE の「記録が 在るのに 行が 無い」止めを 外す ⇒ ★赤★（10/11〜 を ¥0 に 倒した 紙・PDF を 出す）
test('③ 記録が 在るのに 計算できない 期間が 在れば 1か月分は 止めて 訳を 出す（¥0 に 倒さない）', async ({
  page,
}) => {
  await akeru(page);
  // 本人の 計算（ctx.honnin）は 行を 返さず、勤め始めを 外した 写し（honnin:false）は 働いた 日 0 の 行を 返す 形
  //   ＝奥の 止め（写しの 行に 働いた 日が 在る）では 止まらない＝手前の「記録が 在る」止めだけを 縛る
  await page.evaluate(() => {
    const moto = window.PayrollDaily.report;
    window.PayrollDaily.report = function (dates, ctx) {
      const r = moto.apply(this, arguments);
      if ((dates || []).indexOf('2026-10-15') < 0) return r;
      if (!ctx || ctx.honnin !== false) return Object.assign({}, r, { employees: [] });
      return Object.assign({}, r, {
        employees: (r.employees || []).map((e) =>
          Object.assign({}, e, { workedDays: 0, adj: [], kasegi: 0, totalPay: 0 })
        ),
      });
    };
  });
  await erabu(page, 'tsuki');
  await expect(page.locator('#hnKami')).toContainText(
    '10/11 〜 10/20 の 明細を 計算できませんでした'
  );
  await expect(page.locator('#hnKami .hn-kami-waku'), '★¥0 に 倒した 紙を 出した★').toHaveCount(0);
  await page.click('#hnPdf');
  await expect(page.locator('#hnPdfErr')).toContainText('計算できませんでした');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__dl.length), '★抜けた PDF を 渡した★').toBe(0);
});

// わざと壊す：hnBarKaku の 期間が 1つの 時の disabled を 外す ⇒ ★赤★
test('④ 期間が 1つの 月は 期間の 欄を 選べない（1か月分も 出さない）・印刷 / 送る は 押せる', async ({
  page,
}) => {
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
    1
  );
  await expect(page.locator('#hnKikanSel')).toBeDisabled();
  await expect(page.locator('#hnKikanSel option[value="tsuki"]')).toHaveCount(0);
  const t = await pdfNoMaisu(page);
  expect(t.maisu).toBeGreaterThan(0);
  // 期間が 1つの 月は 名前に 期間を 付けない
  expect(t.name).toBe('給料明細_2026-10_見張り太郎.pdf');
});
