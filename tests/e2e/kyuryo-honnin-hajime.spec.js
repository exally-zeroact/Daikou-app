// ============================================================
// ★★見張り：従業員の 自分の 明細で 勤め始める 前の 期を ¥0 の 紙で 出さない（N4）★★ 2026-10-21
//
//   ★前★ 本人の 画面で ◀ や 期間の ボタンで 勤め始める 前の 期へ 行くと ¥0 の 紙が 出た。
//   ★今★ 本人の 画面だけ その 人の 登録日（created_at）を 勤め始めに する。
//         その 期に 働いた 日・手当・控除が 在れば 紙は 出す（額を 消さない）。
//   ★偽の 倉庫に created_at を 入れる★（本物の dk_kyuryo_get は to_jsonb(e) で 返す。
//     honnin-harness の EMP には 無い＝今までの 本人の 試験は この 道を 一度も 通らなかった・対立役 N4 直す1）
//
//   ★押す物の一覧（先に書く）★ 1. リンクを 開く 2. パスワードを 入れて「見る」 3. 期間の ボタン
//   ★★わざと壊して 赤に なるのを 見た（2026-10-21 実測）★★
//     kyuryo.html の「if (HONNIN) CTX.honnin = true;」を 消す …… ★1本 赤★（勤め始め 前の 期に ¥0 の 紙）
//     js/payroll-daily.js の aru から 手当・控除を 外す … ★2本 赤★（手当だけ・控除だけ の 期）
//     aru を「手当が 在る」だけに 壊す ……………………… ★1本 赤★（控除だけ の 期）
//     戻した 後 … ★5本 緑★
// ============================================================
const { test, expect } = require('@playwright/test');
const { EMP, SET } = require('./honnin-harness');

async function akeru(page, emp, mazeru) {
  await page.route('**/rest/v1/rpc/dk_kyuryo_{verify,fuda}', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, name: emp.name }),
    })
  );
  await page.route('**/rest/v1/rpc/dk_kyuryo_get', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        emp,
        settings: [SET],
        labels: [
          { company_id: 'c1', device_id: 'd1', label: '1466', sort_order: 1, show_in_slip: true },
        ],
        shifts: [],
        edits: [],
        workHours: [],
        adjustments: [],
        rireki: [],
        yakuRireki: [],
        uriageRireki: [],
        shimeRireki: [],
        uriageNaoshi: true,
        tebikiJippi: true,
        manualDays: [],
        ...(mazeru || {}),
      }),
    })
  );
  await page.route('**/rest/v1/dk_**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await page.clock.setFixedTime(new Date('2026-10-21T12:00:00+09:00'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/kyuryo.html?t=TOK');
  await page.waitForTimeout(800);
  await page.fill('#hnPw', '1234');
  await page.click('#hnGo');
  await expect(page.locator('#slips .hn-chip')).toHaveCount(3);
}

// 本物の 関数が 返す 形（to_jsonb の timestamptz）で 10/19 に 登録した 人
const ATARASHII = Object.assign({}, EMP, { created_at: '2026-10-19T01:00:00.123456+00:00' });

test('★勤め始める 前の 期（10/1〜10/10）は 紙を 出さず 字を 出す・勤め始めた 期は 紙を 出す★', async ({
  page,
}) => {
  await akeru(page, ATARASHII);
  await expect(page.locator('#slips .hn-chip.on')).toHaveAttribute('data-k', '0');
  await expect(page.locator('#hnKami .msg')).toHaveText('この期間の 記録は ありません。');
  await expect(
    page.locator('#hnKami .hn-kami-waku'),
    '★勤め始める 前の 期に 紙（¥0）が 出た★'
  ).toHaveCount(0);
  await page.locator('#slips .hn-chip').nth(1).click();
  await expect(
    page.locator('#hnKami .hn-kami-waku').first(),
    '★勤め始めた 期の 紙が 出ない★'
  ).toBeVisible();
});

test('★勤め始める 前の 期でも 働いた 日が 在れば 紙を 出す（額を 消さない）★', async ({ page }) => {
  await akeru(page, ATARASHII, {
    workHours: [{ work_date: '2026-10-05', employee_id: 'e1', device_id: 'd1', hours: 5 }],
  });
  await expect(page.locator('#slips .hn-chip.on')).toHaveAttribute('data-k', '0');
  await expect(
    page.locator('#hnKami .hn-kami-waku').first(),
    '★働いた 日の 紙が 消えた★'
  ).toBeVisible();
});

// ★乗った 記録が 無く 手当だけ の 期も 紙を 出す★（対立役 2回目 直す1：上の 1本は 乗った 記録が 勤め始めを 前へ 動かす ので
//   紙を 出す 決め（aru）を 壊しても 緑だった。手当・控除だけの 期を 本人の 画面で 守る 試験が 0本）
test('★勤め始める 前の 期でも 手当だけ 在れば 紙を 出す（手当を 消さない）★', async ({ page }) => {
  await akeru(page, ATARASHII, {
    adjustments: [
      {
        adj_id: 'a1',
        company_id: 'c1',
        work_date: '2026-10-05',
        employee_id: 'e1',
        kind: 'teate',
        label: '見張り手当',
        yen: 5000,
      },
    ],
  });
  await expect(page.locator('#slips .hn-chip.on')).toHaveAttribute('data-k', '0');
  await expect(page.locator('#hnKami .hn-kami-waku').first(), '★手当の 紙が 消えた★').toBeVisible();
  // 額まで 縛る（差引 支給 で 見る＝手当の 字だけ 出て 差引が ¥0 でも 緑に しない・対立役 3回目 見立て1）
  await expect(page.locator('#hnKami')).toContainText(/差引\s*支給\s*¥5,000/);
});

// ★控除だけの 期も 紙を 出す★（対立役 3回目 直す：aru を「手当が 在る」に 壊すと 控除だけの 期が 消え、控除が どの 明細にも 出なかった）
test('★勤め始める 前の 期でも 控除だけ 在れば 紙を 出す（控除を 消さない）★', async ({ page }) => {
  await akeru(page, ATARASHII, {
    adjustments: [
      {
        adj_id: 'a2',
        company_id: 'c1',
        work_date: '2026-10-05',
        employee_id: 'e1',
        kind: 'koujo',
        label: '見張り控除',
        yen: 3000,
      },
    ],
  });
  await expect(page.locator('#slips .hn-chip.on')).toHaveAttribute('data-k', '0');
  await expect(page.locator('#hnKami .hn-kami-waku').first(), '★控除の 紙が 消えた★').toBeVisible();
  await expect(page.locator('#hnKami')).toContainText('見張り控除');
});

test('★登録日が 来ない（古い 関数）時は 前の 通り 紙を 出す★', async ({ page }) => {
  await akeru(page, EMP);
  await expect(page.locator('#slips .hn-chip.on')).toHaveAttribute('data-k', '0');
  await expect(page.locator('#hnKami .hn-kami-waku').first()).toBeVisible();
});
