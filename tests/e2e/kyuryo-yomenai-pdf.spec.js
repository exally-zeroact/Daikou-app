// ============================================================
// ★★見張り：読めなかった 物が 在る 時は 明細の PDF を 作らない★★ 2026-10-07
//
//   対立役 10-07：手当・控除（dk_pay_adjustments）が 読めないと ★控除の 無い 明細の PDF★ が 出た（帯だけ 出る）
//   司さんの 決め「お金の 出力は 1人でも 計算 できなければ 止めて 警告」
//   ★物差し★ 手当・控除が 読めない ⇒「明細を PDFで 見る」で PDF の 道具を 呼ばず 文を 出す
//
//   ★★わざと壊して 赤に なるのを 見た（2026-10-07 実測）★★
//     printAll の loadFailed の 門を 外す ⇒ ★赤★（PDF の 道具を 呼んだ）
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

test('★手当・控除が 読めない ⇒ 明細の PDF を 作らず 止める★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await openKyuryo(page, (f) => {
    f.__yomenai = ['dk_pay_adjustments'];
    return f;
  });
  await page.waitForTimeout(800);
  // ★PDF の 道具が 呼ばれたかを 数える★（呼ばれたら 止まっていない）
  await page.evaluate(() => {
    window.__yobareta = 0;
    const moto = window.loadPdfLibs;
    window.KamiEgaku = window.KamiEgaku || null;
    if (window.KamiPdf && window.KamiPdf.dasu) {
      const d = window.KamiPdf.dasu;
      window.KamiPdf.dasu = function () {
        window.__yobareta++;
        return d.apply(this, arguments);
      };
    }
    return !!moto;
  });
  await page.click('#btnPrint');
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({
    err: document.getElementById('err').textContent,
    msg: (document.getElementById('msg') || {}).textContent || '',
    bar: !!document.getElementById('dkUnknownBar'),
  }));
  // eslint-disable-next-line no-console
  console.log('★止める★ ' + JSON.stringify(r));
  expect(r.bar, '★読めなかった 帯が 出ていない＝この 見張りは 何も 見ていない★').toBe(true);
  expect(r.err, '★読めないのに 明細の PDF に 進んだ★').toContain('明細の PDF は 作りません');
  expect(r.msg, '★PDF を 作り始めた★').not.toContain('PDFを作っています');
  expect(err).toEqual([]);
});

// ★★給料表（月ごと）の PDF も 読めなければ 作らない★★ 2026-10-07（対立役：控除の 抜けた 給料表が 黙って 出た）
//   ★わざと壊して 赤（2026-10-07 実測）★ kamiCtx の KST の 門を 外す ⇒ ★赤★（「出しました」）
test('★手当・控除が 読めない ⇒ 給料表の PDF も 作らない★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await openKyuryo(page, (f) => {
    f.__yomenai = ['dk_pay_adjustments'];
    return f;
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    document.getElementById('kamiCard').open = true;
    document.getElementById('kamiTsuki').click();
  });
  await page.waitForTimeout(2500);
  const note = await page.evaluate(() => document.getElementById('kamiNote').textContent);
  // eslint-disable-next-line no-console
  console.log('★給料表★ ' + note);
  expect(note, '★読めないのに 給料表を 出した★').toContain('給料表は 作りません');
  expect(note).not.toContain('出しました');
  expect(err).toEqual([]);
});

// ★★手当・控除が 長く 多く 内わけの 紙にも 入らない ⇒ 明細の PDF を 作らず 知らせる★★ 2026-10-07
//   （対立役：66件 で 差引支給が 紙の 外へ。司さんの 決め「計算できなければ 止めて 警告」の 向き）
//   ★わざと壊して 赤（2026-10-07 実測）★ printAll の hamidasu の 門を 外す ⇒ ★赤★
test('★手当・控除 90件（長い 名前）⇒ 明細の PDF を 作らず 名前つきで 知らせる★', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await openKyuryo(page, (f) => {
    const w = f.workHours[0];
    f.adjustments = Array.from({ length: 90 }, (_, i) => ({
      adj_id: 'n' + i,
      employee_id: w.employee_id,
      work_date: w.work_date,
      kind: i % 2 ? 'koujo' : 'teate',
      label: '長い 名前の 手当 その' + (i + 1) + '（ガソリン・駐車場・携帯 等）',
      yen: 100 + i,
    }));
    return f;
  });
  await page.waitForTimeout(800);
  await page.click('#btnPrint');
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({
    err: document.getElementById('err').textContent,
    msg: (document.getElementById('msg') || {}).textContent || '',
    hami: window.__paper.maisu(0).hamidasu,
    gamen: (document.querySelector('#slips .kami-mado[data-ei="0"]') || {}).textContent || '',
  }));
  // eslint-disable-next-line no-console
  console.log('★はみ出す★ ' + JSON.stringify(r));
  expect(r.hami, '★はみ出すと 分かっていない＝この 見張りは 何も 見ていない★').toBe(true);
  expect(r.err, '★はみ出すのに 明細の PDF に 進んだ★').toContain('多すぎて 明細の 紙に 入りません');
  expect(r.gamen, '★画面に 知らせていない★').toContain('多すぎて 明細の 紙に 入りません');
  expect(r.msg).not.toContain('PDFを作っています');
  expect(err).toEqual([]);
});

// ★★期間に 関係ない 物（売上の 設定・車の 名前）が 読めない ⇒ 給料表の PDF も 作らない★★ 2026-10-07（対立役 A）
//   ★わざと壊して 赤（2026-10-07 実測）★ kamiCtx の LOAD_KIHON の 門を 外す ⇒ ★赤★（「出しました」）
for (const hyou of ['dk_sales_settings', 'dk_device_labels']) {
  test('★' + hyou + ' が 読めない ⇒ 給料表の PDF を 作らない★', async ({ page }) => {
    const err = [];
    page.on('pageerror', (e) => err.push(e.message));
    await openKyuryo(page, (f) => {
      f.__yomenai = [hyou];
      return f;
    });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      document.getElementById('kamiCard').open = true;
      document.getElementById('kamiKojin').click();
    });
    await page.waitForTimeout(2500);
    const note = await page.evaluate(() => document.getElementById('kamiNote').textContent);
    // eslint-disable-next-line no-console
    console.log('★' + hyou + '★ ' + note);
    expect(note, '★読めないのに 給料表を 出した★').toContain('給料表は 作りません');
    expect(note).not.toContain('出しました');
    expect(err).toEqual([]);
  });
}

// ★★PDF の 道具が 読めず 印刷の 保険へ 落ちる 時も はみ出す 人が 居れば 印刷しない★★ 2026-10-07（対立役 4回目）
//   ★わざと壊して 赤（2026-10-07 実測）★ printAll の catch を _pdfShippai に 戻す ⇒ ★赤★（印刷された）
test('★字体が 読めない（404）＋ 手当・控除 90件 ⇒ 印刷の 保険にも 落とさない★', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.route('**/vendor/fonts/**', (r) => r.fulfill({ status: 404, body: '' }));
  await openKyuryo(page, (f) => {
    const w = f.workHours[0];
    f.adjustments = Array.from({ length: 90 }, (_, i) => ({
      adj_id: 'n' + i,
      employee_id: w.employee_id,
      work_date: w.work_date,
      kind: i % 2 ? 'koujo' : 'teate',
      label: '長い 名前の 手当 その' + (i + 1) + '（ガソリン・駐車場・携帯 等）',
      yen: 100 + i,
    }));
    return f;
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    window.__insatsu = 0;
    window.print = function () {
      window.__insatsu++;
    };
  });
  await page.click('#btnPrint');
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => ({
    insatsu: window.__insatsu,
    err: document.getElementById('err').textContent,
  }));
  // eslint-disable-next-line no-console
  console.log('★404★ ' + JSON.stringify(r));
  expect(r.insatsu, '★切れた 明細を 印刷に 出した★').toBe(0);
  expect(r.err).toContain('多すぎて 明細の 紙に 入りません');
  expect(err).toEqual([]);
});

// ★★給料の 設定を 読み終わる 前に 給料表を 押す ⇒ 作らない（月3回・既定の 売上の 設定で 組まない）★★ 2026-10-08
//   司さん「試験がないなら入れろ」（対立役 10-07 5回目：kamiCtx の !SET_YONDA の 門を 見る 試験が 0本）
//   ★わざと壊して 赤（2026-10-08 実測）★ kamiCtx の !SET_YONDA の 門を 外す ⇒ ★赤★
test('★設定を 読み終わる 前に 給料表を 押す ⇒「読み込み中」で 作らない★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await openKyuryo(
    page,
    (f) => {
      f.__osoi = ['dk_payroll_settings'];
      return f;
    },
    { matanai: true }
  );
  // ★設定が 返る 前（3秒 遅れ）に 押す★
  await page.waitForFunction(() => !!document.getElementById('kamiTsuki'));
  await page.waitForTimeout(500);
  const mae = await page.evaluate(() => {
    document.getElementById('kamiCard').open = true;
    document.getElementById('kamiTsuki').click();
    return true;
  });
  await page.waitForTimeout(800);
  const note = await page.evaluate(() => document.getElementById('kamiNote').textContent);
  // eslint-disable-next-line no-console
  console.log('★読み込み中★ ' + JSON.stringify({ mae: mae, note: note }));
  expect(note, '★読み終わる 前に 給料表を 作った★').toContain('まだ 読み込み中');
  expect(note).not.toContain('出しました');
  // ★読み終わった 後は 作れる★（止めっぱなしに しない）
  await page.waitForFunction(() => window.__paper && window.__paper.ninzu() > 0, null, {
    timeout: 15000,
  });
  await page.evaluate(() => document.getElementById('kamiTsuki').click());
  await page.waitForTimeout(2500);
  const ato = await page.evaluate(() => document.getElementById('kamiNote').textContent);
  expect(ato, '★読み終わった 後も 作れない★').not.toContain('読み込み中');
  expect(err).toEqual([]);
});

// ★★PDF の 道具が 読めない（字体 404）＋ 手当・控除 0行 ⇒ 印刷の 保険は 今まで 通り 1回 出る★★ 2026-10-08
//   （はみ出しの 門が いつも「止める」に 壊れても 気づける 様に＝対立役 10-07 5回目）
//   ★わざと壊して 赤（2026-10-08 実測）★ hamiTomeru を いつも true に ⇒ ★赤★（印刷 0回）
test('★字体 404 ＋ 手当・控除 0行 ⇒ 印刷の 保険が 1回 出る（止めすぎない）★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.route('**/vendor/fonts/**', (r) => r.fulfill({ status: 404, body: '' }));
  await openKyuryo(page, (f) => {
    f.adjustments = [];
    return f;
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    window.__insatsu = 0;
    window.print = function () {
      window.__insatsu++;
    };
  });
  await page.click('#btnPrint');
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => ({
    insatsu: window.__insatsu,
    err: document.getElementById('err').textContent,
  }));
  // eslint-disable-next-line no-console
  console.log('★保険★ ' + JSON.stringify(r));
  expect(r.insatsu, '★止めすぎ＝手当・控除が 無いのに 印刷の 保険も 出ない★').toBe(1);
  expect(r.err).not.toContain('入りません');
  expect(err).toEqual([]);
});
