'use strict';
// ============================================================
// ★給料の js（js/kyuryo.js）と 節ごとの 写し（kyuryo-src/）を 縛る★ 2026-11-07 件2
//
//   ①kyuryo-src/*.js を 繋ぐ ＝ js/kyuryo.js（バイト 一致）
//   ②kyuryo-src ＝ 決まった 所で 割った 物（枚の 名・中身・目次）
//   ③門（.husky/pre-commit の --mae / --ato）が 7通りで 正しく 止める／作り直す（一時の git repo で 走らせる）
//   ★わざと壊して 赤を 見る★：写しの 1字／js の 1字／見出しを 文の 途中に
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
// 一時 repo の git は GIT_* を 外す（push の 門から 走っても 本物の repo を 書き換えない・kari-git-hitotsu）
const { gitKankyo } = require('../lib/kari-git');
const ENV = gitKankyo();

const ROOT = path.resolve(__dirname, '..', '..');
let T;
beforeAll(async () => {
  T = await import('../../scripts/kyuryo-tsunagu.mjs');
});

function yomuSrc(root) {
  const d = path.join(root, 'kyuryo-src');
  const names = fs
    .readdirSync(d)
    .filter((n) => n.endsWith('.js'))
    .sort();
  return {
    names,
    parts: names.map((n) => fs.readFileSync(path.join(d, n), 'utf8')),
    moku: fs.readFileSync(path.join(d, 'MOKUJI.md'), 'utf8'),
  };
}

describe('★今の repo の 写し★', () => {
  it('①② 繋ぐと js/kyuryo.js・割った 物と 同じ・目次も 同じ', () => {
    const js = fs.readFileSync(path.join(ROOT, 'js/kyuryo.js'), 'utf8');
    const s = yomuSrc(ROOT);
    expect(T.tsunagu(s.parts) === js, '★繋いだ 物が js/kyuryo.js と 違う★').toBe(true);
    expect(
      T.zure(js, s.names, s.parts, s.moku),
      '→ node scripts/kyuryo-tsunagu.mjs --modosu'
    ).toEqual([]);
  });

  it('枚の 数＝見出しの 数＋1・名は 3桁・各枚に 見出しが 1つ', () => {
    const js = fs.readFileSync(path.join(ROOT, 'js/kyuryo.js'), 'utf8');
    const heads = js.split('\n').filter((l) => /^ {2}\/\/ ★★/.test(l)).length;
    const s = yomuSrc(ROOT);
    expect(heads).toBeGreaterThan(40);
    expect(s.names.length).toBe(heads + 1);
    expect(s.names.every((n) => /^\d{3}\.js$/.test(n))).toBe(true);
    s.parts.slice(1).forEach((p, k) => {
      expect(p.split('\n').filter((l) => /^ {2}\/\/ ★★/.test(l)).length, s.names[k + 1]).toBe(1);
    });
  });
});

describe('★割る 決まり★', () => {
  const kara = (naka) => `(function () {\n  'use strict';\n${naka}})();\n`;
  it('見出しの 真上の コメントの 塊は その 節へ・前の 文は 越えない', () => {
    const js = kara(
      '  var a = 1;\n  // a の 説明では ない 塊\n  // ★★節1★★\n  function f() {\n    // ★★中は 割らない★★\n  }\n'
    );
    const p = T.wari(js);
    expect(p.length).toBe(2);
    expect(p[1].startsWith('  // a の 説明では ない 塊\n  // ★★節1★★')).toBe(true);
    expect(T.tsunagu(p)).toBe(js);
  });
  it('壊す：見出しが 根の 文の 途中（字下げ2）なら 割らずに 投げる', () => {
    const js = kara('  var o = {\n  // ★★文の 途中★★\n    a: 1,\n  };\n');
    expect(() => T.wari(js)).toThrow(/途中/);
  });
  it('壊す：写しの 1字・js の 1字で ずれを 出す', () => {
    const js = fs.readFileSync(path.join(ROOT, 'js/kyuryo.js'), 'utf8');
    const s = yomuSrc(ROOT);
    const p2 = s.parts.slice();
    p2[3] = p2[3].replace('function', 'function ');
    expect(T.zure(js, s.names, p2, s.moku).length).toBeGreaterThan(0);
    expect(T.zure(js.replace('var ', 'var  '), s.names, s.parts, s.moku).length).toBeGreaterThan(0);
  });
});

describe('★門（--mae / --ato）★ 一時の git repo', () => {
  let R;
  const git = (...a) => execFileSync('git', a, { cwd: R, encoding: 'utf8', env: ENV });
  const w = (f, s) => {
    fs.mkdirSync(path.dirname(path.join(R, f)), { recursive: true });
    fs.writeFileSync(path.join(R, f), s);
  };
  const r = (f) => fs.readFileSync(path.join(R, f), 'utf8');
  const JS0 =
    "(function () {\n  'use strict';\n  var a = 1;\n  // ★★節1★★\n  function f() {\n    return a;\n  }\n  // ★★節2★★\n  function g() {\n    return 2;\n  }\n})();\n";
  const kakunin = () => {
    const s = yomuSrc(R);
    return T.zure(r('js/kyuryo.js'), s.names, s.parts, s.moku);
  };

  beforeEach(() => {
    R = fs.mkdtempSync(path.join(os.tmpdir(), 'tsunagu-'));
    git('init', '-q');
    git('config', 'user.email', 't@example.invalid');
    git('config', 'user.name', 't');
    git('config', 'core.autocrlf', 'false');
    w('js/kyuryo.js', JS0);
    // 初めの 1回（HEAD が 無い）：js を 入れて 割る
    git('add', '-A');
    expect(T.mae(R, ENV).kekka).toBe('tooru');
    expect(T.ato(R, ENV).kekka).toBe('src-wo-kaita');
    expect(kakunin()).toEqual([]);
    git('commit', '-qm', 'hajime');
  });
  afterEach(() => fs.rmSync(R, { recursive: true, force: true }));

  it('触らない commit は 何も しない（作業木の 他の 直しも 残す）', () => {
    w('hoka.txt', 'x');
    w('kyuryo-src/010.js', r('kyuryo-src/010.js') + '  // 書きかけ\n');
    git('add', 'hoka.txt');
    expect(T.mae(R, ENV).kekka).toBe('sawaranai');
    expect(T.ato(R, ENV).kekka).toBe('sawaranai');
    expect(r('kyuryo-src/010.js')).toMatch(/書きかけ/);
  });

  it('写しだけ 直す → 繋いで js を 書く', () => {
    w('kyuryo-src/010.js', r('kyuryo-src/010.js').replace('return a;', 'return a + 1;'));
    git('add', '-A');
    expect(T.mae(R, ENV).kekka).toBe('js-wo-kaita');
    expect(T.ato(R, ENV).kekka).toBe('tooru'); // 写しは もう js と 揃っている（書き直さない）
    expect(r('js/kyuryo.js')).toMatch(/return a \+ 1;/);
    expect(git('diff', '--cached', '--name-only')).toMatch(/js\/kyuryo\.js/);
    expect(kakunin()).toEqual([]);
  });

  it('js だけ 直す → 割り直して 写しを 書く', () => {
    w('js/kyuryo.js', JS0.replace('return 2;', 'return 3;'));
    git('add', '-A');
    expect(T.mae(R, ENV).kekka).toBe('tooru');
    expect(T.ato(R, ENV).kekka).toBe('src-wo-kaita');
    expect(r('kyuryo-src/020.js')).toMatch(/return 3;/);
    expect(git('diff', '--cached', '--name-only')).toMatch(/kyuryo-src\/020\.js/);
    expect(kakunin()).toEqual([]);
  });

  it('壊す：両方 直して ずれる → 止める（どちらも 書かない）', () => {
    w('js/kyuryo.js', JS0.replace('return 2;', 'return 3;'));
    w('kyuryo-src/010.js', r('kyuryo-src/010.js').replace('return a;', 'return a + 1;'));
    git('add', '-A');
    const m = T.mae(R, ENV);
    expect(m.kekka).toBe('tomeru');
    expect(m.riyuu).toMatch(/両方/);
    expect(r('js/kyuryo.js')).toMatch(/return 3;/);
  });

  it('両方 直して 同じ 中身 → 通る', () => {
    const js2 = JS0.replace('return 2;', 'return 3;');
    w('js/kyuryo.js', js2);
    w('kyuryo-src/020.js', r('kyuryo-src/020.js').replace('return 2;', 'return 3;'));
    git('add', '-A');
    expect(T.mae(R, ENV).kekka).toBe('tooru');
    expect(T.ato(R, ENV).kekka).toBe('tooru');
  });

  it('壊す：stage していない 写しの 直し → 止める', () => {
    w('kyuryo-src/010.js', r('kyuryo-src/010.js').replace('return a;', 'return a + 1;'));
    git('add', '-A');
    w('kyuryo-src/020.js', r('kyuryo-src/020.js').replace('return 2;', 'return 9;'));
    expect(T.mae(R, ENV).kekka).toBe('tomeru');
    w('kyuryo-src/999.js', '  // 未追跡\n');
    git('checkout', '--', 'kyuryo-src/020.js');
    expect(T.mae(R, ENV).kekka).toBe('tomeru');
  });

  it('整形が js を 変えた（lint-staged の 形）→ 写しが 後を 追う', () => {
    w('kyuryo-src/020.js', r('kyuryo-src/020.js').replace('return 2;', 'return  2;'));
    git('add', '-A');
    expect(T.mae(R, ENV).kekka).toBe('js-wo-kaita');
    // lint-staged の prettier が js を 書き直して add した 形
    w('js/kyuryo.js', r('js/kyuryo.js').replace('return  2;', 'return 2; // 整形'));
    git('add', 'js/kyuryo.js');
    expect(T.ato(R, ENV).kekka).toBe('src-wo-kaita');
    expect(r('kyuryo-src/020.js')).toMatch(/return 2; \/\/ 整形/);
    // stage していない 残りが 無い（作り直した 物は 全部 commit に 入る）
    expect(git('diff', '--name-only').trim()).toBe('');
    expect(kakunin()).toEqual([]);
  });

  it('★止2★ 間に 節を 足しても 後ろの 枚の 名は そのまま（新しい 節だけ 間の 番号）', () => {
    w(
      'kyuryo-src/010.js',
      r('kyuryo-src/010.js') + '  // ★★節1半★★\n  function h() {\n    return 4;\n  }\n'
    );
    git('add', '-A');
    expect(T.mae(R, ENV).kekka).toBe('js-wo-kaita');
    expect(T.ato(R, ENV).kekka).toBe('src-wo-kaita');
    expect(yomuSrc(R).names).toEqual(['000.js', '010.js', '015.js', '020.js']);
    expect(r('kyuryo-src/015.js')).toMatch(/節1半/);
    expect(r('kyuryo-src/020.js')).toMatch(/節2/);
    expect(kakunin()).toEqual([]);
    git('commit', '-qm', 'tasu');
    // 020 の 履歴に 節1半 の 直しが 混ざらない
    expect(git('log', '--format=%s', '--', 'kyuryo-src/020.js').trim()).toBe('hajime');
    // 見出しの 字だけ 変えても 名は 引き継ぐ
    w('js/kyuryo.js', r('js/kyuryo.js').replace('★★節2★★', '★★節2 改め★★'));
    git('add', '-A');
    expect(T.mae(R, ENV).kekka).toBe('tooru');
    expect(T.ato(R, ENV).kekka).toBe('src-wo-kaita');
    expect(yomuSrc(R).names).toEqual(['000.js', '010.js', '015.js', '020.js']);
    expect(git('diff', '--cached', '--name-status').trim().split('\n')).toEqual([
      'M\tjs/kyuryo.js',
      'M\tkyuryo-src/020.js',
      'M\tkyuryo-src/MOKUJI.md',
    ]);
  });

  it('節を 消す → その 枚だけ 消える（git rm）', () => {
    w(
      'js/kyuryo.js',
      JS0.replace(/ {2}\/\/ ★★節1★★\n {2}function f\(\) \{\n {4}return a;\n {2}\}\n/, '')
    );
    git('add', '-A');
    expect(T.mae(R, ENV).kekka).toBe('tooru');
    expect(T.ato(R, ENV).kekka).toBe('src-wo-kaita');
    expect(yomuSrc(R).names).toEqual(['000.js', '020.js']);
    expect(git('diff', '--cached', '--name-status')).toMatch(/D\tkyuryo-src\/010\.js/);
  });

  it('★注7★ HEAD に 写しが 無い（入れる commit）・js と ずれた 写しを 入れる → 止める', () => {
    git('rm', '-rq', '--cached', 'kyuryo-src');
    git('commit', '-qm', 'src-nashi');
    w('kyuryo-src/010.js', r('kyuryo-src/010.js').replace('return a;', 'return a + 1;'));
    w('js/kyuryo.js', JS0.replace('return 2;', 'return 3;'));
    git('add', '-A');
    expect(T.mae(R, ENV).kekka).toBe('tomeru');
  });

  it('★注8★ js が 読めない → 写しを 書かずに 投げる', () => {
    w('js/kyuryo.js', JS0.replace('return 2;', 'return 2;;}'));
    git('add', '-A');
    expect(() => T.ato(R, ENV)).toThrow();
    expect(r('kyuryo-src/020.js')).toMatch(/return 2;\n/);
  });
});
