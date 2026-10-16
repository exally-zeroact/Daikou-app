'use strict';
// ============================================================
// ★見張りの 包み（scripts/kinshi-tsutsumu.sh）の 見張り★ 2026-10-16
//   公開の ログに 一覧の 番号を 出さず、判じは 全文で 行う 事を 縛る（指示役の 3つの 条件）。
//   ①わざと 当たりを 1つ 入れた repo で 走らせると 赤 ②ログ（標準出力）に「一覧の」と 番号の 組が 0回
//   ③判じは 全文で 行う（終わり値が 0 で ない 命令は「✓」の 行が 在っても 赤）
//   作り物の 語で、本体（tests/kinshi-ji.test.mjs）を 一時 repo に 写して 動かす。
//   ★わざと壊して 赤に なった 記録（2026-10-16）★（どれも 19本中 15本 赤）
//     直す 前の 台本（番号の 形を sed で 並べて 伏せる・ubuntu で 落ちた 物）／「一覧」の 行も そのまま 出す／赤の まとめを 出さない
//   ★locale★ CI（ubuntu）と 同じ C.UTF-8 と C の 両方で 走らせる（前は locale を 渡さず 別の 世界で 緑だった・対立役）
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { gitKankyo } = require('../lib/kari-git');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
// ★git を 呼ぶ 時は GIT_* を 外す★（worktree から 押すと 門に GIT_DIR が 渡り、一時 repo の git init・add が
//   本体の repo を 書き換えた＝bare=true・index が 2本に なった 2026-10-16 実測）
const ENV0 = () => gitKankyo();
const TSUTSUMI = path.join(ROOT, 'scripts', 'kinshi-tsutsumu.sh');
const GO = ['見本太郎', 'Zorgoxa'];

function tukuru(naka) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tsutsumu-'));
  fs.mkdirSync(path.join(d, 'tests'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'tests', 'kinshi-ji.test.mjs'),
    path.join(d, 'tests', 'kinshi-ji.test.mjs')
  );
  fs.writeFileSync(path.join(d, 'a.txt'), naka);
  execFileSync('git', ['init', '-q'], { cwd: d, env: ENV0() });
  execFileSync('git', ['add', '-A'], { cwd: d, env: ENV0() });
  return d;
}
function hashiru(d, cmd, loc = 'C.UTF-8') {
  return spawnSync('bash', [TSUTSUMI, ...cmd], {
    cwd: d,
    encoding: 'utf8',
    // CI の 印（GITHUB_*）は 渡さない＝本体を 手元の 形で 走らせる。
    //   locale は CI（ubuntu）と 同じ C.UTF-8 を 既定に する（渡さないと 試験の 中だけ 別の 世界で 緑に なった・対立役）
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      KINSHI_JI: GO.join('\n'),
      LANG: loc,
      LC_ALL: loc,
    },
  });
}
const BANGOU = /一覧の\s*[0-9０-９]+/;
// ログ（標準出力）の 確かめ：「一覧」を 含む 行は 指紋の 行と 包みの まとめ だけ・
//   赤の まとめ（伏せた行 N 本）と 道ごとの 件数が 在る（赤なのに ログが 空 を 捕まえる）・awk/sed の 誤り 0
function logWoMiru(r, michi) {
  const log = r.stdout + r.stderr;
  const nokori = log
    .split(/\r?\n/)
    .filter(
      (l) =>
        l.includes('一覧') &&
        !l.startsWith('node v') &&
        !l.startsWith('✗ 一覧の 指紋が 違う') &&
        !l.includes('一覧の 番号と 当たった 場所は') &&
        !l.includes('一覧を 含む 行')
    );
  expect(nokori, 'ログに 一覧の 行が 残った').toEqual([]);
  expect(BANGOU.test(log), 'ログに 番号が 出た').toBe(false);
  expect(/awk:|sed:|Invalid/.test(log), 'awk か sed が 落ちた: ' + r.stderr).toBe(false);
  const m = log.match(/✗ 実在の字の見張りが 赤・伏せた行 (\d+) 本/);
  expect(m, '赤の まとめが ログに 無い（赤なのに ログが 空）').not.toBe(null);
  expect(Number(m[1])).toBeGreaterThanOrEqual(1);
  expect(log, '道ごとの 件数が 無い').toContain('  伏せた行: ' + michi + ' ');
}

describe('★見張りの 包み★', () => {
  it('① 当たりの 在る repo は 赤 ② ログに 一覧の 番号が 0回（全文には 在る）', () => {
    const d = tukuru('ここに 見本太郎 と Zorgoxa\n');
    const r = hashiru(d, [process.execPath, 'tests/kinshi-ji.test.mjs']);
    expect(r.status, r.stdout).toBe(1);
    logWoMiru(r, 'a.txt');
    const zen = fs.readFileSync(path.join(d, 'kinshi.out'), 'utf8');
    expect(BANGOU.test(zen), '全文に 当たりが 無い＝試験が 何も 見ていない').toBe(true);
    expect(
      GO.some((w) => (r.stdout + r.stderr).includes(w)),
      '字が 出た'
    ).toBe(false);
  });

  it('当たりの 無い repo は 緑', () => {
    const d = tukuru('ふつうの 字\n');
    const r = hashiru(d, [process.execPath, 'tests/kinshi-ji.test.mjs']);
    expect(r.status, r.stdout).toBe(0);
  });

  it('③ 判じは 全文で：終わり値が 0 で ない 命令は「✓」の 行が 在っても 赤', () => {
    const d = tukuru('ふつう\n');
    const r = hashiru(d, ['bash', '-c', 'echo "✓ 実在の 字 0 件"; exit 1']);
    expect(r.status).toBe(1);
  });

  it('③ 判じは 全文で：「✓」の 行が 無ければ 終わり値 0 でも 赤', () => {
    const d = tukuru('ふつう\n');
    const r = hashiru(d, ['bash', '-c', 'echo "何か"; exit 0']);
    expect(r.status).toBe(1);
  });
});

describe('★GIT_DIR を 付けて 走らせても 親の repo を 書き換えない★', () => {
  it('門（worktree から 押す）と 同じ GIT_DIR・GIT_INDEX_FILE を 付けても 親の config・index は 1バイトも 変わらない', () => {
    const oya = fs.mkdtempSync(path.join(os.tmpdir(), 'tsutsumu-oya-'));
    execFileSync('git', ['init', '-q'], { cwd: oya, env: ENV0() });
    fs.writeFileSync(path.join(oya, 'p.txt'), 'oya');
    execFileSync('git', ['add', '-A'], { cwd: oya, env: ENV0() });
    const cfg = path.join(oya, '.git', 'config');
    const idx = path.join(oya, '.git', 'index');
    const mae = [fs.readFileSync(cfg), fs.readFileSync(idx)];
    const moto = { GIT_DIR: process.env.GIT_DIR, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE };
    process.env.GIT_DIR = path.join(oya, '.git');
    process.env.GIT_INDEX_FILE = idx;
    try {
      const d = tukuru('ふつう\n');
      hashiru(d, ['bash', '-c', 'echo "✓ 実在の 字 0 件"; exit 0']);
    } finally {
      for (const k of Object.keys(moto)) {
        if (moto[k] === undefined) delete process.env[k];
        else process.env[k] = moto[k];
      }
    }
    expect(fs.readFileSync(cfg).equals(mae[0]), '親の config が 変わった').toBe(true);
    expect(fs.readFileSync(idx).equals(mae[1]), '親の index が 変わった').toBe(true);
  });
});

// ── 本体が 番号を 出す 5つの 形（指示役：Castally が nomiya の 本体で 数えた）それぞれで 伏せる ──
const zlib = require('zlib');
function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function zipOf(name, content) {
  const raw = Buffer.from(content, 'utf8');
  const comp = zlib.deflateRawSync(raw);
  const nb = Buffer.from(name, 'utf8');
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(0x800, 6);
  lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(crc32(raw), 14);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(raw.length, 22);
  lh.writeUInt16LE(nb.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0x800, 8);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(crc32(raw), 16);
  cd.writeUInt32LE(comp.length, 20);
  cd.writeUInt32LE(raw.length, 24);
  cd.writeUInt16LE(nb.length, 28);
  const cdBuf = Buffer.concat([cd, nb]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(30 + nb.length + comp.length, 16);
  return Buffer.concat([lh, nb, comp, cdBuf, end]);
}
function pdfOf(streams) {
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  streams.forEach((s, i) => {
    const body = zlib.deflateSync(Buffer.from(s, 'latin1'));
    parts.push(
      Buffer.from(
        i + 1 + ' 0 obj\n<< /Filter /FlateDecode /Length ' + body.length + ' >>\nstream\n',
        'latin1'
      )
    );
    parts.push(body, Buffer.from('\nendstream\nendobj\n', 'latin1'));
  });
  parts.push(Buffer.from('trailer\n<< >>\n%%EOF\n', 'latin1'));
  return Buffer.concat(parts);
}
function tukuruFiles(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tsutsumu5-'));
  fs.mkdirSync(path.join(d, 'tests'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'tests', 'kinshi-ji.test.mjs'),
    path.join(d, 'tests', 'kinshi-ji.test.mjs')
  );
  for (const [rel, buf] of files) {
    fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
    fs.writeFileSync(path.join(d, rel), buf);
  }
  execFileSync('git', ['init', '-q'], { cwd: d, env: ENV0() });
  execFileSync('git', ['add', '-A'], { cwd: d, env: ENV0() });
  return d;
}

describe('★本体の 5つの 出しの 形 それぞれで ログに 一覧の 行が 0本・赤の まとめと 道ごとの 件数が 出る★', () => {
  const NANASHI = '（名前に当たる道・道は出さない）';
  for (const loc of ['C.UTF-8', 'C']) {
    for (const [na, files, katachi, michi] of [
      ['ふつうの 行', [['a.txt', 'ここに Zorgoxa\n']], /:\d+: 一覧の \d+ 番目/, 'a.txt'],
      [
        '行またぎ（つないだ 字）',
        [['a.txt', 'Zorgo\nxa\n']],
        /:\([^)]*\): 一覧の \d+ 番目/,
        'a.txt',
      ],
      [
        'zip の 部品名',
        [['a.zip', zipOf('Zorgoxa.txt', 'ふつう')]],
        /部品名: 一覧の \d+ 番目/,
        'a.zip',
      ],
      [
        'PDF の 字',
        [['a.pdf', pdfOf(['BT (Zor) Tj', '(goxa) Tj ET'])]],
        /PDF の 字を つないだ 物\): 一覧の \d+ 番目/,
        'a.pdf',
      ],
      ['追跡物の 道・名前', [['Zorgoxa/x.txt', 'ふつう\n']], /道・名前: 一覧の \d+ 番目/, NANASHI],
    ]) {
      it(
        loc +
          '・' +
          na +
          '：段は 赤・ログに 一覧の 行 0本・まとめと 道ごとの 件数・全文には その 形',
        () => {
          const d = tukuruFiles(files);
          const r = hashiru(d, [process.execPath, 'tests/kinshi-ji.test.mjs'], loc);
          expect(r.status, r.stdout).toBe(1);
          logWoMiru(r, michi);
          const zen = fs.readFileSync(path.join(d, 'kinshi.out'), 'utf8');
          expect(katachi.test(zen), '全文に この 形の 当たりが 無い＝試験が 何も 見ていない').toBe(
            true
          );
        }
      );
    }
  }
});

describe('★番号の 形が 少し 変わっても 伏せる（形を 並べない 作り）・指紋の 行は 残す★', () => {
  for (const gyou of [
    'b.js:3: 一覧 12 番',
    'b.js:3: 一覧の　12　番目',
    'b.js:3: 一覧の No.12',
    'b.js:3: 一覧の 1,234 番目',
  ]) {
    it('「' + gyou + '」', () => {
      const d = tukuru('ふつう\n');
      const r = hashiru(d, [
        'bash',
        '-c',
        'echo "node v24.0.0 ／ 一覧＝x・69語・指紋 abcd1234"; echo "  赤: ' + gyou + '"; exit 1',
      ]);
      expect(r.status).toBe(1);
      expect(r.stdout).not.toContain(gyou);
      expect(r.stdout).toContain('node v24.0.0 ／ 一覧＝x・69語・指紋 abcd1234');
      expect(r.stdout).toContain('伏せた行 1 本');
      expect(r.stdout).toContain('  伏せた行: b.js 1 本');
    });
  }
});

describe('★道の 名前に「指紋」が 在っても 当たりの 行は 伏せる★', () => {
  it('docs/指紋の手順.md の 当たり：ログに 出ない・道ごとの 件数は 出る', () => {
    const d = tukuruFiles([['docs/指紋の手順.md', 'ここに Zorgoxa\n']]);
    const r = hashiru(d, [process.execPath, 'tests/kinshi-ji.test.mjs']);
    expect(r.status).toBe(1);
    logWoMiru(r, 'docs/指紋の手順.md');
  });
});

describe('★見出しの 形を 当たりの 後ろに 紛れ込ませても 通さない（道の 名前の 改行）★', () => {
  it('当たりの 行の 後ろの「node v… 一覧の 5 番目」は 伏せる', () => {
    const d = tukuru('ふつう\n');
    const r = hashiru(d, [
      'bash',
      '-c',
      'echo "node v24.0.0 ／ 一覧＝x・69語・指紋 abcd1234"; echo "  赤: a.txt:1: 一覧の 2 番目"; echo "node v24.0.0 ／ 一覧＝x.txt:3: 一覧の 5 番目"; echo "✗ 一覧の 指紋が 違う（期待 aaaa・今 bbbb）:9: 一覧の 7 番目"; exit 1',
    ]);
    expect(r.status).toBe(1);
    expect(BANGOU.test(r.stdout), 'ログに 番号が 出た').toBe(false);
    expect(r.stdout).toContain('node v24.0.0 ／ 一覧＝x・69語・指紋 abcd1234');
    expect(r.stdout).toContain('伏せた行 3 本');
  });
});
