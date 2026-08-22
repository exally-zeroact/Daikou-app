'use strict';
// ============================================================
// 日ごとの給料 → 明細（生データからの組み立て）テスト 2026-08-01
//
//   ★正解は司さんの実物★ 代行計算表2026.xlsb の『計算』シートが出している値そのもの。
//   金額の式そのものは js/daiko-payroll.js で既に固定済み。ここで固定するのは
//   ★「クラウドにある生データ（勤務・手入力・従業員・時数）を、どう束ねてあの式に渡すか」★。
//   ここを間違えると式が正しくても給料が狂う。
//
//   ▼実物を読んで確定した一番大事なこと（口頭では出てこなかった）
//     『計算』シートの人ごとの時数は入力ではなく **=[@時数2] のような式** だった。
//     つまり ★人の時数 = その日その人が乗った車の時数★。
//     例) 1/10 は 竹内=[@時数4](8.75) 八木=[@時数2](9.00) と、日によって乗る車が変わる。
//     だから「誰がどの車に乗ったか」を持たないと時数が決まらない。
//
//   ▼もう一つ: 時数合計 = 車の時数の合計（人の時数の合計ではない）
//     1台に2人乗るので、人で足すと倍になって売上1hが半分になる＝全員の給料が狂う。
// ============================================================
const D = require('../../js/payroll-daily.js');

const ROLE2 = '2種';
const ROLE1 = '1種';

// ---- 従業員（実物の名前）----------------------------------------------------
const EMP = [
  { employee_id: 'e1', name: '白石正人', role: ROLE2, active: true, sort_order: 1 },
  { employee_id: 'e2', name: '長野孝', role: ROLE2, active: true, sort_order: 2 },
  { employee_id: 'e3', name: '長野真道', role: ROLE1, active: true, sort_order: 3 },
  { employee_id: 'e4', name: '竹内真一郎', role: ROLE1, active: true, sort_order: 4 },
  { employee_id: 'e5', name: '八木俊幸', role: ROLE1, active: true, sort_order: 5 },
  { employee_id: 'e6', name: '結田航平', role: ROLE2, active: true, sort_order: 6 },
];

const LABELS = [
  { device_id: 'devT', label: 'つかさ' },
  { device_id: 'dev2', label: '2号車' },
  { device_id: 'dev3', label: '3号車' },
  { device_id: 'dev4', label: '4号車' },
];

// 勤務1件 = 1台の1日ぶん。started_at は日本時間で書く。
function shift(id, dev, date, fare) {
  return {
    shift_id: id,
    device_id: dev,
    started_at: date + 'T20:00:00+09:00',
    fare_total_yen: fare,
    trip_count: 1,
    total_distance_m: 0,
    actual_total_m: 0,
  };
}

// ★1/10（計算シート11行目）の実物 --------------------------------------------
//   つかさ 6,900 / 5.50h   2号車 25,700 / 9.00h
//   3号車 24,100 / 8.25h   4号車 21,500 / 8.75h   経費なし
const CTX_0110 = {
  shifts: [
    shift('sT', 'devT', '2026-01-10', 6900),
    shift('s2', 'dev2', '2026-01-10', 25700),
    shift('s3', 'dev3', '2026-01-10', 24100),
    shift('s4', 'dev4', '2026-01-10', 21500),
  ],
  edits: [
    { shift_id: 'sT', hours: 5.5 },
    { shift_id: 's2', hours: 9 },
    { shift_id: 's3', hours: 8.25 },
    { shift_id: 's4', hours: 8.75 },
  ],
  labels: LABELS,
  employees: EMP,
  workHours: [
    // 誰がどの車に乗ったか（時数は車から決まるので入れない）
    { work_date: '2026-01-10', employee_id: 'e1', device_id: 'dev2' }, // 白石 = 時数2
    { work_date: '2026-01-10', employee_id: 'e5', device_id: 'dev2' }, // 八木 = 時数2
    { work_date: '2026-01-10', employee_id: 'e2', device_id: 'dev3' }, // 長野孝 = 時数3
    { work_date: '2026-01-10', employee_id: 'e3', device_id: 'dev3' }, // 真道 = 時数3
    { work_date: '2026-01-10', employee_id: 'e4', device_id: 'dev4' }, // 竹内 = 時数4
    { work_date: '2026-01-10', employee_id: 'e6', device_id: 'dev4' }, // 結田 = 時数4
  ],
  payrollSettings: { owner_device_id: 'devT' },
};

describe('★1/10 実物と1円まで一致（生データから組み立てて）★', () => {
  const ctx = D.buildCtx(CTX_0110);
  const r = D.computeDay('2026-01-10', ctx);

  it('売上合計 71,300（つかさ車は入らない）', () => {
    expect(r.poolSales).toBe(71300);
  });

  it('★時数合計 26.00＝車の時数の合計（人で足したら52になる）★', () => {
    expect(r.poolHours).toBe(26);
  });

  it('積立 3,565 / つかさ積立 345', () => {
    expect(r.reservePool).toBe(3565);
    expect(r.reserveOwner).toBe(345);
  });

  it('売上1h 2,605.19…', () => {
    expect(r.hourly).toBeCloseTo(2605.1923076923076, 9);
  });

  it('★7人ぶんの金額が実物と一致★', () => {
    const pay = {};
    r.staff.forEach((s) => (pay[s.name] = s.pay));
    expect(pay['白石正人']).toBe(10350);
    expect(pay['長野孝']).toBe(9487.5);
    expect(pay['長野真道']).toBe(8250);
    expect(pay['竹内真一郎']).toBe(8750);
    expect(pay['八木俊幸']).toBe(9000);
    expect(pay['結田航平']).toBe(10062.5);
    expect(r.staffTotal).toBe(55900);
  });

  it('★ZERO（つかさの取り分）18,390★', () => {
    expect(r.ownerShare).toBe(18390);
  });

  it('★人の時数は乗った車から決まる★', () => {
    const h = {};
    r.staff.forEach((s) => (h[s.name] = s.hours));
    expect(h['白石正人']).toBe(9); // 時数2
    expect(h['八木俊幸']).toBe(9); // 時数2（同じ車）
    expect(h['竹内真一郎']).toBe(8.75); // 時数4
    expect(h['結田航平']).toBe(8.75); // 時数4
  });
});

// ★1/7（計算シート8行目）= 経費が入っている日 ---------------------------------
//   2号車 23,900 / 8.00h    3号車 26,300 / 7.75h   経費3 = 1,520
//   売上合計 48,680 = 23,900 + 26,300 − 1,520
const CTX_0107 = {
  shifts: [shift('a2', 'dev2', '2026-01-07', 23900), shift('a3', 'dev3', '2026-01-07', 26300)],
  edits: [
    { shift_id: 'a2', hours: 8 },
    { shift_id: 'a3', hours: 7.75, toll_yen: 1520 }, // 経費3
  ],
  labels: LABELS,
  employees: EMP,
  workHours: [
    { work_date: '2026-01-07', employee_id: 'e1', device_id: 'dev2' },
    { work_date: '2026-01-07', employee_id: 'e4', device_id: 'dev2' },
    { work_date: '2026-01-07', employee_id: 'e2', device_id: 'dev3' },
    { work_date: '2026-01-07', employee_id: 'e3', device_id: 'dev3' },
  ],
  payrollSettings: { owner_device_id: 'devT' },
};

describe('★1/7 経費のある日も実物と一致★', () => {
  const r = D.computeDay('2026-01-07', D.buildCtx(CTX_0107));

  it('売上合計 48,680（経費1,520を引いた後）', () => {
    expect(r.poolSales).toBe(48680);
  });
  it('時数合計 15.75', () => {
    expect(r.poolHours).toBe(15.75);
  });
  it('積立 2,434', () => {
    expect(r.reservePool).toBeCloseTo(2434, 9);
  });
  it('金額', () => {
    const pay = {};
    r.staff.forEach((s) => (pay[s.name] = s.pay));
    expect(pay['白石正人']).toBe(9200); // 1150 × 8.00
    expect(pay['長野孝']).toBe(8912.5); // 1150 × 7.75
    expect(pay['長野真道']).toBe(7750); // 1000 × 7.75
    expect(pay['竹内真一郎']).toBe(8000); // 1000 × 8.00
  });
  it('★ZERO 12,383.5（実物の表示は12,384）★', () => {
    expect(r.ownerShare).toBeCloseTo(12383.5, 9);
  });

  it('★引く実費は売上表の設定と同じ物を使う（画面同士が食い違わない）★', () => {
    const off = D.computeDay(
      '2026-01-07',
      D.buildCtx(Object.assign({}, CTX_0107, { salesSettings: { deduct_toll: false } }))
    );
    expect(off.poolSales).toBe(50200); // 経費を引かない = 23,900 + 26,300
  });
});

// ---- 明細（給料1〜8 と同じ並び）----------------------------------------------
describe('★明細＝実物の給料シートと同じ形★', () => {
  const ctx = D.buildCtx({
    shifts: [
      shift('sT', 'devT', '2026-01-10', 6900),
      shift('s2', 'dev2', '2026-01-10', 25700),
      shift('s3', 'dev3', '2026-01-10', 24100),
      shift('s4', 'dev4', '2026-01-10', 21500),
      shift('b2', 'dev2', '2026-01-11', 10000),
    ],
    edits: [
      { shift_id: 'sT', hours: 5.5 },
      { shift_id: 's2', hours: 9 },
      { shift_id: 's3', hours: 8.25 },
      { shift_id: 's4', hours: 8.75 },
      { shift_id: 'b2', hours: 5 },
    ],
    labels: LABELS,
    employees: EMP,
    workHours: CTX_0110.workHours.concat([
      { work_date: '2026-01-11', employee_id: 'e1', device_id: 'dev2' },
    ]),
    payrollSettings: { owner_device_id: 'devT' },
  });
  const rep = D.report(['2026-01-10', '2026-01-11', '2026-01-12'], ctx);

  it('車の並びは つかさ車を外した2号車/3号車/4号車＝売上1・売上2・売上3', () => {
    expect(rep.cars.map((c) => c.label)).toEqual(['2号車', '3号車', '4号車']);
  });

  it('1人ぶんの行が 日付/金額/時間/売上1..3/時間(全台) で揃う', () => {
    const me = rep.employees.find((e) => e.name === '白石正人');
    const c = me.cells[0];
    expect(c.date).toBe('2026-01-10');
    expect(c.pay).toBe(10350);
    expect(c.hours).toBe(9);
    expect(c.carSales).toEqual([25700, 24100, 21500]); // 売上1/2/3
    expect(c.poolHours).toBe(26); // 時間（全台合計）
  });

  it('★休んだ日は空欄（0でなく null）★', () => {
    const me = rep.employees.find((e) => e.name === '結田航平');
    const c11 = me.cells.find((x) => x.date === '2026-01-11');
    expect(c11.worked).toBe(false);
    expect(c11.pay).toBe(null);
    expect(c11.hours).toBe(null);
    expect(c11.carSales).toEqual([null, null, null]);
    expect(c11.poolHours).toBe(null);
  });

  it('★走っていない車の売上も空欄★（1/11は2号車だけ）', () => {
    const me = rep.employees.find((e) => e.name === '白石正人');
    const c11 = me.cells.find((x) => x.date === '2026-01-11');
    expect(c11.worked).toBe(true);
    expect(c11.carSales).toEqual([10000, null, null]);
  });

  it('合計＝実物のヘッダ（合計◯円／◯時間）', () => {
    const me = rep.employees.find((e) => e.name === '白石正人');
    expect(me.totalPay).toBe(10350 + 5750); // 1/11 は 1150×5.00
    expect(me.totalHours).toBe(14);
  });

  it('1日も出ていない人は合計0（明細は出せる＝空欄が並ぶ）', () => {
    const rep2 = D.report(['2026-01-12'], ctx);
    const me = rep2.employees.find((e) => e.name === '白石正人');
    expect(me.totalPay).toBe(0);
    expect(me.totalHours).toBe(0);
    expect(me.cells[0].worked).toBe(false);
  });

  it('つかさの取り分も期間で合計できる', () => {
    expect(rep.ownerShareTotal).toBeCloseTo(18390 + (10000 - 500 - 5750), 6);
  });
});

// ---- 車の時数（手入力が無ければメーターの実時間から）--------------------------
describe('車の時数', () => {
  it('手で入れた時数が最優先', () => {
    expect(D.carHoursOf({ elapsed_sec: 3600 }, { hours: 8.25 })).toBe(8.25);
  });

  it('★手入力が無ければ実際に働いた時間から出す（0.25刻み）★', () => {
    expect(D.carHoursOf({ elapsed_sec: 8 * 3600 }, null)).toBe(8);
    expect(D.carHoursOf({ elapsed_sec: 8 * 3600 + 500 }, null)).toBe(8.25); // 8時間8分→8.25
    expect(D.carHoursOf({ elapsed_sec: 8 * 3600 + 100 }, null)).toBe(8); // 8時間2分→8.00
  });

  it('elapsed_sec が無ければ 開始〜終了 から出す', () => {
    const s = { started_at: '2026-01-10T20:00:00+09:00', ended_at: '2026-01-11T02:30:00+09:00' };
    expect(D.carHoursOf(s, null)).toBe(6.5);
  });

  it('どちらも無ければ 0（勝手に作らない）', () => {
    expect(D.carHoursOf({}, null)).toBe(0);
    expect(D.carHoursOf(null, null)).toBe(0);
  });

  it('0や負の手入力は「入力なし」扱いにせず そのまま0にする', () => {
    expect(D.carHoursOf({ elapsed_sec: 8 * 3600 }, { hours: 0 })).toBe(8); // 0=未入力
    expect(D.carHoursOf({ elapsed_sec: 8 * 3600 }, { hours: -3 })).toBe(8);
  });

  it('同じ車の勤務が1日に2回あったら足す', () => {
    const ctx = D.buildCtx({
      shifts: [
        shift('x1', 'dev2', '2026-02-01', 10000),
        shift('x2', 'dev2', '2026-02-01', 5000),
        shift('x3', 'dev3', '2026-02-01', 9000),
      ],
      edits: [
        { shift_id: 'x1', hours: 4 },
        { shift_id: 'x2', hours: 3 },
        { shift_id: 'x3', hours: 7 },
      ],
      labels: LABELS,
      employees: EMP,
      workHours: [
        { work_date: '2026-02-01', employee_id: 'e1', device_id: 'dev2' },
        { work_date: '2026-02-01', employee_id: 'e2', device_id: 'dev3' },
      ],
      payrollSettings: { owner_device_id: 'devT' },
    });
    const r = D.computeDay('2026-02-01', ctx);
    expect(r.poolSales).toBe(24000);
    expect(r.poolHours).toBe(14); // 4+3+7
    const white = r.staff.find((s) => s.name === '白石正人');
    expect(white.hours).toBe(7); // 2号車の合計
  });
});

// ---- 時数の個別直し ---------------------------------------------------------
describe('時数は人ごとに直せる（早上がりなど）', () => {
  it('入っていればその値を使う', () => {
    const ctx = D.buildCtx(
      Object.assign({}, CTX_0110, {
        workHours: CTX_0110.workHours.map((w) =>
          w.employee_id === 'e5' ? Object.assign({}, w, { hours: 4 }) : w
        ),
      })
    );
    const r = D.computeDay('2026-01-10', ctx);
    const yagi = r.staff.find((s) => s.name === '八木俊幸');
    expect(yagi.hours).toBe(4);
    expect(yagi.pay).toBe(4000); // 1000 × 4
    // ★車の時数（＝時数合計）は変わらない★ 車は9時間走っている
    expect(r.poolHours).toBe(26);
  });
});

// ---- 日付の切り方 -----------------------------------------------------------
describe('日付の切り方（日本時間で切る）', () => {
  it('夜9時に始まった勤務はその日の分', () => {
    expect(D.dateOf('2026-01-10T21:00:00+09:00')).toBe('2026-01-10');
  });
  it('日をまたいでも 業務開始の日で数える', () => {
    expect(D.dateOf('2026-01-10T23:59:00+09:00')).toBe('2026-01-10');
    expect(D.dateOf('2026-01-11T00:30:00+09:00')).toBe('2026-01-11');
  });
  it('★パソコンの時計が海外でも日本時間で切る★', () => {
    expect(D.dateOf('2026-01-10T15:00:00Z')).toBe('2026-01-11'); // JST 翌0時
    expect(D.dateOf('2026-01-10T14:59:00Z')).toBe('2026-01-10');
  });
  it('壊れた日付でも落ちない', () => {
    expect(D.dateOf('')).toBe('');
    expect(D.dateOf(null)).toBe('');
    expect(D.dateOf('なにこれ')).toBe('');
  });
});

// ---- 設定 -------------------------------------------------------------------
describe('設定（会社ごとに変えられる）', () => {
  it('DBの行（スネークケース）を計算エンジンの設定に直す', () => {
    const st = D.normSettings({
      pool_mode: 'all_total',
      deduct_reserve_before_rate: false,
      reserve_pool_rate: 0.03,
      reserve_owner_rate: 0.04,
      roles: { 社員: { rate: 0.4, floor: 1200 } },
      owner_device_id: 'devT',
      period_start_day: 1,
      period_days: 15,
    });
    expect(st.poolMode).toBe('all_total');
    expect(st.deductReserveBeforeRate).toBe(false);
    expect(st.reservePoolRate).toBe(0.03);
    expect(st.reserveOwnerRate).toBe(0.04);
    expect(st.roles['社員']).toEqual({ rate: 0.4, floor: 1200 });
    expect(st.ownerDeviceId).toBe('devT');
  });

  it('無ければ司さんの決め方が既定（2種0.35/1150・1種0.30/1000・積立5%）', () => {
    const st = D.normSettings(null);
    expect(st.poolMode).toBe('others_total');
    expect(st.roles['2種']).toEqual({ rate: 0.35, floor: 1150 });
    expect(st.roles['1種']).toEqual({ rate: 0.3, floor: 1000 });
    expect(st.reservePoolRate).toBe(0.05);
    expect(st.deductReserveBeforeRate).toBe(true);
  });

  it('役割を増やせる（2種1種に限らない）', () => {
    const ctx = D.buildCtx(
      Object.assign({}, CTX_0110, {
        employees: EMP.concat([
          { employee_id: 'e9', name: 'バイト', role: 'バイト', active: true, sort_order: 9 },
        ]),
        workHours: CTX_0110.workHours.concat([
          { work_date: '2026-01-10', employee_id: 'e9', device_id: 'dev2' },
        ]),
        payrollSettings: {
          owner_device_id: 'devT',
          roles: {
            '2種': { rate: 0.35, floor: 1150 },
            '1種': { rate: 0.3, floor: 1000 },
            バイト: { rate: 0.25, floor: 900 },
          },
        },
      })
    );
    const r = D.computeDay('2026-01-10', ctx);
    const b = r.staff.find((s) => s.name === 'バイト');
    expect(b.hours).toBe(9);
    expect(b.pay).toBe(8100); // 900 × 9（歩合 2605.19×0.25×9 より高い）
  });
});

// ---- 壊れたデータ -----------------------------------------------------------
describe('★壊れたデータでも画面を殺さない★', () => {
  it('何が来ても throw しない', () => {
    expect(() => D.buildCtx(null)).not.toThrow();
    expect(() => D.computeDay(null, D.buildCtx(null))).not.toThrow();
    expect(() => D.computeDay('2026-01-10', null)).not.toThrow();
    expect(() => D.report(null, null)).not.toThrow();
    expect(() => D.report(['x'], D.buildCtx({ shifts: [{}], employees: [{}] }))).not.toThrow();
  });

  it('表がまだ無い（従業員も時数も空）でも 0 が返るだけ', () => {
    const r = D.computeDay('2026-01-10', D.buildCtx({ shifts: CTX_0110.shifts }));
    expect(r.staff).toEqual([]);
    expect(r.staffTotal).toBe(0);
    expect(isFinite(r.hourly)).toBe(true);
  });

  it('★車の時数が分からない日でも NaN を出さない（0で割らない）★', () => {
    const ctx = D.buildCtx({
      shifts: [shift('z1', 'dev2', '2026-03-01', 10000)], // 終了時刻も手入力時数も無い
      edits: [],
      employees: EMP,
      // 人の時数だけ入っている状態
      workHours: [{ work_date: '2026-03-01', employee_id: 'e1', device_id: 'dev2', hours: 8 }],
    });
    const r = D.computeDay('2026-03-01', ctx);
    expect(r.poolHours).toBe(0);
    expect(isFinite(r.hourly)).toBe(true);
    expect(r.hourly).toBe(0);
    expect(r.staff[0].pay).toBe(9200); // 最低保証 1150 × 8 だけは必ず出る
    expect(isFinite(r.ownerShare)).toBe(true);
  });

  it('車の時数も人の時数も無い日は、その人の行を作らない', () => {
    const ctx = D.buildCtx({
      shifts: [shift('z2', 'dev2', '2026-03-02', 10000)],
      edits: [],
      employees: EMP,
      workHours: [{ work_date: '2026-03-02', employee_id: 'e1', device_id: 'dev2' }],
    });
    const r = D.computeDay('2026-03-02', ctx);
    expect(r.staff).toEqual([]);
    expect(isFinite(r.hourly)).toBe(true);
  });

  it('辞めた人（active=false）は明細に出さない', () => {
    const ctx = D.buildCtx(
      Object.assign({}, CTX_0110, {
        employees: EMP.map((e) =>
          e.employee_id === 'e5' ? Object.assign({}, e, { active: false }) : e
        ),
      })
    );
    const rep = D.report(['2026-01-10'], ctx);
    expect(rep.employees.map((e) => e.name)).not.toContain('八木俊幸');
  });

  it('★辞めた人でも過去に働いた分は金額に入る（他の人の給料が狂わない）★', () => {
    const ctx = D.buildCtx(
      Object.assign({}, CTX_0110, {
        employees: EMP.map((e) =>
          e.employee_id === 'e5' ? Object.assign({}, e, { active: false }) : e
        ),
      })
    );
    const r = D.computeDay('2026-01-10', ctx);
    expect(r.staffTotal).toBe(55900); // 八木の9,000を含んだまま
    expect(r.ownerShare).toBe(18390);
  });
});

// ---- 手で入れた1日分（メーター無しでも給料が出せる）--------------------------
describe('★手で入れた1日分（司さん「おれが使えるようにしろ」）★', () => {
  const base = {
    labels: LABELS,
    employees: EMP,
    payrollSettings: { owner_device_id: 'devT' },
  };

  it('★スマホが1台も繋がっていなくても給料が出る★', () => {
    const ctx = D.buildCtx(
      Object.assign({}, base, {
        shifts: [], // メーターの記録ゼロ
        manualDays: [
          { work_date: '2026-01-10', device_id: 'dev2', sales_yen: 25700, hours: 9 },
          { work_date: '2026-01-10', device_id: 'dev3', sales_yen: 24100, hours: 8.25 },
          { work_date: '2026-01-10', device_id: 'dev4', sales_yen: 21500, hours: 8.75 },
          { work_date: '2026-01-10', device_id: 'devT', sales_yen: 6900, hours: 5.5 },
        ],
        workHours: CTX_0110.workHours,
      })
    );
    const r = D.computeDay('2026-01-10', ctx);
    // 実物の1/10 とぴったり同じになる（メーター経由でも手入力でも答えは同じ）
    expect(r.poolSales).toBe(71300);
    expect(r.poolHours).toBe(26);
    expect(r.staffTotal).toBe(55900);
    expect(r.ownerShare).toBe(18390);
  });

  it('手で入れた実費も売上から引かれる（売上表と同じ引き方）', () => {
    const ctx = D.buildCtx(
      Object.assign({}, base, {
        shifts: [],
        manualDays: [
          { work_date: '2026-01-07', device_id: 'dev2', sales_yen: 23900, hours: 8 },
          {
            work_date: '2026-01-07',
            device_id: 'dev3',
            sales_yen: 26300,
            hours: 7.75,
            toll_yen: 1520,
          },
        ],
        workHours: CTX_0107.workHours,
      })
    );
    const r = D.computeDay('2026-01-07', ctx);
    expect(r.poolSales).toBe(48680); // 経費1,520を引いた後
  });

  it('★同じ日・同じ車にメーターの記録もある時は足し算しない（二重計上しない）★', () => {
    const ctx = D.buildCtx(
      Object.assign({}, base, {
        shifts: [shift('s2', 'dev2', '2026-01-10', 25700)],
        edits: [{ shift_id: 's2', hours: 9 }],
        manualDays: [
          // うっかり同じ日の同じ車を手でも入れてしまった
          { work_date: '2026-01-10', device_id: 'dev2', sales_yen: 25700, hours: 9 },
        ],
        workHours: [{ work_date: '2026-01-10', employee_id: 'e1', device_id: 'dev2' }],
      })
    );
    const r = D.computeDay('2026-01-10', ctx);
    expect(r.poolSales).toBe(25700); // ★51,400 になっていない★
    expect(r.poolHours).toBe(9); // ★18 になっていない★
  });

  it('メーターがある日は そちらを正とする（手入力の額に引っぱられない）', () => {
    const ctx = D.buildCtx(
      Object.assign({}, base, {
        shifts: [shift('s2', 'dev2', '2026-01-10', 25700)],
        edits: [{ shift_id: 's2', hours: 9 }],
        manualDays: [{ work_date: '2026-01-10', device_id: 'dev2', sales_yen: 999999, hours: 99 }],
        workHours: [{ work_date: '2026-01-10', employee_id: 'e1', device_id: 'dev2' }],
      })
    );
    const r = D.computeDay('2026-01-10', ctx);
    expect(r.poolSales).toBe(25700);
    expect(r.poolHours).toBe(9);
  });

  it('メーターと手入力がまざっていても正しく足される（別の車なら足す）', () => {
    const ctx = D.buildCtx(
      Object.assign({}, base, {
        shifts: [shift('s2', 'dev2', '2026-01-10', 25700)],
        edits: [{ shift_id: 's2', hours: 9 }],
        manualDays: [{ work_date: '2026-01-10', device_id: 'dev3', sales_yen: 24100, hours: 8.25 }],
        workHours: [
          { work_date: '2026-01-10', employee_id: 'e1', device_id: 'dev2' },
          { work_date: '2026-01-10', employee_id: 'e2', device_id: 'dev3' },
        ],
      })
    );
    const r = D.computeDay('2026-01-10', ctx);
    expect(r.poolSales).toBe(49800);
    expect(r.poolHours).toBe(17.25);
  });

  it('手で入れた車は「手入力」と分かる（画面で見分けが付く）', () => {
    const ctx = D.buildCtx(
      Object.assign({}, base, {
        shifts: [shift('s2', 'dev2', '2026-01-10', 25700)],
        edits: [{ shift_id: 's2', hours: 9 }],
        manualDays: [{ work_date: '2026-01-10', device_id: 'dev3', sales_yen: 24100, hours: 8.25 }],
        workHours: [],
      })
    );
    const inp = D.dayInput('2026-01-10', ctx);
    const byDev = {};
    inp.cars.forEach((c) => (byDev[c.device_id] = c));
    expect(byDev['dev2'].fromManual).toBe(false); // メーター
    expect(byDev['dev3'].fromManual).toBe(true); // 手入力
  });

  it('つかさ車も手で入れられる', () => {
    const ctx = D.buildCtx(
      Object.assign({}, base, {
        shifts: [],
        manualDays: [{ work_date: '2026-01-29', device_id: 'devT', sales_yen: 12800, hours: 6.25 }],
        workHours: [],
      })
    );
    const r = D.computeDay('2026-01-29', ctx);
    expect(r.owner.sales).toBe(12800);
    expect(r.ownerShare).toBeCloseTo(12160, 6); // 実物の1/29と同じ
  });

  it('壊れた手入力でも落ちない', () => {
    expect(() => D.buildCtx({ manualDays: 'これは配列じゃない' })).not.toThrow();
    expect(() => D.buildCtx({ manualDays: [null, {}, { work_date: 'x' }] })).not.toThrow();
    const ctx = D.buildCtx({ manualDays: [{ work_date: '2026-01-10', device_id: 'dev2' }] });
    const r = D.computeDay('2026-01-10', ctx);
    expect(isFinite(r.poolSales)).toBe(true);
    expect(isFinite(r.hourly)).toBe(true);
  });
});
