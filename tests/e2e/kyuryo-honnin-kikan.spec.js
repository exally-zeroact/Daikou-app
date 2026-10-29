// ============================================================
// ★★見張り：従業員の 自分の 給料明細（本人の 画面）の 上の 並び（月・期間・印刷 / 送る）★★ 2026-10-20／2026-10-29 作り直し
//
//   2026-10-20 司さん（スマホの 絵つき）「赤丸のところは1行にしろ」＝期間の ボタン（札）を 1行に した
//   2026-10-29 司さん「赤丸のどこが代行請求書と同じ作りなんどぼけ勝手にごちゃごちゃさすなや」
//     ⇒ 札を やめ、代行請求書の 請求書の 欄と 同じ［月］［期間］の 選ぶ 欄 2つ（1行）＋「📄 印刷 / 送る」に した
//   ★ここで 見る 事★
//     ①選ぶ 欄 2つは 360px 以上 1行（359px 以下は 2行）・画面の 右へ はみ出さない・ページが 横に すべらない（240〜430px を 1px ずつ）
//     ②選んでいる 字（一番 長い 期間「11/26〜12/10」・月「2025年12月」）が 欄の 中に 入る（repo の 字体＝iPhone と ほぼ 同じ 幅）
//     ③期間の 欄は「1か月分」＋ その 月の 期間（締めの 形ごと）・開いた 時は 今日を 含む 期（月3回は 最初の 期）
//
//   ★押す物の一覧（先に書く）★ 1. リンクを 開く 2. パスワードを 入れて「見る」 3. 期間の 選ぶ 欄
// ============================================================
const { test, expect } = require('@playwright/test');
const { hiraku } = require('./honnin-harness');

// ★字の 幅は repo に 置いた 字体（BIZ UDPゴシック）で 測る★（機械の 字体で 結果が 変わる・feedback_ji_no_haba_no_shiken_wa_jitai_wo_soroeru）
async function jitaiKotei(page) {
  await page.addStyleTag({
    content:
      "@font-face{font-family:'KakuninBIZ';src:url('/vendor/fonts/BIZUDPGothic-Regular.ttf')}" +
      "#hnBar .hn-fselect{font-family:'KakuninBIZ' !important}",
  });
  await page.evaluate(() => document.fonts.load("16px 'KakuninBIZ'"));
  await page.waitForFunction(() => document.fonts.check("16px 'KakuninBIZ'"));
}

// 上の 並びを 測る（選ぶ 欄の 行・右の はみ出し・ページ・選んでいる 字が 欄の 中に 入るか）
async function hakaru(page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    const sels = Array.from(document.querySelectorAll('#hnBar .hn-fselect'));
    const botan = document.getElementById('hnPdf');
    const migi = [...sels, botan].map((e) =>
      Math.round(e.getBoundingClientRect().right - d.clientWidth)
    );
    // 選んでいる 字の 幅（欄と 同じ 字体・大きさで 測る）と 欄の 中の 幅（左右の 空きを 引く）
    const haira = sels.filter((s) => {
      const cs = getComputedStyle(s);
      const sp = document.createElement('span');
      sp.style.cssText =
        'position:absolute;visibility:hidden;white-space:nowrap;font:' + cs.font + ';';
      sp.textContent = s.selectedOptions[0] ? s.selectedOptions[0].textContent : '';
      document.body.appendChild(sp);
      const ji = sp.getBoundingClientRect().width;
      sp.remove();
      const naka = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      s.__over = Math.ceil(ji - naka);
      return ji > naka + 0.5;
    });
    return {
      sels: sels.length,
      gyou: new Set(sels.map((s) => Math.round(s.getBoundingClientRect().top))).size,
      migi: Math.max(...migi),
      page: d.scrollWidth - d.clientWidth,
      hairanai: haira.map(
        (s) => s.id + '「' + s.selectedOptions[0].textContent + '」' + s.__over + 'px 足りない'
      ),
    };
  });
}
// ★359px 以下は 月と 期間を 2行（320px で 期間の 字が 20px 足りなかった）・360px 以上は 1行★
const gyouNo = (w) => (w <= 359 ? 2 : 1);
function ikkou(m, w) {
  expect(m.sels, '★選ぶ 欄が 2つ 無い＝測っていない★').toBe(2);
  expect(m.gyou, '★月と 期間の 欄の 行の 数が 違う★').toBe(gyouNo(w));
  expect(m.migi, '★上の 並びが 画面の 右へ はみ出している★').toBeLessThanOrEqual(0);
  expect(m.page, '★ページが 横に はみ出している★').toBeLessThanOrEqual(0);
}
const kikanJi = (page) =>
  page.locator('#hnKikanSel option').evaluateAll((os) => os.map((o) => o.textContent));

// ★月3回：1か月分 ＋ 3つ・開いた 時は 最初の 期（今の 会社の 見え方）★
for (const haba of [390, 375, 360, 320]) {
  test(`★期間の 欄：月3回・${haba}px で 並ぶ・字が 入る★`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-05T12:00:00+09:00'));
    await page.setViewportSize({ width: haba, height: 844 });
    await hiraku(page);
    await jitaiKotei(page);
    expect(await kikanJi(page)).toEqual(['1か月分', '10/1〜10/10', '10/11〜10/20', '10/21〜10/31']);
    await expect(page.locator('#hnKikanSel')).toHaveValue('0');
    let m = await hakaru(page);
    ikkou(m, haba);
    expect(m.hairanai, '★選んでいる 字が 欄に 入らない★').toEqual([]);
    // 期間を 選んでも 1行の まま・紙の 見出しが その 期間
    await page.locator('#hnKikanSel').selectOption('2');
    await expect(page.locator('#hnKami')).toContainText('10/21 〜 10/31');
    m = await hakaru(page);
    ikkou(m, haba);
    expect(m.hairanai).toEqual([]);
  });
}

// ★一番 長い 字＝両側が 2桁の 期間（締め日 10・20・25 の 12月：11/26〜12/10 ほか）★
test('★期間の 欄：締め日 10・20・25 の 12月＝4つの 字・今日を 含む 期を 選ぶ★', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2025-12-15T12:00:00+09:00'));
  await page.setViewportSize({ width: 390, height: 844 });
  await hiraku(page, { period_shime: { kind: 'tsuki', hi: [10, 20, 25], nazuke: 'shime' } });
  expect(await kikanJi(page)).toEqual(['1か月分', '11/26〜12/10', '12/11〜12/20', '12/21〜12/25']);
  await expect(page.locator('#hnKikanSel')).toHaveValue('1');
  await expect(page.locator('#hnTsukiSel')).toHaveValue('2025-12');
});

// ★週1回・毎日（期間が 4つ 以上）も 選ぶ 欄 1つ＝並びは 崩れない・今日を 含む 期★
const KATA = [
  ['週1回', { period_shime: { kind: 'shuu', youbi: 0, nazuke: 'shime' } }, 4],
  ['毎日', { period_shime: { kind: 'hi' } }, 28],
];
for (const [na, set, sukunakutomo] of KATA) {
  test(`★期間の 欄：${na}・320px で 2行・字が 入る・今日を 含む 期を 選ぶ★`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-15T12:00:00+09:00'));
    await page.setViewportSize({ width: 320, height: 844 });
    await hiraku(page, set);
    await jitaiKotei(page);
    const ji = await kikanJi(page);
    expect(ji.length, '★期間の 数が 少ない＝この 形を 測っていない★').toBeGreaterThan(sukunakutomo);
    expect(ji[0]).toBe('1か月分');
    const erabi = await page
      .locator('#hnKikanSel')
      .evaluate((s) => s.selectedOptions[0].textContent);
    const k = erabi.match(/(\d+)\/(\d+)(?:〜(\d+)\/(\d+))?/);
    expect(k, '★選んでいる 期間の 字が 無い★').not.toBeNull();
    const naka = (mm, dd) => Number(mm) * 100 + Number(dd);
    const kyou = naka(10, 15);
    expect(naka(k[1], k[2]), '★今日を 含む 期を 選んでいない★').toBeLessThanOrEqual(kyou);
    expect(naka(k[3] || k[1], k[4] || k[2])).toBeGreaterThanOrEqual(kyou);
    const m = await hakaru(page);
    ikkou(m, 320);
    expect(m.hairanai).toEqual([]);
  });
}

// ★★240〜430px を 1px ずつ★★（段の 境で だけ 崩れる 形を 逃さない・2026-10-20 の 札の 時の 教え）
//   一番 長い 期間の 字を 選んだ 形で 測る。どの 幅でも 選んでいる 字が 欄に 入る。
//   ★わざと壊して 赤（2026-10-29 実測）★ 月と 期間を 半分ずつ（#hnTsukiSel の flex を 外す）… 345〜370px で 字が 入らない
//     359px 以下の 2行を 外す … 320〜339px で 字が 入らない（320px で 20px 足りない）
const SCAN = [
  [
    '締め日 10・20・25 の 12月',
    '2025-12-15T12:00:00+09:00',
    { period_shime: { kind: 'tsuki', hi: [10, 20, 25], nazuke: 'shime' } },
    '11/26〜12/10',
  ],
  ['月3回', '2026-10-05T12:00:00+09:00', undefined, '10/21〜10/31'],
];
for (const [na, hi, set, hiroi] of SCAN) {
  test(`★上の 並び：${na}・240〜430px を 1px ずつ★`, async ({ page }) => {
    test.setTimeout(240000);
    await page.clock.setFixedTime(new Date(hi));
    await page.setViewportSize({ width: 430, height: 844 });
    await hiraku(page, set);
    await jitaiKotei(page);
    const v = await page.locator('#hnKikanSel option', { hasText: hiroi }).getAttribute('value');
    expect(v, '★一番 広い 期間の 字が 無い＝この 形を 測っていない★').not.toBeNull();
    await page.locator('#hnKikanSel').selectOption(v);
    const dame = [];
    let mita = 0;
    for (let w = 240; w <= 430; w++) {
      await page.setViewportSize({ width: w, height: 844 });
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      );
      const m = await hakaru(page);
      const haba = await page.evaluate(() => document.documentElement.clientWidth);
      // ★その 幅で 開けた 回数を 数える（setViewportSize が 効かずに 430px の まま 測るのを 緑に しない）★
      if (haba === w) mita++;
      else dame.push(`${w}px のはずが ${haba}px`);
      if (m.sels !== 2 || m.gyou !== gyouNo(w) || m.migi > 0 || m.page > 0)
        dame.push(`${w}px 欄${m.sels} 行${m.gyou} 右${m.migi} 頁${m.page}`);
      if (m.hairanai.length) dame.push(`${w}px 字が 入らない ${m.hairanai.join(' ')}`);
    }
    expect(mita, '★その 幅で 見た 数が 違う★').toBe(191);
    expect(dame, '★この 幅で 上の 並びが 崩れる★').toEqual([]);
  });
}
