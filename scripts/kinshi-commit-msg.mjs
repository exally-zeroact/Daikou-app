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
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
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
    // ★push する前に まだどの遠くにも無い commit を全部見る★
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
    // ★押す先の遠く（名前）とだけ比べる★（--remotes 全部だと、手元の別の遠くに在る commit を素通りした）
    //   pre-push の門は "$@"（遠くの名前・URL）を渡す。名前が無ければ 止める（どこと比べたか分からない）
    const remote = argv[argv.indexOf('--pre-push') + 1];
    if (!remote || remote.startsWith('-')) {
      console.error('★押す先の遠くの名前が 渡されていない★（.husky/pre-push で "$@" を渡す）');
      return;
    }
    const revs = [...shas, '--not', `--remotes=${remote}`];
    const okMsg = miru(revs, words, true);
    const okMail = mailMiru(revs, words);
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
function mailMiru(revs, words) {
  const out = execFileSync('git', ['log', '--format=%H%x00%ae%x00%ce%x00%an%x00%cn', ...revs], {
    encoding: 'utf8',
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
function miru(revs, words, zeroOk) {
  // ★出しの上限を広げる★（既定 1MB では 全履歴を見ると ENOBUFS で落ちた＝赤だが 何も見ていない）
  const out = execFileSync('git', ['log', '--format=%H%x00%B%x01', ...revs], {
    encoding: 'utf8',
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
