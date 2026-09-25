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
const JIMUSHO_JS = [
  'js/kami-pdf.js',
  'js/kami-kumu.js',
  'js/kami-hyou.js',
  'js/kami-shukei.js',
  // ★2026-09-26 足した★ 絵にするのを やめて 本物の 字を 描く 1本
  'js/kami-egaku.js',
  // ★4repo と 同じバイトの 道具★（代行請求書・Rakually と 揃えた）
  'lib/font-slim.js',
  'lib/pdf-slim.js',
];

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

// ★覚書の 中の 字は 数えない★（説明に 書いた 名前で 赤に なる＝2026-09-25 に 踏んだ）
const oboeNuki = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

describe('★③紙の 部品は 借り物を 増やしていない★', () => {
  it('★CDN を 読んでいない（vendor だけ）★', () => {
    // ★2026-09-26 作り方を 変えた★＝html2canvas + jsPDF（絵）→ pdf-lib（本物の 字）
    //   司さん「なんで完成形があるのに確かめてやらんのど」
    const E = yomu('js/kami-egaku.js');
    expect(E, '★CDN から 読んでいます★（版が 勝手に 変わる）').not.toContain('https://cdn');
    [
      'vendor/pdf-lib.min.js',
      'vendor/fontkit.umd.min.js',
      'lib/font-slim.js',
      'lib/pdf-slim.js',
    ].forEach((f) => expect(E, '★' + f + ' を 読んでいません★').toContain(f));
    expect(yomu('js/kami-pdf.js'), '★CDN から 読んでいます★').not.toContain('https://cdn');
  });

  // ★★紙は 絵では なく 本物の 字★★ 2026-09-26（司さん 2026-09-05「全アプリ共通やろが」）
  //   ★実測（2026-09-25 絵だった頃）★ 1枚 224,518〜567,182B／日ごと 2枚で 1,134,363B
  //   ★直した後★ 1枚 78,974〜88,146B（9種とも 司さんの 線 200kB の 下）
  it('★★絵にして 貼る やり方に 戻っていない★★', () => {
    ['js/kami-egaku.js', 'js/kami-pdf.js'].forEach((f) => {
      const naka = oboeNuki(yomu(f));
      expect(naka, '★' + f + ' が html2canvas で 絵に しています★').not.toContain('html2canvas');
      expect(naka, '★' + f + ' が jsPDF を 使っています★').not.toMatch(/jspdf/i);
    });
  });

  it('★★軽くする 道具を 通している（生の 字体を 埋めない）★★', () => {
    const E = yomu('js/kami-egaku.js');
    expect(E, '★PdfSlim.build を 通していません★').toContain('PdfSlim.build');
    expect(oboeNuki(E), '★embedFont を 直に 呼んでいます★').not.toMatch(/\.embedFont\s*\(/);
  });

  it('★★font-slim を pdf-slim より 先に 読む★★', () => {
    // ★後だと 1枚目だけ 重い紙が 出る★（[[feedback_pdf_ni_jitai_wo_marugoto_umeruna]] の 落とし穴）
    const E = yomu('js/kami-egaku.js');
    const a = E.indexOf("'lib/font-slim.js'");
    const b = E.indexOf("'lib/pdf-slim.js'");
    expect(a >= 0 && b >= 0, '★どちらかを 読んでいません★').toBe(true);
    expect(a < b, '★pdf-slim の 方が 先に なっています★').toBe(true);
  });

  it('★★道具は 4repo と 同じバイト★★', () => {
    // ★正本の sha256（LF）★＝tests/pdf-font-weight.test.mjs と 同じ 数字
    const crypto = require('crypto');
    const sha = (f) =>
      crypto.createHash('sha256').update(yomu(f), 'utf8').digest('hex').slice(0, 16);
    expect(sha('lib/font-slim.js'), '★lib/font-slim.js が 正本と 違う★').toBe('26bd491a83818942');
    expect(sha('lib/pdf-slim.js'), '★lib/pdf-slim.js が 正本と 違う★').toBe('33e681caeb07b232');
  });

  it('★★window.print を 使っていない（司さん 2026-08-05 決定）★★', () => {
    // print だと ★紙の 下に URL・日付が 必ず 出て 消せない★
    // ★覚書は 数えない★＝説明に `window.print()` と 書いただけで 赤に なっていた
    //   （2026-09-25 実測・[[feedback_kazari_no_ji_ni_tayotta_mon_wa_wareru]] の 逆で、
    //     ★守りたいのは 呼んでいるか★。字が 在るかでは ない）
    ['js/kami-pdf.js', 'js/kami-kumu.js', 'js/kami-hyou.js', 'js/kami-egaku.js'].forEach((f) => {
      const naka = oboeNuki(yomu(f));
      expect(naka, '★' + f + ' が window.print を 呼んでいます★').not.toMatch(/\.print\s*\(/);
    });
  });
});
