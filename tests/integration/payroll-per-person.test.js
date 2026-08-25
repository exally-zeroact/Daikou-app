'use strict';
// ============================================================
// ★人ごとに歩合・最低保証を変えられること（A案）★ 2026-08-05
//
//   ★司さんの指示★
//     「④A」「ほんで人によって変えれるの仕組みにしてないやないか」
//     「決め方やなくて違う言い方にせな分かりにくいわ給料設定とかなんかいい言い方にかえろ」
//
//   ★決めた形（A案）★
//     ・役割ごとの決まりは今までどおり残す＝全員まとめて変える時はそこを直す
//     ・従業員の行に「歩合」「最低保証」を足す
//     ・★空欄なら役割どおり。打てばその人だけ変わる。★
//     ・0 は「0にしたい」という意思なので通す（空だけを未指定とする）
//
//   ★守ること★
//     ・今まで誰も打っていない＝★金額は1円も変わってはいけない★
//     ・打った人だけ変わり、他の人は巻き込まれない
// ============================================================
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const P = require(path.join(ROOT, 'js', 'daiko-payroll.js'));
const PD = require(path.join(ROOT, 'js', 'payroll-daily.js'));
const HTML = fs.readFileSync(path.join(ROOT, 'kyuryo.html'), 'utf8');

// 司さんの決まり（実物: 2種=35%/1150円, 1種=30%/1000円）
const SET = {
  poolMode: 'others_total',
  deductReserveBeforeRate: true,
  reservePoolRate: 0.05,
  reserveOwnerRate: 0.05,
  roles: { '2種': { rate: 0.35, floor: 1150 }, '1種': { rate: 0.3, floor: 1000 } },
};

// 1日ぶん: 車2台で 売上60,000円 / 20時間 → 1時間 3,000円（積立5%引いた後 2,850円）
const input = (staff) => ({
  owner: { sales: 0, expense: 0, hours: 0 },
  cars: [
    { id: 'c1', sales: 30000, expense: 0, hours: 10 },
    { id: 'c2', sales: 30000, expense: 0, hours: 10 },
  ],
  staff: staff,
});

const person = (over) =>
  Object.assign({ name: '白石正人', role: '2種', car: 'c1', hours: 10 }, over || {});

describe('★今まで誰も打っていない＝金額が1円も変わらないこと（一番大事）★', () => {
  it('歩合も最低保証も未指定なら、役割どおり', () => {
    const r = P.compute(input([person()]), SET);
    const row = r.staff[0];
    expect(row.rate).toBe(0.35);
    expect(row.floor).toBe(1150);
  });

  it('★null / undefined / 空文字 のどれでも役割どおり★（DBは null で返る）', () => {
    [
      { rate: null, floor: null },
      { rate: undefined, floor: undefined },
      { rate: '', floor: '' },
    ].forEach(function (o) {
      const r = P.compute(input([person(o)]), SET);
      expect(r.staff[0].rate, JSON.stringify(o)).toBe(0.35);
      expect(r.staff[0].floor, JSON.stringify(o)).toBe(1150);
    });
  });

  it('★1種の人も役割どおり★', () => {
    const r = P.compute(input([person({ name: '長野真道', role: '1種' })]), SET);
    expect(r.staff[0].rate).toBe(0.3);
    expect(r.staff[0].floor).toBe(1000);
  });

  it('★7人まとめて未指定でも、全員 役割どおりの金額★', () => {
    const staff = [
      person({ name: '白石正人', role: '2種' }),
      person({ name: '長野孝', role: '2種' }),
      person({ name: '長野真道', role: '1種' }),
      person({ name: '竹内真一郎', role: '1種' }),
      person({ name: '結田航平', role: '2種' }),
      person({ name: '正岡卓', role: '1種' }),
      person({ name: '向垣内靖', role: '1種' }),
    ];
    const r = P.compute(input(staff), SET);
    r.staff.forEach(function (row) {
      const want = SET.roles[row.role];
      expect(row.rate, row.name).toBe(want.rate);
      expect(row.floor, row.name).toBe(want.floor);
      expect(row.rateIsOwn, row.name + ' が個別扱いになっている').toBe(false);
      expect(row.floorIsOwn, row.name + ' が個別扱いになっている').toBe(false);
    });
  });
});

describe('★打った人だけ変わること★', () => {
  it('歩合をその人だけ上げる', () => {
    const base = P.compute(input([person()]), SET).staff[0];
    const own = P.compute(input([person({ rate: 0.4 })]), SET).staff[0];
    expect(own.rate).toBe(0.4);
    expect(own.byRate, '★歩合を打っても金額が変わっていない★').toBeGreaterThan(base.byRate);
    expect(own.rateIsOwn).toBe(true);
  });

  it('最低保証をその人だけ上げる', () => {
    const own = P.compute(input([person({ floor: 1300 })]), SET).staff[0];
    expect(own.floor).toBe(1300);
    expect(own.byFloor).toBe(1300 * 10);
    expect(own.floorIsOwn).toBe(true);
  });

  it('★高い方を採る、は今までどおり★', () => {
    // 1時間 2,850円 × 歩合0.35 = 997.5円/h < 最低保証1150円/h → 保証が勝つ
    const r = P.compute(input([person()]), SET).staff[0];
    expect(r.usedFloor).toBe(true);
    expect(r.pay).toBe(r.byFloor);
    // 歩合を0.5にすると 1,425円/h > 1,150円 → 歩合が勝つ
    const r2 = P.compute(input([person({ rate: 0.5 })]), SET).staff[0];
    expect(r2.usedFloor).toBe(false);
    expect(r2.pay).toBe(r2.byRate);
  });

  it('★他の人は巻き込まれない★', () => {
    const r = P.compute(
      input([
        person({ name: '白石正人', rate: 0.5, floor: 2000 }),
        person({ name: '長野孝' }),
        person({ name: '長野真道', role: '1種' }),
      ]),
      SET
    );
    expect(r.staff[0].rate).toBe(0.5);
    expect(r.staff[1].rate, '★隣の人まで変わった★').toBe(0.35);
    expect(r.staff[1].floor, '★隣の人まで変わった★').toBe(1150);
    expect(r.staff[2].rate, '★1種の人まで変わった★').toBe(0.3);
  });

  it('★片方だけ打てる★（歩合だけ・最低保証だけ）', () => {
    const a = P.compute(input([person({ rate: 0.4 })]), SET).staff[0];
    expect(a.rate).toBe(0.4);
    expect(a.floor, '打っていない最低保証まで変わった').toBe(1150);
    const b = P.compute(input([person({ floor: 1300 })]), SET).staff[0];
    expect(b.rate, '打っていない歩合まで変わった').toBe(0.35);
    expect(b.floor).toBe(1300);
  });

  it('★0 は「0にしたい」として通す★（空とは違う）', () => {
    const r = P.compute(input([person({ rate: 0, floor: 0 })]), SET).staff[0];
    expect(r.rate).toBe(0);
    expect(r.floor).toBe(0);
    expect(r.pay).toBe(0);
  });

  it('★空欄に戻せば役割どおりに戻る★', () => {
    const own = P.compute(input([person({ rate: 0.5 })]), SET).staff[0];
    const back = P.compute(input([person({ rate: null })]), SET).staff[0];
    expect(own.rate).toBe(0.5);
    expect(back.rate, '★空欄にしても戻らない★').toBe(0.35);
  });

  it('壊れた値は役割どおりに倒す（"あ" や NaN で金額を壊さない）', () => {
    ['あ', NaN, {}, []].forEach(function (v) {
      const r = P.compute(input([person({ rate: v, floor: v })]), SET).staff[0];
      expect(r.rate, JSON.stringify(v)).toBe(0.35);
      expect(r.floor, JSON.stringify(v)).toBe(1150);
    });
  });

  it('役割が無い人でも落ちない', () => {
    const r = P.compute(input([person({ role: '無い役割', rate: 0.4 })]), SET).staff[0];
    expect(r.rate).toBe(0.4);
    expect(r.floor).toBe(0); // 役割が無いので保証0
  });
});

describe('★従業員の値が計算まで運ばれること（配線）★', () => {
  it('★dayInput が人ごとの値を持たせている★（運ばないと打っても金額が変わらない）', () => {
    const ctx = PD.buildCtx({
      employees: [
        {
          employee_id: 'e1',
          name: '白石正人',
          role: '2種',
          active: true,
          sort_order: 1,
          pay_rate: 0.4,
          pay_floor: 1300,
        },
        { employee_id: 'e2', name: '長野孝', role: '2種', active: true, sort_order: 2 },
      ],
      workHours: [
        { work_date: '2026-08-04', employee_id: 'e1', device_id: 'd1', hours: 10 },
        { work_date: '2026-08-04', employee_id: 'e2', device_id: 'd1', hours: 10 },
      ],
      shifts: [],
      edits: [],
      labels: [],
    });
    const day = PD.dayInput('2026-08-04', ctx);
    const a = day.staff.filter((s) => s.name === '白石正人')[0];
    const b = day.staff.filter((s) => s.name === '長野孝')[0];
    expect(a, '人が居ない').toBeTruthy();
    expect(a.rate, '★人ごとの歩合を運んでいない★').toBe(0.4);
    expect(a.floor, '★人ごとの最低保証を運んでいない★').toBe(1300);
    expect(b.rate === null || b.rate === undefined, '打っていない人に値が付いている').toBe(true);
  });
});

describe('★画面がそろっていること★', () => {
  it('★タブの名前が「給料の設定」になっている★（司さん「決め方は分かりにくい」）', () => {
    expect(HTML).toContain('>給料の設定<');
    expect(HTML, '★まだ「決め方」と出ている★').not.toMatch(/<button class="tab"[^>]*>決め方</);
  });

  it('従業員に 歩合・最低保証 の欄がある', () => {
    expect(HTML).toContain('data-f="pay_rate"');
    expect(HTML).toContain('data-f="pay_floor"');
  });

  it('★空欄なら役割どおり、と画面に書いてある★', () => {
    expect(HTML).toContain('空欄=役割どおり');
    expect(HTML).toContain('空欄にすれば役割どおりに戻ります');
  });

  it('★空欄で保存すると null になる★（0 と混ぜない）', () => {
    expect(HTML, '★空欄が 0 として保存され、給料が0になる★').toContain(
      "v = String(i.value).trim() === '' ? null : num(i.value)"
    );
  });

  it('打たなかった時にどうなるかを薄く見せている（役割の値をプレースホルダに）', () => {
    expect(HTML).toContain('_roleRateOf(e.role)');
    expect(HTML).toContain('_roleFloorOf(e.role)');
  });

  it('列を足したぶん、空のときの colspan も合っている', () => {
    // ★数を直に書かない★（2026-08-25：列を1つ足した時に この試験だけ赤くなった）
    //   ⇒ ★見出しの数を その場で数えて★ 空のときの colspan と突き合わせる。
    const head = HTML.slice(
      HTML.indexOf('<tbody id="empBody"') - 4000,
      HTML.indexOf('<tbody id="empBody"')
    );
    const th = (head.match(/<th[\s>]/g) || []).length;
    expect(th, '★従業員の表の見出しが読めない★').toBeGreaterThan(0);
    const empty = HTML.slice(HTML.indexOf('まだ誰も登録されていません') - 60, HTML.indexOf('まだ誰も登録されていません'));
    const span = Number((empty.match(/colspan="(\d+)"/) || [])[1]);
    expect(span, `★列は ${th} 個なのに 空のときは ${span} 個ぶんになっている（表が崩れる）★`).toBe(th);
  });

  // ============================================================
  // ★スマホで横にはみ出さないこと★ 2026-08-05
  //   列が6つになり、そのままだと★最低保証が画面の外に出て見えない★。
  //   司さんはスマホで見る。実際に 397px で測ってはみ出しゼロを確認した。
  //   （司さんは売上表でも「見にくい」と言っている＝同じ轍を踏まない）
  // ============================================================
  it('★スマホでは1人1枚にしている★（横スクロールさせない）', () => {
    expect(HTML, '★スマホ向けの作りが無い＝最低保証が画面の外に出る★').toMatch(
      /@media \(max-width: 620px\)[\s\S]{0,1200}\.emp-pane thead\s*\{\s*display: none/
    );
    expect(HTML, '1人1枚になっていない').toMatch(/\.emp-pane tr \{[\s\S]{0,200}border-radius/);
    // CSSはクラスで書く（IDセレクタはこの repo の決まりで使えない）。
    // ★クラスを付け忘れると、書いたCSSがどこにも当たらない★
    expect(HTML, '★.emp-pane を付けていない＝スマホ向けCSSが効かない★').toContain(
      'id="paneEmp" class="emp-pane"'
    );
    expect(HTML, '★.emp-body を付けていない＝欄の見出しが出ない★').toContain(
      'id="empBody" class="emp-body"'
    );
  });

  it('★1枚の中で、どれが何の欄か分かる★（見出しを消すので必要）', () => {
    ['名前', '役割', '歩合', '最低保証', '並び', '今いる人'].forEach(function (l) {
      expect(HTML, 'data-l="' + l + '" が無い＝スマホで何の欄か分からない').toContain(
        'data-l="' + l + '"'
      );
    });
    expect(HTML, '見出しを出す指定が無い').toContain('content: attr(data-l)');
  });
});
