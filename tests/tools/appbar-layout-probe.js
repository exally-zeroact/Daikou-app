// tests/tools/appbar-layout-probe.js
// ★青バー(appbar)の段数プローブ (2026-06-20・Android 2段→1段 修正用)★
//   司さん「Androidだけ上の青バーが2段になってる・1段に直して」。
//   appbar は flex-wrap:wrap で、狭い端末では nav(ホーム/使い方/設定)が2行目に折り返す=2段。
//   本プローブは複数端末幅で ①appbar の実高さ ②appbar-left と appbar-nav が同じ行か
//   (rect.top 一致)を測り、1段(=nav が left と同行)を定量判定する。
//   使い方: node tests/tools/appbar-layout-probe.js   (要 http-server :3000)
'use strict';
const { chromium } = require('@playwright/test');

// 主要実機幅 (CSS px)。Android(狭い)と iPhone(Safari)両方を含める。
const DEVICES = [
  { name: 'Android最小(320)', w: 320, h: 720 },
  { name: 'Android標準(360)', w: 360, h: 780 },
  { name: 'Pixel(393)', w: 393, h: 851 },
  { name: 'iPhoneSE(375)', w: 375, h: 667 },
  { name: 'iPhone12/13(390)', w: 390, h: 844 },
  { name: 'iPhoneProMax(430)', w: 430, h: 932 },
];

(async () => {
  const browser = await chromium.launch();
  let allOneRow = true;
  for (const d of DEVICES) {
    const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h } });
    const page = await ctx.newPage();
    await page.goto('http://localhost:3000/index.html', { waitUntil: 'domcontentloaded' });
    // appbar は最初から screenIdle で見える。少し待って layout 安定化。
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => {
      const bar = document.getElementById('appbar');
      const left = document.querySelector('.appbar-left');
      const nav = document.querySelector('.appbar-nav');
      if (!bar || !left || !nav) return { err: 'missing el' };
      const rb = bar.getBoundingClientRect();
      const rl = left.getBoundingClientRect();
      const rn = nav.getBoundingClientRect();
      // nav が left と同じ行か = top 差が小さい (<6px)。2段なら nav.top は left.bottom 付近。
      const sameRow = Math.abs(rn.top - rl.top) < 6;
      return {
        barH: Math.round(rb.height),
        leftTop: Math.round(rl.top),
        navTop: Math.round(rn.top),
        leftRight: Math.round(rl.right),
        navLeft: Math.round(rn.left),
        overlap: Math.round(rl.right - rn.left), // >0 = 左グループとnavが重なる
        sameRow,
      };
    });
    const rows = m.sameRow ? 1 : 2;
    if (rows !== 1) allOneRow = false;
    const flag = rows === 1 ? '✅1段' : '❌2段';
    const ov = m.overlap > 0 ? ` ★重なり${m.overlap}px★` : '';
    console.log(
      `${flag} ${d.name.padEnd(16)} barH=${m.barH}px leftTop=${m.leftTop} navTop=${m.navTop}${ov}`
    );
    await ctx.close();
  }
  await browser.close();
  console.log('');
  console.log(allOneRow ? '=== 全端末1段 PASS ===' : '=== 2段が残る端末あり FAIL ===');
  process.exit(allOneRow ? 0 : 1);
})();
