// ============================================================
// ★★実費は 入れた 物を 全部 売上から 引く★★ 2026-10-24（件J）
//   司さん「実費は足したもの全て引く形やないと経費の意味ないやないか」
//   ＝08-01 の「引く 物を 選べる」形（dk_sales_settings の deduct_* ・dk_uriage_rireki の 何日から）を やめる。
//
//   材料：会社の 設定は「その他を 引かない」（本番の 1社と 同じ 形）・その他 1,000円
//     ・メーターの 日（9/10・車 d1・売上 30,000・その他 1,000）
//     ・手で 入れた 日（9/11・車 d2・売上 10,000・その他 1,000）
//   守る 事：4か所 全部で「その他の 1,000円が 引かれる」
//     ①給料（payroll-daily の buildCtx：メーターの 日・手入力の 日）
//     ②月次集計（getsuji-agg の month）
//     ③売上表（uriage-agg の byDevice・byDay）
//     ④紙（kami-shukei：引く 物の 名前に その他が 入る・経費の 額が 引いた 額と 同じ）
//   ★設定・記録が 何で あっても 同じ 額★（引く／引かないの 選びは もう 無い）
// ============================================================
const U = require('../../js/uriage-agg.js');
const P = require('../../js/payroll-daily.js');
const G = require('../../js/getsuji-agg.js');
const K = require('../../js/kami-shukei.js');

// 本番の 1社と 同じ 形の 設定（その他を 引かない）
const SONOTA_HIKANAI = { deduct_toll: true, deduct_bridge: true, deduct_other: false };
const ZENBU_HIKANAI = { deduct_toll: false, deduct_bridge: false, deduct_other: false };

const SHIFTS = [
  {
    shift_id: 's1',
    device_id: 'd1',
    started_at: '2026-09-10T20:00:00+09:00',
    elapsed_sec: 3 * 3600,
    fare_total_yen: 30000,
    trip_count: 3,
  },
];
const EDITS = [{ shift_id: 's1', toll_yen: 0, bridge_yen: 0, other_yen: 1000 }];
const MANUAL = [
  {
    work_date: '2026-09-11',
    device_id: 'd2',
    sales_yen: 10000,
    toll_yen: 0,
    bridge_yen: 0,
    other_yen: 1000,
    hours: 2,
  },
];

function raw(ss, extra) {
  return Object.assign(
    {
      shifts: SHIFTS,
      edits: EDITS,
      labels: [],
      manualDays: MANUAL,
      employees: [{ employee_id: 'e1', name: '甲', role: '1種', pay_rate: null, pay_floor: null }],
      workHours: [
        { work_date: '2026-09-10', employee_id: 'e1', device_id: 'd1', hours: 3 },
        { work_date: '2026-09-11', employee_id: 'e1', device_id: 'd2', hours: 2 },
      ],
      payrollSettings: { roles: { '1種': { rate: 0.3, floor: 0 } }, pay_extra: null },
      salesSettings: ss,
    },
    extra || {}
  );
}

describe('件J 実費は 入れた 物を 全部 引く（その他を 引かない 設定でも）', () => {
  it('deductOf：設定に 関わらず 高速・橋・その他・足した 物を 全部 足す', () => {
    const e = { toll_yen: 1200, bridge_yen: 300, other_yen: 1000, expenses: { k1: 500 } };
    for (const ss of [SONOTA_HIKANAI, ZENBU_HIKANAI, null, undefined])
      expect(U.deductOf(e, ss)).toBe(3000);
  });

  it('①給料：メーターの 日も 手入力の 日も その他 1,000円が 引かれる', () => {
    for (const ss of [SONOTA_HIKANAI, ZENBU_HIKANAI, null]) {
      const c = P.buildCtx(raw(ss));
      expect(c.byDate['2026-09-10'].d1.expense).toBe(1000);
      expect(c.byDate['2026-09-11'].d2.expense).toBe(1000);
      expect(c.yakuDame).toEqual([]);
    }
  });

  it('①給料：古い 記録（何日から）が 残って いても 読まない＝止めない・全部 引く', () => {
    const c = P.buildCtx(
      raw(SONOTA_HIKANAI, {
        uriageRireki: [{ key: 'other', from_date: '2026-01-01', value: false }],
      })
    );
    expect(c.byDate['2026-09-10'].d1.expense).toBe(1000);
    expect(c.yakuDame).toEqual([]);
    // 読めなかった（null）でも 止めない＝もう 使わない 物で 給料を 止めない
    const c2 = P.buildCtx(raw(SONOTA_HIKANAI, { uriageRireki: null }));
    expect(c2.byDate['2026-09-11'].d2.expense).toBe(1000);
    expect(c2.yakuDame).toEqual([]);
  });

  it('②月次集計：経費 2,000円・売上 38,000円（引いた 後）', () => {
    const m = G.month(2026, 9, P.buildCtx(raw(SONOTA_HIKANAI)), []);
    expect(m.expense).toBe(2000);
    expect(m.salesTotal).toBe(30000 + 10000 - 2000);
  });

  it('③売上表：車ごと・日ごと とも その他 1,000円が 引かれる', () => {
    const conv = P.manualAsShifts(MANUAL);
    const sh = SHIFTS.concat(conv.shifts);
    const ed = EDITS.concat(conv.edits);
    const cars = U.byDevice(sh, ed, [], SONOTA_HIKANAI);
    const d1 = cars.find((r) => r.device_id === 'd1');
    const d2 = cars.find((r) => r.device_id === 'd2');
    expect(d1.deduct_yen).toBe(1000);
    expect(d1.net_fare_yen).toBe(29000);
    expect(d2.deduct_yen).toBe(1000);
    expect(d2.net_fare_yen).toBe(9000);
    // 経費（入れた 実費 全部）＝売上から 引いた 分（同じ 数）
    cars.forEach((r) => expect(r.deduct_yen).toBe(r.expense_yen));
    const days = U.byDay(sh, ed, [], SONOTA_HIKANAI);
    expect(days.map((d) => d.deduct_yen)).toEqual([1000, 1000]);
    expect(U.total(days).net_fare_yen).toBe(38000);
  });

  it('④紙：引く 物の 名前に その他が 入り、経費の 額は 引いた 額と 同じ', () => {
    const hiku = (k) => k.kinds.filter((x) => x.hiku).map((x) => x.label);
    const nai = (k) => k.kinds.filter((x) => !x.hiku).map((x) => x.label);
    const k0 = K.kaisha('', 2026, 9, null, SONOTA_HIKANAI, null, true);
    expect(hiku(k0)).toEqual(['高速代', '橋代', 'その他']);
    expect(nai(k0)).toEqual([]);
    const kinds = [
      { kind_id: 'toll', label: '高速' },
      { kind_id: 'bridge', label: '橋' },
      { kind_id: 'other', label: '雑費' },
      { kind_id: 'x1', label: '駐車場' },
    ];
    const k1 = K.kaisha('', 2026, 9, null, ZENBU_HIKANAI, kinds, true);
    expect(hiku(k1)).toEqual(['高速', '橋', '雑費', '駐車場']);
    const m = G.month(2026, 9, P.buildCtx(raw(SONOTA_HIKANAI)), []);
    m.dame = false; // 払い方の 止めとは 別（ここは 経費の 額だけ 見る）
    expect(K.getsujiData(m, []).keihi).toBe(2000);
  });
});
