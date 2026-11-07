// ============================================================
// ★割った画面の css/js に「中身の指紋」を付ける★ 2026-11-07
//
//   ★なぜ要るか★
//     kyuryo.html の 見た目（css/kyuryo.css）と 動き（js/kyuryo.js）を 外へ 出した。
//     開いたままの 画面は ★kyuryo.html の 指紋（ETag）だけ★を 見て 読み直す
//     （js/jimusho-footer.js の shimonWoToru）。js だけ 直しても html の 字が 変わらないと
//     ★iPhone の ホーム画面の 事務所・従業員の 画面が 古い 給料の js の まま 動く★。
//   ⇒ html の src/href に ?v=<中身の sha256 先頭10字> を 書く。中身が 変われば html も 変わる。
//
//   使い方：
//     node scripts/kyuryo-shimon.mjs          … 指紋を 書く（.husky/pre-commit が lint-staged の 後に 呼ぶ）
//     node scripts/kyuryo-shimon.mjs --check  … ずれていたら exit 1（書かない）
//     node scripts/kyuryo-shimon.mjs --commit … .husky/pre-commit 用。書き直した 時だけ git add <html>。
//       html に stage していない 直しが 在る 時は 書かずに exit 1（別の 件の 書きかけを commit に 混ぜない・11-07 taiketsu 注3）
//   試験 tests/unit/kyuryo-wari.test.js が 同じ 物を 縛る（push の 門と CI）。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ★割った画面 → 外へ出した 自前の ファイル★（増やす時は ここに 足す）
export const WARI = {
  'kyuryo.html': ['css/kyuryo.css', 'js/kyuryo.js'],
};

export function shimon(buf) {
  // 改行の 違い（CRLF の 作業木）で 指紋が 変わらない様に LF に そろえてから 測る
  const s = buf.toString('utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);
}

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function kakikae(html, root = ROOT, page = 'kyuryo.html') {
  let out = html;
  const zure = [];
  for (const f of WARI[page]) {
    const v = shimon(fs.readFileSync(path.join(root, f)));
    const re = new RegExp(`(["'])${esc(f)}(?:\\?v=([0-9a-f]*))?\\1`, 'g');
    let n = 0;
    out = out.replace(re, (m, q, ima) => {
      n++;
      if (ima !== v) zure.push(`${f}: ${ima || '(無し)'} → ${v}`);
      return `${q}${f}?v=${v}${q}`;
    });
    if (n !== 1) throw new Error(`${page} の 中の ${f} が 1つでない（${n}）`);
  }
  return { out, zure };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const check = process.argv.includes('--check');
  const commit = process.argv.includes('--commit');
  // 作業木の html ＝ stage した 字（stage していない 直しが 無い）か
  const stageNoMama = (page) => {
    try {
      execFileSync('git', ['diff', '--quiet', '--', page], { cwd: ROOT });
      return true;
    } catch {
      return false;
    }
  };
  let dame = 0;
  for (const page of Object.keys(WARI)) {
    const p = path.join(ROOT, page);
    const html = fs.readFileSync(p, 'utf8');
    const { out, zure } = kakikae(html, ROOT, page);
    if (!zure.length) continue;
    if (check) {
      dame++;
      console.error(
        `★指紋が ずれています★ ${page}\n  ${zure.join('\n  ')}\n  → node scripts/kyuryo-shimon.mjs`
      );
    } else if (commit && !stageNoMama(page)) {
      dame++;
      console.error(
        `★${page} に stage していない 直しが 在ります★ 指紋を 書くと 一緒に commit に 入るので 止めました。\n` +
          `  ${zure.join('\n  ')}\n  → ${page} を stage するか 戻してから もう一度 commit`
      );
    } else {
      fs.writeFileSync(p, out);
      if (commit) execFileSync('git', ['add', '--', page], { cwd: ROOT, stdio: 'inherit' });
      console.error(`指紋を 書いた ${page}: ${zure.join(' / ')}`);
    }
  }
  process.exit(dame ? 1 : 0);
}
