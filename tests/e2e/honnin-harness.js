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

// ★本人の 関数（dk_kyuryo_get）の 偽の 返り★（札の 試験も 使う・2026-10-21）
function getKotae(set) {
  return {
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
    tebikiJippi: true,
    kazuNaoshi: true, // 回数・距離の 直しを 返す 版の 印（10-25：無い 時は 止める）
    manualDays: [],
  };
}

// set: 締めの 形を 変える／nidome: 2回目 以降の 取りの 返事を 変える（止めた 文の 道）
// ============================================================
// ★★本人の 明細は 本物の PDF を pdf.js で 描いた 絵★★ 2026-10-31（見本 代行請求書と 同じ）
//   絵（canvas）から 字は 読めない ⇒ 試験は ★絵に した PDF そのものの 字★を 読む（見せている 物と 同じ 物）
// ============================================================
// 描いた 絵の 1ページ（canvas を 包む 箱）
const KAMI = '#hnKami .sheet-pdf';

// ★開く 前に 呼ぶ★ 絵に する 為に 読まれた PDF の blob を 控える（画面の 中の 道は 変えない）
async function pdfMiru(page) {
  await page.addInitScript(() => {
    const moto = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function () {
      if (this.type === 'application/pdf') window.__hnMisePdf = this;
      return moto.apply(this, arguments);
    };
  });
}

// ★描き終えた★＝作成中の 覆いが 外れ、描き終えた 印が 付き、canvas が 在る
async function kamiDekita(page, wake) {
  await expect(
    page.locator('#hnKami[data-hn-no]:not(.inv-loading) .sheet-pdf canvas').first(),
    wake
  ).toBeVisible({ timeout: 30000 });
}

// ★絵に した PDF の 字★ 太字は 同じ 字を 横に 少し ずらして 3回 描く（js/kami-egaku.js）＝
//   ★同じ 高さ・同じ 字・横の ずれが 太字の ずらし 以下★の 物だけ 1つに まとめる
//   （続く 同じ 字を 全部 まとめると 日ごとに 並ぶ 本物の ¥0 まで 潰れる・設計前 対立役 N1）
async function kamiNoJi(page) {
  await kamiDekita(page);
  return page.evaluate(async () => {
    const b = window.__hnMisePdf;
    if (!b) throw new Error('絵に した PDF を 控えていない（pdfMiru を 開く 前に 呼ぶ）');
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await b.arrayBuffer()) })
      .promise;
    const out = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const items = (await (await pdf.getPage(p)).getTextContent()).items;
      const kept = [];
      items.forEach((it) => {
        const size = Math.hypot(it.transform[0], it.transform[1]) || it.height || 10;
        const x = it.transform[4];
        const y = it.transform[5];
        const futoji = kept.some(
          (k) =>
            k.str === it.str &&
            Math.abs(k.y - y) < 0.1 &&
            x - k.x > 0 &&
            x - k.x <= 2 * 0.025 * size + 0.01
        );
        if (!futoji) kept.push({ str: it.str, x, y });
      });
      out.push(
        kept
          .map((k) => k.str)
          .join(' ')
          .replace(/\s+/g, ' ')
      );
    }
    return out.join('\n');
  });
}

// ★絵の ページ 1枚ずつの「合計」の 額★（ページの 字で 最初の ¥ の 塊・前は HTML の 紙で 数えていた）
async function kamiNoGaku(page) {
  const ji = await kamiNoJi(page);
  return ji.split('\n').map((p) => {
    const m = p.match(/¥([\d,]+)/);
    return m ? Number(m[1].replace(/,/g, '')) : NaN;
  });
}

// matanai: 描き終わりを 待たない（絵が 転ぶ 試験）
// emp＝本人の 字を 替える（例：字体に 無い 字の 名前・2026-10-31）
async function hiraku(page, set, nidome, matanai, emp) {
  let kai = 0;
  await pdfMiru(page);
  await page.route('**/rest/v1/rpc/dk_kyuryo_{verify,fuda}', (r) =>
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
        ...getKotae(set),
        ...(emp ? { emp: { ...EMP, ...emp } } : {}),
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
  if (!matanai) await kamiDekita(page);
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
    // ★絵の ページ（canvas）が 枠（#hnKami）の 右／下で 切れないか★（縮め方＝見本 fitInvoice）
    const mado = document.getElementById('hnKami');
    const mr = mado ? mado.getBoundingClientRect() : { right: 0, bottom: 0 };
    const waku = Array.from(document.querySelectorAll('#hnKami .sheet-pdf canvas'));
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
      migi: Math.max(0, ...waku.map((w) => Math.round(w.getBoundingClientRect().right - mr.right))),
      shita: Math.max(
        -9999,
        ...waku.map((w) => Math.round(w.getBoundingClientRect().bottom - mr.bottom))
      ),
    };
  });
}

// ★前の 月へ★ 2026-10-29（◀ を 無くし 代行請求書と 同じ 月の 選ぶ 欄 #hnTsukiSel に した＝新しい 月が 上）
async function maeNoTsuki(page) {
  const sel = page.locator('#hnTsukiSel');
  await expect(sel).toBeVisible();
  const i = await sel.evaluate((s) => s.selectedIndex);
  await sel.selectOption({ index: i + 1 });
}

module.exports = {
  EMP,
  SET,
  KAMI,
  getKotae,
  hiraku,
  hakaru,
  jitaiKotei,
  maeNoTsuki,
  pdfMiru,
  kamiDekita,
  kamiNoJi,
  kamiNoGaku,
};
