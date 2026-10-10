// ============================================================
// ★★見張り：どの 紙も 見切れない（紙の 端から はみ出さない・マスの 字が 切れない）★★ 2026-10-06
//
//   司さん（10-06 写真）「見切れも直ってないし」
//   ★写真の 物★ 売上表の 紙＝日ごとの 表を 左右 2つ 並べて いて 右の 表の「引いた 実費」の 列が
//     紙の 右端から はみ出し 切れていた（紙は overflow:hidden で 黙って 切る）。
//   ⇒ ★紙を 全部（10種）★ 一番 きつい 材料で 組み、実ブラウザで 寸法を 数える：
//     ・紙の 中の どの 箱も 紙の 右端・下端を 越えない
//     ・どの マス（td/th）も 字が マスから はみ出さない（scrollWidth > clientWidth で 見る）
//   ★きつい 材料★ 31日の 月（10月）・車 4台（つかさ 入り）・7人（長い 名前 1人）・6桁の 額・全部の 日に 数
//
//   ★★わざと壊して 赤に なるのを 見た（2026-10-06 実測）★★
//     売上表の 日ごとを 前の 形（日付が 行・左右 2つ）に 戻す ⇒ ★赤★（右に はみ出す）
// ============================================================
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

async function shikomu(page) {
  // ★何も しない 白紙で 組む★（画面は ログインへ 飛ぶ＝WebKit では 足した 部品ごと 消えた）
  //   同じ 置き場（http）に 居ないと 字体（vendor/fonts）が 取れない ⇒ 置き場の 中の 静かな ファイルを 開いて 白紙に する
  await page.goto('/js/kami-kumu.js');
  await page.setContent(
    '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'
  );
  for (const f of ['js/kami-kumu.js', 'js/kami-hyou.js', 'js/kami-shukei.js', 'js/kami-pdf.js']) {
    await page.addScriptTag({ path: path.join(ROOT, f) });
  }
}

// ★紙を 画面・PDF と 同じ ★A4 の 幅★ で 置き、★A4 の 幅と 高さ★ を 越えないか 数える★（縮めない）
//   画面（KamiPdf.mise）も PDF も 幅は A4 に 決め打ち・高さは A4 で 切る＝越えた 分が 見切れる
async function hakaru(page, tsukuru) {
  return page.evaluate((src) => {
    // eslint-disable-next-line no-new-func
    const mai = new Function('return (' + src + ')()')();
    const out = [];
    mai.forEach((m, i) => {
      const el = m.el;
      const a4 = window.KamiPdf.A4[m.muki === 'yoko' ? 'yoko' : 'tate'];
      el.style.position = 'absolute';
      el.style.left = '0px';
      el.style.top = '0px';
      el.style.width = a4.bw + 'px';
      document.body.appendChild(el);
      const r0 = el.getBoundingClientRect();
      const r = {
        right: r0.left + a4.bw,
        bottom: r0.top + a4.bh,
        width: r0.width,
        height: r0.height,
      };
      let migi = 0;
      let shita = 0;
      el.querySelectorAll('*').forEach((x) => {
        const b = x.getBoundingClientRect();
        if (!b.width && !b.height) return;
        migi = Math.max(migi, b.right - r.right);
        shita = Math.max(shita, b.bottom - r.bottom);
      });
      const kire = [];
      el.querySelectorAll('td,th').forEach((c) => {
        if (c.scrollWidth > c.clientWidth + 1) kire.push(c.textContent.slice(0, 12));
      });
      out.push({
        mai: i + 1,
        muki: m.muki,
        w: Math.round(r.width),
        h: Math.round(r.height),
        migi: Math.round(migi),
        shita: Math.round(shita),
        kire: kire.slice(0, 5),
        kireKazu: kire.length,
      });
      el.remove();
    });
    return out;
  }, tsukuru.toString());
}

function mon(na, r) {
  // eslint-disable-next-line no-console
  console.log('★' + na + '★ ' + JSON.stringify(r));
  expect(r.length, '★' + na + '：紙が 0枚★').toBeGreaterThan(0);
  r.forEach((x) => {
    expect(
      x.migi,
      '★' + na + ' ' + x.mai + '枚目：右に ' + x.migi + 'px はみ出して 切れる★'
    ).toBeLessThanOrEqual(1);
    expect(
      x.shita,
      '★' + na + ' ' + x.mai + '枚目：下に ' + x.shita + 'px はみ出して 切れる★'
    ).toBeLessThanOrEqual(1);
    expect(
      x.kireKazu,
      '★' + na + ' ' + x.mai + '枚目：字が 切れた マス ' + JSON.stringify(x.kire) + '★'
    ).toBe(0);
  });
}

// ── 共通の きつい 材料（ページの 中で 作る＝関数の 中に 書く）──
const ZAIRYO = `
  var K = { name: 'ZERO代行', year: 2026, month: 10,
    settings: { period_start_day: 1, period_days: 10, reserve_pool_rate: 0.05 },
    kinds: [{ label: '高速代', hiku: true }, { label: '橋代', hiku: true }], denshi: true };
  var CARS = ['4987', '1466', '1173', 'つかさ'];
  var hi = {}; for (var d = 1; d <= 31; d++) hi[d] = { uriage: 123456, genkin: 98765, seikyu: 23456,
    denshi: 1235, keihi: 12345, jippi: 12345, kaisuu: 24, jissha: 114.5, sou: 292.9 };
`;

test('★売上表（月ごと・月次集計の 紙）★ 見切れない', async ({ page }) => {
  await shikomu(page);
  const r = await hakaru(
    page,
    new Function(
      ZAIRYO +
        `
    return window.KamiHyou.uriageTsuki(K, { uriage: 3827136, keihi: 382695, seikyu: 727136, denshi: 38285,
      genkin: 3061715, cars: CARS.map(function (c) { return { name: c, uriage: 956784, jippi: 95673 }; }), hi: hi });`
    )
  );
  mon('売上表（月ごと）', r);
});

test('★売上表（車ごと・日ごと＝売上表の 画面の 紙）★ 見切れない', async ({ page }) => {
  await shikomu(page);
  const r = await hakaru(
    page,
    new Function(
      ZAIRYO +
        `
    return window.KamiHyou.uriageHyou(K, { uriage: 3827136, jippi: 382695,
      cars: CARS.map(function (c) { return { name: c, uriage: 956784, jippi: 95673 }; }), hi: hi });`
    )
  );
  mon('売上表（車ごと・日ごと）', r);
});

test('★回数・距離（月ごと）★ 見切れない', async ({ page }) => {
  await shikomu(page);
  const r = await hakaru(
    page,
    new Function(
      ZAIRYO +
        `
    return window.KamiHyou.soukouTsuki(K, { kaisuu: 744, jissha: 3549.5, sou: 9079.9,
      cars: CARS.map(function (c) { return { name: c, kaisuu: 186, jissha: 887.4, sou: 2269.9 }; }), hi: hi });`
    )
  );
  mon('回数・距離（月ごと）', r);
});

test('★月次集計★ 見切れない', async ({ page }) => {
  await shikomu(page);
  const r = await hakaru(
    page,
    new Function(
      ZAIRYO +
        `
    var tsuki = { salesTotal: 3827136, expense: 382695, invoice: 727136, denshi: 38285, cash: 3061715,
      payTotal: 1798253.65, periods: [{ rangeLabel: '10/1 ~ 10/10', pay: 598253.65 },
      { rangeLabel: '10/11 ~ 10/20', pay: 600000 }, { rangeLabel: '10/21 ~ 10/31', pay: 600000 }],
      reserve: 191356.8, ownerShare: 1837525.55 };
    return window.KamiHyou.getsuji(K, window.KamiShukei.getsujiData(tsuki,
      CARS.map(function (c) { return { name: c, uriage: 956784, jippi: 95673 }; })));`
    )
  );
  mon('月次集計', r);
  // ★小数を 出さない★（司さん 10-06「これは小数点とかいらんのや」）
  const ji = await page.evaluate(() => document.body.textContent);
  expect(ji).not.toContain('.65');
});

test('★給料表（月ごと・日ごと・個別）★ 見切れない（7人・長い 名前）', async ({ page }) => {
  await shikomu(page);
  const mk = (fn) =>
    new Function(
      ZAIRYO +
        `
    var namae = ['10/1 ~ 10/10', '10/11 ~ 10/20', '10/21 ~ 10/31'];
    var h = []; for (var d = 1; d <= 31; d++) h.push(d % 7 === 0 ? 0 : 123456);
    var hj = h.map(function (v) { return v ? 12.25 : 0; });
    var na = ['見本一四', '東海林 けんいちろう', '山田', '鈴木', '佐藤', '高橋', '田中'];
    var hito = na.map(function (n) { return { name: n, kikan: [1234567, 1234567, 1234567], jikan: 330.75, hi: h, hiJikan: hj }; });
    ` +
        fn
    );
  mon(
    '給料表（月ごと）',
    await hakaru(page, mk('return window.KamiHyou.kyuryoTsuki(K, { namae: namae, hito: hito });'))
  );
  mon(
    '給料表（日ごと）',
    await hakaru(page, mk('return window.KamiHyou.kyuryoHi(K, { hito: hito });'))
  );
  mon(
    '給料表（個別）',
    await hakaru(
      page,
      mk('return window.KamiHyou.kyuryoKojin(K, { namae: namae, hito: hito[1] });')
    )
  );
});
