'use strict';
// ============================================================
// 運転代行の歩合計算 テスト (2026-08-01)
//
//   ★正解は司さんの実物★
//   OneDrive\デスクトップ\代行計算表2026.xlsb の『計算』シートが実際に出している金額を
//   そのまま期待値にしている（数式ではなく、Excelが計算した結果の値を読み取った）。
//   ここが1円でもズレたら、司さんの手元と違う給料が出るということ。
//
//   実物の式（読み取り結果）:
//     売上合計 = 2号車+3号車+4号車 − 経費2−経費3−経費4  （つかさ車は入らない）
//     時数合計 = 時数2+時数3+時数4                      （つかさの時数は入らない）
//     積立     = 売上合計 × 5%   / つかさ積立 = つかさ売上 × 5%
//     ★売上1h = (売上合計 − 積立) ÷ 時数合計★
//     各人     = MAX(売上1h × 係数 × h, 保証 × h)   2種:0.35/1150  1種:0.30/1000
//     ZERO     = (売上合計 − 積立 − 全員給料) + つかさ − つかさ積立 − つかさ経費
// ============================================================
const P = require('../../js/daiko-payroll.js');

// 実物の役割（2種=白石/長野孝/結田、1種=真道/竹内/八木/正岡/向垣内/バイト）
const ROLE2 = '2種';
const ROLE1 = '1種';

describe('★実物の代行計算表2026と1円まで一致すること★', () => {
  it('2026-01-10（計算シート11行目）', () => {
    const r = P.compute({
      owner: { sales: 6900, hours: 5.5, expense: 0 },
      cars: [
        { id: '2', sales: 25700, hours: 9, expense: 0 },
        { id: '3', sales: 24100, hours: 8.25, expense: 0 },
        { id: '4', sales: 21500, hours: 8.75, expense: 0 },
      ],
      staff: [
        { name: '白石正人', role: ROLE2, hours: 9 },
        { name: '長野孝', role: ROLE2, hours: 8.25 },
        { name: '長野真道', role: ROLE1, hours: 8.25 },
        { name: '竹内真一郎', role: ROLE1, hours: 8.75 },
        { name: '八木俊幸', role: ROLE1, hours: 9 },
        { name: '結田航平', role: ROLE2, hours: 8.75 },
      ],
    });

    expect(r.poolSales).toBe(71300); // 売上合計
    expect(r.poolHours).toBe(26); // 時数合計
    expect(r.reservePool).toBe(3565); // 積立
    expect(r.reserveOwner).toBe(345); // つかさ積立
    expect(r.hourly).toBeCloseTo(2605.1923076923076, 9); // 売上(1h

    const pay = {};
    r.staff.forEach((s) => (pay[s.name] = s.pay));
    expect(pay['白石正人']).toBe(10350);
    expect(pay['長野孝']).toBe(9487.5);
    expect(pay['長野真道']).toBe(8250);
    expect(pay['竹内真一郎']).toBe(8750);
    expect(pay['八木俊幸']).toBe(9000);
    expect(pay['結田航平']).toBe(10062.5);
    expect(r.staffTotal).toBe(55900);

    expect(r.ownerShare).toBe(18390); // ★ZERO★
  });

  it('2026-01-31（計算シート32行目・経費2が入る日）', () => {
    const r = P.compute({
      owner: { sales: 20200, hours: 5.5, expense: 0 },
      cars: [
        { id: '2', sales: 28700, hours: 8.5, expense: 2720 }, // ★経費2★
        { id: '3', sales: 21100, hours: 7.75, expense: 0 },
        { id: '4', sales: 21500, hours: 8.25, expense: 0 },
      ],
      staff: [
        { name: '白石正人', role: ROLE2, hours: 8.5 },
        { name: '長野孝', role: ROLE2, hours: 7.75 },
        { name: '長野真道', role: ROLE1, hours: 7.75 },
        { name: '竹内真一郎', role: ROLE1, hours: 8.25 },
        { name: '八木俊幸', role: ROLE1, hours: 8.5 },
        { name: '結田航平', role: ROLE2, hours: 8.25 },
      ],
    });

    expect(r.poolSales).toBe(68580); // 経費2を引いた後
    expect(r.poolHours).toBe(24.5);
    expect(r.reservePool).toBe(3429);
    expect(r.reserveOwner).toBe(1010);
    expect(r.hourly).toBeCloseTo(2659.2244897959185, 9);

    const pay = {};
    r.staff.forEach((s) => (pay[s.name] = s.pay));
    expect(pay['白石正人']).toBe(9775);
    expect(pay['長野孝']).toBe(8912.5);
    expect(pay['長野真道']).toBe(7750);
    expect(pay['竹内真一郎']).toBe(8250);
    expect(pay['八木俊幸']).toBe(8500);
    expect(pay['結田航平']).toBe(9487.5);

    expect(r.ownerShare).toBe(31666); // ★ZERO★
  });

  it('2026-02-14（計算シート49行目・向垣内が入る日）', () => {
    const r = P.compute({
      owner: { sales: 20100, hours: 7.25, expense: 0 },
      cars: [
        { id: '2', sales: 21900, hours: 7.5, expense: 0 },
        { id: '3', sales: 35200, hours: 8.75, expense: 0 },
        { id: '4', sales: 27000, hours: 9, expense: 0 },
      ],
      staff: [
        { name: '白石正人', role: ROLE2, hours: 7.5 },
        { name: '長野孝', role: ROLE2, hours: 8.75 },
        { name: '長野真道', role: ROLE1, hours: 8.75 },
        { name: '竹内真一郎', role: ROLE1, hours: 7.5 },
        { name: '結田航平', role: ROLE2, hours: 9 },
        { name: '向垣内', role: ROLE1, hours: 9 },
      ],
    });

    expect(r.poolSales).toBe(84100);
    expect(r.poolHours).toBe(25.25);
    expect(r.reservePool).toBe(4205);
    expect(r.reserveOwner).toBe(1005);
    expect(r.hourly).toBeCloseTo(3164.158415841584, 9);

    const pay = {};
    r.staff.forEach((s) => (pay[s.name] = s.pay));
    expect(pay['白石正人']).toBe(8625);
    expect(pay['長野孝']).toBe(10062.5);
    expect(pay['長野真道']).toBe(8750);
    expect(pay['竹内真一郎']).toBe(7500);
    expect(pay['結田航平']).toBe(10350);
    expect(pay['向垣内']).toBe(9000);

    expect(r.ownerShare).toBe(44702.5); // ★ZERO★
  });
});

describe('★積立を引いてから割る（ここを間違えると全員の給料がズレる）★', () => {
  const base = {
    owner: { sales: 6900, hours: 5.5, expense: 0 },
    cars: [{ id: '2', sales: 100000, hours: 20, expense: 0 }],
    staff: [{ name: 'A', role: '2種', hours: 20 }],
  };

  it('既定は 積立を引いてから割る', () => {
    const r = P.compute(base);
    // (100000 − 5000) ÷ 20 = 4750
    expect(r.hourly).toBe(4750);
  });

  it('設定で「引かずに割る」にもできる', () => {
    const r = P.compute(base, { deductReserveBeforeRate: false });
    expect(r.hourly).toBe(5000); // 100000 ÷ 20
  });
});

describe('★歩合も最低保証も自由に変えられる（司さん指示）★', () => {
  const input = {
    owner: { sales: 0, hours: 0, expense: 0 },
    cars: [{ id: '2', sales: 100000, hours: 20, expense: 0 }],
    staff: [
      { name: 'A', role: '2種', hours: 10 },
      { name: 'B', role: '1種', hours: 10 },
    ],
  };

  it('係数を変えると給料が変わる', () => {
    const r = P.compute(input, {
      roles: { '2種': { rate: 0.5, floor: 0 }, '1種': { rate: 0.4, floor: 0 } },
    });
    // 売上1h = (100000-5000)/20 = 4750
    expect(r.staff[0].pay).toBe(4750 * 0.5 * 10);
    expect(r.staff[1].pay).toBe(4750 * 0.4 * 10);
  });

  it('最低保証を上げると保証が勝つ', () => {
    const r = P.compute(input, {
      roles: { '2種': { rate: 0.35, floor: 99999 }, '1種': { rate: 0.3, floor: 0 } },
    });
    expect(r.staff[0].pay).toBe(99999 * 10);
    expect(r.staff[0].usedFloor).toBe(true);
  });

  it('役割は好きなだけ増やせる（3種類でも）', () => {
    const r = P.compute(
      {
        owner: { sales: 0, hours: 0 },
        cars: [{ id: '2', sales: 100000, hours: 20 }],
        staff: [
          { name: 'A', role: '班長', hours: 10 },
          { name: 'B', role: '見習い', hours: 10 },
        ],
      },
      { roles: { 班長: { rate: 0.4, floor: 1300 }, 見習い: { rate: 0.2, floor: 900 } } }
    );
    expect(r.staff[0].pay).toBe(4750 * 0.4 * 10);
    expect(r.staff[1].pay).toBe(Math.max(4750 * 0.2 * 10, 900 * 10));
  });

  it('積立の率も変えられる（0%にもできる）', () => {
    const r = P.compute(input, { reservePoolRate: 0, reserveOwnerRate: 0 });
    expect(r.reservePool).toBe(0);
    expect(r.hourly).toBe(5000);
  });
});

describe('★母数の作り方を選べる（他のユーザー向け・司さん指示）★', () => {
  const input = {
    owner: { sales: 50000, hours: 10, expense: 0 },
    cars: [
      { id: '2', sales: 60000, hours: 10, expense: 0 },
      { id: '3', sales: 40000, hours: 10, expense: 0 },
    ],
    staff: [
      { name: 'A', role: '2種', hours: 10, car: '2' },
      { name: 'B', role: '2種', hours: 10, car: '3' },
    ],
  };

  it('others_total（司さんのやり方）= 自分の車を入れない', () => {
    const r = P.compute(input);
    expect(r.poolSales).toBe(100000); // 60000+40000
    expect(r.poolHours).toBe(20);
  });

  it('all_total = 自分の車も入れて全台', () => {
    const r = P.compute(input, { poolMode: 'all_total' });
    expect(r.poolSales).toBe(150000);
    expect(r.poolHours).toBe(30);
  });

  it('★per_car = 車ごとに単価を出す（乗った車で給料が変わる）★', () => {
    const r = P.compute(input, { poolMode: 'per_car', roles: { '2種': { rate: 0.35, floor: 0 } } });
    // 2号車: (60000-3000)/10 = 5700 → A = 5700*0.35*10 = 19950
    // 3号車: (40000-2000)/10 = 3800 → B = 3800*0.35*10 = 13300
    expect(r.staff[0].pay).toBeCloseTo(19950, 6);
    expect(r.staff[1].pay).toBeCloseTo(13300, 6);
  });
});

describe('壊れたデータでも止まらない', () => {
  it('★何が来ても throw しない★', () => {
    expect(() => P.compute(null, null)).not.toThrow();
    expect(() => P.compute({}, {})).not.toThrow();
    expect(() => P.compute('x', 'y')).not.toThrow();
    expect(P.compute(null, null).staffTotal).toBe(0);
  });

  it('★時数0でも NaN を出さない（0除算しない）★', () => {
    const r = P.compute({
      owner: { sales: 0, hours: 0 },
      cars: [{ id: '2', sales: 10000, hours: 0 }],
      staff: [{ name: 'A', role: '2種', hours: 0 }],
    });
    expect(Number.isNaN(r.hourly)).toBe(false);
    expect(r.hourly).toBe(0);
    expect(r.staff[0].pay).toBe(0);
  });

  it('知らない役割の人は0円（勝手な単価をでっち上げない）', () => {
    const r = P.compute({
      owner: { sales: 0, hours: 0 },
      cars: [{ id: '2', sales: 100000, hours: 20 }],
      staff: [{ name: 'X', role: '謎', hours: 10 }],
    });
    expect(r.staff[0].pay).toBe(0);
  });
});
