'use strict';
// ============================================================
// tests/lib/kari-git.js
// ★試験・道具の 一時 repo で git（や git を 呼ぶ 子）を 動かす 時の 環境は 全部 ここを 通す★ 2026-10-16
//
//   worktree から 押すと、git は pre-push の 門に GIT_DIR・GIT_INDEX_FILE 等を 渡す。
//   それを 引き継いだ まま 一時 repo で git init・add を すると、本物の repo の config（bare=true）や
//   worktree の index を 書き換える。2026-10-11・10-16 と 3回 踏んだ（指示役：1つの 関数を 通す 形に）。
//
//   gitKankyo(extra)：process.env から GIT_ で 始まる 物を 全部 外し、extra を 足して 返す。
//     extra に GIT_DIR 等を 書くのは「一時 repo を 名指しする」時だけ（呼ぶ 側が 意図して 書く）。
// ============================================================
function gitKankyo(extra) {
  const e = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) e[k] = v;
  return Object.assign(e, extra || {});
}
module.exports = { gitKankyo };
