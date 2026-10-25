// ============================================================
// 事務所が 直した 回数・実車距離・総走行距離（dk_shift_edits の *_naoshi）を 読む 1か所＝UriageAgg.kazuOf 2026-10-25
//
//   司さん「入力のドロップダウンの中身でなぜつかさしか回数、実車距離、総走行距離がない？
//          全部の車に自動反映できるもので（修正できるように）つけろよ」
//
//   守る 事：
//     ①空（null/無い）＝メーターの 数。0 は 0（空と 0 を 取り違えない）
//     ②負・小数・字は メーターの 数（保存の 口で 止める＝入らない 筈の 物）
//     ③給料の 材料（payroll-daily の trips/jissha_m/sou_m）と 売上表（uriage-agg）が 同じ 数を 使う
//     ④直しが 1件も 無ければ 前と 同じ 数
//   わざと壊す：payroll-daily の kazuOf を n(s.trip_count) 等に 戻す ⇒ ③が 赤
// ============================================================
const U = require('../../js/uriage-agg.js');
const P = require('../../js/payroll-daily.js');

function shift(id, dev, trips, jissha, sou) {
  return {
    shift_id: id,
    device_id: dev,
    started_at: '2026-10-10T20:00:00+09:00',
    elapsed_sec: 3600,
    fare_total_yen: 9800,
    trip_count: trips,
    actual_total_m: jissha,
    total_distance_m: sou,
  };
}

describe('① ② kazuOf の 決まり', () => {
  const s = shift('a', 'd1', 4, 12000, 30000);
  it('空・無い＝メーター', () => {
    for (const e of [null, {}, { trip_count_naoshi: null }]) {
      const k = U.kazuOf(s, e);
      expect([k.trip_count, k.actual_total_m, k.total_distance_m, k.naoshi]).toEqual([
        4,
        12000,
        30000,
        false,
      ]);
    }
  });
  it('直した 数（列ごと）', () => {
    const k = U.kazuOf(s, { trip_count_naoshi: 5, actual_total_m_naoshi: 15000 });
    expect([k.trip_count, k.actual_total_m, k.total_distance_m, k.naoshi]).toEqual([
      5,
      15000,
      30000,
      true,
    ]);
  });
  it('0 は 0（空と 取り違えない）', () => {
    expect(U.kazuOf(s, { total_distance_m_naoshi: 0 }).total_distance_m).toBe(0);
  });
  for (const bad of [-1, 12.5, '5', NaN, Infinity, {}]) {
    it('壊れた 形 ' + JSON.stringify(bad) + ' は メーター', () => {
      expect(U.kazuOf(s, { trip_count_naoshi: bad }).trip_count).toBe(4);
    });
  }
});

describe('③ ④ 給料の 材料と 売上表', () => {
  const shifts = [shift('a', 'd1', 4, 12000, 30000), shift('b', 'd1', 2, 5000, 9000)];
  const raw = (ed) => ({
    shifts,
    edits: ed,
    employees: [],
    workHours: [],
    manualDays: [],
    labels: [],
  });
  it('③ 直した 数が 給料の 材料にも 売上表にも 入る（同じ 数）', () => {
    const ed = [{ shift_id: 'a', trip_count_naoshi: 6, total_distance_m_naoshi: 31000 }];
    const c = P.buildCtx(raw(ed));
    const d = Object.keys(c.byDate)[0];
    expect([c.byDate[d].d1.trips, c.byDate[d].d1.jissha_m, c.byDate[d].d1.sou_m]).toEqual([
      6 + 2,
      12000 + 5000,
      31000 + 9000,
    ]);
    const r = U.byDevice(shifts, ed, [], null).find((x) => x.device_id === 'd1');
    expect([r.trip_count, r.actual_total_m, r.total_distance_m]).toEqual([8, 17000, 40000]);
    expect(c.uriageDame).toEqual([]);
  });
  it('④ 直しが 無ければ メーターの 合計', () => {
    const c = P.buildCtx(raw([]));
    const d = Object.keys(c.byDate)[0];
    expect([c.byDate[d].d1.trips, c.byDate[d].d1.jissha_m, c.byDate[d].d1.sou_m]).toEqual([
      6, 17000, 39000,
    ]);
  });
});
