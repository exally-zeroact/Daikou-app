// ============================================================
// ★★入力の 車は 既定で 畳む★★ 2026-10-23
//
//   司さん「入力のところで今画像のように常に全項目が見えてるがデフォはドロップダウン式にして
//           車の名前だけにして選択しやすくして押したら全項目が出て入力して
//           またドロップダウンのボタン押したら隠れるようにして」
//   守る 事：
//     ①開いた 時は 全部 畳んで いる（車の 名前＋▼ だけ・欄は 見えない）
//     ②名前を 押すと 開く・もう一度で 畳む（aria-expanded も 揃う）
//     ③開いた 車は 日を 変えて 戻っても 開いた まま（その 画面の 間）
//     ④読めない（売上の 直しが 読めない）・打てない 時は 畳んだ 見出しに 印
//
//   わざと 壊した 記録（2026-10-23 実測）：
//     .sha-naka の display:none を 消す ⇒ ①が ★赤★／akeru の 中で AKETA を 覚えない ⇒ ③が ★赤★
// ============================================================
const { test, expect } = require('@playwright/test');
const K = require('./nyuryoku-souko.js');

const HI = '2026-08-01';

test('★①② 既定は 畳む・押すと 開く・もう一度で 畳む★', async ({ page }) => {
  await K.nyuryokuWoHiraku(page, K.zairyou(), HI);
  const n = await page.locator('#shaList .sha[data-car]').count();
  expect(n).toBeGreaterThan(1);
  await expect(page.locator('#shaList .sha.aku')).toHaveCount(0);
  // 欄は 1つも 見えない（見出しの ボタンだけ）
  const mieru = await page.evaluate(
    () =>
      Array.prototype.filter.call(
        document.querySelectorAll('#shaList input'),
        (i) => i.offsetParent !== null
      ).length
  );
  expect(mieru).toBe(0);
  const c1 = K.kuruma(page, K.CAR1);
  const b = c1.locator('.sha-atama');
  await expect(b).toHaveAttribute('aria-expanded', 'false');
  await expect(b).toContainText('▼');
  await b.click();
  await expect(c1.locator('.sha-naka')).toBeVisible();
  await expect(b).toHaveAttribute('aria-expanded', 'true');
  await expect(c1.locator('input[data-hours-sid]').first()).toBeVisible();
  // 他の 車は 畳んだ まま
  await expect(K.kuruma(page, K.CAR2).locator('.sha-naka')).toBeHidden();
  await b.click();
  await expect(c1.locator('.sha-naka')).toBeHidden();
  await expect(b).toHaveAttribute('aria-expanded', 'false');
});

test('★③ 開いた 車は 日を 変えて 戻っても 開いた まま★', async ({ page }) => {
  await K.nyuryokuWoHiraku(page, K.zairyou(), HI);
  await K.akeru(page, K.CAR2);
  await page.click('#nextD');
  await page.waitForFunction(() => document.getElementById('hiSel').value === '2026-08-02');
  await page.waitForTimeout(600);
  await expect(K.kuruma(page, K.CAR2)).toHaveClass(/\baku\b/);
  await expect(K.kuruma(page, K.CAR1)).not.toHaveClass(/\baku\b/);
  await page.click('#prevD');
  await page.waitForTimeout(600);
  await expect(K.kuruma(page, K.CAR2).locator('.sha-naka')).toBeVisible();
});

test('★④ 読めない・打てない 時は 畳んだ 見出しに 印★', async ({ page }) => {
  // 1号車 1回目の 売上の 直しが 負の 数＝読めない
  const F = K.zairyou((G) => {
    G.edits.push({ shift_id: K.S1, company_id: K.CO, uriage_yen: -5 });
  });
  await K.nyuryokuWoHiraku(page, F, HI);
  await expect(K.kuruma(page, K.CAR1).locator('.sha-atama .shirushi')).toContainText([
    '売上が 読めない',
  ]);
  // 回ごとの 売上の 欄で 打ち直せる（給料の 画面へ 案内しない）
  const c1 = await K.akeru(page, K.CAR1);
  await expect(c1).not.toContainText('時数を入れる');
  await K.utsu(c1.locator('input[data-uri-sid="' + K.S1 + '"]'), '9000');
  await K.machi(page);
  await expect(c1.locator('.sha-atama .shirushi', { hasText: '売上が 読めない' })).toHaveCount(0);

  // 保存が 頼る 読み（手で 入れた 日）が 読めない ⇒ 打てない 印（畳んだ まま 見える）
  await K.nyuryokuWoHiraku(page, K.zairyou(), HI, { yomenai: ['dk_manual_days'], tomeOk: true });
  await expect(K.kuruma(page, K.CAR2).locator('.sha-atama .shirushi')).toContainText([
    '打てません',
  ]);
});
