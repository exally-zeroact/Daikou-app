// tests/unit/monosashi-mode.test.js
//
// ★★どちらの物差しで 採点しているか 書いていない試験を 数える★★ 2026-08-28（指示役の裁定①-4）
//
//   ★同じ距離の数字でも 採点が 2つ 在ります★
//     ① ★タクシー認定モード★(係数1.0) … ★過大不可（真距離を超えたら 赤）★。片側公差。
//     ② ★代行モード★(係数 1.0085 = +0.85%) … ★検定対象外★。
//        ★随伴車の DM Light に わざと合わせる★ 為の上乗せで、
//        実上限は ★DM Light／タイヤ真値（オドメーター）＝真距離 +0.5〜6%★ という 緩い天井。
//
//   ★これを書いていないと 何が起きるか★
//     2026-08-23 に「代行で 過大課金が 起きている」と 司さんへ 上げてしまいました。
//     実際は ★①の物差しで 赤だっただけ★で、②では 天井の中でした（2026-08-28 実測 +1.35〜1.70%）。
//     ＝★物差しを 書いていない数字は、読む人に 別の意味で 伝わります★。
//
//   ⇒ ★「過大」で 赤/緑を 決めている試験には どちらの物差しか 書く★
//     書いてある印 … 「タクシー認定」「代行モード」「検定対象外」「1.0085」「DM Light」
//   ⇒ ★書いていない物を ここで数え、増えたら 赤★（黙って増やせない）
//   ⇒ ★1本 書くたびに ここから 消して 数を減らす★（減らすのも 手で直す＝気づける）
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

// ★この見張り自身と 帳簿の見張りは 数えない★（距離を採点していない＝書きようがない）
const JOGAI = [
  'tests/unit/mada-naoshite-inai.test.js',
  'tests/unit/scripts-registered.test.js',
  'tests/unit/monosashi-mode.test.js',
];

const KADAI = /過大|neverOver|never-over/;
const MONOSASHI = /タクシー認定|代行モード|検定対象外|1\.0085|DM.?Light|DaikouDistanceFactor/;

// ★2026-08-28 実測 … 物差しを書いていない物★（1本 直すたびに ここから消す）
//   ★この日 5本 減らしました（55本 → 50本）★:
//     gate-bg-freeze / gate-tunnel-continuity …「どちらの採点でもない（まとめて乗るかだけ）」
//     gate-route-gain / gate-realdevice-doppler-rej …「真値は 参考表示・合否に使っていない」
//     truedist-obd-engine-gate …「独自の線＝真距離+5%（認定より緩く 代行天井より わずかに厳しい）」
const KAITENAI = [
  // ★2026-08-28 … ★0本になりました★（55 → 50 → 0）
  //   ★4種類の印を つけました（1本ずつ 中身を 読んでから）★
  //     ①タクシー認定モードの線（過大ゼロ）で判定 …………★35本★
  //       ＝この見張りが赤にするのは distance_m ≤ 真距離 を破った時。
  //         ★代行は 検定対象外＝ここが赤でも「代行で過大請求」とは 限らない★
  //     ②画面の見え方の線（display ≤ distance_m）………★9本★
  //     ③確定（凍結）後に 距離が増えないか ……………………★1本★
  //     ④距離の採点では ない（配線・較正・採点の道具）……★5本★
  //   ⇒★これから 増えたら 赤★（下の見張りが 数えます）
];

function atsumeru(dir, deta) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') atsumeru(p, deta);
      return;
    }
    if (!/\.(js|mjs)$/.test(e.name)) return;
    const rel = path.relative(ROOT, p).split(path.sep).join('/');
    if (JOGAI.indexOf(rel) >= 0) return;
    const src = fs.readFileSync(p, 'utf8');
    if (KADAI.test(src) && !MONOSASHI.test(src)) deta.push(rel);
  });
  return deta;
}

describe('★どちらの物差しか 書いていない試験★', () => {
  const ima = atsumeru(path.join(ROOT, 'tests'), []).sort();

  it('★本数が 増えていない★（黙って足せない）', () => {
    expect(
      ima.length,
      '★物差しを書いていない試験の本数が 変わりました★\n' +
        '  ・増えた … ★新しい試験に「タクシー認定 / 代行モード」どちらの採点か 書いてください★\n' +
        '  ・減った … ★直したなら KAITENAI から その1本を 消してください★\n' +
        '  ★物差しを書いていない数字は 読む人に 別の意味で 伝わります★（2026-08-23 の事故）'
    ).toBe(KAITENAI.length);
  });

  it('★中身も 同じ★（別の物と 入れ替わっていない）', () => {
    const fueta = ima.filter((f) => KAITENAI.indexOf(f) < 0);
    const hetta = KAITENAI.filter((f) => ima.indexOf(f) < 0);
    expect({ fueta, hetta }, '★数は同じでも 中身が 入れ替わっています★').toEqual({
      fueta: [],
      hetta: [],
    });
  });

  it('★名簿ではなく 実物を読む★（自分の名簿を 信じない）', () => {
    const uso = KAITENAI.filter((f) => {
      const p = path.join(ROOT, f);
      if (!fs.existsSync(p)) return true;
      return MONOSASHI.test(fs.readFileSync(p, 'utf8'));
    });
    expect(uso, '★もう書いてある（か 消えた）物が 名簿に 残っています★').toEqual([]);
  });
});
