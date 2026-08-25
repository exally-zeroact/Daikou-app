// ============================================================
// ★給料明細は 期の日を全部 見せる（スマホでも）★ 2026-08-25
//
//   ★司さん★「なんで2日分しか載せてないんど」
//     私が 2日分の作り物で見せたのが元。実物は 月3回払いで
//     ★1期＝10日 または 11日ぶん★（8/1〜8/10 / 8/11〜8/20 / 8/21〜8/31）。
//
//   ★倉庫の本物の行で実測（2026-08-25・375px）★
//     横に並べた表 … 715px ／ 入る箱 324px ＝ ★393px はみ出し★
//     ＝ スマホでは ★2日ぶんしか見えない★（横に振らないと読めない・振れる印も出ない）
//     売上の行も 車6台ぶん出るので さらに長い。
//
//   ★直した形★
//     ・★紙（PDF）は 今まで通り 横★＝実物の給料明細と同じ並び（1バイトも変えない）
//     ・★スマホの画面だけ 1日1行の縦★＝10日/11日 ぜんぶ見える・横にずれない
//     ・出し分けは CSS の @media だけ。★字の作り方は JS の1本（F）★＝二度書かない。
//     ・★スマホの一覧は 金額と時間だけ★（2026-08-25 司さん
//       「この一覧の所は 赤丸の部分除けて 金額と時間だけにして スマートにしろ」）
//       ＝売上・時間（全台）は ★紙（PDF）だけ★に出す。画面は ざっと見る所。
//     ・休んだ日は「—」（決まり「休んだ日は空欄です」を 縦でも守る）
//
//   ★直した後の実測★
//     375px … 日 10個 全部・横ずれ なし ／ 21〜末日（11日）でも 11個 全部
//     412px … 同じ ／ 1000px … 今まで通り 横・日 10個
//     PDFの窓 … 中に 横の表が在り 日 10個（紙は変わっていない）
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
// ★行末を そろえてから見る★
//   このrepoの手元は CRLF。'\n' で探すと ★在るのに無いと言う（嘘の赤）★（2026-08-25 実測）。
const HTML = fs.readFileSync(path.join(ROOT, 'kyuryo.html'), 'utf8').replace(/\r\n/g, '\n');

// そのCSSの決まり1つ分だけを取り出す（行の頭から探す＝中の同じ名前を掴まない）
function ruleOf(html, selector) {
  const i = html.indexOf('\n' + selector + ' {');
  if (i < 0) return null;
  const j = html.indexOf('}', i);
  return html.slice(i, j);
}
function mediaBlock(html, head) {
  const i = html.indexOf(head);
  if (i < 0) return null;
  // @media の中身（次の「      }」＝閉じるまで）
  const end = html.indexOf('\n      }\n', i);
  return end < 0 ? html.slice(i) : html.slice(i, end);
}

describe('★期の日を全部 見せる★', () => {
  it('横（紙）と 縦（スマホ画面）の 両方を出している', () => {
    expect(HTML, '★紙用の横が無い★').toContain('<div class="yoko scroller">');
    expect(HTML, '★スマホ用の縦が無い★').toContain("html += '<div class=\"tate\">'");
  });

  it('★どちらも 期の日を全部 まわしている★（一部だけ出していない）', () => {
    const i = HTML.indexOf('<div class="yoko scroller">');
    const j = HTML.indexOf("html += '</div>';", HTML.indexOf('<div class="tate">'));
    const block = HTML.slice(i, j);
    // 横の日付の見出し・縦の1日ずつ ＝ どちらも e.cells を全部まわす
    const n = (block.match(/e\.cells\.forEach/g) || []).length;
    expect(n, `★e.cells を全部まわしている所が ${n} か所しかない★`).toBeGreaterThanOrEqual(3);
    expect(block, '★日を切り落としている（slice）★').not.toMatch(/e\.cells\.slice\(/);
  });

  it('★字の作り方は 1本（F）★＝横と縦で 違う数が出ない', () => {
    expect(HTML, '★共通の作り方が無い★').toContain('var F = {');
    // 中身の取り出しを 2度 書いていない（書くと 横と縦で ずれる）
    for (const key of ['c.pay === null', 'c.hours === null', 'c.poolHours === null']) {
      const n = (HTML.match(new RegExp(key.replace(/\./g, '\\.'), 'g')) || []).length;
      expect(n, `★"${key}" を ${n} か所で書いている（1か所にする）★`).toBe(1);
    }
  });

  it('★紙は いつも 横★（実物の給料明細と同じ並び・縦は紙に出さない）', () => {
    const pr = mediaBlock(HTML, '@media print {');
    expect(pr, '★紙の決まりが無い★').toBeTruthy();
    expect(pr, '★紙で 横が出るようにしていない★').toMatch(/\.slip \.yoko \{\s*display: block !important;/);
    expect(pr, '★紙に 縦まで出る★').toMatch(/\.slip \.tate \{\s*display: none !important;/);
  });

  it('★狭い画面だけ 縦にする★（パソコンは今まで通り 横）', () => {
    const tate = ruleOf(HTML, '      .slip .tate');
    expect(tate, '★.slip .tate が無い★').toBeTruthy();
    expect(tate, '★既定で 縦が出てしまう（パソコンで2つ出る）★').toContain('display: none');
    const nb = mediaBlock(HTML, '@media (max-width: 480px) {\n        .slip .yoko');
    expect(nb, '★狭い画面の決まりが無い★').toBeTruthy();
    expect(nb, '★狭い画面で 横を隠していない★').toMatch(/\.slip \.yoko \{\s*display: none;/);
    expect(nb, '★狭い画面で 縦を出していない★').toMatch(/\.slip \.tate \{\s*display: block;/);
  });

  it('★スマホの一覧は 金額と時間だけ★（2026-08-25 司さん）', () => {
    // 司さん「この一覧の所は 赤丸の部分除けて 金額と時間だけにして スマートにしろ」
    //   はじめは 縦にも 売上と 時間（全台）を出していた。
    //   ⇒ ★画面は ざっと見る所・紙が 渡す物★ と決めて 縦から外した。
    //   ★紙（横）には 今までどおり 売上も 時間（全台）も 出る★（下の試験で見張る）
    const i = HTML.indexOf("html += '<div class=\"tate\">'");
    const block = HTML.slice(i, HTML.indexOf("html += '</div>';", i));
    expect(block, '★一覧に 売上が戻っている★').not.toContain('売上　');
    expect(block, '★一覧に 時間（全台）が戻っている★').not.toContain('時間（全台）　');
    expect(block, '★金額が無い★').toContain("'<span>¥' + pay + '</span>");
    expect(block, '★時間が無い★').toContain("+ hh + ' 時間</span>'");
  });

  it('★紙には 売上も 時間（全台）も 出る★（消したのは 画面の一覧だけ）', () => {
    const i = HTML.indexOf('<div class="yoko scroller">');
    const block = HTML.slice(i, HTML.indexOf("html += '<div class=\"tate\">'", i));
    expect(block, '★紙から 売上まで消えた★').toContain("'売上' + (n + 1)");
    expect(block, '★紙から 時間（全台）が消えた★').toContain("row('時間（全台）', F.pool)");
  });

  it('★休んだ日も 日付は出す（中身は「—」）★', () => {
    const i = HTML.indexOf("html += '<div class=\"tate\">'");
    const block = HTML.slice(i, i + 1600);
    expect(block, '★休んだ日の見分けが無い★').toContain('var yasumi =');
    expect(block, '★休んだ日に 何も出ない（日付ごと消える）★').toContain('class="dn">—');
  });
});

describe('★余白は 字の大きさを ものさしにする★', () => {
  // 司さん「もう少し上に余白作ってバランス考えろ
  //         売上が1.2.3.4と増えても 自動で余白のバランス考えろ」
  //   px で決め打ちにすると 行が増えた時／字を大きくした時に 詰まって見える。
  //   ★em（字の大きさ）で決める★＝中身が増えても 間の取り方は変わらない。
  //   実測（2026-08-25）… 売上6行の紙 と 売上1行の紙 で
  //     箱の上→題 28px ／ 見出し→表 18px ／ 表→箱の下 25px ＝★どちらも同じ★
  it('明細の箱の余白が em（px の決め打ちでない）', () => {
    const css = ruleOf(HTML, '      .slip');
    expect(css, '★.slip が無い★').toBeTruthy();
    expect(css, '★余白が px の決め打ちに戻っている★').toMatch(/padding:[^;]*em/);
  });

  it('見出しと表の間も em', () => {
    const css = ruleOf(HTML, '      .slip .shead');
    expect(css, '★見出しの下の間が px の決め打ちに戻っている★').toMatch(/margin-bottom:[^;]*em/);
  });

  it('★紙の一番上にも 余白が在る★（司さん「上に余白ってゆわんかったか？」）', () => {
    // ★1度目は 箱の中しか広げていなかった★＝紙の頭は 詰まったままだった。
    //   実測（1000px）… 直す前 紙の頭→字 50px ／ 直した後 ★83px★（箱の上まで 54px）
    //   ★本体の画面は 1文字も変えない★（22px のまま）ので 紙の窓だけに 印を付ける。
    expect(HTML, '★紙の窓に 目印が無い（本体の画面まで変わる）★').toContain(
      '<body class="paper">'
    );
    const i = HTML.indexOf('\n      .paper .wrap {');
    expect(i, '★紙の窓の 上の余白が無い★').toBeGreaterThan(-1);
    const css = HTML.slice(i, HTML.indexOf('}', i));
    expect(css, '★上の余白が em になっていない★').toMatch(/padding-top:[^;]*em/);
    // 刷る時（本物の紙）にも 上の余白
    const pr = HTML.slice(HTML.indexOf('@media print {'));
    const j = pr.indexOf('.paper .wrap {');
    expect(j, '★刷る時に 上の余白が無い★').toBeGreaterThan(-1);
    expect(pr.slice(j, pr.indexOf('}', j)), '★刷る時の余白が em でない★').toMatch(
      /padding-top:[^;]*em/
    );
  });

  it('★本体の画面の上は 変えない★（紙の窓だけ）', () => {
    const i = HTML.indexOf('\n      .wrap {');
    const css = HTML.slice(i, HTML.indexOf('}', i));
    expect(css, '★本体の画面の上の余白まで 変えている★').toContain('padding: 22px 18px 60px');
  });

  it('★箱の中にも 上の余白が在る★（今までは 上0＝いきなり字が始まっていた）', () => {
    const pr = HTML.slice(HTML.indexOf('@media print {'));
    const i = pr.indexOf('.slip {');
    const css = pr.slice(i, pr.indexOf('}', i));
    expect(css, '★紙の余白が 無い/px の決め打ち★').toMatch(/padding:[^;]*em/);
    expect(css, '★紙の上の余白が 0 に戻っている★').not.toMatch(/padding:\s*0\s/);
  });
});
