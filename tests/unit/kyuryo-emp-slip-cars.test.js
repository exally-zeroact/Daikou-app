// ============================================================
// ★人ごとに 明細に出す車を決める★ 2026-08-25
//
//   ★司さん★
//     「個人個人で給料明細に載せるかも選びたいんや
//       山田太郎は車1、山田花子は車2と3とかカスタムしたい」
//
//   ★決め方（順番も ここ1本）★
//     ①その人の指定が在れば ★その車だけ★（dk_employees.slip_cars）
//     ②無ければ 会社の「明細に出す」（dk_device_labels.show_in_slip）
//     ★空＝会社の決まりどおり★＝今までと同じ見た目
//
//   ★倉庫の本物の行で押した結果（2026-08-25）★
//     テスト太郎（1号車だけ指定）   … 売上1（1号車）
//     テスト次郎（車1と2号車を指定）… 売上1（車1）／売上2（2号車）
//     テスト三郎（何も指定しない）  … 売上1〜売上6（＝会社の決まりどおり）
//     ＝★人ごとに ちゃんと分かれた★／番号も 1から振り直されている
//
//   ★踏んだ罠（自分のテストが嘘をついた）★
//     倉庫の label が空の車は 画面では「車1」と ★作った名前★ で出る。
//     倉庫の label で引くと undefined になり ★1台 足りない★のに
//     「動いた」と読んでしまった。⇒ 画面が使っている device_id で引き直した。
//
//   ★名前を 真ん中に★（司さん「目が散るから 赤丸の所に名前もってきて」）
//     給料明細 → ★名前★ → 合計 の順。紙でも 一息で「誰の・いくら」が読める。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'kyuryo.html'), 'utf8').replace(/\r\n/g, '\n');
const SQL = fs.readFileSync(path.join(ROOT, 'supabase', 'apply-emp-slip-cars.sql'), 'utf8');

// ★見張りは 書き方の空白で 赤にならない★ 2026-08-26
//   prettier が 折り返し方を変えると ★中身は1文字も変わっていないのに 赤★ になった。
//   ⇒ 見る前に ★続く空白を 1つに畳む★（何を見るかは 変えない）。
const flat = (s) => String(s).replace(/\s+/g, ' ');

describe('★人ごとに 明細に出す車★', () => {
  it('倉庫は 人の棚に列を1本 足すだけ（新しい棚を作らない）', () => {
    expect(SQL, '★人の棚ではない所に作っている★').toContain('alter table daikome.dk_employees');
    expect(SQL, '★列の名前が違う★').toContain('add column if not exists slip_cars jsonb');
    // ★既定を入れない＝空＝会社の決まりどおり★（default を入れると 全員に指定が入る）
    expect(SQL, '★既定を入れている（全員に指定が入ってしまう）★').not.toMatch(
      /slip_cars jsonb[^;]*default/
    );
  });

  it('決めるところが 従業員の表に在る', () => {
    expect(HTML, '★人ごとのチェックが無い★').toContain('data-f="slip_cars"');
    expect(HTML, '★見出しが無い★').toContain('明細に出す車');
    expect(HTML, '★狭い画面で 何のマスか分からない★').toContain('data-l="明細に出す車"');
    expect(HTML, '★何も付けない時どうなるか 書いていない★').toContain(
      '何も付けない=会社の決まりどおり'
    );
  });

  it('★決める順番は 1か所★（その人 → 無ければ 会社）', () => {
    const i = HTML.indexOf('function slipCars(');
    expect(i, '★決める所が無い★').toBeGreaterThan(-1);
    const block = HTML.slice(i, i + 700);
    expect(block, '★その人の指定を見ていない★').toContain('var mine = empSlipCars(employeeId)');
    expect(block, '★その人 → 会社 の順になっていない★').toContain(
      'mine ? mine.indexOf(car.device_id) >= 0 : carShowsInSlip(car.device_id)'
    );
    // ★同じ順番を 2度 書かない★
    const n = (HTML.match(/empSlipCars\(/g) || []).length;
    expect(n, `★その人の指定を ${n} か所で読んでいる（1本にする）★`).toBeLessThanOrEqual(3);
  });

  it('★人ごとに出し分ける★（明細は 1人ずつ 車を数え直す）', () => {
    expect(HTML, '★全員 同じ車で出している★').toContain('slipCars(REP.cars, e.employee_id)');
    // 人ごとに変わるので ★人の輪の中★で決めていること
    //   ★画面を描く所の中だけ★を見る（他所にも同じ書き方が在るので 全体の indexOf では測れない）
    const rs = HTML.slice(HTML.indexOf('function renderSlips() {'));
    const loop = rs.indexOf('REP.employees.forEach(function (e, ei) {');
    expect(loop, '★人の輪が 無い★').toBeGreaterThan(-1);
    const call = rs.indexOf('slipCars(REP.cars, e.employee_id)');
    expect(call, '★人の輪の外で 1回だけ決めている（全員 同じになる）★').toBeGreaterThan(loop);
    // 紙も 人ごとに数え直す（紙だけ 全員同じ車になる事故を止める）
    const kami = HTML.slice(HTML.indexOf('function _addEmp('), HTML.indexOf('function _openPdf('));
    expect(kami, '★紙が 人ごとの車を受け取っていない★').toContain('cars');
  });

  it('★空（打っていない）＝会社の決まりどおり★', () => {
    const i = HTML.indexOf('function empSlipCars(');
    const block = HTML.slice(i, i + 700);
    expect(block, '★空を 指定ありとして扱っている★').toContain('if (!v) return null;');
    expect(block, '★空の並びを 指定ありとして扱っている★').toContain(
      'return v && v.length ? v : null;'
    );
    // 倉庫が文字で返しても読めるようにしてある
    expect(block, '★文字で返った時に落ちる★').toContain("typeof v === 'string'");
  });

  it('★保存は まとめて1本★（片方だけ入った状態を倉庫に残さない）', () => {
    const i = HTML.indexOf('function _collectEmpCars(');
    expect(i, '★まとめる所が無い★').toBeGreaterThan(-1);
    const block = HTML.slice(i, i + 600);
    expect(block, '★その人のチェックを 全部 集めていない★').toContain(
      '[data-emp="\' + empId + \'"][data-f="slip_cars"]'
    );
    expect(block, '★1つも付いていない時に 空の並びを保存している★').toContain(
      'return out.length ? out : null;'
    );
    expect(HTML, '★保存の口が まとめる所を通っていない★').toContain(
      "if (f === 'slip_cars') v = _collectEmpCars("
    );
  });

  it('★給料明細だけの決まり★（売上表・月次集計は今までどおり）', () => {
    for (const f of ['uriage.html', 'shukei.html']) {
      const other = fs.readFileSync(path.join(ROOT, f), 'utf8');
      expect(other, `★${f} まで 人ごとに車を隠している★`).not.toContain('slip_cars');
    }
  });
});

describe('★名前を 真ん中に★', () => {
  it('給料明細 → 名前 → 合計 の順で書いてある', () => {
    const F = flat(HTML);
    const i = F.indexOf('\'<div class="slip" id="slip-\' + ei +');
    expect(i, '★明細1枚の印が 見つからない★').toBeGreaterThan(-1);
    const block = F.slice(i, i + 1600);
    const title = block.indexOf('class="title">給料明細');
    const who = block.indexOf('<div class="who">');
    const sums = block.indexOf('<div class="sums">');
    expect(title, '★題が無い★').toBeGreaterThan(-1);
    expect(who, '★名前が無い★').toBeGreaterThan(-1);
    expect(sums, '★合計が無い★').toBeGreaterThan(-1);
    expect(who, '★名前が 題より前に在る★').toBeGreaterThan(title);
    expect(sums, '★合計が 名前より前に在る（名前が右端に飛ぶ）★').toBeGreaterThan(who);
  });

  it('★名前は「給料明細」の すぐ右★（真ん中に浮かせない）', () => {
    // ★1度 間違えた★ 2026-08-25：space-between にしたら 名前が真ん中に浮き、
    //   司さんに「赤丸の所って言わんかった？」と 2度 言わせた。
    //   ⇒ ★名前は「給料明細」と同じ箱（左のかたまり）に入れて くっつける★。
    expect(HTML, '★左のかたまりが 無い（名前が離れる）★').toContain('<div class="sh-l">');
    const l = HTML.indexOf('<div class="sh-l">');
    const block = HTML.slice(l, l + 700);
    expect(block, '★題が 左のかたまりに入っていない★').toContain('給料明細');
    expect(block, '★名前が 左のかたまりに入っていない★').toContain('<div class="who">');
    const i = HTML.indexOf('\n      .slip .shead {');
    const shead = HTML.slice(i, HTML.indexOf('}', i));
    expect(shead, '★端から端に散らす形に戻っている★').not.toContain('space-between');
    // ★同じ名前を 2か所に書かない★（どちらが効くか 分からなくなる）
    const n = (HTML.match(/\n {6}\.slip \.sums \{/g) || []).length;
    expect(n, `★.slip .sums を ${n} か所で書いている★`).toBe(1);
  });
});
