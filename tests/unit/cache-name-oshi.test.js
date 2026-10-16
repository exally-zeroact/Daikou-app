'use strict';
// ============================================================
// ★版名を 付けて 押す 道具（scripts/cache-name-oshi.sh）の 見張り★ 2026-10-17
//   10-16 に 2本 続けて 押すと、後の bot が 押し返され、git pull --rebase で sw.js が ぶつかって failure に なった
//   （run 38881711241）。今の 形は 押し返されたら 枝の 頭を 取り直して 付け直す。
//   一時の bare repo と 2つの 複製（bot・人）で、押し返される 場面を 作って 確かめる。
//   ①ぶつからない 時＝自分の 頭の 印で 1本 積む
//   ②後から 中身の commit が 来ていた＝取り直して その 頭の 印で 積む（ぶつからない・exit 0）
//   ③後から 別の bot が もう 版名を 積んでいた＝何も 積まない（exit 0）
//   ④後から 人が sw.js だけを 直した（版名 そのまま）＝bot と 取り違えず 付け直す（対立役 10-17 S-1）
//   ⑤版名の 行の 形が 変わって 書けない＝赤（「もう 付いている」と 緑で 終わらない・N-2）
//   ⑥押すのが 毎回 断られる＝赤 ⑦取り直し（fetch）が 落ちる＝赤（失敗を 飲む 壊し方を 縛る・N-1）
//   ⑧2回 断られても 3回目で 積む ⑨人が sw.js と 他を 一緒に 変えて 版名が 親の 印でも 付け直す ⑩commit が 落ちる＝赤
//   ★わざと壊して 赤に なった 記録（2026-10-17・8本中）★
//     前の rebase の 形に 戻す＝②③ 赤 ／ 頭の 判じを「sw.js だけ」に 緩める＝1本 赤 ／ 3回 後を exit 0＝1本 赤
//     fetch の 失敗を 飲む＝1本 赤 ／ 回数を 2回に＝1本 赤 ／ sed の 確かめを 外す＝1本 赤 ／ reset を 外す＝4本 赤
//   （10本に して）判じの「sw.js だけ」の 半分を 外す＝⑨ 赤 ／ commit の || exit 1 を 外す＝⑩ 赤
//   ★一時 repo の git が 全部の 試験と 並ぶと 5秒を 越えた＝1本 60秒まで 待つ★
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { gitKankyo } = require('../lib/kari-git');

const ROOT = path.resolve(__dirname, '..', '..');
const DOUGU = path.join(ROOT, 'scripts', 'cache-name-oshi.sh');
const ENV = () =>
  gitKankyo({
    GIT_AUTHOR_NAME: 'mihon',
    GIT_AUTHOR_EMAIL: 'mihon@example.invalid',
    GIT_COMMITTER_NAME: 'mihon',
    GIT_COMMITTER_EMAIL: 'mihon@example.invalid',
  });
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env: ENV(), encoding: 'utf8' }).trim();
const SW = "// 見本\nconst CACHE_NAME = 'daikome-0000000';\n";
const NOKOSU = [];
afterAll(() => NOKOSU.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function basho() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-oshi-'));
  NOKOSU.push(d);
  const bare = path.join(d, 'r.git');
  git(d, 'init', '-q', '--bare', '-b', 'main', bare);
  const hito = path.join(d, 'hito');
  git(d, 'clone', '-q', bare, hito);
  git(hito, 'checkout', '-q', '-b', 'main');
  fs.writeFileSync(path.join(hito, 'sw.js'), SW);
  fs.writeFileSync(path.join(hito, 'a.txt'), '1\n');
  git(hito, 'add', '-A');
  git(hito, 'commit', '-q', '-m', 'c1');
  git(hito, 'push', '-q', 'origin', 'main');
  const bot = path.join(d, 'bot');
  git(d, 'clone', '-q', bare, bot);
  return { d, bare, hito, bot };
}
function nakami(hito, n) {
  git(hito, 'pull', '-q', 'origin', 'main');
  fs.writeFileSync(path.join(hito, 'a.txt'), n + '\n');
  git(hito, 'commit', '-q', '-am', 'c' + n);
  git(hito, 'push', '-q', 'origin', 'main');
  return git(hito, 'rev-parse', '--short=7', 'HEAD');
}
function hashiru(cwd) {
  return spawnSync('bash', [DOUGU, 'main'], { cwd, env: ENV(), encoding: 'utf8' });
}
function atama(bare) {
  return {
    msg: git(bare, 'log', '-1', '--format=%s', 'main'),
    sw: git(bare, 'show', 'main:sw.js'),
    n: Number(git(bare, 'rev-list', '--count', 'main')),
  };
}

describe(
  '★版名を 付けて 押す 道具（押し返されても sw.js が ぶつからない）★',
  { timeout: 60000 },
  () => {
    it('① ぶつからない 時＝自分の 頭の 印で 1本 積む', () => {
      const b = basho();
      const c1 = git(b.bot, 'rev-parse', '--short=7', 'HEAD');
      const r = hashiru(b.bot);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      const a = atama(b.bare);
      expect(a.msg).toBe('chore: auto-update CACHE_NAME to daikome-' + c1);
      expect(a.sw).toContain("const CACHE_NAME = 'daikome-" + c1 + "';");
      expect(a.n).toBe(2);
    });

    it('② 後から 中身の commit が 来ていた＝取り直して その 頭の 印で 積む', () => {
      const b = basho();
      const c2 = nakami(b.hito, 2); // bot が 見ていない 間に 人が 押した
      const r = hashiru(b.bot);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      const a = atama(b.bare);
      expect(a.msg).toBe('chore: auto-update CACHE_NAME to daikome-' + c2);
      expect(a.sw).toContain("'daikome-" + c2 + "'");
      expect(a.n).toBe(3); // c1・c2・版名 1本（二重に 積まない）
      expect(git(b.bare, 'show', 'main:a.txt')).toBe('2'); // 人の 中身を 消していない
    });

    it('③ 後から 別の bot が もう 版名を 積んでいた＝何も 積まない（10-16 の ぶつかり）', () => {
      const b = basho();
      const c2 = nakami(b.hito, 2);
      const bot2 = path.join(b.d, 'bot2');
      git(b.d, 'clone', '-q', b.bare, bot2);
      expect(hashiru(bot2).status).toBe(0); // 先の bot が c2 に 版名を 積む
      const mae = atama(b.bare);
      const r = hashiru(b.bot); // 後の bot（c1 を 見ている）
      expect(r.status, r.stdout + r.stderr).toBe(0);
      const a = atama(b.bare);
      expect(a.n).toBe(mae.n);
      expect(a.sw).toContain("'daikome-" + c2 + "'");
    });

    it('④ 後から 人が sw.js だけを 直した（版名 そのまま）＝取り違えず 付け直す', () => {
      const b = basho();
      nakami(b.hito, 2);
      fs.writeFileSync(path.join(b.hito, 'sw.js'), SW + '// 注の 直し\n');
      git(b.hito, 'commit', '-q', '-am', 'docs(sw)');
      git(b.hito, 'push', '-q', 'origin', 'main');
      const c3 = git(b.hito, 'rev-parse', '--short=7', 'HEAD');
      const r = hashiru(b.bot);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      const a = atama(b.bare);
      expect(a.sw).toContain("'daikome-" + c3 + "'");
      expect(a.sw).toContain('// 注の 直し'); // 人の 直しを 消していない
      expect(a.n).toBe(4);
    });

    it('⑤ 版名の 行の 形が 変わって 書けない＝赤・何も 積まない', () => {
      const b = basho();
      fs.writeFileSync(path.join(b.bot, 'sw.js'), "let CACHE_NAME = 'daikome-0000000';\n");
      git(b.bot, 'commit', '-q', '-am', 'kata');
      git(b.bot, 'push', '-q', 'origin', 'main');
      const mae = atama(b.bare);
      const r = hashiru(b.bot);
      expect(r.status, r.stdout).not.toBe(0);
      expect(atama(b.bare).n).toBe(mae.n);
    });

    it('⑥ 押すのが 毎回 断られる＝赤', () => {
      const b = basho();
      const hook = path.join(b.bare, 'hooks', 'pre-receive');
      fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n');
      fs.chmodSync(hook, 0o755);
      const r = hashiru(b.bot);
      expect(r.status, r.stdout).not.toBe(0);
      expect(atama(b.bare).n).toBe(1);
    });

    it('⑦ 取り直し（fetch）が 落ちる＝赤', () => {
      const b = basho();
      nakami(b.hito, 2); // bot の 最初の 押しは 押し返される
      git(b.bot, 'remote', 'set-url', 'origin', path.join(b.d, 'nai.git'));
      git(b.bot, 'remote', 'set-url', '--push', 'origin', b.bare);
      const r = hashiru(b.bot);
      expect(r.status, r.stdout).not.toBe(0);
      expect(r.stdout).not.toContain('3 回'); // 取り直しで 止まる（失敗を 飲んで 押し続けない）
      expect(atama(b.bare).n).toBe(2);
    });

    it('⑧ 2回 断られても 3回目で 積む（回数を 減らさない）', () => {
      const b = basho();
      const hook = path.join(b.bare, 'hooks', 'pre-receive');
      fs.writeFileSync(
        hook,
        '#!/bin/sh\nf="$(dirname "$0")/kazu"; n=$(cat "$f" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$f"; [ $n -ge 3 ]\n'
      );
      fs.chmodSync(hook, 0o755);
      const r = hashiru(b.bot);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(atama(b.bare).n).toBe(2);
    });

    it('⑨ 人が sw.js と 他を 一緒に 変え、版名が 親の 印でも bot と 取り違えない（対立役 小-1）', () => {
      const b = basho();
      git(b.hito, 'pull', '-q', 'origin', 'main');
      const c1 = git(b.hito, 'rev-parse', '--short=7', 'HEAD');
      fs.writeFileSync(
        path.join(b.hito, 'sw.js'),
        "// 見本\nconst CACHE_NAME = 'daikome-" + c1 + "';\n"
      );
      fs.writeFileSync(path.join(b.hito, 'a.txt'), '2\n');
      git(b.hito, 'commit', '-q', '-am', 'c2 sw と 中身');
      git(b.hito, 'push', '-q', 'origin', 'main');
      const c2 = git(b.hito, 'rev-parse', '--short=7', 'HEAD');
      const r = hashiru(b.bot);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      const a = atama(b.bare);
      expect(a.sw).toContain("'daikome-" + c2 + "'");
      expect(a.n).toBe(3);
    });

    it('⑩ commit が 落ちる＝赤（何も 変わらない 押しで「押した」と 言わない・対立役 小-3）', () => {
      const b = basho();
      const hook = path.join(b.bot, '.git', 'hooks', 'pre-commit');
      fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n');
      fs.chmodSync(hook, 0o755);
      const r = hashiru(b.bot);
      expect(r.status, r.stdout).not.toBe(0);
      expect(r.stdout).not.toContain('押した');
      expect(atama(b.bare).n).toBe(1);
    });
  }
);
