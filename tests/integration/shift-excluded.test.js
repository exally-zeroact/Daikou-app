'use strict';
// ============================================================
// ★試し打ちの勤務を「消さずに集計から外す」★ 2026-08-06
//
//   司さん「★0mの3件は消さない★」
//   指示役「0m 3行の印付け」
//
//   ★実物（本番・2026-08-06 実測）★
//     2026-08-03 04:51 / 05:01 / 05:08（日本時間 13:51/14:01/14:08）
//     総距離 0m・0.71m・0m ／ 実車0m ／ 0円 ／ ★代行0件★
//     ＝較正の日に、業務開始→すぐ終了を押した試し打ち。
//
//   ★決めたこと★
//     ・記録は残す（消すと後で何が起きたか追えない）
//     ・売上表・給料・月次には★出さない★（中身の無い日が並ぶと数字が読みにくい）
//     ・なぜ外したかを note に残す
// ============================================================
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const UA = require(path.join(ROOT, 'js', 'uriage-agg.js'));
const PD = require(path.join(ROOT, 'js', 'payroll-daily.js'));

const DEV = '00000000-0000-4000-9000-000000000001';
const real = (over) =>
  Object.assign(
    {
      shift_id: 's-real',
      device_id: DEV,
      started_at: '2026-08-04T09:00:00Z',
      ended_at: '2026-08-04T18:00:00Z',
      elapsed_sec: 32400,
      total_distance_m: 40000,
      actual_total_m: 18000,
      fare_total_yen: 9800,
      trip_count: 3,
      excluded: false,
    },
    over || {}
  );

// 8/3 の試し打ち3件（実物と同じ形）
const tameshi = [
  real({
    shift_id: 's-0',
    started_at: '2026-08-03T04:51:00Z',
    total_distance_m: 0,
    actual_total_m: 0,
    fare_total_yen: 0,
    trip_count: 0,
    elapsed_sec: 30,
    excluded: true,
  }),
  real({
    shift_id: 's-1',
    started_at: '2026-08-03T05:01:00Z',
    total_distance_m: 0.711891158653119,
    actual_total_m: 0,
    fare_total_yen: 0,
    trip_count: 0,
    elapsed_sec: 40,
    excluded: true,
  }),
  real({
    shift_id: 's-2',
    started_at: '2026-08-03T05:08:00Z',
    total_distance_m: 0,
    actual_total_m: 0,
    fare_total_yen: 0,
    trip_count: 0,
    elapsed_sec: 25,
    excluded: true,
  }),
];

describe('★売上表に出さないこと★', () => {
  it('印を付けた勤務は1つも出ない', () => {
    const r = UA.byDevice(tameshi, [], [], null);
    expect(JSON.stringify(r), '★試し打ちが売上表に出ている★').not.toContain('s-0');
    // 車そのものが1台も出てこない（空の列を作らない）
    expect(JSON.stringify(r), '★試し打ちの車が売上表に並んでいる★').not.toContain(DEV);
  });

  it('★本物の勤務は今までどおり出る★', () => {
    const r = UA.byDevice([real()], [], [], null);
    expect(JSON.stringify(r), '本物まで消えている').toContain('9800');
  });

  it('★混ざっていても、本物だけ出る★', () => {
    const mixed = UA.byDevice(tameshi.concat([real()]), [], [], null);
    const only = UA.byDevice([real()], [], [], null);
    expect(JSON.stringify(mixed), '★試し打ちが混ざって数字が変わる★').toBe(JSON.stringify(only));
  });

  it('印が無い（古い行）は今までどおり出る＝後方互換', () => {
    const old = real({ shift_id: 's-old' });
    delete old.excluded;
    expect(JSON.stringify(UA.byDevice([old], [], [], null))).toContain('9800');
  });
});

describe('★給料・月次に入れないこと★', () => {
  const ctx = (shifts) =>
    PD.buildCtx({ shifts: shifts, edits: [], labels: [], employees: [], workHours: [] });

  it('印を付けた勤務は日付そのものが出てこない', () => {
    const c = ctx(tameshi);
    expect(Object.keys(c.byDate), '★試し打ちの日が給料に出ている★').toEqual([]);
  });

  it('★本物だけの時と数字が1円も変わらない★', () => {
    const a = ctx(tameshi.concat([real()]));
    const b = ctx([real()]);
    expect(JSON.stringify(a.byDate), '★試し打ちが給料の数字を動かしている★').toBe(
      JSON.stringify(b.byDate)
    );
  });

  it('印を付けた車は「知っている車」にも入らない（明細に空の列を作らない）', () => {
    const c = ctx(tameshi);
    expect(c.devices).toEqual([]);
  });

  it('印が無い（古い行）は今までどおり使う＝後方互換', () => {
    const old = real({ shift_id: 's-old' });
    delete old.excluded;
    expect(Object.keys(ctx([old]).byDate)).toEqual(['2026-08-04']);
  });
});

describe('★消していないこと（記録は残す）★', () => {
  const fs = require('fs');
  const SQL = fs.readFileSync(path.join(ROOT, 'supabase', 'apply-shift-excluded.sql'), 'utf8');

  it('★delete していない★（司さん「0mの3件は消さない」）', () => {
    expect(SQL, '★消してしまっている★').not.toMatch(/delete\s+from\s+daikome\.dk_shifts/i);
    expect(SQL).toMatch(/update daikome\.dk_shifts/i);
  });

  it('なぜ外したかを残している', () => {
    expect(SQL).toContain('note');
    expect(SQL).toContain('試し打ち');
  });

  it('★本物の勤務に印を付けない条件になっている★', () => {
    // 代行が1件でもある / 売上がある / 距離がある なら対象外
    expect(SQL).toMatch(/fare_total_yen, 0\) = 0/);
    expect(SQL).toMatch(/trip_count, 0\) = 0/);
    expect(SQL).toMatch(/total_distance_m, 0\) < 10/);
    expect(SQL).toMatch(/not exists \(select 1 from daikome\.dk_trips/);
  });

  it('何度流しても増えない（既に印が付いた行は触らない）', () => {
    expect(SQL).toMatch(/s\.excluded = false/);
  });
});
