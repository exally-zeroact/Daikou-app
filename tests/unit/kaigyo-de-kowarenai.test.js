'use strict';
// ============================================================
// ★★改行の 形で 試験が 壊れない★★ 2026-09-10
//
//   ★Exally からの 報告 ＋ こちらで 実測★
//     Windows は `core.autocrlf=true`／このリポジトリに `.gitattributes` が 無い。
//     ⇒ ★取り出した ファイルが CRLF に なる★。
//     一方 いくつかの 試験は 本物の ソースを
//     ★'\n  }\n' の ような 字で 切り出して★ 動かしている。
//     ⇒ CRLF だと 切り出せず ★ReferenceError で 赤★。
//
//   ★★一番 分かりにくい 形★★
//     ★手元だけ 赤・CI（Linux）は 緑★
//     ＝「自分の 環境が おかしい」で 片付けられ、
//       ★誰も push できない★のに 原因が 分からない。
//
//   ★実測（2026-09-10 ダイコメ）★
//     配る js/html を 全部 CRLF に して 走らせる … ★9本 赤★
//       obd-akirameru-hayasa / obd-eigo-wo-dasanai / obd-hayaku-tsunagu
//     読んだ 直後に LF へ 揃えた 後 ………………… ★全部 緑★
//
//   ★決まり★
//     ソースを ★字で 切り出して 動かす★ 試験は
//     ★読んだ 直後に .replace(/\r\n/g, '\n') で 揃える★。
//     （配る ファイルは 1バイトも 触らない）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-10 実測）★★
//     ①揃える 1行を 消す … ★赤★
// ============================================================
const fs = require('fs');
const path = require('path');

const UNIT = path.join(__dirname);

// ★本物を 切り出して 動かす 試験＝ここを 守る★
const KIRIDASU = [
  'obd-akirameru-hayasa.test.js',
  'obd-eigo-wo-dasanai.test.js',
  'obd-hayaku-tsunagu.test.js',
];

describe('★改行の 形で 試験が 壊れない★', () => {
  it('★① 守る 相手が 本当に 居る（空回りしていない）★', () => {
    KIRIDASU.forEach((na) => {
      expect(fs.existsSync(path.join(UNIT, na)), '★' + na + ' が ありません★').toBe(true);
    });
  });

  it('★★② 切り出す 試験は 読んだ 直後に 改行を 揃えている★★', () => {
    const warui = [];
    KIRIDASU.forEach((na) => {
      const s = fs.readFileSync(path.join(UNIT, na), 'utf8');
      // ★readFileSync の すぐ 後ろで 揃えているか★
      if (!/readFileSync\([^;]*?'utf8'\)\s*\.replace\(\/\\r\\n\/g,\s*'\\n'\)/.test(s)) {
        warui.push(na);
      }
    });
    expect(
      warui,
      '★読んだ 直後に 改行を 揃えていません★' +
        '（Windows の 取り出しは CRLF ＝ 手元だけ 赤・CI は 緑 に なります）: ' +
        JSON.stringify(warui)
    ).toEqual([]);
  });

  it('★★③ 切り出しが CRLF でも 通る（本物で 確かめる）★★', () => {
    // ★写しを 作らず 本物を 読み、わざと CRLF に して 切り出せるか 見る★
    const src = fs
      .readFileSync(path.join(__dirname, '..', '..', 'js', 'obd-client.js'), 'utf8')
      .replace(/\r\n/g, '\n');
    const crlf = src.replace(/\n/g, '\r\n');
    // ★揃えれば 切り出せる★
    const naoshita = crlf.replace(/\r\n/g, '\n');
    ['_initElm', '_warmup', '_yakusu'].forEach((na) => {
      const i = naoshita.indexOf('  function ' + na + '(');
      expect(i, '★' + na + ' が 見つかりません★').toBeGreaterThan(-1);
      const j = naoshita.indexOf('\n  }\n', i);
      expect(j, '★' + na + ' の 終わりが 切り出せません★').toBeGreaterThan(i);
    });
    // ★揃えないと 切り出せない★＝この 見張りが 本当に 意味を 持つ 事の 証拠
    const i = crlf.indexOf('  function _yakusu(');
    expect(i, '★_yakusu が ありません★').toBeGreaterThan(-1);
    expect(
      crlf.indexOf('\n  }\n', i),
      '★CRLF でも 切り出せてしまいます★（この 見張りは 何も 守っていない）'
    ).toBe(-1);
  });
});
