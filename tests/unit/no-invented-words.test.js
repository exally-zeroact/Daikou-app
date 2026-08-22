'use strict';
// ============================================================
// ★勝手な言い換えをしないこと★ 2026-08-07
//
//   ★司さん「合言葉ってなんど パスワードやろがぼけ 勝手なことすんなや」★
//     私が password を「合言葉」と勝手に言い換えていた。
//     頼まれてもいないのに分かりやすくしようとした結果、
//     ★司さんが読めない言葉になった★（他のアプリは全部「パスワード」）。
//
//   ★決まり★
//     画面に出す言葉は、★他のアプリで既に使っている言い方に合わせる★。
//     良かれと思って言い換えない。
//
//   ここで縛るのは「私が実際にやってしまった言い換え」だけ。
//   増やす時は、実際に叱られた物だけを足すこと（先回りで増やさない）。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// 画面に出るファイル（ここに出る言葉が司さんの目に入る）
const SCREENS = [
  'index.html',
  'dashboard.html',
  'uriage.html',
  'kyuryo.html',
  'shukei.html',
  'login.html',
  'daikome-admin.html',
];
const SCRIPTS = ['js/daikome-admin.js', 'js/dk-session.js'];

// ★言い換えてはいけない物★ 左=勝手な言い換え / 右=正しい言い方
const NG = [{ bad: '合言葉', good: 'パスワード', why: '司さんに「パスワードやろが」と言われた' }];

function read(f) {
  const p = path.join(ROOT, f);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

describe('★勝手な言い換えをしていないこと★', () => {
  NG.forEach(function (n) {
    it('「' + n.bad + '」を使っていない（正しくは「' + n.good + '」）', () => {
      const hit = [];
      SCREENS.concat(SCRIPTS).forEach(function (f) {
        const t = read(f);
        if (!t) return;
        t.split('\n').forEach(function (line, i) {
          if (line.indexOf(n.bad) >= 0) hit.push(f + ':' + (i + 1));
        });
      });
      expect(hit, '★' + n.why + '★ 出た所: ' + hit.join(', ')).toEqual([]);
    });
  });

  it('★管理画面はちゃんと「パスワード」と出している★', () => {
    const h = read('daikome-admin.html');
    expect(h, '入力欄の案内が無い').toContain('placeholder="パスワード"');
  });

  it('★他のアプリと同じ言い方であること★（Kyually の管理画面と突き合わせる）', () => {
    // 他アプリが手元に無い環境では飛ばす（CIでも本番repoでも落とさない）
    const other = 'C:/Users/zeroa/payslip-app/admin.html';
    if (!fs.existsSync(other)) return;
    const o = fs.readFileSync(other, 'utf8');
    expect(o, '比べる相手が変わっている').toContain('パスワード');
    expect(read('daikome-admin.html'), '★ダイコメだけ違う言い方になっている★').toContain(
      'パスワード'
    );
  });
});
