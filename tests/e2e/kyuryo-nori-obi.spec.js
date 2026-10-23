// ============================================================
// ★★給料の 明細（確認）に 期間を 通した 乗った人の 入れ漏れの 帯★★ 2026-10-23
//
//   司さん「給料の時数を入れるを入力の各車ごとに…して給料タブは確認と従業員の設定だけにして」
//   ⇒「時数を入れる」の 日の 帯（hibar）が 出していた「乗った人の 居ない 車が ある日」を
//     明細（確認）の 上の 帯に 残す（対立役 A-6：消すと 期間の 入れ漏れが 誰にも 見えない）。
//   守る 事：
//     ①入れ漏れの 日だけ 並べ、押すと 入力の 画面の その 日（nyuryoku.html?hi=）へ 行く
//     ②判じは 入力の 画面と 同じ 部品（JisuuHozon.noriNashi）＝自分の 車には 出さない
//     ③入れ漏れが 無い 期間は「ありません」（①の 後半）
//     ④「時数を入れる」の タブは 無い（明細・従業員・給料の設定）
//   わざと壊す（2026-10-23 実測）：noriMoreObi の 先頭で '' を 返す ⇒ ①③ ★赤★
// ============================================================
const { test, expect } = require('@playwright/test');
const K = require('./nyuryoku-souko.js');

async function hiraku(page, F) {
  await K.sessWoKaeru(page, F);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.clock.setFixedTime(new Date('2026-08-05T03:00:00Z'));
  await page.goto('/kyuryo.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__paper && window.__paper.ninzu() > 0, null, {
    timeout: 20000,
  });
}

test('★①② 入れ漏れの 日を 帯に 出し、押すと 入力の その 日へ・自分の 車には 出さない★', async ({
  page,
}) => {
  // 8/1 は 乗った人が 居ない（K.zairyou）。8/2 の 2号車は 手入力（売上 0・時間 0）に 乗った人 無し＝印に ならない
  await hiraku(page, K.zairyou());
  const obi = page.locator('#slips .nori-obi');
  await expect(obi).toHaveCount(1);
  await expect(obi.locator('.nnhi')).toHaveText(['8/1']);
  await expect(obi.locator('.nnhi').first()).toHaveAttribute('href', 'nyuryoku.html?hi=2026-08-01');
  await expect(page.locator('.tab')).toHaveText(['明細', '従業員', '給料の設定']);

  // 1号車・2号車 とも 自分の 車＝印に しない…は 1台だけ なので、2号車を 自分の 車に して 1号車に 人を 乗せる
  const F2 = K.zairyou((G) => {
    G.settings[0].owner_device_id = K.CAR2;
    G.workHours.push({
      company_id: K.CO,
      work_date: '2026-08-01',
      employee_id: K.TARO,
      device_id: K.CAR1,
      hours: 0,
    });
  });
  const p2 = await page.context().newPage();
  await hiraku(p2, F2);
  await expect(p2.locator('#slips .nori-obi .nnhi')).toHaveCount(0);
  await expect(p2.locator('#slips .nori-obi')).toContainText('入れ漏れは ありません');
  await p2.close();
});

test('★③ 帯の 日を 押すと 入力の 画面が その 日で 開き、その 車の 見出しに 印★', async ({
  page,
}) => {
  const F = K.zairyou();
  await hiraku(page, F);
  await page.locator('#slips .nori-obi .nnhi').first().click();
  await page.waitForURL('**/nyuryoku.html?hi=2026-08-01');
  await page.waitForFunction(() => document.querySelectorAll('#shaList .sha[data-car]').length > 0);
  await expect(page.locator('#hiSel')).toHaveValue('2026-08-01');
  await expect(K.kuruma(page, K.CAR1).locator('.sha-atama .shirushi')).toContainText([
    '乗った人なし',
  ]);
});
