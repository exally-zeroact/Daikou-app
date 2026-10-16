'use strict';
// ============================================================
// ★★辞めた 人（今いる人を 外した 人）も、その 期間に 働いた・手当控除が ある なら 明細に 出る★★ 2026-10-16
//
//   前：report() が active で 人を 絞り、外した 人は 働いた 期間の 明細・紙・本人の 画面から 丸ごと 消えた。
//       総額（staffTotalAll）には 残るので、人の 合計と 総額が 合わなかった（対立役：20,550 の うち 10,200 が どの 明細にも 出ない）。
//       画面の 字（「辞めた人は『今いる人』を 外します。過去の明細と金額はそのまま残ります」）と 計算が 食い違っていた。
//   今：今いる人は 今まで 通り 全員。外した 人は その 期間に 働いた 日か 手当・控除が ある 時だけ 出る。
//   ★額は 1円も 変えない★（日ごとの 計算は 前から 外した 人を 含んでいた）
//   ★わざと壊して 赤に なった 記録（2026-10-16）★：report の 絞りを active だけに 戻す → 2本 赤
// ============================================================
globalThis.DaikoPayroll = require('../../js/daiko-payroll.js');
globalThis.UriageAgg = require('../../js/uriage-agg.js');
const PD = require('../../js/payroll-daily.js');

const HI = '2026-10-03';
const HI2 = '2026-10-04';
function ctxOf(e2active, adjustments) {
  return PD.buildCtx({
    payrollSettings: { roles: { '2種': { rate: 0.35, floor: 1150 } } },
    shifts: [
      {
        shift_id: 's1',
        device_id: 'A',
        started_at: '2026-10-03T11:00:00Z',
        elapsed_sec: 28800,
        fare_total_yen: 40000,
      },
      {
        shift_id: 's2',
        device_id: 'B',
        started_at: '2026-10-03T11:00:00Z',
        elapsed_sec: 28800,
        fare_total_yen: 30000,
      },
    ],
    edits: [],
    labels: [
      { device_id: 'A', label: '4987' },
      { device_id: 'B', label: '1173' },
    ],
    employees: [
      { employee_id: 'e1', name: '甲', role: '2種', active: true },
      { employee_id: 'e2', name: '乙', role: '2種', active: e2active },
      { employee_id: 'e3', name: '丙', role: '2種', active: false }, // 何も 無い 辞めた 人
    ],
    workHours: [
      { work_date: HI, employee_id: 'e1', device_id: 'A', hours: 8 },
      { work_date: HI, employee_id: 'e2', device_id: 'B', hours: 8 },
    ],
    manualDays: [],
    adjustments: adjustments || [],
  });
}
const R = (x) => Math.round(x * 100) / 100;
const goukei = (rp) => R(rp.employees.reduce((a, e) => a + e.totalPay, 0));

describe('★辞めた 人の 明細★', () => {
  it('外した 人も 働いた 期間は 明細に 出て、人の 合計 ＝ 総額', () => {
    const rp = PD.report([HI, HI2], ctxOf(false));
    const na = rp.employees.map((e) => e.name);
    expect(na, '★働いた 期間なのに 辞めた 人が 明細から 消えた★').toContain('乙');
    expect(goukei(rp), '★人の 合計と 総額が 合わない★').toBe(R(rp.staffTotalAll));
  });
  it('今いる人の 時と 額が 1円も 変わらない', () => {
    const ima = PD.report([HI, HI2], ctxOf(true));
    const yame = PD.report([HI, HI2], ctxOf(false));
    const of = (rp, id) => rp.employees.find((e) => e.employee_id === id);
    expect(R(of(yame, 'e2').totalPay)).toBe(R(of(ima, 'e2').totalPay));
    expect(R(yame.staffTotalAll)).toBe(R(ima.staffTotalAll));
  });
  it('外した 人の 手当・控除だけ ある 期間も 出る（総額と 合う）', () => {
    const adj = [{ employee_id: 'e3', work_date: HI2, kind: 'koujo', label: '精算', yen: 2000 }];
    const rp = PD.report([HI2], ctxOf(true, adj));
    expect(rp.employees.map((e) => e.name)).toContain('丙');
    expect(goukei(rp)).toBe(R(rp.staffTotalAll));
  });
  it('働いても 手当・控除も 無い 期間の 辞めた 人は 出ない（今まで 通り）', () => {
    const rp = PD.report([HI2], ctxOf(false));
    const na = rp.employees.map((e) => e.name);
    expect(na).not.toContain('乙');
    expect(na).not.toContain('丙');
    expect(na).toContain('甲'); // 今いる人は 働いていなくても 出る（今まで 通り）
  });
  it('途中で 外した 人（期間の 前半だけ 働いた）も 出る・2通りの 数え方で 総額と 合う', () => {
    // 2通り：①人の 行の 払う額の 和 ②日ごとの 計算（computeDay）の staffTotal を 日で 足した 物
    const ctx = ctxOf(false, [
      { employee_id: 'e2', work_date: HI2, kind: 'teate', label: '最後の 精算', yen: 1500 },
    ]);
    const days = [HI, HI2];
    const rp = PD.report(days, ctx);
    expect(rp.employees.map((e) => e.name)).toContain('乙');
    const hitori = goukei(rp);
    const higoto = R(days.reduce((a, d) => a + PD.computeDay(d, ctx).staffTotal, 0));
    expect(hitori, '★人の 合計と 日ごとの 総額が 合わない★').toBe(higoto);
    // 人の 行の 中でも：働いた 分 ＋ 手当 − 控除 ＝ 払う 額
    rp.employees.forEach((e) => {
      const kasegi = e.cells.reduce((a, c) => a + (c.pay || 0), 0);
      expect(R(kasegi + e.teate - e.koujo), e.name).toBe(R(e.totalPay));
    });
  });
});
