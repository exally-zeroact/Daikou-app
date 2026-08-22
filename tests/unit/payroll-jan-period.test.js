'use strict';
// ============================================================
// ★端から端まで：司さんの実物「給料1」を丸ごと再現する テスト 2026-08-01★
//
//   これまでのテストは「1日ぶん」の突き合わせだった。
//   ここでやるのは ★1月分（1/21〜1/31）11日ぶんを通しで計算して、
//   実物の給料明細シート『給料1』の 8人ぶんのヘッダ（合計◯円 / ◯時間）と一致させること★。
//
//   材料 = tests/fixtures/daiko-payroll-jan2026.json
//     司さんの 代行計算表2026.xlsb『計算』シート 22〜32行目（1/21〜1/31）を、
//     ダイコメのクラウドに入る形（勤務 / 手入力 / 従業員 / 誰がどの車に乗ったか）へ置き直した物。
//     ★人の時数は入れていない★ — 乗った車から決まることを、この通しテストでも確かめるため。
//
//   答え = 『給料1』のヘッダ（Excelが実際に表示している数字）
//     白石 56,647円/47.75h  長野孝 52,205/44.00  真道 45,154/44.00  竹内 56,001/54.75
//     八木 8,500/8.50  結田 40,825/35.50  正岡 8,500/8.50  向垣内 11,500/11.50
//
//   ここが緑なら「クラウドの生データ → 明細」まで通しで司さんの手元と同じ、と言える。
// ============================================================
const path = require('path');
const fs = require('fs');
const D = require('../../js/payroll-daily.js');
const P = require('../../js/payroll-period.js');

const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'daiko-payroll-jan2026.json'), 'utf8')
);

const period = P.periodOf(2026, 1, { startDay: 21, endMode: 'month_end' });
const ctx = D.buildCtx(FIX);
const rep = D.report(period.dates, ctx);
const by = {};
rep.employees.forEach((e) => (by[e.name] = e));

describe('★期間の切り方が実物の給料1と同じ★', () => {
  it('1月分 1/21 ~ 1/31（11日）', () => {
    expect(period.rangeLabel).toBe('1/21 ~ 1/31');
    expect(period.dates.length).toBe(11);
  });
});

describe('★8人ぶんの合計が実物の給料1と一致★', () => {
  Object.keys(FIX.expected).forEach((name) => {
    const want = FIX.expected[name];
    it(`${name} … ${want.pay.toLocaleString()}円 / ${want.hours}時間`, () => {
      const got = by[name];
      expect(got).toBeTruthy();
      // 実物のヘッダは円未満を丸めて表示しているので、丸めて突き合わせる
      expect(Math.round(got.totalPay)).toBe(want.pay);
      expect(got.totalHours).toBe(want.hours);
    });
  });

  it('★全員の合計もそのまま足して合う★', () => {
    const sumWant = Object.keys(FIX.expected).reduce((a, k) => a + FIX.expected[k].pay, 0);
    const sumGot = rep.employees.reduce((a, e) => a + Math.round(e.totalPay), 0);
    expect(sumGot).toBe(sumWant);
  });
});

describe('★1日ぶんの中身も実物どおり★', () => {
  it('1/21 = 売上合計 31,580 / 時数合計 12.75 / 積立 1,579', () => {
    const d = rep.days['2026-01-21'];
    expect(d.poolSales).toBe(31580);
    expect(d.poolHours).toBe(12.75);
    expect(d.reservePool).toBeCloseTo(1579, 6);
    expect(d.hourly).toBeCloseTo(2353.0196078431372, 9);
    expect(d.ownerShare).toBeCloseTo(2588.5, 6); // ZERO
  });

  it('1/23 = 経費(高速)を引いた後の売上合計 57,740', () => {
    const d = rep.days['2026-01-23'];
    expect(d.poolSales).toBe(57740);
    expect(d.poolHours).toBe(15);
    expect(d.ownerShare).toBeCloseTo(39433.55, 6);
  });

  it('★1/25 は誰も出ていない＝全部空欄・0で割らない★', () => {
    const d = rep.days['2026-01-25'];
    expect(d.poolSales).toBe(0);
    expect(d.poolHours).toBe(0);
    expect(d.hourly).toBe(0);
    expect(d.staff).toEqual([]);
    rep.employees.forEach((e) => {
      const c = e.cells.find((x) => x.date === '2026-01-25');
      expect(c.worked).toBe(false);
      expect(c.pay).toBe(null);
    });
  });

  it('★1/29 は つかさだけ働いた日＝みんな空欄・つかさの取り分は 12,160★', () => {
    const d = rep.days['2026-01-29'];
    expect(d.poolSales).toBe(0);
    expect(d.ownerShare).toBeCloseTo(12160, 6);
  });

  it('★1/30 の つかさ経費 1,440 が つかさの取り分から引かれている★', () => {
    expect(rep.days['2026-01-30'].ownerShare).toBeCloseTo(43915.85, 6);
  });

  it('★乗る車は日で変わる（1/31 竹内は4号車）★', () => {
    const take = by['竹内真一郎'].cells.find((c) => c.date === '2026-01-31');
    expect(take.hours).toBe(8.25); // 時数4
    const white = by['白石正人'].cells.find((c) => c.date === '2026-01-31');
    expect(white.hours).toBe(8.5); // 時数2
  });
});

describe('★明細に並ぶ売上1・売上2・売上3が実物と同じ★', () => {
  it('車の並びは 2号車 / 3号車 / 4号車（つかさ車は出さない）', () => {
    expect(rep.cars.map((c) => c.label)).toEqual(['2号車', '3号車', '4号車']);
  });

  it('1/21 白石の行 … 売上1=14,480（16,000−高速1,520）/ 売上2=17,100 / 売上3=空欄', () => {
    const c = by['白石正人'].cells.find((x) => x.date === '2026-01-21');
    expect(c.pay).toBe(7475);
    expect(c.hours).toBe(6.5);
    expect(c.carSales).toEqual([14480, 17100, null]);
    expect(c.poolHours).toBe(12.75);
  });

  it('1/23 長野孝の行 … 売上2=26,740（28,100−高速1,360）', () => {
    const c = by['長野孝'].cells.find((x) => x.date === '2026-01-23');
    expect(c.carSales[1]).toBe(26740);
  });

  it('1/22 は4号車だけ＝出た人の売上1・売上2は空欄', () => {
    const c = by['結田航平'].cells.find((x) => x.date === '2026-01-22');
    expect(c.carSales).toEqual([null, null, 27900]);
  });
});

describe('★会社に残る分（つかさの取り分）も期間で合う★', () => {
  it('11日ぶんの合計', () => {
    const want = [
      2588.5, 17350, 39433.55, 44430, 0, 7687.5, 13871, 30962.5, 12160, 43915.85, 31666,
    ];
    const sum = want.reduce((a, b) => a + b, 0);
    expect(rep.ownerShareTotal).toBeCloseTo(sum, 4);
  });
});
