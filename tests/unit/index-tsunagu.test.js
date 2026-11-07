'use strict';
// ============================================================
// ★運転手の 画面（index.html）と 塊・節ごとの 写し（index-src/）を 縛る★ 2026-11-08 件3
//
//   ①index-src/ を 繋ぐ ＝ index.html（バイト 一致）・②index-src ＝ 決まった 所で 割った 物（名・拡張子・目次）
//   ③割る 決まり（塊の 境目・複数行の 開きタグ・src= は html 側・ld+json は .json・読めない 塊は 止める）
//   ④名の 引き継ぎ（手前に 塊を 足しても 後ろの 枚の 名は 変わらない・設計前 taiketsu 注1）
//   ⑤門（--mae / --ato）を 一時の git repo で 走らせる（改行の 無い 枚・BOM の 枚は 止める＝止2・注3）
//   ★わざと壊して 赤を 見る★
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { gitKankyo } = require('../lib/kari-git');
const ENV = gitKankyo();

const ROOT = path.resolve(__dirname, '..', '..');
let T;
beforeAll(async () => {
  T = await import('../../scripts/index-tsunagu.mjs');
});

function yomuSrc(root) {
  const d = path.join(root, 'index-src');
  const names = fs
    .readdirSync(d)
    .filter((n) => /\.(html|css|js|json)$/.test(n))
    .sort();
  return {
    names,
    parts: names.map((n) => fs.readFileSync(path.join(d, n), 'utf8')),
    moku: fs.readFileSync(path.join(d, 'MOKUJI.md'), 'utf8'),
  };
}
const HTML = () => fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

describe('★今の repo の 写し★', () => {
  it('①② 繋ぐと index.html・割った 物と 同じ・目次も 同じ', () => {
    const html = HTML();
    const s = yomuSrc(ROOT);
    expect(T.tsunagu(s.parts) === html, '★繋いだ 物が index.html と 違う★').toBe(true);
    expect(
      T.zure(html, s.names, s.parts, s.moku),
      '→ node scripts/index-tsunagu.mjs --modosu'
    ).toEqual([]);
  });

  it('名は 4桁＋中身の 拡張子・番号は 重ならない・塊の 種類が 全部 在る', () => {
    const s = yomuSrc(ROOT);
    expect(s.names.length).toBeGreaterThan(100);
    expect(s.names.every((n) => /^\d{4}\.(html|css|js|json)$/.test(n))).toBe(true);
    expect(new Set(s.names.map((n) => n.slice(0, 4))).size).toBe(s.names.length);
    for (const x of ['html', 'css', 'js', 'json'])
      expect(
        s.names.some((n) => n.endsWith('.' + x)),
        x
      ).toBe(true);
  });

  it('.js の 枚は 塊ごとに 繋ぐと acorn で 読める・.json は JSON・.css に タグが 無い', async () => {
    const acorn = await import('acorn');
    const s = yomuSrc(ROOT);
    let buf = '';
    let n = 0;
    const dasu = () => {
      if (buf) {
        acorn.parse(buf, { ecmaVersion: 'latest' });
        n++;
      }
      buf = '';
    };
    s.names.forEach((nm, k) => {
      if (nm.endsWith('.js')) buf += s.parts[k];
      else dasu();
      if (nm.endsWith('.json')) JSON.parse(s.parts[k]);
      if (nm.endsWith('.css')) expect(s.parts[k], nm).not.toMatch(/<\/?style/i);
    });
    dasu();
    expect(n).toBeGreaterThan(5);
  });

  it('配る 物は 変えない：index-src は 配らない・lint/整形/stylelint しない・門で 揃える', () => {
    for (const f of ['.vercelignore', '.eslintignore', '.prettierignore', '.stylelintignore'])
      expect(fs.readFileSync(path.join(ROOT, f), 'utf8'), f).toMatch(/^index-src\/$/m);
    const h = fs.readFileSync(path.join(ROOT, '.husky/pre-commit'), 'utf8');
    const i = (s) => h.indexOf(s);
    expect(i('node scripts/index-tsunagu.mjs --mae')).toBeGreaterThan(-1);
    expect(i('node scripts/index-tsunagu.mjs --mae')).toBeLessThan(i('npx lint-staged'));
    expect(i('node scripts/index-tsunagu.mjs --ato')).toBeGreaterThan(i('npx lint-staged'));
  });
});

describe('★割る 決まり★', () => {
  const doc = (body) => `<!doctype html>\n<html>\n  <head>\n${body}  </head>\n</html>\n`;
  it('塊の 境目：開きと 閉じの 行は .html・中身は .css/.js/.json・src= は html 側', () => {
    const html = doc(
      '    <style>\n      a { color: red; }\n    </style>\n' +
        '    <script type="application/ld+json">\n      { "a": 1 }\n    </script>\n' +
        '    <script\n      src="x.js"\n      defer\n    ></script>\n' +
        '    <script src="y.js"></script>\n' +
        '    <script>\n      var a = 1;\n    </script>\n'
    );
    const { parts, exts } = T.wariX(html);
    expect(T.tsunagu(parts)).toBe(html);
    expect(exts).toEqual(['html', 'css', 'html', 'json', 'html', 'js', 'html']);
    expect(parts[1]).toBe('      a { color: red; }\n');
    expect(parts[4]).toMatch(/src="x\.js"[\s\S]*src="y\.js"[\s\S]*<script>\n$/);
  });
  it('節：<!-- ★・/* ★・// ★★ の 前で 切る（js は 根の 文の 途中では 切らない）', () => {
    const html = doc(
      '    <!-- ★頭 -->\n    <meta a>\n    <!-- ★二 -->\n    <style>\n      /* ★一 */\n      a {}\n      /* ★二 */\n      b {}\n    </style>\n' +
        '    <script>\n      var a = 1;\n      // ★★節★★\n      function f() {\n        // ★★中★★\n      }\n    </script>\n'
    );
    const { parts, exts } = T.wariX(html);
    expect(T.tsunagu(parts)).toBe(html);
    expect(exts).toEqual(['html', 'html', 'html', 'css', 'css', 'html', 'js', 'js', 'html']);
    expect(parts[7].startsWith('      // ★★節★★\n      function f()')).toBe(true);
  });
  it('長い 塊は 根の 文の 頭で 切る（NAGAI 行 超え）', () => {
    const fn = (k) => `      function f${k}() {\n${'        x();\n'.repeat(98)}      }\n`;
    const naka = Array.from({ length: 8 }, (_, k) => fn(k)).join('');
    const html = doc(`    <script>\n${naka}    </script>\n`);
    const { parts, exts } = T.wariX(html);
    expect(T.tsunagu(parts)).toBe(html);
    const js = parts.filter((_, k) => exts[k] === 'js');
    expect(js.length).toBeGreaterThan(1);
    js.forEach((p) => {
      expect(p.split('\n').length - 1).toBeLessThanOrEqual(T.NAGAI);
      expect(p).toMatch(/^ {6}function f\d\(\)/);
    });
  });
  it('壊す：読めない script・ld+json・行の 途中の 塊・閉じない 塊・知らない type・CR・BOM・尻の 改行', () => {
    expect(() => T.wari(doc('    <script>\n      var = ;\n    </script>\n'))).toThrow(/読めない/);
    expect(() =>
      T.wari(doc('    <script type="application/ld+json">\n      {a:1}\n    </script>\n'))
    ).toThrow(/ld\+json/);
    expect(() => T.wari(doc('    <div><script>\n      var a;\n    </script></div>\n'))).toThrow(
      /途中/
    );
    expect(() => T.wari(doc('    <style>\n      a {}\n'))).toThrow(/閉じ/);
    expect(() =>
      T.wari(doc('    <script type="text/x-tmpl">\n      <b>\n    </script>\n'))
    ).toThrow(/知らない/);
    expect(() =>
      T.wari(doc('    <style>\n      a {}\n    </style>\n').replace(/\n/g, '\r\n'))
    ).toThrow(/CR/);
    expect(() => T.wari('﻿' + doc(''))).toThrow(/BOM/);
    expect(() => T.wari(doc('').slice(0, -1))).toThrow(/改行/);
    // 注釈の 中の <script> は よい
    expect(() => T.wari(doc('    <!-- 古い <script> は 消した -->\n'))).not.toThrow();
  });
  it('壊す：写しの 1字・html の 1字で ずれを 出す', () => {
    const html = HTML();
    const s = yomuSrc(ROOT);
    const p2 = s.parts.slice();
    p2[5] = p2[5] + ' ';
    expect(T.zure(html, s.names, p2, s.moku).length).toBeGreaterThan(0);
    expect(
      T.zure(html.replace('<head>', '<head >'), s.names, s.parts, s.moku).length
    ).toBeGreaterThan(0);
    // 拡張子が 中身と 違う
    const n2 = s.names.slice();
    const k = n2.findIndex((n) => n.endsWith('.css'));
    n2[k] = n2[k].replace('.css', '.html');
    expect(T.zure(html, n2, s.parts, s.moku).join()).toMatch(/拡張子/);
  });
});

describe('★名の 引き継ぎ★（本物の index.html で）', () => {
  // 同じ 中身の 枚が 同じ 名の まま か（同じ 中身が 2枚 以上 在る 物＝「</script>」と 空行 だけ 等は どれが 元か 決まらないので 数えない）
  const nokotta = (oldN, oldP, newN, newP) => {
    const m = new Map();
    const kazu = new Map();
    oldP.forEach((p, k) => {
      m.set(p, oldN[k]);
      kazu.set(p, (kazu.get(p) || 0) + 1);
    });
    for (const [p, c] of kazu) if (c > 1) m.delete(p);
    let onaji = 0;
    const chigau = [];
    newP.forEach((p, k) => {
      if (!m.has(p)) return;
      if (m.get(p) === newN[k]) onaji++;
      else chigau.push(`${m.get(p)}→${newN[k]}`);
    });
    return { onaji, chigau };
  };
  it('手前に 塊（script）を 足しても 後ろの 枚の 名は 変わらない', () => {
    const html = HTML();
    const s = yomuSrc(ROOT);
    const L = html.split('\n');
    const at = L.findIndex((l) => /^\s*<\/script>/.test(l)) + 1;
    L.splice(at, 0, '    <script>', '      window.ATARASHII = 1;', '    </script>');
    const h2 = L.join('\n');
    const { parts, exts } = T.wariX(h2);
    const names = T.namae(parts, s.names, s.parts, exts);
    expect(names.furinaoshi).toBeFalsy();
    expect(T.tsunagu(parts)).toBe(h2);
    const r = nokotta(s.names, s.parts, names, parts);
    expect(r.chigau).toEqual([]);
    expect(r.onaji).toBeGreaterThan(s.names.length - 5);
    expect(new Set(names).size).toBe(names.length);
  });
  it('css に 節を 足す・見出しの 無い 枚を 直しても 他の 名は 変わらない', () => {
    const html = HTML();
    const s = yomuSrc(ROOT);
    const L = html.split('\n');
    const st = L.findIndex((l) => /^\s*<style>/.test(l)) + 1;
    L.splice(st, 0, '      /* ★新しい 節 */', '      .atarashii { color: inherit; }');
    const h2 = L.join('\n').replace(
      "window.DAIKOME_APP_VERSION = '1.0.0';",
      "window.DAIKOME_APP_VERSION = '1.0.1';"
    );
    const { parts, exts } = T.wariX(h2);
    const names = T.namae(parts, s.names, s.parts, exts);
    expect(names.furinaoshi).toBeFalsy();
    const r = nokotta(s.names, s.parts, names, parts);
    expect(r.chigau).toEqual([]);
    // 直した 見出し無しの 1行の js 枚（1行が 全部 変わった）は 前後の 枚の 間の 番号の .js
    const k = parts.findIndex((p) => p.includes("'1.0.1'"));
    expect(names[k]).toMatch(/\.js$/);
    expect(names[k] > names[k - 1] && names[k] < names[k + 1]).toBe(true);
    expect(new Set(names).size).toBe(names.length);
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
  const H0 =
    '<!doctype html>\n<html>\n  <head>\n    <style>\n      a { color: red; }\n    </style>\n  </head>\n  <body>\n    <script>\n      var a = 1;\n      // ★★節★★\n      function f() {\n        return a;\n      }\n    </script>\n  </body>\n</html>\n';
  const kakunin = () => {
    const s = yomuSrc(R);
    return T.zure(r('index.html'), s.names, s.parts, s.moku);
  };
  const edaNo = (re) => yomuSrc(R).names.find((n, k) => re.test(yomuSrc(R).parts[k]));

  beforeEach(() => {
    R = fs.mkdtempSync(path.join(os.tmpdir(), 'itsunagu-'));
    git('init', '-q');
    git('config', 'user.email', 't@example.invalid');
    git('config', 'user.name', 't');
    git('config', 'core.autocrlf', 'false');
    w('index.html', H0);
    git('add', '-A');
    expect(T.mae(R, ENV).kekka).toBe('tooru');
    expect(T.ato(R, ENV).kekka).toBe('src-wo-kaita');
    expect(kakunin()).toEqual([]);
    git('commit', '-qm', 'hajime');
  });
  afterEach(() => fs.rmSync(R, { recursive: true, force: true }));

  it('写しの .js だけ 直す → 繋いで index.html を 書く', () => {
    const n = edaNo(/return a;/);
    w(`index-src/${n}`, r(`index-src/${n}`).replace('return a;', 'return a + 1;'));
    git('add', '-A');
    expect(T.mae(R, ENV).kekka).toBe('js-wo-kaita');
    expect(T.ato(R, ENV).kekka).toBe('tooru');
    expect(r('index.html')).toMatch(/return a \+ 1;/);
    expect(git('diff', '--cached', '--name-only')).toMatch(/index\.html/);
    expect(kakunin()).toEqual([]);
  });

  it('index.html だけ 直す → 割り直して 写しを 書く', () => {
    w('index.html', H0.replace('color: red', 'color: blue'));
    git('add', '-A');
    expect(T.mae(R, ENV).kekka).toBe('tooru');
    expect(T.ato(R, ENV).kekka).toBe('src-wo-kaita');
    expect(git('diff', '--cached', '--name-only')).toMatch(/index-src\/\d{4}\.css/);
    expect(kakunin()).toEqual([]);
  });

  it('両方 直して ずれる → 止める（どちらも 消さない）', () => {
    const n = edaNo(/return a;/);
    w(`index-src/${n}`, r(`index-src/${n}`).replace('return a;', 'return 9;'));
    w('index.html', H0.replace('color: red', 'color: blue'));
    git('add', '-A');
    const m = T.mae(R, ENV);
    expect(m.kekka).toBe('tomeru');
    expect(m.riyuu).toMatch(/両方/);
    expect(r('index.html')).toMatch(/blue/);
  });

  it('stage していない 直し → 止める', () => {
    const n = edaNo(/return a;/);
    w(`index-src/${n}`, r(`index-src/${n}`).replace('return a;', 'return 2;'));
    git('add', '-A');
    w(`index-src/${n}`, r(`index-src/${n}`).replace('return 2;', 'return 3;'));
    expect(T.mae(R, ENV).kekka).toBe('tomeru');
  });

  it('壊す：尻に 改行の 無い 枚・BOM の 枚・CR の 枚 → 止める（index.html は 書かない）', () => {
    const n = edaNo(/return a;/);
    const moto = r(`index-src/${n}`);
    for (const [bad, re] of [
      [moto.slice(0, -1), /改行/],
      ['﻿' + moto, /BOM/],
      [moto.replace(/\n/g, '\r\n'), /CR/],
    ]) {
      w(`index-src/${n}`, bad);
      git('add', '-A');
      const m = T.mae(R, ENV);
      expect(m.kekka).toBe('tomeru');
      expect(m.riyuu).toMatch(re);
      expect(r('index.html')).toBe(H0);
    }
  });

  it('壊す：読めない script を index.html に 書く → --ato が 投げる（門は 止める）', () => {
    w('index.html', H0.replace('return a;', 'return a +;'));
    git('add', '-A');
    expect(T.mae(R, ENV).kekka).toBe('tooru');
    expect(() => T.ato(R, ENV)).toThrow(/読めない/);
  });
});
