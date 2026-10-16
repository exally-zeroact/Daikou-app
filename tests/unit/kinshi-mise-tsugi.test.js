'use strict';
// ============================================================
// ★店データの 白名簿を 店ごとの 印で 書き継ぐ 道具（scripts/kinshi-mise-tsugi.mjs）の 見張り★ 2026-10-16
//   道具は「白名簿を 書き換えて 見張りを 緑に する」形＝★自分で 緑に する 道を ここで 縛る★（指示役）。
//   作り物の 語と 作り物の 店データで、本体（tests/kinshi-ji.test.mjs）と 道具を 一時 repo に 写して 動かす。
//   ★見る 事★
//     1. 当たった 店が 同じで 関係ない 店だけ 変わった → 書き換えて 緑
//     2. 当たった 店の 欄が 1つ 変わった → 書き換えず
//     3. 新しい 当たりが 出た → 書き換えず
//     4. 印の 紙が 無い・読めない・鍵が 無い → 書き換えず 止める
//     5. 定時の 外（push の CI・手元）では 書き換えない
//     6. 店データ 以外の 白名簿の 行は 1字も 変えない
//     7. 施設の 外（cats）に 同じ 語が 増えた・同じ 施設が 2つに 増えた → 書き換えず
//     8. 出しに 字・語の 番号・施設の 名を 出さない
//     9. 本体の 版（blob）を 名指しで 照らす（本体が 変わったら ここが 赤＝道具の 見直しを 強制）
//   ★わざと壊して 赤に なった 記録（2026-10-16）★：道具を 4通り 壊して それぞれ 赤
//     定時の 確かめを 外す→5 が 1本 赤／施設の 外の 確かめを 外す→7a・7c の 2本 赤／
//     当たった 施設を 重ねず 数える（Set）→7b が 1本 赤／白名簿の 書き換えを 全部の 行に 広げる→1 が 1本 赤
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
const HONTAI_BLOB = 'f4aa3cebe77f8783d9cc991f905f02409310d65e';
const GO = ['見本太郎', 'Zorgoxa'];
const MISE = 'data/poi-zz.js';

function mise(o, atama = '// 作った 店データ\n') {
  return atama + 'window.POI_ZZ = ' + JSON.stringify(o) + ';\n';
}
const MOTO = {
  v: 2,
  cats: { 0: 'shop', 1: 'station' },
  pois: [
    { n: '見本太郎 商店', c: 0, la: 1, lo: 2 },
    { n: 'ふつうの 店', c: 0, la: 3, lo: 4 },
    { n: 'Zorgoxa Cafe', c: 1, la: 5, lo: 6 },
  ],
};

function tukuru() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-tsugi-'));
  fs.mkdirSync(path.join(d, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(d, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(d, 'data'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'tests', 'kinshi-ji.test.mjs'),
    path.join(d, 'tests', 'kinshi-ji.test.mjs')
  );
  fs.copyFileSync(
    path.join(ROOT, 'scripts', 'kinshi-mise-tsugi.mjs'),
    path.join(d, 'scripts', 'kinshi-mise-tsugi.mjs')
  );
  execFileSync('git', ['init', '-q'], { cwd: d, env: ENV0() });
  return d;
}
function hashiru(d, args, env) {
  const e = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    KINSHI_JI: GO.join('\n'),
    ...env,
  };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return spawnSync(process.execPath, [path.join(d, 'scripts', 'kinshi-mise-tsugi.mjs'), ...args], {
    cwd: d,
    encoding: 'utf8',
    env: e,
  });
}
const TEIJI = {
  GITHUB_ACTIONS: 'true',
  GITHUB_WORKFLOW: 'OSM POI Auto Update',
  GITHUB_EVENT_NAME: 'schedule',
};
const kaku = (d, rel, s) => fs.writeFileSync(path.join(d, rel), s);
const yomu = (d, rel) => fs.readFileSync(path.join(d, rel), 'utf8');
const blob = (d, rel) =>
  execFileSync('git', ['-C', d, 'hash-object', '--path', rel, '--', path.join(d, rel)], {
    encoding: 'utf8',
    env: ENV0(),
  })
    .trim()
    .slice(0, 16);
const moreta = (txt) =>
  GO.some((w) => txt.includes(w)) ||
  /番目/.test(txt) ||
  txt.includes('商店') ||
  txt.includes('Cafe');

// 準備：前の 版の 店データで 印を 作り、白名簿は 前の blob（＝作り直しで ずれた 形）
function junbi(d, imaO) {
  kaku(d, MISE, mise(MOTO));
  const s = hashiru(d, ['--shirushi', MISE]);
  expect(s.status, s.stdout + s.stderr).toBe(0);
  const gyou = s.stdout.trim();
  expect(gyou.split('\t')[0]).toBe(MISE);
  kaku(d, 'tests/kinshi-mise-shiro.txt', gyou + '\n');
  const maeBlob = blob(d, MISE);
  kaku(
    d,
    'tests/kinshi-ji-shiro.txt',
    '# 白名簿\ncommerce.html\t当たり1\t1dca0241d6dcd785\t決め6\n' +
      MISE +
      '\t当たり2\t' +
      maeBlob +
      '\t公の地図データ\n'
  );
  kaku(d, MISE, mise(imaO));
  return maeBlob;
}

describe('★店ごとの 印で 白名簿の blob を 書き継ぐ 道具★', () => {
  it('9. 本体の 版を 名指しで 照らす（変わったら 道具を 見直す）', () => {
    const b = execFileSync('git', ['-C', ROOT, 'hash-object', 'tests/kinshi-ji.test.mjs'], {
      encoding: 'utf8',
      env: ENV0(),
    }).trim();
    expect(b).toBe(HONTAI_BLOB);
  });

  it('1. 当たった 店が 同じで 関係ない 店だけ 変わった → blob の 頭だけ 書き換える', () => {
    const d = tukuru();
    const ima = {
      ...MOTO,
      pois: [...MOTO.pois.slice(0, 1), { n: 'ふつうの 店 二号', c: 0, la: 9, lo: 9 }, MOTO.pois[2]],
    };
    const mae = junbi(d, ima);
    const r = hashiru(d, ['--tsugi'], TEIJI);
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toContain('店の印が同じなので blob の頭を書き換えた: ' + MISE);
    const shiro = yomu(d, 'tests/kinshi-ji-shiro.txt');
    expect(shiro).toContain(MISE + '\t当たり2\t' + blob(d, MISE) + '\t公の地図データ');
    expect(shiro).not.toContain(mae);
    expect(shiro).toContain('commerce.html\t当たり1\t1dca0241d6dcd785\t決め6'); // 6. 他の 行は そのまま
    expect(moreta(r.stdout + r.stderr), '出しに 字・番号が 出た').toBe(false);
  });

  for (const [na, ima] of [
    [
      '2. 当たった 店の 欄が 1つ 変わった',
      { ...MOTO, pois: [{ ...MOTO.pois[0], la: 7 }, MOTO.pois[1], MOTO.pois[2]] },
    ],
    [
      '3. 新しい 当たりが 出た',
      { ...MOTO, pois: [...MOTO.pois, { n: '見本太郎 二号店', c: 0, la: 8, lo: 8 }] },
    ],
    [
      '7a. 施設の 外（cats）に 同じ 語が 増えた',
      { ...MOTO, cats: { 0: 'shop', 1: 'station', 2: '見本太郎' } },
    ],
    ['7b. 同じ 施設が 2つに 増えた', { ...MOTO, pois: [...MOTO.pois, MOTO.pois[0]] }],
  ]) {
    it(na + ' → 書き換えない', () => {
      const d = tukuru();
      const mae = junbi(d, ima);
      const r = hashiru(d, ['--tsugi'], TEIJI);
      expect(r.stdout).toContain('書き継がない: ' + MISE);
      expect(yomu(d, 'tests/kinshi-ji-shiro.txt')).toContain(MISE + '\t当たり2\t' + mae);
      expect(moreta(r.stdout + r.stderr), '出しに 字・番号が 出た').toBe(false);
    });
  }

  it('7c. 頭の 注釈に 語が 入った → 書き換えない', () => {
    const d = tukuru();
    const mae = junbi(d, MOTO);
    kaku(d, MISE, mise(MOTO, '// Zorgoxa の 店\n'));
    const r = hashiru(d, ['--tsugi'], TEIJI);
    expect(r.stdout).toContain('施設の 外に 当たりが 在る');
    expect(yomu(d, 'tests/kinshi-ji-shiro.txt')).toContain(mae);
  });

  it('4. 印の 紙が 無い・読めない・鍵が 無い → 止めて 書き換えない', () => {
    for (const [na, prep, env] of [
      ['紙が 無い', (d) => fs.rmSync(path.join(d, 'tests/kinshi-mise-shiro.txt')), {}],
      ['紙が 読めない', (d) => kaku(d, 'tests/kinshi-mise-shiro.txt', 'こわれた 行\n'), {}],
      [
        '鍵が 無い',
        () => {},
        { KINSHI_JI: undefined, KINSHI_JI_FILE: path.join(os.tmpdir(), 'nai-ichiran.txt') },
      ],
    ]) {
      const d = tukuru();
      const ima = { ...MOTO, pois: [...MOTO.pois, { n: '別の ふつう', c: 0, la: 0, lo: 0 }] };
      const mae = junbi(d, ima);
      prep(d);
      const r = hashiru(d, ['--tsugi'], { ...TEIJI, ...env });
      expect(r.status, na).toBe(1);
      expect(r.stdout, na).toContain('★止めた★');
      expect(yomu(d, 'tests/kinshi-ji-shiro.txt'), na).toContain(mae);
    }
  });

  it('5. 定時の 外（push の CI・手元・別の workflow）では 書き換えない', () => {
    for (const env of [
      {},
      { GITHUB_ACTIONS: 'true', GITHUB_WORKFLOW: 'test', GITHUB_EVENT_NAME: 'push' },
      { GITHUB_ACTIONS: 'true', GITHUB_WORKFLOW: 'OSM POI Auto Update', GITHUB_EVENT_NAME: 'push' },
    ]) {
      const d = tukuru();
      const ima = { ...MOTO, pois: [...MOTO.pois, { n: '別の ふつう', c: 0, la: 0, lo: 0 }] };
      const mae = junbi(d, ima);
      const r = hashiru(d, ['--tsugi'], env);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('定時の 中だけ');
      expect(yomu(d, 'tests/kinshi-ji-shiro.txt')).toContain(mae);
    }
  });

  it('6b. 印の 紙に 店データ 以外の 道 → 止める（他の 名指しを 書き換えない）', () => {
    const d = tukuru();
    junbi(d, MOTO);
    kaku(d, 'tests/kinshi-mise-shiro.txt', 'commerce.html\t0123456789abcdef\t訳\n');
    const r = hashiru(d, ['--tsugi'], TEIJI);
    expect(r.status).toBe(1);
    expect(yomu(d, 'tests/kinshi-ji-shiro.txt')).toContain(
      'commerce.html\t当たり1\t1dca0241d6dcd785\t決め6'
    );
  });

  // 10. commit の 前の 門（--mon）：書き継ぎが 白名簿の 店データの 行の blob 以外を 変えたら・data/ の 外を 足したら 止める
  describe('10. commit の 前の 門', () => {
    const SH =
      '# 白名簿\ncommerce.html\t当たり1\t1dca0241d6dcd785\t決め6\n' +
      MISE +
      '\t当たり2\t0123456789abcdef\t公の地図データ\n';
    function monRepo(imaShiro, soto) {
      const d = tukuru();
      kaku(d, 'tests/kinshi-ji-shiro.txt', SH);
      kaku(d, MISE, mise(MOTO));
      const g = (a) => execFileSync('git', a, { cwd: d, env: ENV0(), encoding: 'utf8' });
      g(['add', '-A']);
      g(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'mae']);
      kaku(d, 'tests/kinshi-ji-shiro.txt', imaShiro);
      kaku(d, MISE, mise({ ...MOTO, v: 3 }));
      if (soto) kaku(d, soto, 'x');
      g(['add', '-A']);
      return d;
    }
    it('a. 店データの 行の blob だけ 変えた → 通す', () => {
      const d = monRepo(SH.replace('0123456789abcdef', 'fedcba9876543210'));
      const r = hashiru(d, ['--mon'], { KINSHI_JI: undefined });
      expect(r.status, r.stdout).toBe(0);
      expect(r.stdout).toContain('blob だけを 変えた');
    });
    it('b. 件数（当たりN）を 変えた → 止める', () => {
      const d = monRepo(SH.replace('当たり2\t0123456789abcdef', '当たり3\tfedcba9876543210'));
      const r = hashiru(d, ['--mon'], { KINSHI_JI: undefined });
      expect(r.status).toBe(1);
    });
    it('c. 店データで ない 行の blob を 変えた → 止める', () => {
      const d = monRepo(SH.replace('1dca0241d6dcd785', '1dca0241d6dcd786'));
      const r = hashiru(d, ['--mon'], { KINSHI_JI: undefined });
      expect(r.status).toBe(1);
    });
    it('d. 行を 足した → 止める', () => {
      const d = monRepo(SH + 'commerce2.html\t当たり1\t0000000000000000\t足した\n');
      const r = hashiru(d, ['--mon'], { KINSHI_JI: undefined });
      expect(r.status).toBe(1);
    });
    it('e. data/ と 白名簿 の 外を 足した → 止める', () => {
      const d = monRepo(SH, 'commerce.html');
      const r = hashiru(d, ['--mon'], { KINSHI_JI: undefined });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('外を 足している');
    });
    it('f. 訳の 列を 変えた → 止める', () => {
      const d = monRepo(
        SH.replace('0123456789abcdef\t公の地図データ', 'fedcba9876543210\t見なくて よい')
      );
      const r = hashiru(d, ['--mon'], { KINSHI_JI: undefined });
      expect(r.status).toBe(1);
    });
    it('g. blob の 列が 16字の hex で ない → 止める', () => {
      const d = monRepo(SH.replace('0123456789abcdef', 'ZZZZ'));
      const r = hashiru(d, ['--mon'], { KINSHI_JI: undefined });
      expect(r.status).toBe(1);
    });
    it('h. 印の 紙を data/ へ 改名した → 止める（改名を 消した 道と 足した 道で 見る）', () => {
      const d = tukuru();
      kaku(d, 'tests/kinshi-ji-shiro.txt', SH);
      kaku(d, 'tests/kinshi-mise-shiro.txt', MISE + '\t0123456789abcdef\t訳\n');
      const g = (a) => execFileSync('git', a, { cwd: d, env: ENV0(), encoding: 'utf8' });
      g(['add', '-A']);
      g(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'mae']);
      g(['mv', 'tests/kinshi-mise-shiro.txt', 'data/zz-moved.txt']);
      const r = hashiru(d, ['--mon'], { KINSHI_JI: undefined });
      expect(r.status, r.stdout).toBe(1);
    });
  });

  // 11. 印は 鍵付き（一覧が 違えば 印も 違う・鍵の 無い sha256 とは 一致しない）
  //   鍵の 無い 印は 公の 地図から 一覧の 語が 割れた（11語中 7語・対立役）＝「簡単に」すると 黙って 戻る ので 縛る
  it('11. 印は 一覧を 鍵に した HMAC（鍵の 無い sha256 と 違う・一覧が 違えば 違う）', () => {
    const d = tukuru();
    kaku(d, MISE, mise(MOTO));
    const a = hashiru(d, ['--shirushi', MISE]);
    const b = hashiru(d, ['--shirushi', MISE], { KINSHI_JI: GO.join('\n') + '\n関係ない語' });
    expect(a.status, a.stdout).toBe(0);
    expect(b.status, b.stdout).toBe(0);
    const ia = a.stdout.trim().split('\t')[1];
    const ib = b.stdout.trim().split('\t')[1];
    expect(ia).toMatch(/^[0-9a-f]{16}$/);
    expect(ia, '一覧が 違っても 印が 同じ＝鍵が 効いていない').not.toBe(ib);
    const crypto = require('crypto');
    const atatta = [JSON.stringify(MOTO.pois[0]), JSON.stringify(MOTO.pois[2])].sort().join('\n');
    const kagiNashi = crypto.createHash('sha256').update(atatta).digest('hex').slice(0, 16);
    expect(ia, '鍵の 無い sha256 と 同じ').not.toBe(kagiNashi);
  });
});
