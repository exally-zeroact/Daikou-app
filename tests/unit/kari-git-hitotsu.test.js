'use strict';
// ============================================================
// ★git を 呼ぶ 試験は 全部 tests/lib/kari-git.js（gitKankyo）を 通す★ 2026-10-16（指示役：3回目の 事故の 後）
//   worktree から 押すと 門に GIT_DIR・GIT_INDEX_FILE が 渡る。process.env を そのまま 広げて 一時 repo で git を
//   動かすと 本物の repo を 書き換える（10-11・10-16 実測）。ここで 機械が 数える。
//   ★決まり★ tests/ の 下で git を 子として 呼び、一時 repo を 作る（init する）ファイルは
//     ① kari-git を require する ② process.env を そのまま 広げない（...process.env・Object.assign({}, process.env）
//   ★外す 物★ 他の 席の 写し tests/kinshi-ji.test.mjs（自分で GIT_* を 外している・書き換えない 決まり）と kari-git 自身。
//   ★わざと壊して 赤に なった 記録（2026-10-16）★：poi-kinshi-atari.test.js の 道具の env を
//     { ...process.env, … } に 戻すと 1本 赤。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SOTO = new Set(['tests/kinshi-ji.test.mjs', 'tests/lib/kari-git.js']);
const GIT_YOBU = /(execFileSync|spawnSync|execSync|spawn|exec)\(\s*['"`]git['"`\s]/;
const HIROGE = /\.\.\.process\.env\b|Object\.assign\(\s*\{\s*\}\s*,\s*process\.env\b/;

function zenbu(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== 'fixtures') zenbu(p, out);
    } else if (/\.(js|mjs)$/.test(e.name))
      out.push(path.relative(ROOT, p).split(path.sep).join('/'));
  }
  return out;
}

describe('★git を 呼ぶ 試験は kari-git を 通す★', () => {
  const files = zenbu(path.join(ROOT, 'tests'), []).filter((f) => !SOTO.has(f));
  // 一時 repo を 作る（git を 呼び、かつ init する）ファイルが 的。本物の repo を 読むだけ（ls-files 等）の 物は 外す
  const yobu = files.filter((f) => {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    return GIT_YOBU.test(s) && /['"`]init['"`]/.test(s);
  });

  it('見た ファイルの 数（0本を 見て 緑に しない）', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(yobu.length, 'git を 呼ぶ 試験が 見つからない＝探し方が 壊れた').toBeGreaterThanOrEqual(
      3
    ); // この 木で 数えて 3本（包みの 試験 kinshi-tsutsumu が 入った）
  });

  it('git を 呼ぶ ファイルは kari-git を require し、process.env を そのまま 広げない', () => {
    const warui = [];
    for (const f of yobu) {
      const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
      if (!/require\(['"][./]*lib\/kari-git['"]\)|from ['"][./]*lib\/kari-git/.test(s))
        warui.push(f + '（kari-git を 通っていない）');
      if (HIROGE.test(s)) warui.push(f + '（process.env を そのまま 広げている）');
    }
    expect(warui, '★GIT_* が 子の git に 渡る 恐れ★').toEqual([]);
  });
});
