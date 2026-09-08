'use strict';
// ============================================================
// ★★メーターが 読む js は 1本 残らず 先取りに 在る★★ 2026-09-08
//
//   ★司さん★「従業員が開始おして走ったら距離は増えるけど金額が増えない
//             確定も押せないらしい」
//
//   ★★何が 起きていたか（2026-09-08 実測）★★
//     `js/fare-calc.js`（料金の 計算そのもの）が
//     ★サービスワーカーの 先取り 名簿に 1本も 入っていませんでした★。
//     ⇒ オフラインだと 読めない ⇒ FareCalc が 無い
//     ⇒ Meter.calcFare が 例外を 投げる
//     ⇒ 画面を 書く 所（_renderMeterReadout）は
//        ★距離を 先に 書いて★ その後 落ちる
//        ＝★距離だけ 増えて 料金は 0 の まま★
//     ⇒ 確定（onSend）も 同じ 関数を 呼ぶ ので ★押しても 効かない★
//
//   ★なぜ 今まで 出なかったか★
//     オンラインの 間は 走りながら 取れて いた（runtime cache）。
//     ★CACHE_NAME が 変わると activate が 古い 控えを 消す★ ので、
//     版が 上がった 日に 初めて 表に 出ました。
//     ⇒ ★「たまたま 動いていた」だけ★でした。
//
//   ★なぜ 気づけなかったか★
//     先取りの 名簿は ★人が 手で 書く★物で、
//     ファイルを 切り出しても ★誰も 足さない★。
//     ⇒ ★機械に 毎回 数えさせる★（この 見張り）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-08 実測）★★
//     ①fare-calc.js を 名簿から 抜く … ★赤★
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function meibo(name) {
  const m = SW.match(new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\n\\];'));
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

// ★メーターが 読む js（<script src="js/...">）★
function yomuJs() {
  const out = new Set();
  const re = /src="(js\/[A-Za-z0-9._-]+\.js)[^"]*"/g;
  let m;
  while ((m = re.exec(HTML))) out.add('/' + m[1]);
  return [...out];
}

describe('★メーターが 読む js は 先取りに 全部 在る★', () => {
  const P = meibo('PRECACHE_FILES');
  const C = meibo('CORE_CODE_FILES');
  const YOMU = yomuJs();

  it('★① 名簿と 読み込みが 両方 読めている★（0本を 見て 緑に しない）', () => {
    expect(P, '★PRECACHE_FILES が 読めません★').not.toBeNull();
    expect(C, '★CORE_CODE_FILES が 読めません★').not.toBeNull();
    expect(P.length, '★先取り（原子的）が 少なすぎます★').toBeGreaterThan(10);
    expect(C.length, '★先取り（1本ずつ）が 少なすぎます★').toBeGreaterThan(20);
    expect(YOMU.length, '★メーターが js を 1本も 読んでいません★').toBeGreaterThan(20);
  });

  it('★② 読む js が 1本 残らず 先取りに 在る★', () => {
    const nai = YOMU.filter((f) => P.indexOf(f) < 0 && C.indexOf(f) < 0);
    expect(
      nai,
      '★オフラインで 読めない js が あります★\n' +
        '  ⇒ 電波が 無い 所で ★その js が 読めず 画面が 途中で 落ちます★\n' +
        '  ⇒ 2026-09-08 は これで ★距離だけ 増えて 料金が 0★に なりました。\n' +
        '  ★直し方★ sw.js の CORE_CODE_FILES に 足す。'
    ).toEqual([]);
  });

  it('★③ 料金の 計算は 必ず 先取りに 在る★（一番 効く 物を 名指し）', () => {
    ['/js/fare-calc.js', '/js/fare-config-store.js', '/js/meter.js'].forEach((f) => {
      expect(
        P.indexOf(f) >= 0 || C.indexOf(f) >= 0,
        '★' + f + ' が 先取りに ありません★ ⇒ オフラインで 料金が 出なくなります'
      ).toBe(true);
    });
  });
});
