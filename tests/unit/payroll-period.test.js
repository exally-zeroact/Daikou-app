'use strict';
// ============================================================
// 給与期間の区切り テスト (2026-08-01 実物を読み直して修正)
//
//   ★正解は司さんの実物★ 代行計算表2026.xlsb の 給料1〜8 のヘッダと日付行を全部読んだ結果:
//     給料1 = 1月分 1/21 ~ 1/31 (11日)
//     給料2 = 2月分 2/21 ~ 2/28 ( 8日)   ← 翌月にまたいでいない
//     給料3 = 3月分 3/21 ~ 3/31 (11日)
//     給料4 = 4月分 4/21 ~ 4/30 (10日)
//     給料7 = 7月分 7/21 ~ 7/31 (11日)
//     給料8 = 8月分 8/1  ~ 8/10 (10日)  ← 開始日も長さも変えられる必要がある
//
//   ★つまり「11日ぶん固定」は1月だけたまたま合っていた★
//     本当は「21日から その月の末日まで」＝月末締め。長さは月で変わる。
//     （前に入れた days:11 のままだと 2月が 3/3 まで伸びて、2月分の明細に3月の日が混ざる）
//
//   ★2026-08-01 追記★ 『月別』シートの列が「バ1～10 / バ11～20 / バ21～31」で、
//     **バ21～31 = 279,332 が 給料1(21日〜末日) の8人合計と一致**した。
//     ＝★司さんは給料を月3回に分けて払っている★。給料1〜8はその3期のうちの1つだった。
//     よって既定は 'thirds'（月3回）。'month_end' は1回払いの会社用に残す。
//
//   ★守る性質★
//     1. 既定 = 月3回（1〜10 / 11〜20 / 21〜末日）
//     2. 1回払い（起算日〜月末）にもできる
//     3. 日数固定にもできる（給料8のような 8/1~8/10）
//     4. 前後に送れる / 年をまたいでも落ちない
//     5. 何が来ても throw しない
// ============================================================
const P = require('../../js/payroll-period.js');

const ME = { endMode: 'month_end', startDay: 21 };

describe('★既定＝月3回払い（実物の月別シートのバ3列）★', () => {
  it('1月は 1/1~1/10 ・ 1/11~1/20 ・ 1/21~1/31 の3つ', () => {
    const ps = P.periodsOf(2026, 1);
    expect(ps.length).toBe(3);
    expect(ps.map((p) => p.rangeLabel)).toEqual(['1/1 ~ 1/10', '1/11 ~ 1/20', '1/21 ~ 1/31']);
    expect(ps.map((p) => p.name)).toEqual(['1〜10日', '11〜20日', '21日〜末日']);
    expect(ps.map((p) => p.dates.length)).toEqual([10, 10, 11]);
  });

  it('★2月は最後の期が 2/21~2/28（3月に食い込まない）★', () => {
    const ps = P.periodsOf(2026, 2);
    expect(ps[2].rangeLabel).toBe('2/21 ~ 2/28');
    expect(ps[2].dates.length).toBe(8);
    expect(ps[2].end).toBe('2026-02-28');
  });

  it('うるう年の2月（2028年）は 2/21~2/29', () => {
    const ps = P.periodsOf(2028, 2);
    expect(ps[2].rangeLabel).toBe('2/21 ~ 2/29');
    expect(ps[2].dates.length).toBe(9);
  });

  it('30日までの月（4月）は最後が 4/21~4/30', () => {
    const ps = P.periodsOf(2026, 4);
    expect(ps[2].rangeLabel).toBe('4/21 ~ 4/30');
    expect(ps[2].dates.length).toBe(10);
  });

  it('★3期を合わせるとその月まるごとになる（取りこぼしも重なりも無い）★', () => {
    [1, 2, 4, 12].forEach((m) => {
      const all = P.periodsOf(2026, m).flatMap((p) => p.dates);
      const month = P.monthDates(2026, m);
      expect(all).toEqual(month);
      expect(new Set(all).size).toBe(all.length); // 同じ日が2度出ない
    });
  });

  it('index で1つ取り出せる', () => {
    expect(P.periodOf(2026, 1, null, 2).rangeLabel).toBe('1/21 ~ 1/31');
    expect(P.periodOf(2026, 1, null, 0).rangeLabel).toBe('1/1 ~ 1/10');
    expect(P.periodOf(2026, 1, null, 99).rangeLabel).toBe('1/1 ~ 1/10'); // 範囲外は先頭
  });
});

describe('★1回払い（起算日〜月末）にもできる★', () => {
  it('給料1 = 1月分 1/21〜1/31（11日）', () => {
    const p = P.periodOf(2026, 1, ME);
    expect(p.label).toBe('1月分');
    expect(p.rangeLabel).toBe('1/21 ~ 1/31');
    expect(p.dates.length).toBe(11);
    expect(p.dates[0]).toBe('2026-01-21');
    expect(p.dates[10]).toBe('2026-01-31');
  });

  it('★給料2 = 2月分 2/21〜2/28（8日・3月に食い込まない）★', () => {
    const p = P.periodOf(2026, 2, ME);
    expect(p.rangeLabel).toBe('2/21 ~ 2/28');
    expect(p.dates.length).toBe(8);
    expect(p.end).toBe('2026-02-28');
  });

  it('給料4 = 4月分 4/21〜4/30（10日）', () => {
    const p = P.periodOf(2026, 4, ME);
    expect(p.rangeLabel).toBe('4/21 ~ 4/30');
    expect(p.dates.length).toBe(10);
    expect(p.dates[9]).toBe('2026-04-30');
  });

  it('給料7 = 7月分 7/21〜7/31（司さんが今使っている月）', () => {
    const p = P.periodOf(2026, 7, ME);
    expect(p.label).toBe('7月分');
    expect(p.dates[0]).toBe('2026-07-21');
    expect(p.dates[10]).toBe('2026-07-31');
  });

  it('うるう年の2月（2028年）でも合う', () => {
    const p = P.periodOf(2028, 2, ME);
    expect(p.dates.length).toBe(9);
    expect(p.dates[8]).toBe('2028-02-29');
  });

  it('12月 → 年末で切れる（翌年に食い込まない）', () => {
    const p = P.periodOf(2026, 12, ME);
    expect(p.dates[0]).toBe('2026-12-21');
    expect(p.dates[p.dates.length - 1]).toBe('2026-12-31');
  });

  it('1回払いのときは期は1つだけ', () => {
    expect(P.periodsOf(2026, 1, ME).length).toBe(1);
  });
});

describe('★給料8のような「日数で切る」形にもできる★', () => {
  it('8月分 8/1 ~ 8/10', () => {
    const p = P.periodOf(2026, 8, { startDay: 1, endMode: 'days', days: 10 });
    expect(p.rangeLabel).toBe('8/1 ~ 8/10');
    expect(p.dates.length).toBe(10);
    expect(p.dates[0]).toBe('2026-08-01');
    expect(p.dates[9]).toBe('2026-08-10');
  });

  it('日数で切ると月をまたいでもよい（21日始まり11日分）', () => {
    const p = P.periodOf(2026, 2, { startDay: 21, endMode: 'days', days: 11 });
    expect(p.dates.length).toBe(11);
    expect(p.dates[8]).toBe('2026-03-01');
  });

  it('1日始まり・月末締め＝ふつうの1ヶ月', () => {
    const p = P.periodOf(2026, 7, { endMode: 'month_end', startDay: 1 });
    expect(p.dates.length).toBe(31);
    expect(p.dates[0]).toBe('2026-07-01');
    expect(p.dates[30]).toBe('2026-07-31');
  });
});

describe('その月まるごとの日付（月次集計が使う）', () => {
  it('1月は31日ぶん', () => {
    const d = P.monthDates(2026, 1);
    expect(d.length).toBe(31);
    expect(d[0]).toBe('2026-01-01');
    expect(d[30]).toBe('2026-01-31');
  });
  it('2月は28日ぶん・うるう年は29日ぶん', () => {
    expect(P.monthDates(2026, 2).length).toBe(28);
    expect(P.monthDates(2028, 2).length).toBe(29);
  });
  it('壊れた値でも落ちない', () => {
    expect(() => P.monthDates(null, null)).not.toThrow();
  });
});

describe('前後に送れる', () => {
  it('次の月へ', () => {
    expect(P.shift({ year: 2026, month: 7 }, 1)).toEqual({ year: 2026, month: 8 });
  });
  it('12月の次は翌年1月', () => {
    expect(P.shift({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
  });
  it('1月の前は前年12月', () => {
    expect(P.shift({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });
});

describe('壊れた値でも止まらない', () => {
  it('★何が来ても throw しない★', () => {
    expect(() => P.periodOf(null, null, null)).not.toThrow();
    expect(() => P.periodOf('x', 'y', 'z')).not.toThrow();
    expect(() => P.shift(null, null)).not.toThrow();
    expect(() => P.periodOf(2026, 7, { endMode: 'なにこれ' })).not.toThrow();
  });

  it('おかしな開始日は既定(21日)に倒す', () => {
    const p = P.periodOf(2026, 7, { endMode: 'month_end', startDay: 99 });
    expect(p.dates[0]).toBe('2026-07-21');
  });

  it('知らない締め方は既定(月3回)に倒す', () => {
    expect(P.periodsOf(2026, 7, { endMode: 'なにこれ' }).length).toBe(3);
  });

  it('おかしな日数は既定に倒す', () => {
    const p = P.periodOf(2026, 7, { startDay: 21, endMode: 'days', days: -5 });
    expect(p.dates.length).toBe(11);
  });

  it('月が範囲外でも日付は作れる', () => {
    expect(() => P.periodOf(2026, 13)).not.toThrow();
    expect(() => P.periodOf(2026, 0)).not.toThrow();
  });
});
