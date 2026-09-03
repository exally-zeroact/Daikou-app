// ============================================================
// ★★本人モード（従業員が 自分の 給料明細だけ 見る）★★ 2026-09-03
//
//   ★司さんの言葉★
//     「Rakunallyみたいに 従業員ごとに QRコードや URLを 配って
//       個人が 勝手に 確認できるようにも しろやぼけ」
//
//   ★ここで 見張る 事★
//     ①パスワードの 決め方（8文字未満／確認と 違う → 断る）
//     ②2回目は パスワードだけ（違えば 断る）
//     ③★事務所の 物を 出さない★（タブ・全員印刷・事務所へのリンク）
//     ④★事務所の 読み込みを 1度も 呼ばない★（材料は 倉庫の 関数だけ）
//     ⑤★★本人に 見せては いけない 物が 出ていない★★
//        「会社に残る分」「つかさの取り分」「みんなの給料」「売上合計」
//        ⇒★これは 実際に 漏れていた★（2026-09-03・絵を 開いて 見て 気づいた）
//          数字だけ 見ていたら 気づかない＝★絵を 開いて 見る★の 決まりが 効いた所。
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-03 実測）★★
//     ①「会社に残る分」を 本人にも 出す ……… ★4本中 1本 赤★
//     ②タブを 隠すのを やめる ………………… ★4本中 1本 赤★
//     ③8文字の 線を 外す ……………………… ★4本中 1本 赤★
//     戻した後 … ★4本とも 緑★
// ============================================================
const { test, expect } = require('@playwright/test');

const EMP = {
  employee_id: 'e1',
  company_id: 'c1',
  name: '見張り太郎',
  role: '甲',
  active: true,
  sort_order: 1,
};
const SET = {
  company_id: 'c1',
  period_start_day: 21,
  period_end_mode: 'month3',
  period_days: 11,
  show_car_sales: true,
  roles: { 甲: { rate: 0.3, floor: 1000 } },
};

// ★倉庫の 関数を 差し替える（本物の 形の 返事だけ 返す）★
//   ★事務所の 読み込み（/rest/v1/dk_◯◯）は 数える★＝呼んだら 赤
async function nise(page, hajimete) {
  const kazoe = { jimusho: 0 };
  await page.route('**/rest/v1/rpc/dk_kyuryo_pw_set', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  );
  await page.route('**/rest/v1/rpc/dk_kyuryo_verify', (r) => {
    const b = JSON.parse(r.request().postData() || '{}');
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        b.p_pw === 'abcd1234' ? { ok: true, name: EMP.name } : { ok: false, reason: 'bad_pw' }
      ),
    });
  });
  await page.route('**/rest/v1/rpc/dk_kyuryo_get', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        emp: EMP,
        settings: [SET],
        labels: [
          { company_id: 'c1', device_id: 'd1', label: '1466', sort_order: 1, show_in_slip: true },
        ],
        shifts: [],
        edits: [],
        workHours: [],
        manualDays: [],
      }),
    })
  );
  await page.route('**/rest/v1/dk_**', (r) => {
    kazoe.jimusho++;
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.goto('/kyuryo.html?t=TOK' + (hajimete ? '&c=INIT12345' : ''));
  await page.waitForTimeout(1000);
  return kazoe;
}

test('★① はじめて＝パスワードの 線（8文字・確認）★', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await nise(page, true);
  await expect(page.locator('#hnGo')).toHaveText('パスワードを 決める');
  await page.fill('#hnPw', '1234567');
  await page.fill('#hnPw2', '1234567');
  await page.click('#hnGo');
  await expect(page.locator('#hnErr')).toContainText('8文字以上');
  await page.fill('#hnPw', 'abcd1234');
  await page.fill('#hnPw2', 'chigau12');
  await page.click('#hnGo');
  await expect(page.locator('#hnErr')).toContainText('違います');
});

test('★② 2回目＝パスワードだけ（違えば 断る）★', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await nise(page, false);
  await expect(page.locator('#hnGo')).toHaveText('見る');
  await page.fill('#hnPw', 'chigau123');
  await page.click('#hnGo');
  await expect(page.locator('#hnErr')).toContainText('違います');
});

test('★③ 事務所の 物を 出さない／事務所の 読み込みを 呼ばない★', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  const kazoe = await nise(page, false);
  await page.fill('#hnPw', 'abcd1234');
  await page.click('#hnGo');
  await page.waitForTimeout(1200);
  const naka = await page.evaluate(() => ({
    tabs: document.getElementById('tabs').style.display,
    print: document.getElementById('btnPrint').style.display,
    links: document.getElementById('jimushoLinks').style.display,
  }));
  expect(naka.tabs, '★タブが 出ています★').toBe('none');
  expect(naka.print, '★全員印刷が 出ています★').toBe('none');
  expect(naka.links, '★事務所へのリンクが 出ています★').toBe('none');
  expect(kazoe.jimusho, '★事務所の 読み込みを 呼んでいます★').toBe(0);
});

test('★★④ 本人に 見せては いけない 物が 出ていない★★', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await nise(page, false);
  await page.fill('#hnPw', 'abcd1234');
  await page.click('#hnGo');
  await page.waitForTimeout(1200);
  // ★自分の 明細は 出ている（何も 出ていないだけの 緑に しない）★
  await expect(page.locator('#slips')).toContainText('給料明細');
  await expect(page.locator('#slips')).toContainText(EMP.name);
  const zenbu = await page.evaluate(() => document.body.innerText || '');
  for (const w of ['会社に残る分', 'つかさの取り分', 'みんなの給料', '売上合計']) {
    expect(zenbu.indexOf(w), '★本人に 見えています: ' + w + '★').toBe(-1);
  }
});
