// ============================================================
// ★割った画面を「割る前と ほぼ同じ字」で読む★ 2026-11-07
//
//   kyuryo.html の 見た目と 動きを css/kyuryo.css・js/kyuryo.js へ 出した。
//   画面の字を 読んで 見張る 試験（58本＋.html を まとめて 読む 8本）が
//   ★html だけ 読むと 中身が 0 に なり、緑のまま 何も 見なくなる★。
//   ⇒ ?v= の 付いた 自前の link/script を ★その場所へ 中身を 戻した 字★を 返す
//     （css/js を 後ろに 続けると「A が B より 前」を 見る 試験の 意味が 変わる＝しない）。
//
//   ★割っていない ファイルは fs.readFileSync(p, 'utf8') と 同じ 字を 返す★
//     （だから 試験の 中の 読みを 全部 これに 替えても 他の 画面の 見え方は 変わらない）。
//   ★殻そのもの（link/script の 並び・?v=）を 見る 試験は これを 使わない★
//     （tests/unit/kyuryo-wari.test.js の RAW 名簿）。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function moto(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function hiraku(jisage, naka) {
  const ind = jisage + '  ';
  return naka
    .replace(/\r\n/g, '\n')
    .replace(/\n$/, '')
    .split('\n')
    .map((l) => (l === '' ? '' : ind + l))
    .join('\n');
}

// html の 字の 中の ?v= 付き 自前の css/js を 戻す（戻した 数も 返す）
function modosu(html) {
  let n = 0;
  let out = html.replace(
    /^([ \t]*)<link rel="stylesheet" href="(css\/[^"?]+\.css)\?v=[0-9a-f]+" \/>/gm,
    (m, ind, f) => {
      n++;
      return `${ind}<style>\n${hiraku(ind, moto(f))}\n${ind}</style>`;
    }
  );
  out = out.replace(
    /^([ \t]*)<script src="(js\/[^"?]+\.js)\?v=[0-9a-f]+"><\/script>/gm,
    (m, ind, f) => {
      n++;
      return `${ind}<script>\n${hiraku(ind, moto(f))}\n${ind}</script>`;
    }
  );
  return { out, n };
}

// p … 絶対の 道 か repo の 根からの 道。enc は 受けるだけ（いつも utf8 の 字を 返す）
function yomuGamen(p, _enc) {
  const abs = path.isAbsolute(p) ? p : path.join(ROOT, p);
  const s = fs.readFileSync(abs, 'utf8');
  if (!/\.html?$/i.test(abs)) return s;
  // この repo の 外（他の アプリ）の 画面は 戻さない（css/ js/ は この repo の 根から 読む 作り）
  if (path.relative(ROOT, abs).startsWith('..')) return s;
  return modosu(s).out;
}

module.exports = { yomuGamen, modosu, ROOT };
