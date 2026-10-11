// ============================================================
// scripts/kinshi-commit-msg.mjs
// ★commit の文に 実在の字（司さん・会社・お客さん・働く人の 本物）を 書かせない★ 2026-10-10
//
//   ★なぜ★
//     公開 repo の試験から 本物の住所や名前を消した commit の文に、消した本物の値と
//     「司さんの家」という札を そのまま書いていた（10-10 だけで 本番3本・テスト線3本）。
//     ファイルを直しても commit の文は 公開の履歴に残る。
//
//   ★一覧は repo に置かない★（置くと それ自体が 実在の字の一覧になる）
//     CI   … secret KINSHI_JI（1行に 1語）
//     手元 … ~/.tsukurimono/kinshi-ji.txt
//     どちらも無ければ「未測定」で 赤（黙って 通さない）。
//   ★当たっても 字は出さない★（公開の CI の記録は 誰でも読める）。出すのは 数と commit の頭だけ。
//
//   使い方:
//     node scripts/kinshi-commit-msg.mjs --file .git/COMMIT_EDITMSG   … commit-msg の門（.husky/commit-msg）
//     node scripts/kinshi-commit-msg.mjs --range <base>..<head>      … CI（push・PR の commit 全部）
//     node scripts/kinshi-commit-msg.mjs --self-test                 … 自分の歯を確かめる
// ============================================================
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

// 札（場所を 辿る手がかりになる 書き方）。本物の値ではないので repo に置いてよい
export const FUDA = ['司さん家', '司さんの家', '司さん宅', '司さんの自宅'];

// 比べる前の ならし：全角/半角・大文字小文字・空白の揺れを ならす
//   ★NFKC で揃わない物も 寄せる★（対立役が通した形）：ダッシュの類（U+2010〜2015・U+2212）→「-」、
//   幅0の字（U+200B〜200D・U+2060・U+FEFF）は消す
export function narasu(s) {
  return String(s)
    .normalize('NFKC')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

// commit の文の本文だけを取る：切り取り線（git commit -v の「>8」）より下の差分は 見ない。
//   ★「#」で始まる行は 捨てない★（-m で書いた見出しは そのまま commit に残るため）
export function honbun(text) {
  const lines = String(text).split(/\r?\n/);
  const cut = lines.findIndex((l) => /^# -+ >8 -+$/.test(l));
  return (cut >= 0 ? lines.slice(0, cut) : lines).join('\n');
}

export function ichiran(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

// ★押す範囲は 押す先（hook の $2＝実際に押す道）に 今 在る 頭から 決める★（10-11 指示役の決め 3）
//   前の形（--not --remotes=<名>）は、遠くで消された枝の古い控え（追跡枝）も「遠くに在る」と見て、
//   その上の commit の文を 素通りした。押す門（.githooks/pre-push-kinshi.mjs・Castally c30af57）と 同じ形に そろえる。
//   手元に 取っていない 頭が 在れば「fetch してから」で 止める（全履歴を 見て 偽の赤に しない）。
//   lines は stdin の「<手元の ref> <手元の sha> <遠くの ref> <遠くの sha>」の行。返すのは 見る commit の sha
export function hanni(cwd, lines, url) {
  const git = (args, input) =>
    execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  const zero = (s) => /^0+$/.test(s);
  let known = null;
  const knownHeads = () => {
    if (known) return known;
    let out;
    try {
      out = git(['ls-remote', '--heads', '--tags', url]);
    } catch (_) {
      throw new Error('押す先の遠くの頭を 読めない（ls-remote）');
    }
    const shas = [
      ...new Set(
        out
          .split('\n')
          .map((l) => l.split('\t')[0])
          .filter((x) => /^[0-9a-f]{40,64}$/.test(x))
      ),
    ];
    if (!shas.length) return (known = []);
    const have = git(['cat-file', '--batch-check'], shas.join('\n') + '\n');
    const missing = have.split('\n').filter((l) => / missing$/.test(l)).length;
    if (missing)
      throw new Error(
        `押す先の遠くに、手元に 取っていない 頭が ${missing} 本 在る＝git fetch してから 押す（commit は 作り直さない）`
      );
    return (known = have
      .split('\n')
      .filter((l) => / (commit|tag) /.test(l))
      .map((l) => l.split(' ')[0]));
  };
  const out = [];
  for (const line of lines) {
    const [, local, , remoteSha] = String(line).trim().split(/\s+/);
    if (!local || zero(local)) continue;
    const range =
      remoteSha && !zero(remoteSha)
        ? [local, '^' + remoteSha]
        : [local, ...knownHeads().map((x) => '^' + x)];
    let list;
    try {
      list = git(['rev-list', '--stdin'], range.join('\n') + '\n').trim();
    } catch (_) {
      throw new Error('押す範囲を 数えられない（遠くの頭が 手元に無い＝git fetch してから 押す）');
    }
    for (const c of list ? list.split('\n') : []) if (!out.includes(c)) out.push(c);
  }
  return out;
}

// 当たった語の数だけを返す（字は返さない）
export function ataru(msg, words) {
  const m = narasu(msg);
  let n = 0;
  for (const w of words) {
    const k = narasu(w);
    if (k.length >= 2 && m.includes(k)) n++;
  }
  return n;
}

function yomuIchiran() {
  if (process.env.KINSHI_JI && process.env.KINSHI_JI.trim()) {
    return { words: ichiran(process.env.KINSHI_JI), from: 'secret KINSHI_JI' };
  }
  const p = join(homedir(), '.tsukurimono', 'kinshi-ji.txt');
  if (existsSync(p))
    return { words: ichiran(readFileSync(p, 'utf8')), from: '~/.tsukurimono/kinshi-ji.txt' };
  return null;
}

// 押す範囲の歯：[名前, 結果（1/0・投げたら -1）, 期待]
function hanniCases() {
  // 呼ぶ側（hook・worktree）が 渡す GIT_* を 外す＝作り物の repo の git が 親の repo を 書き換えない
  for (const k of Object.keys(process.env)) if (k.startsWith('GIT_')) delete process.env[k];
  const tmp = mkdtempSync(join(tmpdir(), 'kcm-'));
  const bare = join(tmp, 'r.git');
  const w = join(tmp, 'w');
  const g = (cwd, ...a) =>
    execFileSync('git', ['-C', cwd, ...a], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  const ci = (cwd, msg) => {
    writeFileSync(join(cwd, 'f.txt'), msg + '\n');
    g(cwd, 'add', '-A');
    g(
      cwd,
      '-c',
      'user.name=x',
      '-c',
      'user.email=1+x@users.noreply.github.com',
      'commit',
      '-q',
      '-m',
      msg
    );
    return g(cwd, 'rev-parse', 'HEAD');
  };
  const Z = '0'.repeat(40);
  const has = (list, sha) => (list.includes(sha) ? 1 : 0);
  const tryHas = (fn, sha) => {
    try {
      return has(fn(), sha);
    } catch (_) {
      return -1;
    }
  };
  const out = [];
  try {
    execFileSync('git', ['init', '-q', '--bare', bare]);
    execFileSync('git', ['init', '-q', w]);
    const c1 = ci(w, 'ふつう');
    g(w, 'remote', 'add', 'o', bare);
    g(w, 'push', '-q', 'o', 'HEAD:refs/heads/main');
    g(w, 'fetch', '-q', 'o');
    const c2 = ci(w, '見本太郎 の点');
    const nb = (sha, ref) => [`refs/heads/${ref} ${sha} refs/heads/${ref} ${Z}`];
    // ★押す前の門を 本当に 起こす★（$2 を選ぶ → 範囲 → 文と作者の欄を見る の配線＝hanni だけ試しても 守れない）
    //   作り物の一覧（見本太郎）を KINSHI_JI で渡し、子の process の 終わり値を見る（1＝止めた・0＝通した）
    const SELF = fileURLToPath(import.meta.url);
    const mon = (lines) => {
      try {
        execFileSync(process.execPath, [SELF, '--pre-push', 'o', bare], {
          cwd: w,
          input: lines.join('\n') + '\n',
          env: { ...process.env, KINSHI_JI: '見本太郎' },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return 0;
      } catch (_) {
        return 1;
      }
    };
    g(w, 'checkout', '-q', '-b', 'kirei', c1);
    const ck = ci(w, 'きれいな点');
    g(w, 'checkout', '-q', c2);
    out.push(['押す前の門：字の入った新しい枝を 止める', mon(nb(c2, 'x')), 1]);
    out.push(['押す前の門：きれいな新しい枝は 通す', mon(nb(ck, 'k')), 0]);
    out.push([
      '範囲：新しい枝は 押す先に無い commit を見る',
      tryHas(() => hanni(w, nb(c2, 'x'), bare), c2),
      1,
    ]);
    out.push([
      '範囲：押す先に在る commit は見ない',
      tryHas(() => hanni(w, nb(c2, 'x'), bare), c1),
      0,
    ]);
    // 消された枝の古い控え（追跡枝 o/old）が 手元に残っても、押す先に 今 無ければ 見る（前の --remotes=o は 素通り）
    g(w, 'push', '-q', bare, `${c2}:refs/heads/old`);
    g(w, 'fetch', '-q', 'o');
    g(w, 'push', '-q', bare, ':refs/heads/old');
    const c3 = ci(w, 'ふつう2');
    out.push([
      '範囲：消された枝の古い控えの上の commit も見る',
      tryHas(() => hanni(w, nb(c3, 'y'), bare), c2),
      1,
    ]);
    // 押す先の枝の更新は 遠くの sha からの差だけ
    out.push([
      '範囲：枝の更新は 遠くの sha からの差だけ',
      tryHas(() => hanni(w, [`refs/heads/main ${c3} refs/heads/main ${c1}`], bare), c1),
      0,
    ]);
    // 押す先に 手元に無い頭が 在れば 止める（-1＝投げた）
    const x = join(tmp, 'x');
    execFileSync('git', ['init', '-q', x]);
    ci(x, 'よそ');
    g(x, 'push', '-q', bare, 'HEAD:refs/heads/yoso');
    out.push([
      '範囲：押す先に 手元に無い頭が 在れば 止める',
      tryHas(() => hanni(w, nb(c3, 'z'), bare), c3),
      -1,
    ]);
  } catch (e) {
    out.push(['範囲：作り物の repo を 作れた', 0, 1]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return out;
}

function selfTest() {
  const words = ['見本太郎', 'SAMPLE Co', '架空区見本台1-2-3'];
  const all = [...words, ...FUDA];
  const cases = [
    ['そのまま', '試験の 見本太郎 を消した', 1],
    ['全角と空白の揺れ', 'ＳＡＭＰＬＥ　ｃｏ を外す', 1],
    ['番地', '架空区見本台１－２－３ の点', 1],
    ['札', '司さんの家から 1.3km', 1],
    ['札の別の形', '司さん宅 のそば', 1],
    ['種類と数だけ', '付近の点を 2点 移した・実機の記録7本', 0],
    ['1字だけの語は 数えない', '見', 0],
    // ↓ 作者の欄（10-11）。mailOk・nameOk が 通すか（1）止めるか（0）
    ['noreply は通す', mailOk('123+someone@users.noreply.github.com') ? 1 : 0, 1],
    ['GitHub 自身は通す', mailOk('noreply@github.com') ? 1 : 0, 1],
    ['ふつうのメールは止める', mailOk('someone@example.com') ? 1 : 0, 0],
    ['noreply に似せた偽物は止める', mailOk('x@users.noreply.github.com.example.com') ? 1 : 0, 0],
    ['名前に @ があれば止める', nameOk('someone@example.com', []) ? 1 : 0, 0],
    ['名前に一覧の字があれば止める', nameOk('見本太郎', words) ? 1 : 0, 0],
    ['ふつうの名前は通す', nameOk('exally-zeroact', words) ? 1 : 0, 1],
    // ↓ 対立役（本番前）が通した形
    ['「#」で始まる行（-m の見出し）', honbun('題\n\n# 見本太郎 の点'), 1],
    ['番地のダッシュが U+2212', '架空区見本台1\u22122\u22123', 1],
    ['名前に幅0の空白', '見本\u200b太郎', 1],
    [
      '切り取り線より下の差分は見ない',
      honbun('題\n# ------------------------ >8 ------------------------\n-見本太郎'),
      0,
    ],
  ];
  // ↓ 押す範囲（hanni）。作り物の repo と 遠く（bare）で 確かめる（10-11 指示役の決め 3）
  for (const c of hanniCases()) cases.push(c);
  let ok = 0;
  for (const [name, msg, want] of cases) {
    const got =
      typeof msg === 'number'
        ? msg
        : ataru(msg, name === '1字だけの語は 数えない' ? ['見'] : all) > 0
          ? 1
          : 0;
    const pass = got === want;
    if (pass) ok++;
    console.log(`${pass ? '✓' : '✗'} ${name}`);
  }
  console.log(`自己確認: ${ok}/${cases.length}`);
  return ok === cases.length;
}

function main() {
  const argv = process.argv.slice(2);
  const at = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : null;
  };
  if (argv.includes('--self-test')) {
    if (selfTest()) process.exitCode = 0;
    return;
  }
  const li = yomuIchiran();
  if (!li || !li.words.length) {
    console.error(
      '★未測定★ 禁止の字の一覧がありません（secret KINSHI_JI も ~/.tsukurimono/kinshi-ji.txt も無い）。'
    );
    console.error('  ★飛ばさない★＝見ていない物を 通すと 実在の字が 公開の履歴に入る。');
    return;
  }
  const words = [...li.words, ...FUDA];
  const file = at('--file');
  const range = at('--range');
  if (argv.includes('--pre-push')) {
    // ★push する前に 押す先（$2）に まだ無い commit を全部見る★（範囲は hanni・10-11 から 押す先だけと比べる）
    //   cherry-pick・rebase・--no-verify・HUSKY=0 は commit-msg の門を通らないため、公開の前の最後の関所。
    //   stdin は「<local ref> <local sha> <remote ref> <remote sha>」の行（git の決まり）
    const stdin = readFileSync(0, 'utf8');
    const shas = stdin
      .split(/\r?\n/)
      .map((l) => l.trim().split(/\s+/)[1])
      .filter((s) => s && !/^0+$/.test(s));
    if (!shas.length) {
      console.log('✓ commit の文の 実在の字 0 件（送る commit なし）');
      process.exitCode = 0;
      return;
    }
    // ★押す先の遠くに 今 在る 頭から 範囲を決める★（hanni・押す門と 同じ形）
    //   pre-push の門は "$@"（$1＝遠くの名前・$2＝押す道）を渡す。名前が無ければ 止める（どこと比べたか分からない）。
    //   読むのは $2（pushurl の remote で fetch 側の道と 取り違えない）。$2 が無い時だけ $1
    const pi = argv.indexOf('--pre-push');
    const remote = argv[pi + 1];
    if (!remote || remote.startsWith('-')) {
      console.error('★押す先の遠くの名前が 渡されていない★（.husky/pre-push で "$@" を渡す）');
      return;
    }
    const url = argv[pi + 2] && !argv[pi + 2].startsWith('-') ? argv[pi + 2] : remote;
    let list;
    try {
      list = hanni(process.cwd(), stdin.split(/\r?\n/).filter(Boolean), url);
    } catch (e) {
      console.error(`★押すのを止めた：${e.message}★`);
      return;
    }
    if (!list.length) {
      console.log('✓ commit の文の 実在の字 0 件（押す先に 無い commit なし）');
      process.exitCode = 0;
      return;
    }
    const revs = ['--no-walk', '--stdin'];
    const input = list.join('\n') + '\n';
    const okMsg = miru(revs, words, true, input);
    const okMail = mailMiru(revs, words, input);
    if (okMsg && okMail) process.exitCode = 0;
    return;
  }
  if (file) {
    const msg = honbun(readFileSync(file, 'utf8'));
    const n = ataru(msg, words);
    if (n) {
      console.error(
        `★commit の文に 実在の字か 札が ${n} 語 入っています★（字は出しません・一覧＝${li.from}）`
      );
      console.error(
        '  消した物は「付近の点を N点」「取引先 22社」のように 種類と数で書いてください。'
      );
      return;
    }
    console.log(`✓ commit の文の 実在の字 0 件（${words.length} 語で見た）`);
    process.exitCode = 0;
    return;
  }
  if (range) {
    // CI でも 作者の欄を見る（GitHub の web の merge で メールが付く形を 押した後に知らせる）
    const okMsg = miru([range], words, false);
    const okMail = mailMiru([range], words);
    if (okMsg && okMail) process.exitCode = 0;
    return;
  }
  console.error(
    '使い方: --file <COMMIT_EDITMSG> | --range <base>..<head> | --pre-push（stdin） | --self-test'
  );
}

// ★commit の作者と commit した人の欄に メールを出さない★（司さん 10-11「アドレスが分からんようにしろや」）
//   通すのは GitHub の noreply（…@users.noreply.github.com）と GitHub 自身（noreply@github.com）だけ。
//   出すのは SHA と 欄の名前だけ（メールの字は出さない）。全部 通れば true
export function mailOk(mail) {
  const m = String(mail || '')
    .trim()
    .toLowerCase();
  return m.endsWith('@users.noreply.github.com') || m === 'noreply@github.com';
}
// 名前の欄：@ を含む（メールを名前に書いた）・一覧の字に当たる 物は 止める
export function nameOk(name, words) {
  const n = String(name || '');
  return !n.includes('@') && ataru(n, words) === 0;
}
function mailMiru(revs, words, input) {
  const out = execFileSync('git', ['log', '--format=%H%x00%ae%x00%ce%x00%an%x00%cn', ...revs], {
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  let bad = 0;
  for (const line of out.split('\n').filter(Boolean)) {
    const [sha, ae, ce, an, cn] = line.split('\x00');
    const which = [
      !mailOk(ae) && '作者のメール',
      !mailOk(ce) && 'commit した人のメール',
      !nameOk(an, words) && '作者の名前',
      !nameOk(cn, words) && 'commit した人の名前',
    ].filter(Boolean);
    if (which.length) {
      bad++;
      console.error(
        `★${sha.slice(0, 9)} の ${which.join('・')} の欄★（字は出しません・noreply と ふつうの名前にしてから作り直す）`
      );
    }
  }
  if (bad) {
    console.error(
      '  git config --local user.email を GitHub の noreply に、user.name を ふつうの名前にしてください（global は触らない）。'
    );
    return false;
  }
  console.log('✓ 作者と commit した人の欄 全部 noreply・名前に字の漏れ 0');
  return true;
}

// git log の範囲の commit の文を全部見る。全部 0件なら true
function miru(revs, words, zeroOk, input) {
  // ★出しの上限を広げる★（既定 1MB では 全履歴を見ると ENOBUFS で落ちた＝赤だが 何も見ていない）
  const out = execFileSync('git', ['log', '--format=%H%x00%B%x01', ...revs], {
    encoding: 'utf8',
    input,
    maxBuffer: 512 * 1024 * 1024,
  });
  const commits = out
    .split('\x01')
    .map((c) => c.trim())
    .filter(Boolean);
  if (!commits.length && !zeroOk) {
    console.error(`★未測定★ ${revs.join(' ')} に commit が 0本（範囲の取り違え）`);
    return false;
  }
  let bad = 0;
  for (const c of commits) {
    const [sha, msg] = c.split('\x00');
    const n = ataru(honbun(msg || ''), words);
    if (n) {
      bad++;
      console.error(`★${sha.slice(0, 9)} の文に 実在の字か 札が ${n} 語★（字は出しません）`);
    }
  }
  if (bad) return false;
  console.log(`✓ commit の文の 実在の字 0 件（${commits.length} 本・${words.length} 語で見た）`);
  return true;
}

const isMain = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] || '');
  } catch (_) {
    return false;
  }
})();
if (isMain) {
  process.exitCode = 1; // ★既定は 赤★。通った1か所でだけ 0
  main();
}
