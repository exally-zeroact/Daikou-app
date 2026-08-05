'use strict';
// ============================================================
// ★車の名前と並びを「給料の設定」で決められること★ 2026-08-05
//
//   ★司さんの指示★
//     「売上1,2.3とかもここで並べ変えや名前を決めれるようにしたら楽」
//
//   ★今までの形★
//     ・名前は★売上表でしか付けられなかった★
//     ・並びは決められず、名前の五十音順で「売上1・売上2」が決まっていた
//     ・そもそも本番の車の名前は★0件★＝全部「車1・車2」で出ていた
//
//   ★一番気をつけたこと★
//     並びを決めていない今、★見え方が1つも変わってはいけない★。
//     決めた時だけ、その順で 売上1・売上2 になる。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CN = require(path.join(ROOT, 'js', 'car-name.js'));
const PD = require(path.join(ROOT, 'js', 'payroll-daily.js'));
const HTML = fs.readFileSync(path.join(ROOT, 'kyuryo.html'), 'utf8');

const A = '22849fdb-cde7-4f1d-afc7-47009a6222222';
const B = '7e1919ef-4aaa-411e-8db0-ba0424111111';
const C = 'f3527369-9df3-47c4-93a8-b6e532a333333';

describe('★並びを決めていない今、見え方が変わらないこと（一番大事）★', () => {
  it('名前が無ければ 車1・車2・車3（端末IDの順）', () => {
    const m = CN.nameMap([C, A, B], []);
    expect(m[A]).toBe('車1'); // 22849… が一番小さい
    expect(m[B]).toBe('車2'); // 7e19…
    expect(m[C]).toBe('車3'); // f352…
  });

  it('★並びが空(null/未設定)でも今までどおり★', () => {
    const m = CN.nameMap(
      [C, A, B],
      [
        { device_id: A, label: '', sort_order: null },
        { device_id: B, label: '' },
      ]
    );
    expect(m[A]).toBe('車1');
    expect(m[B]).toBe('車2');
    expect(m[C]).toBe('車3');
  });

  it('名前が付いていれば その名前（今までどおり）', () => {
    const m = CN.nameMap(
      [A, B, C],
      [
        { device_id: A, label: '4987' },
        { device_id: B, label: '1466' },
        { device_id: C, label: '1173' },
      ]
    );
    expect([m[A], m[B], m[C]]).toEqual(['4987', '1466', '1173']);
  });

  it('★売上1・2・3 の並びも、決めていなければ今までどおり（名前の順）★', () => {
    const ctx = PD.buildCtx({
      labels: [
        { device_id: A, label: '4987' },
        { device_id: B, label: '1466' },
        { device_id: C, label: '1173' },
      ],
      shifts: [],
      edits: [],
      employees: [],
      workHours: [],
    });
    const cars = PD.carsOf(ctx);
    expect(
      cars.map((c) => c.label),
      '★並びを決めていないのに順番が変わった★'
    ).toEqual(['1173', '1466', '4987']);
  });
});

describe('★並びを決めたら、その順になること★', () => {
  const rows = [
    { device_id: A, label: '4987', sort_order: 1 },
    { device_id: B, label: '1466', sort_order: 2 },
    { device_id: C, label: '1173', sort_order: 3 },
  ];

  it('並べ替えの道具がその順を返す', () => {
    expect(CN.sortIds([C, B, A], rows)).toEqual([A, B, C]);
  });

  it('★売上1・2・3 が決めた順になる★', () => {
    const ctx = PD.buildCtx({ labels: rows, shifts: [], edits: [], employees: [], workHours: [] });
    expect(PD.carsOf(ctx).map((c) => c.label)).toEqual(['4987', '1466', '1173']);
  });

  it('並びを入れ替えたら 売上1・2・3 も入れ替わる', () => {
    const flipped = [
      { device_id: A, label: '4987', sort_order: 3 },
      { device_id: B, label: '1466', sort_order: 2 },
      { device_id: C, label: '1173', sort_order: 1 },
    ];
    const ctx = PD.buildCtx({
      labels: flipped,
      shifts: [],
      edits: [],
      employees: [],
      workHours: [],
    });
    expect(PD.carsOf(ctx).map((c) => c.label)).toEqual(['1173', '1466', '4987']);
  });

  it('★決めた車が先・決めていない車は後ろ★', () => {
    const some = [{ device_id: C, label: '', sort_order: 1 }];
    expect(CN.sortIds([A, B, C], some)).toEqual([C, A, B]);
  });

  it('★仮名の番号も並びに従う★（車1が一番上）', () => {
    const m = CN.nameMap(
      [A, B, C],
      [
        { device_id: C, sort_order: 1 },
        { device_id: B, sort_order: 2 },
        { device_id: A, sort_order: 3 },
      ]
    );
    expect([m[C], m[B], m[A]]).toEqual(['車1', '車2', '車3']);
  });

  it('同じ番号でも毎回同じ順（画面を開くたび入れ替わらない）', () => {
    const same = [
      { device_id: A, sort_order: 1 },
      { device_id: B, sort_order: 1 },
      { device_id: C, sort_order: 1 },
    ];
    expect(CN.sortIds([C, B, A], same)).toEqual(CN.sortIds([A, B, C], same));
  });

  it('壊れた並びは「決めていない」扱い', () => {
    const bad = [
      { device_id: A, sort_order: 'あ' },
      { device_id: B, sort_order: null },
    ];
    expect(CN.orderMap(bad)).toEqual({});
    expect(CN.sortIds([B, A], bad)).toEqual([A, B]);
  });

  it('壊れた入力でも落ちない', () => {
    expect(() => CN.sortIds(null, null)).not.toThrow();
    expect(() => CN.orderMap('こわれている')).not.toThrow();
  });
});

describe('★並びが計算まで運ばれること（配線）★', () => {
  it('★生の行を残している★（名前だけにすると並びが落ちる）', () => {
    const ctx = PD.buildCtx({
      labels: [{ device_id: A, label: '4987', sort_order: 2 }],
      shifts: [],
      edits: [],
      employees: [],
      workHours: [],
    });
    expect(ctx.labelRows, '★並びを持ち回っていない★').toBeTruthy();
    expect(ctx.labelRows.length).toBe(1);
    expect(ctx.labelRows[0].sort_order).toBe(2);
  });
});

describe('★画面がそろっていること★', () => {
  it('「給料の設定」に車の表がある', () => {
    expect(HTML, '★車の表が無い★').toContain('車の名前と並び');
    expect(HTML).toContain('id="carBody"');
  });

  it('名前と並びを打てる', () => {
    expect(HTML).toContain('data-f="label"');
    expect(HTML).toContain('data-f="sort_order"');
  });

  it('★並びを空欄にしたら null＝今までどおりに戻る★', () => {
    expect(HTML, '★空欄が 0 になって並びが狂う★').toMatch(/f === 'sort_order'[\s\S]{0,120}\? null/);
  });

  it('★保存はその場（保存ボタンを押させない）★', () => {
    expect(HTML).toContain('function saveCar(');
    expect(HTML).toContain('dk_device_labels?on_conflict=company_id,device_id');
  });

  it('給料の設定を開いたら車の表も描く', () => {
    expect(HTML, '★描いていない＝タブを開いても出ない★').toMatch(
      /if \(TAB === 'set'\) \{[\s\S]{0,120}renderCars\(\)/
    );
  });

  it('★今どう出ているかを見せている★（付ける前に分かる）', () => {
    expect(HTML).toContain('今の呼び方');
  });

  it('★スマホでは1台1枚★（横スクロールさせない）', () => {
    expect(HTML).toMatch(/\.car-pane thead\s*\{\s*display: none/);
    expect(HTML).toContain('class="car-body"');
    expect(HTML).toContain('car-pane');
  });
});

// ============================================================
// ★「給料の設定」が丸ごとスマホに収まること★ 2026-08-05
//   車の表を足した時に実物を測って見つけた。★元から★
//   「売上の分け方」と「明細の期間」が画面より広く、横に流れていた
//   （選ぶ欄の文が長い: 「自分の車を除いた全部（司さんのやり方）」）。
//   実測: 画面397px に対し 中身583px → 直して 397px（はみ出しゼロ）
// ============================================================
describe('★給料の設定が、スマホで横に流れないこと★', () => {
  it('★「売上の分け方」「明細の期間」が幅いっぱいに収まる作りになっている★', () => {
    expect(HTML, '★どちらも印を付けていない＝横に流れたまま★').toMatch(
      /class="card kv-pane"[\s\S]*class="card kv-pane"/
    );
    expect(HTML).toMatch(/\.kv-pane td \{[\s\S]{0,160}display: block/);
    expect(HTML, '選ぶ欄が画面より広いまま').toMatch(/\.kv-pane select \{[\s\S]{0,60}width: 100%/);
  });

  it('★役割の決まりも1行1枚★（画面ごとにバラバラにしない）', () => {
    expect(HTML).toMatch(/\.role-pane thead\s*\{\s*display: none/);
    expect(HTML).toContain('class="role-body"');
    ['役割', '歩合', '最低保証', '消す'].forEach(function (l) {
      expect(HTML, 'data-l="' + l + '" が無い＝スマホで何の欄か分からない').toContain(
        'data-l="' + l + '"'
      );
    });
  });

  it('消すボタンは1枚の右上に置く（欄の見出しは出さない）', () => {
    expect(HTML).toMatch(/\.role-pane td\[data-l='消す'\][\s\S]{0,140}position: absolute/);
    expect(HTML).toMatch(/\.role-pane td\[data-l='消す'\]::before[\s\S]{0,60}content: none/);
  });
});
