// ============================================================
// scripts/poi-kinshi-atari.mjs
// ★店データ（data/poi-*.js）の 実在の字の 当たりを ★施設ごと★ に 出す★ 2026-10-11
//
//   ★なぜ★
//     見張り（tests/kinshi-ji.test.mjs）は「行と語」の 組で 1件と 数える。店データは 1本が 実質 1行なので、
//     白名簿の「当たりN」は ★当たった 語の 種類の 数★で、施設の 数ではない（1本で 76か所が「当たり2」に入る県がある）。
//     月次で 新しい 施設が 同じ 語で 増えても 件数は 変わらず、席が blob を 書き直すだけで 中身を 見ずに 通っていた。
//     ⇒ 席は この道具で ★どの 施設の どの 欄に 一覧の 何番目が 当たったか★を 数えてから 白名簿を 直す。
//
//   ★字は 出さない★（語・施設の 名前・読めない時の 中身を 出さない）。出すのは ファイル・施設の 番号・欄・種類・
//     一覧の 何番目・字の 長さ だけ。当て方は 見張りの 本体と 同じ（loadWords の 語の 形・normJa・normAscii）。
//   ★分からない時は 止める（終わり値 2）★：一覧が 無い・読めない・前と 今が 同じ物・
//     ファイル全体で 当たった 語が 施設に 結べない（頭の 注釈・上の 欄・タグ外しで つながる 字 等）。
//
//   使い方（repo の 根で）:
//     node scripts/poi-kinshi-atari.mjs [data/poi-*.js …] [--mae-git <版>] [--mae <dir>]
//       引数が 無ければ data/poi-*.js 全部。一覧は KINSHI_JI（secret と 同じ）か ~/.tsukurimono/kinshi-ji.txt
//       --mae-git <版>  … 前の 版を git の 版から 読む（月次の 成果物を data/ に 置いた 後に HEAD と 比べる）
//       --mae <dir>     … 前の 版を dir から 読む
//       前の 版を 渡すと、前の 版に 無い 当たり（欄・種類・欄の 字の 指紋・語の 番号の 数で 比べる）だけ「★新しい★」と 出す
//   終わり値: 当たり 0 なら 0・当たりが 在れば 1・分からない時は 2
// ============================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const K = await import(pathToFileURL(path.join(ROOT, 'tests', 'kinshi-ji.test.mjs')).href);

class Wakaranai extends Error {}

export function yomuMise(text) {
  const m = String(text).match(/window\.[A-Z_]+ = (\{[\s\S]*\});/);
  if (!m) throw new Wakaranai('店データの 形が 読めない');
  let o;
  try {
    o = JSON.parse(m[1]);
  } catch (_) {
    // ★e.message を 出さない★（JSON.parse の 文に 中身の 字の 断片が 入る）
    throw new Wakaranai('店データの JSON が 読めない');
  }
  if (!o || !Array.isArray(o.pois)) throw new Wakaranai('pois が 無い');
  return o;
}

// ★見張りの 本体の matchIdx と 同じ 形★（本体は export していないので 写す・字を 整えるのは 1回）
function matchIdx(text, words) {
  const ja = K.normJa(text);
  const as = K.normAscii(text);
  const out = [];
  if (!ja && !as) return out;
  words.forEach((w, i) => {
    if (w.ascii ? w.re.test(as) : ja.includes(w.key)) out.push(i);
  });
  return out;
}

// 施設の 字の 欄を 入れ子まで 全部 降りて 返す：[[欄の 道, 字]]
function jiNoRan(v, michi, out) {
  if (typeof v === 'string') out.push([michi, v]);
  else if (Array.isArray(v)) v.forEach((x, j) => jiNoRan(x, michi + '[' + j + ']', out));
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) jiNoRan(x, michi ? michi + '.' + k : k, out);
  return out;
}

const shimon = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

// 1本の 店データの 当たりを 施設ごとに 返す：[{ i, ran, c, cat, go, nagasa, kagi }]
//   kagi は 前後の 版を 突き合わせる 鍵＝欄・種類・欄の 字の 指紋・語の 番号（字は 持たない）
export function atari(o, words) {
  const out = [];
  o.pois.forEach((p, i) => {
    for (const [ran, v] of jiNoRan(p, '', [])) {
      matchIdx(v, words).forEach((wi) => {
        out.push({
          i,
          ran,
          c: p.c,
          cat: o.cats && o.cats[p.c] != null ? o.cats[p.c] : '?',
          go: wi + 1,
          nagasa: [...v].length,
          kagi: [ran, p.c, shimon(v), wi + 1].join('|'),
        });
      });
    }
  });
  return out;
}

// ファイル全体で 当たる 語の 番号＝★見張りの 本体の scanText と 同じ 形★
//   行ごと・行を "" と " " で つないだ 字・タグが 在る 時（/<[A-Za-z/!?]/）だけ タグを "" と " " で 外した 字
export function zentaiNoGo(text, words) {
  const t = String(text);
  const s = new Set();
  const ateru = (x) => matchIdx(x, words).forEach((wi) => s.add(wi + 1));
  t.split(/\r?\n/).forEach(ateru);
  ateru(t.replace(/\r?\n/g, ''));
  ateru(t.replace(/\r?\n/g, ' '));
  if (/<[A-Za-z/!?]/.test(t)) {
    ateru(t.replace(/<[^>]*>/g, ''));
    ateru(t.replace(/<[^>]*>/g, ' '));
  }
  return s;
}

function kazoeru(list) {
  const m = new Map();
  for (const x of list) m.set(x.kagi, (m.get(x.kagi) || 0) + 1);
  return m;
}

function maeWoYomu(f, opt) {
  if (opt.maeGit) {
    const rel = path.relative(ROOT, path.resolve(f)).split(path.sep).join('/');
    // ★repo の 外の 道・無い 版は 止める★（黙って「全部 新しい」に しない）
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel))
      throw new Wakaranai('--mae-git は repo の 中の 道だけ');
    try {
      execFileSync(
        'git',
        ['-C', ROOT, 'rev-parse', '--verify', '--quiet', opt.maeGit + '^{commit}'],
        {
          stdio: 'ignore',
        }
      );
    } catch (_) {
      throw new Wakaranai('--mae-git の 版が 無い');
    }
    try {
      return execFileSync('git', ['-C', ROOT, 'show', opt.maeGit + ':' + rel], {
        encoding: 'utf8',
        maxBuffer: 1 << 30,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (_) {
      return null; // 前の 版に 無い＝全部 新しい
    }
  }
  const mp = path.resolve(opt.mae, path.basename(f));
  if (path.resolve(f) === mp)
    throw new Wakaranai('前の 版と 今が 同じ ファイル（成果物を 置いた 後なら --mae-git HEAD）');
  return fs.existsSync(mp) ? fs.readFileSync(mp, 'utf8') : null;
}

function main(argv) {
  const opt = { mae: null, maeGit: null };
  const files = [];
  for (let j = 0; j < argv.length; j++) {
    if (argv[j] === '--mae' || argv[j] === '--mae-git') {
      const v = argv[++j];
      if (!v) {
        console.error('★使い方★ ' + argv[j - 1] + ' の 後ろが 無い');
        return 2;
      }
      if (argv[j - 1] === '--mae') opt.mae = v;
      else opt.maeGit = v;
    } else files.push(argv[j]);
  }
  const { words, finger } = K.loadWords({
    env: process.env,
    file: path.join(os.homedir(), '.tsukurimono', 'kinshi-ji.txt'),
  });
  if (!words.length) {
    console.error(
      '★未測定★ 禁止の字の 一覧が 無い（KINSHI_JI も ~/.tsukurimono/kinshi-ji.txt も 無い）'
    );
    return 2;
  }
  const list = files.length
    ? files
    : fs
        .readdirSync(path.join(ROOT, 'data'))
        .filter((f) => /^poi-[a-z]+\.js$/.test(f))
        .sort()
        .map((f) => path.join(ROOT, 'data', f));
  const maeAri = !!(opt.mae || opt.maeGit);
  console.log(
    `一覧 ${words.length}語・指紋 ${finger}／店データ ${list.length}本` +
      (maeAri ? `／前の 版＝${opt.maeGit ? 'git ' + opt.maeGit : opt.mae}` : '')
  );
  let zenbu = 0;
  let atarashii = 0;
  let onaji = 0;
  for (const f of list) {
    const na = path.basename(f);
    let ima;
    let o;
    let maeList = null;
    try {
      ima = fs.readFileSync(path.resolve(f), 'utf8');
      o = yomuMise(ima);
      if (maeAri) {
        const maeText = maeWoYomu(f, opt);
        if (maeText !== null && maeText === ima) onaji++;
        maeList = maeText === null ? [] : atari(yomuMise(maeText), words);
      }
    } catch (e) {
      // ★中身の 字を 出さない★＝決まった 文だけ
      console.error(`★分からない★ ${na}：${e instanceof Wakaranai ? e.message : '読めない'}`);
      return 2;
    }
    const a = atari(o, words);
    // ★施設に 結べない 当たり★（頭の 注釈・上の 欄・タグ外しで つながる 字 等）＝止める
    const shisetsuNoGo = new Set(a.map((x) => x.go));
    const musubenai = [...zentaiNoGo(ima, words)].filter((g) => !shisetsuNoGo.has(g));
    if (musubenai.length) {
      console.error(
        `★分からない★ ${na}：施設に 結べない 当たり（一覧の ${musubenai.join('・')} 番目）`
      );
      return 2;
    }
    zenbu += a.length;
    if (!a.length) continue;
    const shisetsu = new Set(a.map((x) => x.i)).size;
    console.log(
      `${na}：施設 ${shisetsu}か所・当たり ${a.length}・語の 種類 ${shisetsuNoGo.size}（白名簿の「当たりN」は この 種類の 数）`
    );
    // 前の 版と 数で 比べる（同じ 鍵が 前は 1つ・今は 2つなら 1つ 新しい）
    const nokori = maeList ? kazoeru(maeList) : null;
    for (const x of a) {
      let shin = false;
      if (nokori) {
        const n = nokori.get(x.kagi) || 0;
        if (n > 0) nokori.set(x.kagi, n - 1);
        else shin = true;
      }
      if (shin) atarashii++;
      if (nokori && !shin) continue;
      console.log(
        `  ${shin ? '★新しい★ ' : ''}施設 #${x.i}・欄 ${x.ran}・種類 ${x.c}（${x.cat}）・一覧の ${x.go} 番目・字の 長さ ${x.nagasa}`
      );
    }
  }
  if (maeAri && list.length && onaji === list.length) {
    console.error(
      '★分からない★ 前の 版と 今が 全部 同じ 中身（成果物を 置く 前の 版と 比べていない）'
    );
    return 2;
  }
  console.log(
    `合計：当たり ${zenbu}${maeAri ? `・前の 版に 無い 当たり ${atarashii}` : ''}（字は 出していない）`
  );
  return zenbu ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main(process.argv.slice(2));
