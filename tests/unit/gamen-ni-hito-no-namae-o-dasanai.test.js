'use strict';
// ============================================================
// ★★画面に 人の 名前を 出さない★★ 2026-09-04（司さん）
//
//   ★司さんの言葉★「★おれの名前 入れるなや★」
//     実物の 絵（給料の設定・スマホ）で 見つかった:
//       <option value="others_total">自分の車を除いた全部（★司さんのやり方★）</option>
//     ⇒ ★お客さんの 画面に うちの 人の 名前が 出ていた★
//
//   ★なぜ いけないか★
//     ・★他の 会社も 使う 画面★です。知らない 人の 名前が 出る。
//     ・★決め方の 名前★は 説明文（コメント）に 書けばよく、
//       ★画面に 出す 必要は 1つも ありません★。
//
//   ★数え方★
//     ・見る所 … ★git に 入っている *.html / *.js★（data/ と tests/ は 除く）
//     ・★注記（コメント）は 外してから★ 探す（経緯は 残してよい）
//     ・探す 字 … 下の NAMAE（うちの 人の 呼び名）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-04 実測）★★
//     ①option の 字を 元（「（司さんのやり方）」入り）に 戻す … ★赤★
//     ②見に行く ファイルを 0本に する … ★赤★（「1本も 見つけられていません」）
//     戻した後 … ★緑★
// ============================================================
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

// ★うちの 人の 呼び名★（画面に 出しては いけない）
// ★会社の 名前（ZEROact）は 出して よい★＝会社の 情報・連絡先・特商法の 表示に 要る
//   ★出しては いけないのは 人の 呼び名だけ★
const NAMAE = ['司さん', 'つかさ', 'ツカサ'];

function kesu(x) {
  return x
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(
      new RegExp('(^|[^:])//[^' + String.fromCharCode(10) + String.fromCharCode(13) + ']*', 'g'),
      '$1 '
    );
}

function gitNoFile() {
  return execFileSync(
    'git',
    [
      'ls-files',
      '-z',
      '*.html',
      '*.js',
      ':(exclude)data/**',
      ':(exclude)tests/**',
      ':(exclude)scripts/**',
    ],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
    .split('\0')
    .filter(Boolean);
}

describe('★画面に 人の 名前を 出さない★', () => {
  it('★★うちの 人の 名前が お客さんの 画面に 出ていない★★', () => {
    const files = gitNoFile();
    // ★何本 見たかも 数える★（0本を 見て 緑に しない）
    expect(files.length, '★見に行く ファイルを 1本も 見つけられていません★').toBeGreaterThan(20);
    const warui = [];
    // ★飛ばす書き方は しない★（無い物を 黙って 通すと 見張りが 嘘に なる）
    const aru = files.filter((rel) => fs.existsSync(path.join(ROOT, rel)));
    aru.forEach((rel) => {
      const p = path.join(ROOT, rel);
      const naka = kesu(fs.readFileSync(p, 'utf8'));
      NAMAE.forEach((na) => {
        if (naka.indexOf(na) >= 0) {
          const i = naka.indexOf(na);
          warui.push(rel + ' … ' + naka.slice(Math.max(0, i - 40), i + 40).replace(/\s+/g, ' '));
        }
      });
    });
    expect(warui, '★画面に 人の 名前が 出ています（説明文では ありません）★').toEqual([]);
  });
});
