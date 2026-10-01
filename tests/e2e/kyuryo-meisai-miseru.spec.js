// ============================================================
// ★今 在る 給料明細を そのまま 開いて 写真に 撮る★ 2026-10-01
//
//   ★司さん★「前につくったやつがあるなに描いて出すってなんど」
//     ⇒ ★新しく 作らない★。既に 在る 物を そのまま 開いて 出す。
//
//   ★使う 物は 全部 既に 在る 物★
//     ・画面 …… kyuryo.html（本物）
//     ・中身 …… tests/fixtures/kyuryo-real.json（前から 在る 実物の 形）
//     ・開き方 … tests/e2e/kyuryo-harness.js（kyuryo-paper.spec.js が 使っている 物）
//     ・紙 ……… window.__paper.build()（★画面が 印刷/PDF で 使う その物★）
//   ＝私は ★1本も 新しく 描いていません★。
//
//   ★撮り方で 1つ 困った（直した）★
//     組んだ 紙を 画面に 置いて 撮ろうとすると ★画面側の 書き直しで 紙が 消える★
//     （高さ 794 → 16 に なるのを 実測。白い 帯を 1枚 出しかけた）。
//     ⇒ ★アプリが 作った その 字(outerHTML)と 画面の 飾り(style)を
//       そのまま 白紙に 貼って 撮る★。中身は 1文字も 触らない。
//
//   ※ 合否を 見るのは kyuryo-paper.spec.js（11本）。ここは ★見せる ための 物★。
// ============================================================
const { test, expect } = require('@playwright/test');
const path = require('path');
const { openKyuryo } = require('./kyuryo-harness');

const OUT = (n) => path.join('data', 'shashin', n);

test.setTimeout(120000);

test('★在る 給料明細を そのまま 出す★', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await openKyuryo(page);

  // ★画面が 印刷/PDF に 使う その物を 組ませ、その 字を そのまま 取る★
  const kami = await page.evaluate(() => {
    const m = window.__paper.maisu(0);
    const hi = window.__paper.hi(0);
    const el = window.__paper.build(0, 0, Math.min(hi, m.per), 1, m.n);
    const kazari = Array.from(document.querySelectorAll('style'))
      .map((s) => s.textContent)
      .join('\n');
    return {
      ninzu: window.__paper.ninzu(),
      maisu: m.n,
      hi: hi,
      ji: (el.innerText || '').length,
      html: el.outerHTML,
      kazari: kazari,
    };
  });

  // ★空の 紙を 出さない★（数えてから 撮る）
  expect(kami.ninzu, '★人が 1人も 居ない★').toBeGreaterThan(0);
  expect(kami.ji, '★紙に 字が 無い★').toBeGreaterThan(200);
  expect(kami.html.length, '★紙の 字が 空★').toBeGreaterThan(1000);

  const W = Math.round((842 * 96) / 72); // A4 横
  await page.setContent(
    '<!doctype html><meta charset="utf-8"><style>' +
      kami.kazari +
      '</style><style>body{margin:0;background:#fff}' +
      // ★紙は `position:fixed; left:-10000px`（画面の 外）で 作られる。
      //   ★置き場だけ★ 表に 戻す（幅・高さ・中身は そのまま）
      '#__k > div{position:static !important;left:auto !important;top:auto !important}' +
      '#__k{width:' +
      W +
      'px;background:#fff;padding:10px}</style><div id="__k">' +
      kami.html +
      '</div>'
  );
  await page.waitForTimeout(300);
  const ookisa = await page.evaluate(() => {
    const b = document.getElementById('__k');
    return { w: b.offsetWidth, h: b.offsetHeight };
  });
  // ★点の 絵を 出さない★
  expect(ookisa.w, '★紙の 幅が 無い★').toBeGreaterThan(600);
  expect(ookisa.h, '★紙の 高さが 無い★').toBeGreaterThan(300);

  await page.setViewportSize({ width: ookisa.w + 20, height: ookisa.h + 20 });
  await page.screenshot({ path: OUT('kyuryo-meisai-ima.png'), fullPage: true });
  // eslint-disable-next-line no-console
  console.log(
    '★出した 明細★',
    JSON.stringify({ ninzu: kami.ninzu, maisu: kami.maisu, hi: kami.hi, ji: kami.ji, ookisa })
  );
});
