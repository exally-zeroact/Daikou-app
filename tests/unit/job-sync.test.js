'use strict';
// ============================================================
// job-sync 純ロジック テスト (2026-07-31・事務所機能の土台)
//
//   ★何を守るテストか★
//   メーターが localStorage に貯めた「勤務の履歴」を、事務所(売上/請求/給料/集計)で使うために
//   クラウドへ上げる部分。ここが壊れると売上も給料も合わなくなる。
//
//   ★絶対に守る性質(このテストが番人)★
//     1. 業務を絶対に止めない  … 例外を投げない。何が来ても throw しない。
//     2. 二重に上げない        … 同じ勤務を2回送らない(冪等)。
//     3. 値を作らない/歪めない … メーターが確定した距離・料金をそのまま運ぶだけ。丸めも補正もしない。
//     4. 壊れた行は捨てて進む  … 1件おかしくても、残りは正常に上がる。
//
//   ※通信そのもの(fetch)はここでは扱わない。純ロジックだけを決定論的に固める。
// ============================================================
const JobSync = require('../../js/job-sync.js');

// メーターが実際に吐く形(js/business.js getReport() の実測)に合わせた勤務1件
function makeShift(startTime, over) {
  return Object.assign(
    {
      start_time: startTime,
      end_time: startTime + 3600000,
      elapsed_sec: 3600,
      total_distance_m: 12345.6,
      actual_total_m: 8000.4,
      empty_distance_m: 4345.2,
      fare_total_yen: 9800,
      trip_count: 2,
      // ↓ 派生値(保存しない・サーバで持たない)
      actual_ratio: 0.648,
      avg_fare_yen: 4900,
      avg_speed_kmh: 12.3,
      trips: [
        {
          distance_m: 4000.2,
          fare_yen: 4900,
          start_time: startTime + 600000,
          end_time: startTime + 1500000,
          start_address: '愛媛県松山市A',
          end_address: '愛媛県松山市B',
          waypoints: [],
        },
        {
          distance_m: 4000.2,
          fare_yen: 4900,
          start_time: startTime + 1800000,
          end_time: startTime + 2700000,
          start_address: null,
          end_address: null,
          waypoints: [{ address: '経由1', timestamp: startTime + 2000000 }],
        },
      ],
    },
    over || {}
  );
}

describe('job-sync: どの勤務を上げるか選ぶ', () => {
  it('まだ上げていない勤務だけを選ぶ', () => {
    const history = [makeShift(1000), makeShift(2000), makeShift(3000)];
    const sel = JobSync.selectUnsynced(history, ['2000']);
    expect(sel.map((s) => s.start_time)).toEqual([1000, 3000]);
  });

  it('★二重送信しない: 全部同期済みなら0件★', () => {
    const history = [makeShift(1000), makeShift(2000)];
    expect(JobSync.selectUnsynced(history, ['1000', '2000'])).toEqual([]);
  });

  it('古い順に並べる(履歴の並びに関係なく)', () => {
    const history = [makeShift(3000), makeShift(1000), makeShift(2000)];
    const sel = JobSync.selectUnsynced(history, []);
    expect(sel.map((s) => s.start_time)).toEqual([1000, 2000, 3000]);
  });

  it('1回に送る件数に上限がある(端末/通信を詰まらせない)', () => {
    const history = [];
    for (let i = 1; i <= 50; i++) history.push(makeShift(i * 1000));
    const sel = JobSync.selectUnsynced(history, []);
    expect(sel.length).toBe(JobSync.MAX_BATCH);
    // 上限で切っても「古い順」は保たれる = 次回の続きから送れる
    expect(sel[0].start_time).toBe(1000);
  });

  it('★壊れた行は捨てて、残りは通す★', () => {
    const history = [
      makeShift(1000),
      { start_time: null, trips: [] }, // 開始時刻なし = 識別できない
      { start_time: 'abc', trips: [] }, // 数値でない
      makeShift(2000),
      null, // null 行
    ];
    const sel = JobSync.selectUnsynced(history, []);
    expect(sel.map((s) => s.start_time)).toEqual([1000, 2000]);
  });

  it('★何が来ても throw しない(業務を止めない)★', () => {
    expect(() => JobSync.selectUnsynced(null, null)).not.toThrow();
    expect(() => JobSync.selectUnsynced(undefined, undefined)).not.toThrow();
    expect(() => JobSync.selectUnsynced('not an array', [])).not.toThrow();
    expect(() => JobSync.selectUnsynced({}, {})).not.toThrow();
    expect(JobSync.selectUnsynced(null, null)).toEqual([]);
  });
});

describe('job-sync: 送る形に整える', () => {
  it('★距離と料金はメーターの値をそのまま運ぶ(丸めない・補正しない)★', () => {
    const p = JobSync.toPayload(makeShift(1000));
    expect(p.total_distance_m).toBe(12345.6);
    expect(p.actual_total_m).toBe(8000.4);
    expect(p.empty_distance_m).toBe(4345.2);
    expect(p.fare_total_yen).toBe(9800);
    expect(p.trips[0].distance_m).toBe(4000.2);
    expect(p.trips[0].fare_yen).toBe(4900);
  });

  it('派生値(比率・平均)は送らない = サーバで持たない(ズレの元になる)', () => {
    const p = JobSync.toPayload(makeShift(1000));
    expect(p.actual_ratio).toBeUndefined();
    expect(p.avg_fare_yen).toBeUndefined();
    expect(p.avg_speed_kmh).toBeUndefined();
  });

  it('代行(trip)がそのまま入る・住所の null は空文字にする', () => {
    const p = JobSync.toPayload(makeShift(1000));
    expect(p.trips.length).toBe(2);
    expect(p.trips[0].start_address).toBe('愛媛県松山市A');
    expect(p.trips[1].start_address).toBe('');
    expect(p.trips[1].end_address).toBe('');
  });

  it('代行の並びは時刻順・何件目かが分かる(請求書の明細順が毎回同じ)', () => {
    const s = makeShift(1000);
    s.trips = [s.trips[1], s.trips[0]]; // わざと逆順
    const p = JobSync.toPayload(s);
    expect(p.trips[0].start_time).toBeLessThan(p.trips[1].start_time);
    expect(p.trips[0].seq).toBe(1);
    expect(p.trips[1].seq).toBe(2);
  });

  it('数値でない距離/料金の代行は落とす(汚れたデータを倉庫に入れない)', () => {
    const s = makeShift(1000);
    s.trips.push({ distance_m: 'x', fare_yen: 100, start_time: 1, end_time: 2 });
    s.trips.push({ distance_m: 100, fare_yen: null, start_time: 1, end_time: 2 });
    const p = JobSync.toPayload(s);
    expect(p.trips.length).toBe(2);
  });

  it('経由地が多すぎる場合は上限までにする(巨大な送信を作らない)', () => {
    const s = makeShift(1000);
    s.trips[0].waypoints = [];
    for (let i = 0; i < 200; i++) s.trips[0].waypoints.push({ address: 'w' + i, timestamp: i });
    const p = JobSync.toPayload(s);
    expect(p.trips[0].waypoints.length).toBe(JobSync.MAX_WAYPOINTS);
  });

  it('trips が無い/配列でない勤務でも空配列で通す(throwしない)', () => {
    expect(JobSync.toPayload({ start_time: 1 }).trips).toEqual([]);
    expect(JobSync.toPayload({ start_time: 1, trips: 'x' }).trips).toEqual([]);
    expect(() => JobSync.toPayload(null)).not.toThrow();
    expect(JobSync.toPayload(null)).toBe(null);
  });
});

describe('job-sync: 同期済みの記録', () => {
  it('送れた分だけ記録に足す(重複しない・順序は問わない)', () => {
    const merged = JobSync.mergeSynced(['1000'], [2000, 3000]);
    expect(merged.slice().sort()).toEqual(['1000', '2000', '3000']);
  });

  it('同じものを足しても増えない(冪等)', () => {
    const merged = JobSync.mergeSynced(['1000'], [1000]);
    expect(merged).toEqual(['1000']);
  });

  it('記録が増えすぎないよう古いものから間引く', () => {
    const old = [];
    for (let i = 1; i <= JobSync.MAX_SYNCED_KEYS + 30; i++) old.push(String(i * 1000));
    const merged = JobSync.mergeSynced(old, []);
    expect(merged.length).toBe(JobSync.MAX_SYNCED_KEYS);
    // 新しい方(大きい start_time)が残る = 直近の重複送信を確実に防げる
    expect(merged).toContain(String((JobSync.MAX_SYNCED_KEYS + 30) * 1000));
    expect(merged).not.toContain('1000');
  });

  it('壊れた記録が入っていても throw しない', () => {
    expect(() => JobSync.mergeSynced(null, null)).not.toThrow();
    expect(() => JobSync.mergeSynced('x', 'y')).not.toThrow();
    expect(JobSync.mergeSynced(null, [1000])).toEqual(['1000']);
  });
});
