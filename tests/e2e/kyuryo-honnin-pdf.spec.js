// ============================================================
// ★★本人の 明細を 自分で PDF に する（印刷 / 送る）★★ 2026-10-21／2026-10-29 作り直し
//
//   ★司さんの言葉★
//     「明細だが従業員が各々自由にPDFや印刷するボタンがない
//       代行請求書のように（毎回のミスをしない）自作でPDF（データの重さも）を作成するやり方をパクってつくれ」
//     2026-10-29「PDFで保存/送ると印刷のボタンは同じ画面が開かれるんやけん1つのボタンにして印刷/送るにまとめろ
//       給料明細の画面も一緒にしろや」「記録なくても押せる開くようにしろや」
//
//   ★今の 作り（代行請求書の「📄 印刷 / 送る」と 同じ 1つの ボタン）★
//     ブラウザ＝押すと PDF を 作って そのまま 保存（a の download＝見本の InvoicePDF.save と 同じ）・案内を ボタンの 下に
//     ホーム画面の アプリ＝紙を 描いた 時に 裏で 作っておき、押すと 同じ 保存（2026-10-30 前は 共有の 画面に 直に 渡し
//       iPhone で LINE が 並ばなかった＝司さん「LINEないやないか 代行請求書アプリみたんか？」）
//     前の 画面の 中の PDF の 窓（pdf.js）・「保存・送る」「印刷」「閉じる」は 無くした
//
//   ★ここで 見張る 事★
//     ①名前は 給料明細_年-月_期間_名前・中身は PDF・重さは 200kB より 下（司さんの 目安）
//     ②月・期間を 替えたら 作った PDF を 捨てる（前の 月の PDF を 渡さない）・作っている 途中に 替えても 渡さない
//     ③道具が 読めない・古い 時は 訳を 出して 押し直せる
//     ④計算が 転んだ 期から PDF を 渡さない
// ============================================================
const { test, expect } = require('@playwright/test');
const { hiraku, maeNoTsuki } = require('./honnin-harness');

// ★時計を 止める（⑦）なら 時間帯も 止める★（tests/unit/tokei-tomeru-nara-jikantai-mo.test.js・客は 日本に 居る）
test.use({ timezoneId: 'Asia/Tokyo' });

const BOTAN = '📄 印刷 / 送る';

async function kyouyuNise(page, _mode) {
  await page.addInitScript(() => {
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
    // 共有の 画面（使われたら 控える＝渡しては いけない）
    Object.defineProperty(navigator, 'canShare', {
      value: (d) => !!(d && d.files && d.files.length),
      configurable: true,
    });
    Object.defineProperty(navigator, 'share', {
      value: (d) => {
        window.__kyouyu.push(
          (d.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size }))
        );
        return Promise.resolve();
      },
      configurable: true,
    });
  });
}

async function homeApp(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
  });
}
const watashita = (page) =>
  page.evaluate(() => window.__kyouyu.length + window.__mado.length + window.__dl.length);

// ★選んでいる 月と 期間の 字★（名前の 比べる 相手＝上の 並びの 選ぶ 欄から 取る）
async function erabi(page) {
  const tsuki = (await page.locator('#hnTsukiSel').inputValue()).split('-');
  const ki = await page
    .locator('#hnKikanSel')
    .evaluate((s) => (s.selectedOptions[0] ? s.selectedOptions[0].textContent : ''));
  return { y: tsuki[0], m: String(tsuki[1]).padStart(2, '0'), ki };
}

// わざと壊す：「印刷 / 送る」を 2つの ボタンに 戻す／押して 窓だけ 開く ⇒ 赤
test('⓪ ボタンは「📄 印刷 / 送る」1つ・前の PDF の 窓と 3つの ボタンは 無い', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'ari');
  await hiraku(page);
  await expect(page.locator('#hnPdf')).toHaveText(BOTAN);
  await expect(page.locator('#hnPdf')).toBeEnabled();
  for (const id of ['hnPdfMiru', 'hnPdfOkuru', 'hnPdfInsatsu', 'hnPdfTojiru', 'hnCopy'])
    await expect(page.locator('#' + id), '★前の 物が 残っている: #' + id + '★').toHaveCount(0);
  // ★ボタンは #slips の 外（上の 並び）＝訳に 替えても 残る★
  await expect(page.locator('#hnBar #hnPdf')).toHaveCount(1);
});

// ★「印刷 / 送る」＝見本（代行請求書）と 同じ ダウンロード★ 2026-10-25（司さん「代行請求書アプリではちゃんとできるやろが」）
// わざと壊す：ブラウザで 共有の 画面（navigator.share）に 渡す ⇒ 赤（ダウンロードが 0）
test('① 1回 押すと 自分の 明細の PDF を ダウンロードする（名前・型・重さ・共有の 画面は 出さない）', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'ari');
  await hiraku(page);
  // ★1つの 月に 期間が 2つ以上 在る 会社は 選んだ 期間も 名前に★（同じ 名前の ファイルが 並ばない・対立役）
  //   見張りの 会社は 月3回＝選んだ 期間「10/1〜10/10」⇒「_10-01〜10-10」
  const e = await erabi(page);
  await page.click('#hnPdf');
  await expect.poll(() => page.evaluate(() => window.__dl.length), { timeout: 30000 }).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__dl[0].size)).toBeGreaterThan(0);
  const f = await page.evaluate(() => window.__dl[0]);
  expect(f.type).toBe('application/pdf');
  expect(f.href).toMatch(/^blob:/);
  expect(await page.evaluate(() => window.__kyouyu.length), '★共有の 画面に 直に 渡した★').toBe(0);
  await expect(page.locator('#hnPdfAnnai')).toContainText('LINE');
  const kk = e.ki.match(/(\d+)\/(\d+)〜(\d+)\/(\d+)/);
  expect(kk, '月3回の 会社で 期間の 選ぶ 欄が 無い').not.toBeNull();
  const p2 = (s) => String(s).padStart(2, '0');
  expect(f.name).toBe(
    '給料明細_' +
      e.y +
      '-' +
      e.m +
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
  expect(f.size, 'PDF が 空').toBeGreaterThan(1000);
  expect(f.size, '司さんの 目安 200kB を 超えた（字体を 丸ごと 埋めた？）').toBeLessThan(200000);
  expect(await page.evaluate(() => window.__mado.length), '保存で 窓を 開いた').toBe(0);
  // ★作り終わったら ボタンは 元の 字・もう一度 押すと 作り直さずに すぐ 保存★
  await expect(page.locator('#hnPdf')).toHaveText(BOTAN);
  await page.click('#hnPdf');
  await expect.poll(() => page.evaluate(() => window.__dl.length)).toBe(2);
});

// ★ホーム画面の アプリでも 見本（代行請求書）と 同じ 保存（ダウンロード）★ 2026-10-30
//   司さん「LINEないやないか 代行請求書アプリみたんか？」＝前は 共有の 画面に 直に 渡し、iPhone で LINE が 並ばなかった
//   わざと壊す：hnPdfDasu で ホーム画面の アプリだけ 共有の 画面に 渡す（前の 形）⇒ 赤（共有に 渡した・ダウンロード 0）
test('⑭ ホーム画面の アプリでも 押した その 時に PDF を 保存する（共有の 画面に 直に 渡さない）', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'ari');
  await homeApp(page);
  await hiraku(page);
  // 裏で 作り終わるのを 待つ（ボタンが 押せる＝作り終わった）
  await expect(page.locator('#hnPdf')).toHaveText(BOTAN, { timeout: 30000 });
  await expect(page.locator('#hnPdf')).toBeEnabled();
  await page.click('#hnPdf');
  await expect.poll(() => page.evaluate(() => window.__dl.length)).toBe(1);
  const k = await page.evaluate(() => window.__dl[0]);
  expect(k.type).toBe('application/pdf');
  expect(k.href).toMatch(/^blob:/);
  expect(k.name).toMatch(/^給料明細_\d{4}-\d{2}_.*_見張り太郎\.pdf$/);
  expect(
    await page.evaluate(() => window.__kyouyu.length),
    '★共有の 画面に 直に 渡した（LINE が 並ばない）★'
  ).toBe(0);
  expect(await page.evaluate(() => window.__mado.length), '★戻れない 窓を 開いた★').toBe(0);
  await expect(page.locator('#hnPdfAnnai')).toContainText('LINE');
  await expect(page.locator('#hnPdfAnnai')).not.toContainText('その他');
});

// ★裏の 作りが 失敗した 後に 1回 押せば 出る（ホーム画面の アプリ）★ 2026-10-30 対立役 止1
//   わざと壊す：honninPdf で ホーム画面は 作り終わっても 出さない（hnPdfTsukuru(!hnHomeApp())）⇒ 赤（保存 0）
test('⑭b ホーム画面の アプリで 裏の 作りが 失敗した 後、1回 押せば 保存する', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'ari');
  await homeApp(page);
  let otosu = 1;
  await page.route('**/js/kami-egaku.js', (r) => (otosu-- > 0 ? r.abort() : r.continue()));
  await hiraku(page);
  await expect(page.locator('#hnPdfErr')).toContainText('もう一度', { timeout: 30000 });
  await expect(page.locator('#hnPdf')).toBeEnabled();
  await page.click('#hnPdf');
  await expect.poll(() => page.evaluate(() => window.__dl.length), { timeout: 30000 }).toBe(1);
  expect(await page.evaluate(() => window.__kyouyu.length)).toBe(0);
  await expect(page.locator('#hnPdfAnnai')).toContainText('LINE');
});

// わざと壊す：honninTsuki で 作った PDF を 捨てない（hnPdfSuteru を 外す）⇒ 赤（前の 月の PDF を 渡す）
test('④ 月を 替えたら 作った PDF を 捨てる（前の 月を 渡さない）', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'ari');
  await hiraku(page);
  await page.click('#hnPdf');
  await expect.poll(() => page.evaluate(() => window.__dl.length), { timeout: 30000 }).toBe(1);
  const mae = await page.evaluate(() => window.__dl[0].name);
  await maeNoTsuki(page);
  await expect(page.locator('#hnKami .hn-kami-waku').first()).toBeVisible();
  const e = await erabi(page);
  await page.click('#hnPdf');
  await expect.poll(() => page.evaluate(() => window.__dl.length), { timeout: 30000 }).toBe(2);
  const f = await page.evaluate(() => window.__dl[1]);
  expect(f.name, '★前の 月の PDF を 渡した★').not.toBe(mae);
  expect(f.name).toContain('給料明細_' + e.y + '-' + e.m);
});

// ★期間を 替えた 時も 捨てる★
//   わざと壊す：honninKikan の hnPdfSuteru を 外す ⇒ 赤（前の 期間の 名前で 渡す）
test('④b 期間を 替えたら 作った PDF を 捨てる（前の 期間を 渡さない）', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'ari');
  await hiraku(page);
  await page.click('#hnPdf');
  await expect.poll(() => page.evaluate(() => window.__dl.length), { timeout: 30000 }).toBe(1);
  await page.locator('#hnKikanSel').selectOption('1');
  const e = await erabi(page);
  await page.click('#hnPdf');
  await expect.poll(() => page.evaluate(() => window.__dl.length), { timeout: 30000 }).toBe(2);
  const kk = e.ki.match(/(\d+)\/(\d+)〜(\d+)\/(\d+)/);
  const p2 = (s) => String(s).padStart(2, '0');
  expect(await page.evaluate(() => window.__dl[1].name)).toContain(
    '_' + p2(kk[1]) + '-' + p2(kk[2]) + '〜' + p2(kk[3]) + '-' + p2(kk[4]) + '_'
  );
});

// わざと壊す：守りは 3つ（道具を 読んだ 直後・できた 時・HN_PDF の 印）＝3つ 全部 外す ⇒ 赤
//   （新しい 月の 画面で 前の 月の PDF を 保存する）
test('⑤ 作っている 途中で 月を 替えたら できた PDF を 捨てる（保存しない）', async ({ page }) => {
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
  await maeNoTsuki(page);
  await expect(page.locator('#hnPdf')).toHaveText(BOTAN);
  tomeru = false; // 前の 月の 分が できあがる
  await page.waitForTimeout(3000);
  expect(await watashita(page), '★前の 月の PDF を 渡した★').toBe(0);
  await expect(page.locator('#hnPdf')).toHaveText(BOTAN);
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
  await expect(page.locator('#hnPdf')).toHaveText(BOTAN);
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

// ★★本人の 画面の 計算が 転んだら 前の 期の 紙を 出さず PDF も 作らない★★ 2026-10-22
//   前：期の 札（honninKikan）・月の 送り（honninTsuki）の 計算に 受け皿が 無く、転ぶと 前の 期の 紙と 札が 残り、
//       PDF の ボタンが 生きて いて「給料明細_…_10-11〜10-20_…」の 名前で 前の 期の 額の PDF を 共有の 画面へ 渡した（対立役）
//   2026-10-29：札 → 期間の 選ぶ 欄・◀ → 月の 選ぶ 欄。ボタンは #slips の 外に 残る＝押しても 渡さない を 見る
//   ★わざと壊して 赤（2026-10-22 実測）★ 直す 前の kyuryo.html … 4本 赤（紙が 残る・PDF を 渡した）
for (const [na, w] of [
  ['期間の 欄', 'buildCtx'],
  ['期間の 欄', 'report'],
  ['月の 欄', 'buildCtx'],
  ['月の 欄', 'report'],
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
    // 開いた 時は 1つ目の 期（月3回）＝別の 期（2つ目）を 選ぶ（今と 同じ 期だと「別の 期の 名前」の 形を 作れない・対立役 K3）
    await expect(page.locator('#hnKikanSel')).toHaveValue('0');
    if (na === '期間の 欄') await page.locator('#hnKikanSel').selectOption('1');
    else await maeNoTsuki(page);
    await page.waitForTimeout(800);
    // PDF の ボタンが 押せれば 2回 押して みる（渡しては いけない）
    for (let k = 0; k < 2; k++) {
      if (
        await page
          .locator('#hnPdf')
          .isEnabled()
          .catch(() => false)
      ) {
        await page.click('#hnPdf');
        await page.waitForTimeout(1500);
      }
    }
    expect(await watashita(page), '★計算が 転んだ 期から PDF を 渡した★').toBe(0);
    await expect(page.locator('#slips'), '★計算が 転んだ 訳が 出ない★').toContainText(
      '計算できませんでした'
    );
    expect(
      await page.locator('#hnKami .hn-kami-waku').count(),
      '★計算が 転んだのに 前の 期の 紙が 残った★'
    ).toBe(0);
    // 画面の 幅を 変えた 描き直しでも 前の 期の 紙を 出さない
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    expect(await page.locator('#hnKami .hn-kami-waku').count()).toBe(0);
  });
}

// ★★月の 読み終わりで 計算 以外 が 転んでも 黙って「読み込み中…」で 止めない★★ 2026-10-22（対立役 K2）
for (const [na, w] of [
  ['期の 区切り', 'PayrollPeriod.periodsOf'],
  ['設定の 読み', 'PayrollDaily.normSettings'],
]) {
  test(`★月の 欄で ${na}（${w}）が 転んでも 訳を 出して 止める★`, async ({ page }) => {
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
    await maeNoTsuki(page);
    await expect(page.locator('#slips'), '★黙って「読み込み中…」の まま★').toContainText(
      '計算できませんでした',
      { timeout: 5000 }
    );
    expect(await page.locator('#hnKami .hn-kami-waku').count()).toBe(0);
    // 訳に 替えても 月は 選べる（上の 並びは #slips の 外・対立役 止4）
    await expect(page.locator('#hnTsukiSel')).toBeVisible();
  });
}
