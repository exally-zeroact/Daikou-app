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
//     ホーム画面の アプリ＝押すと 同じ 保存（2026-10-30 前は 共有の 画面に 直に 渡し
//       iPhone で LINE が 並ばなかった＝司さん「LINEないやないか 代行請求書アプリみたんか？」）
//     どの 端末も 紙を 描いた 時に 裏で 作っておく。裏で 作る 間も ボタンは「📄 印刷 / 送る」の まま 押せる・押して 待つ 間だけ
//       「PDF作成中…」（見本 exportInvoicePDF と 同じ・2026-10-31 司さん「なんなんPDFを作ってますって 代行請求書アプリの請求/集計の作りを見ろや」）
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
const MATSU = 'PDF作成中…';

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
  await expect(page.locator('#hnPdf')).toHaveText(BOTAN);
  await expect(page.locator('#hnPdf')).toBeEnabled();
  await page.click('#hnPdf');
  await expect.poll(() => page.evaluate(() => window.__dl.length), { timeout: 30000 }).toBe(1);
  // ★型と 重さは blob を 読み終わってから 入る（①と 同じく 待つ・本番 CI で 1回目だけ 空で 揺れた 10-30）★
  await expect.poll(() => page.evaluate(() => window.__dl[0].size)).toBeGreaterThan(0);
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
//   わざと壊す：honninPdf で 裏で 作っている 時は 待たずに 返す（HN_PDF_MATSU を 立てない）⇒ 赤（保存 0）
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

// ★★裏で 作っている 間も ボタンは「📄 印刷 / 送る」の まま 押せる★★ 2026-10-31（見本＝代行請求書の 請求書の 欄）
//   司さん「なんなんPDFを作ってますって 代行請求書アプリの請求/集計の作りを見ろや」
//   ＝前は ホーム画面の アプリで 紙を 描いた とたん 裏の 作りで「PDFを 作っています…」に なり 押せなかった
//   わざと壊す：hnPdfJi・hnPdfBotan を 裏の 作り（HN_PDF_CHU）で 見る 前の 形に 戻す ⇒ 赤（字が「作っています」・押せない）
for (const [na, home] of [
  ['ホーム画面の アプリ', true],
  ['ブラウザ', false],
]) {
  test(`⑮ ${na}：裏で 作っている 間も「印刷 / 送る」の まま 押せて、押すと「PDF作成中…」→ 出来たら 保存`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 430, height: 900 });
    await kyouyuNise(page, 'ari');
    if (home) await homeApp(page);
    let tomeru = true;
    let yomareta = 0;
    await page.route('**/js/kami-egaku.js', async (r) => {
      yomareta++;
      while (tomeru) await new Promise((res) => setTimeout(res, 100));
      return r.continue();
    });
    await hiraku(page);
    // ★押す 前から 裏で 作り始めている★（道具を 取りに 行った）
    await expect.poll(() => yomareta, { timeout: 10000 }).toBeGreaterThan(0);
    await expect(page.locator('#hnPdf')).toHaveText(BOTAN);
    await expect(page.locator('#hnPdf')).toBeEnabled();
    await expect(page.locator('#hnBar')).not.toContainText('作っています');
    await page.click('#hnPdf');
    await expect(page.locator('#hnPdf')).toHaveText(MATSU);
    expect(await watashita(page), '★出来る 前に 渡した★').toBe(0);
    tomeru = false;
    await expect.poll(() => page.evaluate(() => window.__dl.length), { timeout: 30000 }).toBe(1);
    await expect(page.locator('#hnPdf')).toHaveText(BOTAN);
    await expect(page.locator('#hnPdf')).toBeEnabled();
    expect(await page.evaluate(() => window.__kyouyu.length)).toBe(0);
  });
}

// ★★裏で 作り終わった 後に 押すと、押した その 手の 中で すぐ 保存★★ 2026-10-31（対立役 任意B：一番 多く 通る 道）
//   iPhone は 押した 手の 中の 保存が 一番 確か（await の 後は 黙る 事が ある）＝作り終わりを 待ってから 押して、
//   click() から 戻った その 時に 保存 1 を 見る
//   わざと壊す：honninPdf の hnPdfAru() の 道を 外す（毎回 作り直して 待つ）⇒ 赤（押した 時は 保存 0）
test('⑯ 裏で 作り終わった 後に 押すと 押した その 時に 保存する（待たない）', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'ari');
  await homeApp(page);
  // ★作り終わりの 印★（道具の tsukuru が 返したら 数える＝画面の 中の 変数は 外から 見えない）
  await page.route('**/js/kami-egaku.js', async (r) => {
    const res = await r.fetch();
    const body =
      (await res.text()) +
      ';(function(){var t=window.KamiEgaku.tsukuru;window.KamiEgaku.tsukuru=function(){return t.apply(this,arguments).then(function(d){window.__dekita=(window.__dekita||0)+1;return d;});};})();';
    await r.fulfill({ response: res, body });
  });
  await hiraku(page);
  await expect
    .poll(() => page.evaluate(() => window.__dekita || 0), { timeout: 30000 })
    .toBeGreaterThan(0);
  expect(await watashita(page), '★押す 前に 渡した★').toBe(0);
  const sugu = await page.evaluate(() => {
    document.getElementById('hnPdf').click();
    return { dl: window.__dl.length, ji: document.getElementById('hnPdf').textContent };
  });
  expect(sugu.dl, '★押した 手の 中で 保存して いない★').toBe(1);
  expect(sugu.ji).toBe(BOTAN);
  expect(await page.evaluate(() => window.__kyouyu.length)).toBe(0);
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
  await expect(page.locator('#hnPdf')).toHaveText(MATSU);
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
  // ★時計は 開く 前に★（紙を 描いた 時に 裏の 作りが 始まる＝その 時間切れも 進めた 時計で 切る）
  await page.clock.install();
  await hiraku(page);
  await page.click('#hnPdf');
  await expect(page.locator('#hnPdf')).toHaveText(MATSU);
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

// ★★連打で 2本 出さない★★ 2026-10-31（本番前 対立役 止1：裏で 作り済みだと 押した とたん 保存＝ダブルクリックで 2本）
//   見本（代行請求書）は 押すと 作り終わるまで ボタンを 止める＝連打で 2本 出ない。こちらは 出した 後 1秒 止める
//   わざと壊す：hnPdfDasu の 1秒の 止めと hnPdfBotan の HN_PDF_TOMETA の 行を 外す ⇒ 赤（保存 2）
test('⑰ 作り終わった 後の ダブルクリックで 保存は 1本・1秒 後は また 押せる', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await kyouyuNise(page, 'ari');
  await page.route('**/js/kami-egaku.js', async (r) => {
    const res = await r.fetch();
    const body =
      (await res.text()) +
      ';(function(){var t=window.KamiEgaku.tsukuru;window.KamiEgaku.tsukuru=function(){return t.apply(this,arguments).then(function(d){window.__dekita=(window.__dekita||0)+1;return d;});};})();';
    await r.fulfill({ response: res, body });
  });
  await hiraku(page);
  await expect
    .poll(() => page.evaluate(() => window.__dekita || 0), { timeout: 30000 })
    .toBeGreaterThan(0);
  await page.dblclick('#hnPdf');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__dl.length), '★連打で 2本 保存した★').toBe(1);
  await expect(page.locator('#hnPdf')).toBeEnabled();
  await expect(page.locator('#hnPdf')).toHaveText(BOTAN);
  await page.click('#hnPdf');
  await expect.poll(() => page.evaluate(() => window.__dl.length)).toBe(2);
});

// ★★保存が 1回 転んでも 黙って 止まらない★★ 2026-10-31（対立役 注1：印を 外す タイマーが 保存の 後ろに 在ると 転んだ 時に 立った まま）
//   わざと壊す：hnPdfDasu の setTimeout を hnPdfHozon の 後ろへ 戻し try を 外す ⇒ 赤（訳が 出ない・押し直しても 0本）
test('⑱ 保存が 1回 転んだら 訳を 出し・1秒 後に 押し直せば 1本 出る', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await kyouyuNise(page, 'ari');
  await page.route('**/js/kami-egaku.js', async (r) => {
    const res = await r.fetch();
    const body =
      (await res.text()) +
      ';(function(){var t=window.KamiEgaku.tsukuru;window.KamiEgaku.tsukuru=function(){return t.apply(this,arguments).then(function(d){window.__dekita=(window.__dekita||0)+1;return d;});};})();';
    await r.fulfill({ response: res, body });
  });
  await hiraku(page);
  await expect
    .poll(() => page.evaluate(() => window.__dekita || 0), { timeout: 30000 })
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    const moto = URL.createObjectURL;
    let ichido = true;
    URL.createObjectURL = function () {
      if (ichido) {
        ichido = false;
        throw new Error('わざと');
      }
      return moto.apply(this, arguments);
    };
  });
  await page.click('#hnPdf');
  await expect(page.locator('#hnPdfErr')).toContainText('PDF を 出せませんでした');
  expect(await page.evaluate(() => window.__dl.length)).toBe(0);
  await expect(page.locator('#hnPdf')).toBeEnabled({ timeout: 3000 });
  await page.click('#hnPdf');
  await expect.poll(() => page.evaluate(() => window.__dl.length)).toBe(1);
});

// ★★裏の 作りが 終わっても ボタンの 中身を 書き直さない★★ 2026-10-31（本番 CI webkit ④b：押した 1.5秒 頃に 裏の 作りが 終わり
//   同じ 字を 書き直した ⇒ WebKit は 押している 間に 字の 節が 替わると click を 出さず 保存 0・30秒）。状態が 同じなら #hnPdf の 変化は 0
//   わざと壊す：hnPdfBotan を 毎回 textContent・disabled を 書く 形に 戻す ⇒ 赤（字の 節が 替わる）
test('⑲ 裏で 作り終わっても 字と 止めが 同じなら ボタンの 中身を 書き直さない', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await kyouyuNise(page, 'ari');
  // ★作りを 待たせる★（見張りを 付ける 前に 終わらない 様に・window.__ike が 立つまで tsukuru を 返さない）
  await page.route('**/js/kami-egaku.js', async (r) => {
    const res = await r.fetch();
    const body =
      (await res.text()) +
      ';(function(){var t=window.KamiEgaku.tsukuru;window.KamiEgaku.tsukuru=function(){var a=arguments,s=this;return new Promise(function(ok){(function m(){window.__ike?ok():setTimeout(m,20);})();}).then(function(){return t.apply(s,a);}).then(function(d){window.__dekita=(window.__dekita||0)+1;return d;});};})();';
    await r.fulfill({ response: res, body });
  });
  await hiraku(page);
  await expect(page.locator('#hnPdf')).toHaveText(BOTAN);
  await page.evaluate(() => {
    const b = document.getElementById('hnPdf');
    window.__botan = b;
    window.__henka = [];
    new MutationObserver((ms) => {
      ms.forEach((m) => window.__henka.push(m.type + ':' + (m.attributeName || '')));
    }).observe(b, { childList: true, characterData: true, subtree: true, attributes: true });
    window.__ike = true;
  });
  await expect
    .poll(() => page.evaluate(() => window.__dekita || 0), { timeout: 30000 })
    .toBeGreaterThan(0);
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({
    henka: window.__henka,
    onaji: document.getElementById('hnPdf') === window.__botan,
    ji: window.__botan.textContent,
    tome: window.__botan.disabled,
  }));
  expect(r.onaji, '★ボタンを 作り直した＝見張りが 外れる★').toBe(true);
  expect(r.henka, '★裏の 作りが 終わった 時に ボタンの 中身を 書き直した★').toEqual([]);
  expect(r.ji).toBe(BOTAN);
  expect(r.tome).toBe(false);
  expect(await watashita(page), '★押す 前に 渡した★').toBe(0);
});
