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
    // ★★決まった 字数で 切らない★★ 2026-09-09（実測）
    //   ★前★ i + 400 で 切っていた
    //     ⇒ 説明を 6行 足した だけで ★中身に 届かず 赤★（中身は 正しいのに）
    //   ★今★ ★次の 関数の 頭★まで 読む
    const body = HTML.slice(i, HTML.indexOf('function _withEnv(', i));
    expect(body, '★アドレスから判定していない★').toContain('location.host');
    expect(body).toContain('テスト用');
    // ★★本番には 何も 付けない★★ 2026-09-09
    //   ★司さん★「バージョンも 本番って いれるな
    //             テスト版には テストって 入れて ええけど」
    //   ⇒ 本番の 戻り値は ★空★（テストの 時だけ 字を 出す）
    expect(body, '★本番の 所に 字が 残っています★').not.toContain("return '本番'");
    expect(body, '★本番の 戻り値が 空に なっていません★').toMatch(/return\s*''\s*;/);
  });

  it('★版が読めない時も 本番/テスト用 と アドレスを出す★（4通り全部）', () => {
    const i = HTML.indexOf('function _loadAppVersion()');
    // ★★決まった 字数で 切らない★★ 2026-09-10（指示役の 監査④）
    //   ★関数の 終わりまで★ 読む（次の 見出しが 無いので 閉じ括弧で 止める）
    const body = (function () {
      // ★★括弧の 数で 切り出す★★ 2026-09-10（指示役の 監査④）
      //   ★字数で 切ると 説明を 足すだけで 赤★／この 関数の 中には
      //   無名関数が 在るので「次の function」でも 切れない。
      //   ⇒ ★{ } を 数えて 関数の 終わりで 止める★（一番 確実）
      let d = 0;
      for (let k = i; k < HTML.length; k++) {
        if (HTML[k] === '{') d++;
        else if (HTML[k] === '}') {
          d--;
          if (d === 0) return HTML.slice(i, k + 1);
        }
      }
      return HTML.slice(i);
    })();
    for (const kind of ['(SW 未登録)', '(取得失敗)', '(応答なし)']) {
      expect(body, `★${kind} の時に 環境が出ていない★`).toContain(`_withEnv('${kind}')`);
    }
    expect(body, '★版が取れた時に 環境が出ていない★').toContain('_withEnv(ev.data.value)');
  });

  it('出す形は「版 / （テストなら テスト用） / アドレス」', () => {
    const i = HTML.indexOf('function _withEnv(');
    // ★★決まった 字数で 切らない★★ 2026-09-10（指示役の 監査④）
    //   ★前★ i + 200 で 切っていた
    //   ★実測★ _withEnv の 本当の 長さ 134字／最後に 探す `e ?` は 78字目
    //     ⇒ ★余りは 122字＝日本語で 約2行★
    //     ⇒ 説明を 2行 足したら ★中身は 正しいのに 赤★
    //   ★今★ ★関数の 終わりまで★ 読む
    const body = HTML.slice(i, HTML.indexOf('function _loadAppVersion()', i));
    expect(body).toContain('_envLabel()');
    expect(body).toContain('location.host');
    // ★空の 時は 区切りごと 出さない★（「版 /  / アドレス」に ならない）
    expect(body, '★空の 時に 区切りだけ 残ります★').toContain('e ?');
  });
});
