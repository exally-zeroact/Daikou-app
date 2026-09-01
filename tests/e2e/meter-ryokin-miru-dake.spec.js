// tests/e2e/meter-ryokin-miru-dake.spec.js
// ★★メーターの 料金設定は「今の 料金表を 読むだけ」★★ 2026-09-01
//
//   ★司さん（2026-09-01）★
//     「事務所でやるならこの画面はメーターの方にいらんことないか？
//       追加や値引きとかは事務所でもメーターの方でも触れてええけど
//       ★料金表が見れたええやろ★」
//
//   ★はじめ 触れない 入力欄を そのまま 並べていました★（灰色で 押せないだけ）。
//   ⇒ ★意味が ありません★。入力欄は 出さず ★字で 読む★形に しました。
//
//   ★今の 形★
//     札は ★料金表／追加料金／値引き★ の 3つだけ
//     ・料金表 …… ★今 使っている 料金表を 字で 出す（読むだけ）★
//                  数字の 出どころは ★Meter.getFareConfig()★＝実際に 料金を 出している 物
//                  ⇒★画面の 数字と 使う 数字が ずれません★
//     ・追加料金／値引き … ★今まで通り 触れます★（料金表では なく 端末ごとの その場の ボタン）
//
//   ★★わざと壊して 実測（2026-09-01）★★
//     料金表の 札を 消す → ①が 赤／字を 出す 所を 消す → ②が 赤
//     入力欄を 戻す → ③が 赤／追加料金を 止める → ④が 赤／戻して 4本 緑

const { test, expect } = require('@playwright/test');

async function hiraku(page) {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.showOverlay('fare'));
  await page.waitForTimeout(500);
}

test('★① 札は 料金表／追加料金／値引き の 3つだけ★', async ({ page }) => {
  await hiraku(page);
  const t = await page.evaluate(() =>
    Array.prototype.slice
      .call(document.querySelectorAll('#overlayFare .tab-btn'))
      .map((b) => b.textContent.trim())
  );
  expect(t, '★料金表を 直す 札が 残っています（事務所からだけ の はず）★').toEqual([
    '料金表',
    '追加料金',
    '値引き',
  ]);
  const obi = await page.textContent('#overlayFare .miru-dake-obi');
  expect(obi, '★どこで 変えるか 書いていません★').toContain('事務所');
  expect(obi, '★追加料金が 触れる事を 書いていません★').toContain('追加料金');
});

test('★★② 今の 料金表が 字で 読める★★', async ({ page }) => {
  await hiraku(page);
  const r = await page.evaluate(() => {
    const g = Array.prototype.slice.call(document.querySelectorAll('#overlayFare .yomu-gyou'));
    return {
      kazu: g.length,
      moji: g.map((e) => e.textContent).join(' / '),
    };
  });
  expect(r.kazu, '★料金表が 1行も 出ていません★').toBeGreaterThan(3);
  expect(r.moji, '★最初の 料金が 出ていません★').toContain('最初の 料金');
  expect(r.moji, '★金額が 出ていません★').toMatch(/[0-9],?[0-9]*円/);
});

test('★★③ 料金表を 直す 入れる所が 1つも 無い★★', async ({ page }) => {
  await hiraku(page);
  const n = await page.evaluate(() => {
    const li = Array.prototype.slice.call(
      document.querySelectorAll(
        "#overlayFare .tab-pane:not([data-pane='extras']):not([data-pane='discounts']) input"
      )
    );
    return li.filter((e) => {
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.height > 0;
    }).length;
  });
  expect(n, '★料金表を 直す 入れる所が 出ています（メーターから 変えられます）★').toBe(0);
});

test('★★④ 追加料金・値引きは 今まで通り 触れる（止めすぎない）★★', async ({ page }) => {
  await hiraku(page);
  await page.evaluate(() => {
    document
      .querySelectorAll('#overlayFare .tab-pane')
      .forEach((p) => p.classList.remove('active'));
    const e = document.querySelector("#overlayFare .tab-pane[data-pane='extras']");
    if (e) {
      e.classList.add('active');
      e.style.display = '';
    }
  });
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const b = document.querySelector("#overlayFare .tab-pane[data-pane='extras'] .btn-add");
    if (!b) return { aru: false };
    const box = b.getBoundingClientRect();
    return {
      aru: true,
      mieru: box.width > 0 && box.height > 0,
      oseru: getComputedStyle(b).pointerEvents !== 'none',
    };
  });
  expect(r.aru, '★追加料金の「足す」ボタンが 見つかりません★').toBe(true);
  expect(r.mieru, '★料金表では ない物まで 隠しています★').toBe(true);
  expect(r.oseru, '★料金表では ない物まで 止めています★').toBe(true);
});
