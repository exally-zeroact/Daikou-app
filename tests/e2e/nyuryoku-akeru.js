// ============================================================
// ★入力の 車は 既定で 畳む★ 2026-10-23（司さん「デフォはドロップダウン式にして車の名前だけ…押したら全項目」）
//   前から 在る 入力の 試験は「欄に 打つ」前に 客と 同じく 車の 名前を 押して 開く。
//   ★既定で 開いた 形に 戻して 緑に しない★（畳む 試験 nyuryoku-tatamu.spec.js が 既定で 畳む 事を 縛る）
// ============================================================
const { expect } = require('@playwright/test');

// 畳んで いる 車を 全部 押して 開く（押す 前に 畳んで いた 事も 数える＝既定で 開いて いたら 赤）
async function zenbuAkeru(page) {
  const atama = page.locator('#shaList .sha:not(.aku) > .sha-atama');
  const n = await atama.count();
  for (let i = 0; i < n; i++) await atama.first().click();
  await expect(page.locator('#shaList .sha:not(.aku)')).toHaveCount(0);
  return n;
}

module.exports = { zenbuAkeru };
