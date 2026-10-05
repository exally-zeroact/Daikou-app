'use strict';
// ============================================================
// ★★売上表の 売上 ＝ 月次集計・給料の 売上（会社が 足した 実費も 引く）★★ 2026-10-05
//
//   対立役（10-05）が 見つけた：UriageAgg.byDevice は 古い 3つ（高速・橋・その他）だけを
//   詰め直して 引いていた ⇒ ★会社が 足した 実費（edit.expenses）が 引かれず★
//   売上表の 売上が 月次集計・給料（PayrollDaily.buildCtx は edit を 丸ごと 渡す）より 多く 出た。
//   本番 10-05 実測：足した 実費に 額が 入った 行 0行＝今の 数字は 1円も 変わらない。
//
//   ★2つの 道で 同じ 数か★を 突き合わせる（片方の 決まりを 写して 比べない）
//   わざと壊す（10-05）：uriage-agg.js の deductOf へ 渡す expenses を 外す ⇒ 赤
// ============================================================
global.UriageAgg = require('../../js/uriage-agg.js');
const Agg = global.UriageAgg;
const PD = require('../../js/payroll-daily.js');

const SH = [
  { shift_id: 's1', device_id: 'A', started_at: '2026-09-02T11:00:00Z', fare_total_yen: 30000 },
  { shift_id: 's2', device_id: 'A', started_at: '2026-09-02T14:00:00Z', fare_total_yen: 12000 },
  { shift_id: 's3', device_id: 'B', started_at: '2026-09-02T12:00:00Z', fare_total_yen: 20000 },
];
const ED = [
  { shift_id: 's1', toll_yen: 1000, bridge_yen: 0, other_yen: 0, expenses: { kmx1: 700 } },
  { shift_id: 's2', toll_yen: 0, bridge_yen: 500, other_yen: 0, expenses: { kmx1: 300, kmx2: 50 } },
  { shift_id: 's3', toll_yen: 0, bridge_yen: 0, other_yen: 0, expenses: {} },
];

function kyuryoNoUriage(settings) {
  const ctx = PD.buildCtx({ shifts: SH, edits: ED, labels: [], salesSettings: settings });
  const out = {};
  Object.keys(ctx.byDate).forEach((d) => {
    Object.keys(ctx.byDate[d]).forEach((dev) => {
      const c = ctx.byDate[d][dev];
      out[dev] = (out[dev] || 0) + c.sales - c.expense;
    });
  });
  return out;
}

describe('★売上表と 給料・月次集計の 売上が 車ごとに 一致する★', () => {
  for (const [na, st] of [
    ['既定', null],
    ['全部 引く', { deduct_toll: true, deduct_bridge: true, deduct_other: true }],
    ['何も 引かない', { deduct_toll: false, deduct_bridge: false, deduct_other: false }],
  ]) {
    it(na, () => {
      const uri = {};
      Agg.byDevice(SH, ED, [], st).forEach((r) => {
        uri[r.device_id] = r.net_fare_yen;
      });
      const kyu = kyuryoNoUriage(st);
      expect(Object.keys(kyu).sort(), '★車の 数が 違う★').toEqual(['A', 'B']);
      expect(uri, '★売上表の 売上が 給料の 売上と 違う★').toEqual(kyu);
    });
  }

  it('★足した 実費（1,050円）が 売上から 引かれている★（何も 引かない 設定でも）', () => {
    const r = Agg.byDevice(SH, ED, [], {
      deduct_toll: false,
      deduct_bridge: false,
      deduct_other: false,
    }).find((x) => x.device_id === 'A');
    expect(r.deduct_yen).toBe(1050);
    expect(r.net_fare_yen).toBe(42000 - 1050);
    expect(r.expense_yen, '★実費の 全部に 足した 物が 入っていない★').toBe(1000 + 500 + 1050);
  });

  it('★日ごとも 同じ★（byDay は 日の中で byDevice を 通る）', () => {
    const d = Agg.byDay(SH, ED, [], null);
    const g = d.reduce((a, x) => a + (x.net_fare_yen || 0), 0);
    const kyu = kyuryoNoUriage(null);
    expect(g).toBe(kyu.A + kyu.B);
  });
});
