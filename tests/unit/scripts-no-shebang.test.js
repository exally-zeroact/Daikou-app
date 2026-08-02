'use strict';
// ============================================================
// ★テストが読む道具に シェバン(#!) を書かせない 2026-08-02★
//
//   ★踏んだ間違い★
//     scripts/check-hosts.mjs の先頭に #!/usr/bin/env node を書いていた。
//     Node は受け付ける（node --check も通る）が、
//     ★vitest が取り込むと「SyntaxError: Invalid or unexpected token」で
//       その道具を import しているテストファイルが丸ごと落ちる★。
//     しかも落ちたと表示されるのは★テストファイルの方★なので、
//     原因が別のファイルの1行目にあることが分かりにくい。
//     （コミット済みの実バイトでA/Bして確定させた。node --check は両方通るので当てにならない）
//
//   呼び出しは必ず `node scripts/xxx.mjs` なのでシェバンは要らない。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'scripts');

function mjsFiles() {
  if (!fs.existsSync(SCRIPTS)) return [];
  return fs.readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs'));
}

describe('★scripts/*.mjs の先頭にシェバンを書かない★', () => {
  it('見張る対象が実在する（空振りしていない）', () => {
    expect(mjsFiles().length).toBeGreaterThan(0);
  });

  it('★どのファイルも #! で始まっていない★', () => {
    const bad = mjsFiles().filter((f) => {
      const src = fs.readFileSync(path.join(SCRIPTS, f), 'utf8');
      return src.startsWith('#!');
    });
    expect(
      bad,
      'シェバンがあると、この道具をimportしているテストが丸ごとSyntaxErrorで落ちる'
    ).toEqual([]);
  });

  it('テストから読まれている道具は、実際にimportできる', async () => {
    // 「落ちるのはテストの方」なので、ここで先に読んで原因を切り分けられるようにしておく
    for (const f of ['dk-hosts.mjs', 'check-hosts.mjs']) {
      if (!fs.existsSync(path.join(SCRIPTS, f))) continue;
      const m = await import('../../scripts/' + f);
      expect(m, f + ' が読めない').toBeTruthy();
    }
  });
});
