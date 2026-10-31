// ★★試験の Node 側の 時間帯も 日本か★★ 2026-11-01
//   全体の 決まりの use の 時間帯 は 画面（ブラウザ）だけを 日本に する。試験の 中の new Date()（Node）が UTC の ままだと
//   月初めの 0〜9時（JST）に 画面＝新しい 月／試験＝前の 月 に ずれ、給料の 試験 11本が 赤だった（2026-11-01 0:34 実測）。
//   直し＝playwright.config.js の 頭の process.env.TZ。★時刻に 依らず 毎回 見る★（月初め だけで なく いつ 消されても 赤）。
const { test, expect } = require('@playwright/test');

test('★試験の Node の 時間帯は 日本（画面と 同じ）★', async () => {
  expect(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    '★試験の Node が 日本の 時間帯で ない★（playwright.config.js の process.env.TZ が 外れた？ 月初め 0〜9時に 月が ずれる）'
  ).toBe('Asia/Tokyo');
  expect(
    new Date(Date.UTC(2026, 9, 31, 15, 30)).getMonth(),
    '★UTC 10-31 15:30 は 日本では 11月★'
  ).toBe(10);
});

test('★試験の「今月」と 画面の「今月」が 同じ★', async ({ page }) => {
  await page.goto('about:blank');
  const gamen = await page.evaluate(() => {
    const d = new Date();
    return d.getFullYear() * 100 + d.getMonth() + 1;
  });
  const d = new Date();
  expect(d.getFullYear() * 100 + d.getMonth() + 1, '★試験と 画面で 月が ずれている★').toBe(gamen);
});
