// ============================================================
// ★狭い画面で 押す物の字が1文字ずつ縦に割れていない★ 2026-08-25
//
//   ★実際に見た事（Playwright で 375px を実測）★
//     給料   「‹ 前の月」  45 x 102  ＝ ★4行に割れていた★
//     売上表 「‹ 前の月」  62 x  58  ＝ 2行
//     月次   「‹ 前の年」  72 x  58  ＝ 2行
//     上の札 「給料」     110 x  51  ＝ 2行（給／料 が縦に割れる）
//     ※1行なら 押す物は 約36px・札は 約22px
//
//   ★なぜ起きるか★
//     flex は ★押す物から先に縮める★。真ん中の「月の字」の箱が min-width で
//     場所を先に取っていたので、押す物だけが 幅ゼロ近くまで潰されていた。
//     ★DOMに在る ≠ 読める★（この形は 過去に2回 踏んでいる）
//
//   ★直したあと（同じ所を実測）★
//     「‹ 前の月」 83 x 36（1行）／「給料」 44 x 22（1行）／横のはみ出し なし
//
//   ★この試験がする事★
//     幅と高さは 画面が要る（試験では測れない）ので、
//     ★二度と同じ形に戻らない★ 決まりが CSS に残っているかを見る。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// 月（年）を送る帯が在る画面
const BAR_PAGES = ['kyuryo.html', 'uriage.html', 'shukei.html'];
// 上に「ダイコメ ○○」の札が在る画面
const TAG_PAGES = ['kyuryo.html', 'uriage.html', 'shukei.html', 'dashboard.html'];

function read(f) {
  return fs.readFileSync(path.join(ROOT, f), 'utf8');
}
// そのCSSの決まり1つ分だけを取り出す（他の所の字を数えて緑にしない）
//   ★行の頭から探す★：「      .navb {」は「        .navb {」（狭い画面の中の同じ名前）の
//   一部でもあるので、頭を見ないと ★中の物を掴んで 嘘の赤★ になる（2026-08-25 実測）。
function ruleOf(html, selector) {
  const i = html.indexOf('\n' + selector + ' {');
  if (i < 0) return null;
  const j = html.indexOf('}', i);
  return html.slice(i, j);
}

describe('★狭い画面で 字が縦に割れない★', () => {
  it.each(BAR_PAGES)('%s … 押す物の字は 折り返さない・押す物は縮めない', (f) => {
    const html = read(f);
    const navb = ruleOf(html, '      .navb');
    expect(navb, `★${f} に .navb が無い★`).toBeTruthy();
    expect(navb, `★${f}：押す物の字が 1文字ずつ縦に割れます★`).toContain('white-space: nowrap');
    expect(navb, `★${f}：押す物が 縮められます★`).toContain('flex: 0 0 auto');
  });

  it.each(BAR_PAGES)('%s … 真ん中の字が 場所を先に取らない（min-width で押し出さない）', (f) => {
    const html = read(f);
    const m = ruleOf(html, '      .monthbar .m');
    expect(m, `★${f} に .monthbar .m が無い★`).toBeTruthy();
    // ★min-width: ○em に戻すと 押す物が また潰れる★
    expect(m, `★${f}：min-width で 押す物を潰す形に戻っています★`).not.toMatch(
      /min-width:\s*\d+(\.\d+)?em/
    );
    expect(m, `★${f}：縮んでよい形になっていません★`).toMatch(/flex:\s*0 1 \d+(\.\d+)?em/);
  });

  it.each(BAR_PAGES)('%s … 狭い画面の決まりが在る（月の字を上の行へ落とす）', (f) => {
    const html = read(f);
    const i = html.indexOf('@media (max-width: 480px)');
    expect(i, `★${f}：狭い画面の決まりが無い★`).toBeGreaterThan(-1);
    const block = html.slice(i, i + 400);
    expect(block, `★${f}：折り返していない★`).toContain('flex-wrap: wrap');
    expect(block, `★${f}：月の字を上の行へ落としていない★`).toContain('order: -1');
  });

  it.each(TAG_PAGES)('%s … 上の札（給料／売上表…）の字が 縦に割れない', (f) => {
    const tag = ruleOf(read(f), '      .top .tag');
    expect(tag, `★${f} に .top .tag が無い★`).toBeTruthy();
    expect(tag, `★${f}：札の字が 1文字ずつ縦に割れます★`).toContain('white-space: nowrap');
  });

  it.each(BAR_PAGES)('%s … 上の帯は 狭い時 上下に分かれる（名前と行き先が押し合わない）', (f) => {
    const top = ruleOf(read(f), '      .top');
    expect(top, `★${f} に .top が無い★`).toBeTruthy();
    expect(top, `★${f}：名前と行き先ボタンが 押し合って字が割れます★`).toContain(
      'flex-wrap: wrap'
    );
  });
});
