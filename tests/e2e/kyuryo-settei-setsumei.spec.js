// ============================================================
// ★★見張り：給料の 設定の「明細の 期間」の 説明・配るの 箱・テンプレの 見本の 数と 上の 字★★ 2026-10-24
//
//   ★司さんの言葉（10-24）★
//     「締め日の下の区切りの説明書きいらん。月2回に変えても保存するボタンの下の説明書が変わらない。
//       この説明書は選択したものに関してリアルタイムで確認のための説明書として変わるようにしろ。
//       配るは明細からできるからのけろ」
//     「月1回のテンプレは給料設定があるんやから1個でええやろ。月2回、3回、週一も一緒や。同じものを並べてどうするんのど。
//       ここでも説明書を給料設定を読み込んで今の給料設定は何日締めです。変えたい時は給料設定から変更して下さい。みたいに載せろ」
//   ★物差し★
//     ① 払い方の 下に「区切り … 9月分 … 」の 一覧の 字が 無い
//     ② 保存の 下の 字（#pSetsumei）が 選んだ 払い方に その場で 変わる（月2回 ⇔ 月3回・月1回 20日締め）
//     ③ 給料の 設定に「従業員へ 配る」の 箱が 無い・明細の「QRを 見せる」から 配れる
//     ④ テンプレの 見本は 払い方の 種類ごとに 1つ（同じ 払い方の 重なり 0）
//     ⑤ テンプレの 上に 今の 設定の 締め日の 字・設定が 違えば 字も 違う・読めない 時は 読めないと 出す
//   ★★わざと壊して 赤（2026-10-24 手元 chromium 実測）★★
//     直す 前の kyuryo.html（origin/main ced1bc49e）⇒ 9本 全部 赤（①〜⑤e）
//     テンプレの 今の 形を 前の「shimeNoHiKata(今日) || 列の 形」に 戻す ⇒ ⑤d 赤（記録が 読めないのに 月3回と 言い切った・対立役 S1）
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

test('① 払い方の 下に 区切りの 一覧の 字が 無い', async ({ page }) => {
  await openKyuryo(page, null, { ura: '?henshu=1#set' });
  await page.waitForSelector('#pMode', { state: 'visible' });
  for (const m of ['thirds', 'tsuki2', 'matsu']) {
    await page.selectOption('#pMode', m);
    await page.waitForTimeout(150);
    const ji = await page.locator('#paneSet').innerText();
    expect(ji, '★' + m + '：区切りの 一覧が 出ている★').not.toContain('区切り …');
    expect(ji, '★' + m + '：「◯月分 … 」の 一覧が 出ている★').not.toMatch(/\d+月分 … /);
  }
});

test('② 保存の 下の 説明は 選んだ 払い方に その場で 変わる', async ({ page }) => {
  await openKyuryo(page, null, { ura: '?henshu=1#set' });
  await page.waitForSelector('#pMode', { state: 'visible' });
  const s = page.locator('#pSetsumei');
  await expect(s, '★保存の 下の 説明（#pSetsumei）が 無い★').toHaveCount(1);
  await expect(s).toContainText('月3回');
  await expect(s).toContainText('1日〜10日／11日〜20日／21日〜末日');
  await expect(s).toContainText('月別');
  await page.selectOption('#pMode', 'tsuki2');
  await expect(s).toContainText(
    '月2回（15日・末日締め）：1日〜15日／16日〜末日の2回で明細を出します'
  );
  await expect(s, '★月2回なのに 月3回の 字が 残った★').not.toContainText('月別');
  await page.selectOption('#pMode', 'thirds');
  await expect(s).toContainText('1日〜10日／11日〜20日／21日〜末日');
  await expect(s).toContainText('月別');
  await page.selectOption('#pMode', 'tsuki1');
  await page.fill('#pShimeHi', '20');
  await page.dispatchEvent('#pShimeHi', 'input');
  await page.selectOption('#pNazuke', 'shime');
  await expect(s).toContainText('月1回（20日締め）：前の月の21日〜20日の1回で明細を出します');
  await expect(s).toContainText('締めた日の月の分');
  await page.selectOption('#pMode', 'shuu');
  await page.selectOption('#pNazuke', 'shime');
  await expect(s).toContainText('週1回（日曜締め）：月曜〜日曜の1週ごとに明細を出します');
  await page.selectOption('#pMode', 'hi');
  await expect(s).toContainText('毎日：1日ごとに明細を出します');
});

test('③ 給料の 設定に 配るの 箱が 無く、明細の「QRを 見せる」から 配れる', async ({ page }) => {
  await openKyuryo(page, null, { ura: '?henshu=1' });
  await page.evaluate(() => {
    const S = window.DKSession;
    const o = S.rest;
    window.__haifu = 0;
    S.rest = function (s, p, opt) {
      if (String(p).indexOf('rpc/dk_kyuryo_haifu_hitori') === 0) {
        window.__haifu++;
        const eid = JSON.parse(opt.body).p_employee_id;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ok: true,
              hito: {
                employee_id: eid,
                name: '見張り',
                token: 'abcd1111abcd2222abcd3333abcd4444',
                init_code: null,
                pw_ari: true,
              },
            }),
        });
      }
      return o.apply(this, arguments);
    };
  });
  await page.click('.tab[data-tab="set"]');
  await page.waitForTimeout(300);
  const ji = await page.locator('#paneSet').innerText();
  expect(ji, '★給料の 設定に 配るの 箱が 残っている★').not.toContain('従業員へ 配る');
  expect(await page.locator('#paneSet #haifuList').count()).toBe(0);
  await page.click('.tab[data-tab="slip"]');
  await page.waitForTimeout(300);
  const b = page.locator('[data-meisai-qr]').first();
  expect(await b.count(), '★明細に「QRを 見せる」が 無い★').toBe(1);
  await b.click();
  await expect(page.locator('#haifuMise svg')).toHaveCount(1);
  expect(await page.evaluate(() => window.__haifu)).toBeGreaterThan(0);
  const url = await page.locator('#haifuMiseQr').getAttribute('data-url-mihari');
  expect(url, '★窓の QR の 先が 読めない★').toContain('?t=abcd1111abcd2222abcd3333abcd4444');
});
