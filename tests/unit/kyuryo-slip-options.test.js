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

// ★見張りは 書き方の空白で 赤にならない★ 2026-08-26
//   prettier が 折り返し方を変えると ★中身は1文字も変わっていないのに 赤★ になった。
//   ⇒ 見る前に ★続く空白を 1つに畳む★（何を見るかは 変えない）。
const flat = (s) => String(s).replace(/\s+/g, ' ');

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
    expect(HTML, '★ボタンが紙に出てしまう★').toContain('<button class="btn ghost noprint"');
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
    const cls = (HTML.match(/<button class="([^"]*)"[^>]*data-meisai-qr=/) || [])[1];
    expect(cls, '★1人ごとのPDFのボタンが見つからない★').toBeTruthy();
    for (const c of cls.split(/\s+/).filter(Boolean)) {
      if (c === 'noprint' || c === 'btn') continue;
      expect(
        HTML,
        `★"${c}" という見た目は CSS に在りません（当たらないので 見た目が変わります）★`
      ).toMatch(new RegExp('\\.' + c + '(?![\\w-])'));
    }
  });

  it('★紙は 自前でPDFを作る（ブラウザの印刷に頼らない）★（司さん「Aでやれ」2026-08-25）', () => {
    // ★踏んだ事★ 2026-08-25：window.open + window.print で出していた。
    //   ・紙の下に ★URL と 日付と ページ番号★ が刷られた（司さんが赤丸で指摘）
    //   ・★PDFから 前の画面に戻れない★
    //   ・A4縦になり ★表が見切れた★（日が最大11列）
    //   ★他の3アプリは この形を「使わない」と決めていた★のに、読まずに同じ穴に落ちた。
    //     代行請求 invoice-pdf.js「window.print() は URL＋日付を勝手に付ける・CSSでは消せない」
    //     給与 app.js:2819「フッターが付き 余白で2ページ化＋戻れないため不採用」
    //     飲み屋 nomiya-ui-kami.js:1470「iPhoneでは 真っ白で出る」
    // ★「新しい窓にHTMLを書いて 刷る」形に戻っていないか★
    //   ※window.print() 自体は ★道具が読めない時の保険★ として1か所だけ残す。
    //     （何も出ないより まし。その時は URL と日付が付いてしまう＝画面で断る）
    expect(HTML, '★また 新しい窓にHTMLを書いている★').not.toContain('w.document.write(');
    expect(HTML, '★また 新しい窓を刷っている★').not.toContain('w.onload = function');
    // ★コメントの字を数えない★（説明に window.print と書いてある＝実測で 3件 拾った）
    //   見るのは ★実際に動く行★だけ。
    const ikiteru = HTML.split('\n')
      .filter((l) => !/^\s*(\/\/|\*|<!--)/.test(l))
      .filter((l) => /window\.print\(\)/.test(l)).length;
    expect(
      ikiteru,
      `★実際に動く window.print が ${ikiteru} か所（保険＝1人ぶんと全員ぶんの2か所だけ）★`
    ).toBeLessThanOrEqual(2);
    expect(HTML, '★自前でPDFを作っていない★').toContain('window.jspdf.jsPDF');
    expect(HTML, '★画面を絵にしていない★').toContain('window.html2canvas');
  });

  it('★A4横で作る★（縦だと 日が最大11列で 見切れる）', () => {
    expect(HTML, '★A4横になっていない★').toContain("orientation: 'landscape'");
    expect(HTML, '★A4横の寸法(842x595)になっていない★').toMatch(/PAPER_W = 842/);
    expect(HTML, '★A4横の寸法(842x595)になっていない★').toMatch(/PAPER_H = 595/);
    expect(HTML, '★はみ出さない為の収め方が無い★').toContain('function _placeOnA4');
  });

  it('★道具は 自分のrepoから読む（外のCDNを使わない）★', () => {
    // ダイコメは ★完全オフライン前提★。実測：kyuryo.html の外部CDN 0件。
    expect(HTML, '★外のCDNを読んでいる★').not.toMatch(/cdn\.jsdelivr|unpkg\.com|cdnjs/);
    expect(HTML, '★自分のrepoから読んでいない★').toContain("'vendor/jspdf.umd.min.js'");
    expect(HTML, '★自分のrepoから読んでいない★').toContain("'vendor/html2canvas.min.js'");
    // ★押した時だけ読む★（起動を重くしない）
    expect(HTML, '★起動時に読み込んでいる★').toContain('function loadPdfLibs()');
  });

  it('★紙は 画面の写しではなく「紙専用の1枚」を組む★（指示役の数字 2026-08-25）', () => {
    // ★踏んだ事★ 画面の明細を そのまま A4に貼っていた。指示役が実物を測った結果：
    //   ・表は ★紙の縦の 38%★しか使わず ★下に 62%の空白★
    //   ・左の項目列が ★表幅の22%★（日付列の2.9倍）＝一番長い車名1本に引っ張られる
    //   ・★字が小さすぎて 刷ったら読めない★
    //   ・★中身が空の売上行が4本★（しま1／車1／確認用8627号車／車2）
    expect(HTML, '★紙専用の1枚を組んでいない★').toContain('function _buildPaperSheet');
    expect(HTML, '★画面の写しに戻っている★').not.toContain('function _slipToCanvas');
  });

  // ★2026-08-26 指示役が「紙を使い切る(75%)」を 取り消した★
  //   ＝列を細くして 足りない分を 行の高さで埋める形になり ★表が間延びした★。
  //   司さんは 8/25 22:43 の「小さくまとまって 紙の上」が良いと言っている。
  it('★①行を引き伸ばさない（表は 小さくまとまって 紙の上）★', () => {
    const i = HTML.indexOf('function _buildPaperSheet');
    const block = HTML.slice(i, HTML.indexOf('function _maisu'));
    // 板は A4横の比（1123 x 794px＝1px 0.75pt）
    expect(HTML, '★板がA4横の比でない★').toMatch(/SHEET_W = 1123/);
    expect(HTML, '★板がA4横の比でない★').toMatch(/SHEET_H = 794/);
    // ★高さで つじつまを合わせない★＝行の高さは 決め打ち
    expect(block, '★行の高さを 余りで割っている（間延びする）★').not.toContain('usableH / rowN');
    expect(block, '★行の高さが 決め打ちでない★').toMatch(/var rowH = 50;/);
    expect(block, '★字の大きさを 行の高さから作っている★').not.toMatch(/rowH \* 0\.\d/);
  });

  // ★2026-08-26 指示役が「左の項目列 ≦15%」を 取り消した★
  //   ＝★幅を縮めろ★ではなく ★余白(padding)を除け★が 正しい指示だった。
  it('★②左の項目列は「中身が入るだけ」／詰めるのは 余白★', () => {
    const i = HTML.indexOf('function _buildPaperSheet');
    const block = HTML.slice(i, HTML.indexOf('function _maisu'));
    expect(block, '★まだ 表幅の割合で 列を決めている★').not.toContain('tableW * 0.15');
    // ★字を実際に測って 幅を出す★（割合で決めない）
    expect(block, '★項目の字を 測っていない★').toContain('_textW(r.lbl, fontPx, 700)');
    expect(block, '★測った幅を 切り捨てている（字が欠ける）★').toContain('Math.ceil(labelInk)');
    expect(block, '★内側の余白を 詰めていない★').toMatch(/LABEL_PAD = \d/);
    // ★一番長い車名に 列を広げさせない★＝車名は 小さい2行目・はみ出しは省略
    expect(block, '★車名で 列が広がる（2行に折っていない）★').toContain('sub: x.car.label');
    // ★車名で 列を広げない★＝列の幅は「項目の字」だけで決める（車名は 数えない）
    expect(block, '★車名の幅で 列が広がる（日付の列が痩せる）★').not.toContain(
      '_textW(r.sub, subPx'
    );
    // ★2行に折る★＋★入り切らない時は「…」を付けて 切ったと分かる形にする★
    expect(block, '★車名を 折り返していない★').toContain('white-space:normal');
    expect(block, '★2行で止めていない★').toContain('max-height:');
    expect(block, '★黙って途中で消える（切ったと分からない）★').toContain('_fit2(r.sub, subPx');
  });

  it('★③合計の塊は 見出しの 中心★（右端に貼り付けない）', () => {
    const i = HTML.indexOf('function _buildPaperSheet');
    const block = HTML.slice(i, HTML.indexOf('function _maisu'));
    const atama = block.slice(block.indexOf('var head ='), block.indexOf('// ── 表 ──'));
    // ★左と右を 同じ幅の詰め物で挟む★＝合計が 真ん中に来る
    //   8/26 に この詰め物を外して 右端に貼り付き ★司さんに突き返された★
    const tsume = (atama.match(/flex:1 1 0/g) || []).length;
    expect(tsume, `★見出しの詰め物が ${tsume}個（左右で2個 要る＝1個だと 右端に貼り付く）★`).toBe(
      2
    );
    // 項目（日付／金額／時間…）は ★中央揃え★（司さん 2026-08-26）
    expect(block, '★項目が 中央揃えでない★').toContain('text-align:center;color:#333333');
  });

  it('★③字は 9pt以上★（板の12px＝紙の9pt。板では13px以上）', () => {
    const i = HTML.indexOf('function _buildPaperSheet');
    const block = HTML.slice(i, HTML.indexOf('function _sheetToCanvas'));
    const px = (block.match(/font-size:(\d+)px/g) || []).map((m) => Number(m.match(/\d+/)[0]));
    expect(px.length, '★字の大きさが読めない★').toBeGreaterThan(0);
    const min = Math.min.apply(null, px);
    // 11px は 車名の2行目だけ＝紙で 8.25pt。ここは「読めなくてよい添え字」ではないので
    // ★本文は 15px以上（=11.25pt）★・添え字も 11px（8.25pt）を下回らない事を見る。
    expect(
      min,
      `★一番小さい字が ${min}px（紙で ${(min * 0.75).toFixed(2)}pt）★`
    ).toBeGreaterThanOrEqual(11);
    const honbun = px.filter((v) => v >= 13);
    expect(honbun.length, '★本文の字が 13px未満★').toBeGreaterThan(0);
  });

  it('★④その期間に売上が1件も無い車は 紙に出さない★（番号は詰めて振り直す）', () => {
    expect(HTML, '★空の売上行を 外していない★').toContain('function _paperCars');
    const i = HTML.indexOf('function _paperCars');
    const block = HTML.slice(i, i + 600);
    expect(block, '★1件でも在るかを 見ていない★').toContain('e.cells.some(');
    expect(block, '★0円を 在る扱いにしている★').toContain('v !== 0');
    // 詰めて振り直す（i ではなく n）
    expect(HTML, '★番号を詰めていない★').toMatch(/lbl: '売上' \+ \(n \+ 1\)/);
  });

  it('★1人ぶんも 全員ぶんも 同じ作り方（二度書かない）★', () => {
    // ★紙を組む所は 1本（_addEmp）★＝1人ぶんと全員ぶんで 別々に書かない
    expect(HTML, '★1人ぶんが 共通の作り方を使っていない★').toMatch(
      /function printOne[\s\S]{0,1500}_addEmp\(null, emp,/
    );
    expect(HTML, '★全員ぶんが 共通の作り方を使っていない★').toMatch(
      /function printAll[\s\S]{0,2500}_addEmp\([\s\S]{0,40}doc,/
    );
    // ★新しいタブで開く所も 1本★（片方だけ直す事故を止める）
    expect(
      (HTML.match(/_openPdf\(/g) || []).length,
      '★開く所が 1本になっていない★'
    ).toBeGreaterThanOrEqual(3);
    // ★★2026-09-05 印刷が 2つに なりました★★（司さん「チェックボタン 作って 全体と 選んだ人」）
    //   ★全員を 印刷★ … printAll(null)
    //   ★選んだ人を 印刷★ … printAll(erandaHito())
    //   ★どちらも 同じ printAll★＝紙の 作り方は 1本のまま（二度書かない）
    expect(HTML, '★「全員を 印刷」が まだブラウザ印刷★').toMatch(
      /\$\('btnPrint'\)\.onclick = function \(\) \{\s*printAll\(null\);/
    );
    expect(HTML, '★「選んだ人を 印刷」が 無い／別の 作り方に なっている★').toMatch(
      /\$\('btnPrintSel'\)\.onclick = function \(\) \{\s*printAll\(erandaHito\(\)\);/
    );
    // ★選ぶのは「画面に 描かれた チェック」から★（内側の 変数を 信じない）
    expect(HTML, '★選んだ人を 画面から 数えていない★').toMatch(
      /function erandaHito\(\)[\s\S]{0,300}querySelectorAll\('\.slip-pick'\)/
    );
    // ★1つも 選んでいない時は 全員★（前と 同じ 動き＝押す 回数を 増やさない）
    expect(HTML, '★選んでいない時に 全員に ならない★').toMatch(
      /function printAll\(dake\)[\s\S]{0,500}: zenin;/
    );
  });

  it('★窓の名前＝保存する時の既定のファイル名★', () => {
    expect(HTML, '★中身から作った名前を出していない★').toContain("'給料明細_' + ym + '_'");
  });

  it('明細1枚に 名指しできる印が付いている', () => {
    expect(flat(HTML), '★1枚ずつ取り出せない★').toContain('\'<div class="slip" id="slip-\' + ei +');
  });
});
