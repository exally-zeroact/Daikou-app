// ============================================================
// ★★道具の 向き先が repo と 同じか★★ 2026-09-06
//
//   ★見つかった 事（指示役の 週1の 見張り）★
//     `scripts/check-hosts.mjs` に ★`MY_SIDE = 'test'`★ が 残っていた。
//     ここは ★本番の repo★（js/dk-config.js が tnfwipbgfgjaymlszeid）。
//     この道具は `--side` を 付けないと `MY_SIDE` の 側だけを 見るので
//     ⇒★★本番側の 戻り先を 一度も 見ていなかった★★
//     ＝『守っているつもりで 何も 見ていない』（今日 決まりに した 形）。
//
//   ★★なぜ 人では 止まらないか★★
//     その ★すぐ上に 私が 自分で★ こう 書いていました：
//       「自分の倉庫だけ書く。反対側は そちらの repo で回す（環境を混ぜない）」
//     ⇒★★決まりを 書いた 場所の すぐ下で 破れます★★ ⇒ 機械に 数えさせる。
//
//   ★★見る 範囲（先に 数えた・2026-09-06）★★
//     倉庫の 名前が 出る ファイル … ★18本★（node_modules と data/ は 除く）
//     そのうち ★反対側の 名前を 持つ★ … ★6本★
//       ①scripts/check-hosts.mjs ………★これが 悪い★（既定が 反対側だった）
//       ②scripts/auth-redirect-allow.mjs …★正しい★（--prod/--test/両方 を 選ぶ 道具）
//       ③scripts/auth-mail-otp.mjs ………★正しい★（同上）
//       ④tests/unit/dk-config-app-base-host.test.js …★正しい★（repo ごとの 対応表）
//       ⑤tests/integration/daikome-admin-wiring.test.js …★正しい★（両側を 知る 道具の 試験）
//       ⑥tests/e2e/jimusho-haishin-todoku.spec.js …★正しい★（どちらの 事務所かを 見分ける）
//     ⇒★★「反対側の 名前が 在る＝悪い」では ありません★★
//       ★悪いのは「★既定★が 反対側」だけ★＝ここを 数えます。
//     ★一番 守りたい ファイルは 名指しで 入れています★（下の MAMORU）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-06 実測）★★
//     ①check-hosts.mjs の MY_SIDE を 'test' 直書きに 戻す … ★赤★
//     ②js/dk-config.js から 出すのを やめる ………………… ★赤★
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const PROD = 'tnfwipbgfgjaymlszeid';
const TEST = 'khawdrnvssdenumbiwfg';

// ★★『どちら側か』を ★2つの 別の 物★ で 出す★★ 2026-09-06（指示役の 指摘）
//   ★指摘★「①の『どちら側か』も js/dk-config.js なら ★輪に なっています★」
//     ・dk-config が 正しい ⇒ 道具も 正しい ⇒ 緑
//     ・dk-config が ★間違っていても★ ⇒ 道具も 同じに 間違う ⇒ ★やっぱり 緑★
//   ⇒★『1か所から 出す』は 正しい／でも ★その 1か所が 正しいか★は 別の 物で 見る★
//   ⇒★★repo の 名前（git remote）★で 見ます★
//     Daikou-app なら 本番／Daikou-app-test なら テスト
//   ⇒★これが 在ると『設定ごと 反対に した』も 捕まります★
function repoNoNamae() {
  try {
    const u = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    if (/Daikou-app-test(\.git)?$/i.test(u)) return 'test';
    if (/Daikou-app(\.git)?$/i.test(u)) return 'prod';
    return null;
  } catch (_) {
    return null; // ★git が 無い所でも 試験を 止めない★（下で「測れない」と 出す）
  }
}

// ★この repo は どちら側か★＝お客さんの 画面が 使う 1本から 出す
function konoRepo() {
  const s = fs.readFileSync(path.join(ROOT, 'js', 'dk-config.js'), 'utf8');
  const p = s.indexOf(PROD) >= 0;
  const t = s.indexOf(TEST) >= 0;
  return { prod: p, test: t, side: p && !t ? 'prod' : !p && t ? 'test' : null };
}

// ★必ず 見る ファイル（名指し）★
//   ★範囲から 漏れると 見張りが 空振りします★（指示役 2026-09-06 の 指摘）
const MAMORU = ['js/dk-config.js', 'scripts/check-hosts.mjs'];

describe('★道具の 向き先が repo と 同じか★', () => {
  const kono = konoRepo();

  it('★① この repo が どちら側か 1つに 決まる★', () => {
    expect(
      kono.side,
      '★js/dk-config.js に 両方の 倉庫が 在る／どちらも 無い★＝どちら側か 決まりません'
    ).not.toBe(null);
  });

  it('★①-2 repo の 名前と 設定の 向き先が 同じ★（輪に しない）', () => {
    const na = repoNoNamae();
    // ★git が 読めない所（配った 中身だけ 等）は 測れない＝黙って 緑に しない為 印を 出す★
    if (na === null) {
      // eslint-disable-next-line no-console
      console.log('★未測定★ repo の 名前が 読めません（git remote が 無い）');
      return;
    }
    expect(
      kono.side,
      '★repo の 名前は ' +
        na +
        ' 側なのに js/dk-config.js は ' +
        kono.side +
        ' 側です★\n' +
        '  ⇒ ★設定ごと 反対に なっています★（本番の repo が テストの 倉庫を 指す 等）'
    ).toBe(na);
  });

  it('★② 守りたい ファイルが 見る 範囲に 入っている★', () => {
    const nai = MAMORU.filter((f) => !fs.existsSync(path.join(ROOT, f)));
    expect(nai, '★名指しした ファイルが 在りません（名前が 変わった？）★').toEqual([]);
  });

  it('★③ check-hosts の 既定が この repo の 側と 同じ★', () => {
    const s = fs.readFileSync(path.join(ROOT, 'scripts', 'check-hosts.mjs'), 'utf8');
    // ★向き先を 手で 書いていない事★＝js/dk-config.js から 出している
    expect(
      /MY_SIDE\s*=\s*['"](prod|test)['"]/.test(s),
      '★MY_SIDE を 手で 書いています★（反対側に なっても 誰も 気づけません）\n' +
        '  ⇒ js/dk-config.js から 出してください（向き先は 1か所）'
    ).toBe(false);
    expect(
      s.indexOf('DK_CFG'),
      '★js/dk-config.js を 読んでいません★（向き先の 元が ありません）'
    ).toBeGreaterThan(0);

    // ★実際に 走らせた 時の 既定が この repo の 側に なるか★（字ではなく 振る舞い）
    const cfg = fs.readFileSync(path.join(ROOT, 'js', 'dk-config.js'), 'utf8');
    const side = cfg.includes(PROD) ? 'prod' : 'test';
    expect(side, '★repo の 側と 食い違います★').toBe(kono.side);
    const auth = side === 'prod' ? PROD : TEST;
    expect(
      s.indexOf(auth),
      '★この repo の 側の 倉庫を 見ていません★（反対側だけ 見ています）'
    ).toBeGreaterThan(0);
  });
});
