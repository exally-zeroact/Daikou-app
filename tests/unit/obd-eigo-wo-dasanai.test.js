'use strict';
// ============================================================
// ★★ブラウザの 英語を そのまま 運転手に 見せない★★ 2026-09-09
//
//   ★司さん（実物の 写真）★「なんで 英語に かわったんど ぼけ」
//     赤帯に "User cancelled the requestDevice() chooser." が 出ていた。
//
//   ★★2段で 守る★★
//     ①出所（obd-client.js）で ★日本語に 訳す★
//        ・機械を 選ぶ 窓を ★やめた★ … ★何も 言わない★（間違いでは ない）
//        ・Bluetooth が 切れている … ★言わないと 直せない★ので 言う
//        ・許可が 無い ………………… 出し方を 言う
//        ・それ以外 …………………… 「つなげませんでした」＋ 生の 字は console
//     ②画面（index.html）で ★日本語でなければ 帯に 出さない★（二重の 網）
//
//   ★★握りつぶして いない★★
//     ★生の 字は console.warn に 残す★（調べる 時に 要る）
//
//   ★ここでは 本物の _yakusu を ファイルから 切り出して 動かす★（写しを 作らない）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-09 実測 ＝ 下に 書く）★★
// ============================================================
const fs = require('fs');
const path = require('path');

// ★★読んだ 直後に LF へ 揃える★★ 2026-09-10（実測）
//   Windows は core.autocrlf=true なので ★取り出した ファイルが CRLF★ に なる。
//   ここは 本物を '\n  }\n' で 切り出して 動かす ので
//   CRLF だと 切り出せず ★ReferenceError で 赤★に なる。
//   ★手元だけ 赤・CI（Linux）は 緑★ という 一番 分かりにくい 形。
//   ★配る ファイルは 1バイトも 触っていません★（読んだ 後の 写しを 揃える だけ）
const SRC = fs
  .readFileSync(path.join(__dirname, '..', '..', 'js', 'obd-client.js'), 'utf8')
  .replace(/\r\n/g, '\n');

function honmono() {
  const i = SRC.indexOf('  function _yakusu(na, nama) {');
  if (i < 0) return null;
  const j = SRC.indexOf('\n  }\n', i) + 4;
  // eslint-disable-next-line no-new-func
  return new Function(SRC.slice(i, j) + '; return _yakusu;')();
}

describe('★英語を そのまま 見せない★', () => {
  it('★① 訳す 所が 本当に 在る★', () => {
    const f = honmono();
    expect(f, '★訳す 所が ありません★').toBeTruthy();
  });

  it('★★② 実物で 出た 英語＝何も 言わない★★', () => {
    const f = honmono();
    // ★司さんの 写真に 写っていた 字 そのもの★
    expect(
      f('NotFoundError', 'User cancelled the requestDevice() chooser.'),
      '★やめた だけなのに 何か 言っています★'
    ).toBe('');
  });

  // ★★2026-09-10 指示役の 監査②で 足した★★
  //   ★字（message）は 版で 変わる／★名前（name）は 規格★★
  //   ⇒ 名前で 拾えば 版差に 強い
  it('★★②-2 AbortError も 何も 言わない（窓を 閉じただけ）★★', () => {
    const f = honmono();
    // ★Chrome が 機械選びの 窓を 閉じた 時に 出す 事が 在る★
    expect(
      f('AbortError', 'The user aborted a request.'),
      '★窓を 閉じた だけなのに「挿し直して」と 言っています★'
    ).toBe('');
    // ★字が 空でも 名前で 拾える★（版差に 強い形）
    expect(f('AbortError', ''), '★名前で 拾えていません★').toBe('');
    expect(f('NotFoundError', ''), '★名前で 拾えていません★').toBe('');
  });

  it('★★②-3 使えない スマホには「使えません」と 言う★★', () => {
    const f = honmono();
    const r = f('NotSupportedError', 'Bluetooth is not supported');
    // eslint-disable-next-line no-console
    console.log('★使えない スマホ★ ' + JSON.stringify(r));
    expect(r, '★何も 言っていません★').toBeTruthy();
    expect(
      r.indexOf('挿し直して'),
      '★挿し直しても 直らないのに「挿し直して」と 言っています★'
    ).toBe(-1);
    expect(r.indexOf('使えません'), '★使えない事を 言っていません★').toBeGreaterThan(-1);
  });

  it('★★③ 言わないと 直せない 物は 日本語で 言う★★', () => {
    const f = honmono();
    const ja = /[぀-ヿ一-龯]/;
    const mono = [
      ['NotSupportedError', 'Bluetooth adapter not available.'],
      ['NetworkError', 'Bluetooth is turned off'],
      ['SecurityError', 'User denied the browser permission to scan'],
      ['NetworkError', 'GATT operation failed for unknown reason'],
    ];
    mono.forEach(function (x) {
      const r = f(x[0], x[1]);
      // eslint-disable-next-line no-console
      console.log('★' + x[1] + '★ → ' + JSON.stringify(r));
      expect(r, '★' + x[1] + ' に 何も 言っていません★').toBeTruthy();
      expect(ja.test(r), '★' + x[1] + ' が 英語の まま です★').toBe(true);
      expect(/[A-Za-z]{6,}\.\)?$/.test(r), '★生の 英語が 混ざっています★').toBe(false);
    });
  });

  it('★★④ 生の 字は console に 残している（握りつぶさない）★★', () => {
    const i = SRC.indexOf('.catch(function (e) {');
    expect(i, '★受け口が ありません★').toBeGreaterThan(0);
    const naka = SRC.slice(i, i + 1800);
    expect(naka.indexOf('console.warn'), '★生の 字を どこにも 残していません★').toBeGreaterThan(0);
    expect(naka.indexOf('_yakusu('), '★訳さずに 出しています★').toBeGreaterThan(0);
    expect(
      naka.indexOf("_emit('error', (e && e.message)"),
      '★生の 字を そのまま 流す 行が 残っています★'
    ).toBe(-1);
  });

  it('★⑤ もともと 日本語だった 訳は 消していない★', () => {
    expect(SRC.indexOf('抜いて 挿し直して'), '★機械を 挿し直す 案内が 消えました★').toBeGreaterThan(
      0
    );
    expect(
      SRC.indexOf('Android Chrome で開いてください'),
      '★非対応の 案内が 消えました★'
    ).toBeGreaterThan(0);
  });
});
