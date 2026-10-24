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

function settei(shime) {
  return (f) => {
    f.settings[0].period_shime = shime;
    f.settings[0].period_end_mode = shime ? 'shime' : 'thirds';
    return f;
  };
}

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

test('④ テンプレの 見本は 払い方の 種類ごとに 1つ', async ({ page }) => {
  await openKyuryo(page);
  await page.click('.tab[data-tab="tpl"]');
  await page.waitForTimeout(500);
  const r = await page.evaluate(() =>
    [...document.querySelectorAll('#tplGrid .tpl-card')].map(
      (c) => c.getAttribute('data-shurui') || ''
    )
  );
  expect(r.length, '★見本の 札が 無い★').toBeGreaterThan(0);
  expect(r.filter((x) => !x).length, '★種類の 印が 無い 札が 在る★').toBe(0);
  expect(r.length - new Set(r).size, '★同じ 払い方が 重なっている★ ' + r.join(',')).toBe(0);
  expect(r.sort()).toEqual(['hi', 'shuu', 'tsuki1', 'tsuki2', 'tsuki3']);
});

test('⑤ テンプレの 上に 今の 設定の 締め日・設定が 違えば 字も 違う', async ({ page }) => {
  await openKyuryo(page);
  await page.click('.tab[data-tab="tpl"]');
  const ue = page.locator('#tplIma');
  await expect(ue).toContainText('今の 給料の 設定は 月3回（10日・20日・末日締め） です');
  await expect(ue).toContainText('下の テンプレを 押すと'); // 10-24 夜：選べる 形に 戻した
  await expect(ue.locator('[data-tpl-settei]')).toHaveCount(1);
  // 給料の 設定へ 移る
  await ue.locator('[data-tpl-settei]').click();
  await expect(page.locator('#paneSet')).toBeVisible();
});

test('⑤b 設定が 20日締めなら テンプレの 上も 20日締め・月1回の 見本も 20日締め', async ({
  page,
}) => {
  await openKyuryo(page, settei({ kind: 'tsuki', hi: [20], nazuke: 'shime' }));
  await page.click('.tab[data-tab="tpl"]');
  await expect(page.locator('#tplIma')).toContainText('今の 給料の 設定は 月1回（20日締め） です');
  const na = await page.locator('#tplGrid .tpl-card[data-shurui="tsuki1"] .tpl-name').textContent();
  expect(na).toContain('20日締め');
  // 今の 払い方に ✓
  await expect(page.locator('#tplGrid .tpl-card.on')).toHaveAttribute('data-shurui', 'tsuki1');
});

test('⑤c 給料の 設定を 読めない 時は 既定を 黙って 出さず 読めないと 出す', async ({ page }) => {
  await openKyuryo(
    page,
    (f) => {
      f.__yomenai = ['dk_payroll_settings'];
      return f;
    },
    { matanai: true }
  );
  await page.waitForTimeout(2000);
  await page.click('.tab[data-tab="tpl"]');
  await expect(page.locator('#tplIma')).toContainText('給料の 設定を 読めませんでした');
  await expect(page.locator('#tplIma')).not.toContainText('月3回');
});

// ★対立役 S1★ 締めを 変えた 記録が 読めない 時に 列の 形（月3回）へ 黙って 落ちない
test('⑤d 締めを 変えた 記録を 読めない 時も 読めないと 出す', async ({ page }) => {
  await openKyuryo(
    page,
    (f) => {
      f.__yomenai = ['dk_shime_rireki'];
      return f;
    },
    { matanai: true }
  );
  await page.waitForTimeout(2000);
  await page.click('.tab[data-tab="tpl"]');
  await expect(page.locator('#tplIma')).toContainText('読めませんでした');
  await expect(page.locator('#tplIma')).not.toContainText('月3回');
  expect(await page.locator('#tplGrid .tpl-card.on').count(), '★読めないのに ✓ を 付けた★').toBe(0);
});

// ★対立役 S2★ 締め日を 並べた 月4回 等＝既定の 5種類に 無い 形は その 札を 1枚 足す（✓ も 付く）
test('⑤e 月4回（5・15・25・末日）の 会社は 月4回の 札が 1枚 足されて ✓', async ({ page }) => {
  await openKyuryo(page, settei({ kind: 'tsuki', hi: [5, 15, 25, 0] }));
  await page.click('.tab[data-tab="tpl"]');
  await expect(page.locator('#tplIma')).toContainText('月4回（5日・15日・25日・末日締め）');
  const r = await page.evaluate(() =>
    [...document.querySelectorAll('#tplGrid .tpl-card')].map((c) => c.getAttribute('data-shurui'))
  );
  expect(r.sort()).toEqual(['hi', 'shuu', 'tsuki1', 'tsuki2', 'tsuki3', 'tsuki4']);
  await expect(page.locator('#tplGrid .tpl-card.on')).toHaveAttribute('data-shurui', 'tsuki4');
});
