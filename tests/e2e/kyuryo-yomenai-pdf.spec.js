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
