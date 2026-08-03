'use strict';
// ============================================================
// ★ログインをパスワード方式にした 2026-08-03★
//
//   ★司さんの指摘が正解だった★
//     「どのみちメールきてサインインしたらSafariで開かれよるやろがぼけが」
//     旧: メールのリンクを押す方式だけ。
//         リンクは★ブラウザで開く★。アプリとブラウザはログイン情報を別々に持つので、
//         ブラウザで入ってもアプリ側は「まだ誰も入っていない」まま＝★毎回聞かれる★。
//     私が「ホーム画面に追加すれば直る」と言ったのは★間違い★。
//     リンクがブラウザで開く以上、追加しても同じことになる。
//
//   ★直し方★
//     パスワードでログインを主にする。開いているその場で終わる＝ブラウザに飛ばない。
//     メールのリンクは「パスワードを決める時」だけ（★1回だけ★）。
//
//   ※6桁の番号をメールに入れる案は使えなかった（実測）:
//     Supabase の無料プランは既定のメール送信だとテンプレートを変えられない
//     （"Email template modification is not available for free tier projects"）。
//     SMTPを用意すれば番号方式にもできるが、今日はパスワード方式で通す。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const LOGIN = fs.readFileSync(path.join(ROOT, 'login.html'), 'utf8');

describe('★パスワードでその場でログインできること★', () => {
  it('パスワードの入力欄がある', () => {
    expect(LOGIN).toContain('id="pw"');
    expect(LOGIN).toMatch(/id="pw"[^>]*type="password"/);
  });

  it('★パスワードで直接ログインする（grant_type=password）★', () => {
    expect(LOGIN, 'パスワードログインを呼んでいない').toContain(
      '/auth/v1/token?grant_type=password'
    );
  });

  it('★ログインしたら その場で保存する（ブラウザに飛ばない）★', () => {
    const i = LOGIN.indexOf('grant_type=password');
    const around = LOGIN.slice(i, i + 1600);
    expect(around).toContain('DKSession.save');
    expect(around).toContain("location.replace('dashboard.html')");
  });

  it('dk-session.js を読み込んでいる（保存の実装は1つだけ）', () => {
    expect(LOGIN).toContain('src="js/dk-session.js"');
    // 自前で保存場所を書いていないこと
    expect(LOGIN).not.toContain("localStorage.setItem('dk_dash_sess'");
  });
});

describe('★メールのリンクは「パスワードを決める時」だけ★', () => {
  it('メールの戻り先が login.html である（dashboard ではない）', () => {
    const i = LOGIN.indexOf('/auth/v1/otp');
    const around = LOGIN.slice(i, i + 800);
    expect(around).toContain("email_redirect_to: location.origin + '/login.html'");
    expect(around, '戻り先が dashboard のままだとパスワードを決める画面に行けない').not.toContain(
      "'/dashboard.html'"
    );
  });

  it('戻ってきたらパスワードを決める画面を出す', () => {
    expect(LOGIN).toContain('setpw-view');
    expect(LOGIN).toMatch(/access_token=/);
  });

  it('★決めたパスワードをアカウントに保存する★', () => {
    const i = LOGIN.indexOf('/auth/v1/user');
    expect(i, 'パスワードを保存する呼び出しが無い').toBeGreaterThan(-1);
    const around = LOGIN.slice(i - 200, i + 600);
    expect(around).toContain("method: 'PUT'");
    expect(around).toContain('password: p1');
  });

  it('2回入れさせて、6文字未満と食い違いを止める', () => {
    expect(LOGIN).toContain('id="pw1"');
    expect(LOGIN).toContain('id="pw2"');
    expect(LOGIN).toContain('6文字以上');
    expect(LOGIN).toContain('2つのパスワードが違います');
  });
});

describe('★はじめての人が迷子にならないこと★', () => {
  it('「はじめて／パスワードを忘れた」の入口がある', () => {
    expect(LOGIN).toContain('id="toSetPw"');
    expect(LOGIN).toContain('はじめて');
  });

  it('ログインに戻れる', () => {
    expect(LOGIN).toContain('id="toLogin"');
  });

  it('前に入れたメールを覚えている（打ち直しをさせない）', () => {
    expect(LOGIN).toContain('dk_last_email');
  });
});

describe('★事務所で通す物に入っていること（入っていないと画面が動かない）★', () => {
  it('login.html が読む js が 事務所の通す一覧に在る', async () => {
    const oa = await import('../../scripts/office-allow.mjs');
    const { allow } = oa.buildAllowList(ROOT);
    const refs = Array.from(oa.refsIn(LOGIN)).filter((r) => r.endsWith('.js'));
    expect(refs.length, 'login.html が js を1つも読んでいない').toBeGreaterThan(0);
    refs.forEach((r) => expect(allow, r + ' が通っていない').toContain(r));
  });
});
