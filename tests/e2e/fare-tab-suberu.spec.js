// tests/e2e/fare-tab-suberu.spec.js
// ★★料金設定の タブに「横に すべる」合図が 在るか★★ 2026-08-31
//
//   ★何が 悪かったか（2026-08-30 実測）★
//     390px の 画面で 窓390px / 中身587px ＝ ★197px が 横に 隠れていた★。
//     すべる事は 出来ていた（scrollLeft 0→197 が 動いた）のに
//     ★印が 1つも 無かった★（box-shadow:none / scroll-snap:none / mask・gradient:none）。
//     ⇒ ★「その機能が 無い」と 思われる★（同じ物が 同日 Exally でも 出た）
//
//   ★直した形★
//     白い覆い(background-attachment:local)は 中身と 一緒に すべり、
//     影(scroll)は 枠に 貼り付く ⇒ ★すべれる 側にだけ 影が 出る★（JS 無し）
//
//   ★ここで 見る事（★字を 読むだけに しない★）★
//     ①はみ出している 事（そもそも すべる 必要が 在る）
//     ②★右端の 見た目が 「左端に 居る時」と「右端に 居る時」で 変わる★
//       ＝影が 実際に 描かれ、端で 消えている
//     ③左端も 同じ（逆向き）
//     ④仕掛けが 残っている（local が 消されていない）
//   ⇒ ②③は ★絵を 撮って 比べます★。影を 消すと 2枚が 同じに なり ★赤★。
const { test, expect } = require('@playwright/test');

const W = 390; // iPhone 12/13
const H = 780;

// ★★2026-09-01 前提が 変わりました★★
//   司さん「事務所でやるならこの画面はメーターの方にいらんことないか？」
//   ⇒ 料金設定の 札を ★9つ → 3つ（料金表／追加料金／値引き）★に 減らしました。
//   ⇒ 390px で ★もう はみ出しません★（実測）。
//   ★では この見張りは 要らないか？ … 要ります★
//     札は また 増えるかもしれません。増えた時に ★合図が 無い★と
//     「その機能が 無い」と 思われる（2026-08-30 の 指摘そのもの）。
//   ⇒ ★札を わざと 増やして はみ出させ、その時 影が 出るか★を 見ます。
//     （★今 はみ出していないから 緑★、では ありません）
//
//   ★★わざと壊した 記録（2026-09-01）★★
//     ・1回目 … 壊す 文字が ★当たっていなかった★（prettier が 行を 変えていた）
//       ⇒ ★緑のまま★だったので「見張りが 嘘」と 一度 思いました。★私の 壊し方が 悪かった★。
//     ・2回目 … `radial-gradient(farthest-side` を 全部（4か所）置き換えて ★本当に 消した★
//       ⇒ ★3本 赤★（①だけ 緑＝はみ出しの 話なので 当然）／戻して ★4本 緑★
//     ⇒★「赤に ならなかった」時は ★まず 自分の 壊し方を 疑う★★
async function fuyasu(page) {
  await page.evaluate(() => {
    const nav = document.querySelector('#overlayFare .tab-nav');
    for (let i = 0; i < 8; i++) {
      const b = document.createElement('button');
      b.className = 'tab-btn';
      b.textContent = 'ためし' + i;
      nav.appendChild(b);
    }
  });
  await page.waitForTimeout(200);
}

async function hiraku(page) {
  await page.setViewportSize({ width: W, height: H });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.showOverlay('fare'));
  await page.waitForTimeout(300);
}

// ★★札そのものを 透明に する★★ 2026-08-31（わざと壊して 2回 分かった）
//   ①最初 … 端の 帯を 丸ごと 比べた ⇒ 影を 消しても 緑（★動いたのは 字★）
//   ②次   … 上端3px に 絞った ⇒ 右端は 赤に なったが ★左端は まだ 緑★
//            （選ばれている札の 色 #e8f4fd が 端に 出入りしていた＝★測っていたのは 札の色★）
//   ⇒ ★札の 色・字・下線を 全部 透明に して、残るのが 影だけ★の 状態で 測ります。
//     これで「影が 無い」＝2枚が ★同じ白★に なり 必ず 赤に なります。
async function fudaWoKesu(page) {
  await page.addStyleTag({
    content:
      '#overlayFare .tab-btn{background:transparent !important;color:transparent !important;' +
      'border-bottom-color:transparent !important}',
  });
  await page.waitForTimeout(150);
}

// ★端の 帯を 1枚 撮る★
//   ★★2026-08-31（わざと壊して 分かった）★★
//     最初は 端の 帯を 丸ごと 撮って 比べていました。
//     ⇒ 影を 消しても ★緑のまま★でした。すべると ★札の 字★が 動くので
//       帯の 絵は 影が 無くても 必ず 変わるからです（★測っていたのは 字★）。
//     ⇒★字が 絶対に 届かない「上端 3px」だけ★を 撮ります。
//       札の 上の 余白は 14px あるので、ここに 出るのは ★背景だけ★です。
async function haji(page, migi) {
  const HABA = 20; // 影の 幅（background-size と 同じ）
  const r = await page.evaluate(() => {
    const el = document.querySelector('#overlayFare .tab-nav');
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width };
  });
  return page.screenshot({
    clip: {
      x: Math.round(migi ? r.x + r.w - HABA : r.x),
      y: Math.round(r.y) + 1,
      width: HABA,
      height: 3,
    },
  });
}

async function suberu(page, saki) {
  await page.evaluate((s) => {
    const el = document.querySelector('#overlayFare .tab-nav');
    el.scrollLeft = s === 'migi' ? el.scrollWidth : 0;
  }, saki);
  await page.waitForTimeout(250);
}

test('★★① 今は はみ出していない（札を 3つに 減らしたから）★★', async ({ page }) => {
  await hiraku(page);
  const m = await page.evaluate(() => {
    const el = document.querySelector('#overlayFare .tab-nav');
    return { sw: el.scrollWidth, cw: el.clientWidth };
  });
  // ★はみ出していないのに 影だけ 出る、を 起こさない★
  expect(
    m.sw,
    '★札が 増えて はみ出しています（合図の 出方を 確かめてください）★'
  ).toBeLessThanOrEqual(m.cw + 2);
});

test('★★② 札が 増えたら 右端に 影が 出る★★', async ({ page }) => {
  await hiraku(page);
  await fuyasu(page);
  const m = await page.evaluate(() => {
    const el = document.querySelector('#overlayFare .tab-nav');
    return { sw: el.scrollWidth, cw: el.clientWidth };
  });
  expect(m.sw, '★札を 増やしても はみ出しません（試し方が 壊れています）★').toBeGreaterThan(
    m.cw + 20
  );
  await fudaWoKesu(page);
  await suberu(page, 'hidari');
  const a = await haji(page, true);
  await suberu(page, 'migi');
  const b = await haji(page, true);
  expect(
    Buffer.compare(a, b) !== 0,
    '★右端の 背景が 動く前と 後で 同じ＝影が 描かれていません★'
  ).toBe(true);
});

test('★★③ 札が 増えたら 左端も 同じ★★', async ({ page }) => {
  await hiraku(page);
  await fuyasu(page);
  await fudaWoKesu(page);
  await suberu(page, 'hidari');
  const a = await haji(page, false);
  await suberu(page, 'migi');
  const b = await haji(page, false);
  expect(Buffer.compare(a, b) !== 0, '★左端の 背景が 変わりません＝影が 描かれていません★').toBe(
    true
  );
});

test('★④ 仕掛け（local）が 残っている★', async ({ page }) => {
  await hiraku(page);
  const css = await page.evaluate(() => {
    const el = document.querySelector('#overlayFare .tab-nav');
    const s = getComputedStyle(el);
    return { att: s.backgroundAttachment, img: s.backgroundImage };
  });
  expect(css.att, '★覆いが 一緒に すべる 仕掛け(local)が ありません★').toContain('local');
  expect(
    (css.img.match(/radial-gradient/g) || []).length,
    '★影(radial-gradient)が 2つ ありません★'
  ).toBeGreaterThanOrEqual(2);
});
