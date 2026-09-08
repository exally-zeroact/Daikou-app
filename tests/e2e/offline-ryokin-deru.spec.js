// ============================================================
// ★★オフラインでも 料金が 出る★★ 2026-09-08
//
//   ★司さん★「従業員が開始おして走ったら距離は増えるけど金額が増えない
//             確定も押せないらしい」「オフラインで使いよんやけん」
//
//   ★何が 起きていたか（実測）★
//     js/fare-calc.js が サービスワーカーの 先取り 名簿に 無く、
//     オフラインで 読めない ⇒ FareCalc が 無い ⇒ Meter.calcFare が 落ちる
//     ⇒ 画面は ★距離を 先に 書いて★ その後 落ちる＝★料金 0 の まま★
//     ⇒ 確定も 同じ 関数を 呼ぶ ので 効かない
//
//   ★ここで 見る 事★
//     ①先取りが 済んだ 後で ★電波を 切って★ 開き直す
//     ②それでも ★FareCalc が 在る★／★2.6km で 1,700円★／★落ちていない★
//
//   ★★わざと壊して 見た（2026-09-08 実測）★★
//     ①名簿から fare-calc.js を 抜く … ★この 見張りは 緑の まま★（見つけられない）
//        ⇒ 同じ 壊し方で ★単体の 見張り（sw-sakidori-morenai）は 赤★
//     戻した後 … ★緑★
//
//   ★★この 見張りは 穴を 見つけられません（正直に 書く）★★ 2026-09-08 実測
//     名簿から fare-calc.js を 抜いて 走らせても ★緑の まま★でした。
//     訳＝★一度 オンラインで 開くと 走りながら 控えが 出来る★ ので、
//        先取りに 無くても その 場では 読めて しまう。
//     本当の 事故は ★版が 上がって 古い 控えが 消えた 後★に 起きます。
//   ⇒ ★穴を 見つけるのは 単体の 見張り★
//        tests/unit/sw-sakidori-morenai.test.js
//        （メーターが 読む js が 名簿に 在るかを ★数える★／抜くと ★赤★）
//   ⇒ ここは ★煙が 出ていないかの 確かめ★として 残します
//     （オフラインで 料金が 計算できる・落ちていない）
// ============================================================
const { test, expect } = require('@playwright/test');

test('★★オフラインでも 料金が 計算できる★★', async ({ page, context }) => {
  const err = [];
  page.on('pageerror', (e) => err.push('pageerror: ' + e.message));

  // ★① まず オンラインで 開いて 先取りさせる★
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  // ★サービスワーカーが 効くまで 待つ★
  const sw = await page.evaluate(async () => {
    if (!navigator.serviceWorker) return 'no-sw';
    const r = await navigator.serviceWorker.ready.catch(() => null);
    return r ? 'ready' : 'ng';
  });
  // eslint-disable-next-line no-console
  console.log('★サービスワーカー★ ' + sw);
  await page.waitForTimeout(3000);

  // ★② 電波を 切る★
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(4000);

  const r = await page.evaluate(() => {
    const out = { fareCalc: typeof FareCalc !== 'undefined', meter: typeof Meter !== 'undefined' };
    try {
      out.calc26 = Meter.calcFare(2600);
      out.calc10 = Meter.calcFare(10000);
    } catch (e) {
      out.calcErr = String(e && e.message);
    }
    // ★画面を 書く 所が 落ちないか★（距離だけ 動いて 料金が 止まる 形）
    try {
      out.fareEl = (document.getElementById('driveFare') || {}).textContent;
    } catch (_) {
      /* ignore */
    }
    return out;
  });
  // eslint-disable-next-line no-console
  console.log('★オフライン★ ' + JSON.stringify(r));
  // eslint-disable-next-line no-console
  console.log('★落ちた 物★ ' + JSON.stringify(err.slice(0, 6)));

  await context.setOffline(false);

  expect(r.fareCalc, '★オフラインで 料金の 計算（FareCalc）が 読めていません★').toBe(true);
  expect(r.calcErr, '★オフラインで 料金の 計算が 落ちました★').toBeUndefined();
  expect(r.calc26, '★2.6km の 料金が 違います★').toBe(1700);
  expect(r.calc10, '★10km の 料金が 違います★').toBe(3500);
  expect(
    err.filter((x) => x.indexOf('fare-calc') >= 0 || x.indexOf('FareCalc') >= 0),
    '★料金の 計算まわりで 落ちています★'
  ).toEqual([]);
});
