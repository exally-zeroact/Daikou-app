// ============================================================
// scripts/kinshi-mise-tsugi.mjs
// ★店データ（data/poi-*.js）は 店ごとの 鍵付きの 印で 名指しし、当たった 店が 同じ 時だけ 白名簿の blob を 書き継ぐ★ 2026-10-16
//
//   ★なぜ★
//     店データは 毎月 地図から 作り直す ので 中身が 変わる。白名簿（tests/kinshi-ji-shiro.txt）は blob で 名指し
//     するので、当たった 店が 1つも 変わらなくても 毎月 赤に なり、席が 中身を 見ずに blob を 書き直して 通していた。
//     見張りの 本体（tests/kinshi-ji.test.mjs）は 他の 席の 写し＝この 席で 書き換えない 決まり なので、外に 置く。
//
//   ★形★
//     tests/kinshi-mise-shiro.txt＝「道<TAB>印<TAB>訳」。人が 施設を 見直した 時だけ 書く（bot は 書かない）。
//     印＝当たった 施設の JSON（生の 字・同じ 施設が 2つなら 2つ）を 並べ、揃えた 一覧の 全文（並べ替えた 語）を 鍵に した
//         HMAC-SHA256 の 頭16字。鍵の 無い 印は 公の 地図から 一覧の 語が 割れた（11語中 7語・対立役）ので 鍵を 付ける。
//     当たりの 判じは ★本体の scan() を そのまま 呼ぶ★（当て方を 写さない＝本体の 版が 変わっても ずれない）。
//       ・施設：その 施設の JSON だけを 入れた 仮の ファイルを scan に 渡し、当たり か 赤 が 在れば「当たった 施設」
//       ・施設の 外：当たった 施設の 区間を {} に 置き換えた 全文を scan に 渡し、当たり・赤・未測定 が 1つでも 在れば 止める
//         （同じ 語が cats・頭の 注釈・行またぎ に 増えても 拾う＝語の 種類の 集合で 引くと 見逃した・対立役）
//
//   ★使い方★
//     node scripts/kinshi-mise-tsugi.mjs --shirushi [data/poi-*.js …]
//         … 席が 施設を 見直した 後に 印の 行を 出す（手元の 一覧 か KINSHI_JI）
//     node scripts/kinshi-mise-tsugi.mjs --tsugi
//         … ★poi-update の 定時の 中だけ★：印が 一致した 店データの 行の blob の 頭16字だけを 書き継ぐ
//     node scripts/kinshi-mise-tsugi.mjs --mon
//         … commit の 前の 門：足した 物（index）が data/ と 白名簿 だけで、白名簿は 店データの 行の 3列目（blob）しか
//           変えていない 事を HEAD と 比べて 見る（一覧は 要らない）。書き継ぎが 他の 列・他の 行を 変えたら 止める
//   ★出しに 語の 番号・施設・件数・字を 出さない★（出すのは 道と 決まった 文だけ）
//   終わり値：0＝済み／1＝止めた（印の 紙が 無い・読めない・鍵が 無い・見られない 店データ）／2＝使い方
// ============================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT_DEFAULT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MISE_SHIRO = 'tests/kinshi-mise-shiro.txt';
export const MISE_MICHI = /^data\/poi-[a-z0-9]+\.js$/;
const LOCAL_LIST = path.join(os.homedir(), '.tsukurimono', 'kinshi-ji.txt');

class Tomeru extends Error {}

async function hontai(root) {
  return import(pathToFileURL(path.join(root, 'tests', 'kinshi-ji.test.mjs')).href);
}

// 仮の ファイル 1本だけを 本体の scan に 渡す（道の 名は 当たらない 決まった 名）
function kariScan(K, words, text) {
  const rel = 'kari/mise.txt';
  const buf = Buffer.from(text, 'utf8');
  const src = {
    kind: (r) => (r === rel ? 'file' : 'none'),
    read: (r) => {
      if (r !== rel) throw new Error('無い');
      return buf;
    },
    id: () => '0000000000000000',
    shiroText: () => null,
    partial: true,
  };
  const r = K.scan({ root: os.tmpdir(), files: [rel], words, src });
  return r.hits.length + r.reds.length + r.notes.length;
}

// 店データ 1本の 印。止める 時は Tomeru（訳は 決まった 文だけ）
export function miseNoShirushi(K, words, text) {
  const t = String(text);
  const m = t.match(/window\.[A-Z_]+ = (\{[\s\S]*\});/);
  if (!m) throw new Tomeru('店データの 形で ない');
  let o;
  try {
    o = JSON.parse(m[1]);
  } catch {
    throw new Tomeru('店データの JSON が 読めない'); // e.message は 出さない（字の 断片が 入る）
  }
  if (!o || !Array.isArray(o.pois)) throw new Tomeru('pois が 無い');
  const atatta = [];
  const kukan = [];
  let kara = t.indexOf(m[1]);
  for (const p of o.pois) {
    const raw = JSON.stringify(p);
    const i = t.indexOf(raw, kara);
    if (i < 0) throw new Tomeru('施設の 区間が 見つからない');
    kara = i + raw.length;
    if (kariScan(K, words, raw) > 0) {
      atatta.push(raw);
      kukan.push([i, i + raw.length]);
    }
  }
  // 当たった 施設の 区間を {} に して、外に 当たりが 1つも 無い 事を 本体で 見る
  let soto = '';
  let mae = 0;
  for (const [a, b] of kukan) {
    soto += t.slice(mae, a) + '{}';
    mae = b;
  }
  soto += t.slice(mae);
  if (kariScan(K, words, soto) > 0) throw new Tomeru('施設の 外に 当たりが 在る');
  if (!atatta.length) return { mark: null };
  const kagi = words
    .map((w) => w.key)
    .sort()
    .join('\n');
  const mark = crypto
    .createHmac('sha256', kagi)
    .update(atatta.sort().join('\n'))
    .digest('hex')
    .slice(0, 16);
  return { mark };
}

export function yomuMiseShiro(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [rel, mark, why] = line.split('\t').map((x) => (x || '').trim());
    if (!rel || !mark || !why) throw new Tomeru('印の 紙の 形が 違う（道<TAB>印<TAB>訳）');
    if (!MISE_MICHI.test(rel)) throw new Tomeru('印の 紙に data/poi-*.js で ない 道が 在る');
    if (!/^[0-9a-f]{16}$/.test(mark)) throw new Tomeru('印の 紙の 印が 16字の 形で ない');
    if (map.has(rel)) throw new Tomeru('印の 紙で 同じ 道を 2回 名指ししている');
    map.set(rel, mark);
  }
  return map;
}

// 白名簿の その 道の 行の 3列目（blob）だけを 書き換える。他の 列・他の 行は 1字も 変えない
export function blobDakeKakikaeru(shiroText, rel, blob) {
  let n = 0;
  const out = String(shiroText)
    .split('\n')
    .map((line) => {
      const cols = line.split('\t');
      if (cols.length !== 4 || cols[0] !== rel) return line;
      if (!/^当たり[1-9]\d*$/.test(cols[1].trim())) return line;
      n++;
      cols[2] = blob;
      return cols.join('\t');
    })
    .join('\n');
  return { text: out, n };
}

// commit の 前の 門：前（HEAD）と 今（index）の 白名簿を 比べ、店データの 行の 3列目 以外の 違いを 返す（無ければ 空）
export function shiroNoChigai(mae, ima) {
  const a = String(mae).split('\n');
  const b = String(ima).split('\n');
  if (a.length !== b.length) return ['行の 数が 変わった'];
  const warui = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    const x = a[i].split('\t');
    const y = b[i].split('\t');
    const ok =
      x.length === 4 &&
      y.length === 4 &&
      MISE_MICHI.test(x[0]) &&
      x[0] === y[0] &&
      x[1] === y[1] &&
      x[3] === y[3] &&
      /^[0-9a-f]{16}$/.test(y[2]);
    if (!ok) warui.push((i + 1) + ' 行目');
  }
  return warui;
}
function mon(root) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const SHIRO = 'tests/kinshi-ji-shiro.txt';
  // --no-renames：改名を「消した 道＋足した 道」の 2つで 出す（改名で 印の 紙を 動かすと 新しい 道しか 出ず 通った・対立役）
  const tashita = git(['diff', '--cached', '--name-only', '--no-renames']).split('\n').filter(Boolean);
  const soto = tashita.filter((f) => !/^data\//.test(f) && f !== SHIRO);
  if (soto.length) throw new Tomeru('data/ と 白名簿 の 外を 足している: ' + soto.join(' '));
  if (!tashita.includes(SHIRO)) return '白名簿は 変えていない';
  const warui = shiroNoChigai(git(['show', 'HEAD:' + SHIRO]), git(['show', ':' + SHIRO]));
  if (warui.length) throw new Tomeru('白名簿の 店データの 行の blob 以外を 変えている: ' + warui.join(' '));
  return '白名簿は 店データの 行の blob だけを 変えた';
}

function teijiKa(env) {
  return (
    env.GITHUB_ACTIONS === 'true' &&
    env.GITHUB_WORKFLOW === 'OSM POI Auto Update' &&
    (env.GITHUB_EVENT_NAME === 'schedule' || env.GITHUB_EVENT_NAME === 'workflow_dispatch')
  );
}

export async function main(argv, { env = process.env, root = ROOT_DEFAULT, out = console.log } = {}) {
  const mode = argv[0];
  if (mode !== '--shirushi' && mode !== '--tsugi' && mode !== '--mon') {
    out('★使い方★ --shirushi [data/poi-*.js …] か --tsugi か --mon');
    return 2;
  }
  try {
    if (mode === '--mon') {
      out('✓ 門：' + mon(root));
      return 0;
    }
    const K = await hontai(root);
    const { words } = K.loadWords({ env, file: env.KINSHI_JI_FILE || LOCAL_LIST });
    if (!words.length) throw new Tomeru('一覧（鍵）が 無い');
    const yomu = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
    if (mode === '--shirushi') {
      const list = argv.length > 1
        ? argv.slice(1).map((f) => path.relative(root, path.resolve(f)).split(path.sep).join('/'))
        : fs
            .readdirSync(path.join(root, 'data'))
            .filter((f) => /^poi-[a-z0-9]+\.js$/.test(f))
            .sort()
            .map((f) => 'data/' + f);
      for (const rel of list) {
        if (!MISE_MICHI.test(rel)) throw new Tomeru('data/poi-*.js で ない 道');
        const { mark } = miseNoShirushi(K, words, yomu(rel));
        if (mark) out(rel + '\t' + mark + '\t公の地図データ・店ごとに見た');
      }
      return 0;
    }
    // --tsugi＝定時の 中だけ
    if (!teijiKa(env)) throw new Tomeru('書き継ぎは poi-update の 定時の 中だけ');
    const miseFile = path.join(root, MISE_SHIRO);
    if (!fs.existsSync(miseFile)) throw new Tomeru('印の 紙が 無い');
    const mise = yomuMiseShiro(fs.readFileSync(miseFile, 'utf8'));
    const shiroFile = path.join(root, K.SHIRO_PATH);
    let shiro = fs.readFileSync(shiroFile, 'utf8');
    const kaketa = [];
    let tomete = 0;
    for (const [rel, mark] of mise) {
      if (!fs.existsSync(path.join(root, rel))) {
        out('書き継がない: ' + rel + '（店データが 無い）');
        tomete++;
        continue;
      }
      let ima;
      try {
        ima = miseNoShirushi(K, words, yomu(rel)).mark;
      } catch (e) {
        out('書き継がない: ' + rel + '（' + (e instanceof Tomeru ? e.message : '読めない') + '）');
        tomete++;
        continue;
      }
      if (ima !== mark) {
        out('書き継がない: ' + rel + '（当たった 店が 変わった＝席が 手元で 見直す）');
        tomete++;
        continue;
      }
      const blob = K.blobId(root, rel);
      if (!/^[0-9a-f]{16}$/.test(blob)) {
        out('書き継がない: ' + rel + '（blob が 計れない）');
        tomete++;
        continue;
      }
      const r = blobDakeKakikaeru(shiro, rel, blob);
      if (r.n !== 1) {
        out('書き継がない: ' + rel + '（白名簿に「当たりN」の 行が ちょうど 1つ 無い）');
        tomete++;
        continue;
      }
      if (r.text !== shiro) {
        shiro = r.text;
        kaketa.push(rel);
      }
    }
    if (kaketa.length) fs.writeFileSync(shiroFile, shiro);
    for (const rel of kaketa) out('店の印が同じなので blob の頭を書き換えた: ' + rel);
    out(tomete ? '書き継がない 店データが 在る（見張りが 赤に なれば 席が 手元で 見直す）' : '店データは 全部 見た');
    return 0;
  } catch (e) {
    out('★止めた★ ' + (e instanceof Tomeru ? e.message : '分からない 誤り（中身は 出さない）'));
    return 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = await main(process.argv.slice(2));
