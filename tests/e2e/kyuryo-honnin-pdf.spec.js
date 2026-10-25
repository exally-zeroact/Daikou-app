// ============================================================
// ★★本人の 明細を 自分で PDF に する（保存・印刷）★★ 2026-10-21
//
//   ★司さんの言葉★
//     「明細だが従業員が各々自由にPDFや印刷するボタンがない
//       代行請求書のように（毎回のミスをしない）自作でPDF（データの重さも）を作成するやり方をパクってつくれ」
//
//   ★ここで 見張る 事★
//     ①1回 押すと 画面の 中に PDF を 開く・「保存・送る」は 見本と 同じ ダウンロード（ホーム画面の アプリは 共有の 画面）2026-10-25
//       名前は 給料明細_年-月_名前・中身は PDF・重さは 200kB より 下（司さんの 目安）
//     ②共有が 無い 端末は 新しい 窓で 開く（画面は 動かない）
//     ③共有の 画面を 閉じた（AbortError）時は 窓を 二重に 開かない
//     ④月を 替えたら 作った PDF を 捨てる（前の 月の PDF を 渡さない）
//
//   ★わざと壊して 赤に なる 事を 見る★（直した 時の 紙に 数を 書く）
// ============================================================
const { test, expect } = require('@playwright/test');
const { hiraku } = require('./honnin-harness');

// ★時計を 止める（⑦）なら 時間帯も 止める★（tests/unit/tokei-tomeru-nara-jikantai-mo.test.js・客は 日本に 居る）
test.use({ timezoneId: 'Asia/Tokyo' });

async function kyouyuNise(page, mode) {
  await page.addInitScript((m) => {
    window.__kyouyu = [];
    window.__mado = [];
    // ★ダウンロード（a の download）を 控える★（見本の InvoicePDF.save と 同じ 道・本物の 保存は しない）
    window.__dl = [];
    HTMLAnchorElement.prototype.click = function () {
      const rec = { name: this.download, target: this.target, href: this.href, size: -1, type: '' };
      window.__dl.push(rec);
      if (String(this.href).indexOf('blob:') === 0)
        fetch(this.href)
          .then((r) => r.blob())
          .then((b) => {
            rec.size = b.size;
            rec.type = b.type;
          });
    };
    const open0 = window.open;
    window.open = function (u) {
      window.__mado.push(String(u));
      return { closed: false };
    };
    void open0;
    if (m === 'nashi') {
      try {
        delete Navigator.prototype.share;
        delete Navigator.prototype.canShare;
      } catch (_) {
        /* 消せない 端末 */
      }
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
      return;
    }
    Object.defineProperty(navigator, 'canShare', {
      value: (d) => !!(d && d.files && d.files.length),
      configurable: true,
    });
    Object.defineProperty(navigator, 'share', {
      value: (d) => {
        window.__kyouyu.push(
          (d.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size }))
        );
        if (m === 'futatabi') {
          const e = new Error('開いている 間に もう一度');
          e.name = 'InvalidStateError';
          return Promise.reject(e);
        }
        if (m === 'tojita') {
          const e = new Error('閉じた');
          e.name = 'AbortError';
          return Promise.reject(e);
        }
        return Promise.resolve();
      },
      configurable: true,
    });
  }, mode || 'ari');
}

// ★1回 押すと PDF を 作り、画面の 中に PDF の 絵を 開く★（2026-10-25 司さん「代行請求書アプリを見本に」）
async function homeApp(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
  });
}
async function tsukuru(page) {
  await expect(page.locator('#hnPdf')).toHaveText('PDFを 開く（保存・印刷）');
  await page.click('#hnPdf');
  await expect(page.locator('#hnPdfMiru .hn-pdf-miru-kami').first()).toBeVisible({
    timeout: 30000,
  });
}

// わざと壊す：作った 後に hnPdfMiseru を 呼ばない ⇒ 赤（PDF が 開かない＝10-25 司さんの 絵の 形）
test('⓪ 1回 押すと 画面の 中に PDF そのものが 開く（新しい 窓・共有の 画面は 出さない）', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'ari');
  await hiraku(page);
  await tsukuru(page);
  const e = await page.evaluate(() => {
    const cv = document.querySelector('#hnPdfMiru .hn-pdf-miru-kami');
    // 絵に 字が 描かれて いるか（真っ白で ない 点を 数える）
    const x = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let kuro = 0;
    for (let i = 0; i < x.length; i += 4) if (x[i] < 128) kuro++;
    return { w: cv.width, h: cv.height, kuro, page: cv.getAttribute('data-page') };
  });
  expect(e.page).toBe('1');
  // A4（縦でも 横でも 長い 辺÷短い 辺＝約 1.41）
  const hi = Math.max(e.w, e.h) / Math.min(e.w, e.h);
  expect(hi, 'A4 の 形で ない').toBeGreaterThan(1.38);
  expect(hi).toBeLessThan(1.44);
  expect(e.kuro, '★PDF の 絵が 真っ白★').toBeGreaterThan(500);
  await expect(page.locator('#hnPdfOkuru')).toHaveText('保存・送る');
  await expect(page.locator('#hnPdfInsatsu')).toHaveText('印刷');
  await expect(page.locator('#hnPdfTojiru')).toHaveText('閉じる');
  expect(await page.evaluate(() => window.__kyouyu.length + window.__mado.length)).toBe(0);
});

// ★「保存・送る」＝見本（代行請求書）と 同じ ダウンロード★ 2026-10-25（司さん「送るからなぜLINEが使えない？
//   やり方間違えてるのでは？代行請求書アプリではちゃんとできるやろが」＝共有の 画面に 直に 渡すと LINE が 出ない）
// わざと壊す：「保存・送る」を 前の hnPdfWatasu（共有の 画面）に 戻す ⇒ 赤（ダウンロードが 0）
test('① 「保存・送る」で 自分の 明細の PDF を ダウンロードする（名前・型・重さ・共有の 画面は 出さない）', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'ari');
  await hiraku(page);
  const tsuki = (await page.locator('#hnTsukiJi').innerText()).match(/(\d+)年\s*(\d+)月/);
  // ★1つの 月に 期間が 2つ以上 在る 会社は 選んだ 期間も 名前に★（同じ 名前の ファイルが 並ばない・対立役）
  //   見張りの 会社は 月3回＝選んだ チップ「10/1〜10/10」⇒「_10-01〜10-10」
  const chip = await page.locator('.hn-chip.on').innerText();
  await tsukuru(page);
  await page.click('#hnPdfOkuru');
  await expect.poll(() => page.evaluate(() => window.__dl.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__dl[0].size)).toBeGreaterThan(0);
  const f = [await page.evaluate(() => window.__dl[0])];
  expect(f[0].type).toBe('application/pdf');
  expect(f[0].href).toMatch(/^blob:/);
  expect(await page.evaluate(() => window.__kyouyu.length), '★共有の 画面に 直に 渡した★').toBe(0);
  await expect(page.locator('#hnPdfMiruMsg')).toContainText('LINE');
  const kk = chip.match(/(\d+)\/(\d+)〜(\d+)\/(\d+)/);
  expect(kk, '月3回の 会社で 期間の チップが 無い').not.toBeNull();
  const p2 = (s) => String(s).padStart(2, '0');
  expect(f[0].name).toBe(
    '給料明細_' +
      tsuki[1] +
      '-' +
      p2(tsuki[2]) +
      '_' +
      p2(kk[1]) +
      '-' +
      p2(kk[2]) +
      '〜' +
      p2(kk[3]) +
      '-' +
      p2(kk[4]) +
      '_見張り太郎.pdf'
  );
  expect(f[0].size, 'PDF が 空').toBeGreaterThan(1000);
  expect(f[0].size, '司さんの 目安 200kB を 超えた（字体を 丸ごと 埋めた？）').toBeLessThan(200000);
  expect(await page.evaluate(() => window.__mado.length), '保存で 窓を 開いた').toBe(0);
});

// ★ホーム画面の アプリでは「保存・送る」は 共有の 画面（アプリの 中で ダウンロードすると 戻れなく なる）★
//   わざと壊す：「保存・送る」の hnHomeApp の 分かれを 外す ⇒ 赤（ダウンロードした）
test('⑭ ホーム画面の アプリでは「保存・送る」は 共有の 画面（ダウンロードしない）', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'ari');
  await homeApp(page);
  await hiraku(page);
  await tsukuru(page);
  await page.click('#hnPdfOkuru');
  await expect.poll(() => page.evaluate(() => window.__kyouyu.length)).toBe(1);
  expect(await page.evaluate(() => window.__dl.length), '★アプリの 中で ダウンロードした★').toBe(0);
  await expect(page.locator('#hnPdfMiruMsg')).toContainText('その他');
});

// わざと壊す：共有が 無い 時の 控えを 外す ⇒ 赤（何も 開かない）
test('② 共有が 無い ホーム画面の アプリは「印刷」で 新しい 窓に PDF を 開き、案内を PDF の 画面の 上に 出す', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'nashi');
  await homeApp(page);
  await hiraku(page);
  await tsukuru(page);
  await page.click('#hnPdfInsatsu');
  await expect.poll(() => page.evaluate(() => window.__mado.length)).toBe(1);
  expect(await page.evaluate(() => window.__mado[0])).toMatch(/^blob:/);
  // 窓に 落ちる 時は 必ず 案内（LINE の 中 等で 黙って 何も 起きない まま に しない・対立役 直2）
  await expect(page.locator('#hnPdfMiruMsg')).toContainText('Safari か Chrome');
});

// わざと壊す：AbortError でも 窓を 開く ⇒ 赤（二重に 出る）
test('③ 共有の 画面を 閉じた 時は 窓を 開かない（ホーム画面の アプリの 印刷）', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'tojita');
  await homeApp(page);
  await hiraku(page);
  await tsukuru(page);
  await page.click('#hnPdfInsatsu');
  await expect.poll(() => page.evaluate(() => window.__kyouyu.length)).toBe(1);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__mado.length)).toBe(0);
});

// わざと壊す：honninKami で 作った PDF を 捨てない ⇒ 赤（前の 月の PDF を 渡す）
test('④ 月を 替えたら 作った PDF を 捨てる（前の 月を 渡さない）', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'ari');
  await hiraku(page);
  await tsukuru(page);
  await page.click('#hnPdfTojiru');
  await page.click('#hnMae');
  await expect(page.locator('#hnPdf')).toHaveText('PDFを 開く（保存・印刷）');
  const tsuki = (await page.locator('#hnTsukiJi').innerText()).match(/(\d+)年\s*(\d+)月/);
  await tsukuru(page);
  await page.click('#hnPdfOkuru');
  await expect.poll(() => page.evaluate(() => window.__dl.length)).toBe(1);
  const f = await page.evaluate(() => window.__dl[0]);
  expect(f.name).toContain('給料明細_' + tsuki[1] + '-' + String(tsuki[2]).padStart(2, '0'));
});

// わざと壊す：守りは 3つ（道具を 読んだ 直後・できた 時・HN_PDF の 印）＝3つ 全部 外す ⇒ 赤
//   （新しい 月の 画面に 前の 月の PDF が 開く）
test('⑤ 作っている 途中で 月を 替えたら できた PDF を 捨てる（開かない）', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'ari');
  let tomeru = true;
  await page.route('**/js/kami-egaku.js', async (r) => {
    while (tomeru) await new Promise((res) => setTimeout(res, 100));
    return r.continue();
  });
  await hiraku(page);
  await page.click('#hnPdf');
  await expect(page.locator('#hnPdf')).toHaveText('PDFを 作っています…');
  await page.click('#hnMae');
  await expect(page.locator('#hnPdf')).toHaveText('PDFを 開く（保存・印刷）');
  tomeru = false; // 前の 月の 分が できあがる
  await page.waitForTimeout(3000);
  await expect(page.locator('#hnPdfMiru'), '★前の 月の PDF を 開いた★').toHaveCount(0);
  await expect(page.locator('#hnPdf')).toHaveText('PDFを 開く（保存・印刷）');
  expect(await page.evaluate(() => window.__kyouyu.length)).toBe(0);
});

// わざと壊す：InvalidStateError を 閉じた 扱いに しない ⇒ 赤（窓が 二重に 出る）
test('⑥ 共有の 画面を 開いている 間に もう一度 押しても 窓を 開かない（ホーム画面の アプリの 印刷）', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'futatabi');
  await homeApp(page);
  await hiraku(page);
  await tsukuru(page);
  await page.click('#hnPdfInsatsu');
  await expect.poll(() => page.evaluate(() => window.__kyouyu.length)).toBe(1);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__mado.length)).toBe(0);
});

// わざと壊す：道具の 読み込みの 時間切れを 外す ⇒ 赤（「作っています…」の まま）
test('⑦ 道具の 読み込みが 返らない 時は 時間切れで 訳を 出し 押し直せる', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'ari');
  await page.route('**/js/kami-egaku.js', () => {
    /* 返さない（電波が 止まった） */
  });
  await hiraku(page);
  await page.clock.install();
  await page.click('#hnPdf');
  await expect(page.locator('#hnPdf')).toHaveText('PDFを 作っています…');
  await page.clock.runFor(31000);
  await expect(page.locator('#hnPdfErr')).toContainText('道具を 読めませんでした');
  await expect(page.locator('#hnPdf')).toHaveText('PDFを 開く（保存・印刷）');
  await expect(page.locator('#hnPdf')).toBeEnabled();
});

// わざと壊す：「道具が 古い」の 訳を 外す ⇒ 赤（「もう一度 押して」と 出る＝押しても 直らない）
test('⑧ 道具が 古い（tsukuru が 無い）時は 開き直しを 頼む', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'ari');
  await page.route('**/js/kami-egaku.js', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.KamiEgaku = { yomu: function () { return Promise.resolve(); }, dasu: function () {} };',
    })
  );
  await hiraku(page);
  await page.click('#hnPdf');
  await expect(page.locator('#hnPdfErr')).toContainText('開き直して');
});

// ★「印刷」★ ブラウザでは PDF を 新しい 窓で 開く（見本の 代行請求書の 印刷と 同じ）
//   わざと壊す：印刷で window.open を 呼ばない ⇒ 赤／窓を 開いた 時の 案内を 外す ⇒ 赤
test('⑨ 「印刷」は PDF を 新しい 窓で 開く（共有の 画面は 出さない）', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'ari');
  await hiraku(page);
  await tsukuru(page);
  await page.click('#hnPdfInsatsu');
  await expect.poll(() => page.evaluate(() => window.__mado.length)).toBe(1);
  expect(await page.evaluate(() => window.__mado[0])).toMatch(/^blob:/);
  expect(await page.evaluate(() => window.__kyouyu.length)).toBe(0);
  // 窓を 開いた 時も 案内（LINE の 中では 黙って 開かない 事が 在る・対立役 S1）
  await expect(page.locator('#hnPdfMiruMsg')).toContainText('Safari か Chrome');
});

// ★ホーム画面に 置いた アプリ（新しい 窓を 開くと 戻れない）は「印刷」も 共有の 画面（の プリント）★
//   わざと壊す：hnHomeApp を 見ずに いつも 窓を 開く ⇒ 赤（窓が 開いた）
test('⑩ ホーム画面の アプリでは「印刷」が 共有の 画面を 出し、窓は 開かない', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'ari');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
  });
  await hiraku(page);
  await tsukuru(page);
  await page.click('#hnPdfInsatsu');
  await expect.poll(() => page.evaluate(() => window.__kyouyu.length)).toBe(1);
  expect(await page.evaluate(() => window.__mado.length), '★戻れない 窓を 開いた★').toBe(0);
  await expect(page.locator('#hnPdfMiruMsg')).toContainText('プリント');
});

// ★「閉じる」で 明細に 戻る・後ろの 巻きも 戻る・もう一度 押すと 作り直さずに 開く★
//   わざと壊す：hnPdfTojiru で overflow を 戻さない ⇒ 赤（明細が 巻けない）
test('⑪ 「閉じる」で 明細に 戻り、もう一度 押すと すぐ 開く', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'ari');
  await hiraku(page);
  await tsukuru(page);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await page.click('#hnPdfTojiru');
  await expect(page.locator('#hnPdfMiru')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  await page.click('#hnPdf');
  await expect(page.locator('#hnPdfMiru .hn-pdf-miru-kami').first()).toBeVisible({
    timeout: 10000,
  });
});

// ★pdf.js が 読めない（電波）時も 保存・送る・印刷は 使える★（PDF は もう できている）
//   わざと壊す：hnPdfMiseru の catch で 訳を 出さない ⇒ 赤
test('⑫ PDF の 絵の 道具が 読めない 時は 訳を 出し、「保存・送る」は 使える', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'ari');
  await page.route('**/vendor/pdf.min.js', (r) => r.abort());
  await hiraku(page);
  await page.click('#hnPdf');
  await expect(page.locator('#hnPdfMiruMsg')).toContainText('画面に 出せませんでした', {
    timeout: 30000,
  });
  await page.click('#hnPdfOkuru');
  await expect.poll(() => page.evaluate(() => window.__dl.length)).toBe(1);
});

// ★何回 開いても pdf.js の 裏の 仕事（worker）が 増え続けない★（対立役 N1：前は 開く たびに 1つずつ 増えた）
//   わざと壊す：hnPdfMiseru の pdf.destroy を 外す ⇒ 赤（4つに 増える）
test('⑬ 4回 開いて 閉じても pdf.js の worker は 1つを 超えない', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'ari');
  await hiraku(page);
  for (let k = 0; k < 4; k++) {
    await page.click('#hnPdf');
    await expect(page.locator('#hnPdfMiru .hn-pdf-miru-kami').first()).toBeVisible({
      timeout: 30000,
    });
    await page.click('#hnPdfTojiru');
  }
  await page.waitForTimeout(500);
  expect(page.workers().length, '★worker が 増え続けた★').toBeLessThanOrEqual(1);
});

// ★★本人の 画面の 計算が 転んだら 前の 期の 紙を 出さず PDF も 作らない★★ 2026-10-22
//   前：期の 札（honninKikan）・月の 送り（honninTsuki）の 計算に 受け皿が 無く、転ぶと 前の 期の 紙と 札が 残り、
//       PDF の ボタンが 生きて いて「給料明細_…_10-11〜10-20_…」の 名前で 前の 期の 額の PDF を 共有の 画面へ 渡した（対立役）
//   ★わざと壊して 赤（2026-10-22 実測）★ 直す 前の kyuryo.html … 4本 赤（紙が 残る・PDF を 渡した）
for (const [na, w] of [
  ['期の 札', 'buildCtx'],
  ['期の 札', 'report'],
  ['月の 送り', 'buildCtx'],
  ['月の 送り', 'report'],
]) {
  test(`★${na} で 計算（${w}）が 転んだら 前の 期の 紙を 出さず PDF も 作らない★`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 430, height: 900 });
    await kyouyuNise(page);
    await page.clock.setFixedTime(new Date('2026-10-15T12:00:00+09:00'));
    await hiraku(page);
    await page.evaluate((x) => {
      const P = window.PayrollDaily;
      P[x] = function () {
        throw new Error('見張り');
      };
    }, w);
    // 開いた 時は 1つ目の 期（月3回）＝別の 期（2つ目）を 押す（今と 同じ 期を 押すと「別の 期の 名前」の 形を 作れない・対立役 K3）
    await expect(page.locator('#slips .hn-chip.on')).toHaveAttribute('data-k', '0');
    if (na === '期の 札') await page.locator('#slips .hn-chip').nth(1).click();
    else await page.click('#hnMae');
    await page.waitForTimeout(800);
    // PDF の ボタンが 残って いれば 2回 押して みる（渡しては いけない）
    for (let k = 0; k < 2; k++) {
      if (await page.locator('#hnPdf').count()) {
        await page.click('#hnPdf');
        await page.waitForTimeout(1500);
      }
    }
    expect(
      await page.evaluate(() => window.__kyouyu.length + window.__mado.length),
      '★計算が 転んだ 期から PDF を 渡した★'
    ).toBe(0);
    await expect(page.locator('#slips'), '★計算が 転んだ 訳が 出ない★').toContainText(
      '計算できませんでした'
    );
    expect(
      await page.locator('#hnKami .hn-kami-waku').count(),
      '★計算が 転んだのに 前の 期の 紙が 残った★'
    ).toBe(0);
    // 画面の 幅を 変えた 描き直しでも 前の 期の 紙を 出さない
    //   ※ 2重目の 守り（honninKami の 頭・honninPdf の 止め・REP を 捨てる）は 今の 客の 道からは 届かない（訳の 字が #slips を
    //     置き換え #hnKami・#hnPdf が 消える）＝この 試験が 縛るのは 訳の 字で 置き換える 所だけ（対立役 D1）
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    expect(await page.locator('#hnKami .hn-kami-waku').count()).toBe(0);
  });
}

// ★★月の 送りの 読み終わりで 計算 以外 が 転んでも 黙って「読み込み中…」で 止めない★★ 2026-10-22（対立役 K2）
for (const [na, w] of [
  ['期の 区切り', 'PayrollPeriod.periodsOf'],
  ['設定の 読み', 'PayrollDaily.normSettings'],
]) {
  test(`★月の 送りで ${na}（${w}）が 転んでも 訳を 出して 止める★`, async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 900 });
    await kyouyuNise(page);
    await page.clock.setFixedTime(new Date('2026-10-15T12:00:00+09:00'));
    await hiraku(page);
    await page.evaluate((x) => {
      const [o, f] = x.split('.');
      window[o][f] = function () {
        throw new Error('見張り');
      };
    }, w);
    await page.click('#hnMae');
    await expect(page.locator('#slips'), '★黙って「読み込み中…」の まま★').toContainText(
      '計算できませんでした',
      { timeout: 5000 }
    );
    expect(await page.locator('#hnKami .hn-kami-waku').count()).toBe(0);
  });
}
