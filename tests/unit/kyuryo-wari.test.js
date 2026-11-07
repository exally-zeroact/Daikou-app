'use strict';
// ============================================================
// ★給料の 画面（kyuryo.html）を 3枚に 割った 形を 縛る★ 2026-11-07
//
//   kyuryo.html（10,264行）の <style> を css/kyuryo.css、<script> を js/kyuryo.js へ 出した（中身は 変えない）。
//   ここで 見る 事：
//     ①殻に <style> と 中身の 在る <script> が 0（戻り 書きを 防ぐ）
//     ②css/kyuryo.css の link と js/kyuryo.js の script が 1つずつ・元と 同じ 場所（qrcode の 後・pdf-okuru の 前）
//     ③?v= ＝ 今の 中身の 指紋（js だけ 直して 指紋を 直し 忘れると ★開いた ままの 画面が 古い js で 動く★）
//     ④試験の 手伝い yomuGamen が 2つとも 元の 場所へ 戻す（戻せないと 字で 読む 試験が 黙って 空になる）
//     ⑤tests の 中で kyuryo.html を 字で 読む 物は yomuGamen を 使うか RAW 名簿に 載る
//   ★わざと壊して 赤を 見る★（11-07）：js を 1字 変えて 指紋を 直さない／RAW に 無い 試験で readFileSync('kyuryo.html')
// ============================================================
const fs = require('fs');
const path = require('path');
const { yomuGamen, modosu } = require('../helpers/gamen-src.js');

const ROOT = path.resolve(__dirname, '..', '..');
const KARA = fs.readFileSync(path.join(ROOT, 'kyuryo.html'), 'utf8');

let SH;
beforeAll(async () => {
  SH = await import('../../scripts/kyuryo-shimon.mjs');
});

describe('★殻（kyuryo.html）の 形★', () => {
  it('① <style> と 中身の 在る <script> が 0', () => {
    const naka = KARA.replace(/<!--[\s\S]*?-->/g, '');
    expect((naka.match(/<style[\s>]/g) || []).length, '★殻に <style> が 戻っている★').toBe(0);
    const inline = (naka.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || []).filter(
      (m) => m.replace(/<\/?script[^>]*>/g, '').trim() !== ''
    );
    expect(inline.length, '★殻に 中身の 在る <script> が 戻っている★').toBe(0);
  });

  it('② link と script が 1つずつ・元の 場所', () => {
    const css =
      KARA.match(/<link rel="stylesheet" href="css\/kyuryo\.css\?v=[0-9a-f]{10}" \/>/g) || [];
    const js = KARA.match(/<script src="js\/kyuryo\.js\?v=[0-9a-f]{10}"><\/script>/g) || [];
    expect(css.length, '★css/kyuryo.css の link が 1つでない★').toBe(1);
    expect(js.length, '★js/kyuryo.js の script が 1つでない★').toBe(1);
    const srcs = [...KARA.matchAll(/<script src="([^"?]+)/g)].map((m) => m[1]);
    const i = srcs.indexOf('js/kyuryo.js');
    // 元は qrcode.min.js の 次に 中身の script・その後に pdf-okuru.js（その前に 読む 物は 全部 先）
    expect(srcs[i - 1], '★js/kyuryo.js の 前が 変わった★').toBe('js/qrcode.min.js');
    expect(srcs[i + 1], '★js/kyuryo.js の 後が 変わった★').toBe('js/pdf-okuru.js');
    expect(KARA.indexOf('css/kyuryo.css'), '★css が </head> の 後★').toBeLessThan(
      KARA.indexOf('</head>')
    );
  });

  it('③ ?v= ＝ 今の 中身の 指紋', () => {
    const { zure } = SH.kakikae(KARA, ROOT, 'kyuryo.html');
    expect(zure, '★指紋が 中身と ずれている＝node scripts/kyuryo-shimon.mjs を 回す★').toEqual([]);
    // 指紋は 改行（CRLF/LF）で 変わらない
    expect(SH.shimon(Buffer.from('a\r\nb\n'))).toBe(SH.shimon(Buffer.from('a\nb\n')));
  });

  it('④ 手伝いが 2つとも 元の 場所へ 戻す', () => {
    const { out, n } = modosu(KARA);
    expect(n, '★戻した 数が 2で ない★').toBe(2);
    expect(out).not.toMatch(/kyuryo\.(css|js)\?v=/);
    const js = fs.readFileSync(path.join(ROOT, 'js', 'kyuryo.js'), 'utf8').replace(/\r\n/g, '\n');
    // 中身の 最初と 最後の 行が 戻した 字に 在る（字下げ つき）
    const gyo = js.split('\n').filter((l) => l.trim() !== '');
    expect(out).toContain('      ' + gyo[0]);
    expect(out).toContain('      ' + gyo[gyo.length - 1]);
    expect(yomuGamen('kyuryo.html'), '★yomuGamen が modosu と 違う 字を 返す★').toBe(out);
  });
});

// ★⑤ 字で 読む 試験の 縛り★
//   kyuryo.html を 名前（字）で 持って fs.readFileSync する 試験は、yomuGamen を 使う か RAW に 載る。
//   RAW＝★殻 そのもの（link/script の 並び・?v=・refs）を 見る★ 物だけ。
const RAW = [
  'tests/unit/kyuryo-wari.test.js', // この 試験
  'tests/unit/office-allow-list.test.js', // 殻の refs（/js/kyuryo.js を 読む 事）を 見る
];
function zenbu(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== 'fixtures') zenbu(p, out);
    } else if (/\.(c|m)?js$/.test(e.name)) out.push(p);
  }
  return out;
}
// ★⑥ 生で 読んだ 瞬間に 赤に する 見張り（tests/helpers/nama-yomi-mihari.js）が 効いている★
//   ⑤ は 字で 探すので 変数・手伝い関数・for で 回す 形を 漏らす（11-07 taiketsu 注1＝6通り中 5つ）。
//   本体は ⑥（vitest.config.js の setupFiles）。⑤ は e2e（vitest の 外）の 為に 残す。
describe('⑥ 生読みの 見張りが 効いている', () => {
  it('setupFiles に 入っていて fs.readFileSync を 包んでいる', () => {
    const cfg = fs.readFileSync(path.join(ROOT, 'vitest.config.js'), 'utf8');
    expect(cfg, '★setupFiles から 見張りが 外れた★').toMatch(
      /setupFiles:\s*\[[^\]]*nama-yomi-mihari\.js/
    );
    expect(String(fs.readFileSync), '★fs.readFileSync が 包まれていない★').toContain('hanbetsu');
    const M = require('../helpers/nama-yomi-mihari.js');
    // TOOSU＝手伝い 2本＋RAW 2本（増やす時は 殻 そのものを 見る 訳を 書く）
    expect(M.TOOSU.length).toBe(4);
  });
});

describe('⑤ 字で 読む 試験は 割った 中身も 読む', () => {
  it('kyuryo.html を 字で 読む 試験は yomuGamen か RAW', () => {
    const files = zenbu(path.join(ROOT, 'tests'));
    expect(files.length, '★試験を 数えられていない★').toBeGreaterThan(100);
    const warui = [];
    let mita = 0;
    const yonda = files
      .map((f) => ({
        rel: path.relative(ROOT, f).replace(/\\/g, '/'),
        s: fs.readFileSync(f, 'utf8'),
      }))
      .filter((x) => /['"`]kyuryo\.html['"`]/.test(x.s));
    for (const { rel, s } of yonda) {
      if (/\byomuGamen\(/.test(s)) mita++;
      // 生で 読む 所（道の 中に kyuryo.html の 字が 在る readFileSync）。page.goto や fixtures の 読みは 数えない
      const nama =
        /readFileSync\(\s*path\w*\.(?:join|resolve)\([^)]*['"`]kyuryo\.html['"`]/.test(s) ||
        /readFileSync\(\s*['"`][^'"`]*kyuryo\.html['"`]/.test(s);
      if (nama && !RAW.includes(rel)) warui.push(rel);
    }
    // 11-07 の 置き換えで 手伝いを 使う 試験は 30本超（減ったら 誰かが 生の 読みへ 戻した）
    expect(mita, '★手伝いを 使う 試験が 少なすぎる★').toBeGreaterThan(20);
    expect(warui, '★割った 中身を 読まずに kyuryo.html を 見ている 試験★').toEqual([]);
  });
});
