// ============================================================
// ★★給料の 手当・控除★★ 2026-10-06
//
//   司さん「ア」＝手当・控除は ★会社に 残る分も 動かす★
//     手当 500（ガソリン代）／控除 3,000（前借り）⇒ その 人の 払う 額は ＋500 −3,000
//     給料の 総額（staffTotal）も 同じだけ 動き、会社に 残る分（ownerShare）は 逆に 動く
//   ★最低保証の 比べには 入れない★（働いた 分の 額は 変えない）
//   ★無ければ 1円も 変わらない★
//
//   わざと壊す（10-06 実測）：computeDay で 手当を staffTotal に 足さない ⇒ ★赤★
// ============================================================
globalThis.DaikoPayroll = require('../../js/daiko-payroll.js');
globalThis.UriageAgg = require('../../js/uriage-agg.js');
const PD = require('../../js/payroll-daily.js');
const GA = require('../../js/getsuji-agg.js');

const HI = '2026-10-03';
function ctxOf(adjustments) {
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
    ],
    edits: [],
    labels: [{ device_id: 'A', label: '4987' }],
    employees: [
      { employee_id: 'e1', name: '甲', role: '2種', active: true },
      { employee_id: 'e2', name: '乙', role: '2種', active: true },
    ],
    workHours: [{ work_date: HI, employee_id: 'e1', device_id: 'A', hours: 8 }],
    manualDays: [],
    adjustments: adjustments,
  });
}
const R = (x) => Math.round(x * 100) / 100;
const ADJ = [
  { employee_id: 'e1', work_date: HI, kind: 'teate', label: 'ガソリン代', yen: 500 },
  { employee_id: 'e1', work_date: HI, kind: 'koujo', label: '前借り', yen: 3000 },
  // ★働いていない 人（乙）の 手当も 載る★
  { employee_id: 'e2', work_date: HI, kind: 'teate', label: '待機', yen: 1000 },
];

describe('★手当・控除★', () => {
  const nashi = PD.computeDay(HI, ctxOf([]));
  const ari = PD.computeDay(HI, ctxOf(ADJ));
  it('無ければ 今と 同じ（13,300）', () => {
    expect(R(nashi.staffTotal)).toBe(13300);
    expect(R(PD.computeDay(HI, ctxOf(undefined)).staffTotal)).toBe(13300);
  });
  it('人の 行（歩合・保証の 比べ）は 変えない', () => {
    expect(R(ari.staff[0].pay)).toBe(13300);
  });
  it('給料の 総額 ＝ 13,300 ＋ 500 − 3,000 ＋ 1,000 ＝ 11,800', () => {
    expect(R(ari.staffTotal)).toBe(11800);
  });
  it('★会社に 残る分は 逆に 動く★（司さん「ア」）', () => {
    expect(R(ari.ownerShare - nashi.ownerShare)).toBe(1500);
  });
  it('明細：甲 ＝ 13,300 ＋ 500 − 3,000 ＝ 10,800（働いた 分 13,300）／乙 ＝ 1,000', () => {
    const rp = PD.report([HI], ctxOf(ADJ));
    const ko = rp.employees.find((e) => e.employee_id === 'e1');
    const otsu = rp.employees.find((e) => e.employee_id === 'e2');
    expect(R(ko.totalPay)).toBe(10800);
    expect(R(ko.kasegi)).toBe(13300);
    expect(ko.teate).toBe(500);
    expect(ko.koujo).toBe(3000);
    expect(ko.adj.map((a) => a.label)).toEqual(['ガソリン代', '前借り']);
    expect(R(otsu.totalPay)).toBe(1000);
  });
  it('月次集計の 給料と 会社に 残る分も 動く', () => {
    const a = GA.month(2026, 10, ctxOf([]), []);
    const b = GA.month(2026, 10, ctxOf(ADJ), []);
    expect(R(b.payTotal - a.payTotal)).toBe(-1500);
    expect(R(b.ownerShare - a.ownerShare)).toBe(1500);
  });
  it('0円・負の 額・日付の 無い 行は 捨てる', () => {
    const c = ctxOf([
      { employee_id: 'e1', work_date: HI, kind: 'teate', yen: 0 },
      { employee_id: 'e1', work_date: HI, kind: 'teate', yen: -500 },
      { employee_id: 'e1', kind: 'teate', yen: 500 },
    ]);
    expect(R(PD.computeDay(HI, c).staffTotal)).toBe(13300);
  });
});
