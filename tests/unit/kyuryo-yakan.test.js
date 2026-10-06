// ============================================================
// ★★夜の 割増★★ 2026-10-06
//
//   司さん「対立でやれ」（次に やる 事＝夜の 時間の 割増）
//   ★決まり★ 乗った 車の その日の 勤務の 時間（打刻）の うち 夜の 時間帯（JST）の 割合で 倍率を 掛ける
//     倍率 ＝ 1 ＋（夜の 倍率 − 1）× 夜の 割合。手で 入れた 日（時刻 無し）は 付かない。既定は 使わない
//   ★手で 足した 答え（対立役の oracle）★
//     勤務 20:00〜02:00（6時間）・時間帯 22:00〜5:00・×1.25 ⇒ 夜 4時間 ÷ 6時間
//     歩合 13,300 × (1 + 0.25 × 4/6) ＝ 15,516.67
//
//   わざと壊す（10-06 実測）：yakanFun の「D−1・D・D+1 の 3つの 夜」を D だけに する ⇒ ★赤★（明け方の 勤務）
// ============================================================
const P = require('../../js/daiko-payroll.js');
globalThis.DaikoPayroll = P;
globalThis.UriageAgg = require('../../js/uriage-agg.js');
const PD = require('../../js/payroll-daily.js');

const R = (x) => Math.round(x * 100) / 100;
const YAKAN = { kara: '22:00', made: '05:00', mult: 1.25, mode: 'buai' };

function hi(extra, rate) {
  return P.compute(
    {
      date: '2026-10-03',
      cars: [{ id: 'A', sales: 40000, expense: 0, hours: 8 }],
      owner: {},
      staff: [{ name: '甲', role: '2種', hours: 8, car: 'A', rate: rate }],
      yakanByCar: { A: { span: 360, yakan: 240 } },
    },
    { roles: { '2種': { rate: 0.35, floor: 1150 } }, extra: extra }
  ).staff[0].pay;
}

describe('★夜の 割増の 式★', () => {
  it('使わなければ 13,300（今と 同じ）', () => {
    expect(R(hi({}))).toBe(13300);
    expect(
      R(hi({ yakan: { kara: '22:00', made: '22:00', mult: 1.25 } })),
      '★時間帯が 0 なのに 効いた★'
    ).toBe(13300);
    expect(
      R(hi({ yakan: { kara: '22:00', made: '05:00', mult: 1 } })),
      '★倍率 1 なのに 効いた★'
    ).toBe(13300);
  });
  it('歩合だけ：13,300 × (1 + 0.25 × 4/6) ＝ 15,516.67', () => {
    expect(R(hi({ yakan: YAKAN }))).toBe(15516.67);
  });
  it('最低保証が 勝つ 日：歩合だけ ⇒ 9,200 の まま／日の 給料 全体 ⇒ 9,200 × 1.1667 ＝ 10,733.33', () => {
    expect(R(hi({ yakan: YAKAN }, 0.1))).toBe(9200);
    expect(R(hi({ yakan: Object.assign({}, YAKAN, { mode: 'zentai' }) }, 0.1))).toBe(10733.33);
  });
  it('指定日（×1.5）と 重なる 日：掛け合わせ 13,300×1.5×1.1667／足す 13,300×(1+0.5+0.1667)', () => {
    const w = { '2026-10-03': { mult: 1.5 } };
    expect(R(hi({ yakan: YAKAN, wariHi: w }))).toBe(23275);
    expect(R(hi({ yakan: YAKAN, wariHi: w, kasane: 'tasu' }))).toBe(22166.67);
  });
});

describe('★打刻から 夜の 分を 数える★（倉庫の 行 → 日の 給料）', () => {
  function ctx(shift, yakan) {
    return PD.buildCtx({
      payrollSettings: {
        roles: { '2種': { rate: 0.35, floor: 1150 } },
        pay_extra: { yakan: yakan },
      },
      shifts: [Object.assign({ shift_id: 's1', device_id: 'A', fare_total_yen: 40000 }, shift)],
      edits: [],
      labels: [{ device_id: 'A', label: '4987' }],
      employees: [{ employee_id: 'e1', name: '甲', role: '2種', active: true }],
      workHours: [{ work_date: '2026-10-03', employee_id: 'e1', device_id: 'A', hours: 8 }],
      manualDays: [],
    });
  }
  it('20:00〜02:00（JST）⇒ 夜 240分／360分', () => {
    const c = ctx(
      { started_at: '2026-10-03T11:00:00Z', ended_at: '2026-10-03T17:00:00Z', elapsed_sec: 21600 },
      YAKAN
    );
    const car = c.byDate['2026-10-03'].A;
    expect(Math.round(car.yakan)).toBe(240);
    expect(Math.round(car.span)).toBe(360);
    expect(R(PD.computeDay('2026-10-03', c).staff[0].yakanRatio)).toBe(0.67);
  });
  it('明け方 03:00〜06:00 始まり ⇒ 前の 夜（22〜5）と 重なる 120分／180分', () => {
    const c = ctx({ started_at: '2026-10-02T18:00:00Z', ended_at: '2026-10-02T21:00:00Z' }, YAKAN);
    const car = c.byDate['2026-10-03'].A;
    expect(Math.round(car.yakan)).toBe(120);
    expect(Math.round(car.span)).toBe(180);
  });
  it('終わりが 無ければ 始まり＋elapsed_sec で 数える', () => {
    const c = ctx({ started_at: '2026-10-03T11:00:00Z', elapsed_sec: 21600 }, YAKAN);
    expect(Math.round(c.byDate['2026-10-03'].A.yakan)).toBe(240);
  });
  it('手で 入れた 日（時刻 無し）は 付かない', () => {
    const c = PD.buildCtx({
      payrollSettings: {
        roles: { '2種': { rate: 0.35, floor: 1150 } },
        pay_extra: { yakan: YAKAN },
      },
      shifts: [],
      edits: [],
      labels: [{ device_id: 'A', label: '4987' }],
      employees: [{ employee_id: 'e1', name: '甲', role: '2種', active: true }],
      workHours: [{ work_date: '2026-10-03', employee_id: 'e1', device_id: 'A', hours: 8 }],
      manualDays: [{ work_date: '2026-10-03', device_id: 'A', sales_yen: 40000, hours: 8 }],
    });
    const s = PD.computeDay('2026-10-03', c).staff[0];
    expect(s.yakanRatio).toBe(0);
    expect(R(s.pay)).toBe(13300);
  });
});

// ★★設定は 2回 直しても 同じ★★（10-06 実測：computeDay は 直した 設定を もう一度 通す＝
//   夜の 時間帯を 分の 数に 直した 後 2回目で「22:00 では ない」と 捨てられ 割増が 0 だった）
describe('★ほかの 払い方の 設定は 2回 直しても 変わらない★', () => {
  it('normSettings(normSettings(x)).extra ＝ normSettings(x).extra', () => {
    const x = {
      roles: { '2種': { rate: 0.35, floor: 1150 } },
      extra: {
        roles: {
          '2種': {
            nikkyu: 10000,
            nikkyuMode: 'tasu',
            nikkyuHoshou: false,
            dankai: [{ ijou: 30000, rate: 0.4 }],
          },
        },
        kaisu: 300,
        kyori: 20,
        bunpai: 'touwari',
        kyoriShu: 'sou',
        kasanAto: true,
        wariMode: 'zentai',
        wariHi: { '2026-12-31': { mult: 1.5, label: '大晦日' } },
        yakan: { kara: '22:00', made: '05:00', mult: 1.25, mode: 'zentai' },
        kasane: 'tasu',
      },
    };
    const a = P.normSettings(x);
    const b = P.normSettings(a);
    expect(b.extra).toEqual(a.extra);
    expect(a.extra.yakan, '★夜の 割増が 1回目で 消えた★').toBeTruthy();
  });
});
