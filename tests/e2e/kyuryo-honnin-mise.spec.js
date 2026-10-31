// ============================================================
// ★★本人の 明細の 絵＝本物の PDF を pdf.js で 描いた 物★★ 2026-10-31（司さん 指示①
//   「代行請求書アプリの請求/集計の作りを見ろや 何回もゆわすな」）
//   見本＝代行請求書 daikou-seikyu の renderInvoicePreviewPDF（.inv-loading・.sheet.sheet-pdf・.li-empty）
//   わざと壊して 赤（手元で 見た）：
//     ① honninKami を 前の HTML の 紙に 戻す ⇒ ①②が 赤（canvas が 無い・div.dk-kami が 在る）
//     ② hnMiseru の furui() を 外す ⇒ ③④b が 赤（古い 描きが 後から 入る）。④ は 箱ごと 止めた 文に 替わるので
//        furui と 枠の 取り直しを 2つ 外しても 緑（外れた 箱に 入る＝見えない・測った）
//     ③ 期間替えで #hnKami を 作り直す（box.innerHTML を いつも 書く）⇒ ⑤が 赤（前の 絵が 消える）
// ============================================================
const { test, expect } = require('@playwright/test');
const { KAMI, hiraku, kamiDekita, kamiNoJi } = require('./honnin-harness');

// ★絵に する PDF の 読みを わざと 遅らせる★（1回目 ms[0]・2回目 ms[1] …）＝描きの 途中に 操作する 為
async function osoku(page, ms) {
  await page.evaluate((ms) => {
    const moto = Blob.prototype.arrayBuffer;
    const q = ms.slice();
    window.__osoiN = 0;
    Blob.prototype.arrayBuffer = function () {
      const r = moto.apply(this, arguments);
      if (this.type !== 'application/pdf' || !q.length) return r;
      window.__osoiN++;
      const d = q.shift();
      return r.then((v) => new Promise((ok) => setTimeout(() => ok(v), d)));
    };
  }, ms);
}

test('① 画面の 明細は 本物の PDF の 絵（canvas・ページ数＝PDF・白紙で ない・HTML の 紙は 無い）', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await hiraku(page);
  const m = await page.evaluate(async () => {
    const cvs = Array.from(document.querySelectorAll('#hnKami .sheet-pdf canvas'));
    const b = window.__hnMisePdf;
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await b.arrayBuffer()) })
      .promise;
    // 白で ない 点を 数える（白紙の canvas でも 枚数は 合う＝対立役 S3）
    const kuro = cvs.map((c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 128 && d[i + 3] > 0) n++;
      return n;
    });
    return {
      canvas: cvs.length,
      pages: pdf.numPages,
      kuro,
      html: document.querySelectorAll('#hnKami .dk-kami, #hnKami table').length,
      inv: document.querySelector('#hnKami').className,
    };
  });
  expect(m.canvas, '★絵が 無い★').toBeGreaterThan(0);
  expect(m.canvas, '★絵の 枚数が PDF の ページ数と 違う★').toBe(m.pages);
  m.kuro.forEach((n) => expect(n, '★白紙の 絵★').toBeGreaterThan(1000));
  expect(m.html, '★HTML の 紙を 見せている（PDF の 絵で ない）★').toBe(0);
  expect(m.inv).toContain('sheet-scale');
  expect(m.inv).not.toContain('inv-loading');
  expect(await kamiNoJi(page)).toContain('給料明細');
});

test('② 作る 間は「⏳ プレビュー作成中…」（見本と 同じ 字）・描き終えたら 外れる', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await hiraku(page);
  await osoku(page, [2500]);
  await page.locator('#hnKikanSel').selectOption('1');
  await expect(page.locator('#hnKami.inv-loading')).toHaveCount(1);
  const ji = await page.evaluate(() =>
    getComputedStyle(document.getElementById('hnKami'), '::after').content.replace(/"/g, '')
  );
  expect(ji).toBe('⏳ プレビュー作成中…');
  await kamiDekita(page);
  await expect(page.locator('#hnKami.inv-loading')).toHaveCount(0);
});

test('③ 描きの 途中で 期間を 替えたら 古い 期間の 絵は 後から 来ても 入れない', async ({
  page,
}) => {
  // ★時計を 10月に 止める★ 2026-11-01（対立役）＝下の「10/21 〜 10/31」は 10月の 字。止めないと 11月の 間 ずっと 赤
  //   （CI run 41212919553 で 画面は「11/21 〜 11/30」）。kyuryo-honnin-kikan と 同じ 止め方。
  await page.clock.setFixedTime(new Date('2026-10-05T12:00:00+09:00'));
  await page.setViewportSize({ width: 390, height: 844 });
  await hiraku(page);
  // 1つ目（期間 1）の 読みを 3秒・2つ目（期間 2）を 0.3秒 遅らせる＝古い 方が 後で 終わる
  await osoku(page, [3000, 300]);
  await page.locator('#hnKikanSel').selectOption('1');
  await page.waitForFunction(() => window.__osoiN >= 1, null, { timeout: 30000 });
  await page.locator('#hnKikanSel').selectOption('2');
  await kamiDekita(page);
  const no2 = await page.locator('#hnKami').getAttribute('data-hn-no');
  await page.waitForTimeout(3500); // 古い 方が 終わる まで 待つ
  expect(
    await page.locator('#hnKami').getAttribute('data-hn-no'),
    '★古い 期間の 絵が 後から 入った★'
  ).toBe(no2);
  expect(await kamiNoJi(page)).toContain('10/21 〜 10/31');
});

test('④ 描きの 途中で 月を 替えて 止めた 文に なったら 古い 月の 絵を 出さない', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await hiraku(page, null, { uriageNaoshi: undefined });
  await osoku(page, [3000]);
  await page.locator('#hnKikanSel').selectOption('1');
  await page.waitForFunction(() => window.__osoiN >= 1, null, { timeout: 30000 });
  const sel = page.locator('#hnTsukiSel');
  const i = await sel.evaluate((s) => s.selectedIndex);
  await sel.selectOption({ index: i + 1 });
  await expect(page.locator('#slips')).not.toContainText('読み込み中');
  await page.waitForTimeout(3500);
  await expect(page.locator('#hnKami'), '★止めた 文の 後に 古い 月の 絵が 出た★').toHaveCount(0);
  await expect(page.locator(KAMI)).toHaveCount(0);
});

test('④b 描きの 途中で 月を 替えたら 古い 月の 絵は 後から 来ても 新しい 月の 枠に 入れない', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await hiraku(page);
  await osoku(page, [3000, 300]);
  await page.locator('#hnKikanSel').selectOption('1');
  await page.waitForFunction(() => window.__osoiN >= 1, null, { timeout: 30000 });
  const sel = page.locator('#hnTsukiSel');
  const i = await sel.evaluate((s) => s.selectedIndex);
  await sel.selectOption({ index: i + 1 });
  await kamiDekita(page);
  const no2 = await page.locator('#hnKami').getAttribute('data-hn-no');
  await page.waitForTimeout(3500); // 古い 月の 描きが 終わる まで 待つ
  expect(
    await page.locator('#hnKami').getAttribute('data-hn-no'),
    '★古い 月の 絵が 新しい 月の 枠に 入った★'
  ).toBe(no2);
});

test('⑤ 期間を 替える 間は 前の 絵を 覆いの 下に 残す（見本と 同じ・消して 空の 箱に しない）', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await hiraku(page);
  await osoku(page, [2500]);
  await page.locator('#hnKikanSel').selectOption('1');
  await expect(page.locator('#hnKami.inv-loading')).toHaveCount(1);
  expect(
    await page.locator('#hnKami.inv-loading .sheet-pdf canvas').count(),
    '★作る 間に 前の 絵が 消えた★'
  ).toBeGreaterThan(0);
  await kamiDekita(page);
});

test('⑥ 幅を 変えても 絵は 作り直さず 縮め直す だけ（右が 切れない）', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await hiraku(page);
  await page.evaluate(() => (window.__maeCv = document.querySelector('#hnKami canvas')));
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const out = document.getElementById('hnKami');
    const cv = document.querySelector('#hnKami canvas');
    return {
      onaji: cv === window.__maeCv,
      migi: Math.round(cv.getBoundingClientRect().right - out.getBoundingClientRect().right),
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(m.onaji, '★幅を 変えたら 絵を 作り直した★').toBe(true);
  expect(m.migi, '★右が 切れた★').toBeLessThanOrEqual(1);
  expect(m.page, '★ページが 横に 送られる★').toBeLessThanOrEqual(0);
});

test('⑦ 絵の 道具（pdf.js）が 読めない 時は 絵の 所に 訳（見本と 同じ「プレビュー作成に失敗：」）', async ({
  page,
}) => {
  await page.route('**/vendor/pdf.min.js', (r) => r.fulfill({ status: 404, body: '' }));
  await page.setViewportSize({ width: 390, height: 844 });
  await hiraku(page, null, null, true);
  await expect(page.locator('#hnKami .li-empty')).toContainText('プレビュー作成に失敗：');
  await expect(page.locator('#hnKami.inv-loading')).toHaveCount(0);
  // 押す PDF は 絵と 別＝押せば 保存できる（道具は pdf-lib）
  await expect(page.locator('#hnPdf')).toBeEnabled();
});
