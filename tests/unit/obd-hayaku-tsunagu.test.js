'use strict';
// ============================================================
// ★★OBD＝繋ぐ 手順を 最速に する★★ 2026-09-08
//
//   ★司さん★「OBDの構造を把握してやり方変え最速にしろや」
//
//   ★★手順を 頭から 読んで 時間の 出所を 数えた★★
//     ①gatt 接続 ………… 1〜2秒（BLE の 決まり・削れない）
//     ②話し方を 探す …… 0.5〜1秒（BLE の 決まり・削れない）
//     ③★機械を 起こす★ … ★ATZ＝チップの 丸ごと 再起動★
//          ATZ 自体 1〜2秒 ＋ ★必ず 1秒 待つ★ ＝ ★毎回 2〜3秒★
//     ④車と 話す ……… ATSP6 → 0.3秒 → 0100（車が 動いていれば 0.5〜2秒）
//     ⑤能力を 見る …… 0.5秒
//
//   ★★一番 太かったのは ③★★
//     ATZ は ★機械が おかしく なった 時の 手当て★で、毎回 要る 物では ない。
//     ⇒ まず ATE0 を 1本（50ms 程度）。返れば ★ATZ も 1秒待ちも 飛ばす★。
//     ⇒ 返らない／化けた 時だけ ★今まで通り ATZ から★（逃げ道は 残す）
//
//   ★通信の 中身・順・待ち時間は 1つも 変えていません★
//     （ATSP6→0→7 ／ 0100 は 7秒×3回 ／ 再送前 0.7秒）
//
//   ★ここでは 何を 測るか★
//     ★偽の 機械★に 何を 何本 投げたかを 数える（時間では なく 手数）
//       機械が 起きている … ATZ を ★投げない★／1秒待ちも 無い
//       機械が おかしい …… ★今まで通り ATZ から★
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-08 実測）★★
//     ①毎回 ATZ に 戻す … ★赤★（起きている 機械にも ATZ を 投げる）
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

// ★本物の _initElm を ファイルから 切り出して 動かす★（写しを 作らない）
function tsukuru(kotae) {
  const utta = [];
  const nemuri = [];
  const _send = (cmd, _to) => {
    utta.push(cmd);
    const r = kotae(cmd);
    return r === null ? Promise.reject(new Error('timeout: ' + cmd)) : Promise.resolve(r);
  };
  const _sleep = (ms) => {
    nemuri.push(ms);
    return Promise.resolve();
  };
  const _susumi = () => {};
  const INIT_CMDS = ['ATE0', 'ATL0', 'ATS0', 'ATH0'];

  const i = SRC.indexOf('  function _initElm() {');
  const j = SRC.indexOf('\n  }\n', i) + 4;
  const honmono = SRC.slice(i, j);

  // eslint-disable-next-line no-new-func
  const f = new Function('_send', '_sleep', '_susumi', 'INIT_CMDS', honmono + '; return _initElm;');
  return { init: f(_send, _sleep, _susumi, INIT_CMDS), utta, nemuri };
}

describe('★繋ぐ 手順を 最速に する★', () => {
  it('★① 機械が 起きている時は ATZ を 投げない（1秒待ちも 無い）★', async () => {
    const t = tsukuru(() => 'OK');
    await t.init();
    // eslint-disable-next-line no-console
    console.log(
      '★起きている★ 投げた=' + JSON.stringify(t.utta) + ' 待ち=' + JSON.stringify(t.nemuri)
    );
    expect(
      t.utta.indexOf('ATZ'),
      '★起きている 機械にも 丸ごと 再起動を かけています★（毎回 2〜3秒 損）'
    ).toBe(-1);
    expect(t.nemuri.filter((x) => x >= 1000).length, '★要らない 1秒待ちが 残っています★').toBe(0);
    // ★中身は 前と 同じ★（echo/lf/space/headers off は 必ず 通す）
    ['ATE0', 'ATL0', 'ATS0', 'ATH0'].forEach((c) => {
      expect(t.utta.indexOf(c), '★' + c + ' を 投げていません★').toBeGreaterThan(-1);
    });
  });

  it('★② 機械が おかしい時は 今まで通り ATZ から★（逃げ道）', async () => {
    // ★ATE0 に 返事を しない＝おかしい★
    const t = tsukuru((cmd) => (cmd === 'ATE0' && !t.__nikaime ? null : 'OK'));
    await t.init();
    // eslint-disable-next-line no-console
    console.log(
      '★おかしい★ 投げた=' + JSON.stringify(t.utta) + ' 待ち=' + JSON.stringify(t.nemuri)
    );
    expect(t.utta.indexOf('ATZ'), '★おかしい のに 起こし直していません★').toBeGreaterThan(-1);
    expect(
      t.nemuri.filter((x) => x >= 1000).length,
      '★起こし直した のに 落ち着く 時間を 取っていません★'
    ).toBeGreaterThan(0);
  });

  it('★③ 化けた 返事も「おかしい」と 見る★', async () => {
    const t = tsukuru((cmd) => (cmd === 'ATE0' ? '?\r\r' : 'OK'));
    await t.init();
    // eslint-disable-next-line no-console
    console.log('★化けた★ 投げた=' + JSON.stringify(t.utta));
    expect(t.utta.indexOf('ATZ'), '★化けた のに 起こし直していません★').toBeGreaterThan(-1);
  });
});
