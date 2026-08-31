'use strict';
// ============================================================
// ★★測り台は 本番が 積んでいる 物を 全部 積む★★ 2026-09-01
//
//   ★何が 起きたか（実測・2026-08-31）★
//     料金の 計算を js/fare-calc.js に 出しました。本番の index.html は
//     ★fare-calc.js → meter.js の 順★で 読みます。
//     ところが ★meter.js だけを 読む 測り台★が 2つ 残っていて、
//       tests/replay-mm-worker/runner.js
//       tests/meter-mm-priority.js
//     ★中身は 正しいのに 台のせいで 赤★に なりました。
//       ・手元 … 2778本 緑
//       ・CI  … ★赤★ Error: ★料金の計算(js/fare-calc.js)が 読み込まれていません★
//     ＝★ローカル緑 ≠ CI緑★。しかも ★1つ 直しても もう1つで また 赤★でした。
//
//   ★だから 数える★
//     「meter.js を 自分で 読み込む 台」を ★機械で 全部 見つけて★、
//     その 台が ★fare-calc.js も 読んでいる事★を 見ます。
//     ⇒ 次に 部品が 増えた時も ★1つずつ 手で 探さなくて 済みます★。
//
//   ★対象外★
//     ・tests/fixtures/ … ★凍らせた 複製★（直したら 比べる 意味が 無くなる）
//     ・このファイル自身
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const JIBUN = 'tests/unit/hakaridai-honban-to-onaji.test.js';

// ★本番の index.html が meter.js より 前に 読む 物★（順番も 見る）
const SAKI_NI = 'js/fare-calc.js';

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walk(p, out);
      return;
    }
    if (!/\.(js|mjs)$/.test(e.name)) return;
    const rel = path.relative(ROOT, p).split(path.sep).join('/');
    if (rel === JIBUN) return;
    if (rel.indexOf('tests/fixtures/') === 0) return;
    out.push(rel);
  });
  return out;
}

// ★「meter.js を 自分で 読み込んで ★走らせる★ 台」か★
//   ★2026-09-01 直し★… はじめ「vm や new Function が 在るか」で 数えていました。
//   ⇒ ★中身を 字として 読むだけの 試験★（例: tests/integration/deadcode-…）まで 拾い、
//     ★積む必要が 無い 物に 積めと 言って★ いました。
//   ⇒ ★走らせた 印★で 数えます＝meter.js を 動かして Meter を 取り出す 書き方:
//       globalThis.Meter = Meter   /   return Meter;
//     （読むだけの 物には この 印が 出ません）
function hakaridai(src) {
  const yomu = /['"]meter\.js['"]/.test(src) && /readFileSync/.test(src);
  const hashiraseta = /globalThis\.Meter\s*=\s*Meter|return Meter;/.test(src);
  return yomu && hashiraseta;
}

describe('★測り台は 本番が 積んでいる 物を 全部 積む★', () => {
  const zenbu = walk(path.join(ROOT, 'tests'), []).concat(
    fs.existsSync(path.join(ROOT, 'scripts')) ? walk(path.join(ROOT, 'scripts'), []) : []
  );
  const dai = zenbu.filter((rel) => hakaridai(fs.readFileSync(path.join(ROOT, rel), 'utf8')));

  it('★① 台が 見つかっている（0本なら 数え方が 壊れている）★', () => {
    // ★0本でも 緑★に しない。実測 2本（2026-09-01）
    expect(
      dai.length,
      '★meter.js を 読み込む 台が 1つも 見つかりません（数え方が 壊れています）★'
    ).toBeGreaterThan(0);
  });

  it('★★② どの 台も 料金の 計算(js/fare-calc.js)を 積んでいる★★', () => {
    // ★書き方は 台ごとに 違う★（'js/fare-calc.js' / path.join(..,'js','fare-calc.js')）
    //   ⇒ ★ファイル名で 見ます★（名前で 探すのは 改名に 弱いので ★③で 本番の 並びも 見ています★）
    const tarinai = dai.filter(
      (rel) => !/fare-calc\.js/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
    );
    expect(
      tarinai,
      '★本番が 積んでいる ' +
        SAKI_NI +
        ' を 積んでいない 台が あります（★台のせいで 赤★に なります）★'
    ).toEqual([]);
  });

  it('★③ 本番の 画面が 本当に その順で 読んでいる（前提の 確かめ）★', () => {
    // ★2026-09-01 直し★… はじめ indexOf で 数えて ★説明文の中の「meter.js」★を
    //   拾い、正しい順なのに 赤に なりました。★<script src> の 並びだけ★を 見ます。
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const src = (html.match(/<script[^>]+src="([^"]+)"/g) || []).map((t) =>
      t.replace(/.*src="/, '').replace(/".*/, '')
    );
    const a = src.indexOf('js/fare-calc.js');
    const b = src.indexOf('js/meter.js');
    expect(a, '★本番の 画面が ' + SAKI_NI + ' を 読んでいません★').toBeGreaterThanOrEqual(0);
    expect(b, '★本番の 画面が js/meter.js を 読んでいません★').toBeGreaterThanOrEqual(0);
    expect(a, '★順番が 逆です（meter.js が 先だと 料金が 出ません）★').toBeLessThan(b);
  });
});
