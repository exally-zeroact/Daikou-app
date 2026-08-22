'use strict';
// ============================================================
// ★月次集計：司さんの実物『月別』シートを丸ごと再現する テスト 2026-08-01★
//
//   材料 = tests/fixtures/daiko-month-jan2026.json
//     『計算』シート 2〜32行（1/1〜1/31 まるごと）と
//     『売上表』の請求書/PayPay（手入力ぶん）を、クラウドに入る形へ置き直した物。
//
//   答え = 『月別』シート R2（1月の行）と『売上表』1月の合計。
//     売上合計 1,298,210 / 経費 24,790 / 積立金 65,058.5 / 未収 240,200 /
//     現金 1,058,010 / ZERO合計 565,053.975
//     ★バ1〜10 177,375 ／ バ11〜20 211,390.425 ／ バ21〜31 279,332.1★
//
//   ★この「バ」3列が、司さんが給料を月3回に分けて払っている証拠★
//     バ21〜31(279,332.1) は 給料1(21日〜末日) の8人の合計とぴったり同じ。
// ============================================================
const path = require('path');
const fs = require('fs');
const D = require('../../js/payroll-daily.js');
const G = require('../../js/getsuji-agg.js');
const P = require('../../js/payroll-period.js');

const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'daiko-month-jan2026.json'), 'utf8')
);
const W = FIX.expected;

const ctx = D.buildCtx(FIX);
const m = G.month(2026, 1, ctx, FIX.payments);

describe('★1月の月次集計が実物の『月別』と一致★', () => {
  it(`売上合計 ${W.売上合計.toLocaleString()}（つかさ車も入れた全部・実費を引いた後）`, () => {
    expect(m.salesTotal).toBeCloseTo(W.売上合計, 4);
  });

  it(`経費 ${W.経費.toLocaleString()}（手入力の実費ぜんぶ）`, () => {
    expect(m.expense).toBeCloseTo(W.経費, 4);
  });

  it(`積立金 ${W.積立金.toLocaleString()}（積立 + つかさ積立）`, () => {
    expect(m.reserve).toBeCloseTo(W.積立金, 4);
  });

  it(`未収 ${W.未収.toLocaleString()}（請求書 ${W.請求書.toLocaleString()} + PayPay ${W.PayPay.toLocaleString()}）`, () => {
    expect(m.invoice).toBeCloseTo(W.請求書, 4);
    expect(m.paypay).toBeCloseTo(W.PayPay, 4);
    expect(m.unpaid).toBeCloseTo(W.未収, 4);
  });

  it(`現金 ${W.現金.toLocaleString()}（売上合計 − 未収）`, () => {
    expect(m.cash).toBeCloseTo(W.現金, 4);
  });

  it(`★ZERO合計 ${Math.round(W.ZERO合計).toLocaleString()}（売上合計 − 給料 − 積立金）★`, () => {
    expect(m.ownerShare).toBeCloseTo(W.ZERO合計, 4);
  });

  it('★日ごとのZEROを足した物とも一致する（2通りで出しても同じ）★', () => {
    expect(m.ownerShareDaily).toBeCloseTo(W.ZERO合計, 4);
    expect(m.ownerShareDaily).toBeCloseTo(m.ownerShare, 4);
  });
});

describe('★給料は月3回払い（実物の バ1〜10 / バ11〜20 / バ21〜31）★', () => {
  it('3つの期に分かれる', () => {
    expect(m.periods.length).toBe(3);
    expect(m.periods.map((p) => p.name)).toEqual(['1〜10日', '11〜20日', '21日〜末日']);
  });

  it(`バ1〜10 = ${W.バ1_10.toLocaleString()}`, () => {
    expect(m.periods[0].pay).toBeCloseTo(W.バ1_10, 4);
    expect(m.periods[0].rangeLabel).toBe('1/1 ~ 1/10');
  });

  it(`バ11〜20 = ${Math.round(W.バ11_20).toLocaleString()}`, () => {
    expect(m.periods[1].pay).toBeCloseTo(W.バ11_20, 4);
    expect(m.periods[1].rangeLabel).toBe('1/11 ~ 1/20');
  });

  it(`★バ21〜31 = ${Math.round(W.バ21_末).toLocaleString()}（給料1の8人合計と同じ）★`, () => {
    expect(m.periods[2].pay).toBeCloseTo(W.バ21_末, 4);
    expect(m.periods[2].rangeLabel).toBe('1/21 ~ 1/31');
  });

  it(`バイト合計 = ${Math.round(W.バイト合計).toLocaleString()}`, () => {
    expect(m.payTotal).toBeCloseTo(W.バイト合計, 4);
  });

  it('★3期を足すと月の給料合計になる（取りこぼしも二重計上も無い）★', () => {
    const sum = m.periods.reduce((a, p) => a + p.pay, 0);
    expect(sum).toBeCloseTo(m.payTotal, 6);
  });
});

describe('内税10%（実物の売上表と同じ）', () => {
  it('税抜きと消費税', () => {
    expect(m.exTax).toBeCloseTo(W.売上合計 / 1.1, 4);
    expect(m.tax).toBeCloseTo((W.売上合計 * 0.1) / 1.1, 4);
    expect(m.exTax + m.tax).toBeCloseTo(W.売上合計, 4);
  });
});

describe('★売上合計と「給料の母数」を混同していない★', () => {
  it('月次の売上合計には つかさ車が入る', () => {
    // 給料の母数（つかさ車を除いた分）は必ず小さくなる
    const dates = P.monthDates(2026, 1);
    const pool = dates.reduce((a, d) => a + D.computeDay(d, ctx).poolSales, 0);
    expect(pool).toBeLessThan(m.salesTotal);
    // 差＝つかさ車の売上（実費を引いた後）
    const own = dates.reduce((a, d) => {
      const o = D.computeDay(d, ctx).owner;
      return a + (o.sales - o.expense);
    }, 0);
    expect(pool + own).toBeCloseTo(m.salesTotal, 4);
  });
});

describe('1年ぶん', () => {
  const yr = G.year(2026, ctx, FIX.payments);

  it('12ヶ月ぶん並ぶ', () => {
    expect(yr.months.length).toBe(12);
    expect(yr.months[0].label).toBe('1月');
    expect(yr.months[11].label).toBe('12月');
  });

  it('データがあるのは1月だけ（他は0）', () => {
    expect(yr.months[0].salesTotal).toBeCloseTo(W.売上合計, 4);
    for (let i = 1; i < 12; i++) expect(yr.months[i].salesTotal).toBe(0);
  });

  it('年間合計＝1月ぶん', () => {
    expect(yr.total.salesTotal).toBeCloseTo(W.売上合計, 4);
    expect(yr.total.payTotal).toBeCloseTo(W.バイト合計, 4);
    expect(yr.total.ownerShare).toBeCloseTo(W.ZERO合計, 4);
  });

  it('期ごとの年間合計も出る', () => {
    expect(yr.total.periods.length).toBe(3);
    expect(yr.total.periods[2].pay).toBeCloseTo(W.バ21_末, 4);
  });
});

describe('★壊れたデータでも画面を殺さない★', () => {
  it('何が来ても throw しない', () => {
    expect(() => G.month(null, null, null, null)).not.toThrow();
    expect(() => G.month(2026, 1, D.buildCtx(null), null)).not.toThrow();
    expect(() => G.year(null, null, null)).not.toThrow();
    expect(() => G.month(2026, 1, ctx, 'これは配列じゃない')).not.toThrow();
  });

  it('空っぽなら全部0（NaNを出さない）', () => {
    const e = G.month(2026, 5, D.buildCtx(null), []);
    Object.keys(e).forEach((k) => {
      if (typeof e[k] === 'number') expect(isFinite(e[k])).toBe(true);
    });
    expect(e.salesTotal).toBe(0);
    expect(e.ownerShare).toBe(0);
  });

  it('その月に無い日の入金は数えない', () => {
    const m2 = G.month(2026, 2, ctx, FIX.payments);
    expect(m2.invoice).toBe(0);
    expect(m2.unpaid).toBe(0);
  });
});
