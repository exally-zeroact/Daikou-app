// ============================================================
// ★★本人の 明細を 自分で PDF に する（保存・印刷）★★ 2026-10-21
//
//   ★司さんの言葉★
//     「明細だが従業員が各々自由にPDFや印刷するボタンがない
//       代行請求書のように（毎回のミスをしない）自作でPDF（データの重さも）を作成するやり方をパクってつくれ」
//
//   ★ここで 見張る 事★
//     ①1回目に 押すと 作り、2回目に 押すと 共有の 画面（iPhone＝保存・印刷・LINE）に 1つの PDF を 渡す
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

async function tsukuru(page) {
  await expect(page.locator('#hnPdf')).toHaveText('PDFで 保存・印刷');
  await page.click('#hnPdf');
  await expect(page.locator('#hnPdf')).toHaveText('PDFを 開く（保存・印刷）', { timeout: 30000 });
}

// わざと壊す：2回目の 押しで share を 呼ばない ⇒ 赤（渡した 数が 0）
test('① 2回 押すと 共有の 画面に 自分の 明細の PDF を 1つ 渡す（名前・型・重さ）', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'ari');
  await hiraku(page);
  const tsuki = (await page.locator('#hnTsukiJi').innerText()).match(/(\d+)年\s*(\d+)月/);
  await tsukuru(page);
  await page.click('#hnPdf');
  await expect.poll(() => page.evaluate(() => window.__kyouyu.length)).toBe(1);
  const f = await page.evaluate(() => window.__kyouyu[0]);
  expect(f.length).toBe(1);
  expect(f[0].type).toBe('application/pdf');
  // ★1つの 月に 期間が 2つ以上 在る 会社は 選んだ 期間も 名前に★（同じ 名前の ファイルが 並ばない・対立役）
  //   見張りの 会社は 月3回＝選んだ チップ「10/1〜10/10」⇒「_10-01〜10-10」
  const chip = await page.locator('.hn-chip.on').innerText();
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
  expect(await page.evaluate(() => window.__mado.length), '共有できる 時に 窓を 開いた').toBe(0);
});

// わざと壊す：共有が 無い 時の 控えを 外す ⇒ 赤（何も 開かない）
test('② 共有が 無い 端末は 新しい 窓で PDF を 開く', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'nashi');
  await hiraku(page);
  await tsukuru(page);
  await page.click('#hnPdf');
  await expect.poll(() => page.evaluate(() => window.__mado.length)).toBe(1);
  expect(await page.evaluate(() => window.__mado[0])).toMatch(/^blob:/);
  // 窓に 落ちる 時は 必ず 案内（LINE の 中 等で 黙って 何も 起きない まま に しない・対立役 直2）
  await expect(page.locator('#hnPdfErr')).toContainText('Safari か Chrome');
});

// わざと壊す：AbortError でも 窓を 開く ⇒ 赤（二重に 出る）
test('③ 共有の 画面を 閉じた 時は 窓を 開かない', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'tojita');
  await hiraku(page);
  await tsukuru(page);
  await page.click('#hnPdf');
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
  await page.click('#hnMae');
  await expect(page.locator('#hnPdf')).toHaveText('PDFで 保存・印刷');
  const tsuki = (await page.locator('#hnTsukiJi').innerText()).match(/(\d+)年\s*(\d+)月/);
  await tsukuru(page);
  await page.click('#hnPdf');
  await expect.poll(() => page.evaluate(() => window.__kyouyu.length)).toBe(1);
  const f = await page.evaluate(() => window.__kyouyu[0][0]);
  expect(f.name).toContain('給料明細_' + tsuki[1] + '-' + String(tsuki[2]).padStart(2, '0'));
});

// わざと壊す：守りは 3つ（道具を 読んだ 直後・できた 時・HN_PDF の 印）＝1つ 外しても 緑・3つ 全部 外す ⇒ 赤
//   （新しい 月の 画面で 前の 月の PDF を「開く」・2026-10-21 測った）
test('⑤ 作っている 途中で 月を 替えたら できた PDF を 捨てる', async ({ page }) => {
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
  await expect(page.locator('#hnPdf')).toHaveText('PDFで 保存・印刷');
  tomeru = false; // 前の 月の 分が できあがる
  await page.waitForTimeout(3000);
  await expect(page.locator('#hnPdf')).toHaveText('PDFで 保存・印刷');
  expect(await page.evaluate(() => window.__kyouyu.length)).toBe(0);
});

// わざと壊す：InvalidStateError を 閉じた 扱いに しない ⇒ 赤（窓が 二重に 出る）
test('⑥ 共有の 画面を 開いている 間に もう一度 押しても 窓を 開かない', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'futatabi');
  await hiraku(page);
  await tsukuru(page);
  await page.click('#hnPdf');
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
  await expect(page.locator('#hnPdf')).toHaveText('PDFで 保存・印刷');
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
