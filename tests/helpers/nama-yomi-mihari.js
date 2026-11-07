// ============================================================
// ★割った画面（kyuryo.html）を 生で 読む 試験を その場で 赤に する★ 2026-11-07
//
//   kyuryo.html の 中身（見た目と 動き）は css/kyuryo.css・js/kyuryo.js へ 出した。
//   試験が kyuryo.html を fs.readFileSync で 生で 読むと ★殻だけ★ を 見て、
//   「〜が 無い」を 見る 試験は ★何も 見ずに 緑★に なる。
//   ⇒ 試験の 字を 探すのでは なく（書き方が 6通り 在って 5つ 漏れた・11-07 taiketsu 注1）、
//     ★読んだ 瞬間に 誰が 読んだか★を 見る：
//       tests/ の 中の ファイルが 直に 読んだ ＝ 赤（tests/helpers/gamen-src.js の yomuGamen を 使う）
//       RAW（殻 そのものを 見る 試験）・scripts/ の 道具・gamen-src.js が 読んだ ＝ 通す
//   vitest.config.js の setupFiles で 全 試験に 効く。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const WARETA = [path.join(ROOT, 'kyuryo.html')].map((p) => p.toLowerCase());
const TESTS = path.join(ROOT, 'tests').toLowerCase() + path.sep;
const TOOSU = [
  path.join(ROOT, 'tests', 'helpers', 'gamen-src.js'),
  path.join(ROOT, 'tests', 'helpers', 'nama-yomi-mihari.js'),
  // ★RAW＝殻 そのもの（link/script の 並び・?v=・refs）を 見る★
  path.join(ROOT, 'tests', 'unit', 'kyuryo-wari.test.js'),
  path.join(ROOT, 'tests', 'unit', 'office-allow-list.test.js'),
].map((p) => p.toLowerCase());

function yondaHito() {
  // 一番 近い 呼び手の ファイル（node: と node_modules と この ファイルは 飛ばす）
  const st = String(new Error().stack).split('\n').slice(1);
  for (const l of st) {
    const m = /\(?((?:file:\/\/\/)?[A-Za-z]:[\\/][^():]+|\/[^():]+):\d+:\d+\)?\s*$/.exec(l);
    if (!m) continue;
    let f = m[1].replace(/^file:\/\/\//, '');
    f = path.resolve(decodeURIComponent(f)).toLowerCase();
    if (f.includes(`${path.sep}node_modules${path.sep}`)) continue;
    if (f === __filename.toLowerCase()) continue;
    return f;
  }
  return '';
}

function hanbetsu(p) {
  if (typeof p !== 'string' && !(p instanceof URL)) return '';
  const abs = path.resolve(p instanceof URL ? p.pathname.replace(/^\/([A-Za-z]:)/, '$1') : p);
  if (!WARETA.includes(abs.toLowerCase())) return '';
  const dare = yondaHito();
  if (!dare.startsWith(TESTS)) return ''; // scripts/ の 道具 等
  if (TOOSU.includes(dare)) return '';
  return dare;
}

const motoRead = fs.readFileSync;
fs.readFileSync = function readFileSync(p, ...rest) {
  const dare = hanbetsu(p);
  if (dare) {
    throw new Error(
      `★${path.relative(ROOT, dare)} が kyuryo.html を 生で 読んでいます★` +
        '（殻だけ＝中身の css/js を 見ずに 緑に なる）。tests/helpers/gamen-src.js の yomuGamen を 使う／' +
        '殻 そのものを 見る 試験なら tests/helpers/nama-yomi-mihari.js の TOOSU に 足す'
    );
  }
  return motoRead.call(this, p, ...rest);
};

module.exports = { hanbetsu, TOOSU };
