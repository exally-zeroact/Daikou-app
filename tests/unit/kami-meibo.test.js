'use strict';
// ============================================================
// ★★新しい js は ★2つの 名簿★ に 足す★★ 2026-09-25
//
//   ★①sw.js の 先取り名簿★
//     忘れると「オンラインだけ 動く」★偽の 緑★に なり、版が 上がった 日に 現場が 止まる。
//     （[[feedback_sw_sakidori_meibo_ni_tasu]]）
//   ★②事務所の 中継の 名簿（office-host/vercel.json）★
//     事務所（daikome-jimusho.vercel.app）は ★決められた 道だけ★ 中継する。
//     足さないと ★事務所の 画面から 404★ に なる。
//     ★この 名簿は 2つの repo に 在る★（Daikou-app と daikome-jimusho-host）
//     ＝[[feedback_mihon_no_michi_ga_futatsu_aru_toki_katahou_dake_naosu_na]]
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-25 実測）★★
//     ①sw.js から kami-hyou.js を 消す ……… ★赤★
//     ②vercel.json から kami-kumu.js を 消す … ★赤★
// ============================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const yomu = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

// ★事務所の 5枚が 読む js＝この一覧★（増やしたら ここにも 足す）
const JIMUSHO_JS = ['js/kami-pdf.js', 'js/kami-kumu.js', 'js/kami-hyou.js', 'js/kami-shukei.js'];

describe('★①sw.js の 先取り名簿★', () => {
  const SW = yomu('sw.js');
  JIMUSHO_JS.forEach((f) => {
    it('★' + f + ' が 名簿に 在る★', () => {
      expect(
        SW.indexOf("'/" + f + "'") >= 0,
        '★sw.js の 先取り名簿に ' +
          f +
          ' が ありません★\n' +
          '  ＝オンラインでは 動くのに ★版が 上がった 日に オフラインで 落ちます★'
      ).toBe(true);
    });
  });
});

// ★★②事務所の 中継の 名簿＝★ここには 書かない★★★（2026-09-25 に 一度 間違えた）
//   ★Daikou-app/office-host/vercel.json は 使われていない 写し★。
//   本物は ★別repo daikome-jimusho-host / -test★（2026-08-31 に 分けた）。
//   ⇒ 写しを 直しても ★本番は 404★（2026-09-05 に 2回 やっている）
//   ⇒ ★事務所の 画面に 繋ぐ 回に 本物の repo へ 足し、実配信を 叩いて 200 を 数える★
//   詳しく＝[[feedback_jimusho_no_haishin_wa_betsu_repo]]
//
//   ★今は まだ どの 画面も この js を 読んでいない★ので 名簿には 足さない。
//   （既に 在る 見張り tests/unit/office-allow-list.test.js が
//     「HTMLが 読む js だけ 名簿に 載せる」を 縛っている＝先に 足したら 赤に なった）

describe('★③紙の 部品は 借り物を 増やしていない★', () => {
  it('★CDN を 読んでいない（vendor だけ）★', () => {
    const P = yomu('js/kami-pdf.js');
    expect(P, '★CDN から 読んでいます★（版が 勝手に 変わる）').not.toContain('https://cdn');
    expect(P).toContain('vendor/html2canvas.min.js');
    expect(P).toContain('vendor/jspdf.umd.min.js');
  });

  it('★★window.print を 使っていない（司さん 2026-08-05 決定）★★', () => {
    // print だと ★紙の 下に URL・日付が 必ず 出て 消せない★
    // ★覚書は 数えない★＝説明に `window.print()` と 書いただけで 赤に なっていた
    //   （2026-09-25 実測・[[feedback_kazari_no_ji_ni_tayotta_mon_wa_wareru]] の 逆で、
    //     ★守りたいのは 呼んでいるか★。字が 在るかでは ない）
    const oboeNuki = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    ['js/kami-pdf.js', 'js/kami-kumu.js', 'js/kami-hyou.js'].forEach((f) => {
      const naka = oboeNuki(yomu(f));
      expect(naka, '★' + f + ' が window.print を 呼んでいます★').not.toMatch(/\.print\s*\(/);
    });
  });
});
