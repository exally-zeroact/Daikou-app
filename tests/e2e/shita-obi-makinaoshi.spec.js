// ============================================================
// ★★見張り：下の 帯の 巻き直し（js/jimusho-footer.js）は 欄から 欄へ 移る 巻きを 止めない★★ 2026-10-23
//
//   ★前★ 欄の focusout から 60ms 後に 必ず scrollTo(今の位置) した＝「次へ」で 次の 欄へ 巻く 途中で 止まり、
//         次の 欄が キーボードの 裏に 残った（対立役 10-23 実測：webkit 1309／守りあり 2997）
//   ★今★ 次の 行き先が 欄なら 巻き直さない。欄から 出て 欄の 無い 所へ 行った 時と、選ぶ欄で 選んだ 時だけ 戻す。
//   ★押す物の一覧（先に書く）★ 1. 欄 a → 欄 b（巻きの 途中） 2. 欄 → 欄の 外 3. 選ぶ欄で 選ぶ
//   ★わざと壊して 赤★ 守りを 外した 版で ①が 赤（webkit 1309・chromium 42）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FOOT = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'jimusho-footer.js'), 'utf8');
const KAMI =
  '<html><body style="margin:0"><div style="height:200px"></div><input id="a">' +
  '<select id="s"><option>1</option><option>2</option></select>' +
  '<div style="height:3000px"></div><input id="b"><div style="height:1500px"></div></body></html>';

async function hiraku(page) {
  await page.setContent(KAMI);
  await page.addScriptTag({ content: FOOT });
  // 巻き直しの 回数を 数える（位置は 本物の scrollTo に 任せる）
  await page.evaluate(() => {
    window.__maki = 0;
    const moto = window.scrollTo.bind(window);
    window.scrollTo = function () {
      window.__maki++;
      return moto.apply(null, arguments);
    };
  });
}

test('① 欄 a → 欄 b へ 移る 巻きを 止めない', async ({ page }) => {
  await hiraku(page);
  const r = await page.evaluate(
    () =>
      new Promise((ok) => {
        const a = document.getElementById('a');
        const b = document.getElementById('b');
        a.focus();
        b.focus({ preventScroll: true });
        window.scrollTo({ top: 3000, behavior: 'smooth' });
        setTimeout(() => ok({ y: window.scrollY, maki: window.__maki }), 1500);
      })
  );
  // 巻き直しは 呼ばれない（数えるのは 試験の 巻き 1回だけ）・位置は 行き先まで 届く
  expect(r.maki).toBe(1);
  expect(r.y).toBeGreaterThan(2900);
});

test('② 欄から 欄の 外へ 出た 時は 今の 位置へ 1回 巻き直す（位置は 動かない）', async ({
  page,
}) => {
  await hiraku(page);
  const r = await page.evaluate(
    () =>
      new Promise((ok) => {
        window.scrollTo(0, 1000);
        const mae = window.scrollY;
        window.__maki = 0;
        const a = document.getElementById('a');
        a.focus({ preventScroll: true });
        a.blur();
        setTimeout(() => ok({ y: window.scrollY, mae, maki: window.__maki }), 300);
      })
  );
  expect(r.maki).toBe(1);
  expect(r.mae).toBeGreaterThan(900);
  // webkit（iPhone の 倍率）は scrollTo(今の位置) で 端数 2px 動く＝3px までは 動かない と 数える
  expect(Math.abs(r.y - r.mae)).toBeLessThanOrEqual(3);
});

test('③ 選ぶ欄で 選んだ 時は 欄に 居ても 巻き直す', async ({ page }) => {
  await hiraku(page);
  const r = await page.evaluate(
    () =>
      new Promise((ok) => {
        window.scrollTo(0, 500);
        const mae = window.scrollY;
        window.__maki = 0;
        const s = document.getElementById('s');
        s.focus({ preventScroll: true });
        s.value = '2';
        s.dispatchEvent(new Event('change', { bubbles: true }));
        setTimeout(() => ok({ y: window.scrollY, mae, maki: window.__maki }), 300);
      })
  );
  expect(r.maki).toBe(1);
  expect(r.mae).toBeGreaterThan(400);
  // webkit（iPhone の 倍率）は scrollTo(今の位置) で 端数 2px 動く＝3px までは 動かない と 数える
  expect(Math.abs(r.y - r.mae)).toBeLessThanOrEqual(3);
});
