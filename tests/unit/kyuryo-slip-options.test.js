// ============================================================
// ★給料明細の2つ（司さん 2026-08-25）★
//   ①「給料は1人ごとにPDFとして送るようにする」
//   ②「売り上げ（車ごと）を載せないような選べるようにする＋決めるところ」
//
//   ★決め方★
//     ・決めるのは ★社長・会社ごと★（dk_payroll_settings に持つ＝新しい棚を作らない）
//     ・★既定は 載せる＝今までと同じ見た目★（入れた瞬間に誰の画面も変わらない）
//     ・載せるかどうかの判定は ★1か所★（showCarSalesNow）＝設定と画面が食い違わない
//   ★1人ごとのPDF★
//     ・★紙だけの新しい窓で刷る★（本体の画面を汚さない＝全アプリの決まり）
//     ・★窓の名前＝保存する時の既定のファイル名★「給料明細_2026-08_◯◯」
//     ・その窓の中のボタンは noprint なので 紙には出ない
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'kyuryo.html'), 'utf8');

describe('★②車ごとの売上を 載せる/載せない★', () => {
  it('設定の画面に 決めるところが在る', () => {
    expect(HTML, '★決めるところが無い★').toContain('id="showCarSales"');
    expect(HTML, '★何のチェックか 人に分からない★').toContain('給料明細に 車ごとの売上を載せる');
  });

  it('保存すると 倉庫のその列に入る（新しい棚を作っていない）', () => {
    expect(HTML, '★保存していない★').toContain('show_car_sales:');
    expect(HTML, '★給料の設定の棚に入れていない★').toContain('dk_payroll_settings');
  });

  it('★既定は 載せる（倉庫にまだ列が無い会社も 今までと同じ見た目）★', () => {
    // 「false の時だけ 載せない」と書いてある事を見る
    expect(HTML, '★既定が 載せない側になっている★').toContain('show_car_sales === false');
  });

  it('★載せるかどうかの判定は 1か所★（設定と画面が食い違わない）', () => {
    expect(HTML).toContain('function showCarSalesNow()');
    const n = (HTML.match(/show_car_sales === false/g) || []).length;
    expect(n, `★同じ判定を ${n} か所で書いている★`).toBe(2); // 書き戻し1・判定1
  });

  it('明細の「売上◯」の行が その旗で出し分けられている', () => {
    const i = HTML.indexOf('if (SHOW_CAR_SALES) {');
    expect(i, '★出し分けていない★').toBeGreaterThan(-1);
    const block = HTML.slice(i, i + 500);
    // 2026-08-25：1台ずつ 出す/出さない を足したので 番号は
    // ★出す車だけで振り直す★（i ではなく n）＝売上2・売上3 が抜けない。
    expect(block, '★売上の行が中に入っていない★').toContain("'売上' + (n + 1)");
  });

  it('★「時間（全台）」は そのまま出す★（司さんが言ったのは 売上だけ）', () => {
    const i = HTML.indexOf('if (SHOW_CAR_SALES) {');
    const j = HTML.indexOf('時間（全台）', i);
    const block = HTML.slice(i, j);
    // 旗の中括弧が 時間（全台）より前に閉じている＝時間は外に在る
    expect(block, '★時間（全台）まで消している★').toContain('}');
  });
});

describe('★①1人ごとにPDF★', () => {
  it('明細1枚ごとに ボタンが在る', () => {
    expect(HTML, '★ボタンが無い★').toContain('この人のPDF');
    expect(HTML, '★誰の分か 渡していない★').toContain('printOne(');
  });

  it('★紙には出さない（noprint）★', () => {
    // ★「この人のPDF」は 説明のコメントにも出てくる★ ので、
    //   ボタンの字そのものを見る（コメントを数えて 緑にしない）。
    expect(HTML, '★ボタンが紙に出てしまう★').toContain(
      '<button class="btn ghost noprint"'
    );
  });

  it('★付けた見た目の名前が CSS に本当に在る★（2026-08-25 実測で踏んだ）', () => {
    // ★踏んだ事★ 2026-08-25：`btn-ghost` と書いたが この画面の CSS は `.btn.ghost`。
    //   ＝名前が無いので 見た目は当たらず ★真っ青な大きいボタン★ が明細ごとに並んだ。
    //   それでも「その字が在るか」だけを見ていた この試験は ★緑のまま★ だった。
    //   ⇒ 字が在るかではなく ★その名前が CSS に在るか★ を見る。
    // ★見た目の細かい所（style）に ぶら下がらない★
    //   2026-08-25：ボタンを右の箱へ移した時に inline の style を外したら、
    //   この試験だけ「ボタンが見つからない」と ★嘘の赤★ を出した。
    //   見たいのは ★class の中身★なので、押した先（printOne）で探す。
    const cls = (HTML.match(/<button class="([^"]*)"[^>]*onclick="printOne\(/) || [])[1];
    expect(cls, '★1人ごとのPDFのボタンが見つからない★').toBeTruthy();
    for (const c of cls.split(/\s+/).filter(Boolean)) {
      if (c === 'noprint' || c === 'btn') continue;
      expect(HTML, `★"${c}" という見た目は CSS に在りません（当たらないので 見た目が変わります）★`)
        .toMatch(new RegExp('\\.' + c + '(?![\\w-])'));
    }
  });

  it('★紙だけの窓に 押す物を持ち込まない★（2026-08-25 実測で踏んだ）', () => {
    // ★踏んだ事★ noprint は「紙に出ない」だけ。★その窓の画面には ボタンが残って見えていた★。
    //   そこで押しても printOne は居ないので 何も起きない＝押せる見た目の飾りになる。
    expect(HTML, '★写しを取っていない（本体の画面から消してしまう）★').toContain(
      'box.cloneNode(true)'
    );
    expect(HTML, '★押す物を取り除いていない★').toContain("clone.querySelectorAll('.noprint')");
    expect(HTML, '★取り除く前の物を そのまま書き出している★').not.toContain('box.outerHTML');
    expect(HTML, '★写しを書き出していない★').toContain('clone.outerHTML');
  });

  it('★紙だけの新しい窓で刷る（本体の画面を汚さない）★', () => {
    expect(HTML, '★新しい窓を開いていない★').toContain("window.open('', '_blank')");
    expect(HTML, '★刷っていない★').toContain('w.print()');
  });

  it('★窓の名前＝保存する時の既定のファイル名★', () => {
    expect(HTML, '★中身から作った名前を出していない★').toContain("'給料明細_' + ym + '_'");
  });

  it('明細1枚に 名指しできる印が付いている', () => {
    expect(HTML, '★1枚ずつ取り出せない★').toContain("'<div class=\"slip\" id=\"slip-' + ei +");
  });
});
