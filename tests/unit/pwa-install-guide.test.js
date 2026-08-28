// ============================================================
// ★入っていない時は「押す物ひとつ」で入れる★ 2026-08-25
//
//   ★司さん★
//     「めんどくさいことやらすなや」
//     「全ユーザーがすると思うなよ」
//     「それやったら最初から誘導しろや」
//
//   ★何が起きていたか（2026-08-25 実測）★
//     ・3台のうち1台だけ、開いたら ★URL欄が出た★（＝入っていない状態）
//     ・その状態だと ★業務開始が押せない★（index.html の standalone ガード）
//       出る言葉は「ホーム画面に追加してから業務開始してください」だけ
//       ＝★何をどう押すのか 書いていない★
//     ・帯は「APKをダウンロード」と言い、配っていたのは ★2026/05/13の物（3か月半前）★
//       ＝従うと ★別の古いアプリ★が入って もっと分からなくなる
//     ・直し方は「アイコンを消して入れ直す」しか無かった＝★人にやらせていた★
//
//   ★直した形★
//     ・Chrome がくれる beforeinstallprompt を ★取っておく★
//     ・入っていない時は 帯を出し、★「入れる」を押すだけ★で入る（メニューを探させない）
//     ・押すだけで入らない端末（iPhoneなど）の時 ★だけ★ 手順を出す
//     ・入り終わったら 帯は消える
//     ・★「二度と出さない」は書かない★（入っていないのに何も出ない が 一番わかりにくい）
//     ・業務開始を止める所でも ★同じ帯を出す★
//
//   ★押して確かめた（本物のブラウザ・375px）★
//     入っていない        … 帯が出る／ボタン「入れ方」
//     Chromeが入れられると言った … ボタン「入れる」／押すと ★入れる窓が出た★
//     入り終わった        … 帯が ★消えた★
//     押すだけで入らない端末 … ★手順が出た★
//     ✕で閉じた後         … ★また出せる★（二度と出さない は書いていない）
//     帯の大きさ 375 x 80・横ずれ なし・見える字に「APK」★0件★
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');

describe('★入れる案内★', () => {
  it('Chrome の「入れられます」を 取っておく', () => {
    expect(HTML, '★取っていない＝押す物ひとつ にできない★').toContain(
      "window.addEventListener('beforeinstallprompt'"
    );
    expect(HTML, '★Chrome任せの出し方を止めていない★').toContain('e.preventDefault();');
    expect(HTML, '★取っておいていない★').toContain('_dkInstallPrompt = e;');
  });

  it('★押すだけで入る★（メニューを探させない）', () => {
    const i = HTML.indexOf('function dkInstallApp(');
    expect(i, '★入れる所が無い★').toBeGreaterThan(-1);
    const block = HTML.slice(i, i + 700);
    expect(block, '★入れる窓を出していない★').toContain('_dkInstallPrompt.prompt()');
    expect(block, '★入らない端末の逃げ道が無い★').toContain('showApkInstall()');
    expect(HTML, '★ボタンが繋がっていない★').toContain('onclick="dkInstallApp()"');
  });

  it('入り終わったら 帯を消す', () => {
    expect(HTML, '★入った後も 帯が出たまま★').toContain("window.addEventListener('appinstalled'");
  });

  it('★「二度と出さない」を書かない★（入っていないのに 何も出ないを防ぐ）', () => {
    expect(HTML, '★もう出さない印を書いている★').not.toContain('apk_banner_dismissed');
  });

  it('★業務開始を止める所でも 同じ案内を出す★', () => {
    const i = HTML.indexOf('_bsIsStandalone');
    const block = HTML.slice(i, i + 900);
    expect(block, '★止めるだけで 直し方を出していない★').toContain('dkShowInstallBanner()');
  });

  it('★古いAPKへ誘導しない★（配っていたのは 2026/05/13 の物）', () => {
    // 客に見える字（class名やファイル名ではない）にAPKが出ないこと
    const 見える = HTML.replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ');
    expect(見える, '★まだ APK と書いてある★').not.toMatch(/APK/);
    expect(見える, '★まだ 提供元不明 の話が出る★').not.toMatch(/提供元不明|プロテクト/);
    expect(HTML, '★古いAPKへのリンクが残っている★').not.toContain('download/daikome.apk');
  });

  it('★はじめの設定の字が 1文字ずつ縦に割れない★（実測 375px で 37px→19px）', () => {
    const i = HTML.indexOf('function row(done, label, hint)');
    expect(i, '★はじめの設定の行を作る所が無い★').toBeGreaterThan(-1);
    const block = HTML.slice(i, i + 900);
    expect(block, '★見出しが折り返る（1文字ずつ縦に割れる）★').toContain('white-space:nowrap');
    expect(block, '★見出しが縮められる★').toContain('flex:0 0 auto');
    expect(block, '★説明を次の行へ落としていない★').toContain('flex:1 1 100%');
  });
});
