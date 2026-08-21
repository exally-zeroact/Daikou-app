// ============================================================
// ★設定画面の「アプリ バージョン」に ★本番／テスト用★ と アドレスを出す★（2026-08-21）
//
//   ★起きた事★
//     司さんの端末（ホーム画面アプリ）の版が daikome-c7a5b18＝テスト線の刻印になっていた。
//     ★ホーム画面アプリ(PWA)は アドレスバーが出ない★ので、
//     司さんには「今どっちを開いているか」を確かめる手立てが無かった。
//     私は「⋮→サイト情報を見て」と書いたが、★PWAにその道は無い★＝役に立たない指示だった。
//
//   ★直し★
//     版の行に ★「版 / 本番（またはテスト用） / アドレス」★ を出す。
//     ・判定は ★location.host★（-test が付いていたらテスト用）＝★中の設定を信じない★
//     ・SWが未登録・応答なし・取得失敗の時も ★必ず 本番/テスト と アドレスは出す★
//       （版が読めない時こそ どっちを開いているかが要る）
// ============================================================
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.resolve(__dirname, '..', '..', 'index.html'), 'utf8');

describe('★アプリ バージョンの行に 本番/テスト用 と アドレスが出る★', () => {
  it('判定は location.host から作る（設定の文字を信じない）', () => {
    expect(HTML, '★環境の見分けが無い★').toContain('function _envLabel()');
    const i = HTML.indexOf('function _envLabel()');
    const body = HTML.slice(i, i + 400);
    expect(body, '★アドレスから判定していない★').toContain('location.host');
    expect(body).toContain('テスト用');
    expect(body).toContain('本番');
  });

  it('★版が読めない時も 本番/テスト用 と アドレスを出す★（4通り全部）', () => {
    const i = HTML.indexOf('function _loadAppVersion()');
    const body = HTML.slice(i, i + 2000);
    for (const kind of ['(SW 未登録)', '(取得失敗)', '(応答なし)']) {
      expect(body, `★${kind} の時に 環境が出ていない★`).toContain(`_withEnv('${kind}')`);
    }
    expect(body, '★版が取れた時に 環境が出ていない★').toContain('_withEnv(ev.data.value)');
  });

  it('出す形は「版 / 本番 / アドレス」', () => {
    const i = HTML.indexOf('function _withEnv(');
    const body = HTML.slice(i, i + 200);
    expect(body).toContain('_envLabel()');
    expect(body).toContain('location.host');
  });
});
