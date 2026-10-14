// ============================================================
// 事務所が 直した 売上（dk_shift_edits.uriage_yen）を 読む 1か所＝UriageAgg.uriageOf 2026-10-14
//
//   司さん「赤丸の売上の数も任意でユーザーが修正できるようにしとけよ」
//   司さん「請求書や給料のとこの売上かえたら変えた最後のやつで合わせろや」
//
//   守る 事：
//     ①空（null/無い）＝メーターの 確定値。0 は 0（空と 0 を 取り違えない）
//     ②負・小数・字は null＝メーターの 額に 倒さない（呼ぶ 側が 止めて 知らせる）
//     ③給料（payroll-daily）と 売上表（uriage-agg）が 同じ 額を 使う
//     ④直しが 1件も 無ければ 前と 1円も 変わらない
//     ⑤読めない 業務は ctx.uriageDame に 出る（給料の 画面が 明細・紙を 止める）
// ============================================================
const U = require('../../js/uriage-agg.js');
const P = require('../../js/payroll-daily.js');

function shift(id, dev, fare, sec) {
  return {
    shift_id: id,
    device_id: dev,
    started_at: '2026-09-10T20:00:00+09:00',
    elapsed_sec: sec || 3600,
    fare_total_yen: fare,
    trip_count: 1,
  };
}

describe('① ② uriageOf の 決まり', () => {
  const s = shift('a', 'd1', 9800);
  it('空・無い＝メーター', () => {
    expect(U.uriageOf(s, null)).toBe(9800);
    expect(U.uriageOf(s, {})).toBe(9800);
    expect(U.uriageOf(s, { uriage_yen: null })).toBe(9800);
  });
  it('直した 額', () => {
    expect(U.uriageOf(s, { uriage_yen: 7000 })).toBe(7000);
  });
  it('0 は 0（空と 取り違えない）', () => {
    expect(U.uriageOf(s, { uriage_yen: 0 })).toBe(0);
  });
  for (const bad of [-1, 12.5, '9800', NaN, Infinity, {}]) {
    it('壊れた 形 ' + JSON.stringify(bad) + ' は null（メーターに 倒さない）', () => {
      expect(U.uriageOf(s, { uriage_yen: bad })).toBeNull();
    });
  }
});

describe('③ ④ ⑤ 給料と 売上表', () => {
  const shifts = [
    shift('a', 'd1', 9800, 3600),
    shift('b', 'd1', 5000, 1800),
    shift('c', 'd2', 7000),
  ];
  const edits = [
    { shift_id: 'a', uriage_yen: 8000, toll_yen: 500 },
    { shift_id: 'b', toll_yen: 0 },
  ];
  const raw = (ed) => ({
    shifts,
    edits: ed,
    employees: [],
    workHours: [],
    manualDays: [],
    labels: [],
  });

  it('③ 給料の 車の 売上＝直した 額＋メーター（同じ 車 2回）・売上表と 同じ', () => {
    const c = P.buildCtx(raw(edits));
    const d = Object.keys(c.byDate)[0];
    expect(c.byDate[d].d1.sales).toBe(8000 + 5000);
    expect(c.byDate[d].d2.sales).toBe(7000);
    const rows = U.byDevice(shifts, edits, [], null);
    const r1 = rows.find((r) => r.device_id === 'd1');
    expect(r1.fare_total_yen).toBe(c.byDate[d].d1.sales);
    expect(r1.uriage_naoshi).toBe(1);
    expect(c.uriageDame).toEqual([]);
  });

  it('④ 直しが 無ければ メーターの 合計（前と 同じ）', () => {
    const ed = [{ shift_id: 'a', toll_yen: 500 }];
    const c = P.buildCtx(raw(ed));
    const d = Object.keys(c.byDate)[0];
    expect(c.byDate[d].d1.sales).toBe(9800 + 5000);
    const rows = U.byDevice(shifts, ed, [], null);
    expect(rows.reduce((t, r) => t + r.fare_total_yen, 0)).toBe(9800 + 5000 + 7000);
    expect(U.total(rows).uriage_naoshi).toBe(0);
  });

  it('⑤ 読めない 直しは 給料の uriageDame と 売上表の uriage_dame に 出る（メーターの 額を 足さない）', () => {
    const ed = [{ shift_id: 'a', uriage_yen: -100 }];
    const c = P.buildCtx(raw(ed));
    expect(c.uriageDame).toEqual(['a']);
    const d = Object.keys(c.byDate)[0];
    expect(c.byDate[d].d1.sales).toBe(5000);
    const t = U.total(U.byDevice(shifts, ed, [], null));
    expect(t.uriage_dame).toBe(1);
    expect(t.fare_total_yen).toBe(5000 + 7000);
  });
});

describe('月次（GetsujiAgg）も 読めない 直しが 在れば 止める', () => {
  it('ctx.uriageDame が 在れば out.dame（売上・税・現金を 出さない）', () => {
    const G = require('../../js/getsuji-agg.js');
    const ctx = P.buildCtx({
      shifts: [shift('a', 'd1', 9800)],
      edits: [{ shift_id: 'a', uriage_yen: -1 }],
      employees: [],
      workHours: [],
      manualDays: [],
      labels: [],
    });
    const r = G.month(2026, 9, ctx, []);
    expect(r.dame).toBe(true);
    expect(r.riyuu).toContain('売上の 直し');
  });
});
