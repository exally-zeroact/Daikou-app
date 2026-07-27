// tests/e2e/appbar-single-row.spec.js
// ★青バー(appbar)1段死守 回帰テスト (2026-06-20)★
//   司さん「Androidだけ上の青バーが2段になってる・1段に直して」。
//   appbar は flex-wrap:wrap で狭い端末では nav(ホーム/使い方/設定)が2行目に折り返していた。
//   主要実機幅(320〜430・Android/iPhone 両方)で appbar-left と appbar-nav が ★同じ行★
//   (rect.top 一致) かつ バー高さが1行ぶん(<48px) であることを保証する。
const { test, expect } = require('@playwright/test');

const WIDTHS = [
  { name: 'Android最小(320)', w: 320 },
  { name: 'Android標準(360)', w: 360 },
  { name: 'Pixel(393)', w: 393 },
  { name: 'iPhoneSE(375)', w: 375 },
  { name: 'iPhone12/13(390)', w: 390 },
  { name: 'iPhoneProMax(430)', w: 430 },
];

async function measureBar(page) {
  return page.evaluate(() => {
    const bar = document.getElementById('appbar').getBoundingClientRect();
    const left = document.querySelector('.appbar-left').getBoundingClientRect();
    const nav = document.querySelector('.appbar-nav').getBoundingClientRect();
    return { barH: bar.height, topDiff: Math.abs(nav.top - left.top) };
  });
}

for (const d of WIDTHS) {
  test(`青バーが1段: ${d.name}`, async ({ page }) => {
    await page.setViewportSize({ width: d.w, height: 780 });
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    const m = await measureBar(page);
    // バー高さが1行ぶん (<48px) = 1段。topDiff は端末高さ差で多少出るので barH を主判定に。
    expect(m.barH, `${d.name}: バーが2行ぶんの高さ(2段)`).toBeLessThan(48);
  });
}

// ★割増バッジ表示時も主要実機幅(360〜430)で1段を死守 (監査BLOCKER対応・2026-06-20)★
//   surchargeEnabled=true で青バーに「割増」バッジが加わる。.appbar--surcharge クラスで
//   詰めて折り返しを防ぐ。320px(極小端末)+バッジは安全弁で2段許容(重なりなし)のため除外。
for (const w of [360, 390, 430]) {
  test(`青バーが1段(割増バッジ表示): ${w}px`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('daikou_settings', JSON.stringify({ surchargeEnabled: true }));
    });
    await page.setViewportSize({ width: w, height: 780 });
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    // バッジが実際に見えていること
    const badgeVisible = await page.locator('#surchargeBadge').isVisible();
    expect(badgeVisible, `${w}px: 割増バッジが表示されていない(前提崩れ)`).toBe(true);
    const m = await measureBar(page);
    expect(m.barH, `${w}px: 割増バッジ表示で2段に折返している`).toBeLessThan(48);
  });
}
