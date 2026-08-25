// ============================================================
// ★車を1台ずつ 給料明細に出す/出さない★ 2026-08-25
//
//   ★司さん★
//     「売上1.2.3.4と続くが 設定で見せる見せないは選べるよな？」
//     「ついでに個別で見せる見せないも選べたら最高」
//   ＝それまでは ★まとめて載せる/載せない の1つだけ★だった。1台ずつを足す。
//
//   ★決め方★
//     ・持ち場は ★車の棚（dk_device_labels.show_in_slip）★＝新しい棚を作らない
//     ・決めるのは「車の名前と並び」の表（名前・並びと同じ場所で1台ずつ）
//     ・★決めていなければ 出す★＝今までと同じ見た目
//     ・★給料明細だけ★の決まり（売上表・月次集計は今までどおり）
//
//   ★番号は 出す車だけで振り直す★
//     倉庫の実物で確認（2026-08-25）：車6台のうち 1号車と2号車だけ出すと
//       前 … 売上1（1号車）9,800/11,200 ／ 売上4（2号車）7,400
//       後 … 売上1（1号車）9,800/11,200 ／ 売上2（2号車）7,400
//     ＝★間が抜けず・数字も取り違えない★（元の並びの何番目かを 一緒に持っている）
//
//   ★合計を大きく★（司さん「給料明細なんやけん 赤丸の所は 大きく 見やすく 目立つように」）
//     実測：金額 26px・薄い枠の箱 274 x 60（375px）／紙にも そのまま出る
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
// ★行末をそろえてから見る★（手元は CRLF。'\n' で探すと 在るのに無いと言う）
const HTML = fs.readFileSync(path.join(ROOT, 'kyuryo.html'), 'utf8').replace(/\r\n/g, '\n');
const SQL = fs.readFileSync(path.join(ROOT, 'supabase', 'apply-car-show-in-slip.sql'), 'utf8');

function ruleOf(html, selector) {
  const i = html.indexOf('\n' + selector + ' {');
  if (i < 0) return null;
  const j = html.indexOf('}', i);
  return html.slice(i, j);
}

describe('★車を1台ずつ 明細に出す/出さない★', () => {
  it('倉庫は 車の棚に列を1本 足すだけ（新しい棚を作らない）', () => {
    expect(SQL, '★車の棚ではない所に作っている★').toContain('alter table daikome.dk_device_labels');
    expect(SQL, '★列の名前が違う★').toContain('add column if not exists show_in_slip boolean');
    expect(SQL, '★既定が「出さない」になっている（入れた瞬間に見た目が変わる）★').toContain(
      'not null default true'
    );
  });

  it('決めるところが「車の名前と並び」の表に在る', () => {
    expect(HTML, '★1台ずつのチェックが無い★').toContain('data-f="show_in_slip"');
    expect(HTML, '★見出しが無い（何のチェックか分からない）★').toContain('<th>明細に出す');
    expect(HTML, '★狭い画面で 何のマスか分からない★').toContain('data-l="明細に出す"');
  });

  it('★チェックは checked を読む★（value を読むと いつも "on" になる）', () => {
    // ★車の表の保存の口★ を見る（従業員の表にも 同じ形の口が在るので 頭から探すと そちらを掴む）
    const car = HTML.indexOf('function renderCars()');
    expect(car, '★車の表が無い★').toBeGreaterThan(-1);
    const i = HTML.indexOf('i.onchange = function () {', car);
    expect(i, '★保存の口が無い★').toBeGreaterThan(-1);
    const block = HTML.slice(i, i + 700);
    expect(block, '★チェックを value で読んでいる（いつも真になる）★').toContain(
      "i.type === 'checkbox'"
    );
    expect(block, '★checked を読んでいない★').toContain('v = i.checked;');
  });

  it('★決めていなければ 出す★（今までと同じ見た目）', () => {
    const i = HTML.indexOf('function carShowsInSlip(');
    expect(i, '★判定が無い★').toBeGreaterThan(-1);
    const block = HTML.slice(i, i + 400);
    // false の時だけ 出さない ＝ 空・未設定・true は 出す
    expect(block, '★既定が「出さない」側になっている★').toContain('show_in_slip === false');
    expect(block, '★出さない側を返していない★').toContain('return !(hit && hit.show_in_slip === false)');
  });

  it('★判定は1か所★（設定の画面と 明細で 食い違わない）', () => {
    const n = (HTML.match(/show_in_slip === false/g) || []).length;
    expect(n, `★同じ判定を ${n} か所で書いている★`).toBe(1);
    // 2026-08-25：人ごとの指定を足したので 人の id も渡す形になった
    expect(HTML, '★明細が その判定を通していない★').toContain('slipCars(REP.cars, e.employee_id)');
  });

  it('★番号は 出す車だけで振り直す・数字は取り違えない★', () => {
    const i = HTML.indexOf('function slipCars(');
    const block = HTML.slice(i, i + 500);
    // 元の並びの何番目か（i）を 一緒に持つ＝carSales の取り違えが起きない
    expect(block, '★元の何番目かを 持っていない（数字が ずれる）★').toContain('out.push({ car: car, i: i })');
    // 2026-08-25：司さんの指示で ★スマホの一覧は 金額と時間だけ★ になったので、
    //   売上を出すのは ★紙（横）だけ★。ここも 横だけを見る。
    expect(HTML, '★横で 振り直していない★').toContain("'売上' + (n + 1) + '（' + x.car.label");
    expect(HTML, '★横で 元の番号のまま 数字を取っている★').toContain('return F.car(c, x.i);');
  });

  it('★給料明細だけの決まり★（売上表・月次集計は今までどおり）', () => {
    for (const f of ['uriage.html', 'shukei.html']) {
      const other = fs.readFileSync(path.join(ROOT, f), 'utf8');
      expect(other, `★${f} まで 車を隠している★`).not.toContain('show_in_slip');
    }
  });
});

describe('★合計を大きく 目立つように★', () => {
  it('金額は 大きく・太く', () => {
    const big = ruleOf(HTML, '      .slip .sums .big');
    expect(big, '★大きくする決まりが無い★').toBeTruthy();
    const px = Number((big.match(/font-size:\s*(\d+)px/) || [])[1]);
    expect(px, `★金額が ${px}px しかない★`).toBeGreaterThanOrEqual(22);
    expect(big, '★太くしていない★').toContain('font-weight: 800');
  });

  it('★色では目立たせない★（色は 押せる物と 選ばれている物だけ）', () => {
    const sums = ruleOf(HTML, '      .slip .sums');
    const big = ruleOf(HTML, '      .slip .sums .big');
    expect(big, '★金額を 目立つ色にしている★').toContain('color: var(--ink)');
    expect(sums, '★合計の箱に 目立つ色を塗っている★').not.toMatch(/background:\s*(#0|#e0|var\(--blue)/);
  });

  it('印を付けた所を 画面が実際に使っている', () => {
    expect(HTML, '★金額に印が無い★').toContain('<span class="big">¥');
    expect(HTML, '★時間に印が無い★').toContain('<span class="mid">');
  });

  it('★紙にも そのまま出る★（画面だけ大きい にしない）', () => {
    const pr = HTML.slice(HTML.indexOf('@media print {'));
    expect(pr, '★紙で 合計を消している★').not.toMatch(/\.slip \.sums[^{]*\{[^}]*display:\s*none/);
  });
});
