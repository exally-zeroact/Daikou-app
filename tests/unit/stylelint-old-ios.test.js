'use strict';
// ============================================================
// ★古いiPhoneで効かないCSSの書き方を、lintに強要させない★ 2026-08-05
//
//   ★何があったか★
//     給料の従業員表をスマホで1人1枚にするため @media (max-width: 620px) を書いたら、
//     stylelint が「@media (width <= 620px) にしろ」と赤にした（標準設定の既定）。
//     ★この新しい書き方は Safari 16.4 未満で丸ごと無視される。★
//     ＝古いiPhoneでは横スクロールの表に戻り、最低保証が画面の外に出る。
//
//   ★決めたこと★
//     見た目の決まりより★実機で効くこと★を採る。
//     media-feature-range-notation を "prefix"(max-width 形) に固定する。
//
//   ここが勝手に戻されると、また古いiPhoneで崩れるので機械で縛る。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, '.stylelintrc.json'), 'utf8'));

describe('★古いiPhoneで効く書き方を守ること★', () => {
  it('★max-width 形を使う設定になっている★（新しい範囲記法は旧iOSで無視される）', () => {
    expect(
      CFG.rules && CFG.rules['media-feature-range-notation'],
      '★(width <= 620px) を強要されると、古いiPhoneで丸ごと無視される★'
    ).toBe('prefix');
  });

  it('★事務所の画面が新しい範囲記法を使っていない★', () => {
    // ★2026-08-29: company.html が 一覧に 無く ★見ていませんでした★
    //   （本番へ 運ぼうとして pre-commit の stylelint に 捕まって 気づいた）
    //   ＝★一覧に 入れ忘れた画面は 何も 見られない★。★画面を 足したら ここにも 足す★
    const files = [
      'kyuryo.html',
      'uriage.html',
      'shukei.html',
      'dashboard.html',
      'login.html',
      'company.html',
      'index.html',
      'sub.html',
      'history.html',
      'settings.html',
    ];
    const bad = [];
    // ★2026-08-28: 前は「無ければ return」＝★何も見ずに緑★でした（5枚 全部 消えても 緑）。
    const nai = files.filter((f) => !fs.existsSync(path.join(ROOT, f)));
    expect(nai, '★事務所の画面が 在りません（一覧を 直してください）★').toEqual([]);
    files.forEach(function (f) {
      const p = path.join(ROOT, f);
      const t = fs.readFileSync(p, 'utf8');
      // @media (width <= 620px) / (width >= 700px) のような形
      const re = /@media[^{]*\(\s*(width|height)\s*[<>]=?/g;
      let m;
      while ((m = re.exec(t))) {
        bad.push(f + ':' + t.slice(0, m.index).split('\n').length);
      }
    });
    expect(bad, '★古いiPhoneで丸ごと無視される書き方★').toEqual([]);
  });

  it('給料の画面がスマホ向けの区切りを持っている（max-width 形で）', () => {
    const t = fs.readFileSync(path.join(ROOT, 'kyuryo.html'), 'utf8');
    expect(t, '★スマホ向けの区切りが無い＝最低保証が画面の外に出る★').toContain(
      '@media (max-width: 620px)'
    );
  });
});
