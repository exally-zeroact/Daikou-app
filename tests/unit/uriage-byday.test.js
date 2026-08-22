'use strict';
// ============================================================
// ★売上を「日ごと」でも見られるようにする★ 2026-08-09
//
//   ★司さんの言葉★
//     「4 売上を１日おきと車おきで見れないかんやろ」
//
//   ★先に測ったこと（2026-08-09）★
//     今できるのは ★「車おき」だけ★。
//     日ごとは ★1台を開いた時だけ★（その車の日が並ぶ）。
//     ＝「8/1 は全部の車で いくらだったか」が ★どこにも出ない★。
//
//   ★日の切り方★
//     ★業務開始の日を 日本時間で切る★。
//     給料(js/payroll-daily.js dateOf)・請求書(meisai-row.js businessDate)と ★同じ★。
//     代行は夜の仕事なので、これを間違えると
//     ★同じ晩の仕事が2日に分かれる★（請求書で実際に起きた）。
//
//   ★数字は1円も変えない★
//     日ごとの合計 ＝ 車ごとの合計。どちらから見ても同じでなければならない。
// ============================================================
// ★画面と同じ読み込み順にする★ uriage.html は car-name.js を先に読む。
//   ここで用意しないと「名前」「並び」の部品が無い状態を試すことになり、実物と違う。
global.CarName = require('../../js/car-name.js');
const UriageAgg = require('../../js/uriage-agg.js');

// 2026-08-01 22:00 JST 〜 翌 01:00 JST（★日をまたぐ★）
const A_START = Date.UTC(2026, 7, 1, 13, 0); // 08-01 22:00 JST
const B_START = Date.UTC(2026, 7, 1, 16, 0); // 08-02 01:00 JST ★まだ 8/1 の晩★…ではない
const C_START = Date.UTC(2026, 7, 2, 13, 0); // 08-02 22:00 JST

const shifts = [
  {
    shift_id: 's1',
    device_id: 'car-a',
    started_at: new Date(A_START).toISOString(),
    trip_count: 3,
    fare_total_yen: 12000,
    total_distance_m: 40000,
    actual_total_m: 25000,
  },
  {
    shift_id: 's2',
    device_id: 'car-b',
    started_at: new Date(A_START + 1800e3).toISOString(),
    trip_count: 2,
    fare_total_yen: 8000,
    total_distance_m: 30000,
    actual_total_m: 20000,
  },
  {
    shift_id: 's3',
    device_id: 'car-a',
    started_at: new Date(C_START).toISOString(),
    trip_count: 5,
    fare_total_yen: 20000,
    total_distance_m: 60000,
    actual_total_m: 41000,
  },
];
const edits = [{ shift_id: 's1', toll_yen: 1000, bridge_yen: 500, other_yen: 300 }];
const labels = [
  { device_id: 'car-a', label: '1号車', sort_order: 1 },
  { device_id: 'car-b', label: '2号車', sort_order: 2 },
];
const settings = { deduct_toll: true, deduct_bridge: true, deduct_other: false };

describe('★日ごとにまとめる★', () => {
  it('日付ごとに1行になる（新しい順ではなく 日付順）', () => {
    const rows = UriageAgg.byDay(shifts, edits, labels, settings);
    expect(rows.map((r) => r.date)).toEqual(['2026-08-01', '2026-08-02']);
  });

  it('★同じ日は 車をまたいで足す★', () => {
    const rows = UriageAgg.byDay(shifts, edits, labels, settings);
    const d1 = rows.find((r) => r.date === '2026-08-01');
    expect(d1.trip_count, '件数が足せていない').toBe(5); // 3 + 2
    expect(d1.fare_total_yen).toBe(20000); // 12000 + 8000
    // 高速1000 + 橋500 を引く（その他300は引かない設定）
    expect(d1.deduct_yen).toBe(1500);
    expect(d1.net_fare_yen, '★これが売上★').toBe(18500);
  });

  it('★その日に出ていた車が分かる（開いた時に出す）★', () => {
    const rows = UriageAgg.byDay(shifts, edits, labels, settings);
    const d1 = rows.find((r) => r.date === '2026-08-01');
    expect(d1.cars.map((c) => c.label)).toEqual(['1号車', '2号車']);
    expect(d1.cars.find((c) => c.label === '1号車').net_fare_yen).toBe(10500);
    expect(d1.cars.find((c) => c.label === '2号車').net_fare_yen).toBe(8000);
  });

  it('★車の順番は 司さんが決めた並び★（売上・給料と揃える）', () => {
    const rev = [
      { device_id: 'car-a', label: '1号車', sort_order: 2 },
      { device_id: 'car-b', label: '2号車', sort_order: 1 },
    ];
    const rows = UriageAgg.byDay(shifts, edits, rev, settings);
    const d1 = rows.find((r) => r.date === '2026-08-01');
    expect(
      d1.cars.map((c) => c.label),
      '★決めた並びが効いていない★'
    ).toEqual(['2号車', '1号車']);
  });

  it('開いた時に高速代を直せるよう、その日の勤務も持っている', () => {
    const rows = UriageAgg.byDay(shifts, edits, labels, settings);
    const d1 = rows.find((r) => r.date === '2026-08-01');
    expect(d1.shifts.map((s) => s.shift_id).sort()).toEqual(['s1', 's2']);
  });
});

describe('★日本時間で日を切る（夜の仕事）★', () => {
  it('★日本時間 深夜1時に始めた仕事は その日★（UTCで切ると前日になる）', () => {
    const late = [
      {
        shift_id: 'x',
        device_id: 'car-a',
        started_at: new Date(B_START).toISOString(), // 08-02 01:00 JST
        trip_count: 1,
        fare_total_yen: 3000,
        total_distance_m: 1000,
        actual_total_m: 800,
      },
    ];
    const rows = UriageAgg.byDay(late, [], labels, settings);
    expect(rows[0].date, '★UTCで切っている＝日本の日付とズレる★').toBe('2026-08-02');
  });

  it('★日本時間 朝8時に始めた仕事も その日★（UTC切りだと前日に落ちる）', () => {
    const morning = [
      {
        shift_id: 'y',
        device_id: 'car-a',
        started_at: new Date(Date.UTC(2026, 7, 4, 23, 0)).toISOString(), // 08-05 08:00 JST
        trip_count: 1,
        fare_total_yen: 1000,
        total_distance_m: 100,
        actual_total_m: 90,
      },
    ];
    expect(UriageAgg.byDay(morning, [], labels, settings)[0].date).toBe('2026-08-05');
  });
});

describe('★どちらから見ても同じ数字★', () => {
  it('★日ごとの合計 ＝ 車ごとの合計★（1円でも違えばどちらかが嘘）', () => {
    const byDev = UriageAgg.total(UriageAgg.byDevice(shifts, edits, labels, settings));
    const byDay = UriageAgg.total(UriageAgg.byDay(shifts, edits, labels, settings));
    for (const k of ['trip_count', 'fare_total_yen', 'deduct_yen', 'net_fare_yen']) {
      expect(byDay[k], '★' + k + ' が食い違う★').toBe(byDev[k]);
    }
  });

  it('総走行・実車も揃う', () => {
    const a = UriageAgg.total(UriageAgg.byDevice(shifts, edits, labels, settings));
    const b = UriageAgg.total(UriageAgg.byDay(shifts, edits, labels, settings));
    expect(b.total_distance_m).toBe(a.total_distance_m);
    expect(b.actual_total_m).toBe(a.actual_total_m);
  });
});

describe('★印を付けた勤務は 日ごとでも出さない★（車ごとと同じ扱い）', () => {
  it('excluded の勤務は数えない', () => {
    const withEx = shifts.concat([
      {
        shift_id: 'ex',
        device_id: 'car-a',
        started_at: new Date(A_START).toISOString(),
        trip_count: 99,
        fare_total_yen: 99999,
        total_distance_m: 1,
        actual_total_m: 1,
        excluded: true,
      },
    ]);
    const d1 = UriageAgg.byDay(withEx, edits, labels, settings).find(
      (r) => r.date === '2026-08-01'
    );
    expect(d1.trip_count, '★印を付けた勤務まで数えている★').toBe(5);
  });
});

describe('壊れた入力でも落ちない（業務を止めない）', () => {
  it('空・null・日付が読めない行', () => {
    expect(UriageAgg.byDay(null, null, null, null)).toEqual([]);
    expect(UriageAgg.byDay([{ device_id: 'a' }], [], [], null)).toEqual([]); // 日付が無い＝出さない
    expect(UriageAgg.byDay([null, undefined], [], [], null)).toEqual([]);
  });
});
