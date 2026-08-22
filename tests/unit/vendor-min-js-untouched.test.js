// ============================================================
// ★同梱ライブラリ(*.min.js)を prettier に書き換えさせない★（2026-08-22）
//
//   ★起きていた事（2026-08-22 実測）★
//     本番repo と テスト線で ★js/tweetnacl.min.js と js/qrcode.min.js が別物★ になっていた。
//       tweetnacl … 本番 28,919B(957行) ／ テスト線 18,456B(1行)
//       qrcode    … 本番 57,529B       ／ テスト線 56,694B
//     中身は同じライブラリで、★本番側だけ prettier で整形されていた★。
//
//   ★真因★
//     ★本番repo に .prettierignore が無かった★（テスト線には在る）。
//     `npm run format` = `prettier --write '**/*.{js,css,html}'` が
//     ★同梱の min.js まで書き換える★。
//     ＝ ★ライセンスの署名を確かめる部品(tweetnacl)が、本番だけ別の字になっていた★。
//       しかも license-v2 の試験2本が本番に無く、★誰も見ていなかった★。
//
//   ★決まり★
//     .prettierignore に ★**/*.min.js★ が在る事。無ければ赤。
//     （行数や大きさで見ない＝qrcode.min.js は元から2,297行あり、行数では見分けられない）
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const IGNORE = path.join(ROOT, '.prettierignore');

describe('★同梱ライブラリ(*.min.js)は prettier で書き換えない★', () => {
  it('.prettierignore が在る', () => {
    expect(
      fs.existsSync(IGNORE),
      '★.prettierignore が無い＝npm run format が同梱ライブラリを書き換える★'
    ).toBe(true);
  });

  it('.prettierignore に **/*.min.js が在る', () => {
    const s = fs.readFileSync(IGNORE, 'utf8');
    const lines = s
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    expect(
      lines,
      '★**/*.min.js が無い＝tweetnacl/qrcode が整形されて 別repoと食い違う★'
    ).toContain('**/*.min.js');
  });

  it('★同梱ライブラリが実在する（消えたら赤）★', () => {
    for (const f of ['js/tweetnacl.min.js', 'js/qrcode.min.js']) {
      expect(fs.existsSync(path.join(ROOT, f)), `★${f} が無い★`).toBe(true);
    }
  });
});
