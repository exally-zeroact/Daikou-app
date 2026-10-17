// ============================================================
// 役割の 決まりが 無くて 給料を 計算できない 人の 日は 止める（ctx.yakuDame）2026-10-17
//
//   今の 穴：役割の 名前を 直す・消すと 人の 役割は 古い 名前の まま 残り、
//   daiko-payroll.js の compute で 歩合0・保証0に 黙って 倒れていた。
//   司さん「お金の 出力は 1人でも 計算できなければ 止めて 警告」。
//
//   守る 事：
//     ①決まりに 在る 役割の 人は 止めない（額も 前と 1円も 変わらない）
//     ②決まりに 無い 役割で、人の 歩合・保証の 片方でも 空なら 止める（名前と 役割が 訳に 出る）
//     ③人の 歩合と 保証が 両方 打って あれば 止めない（司さん 08-25「役割は 選んでも 打ってもいい」）
//     ④時数の 無い 日は 見ない
//     ⑤回数・距離を 役割の 率の 比で 分ける 日は、乗った 全員（自分も）の 役割が 決まりに 要る
//       （等分なら 要らない・1台の 額が 0 なら 要らない）
//     ⑥本人の 画面（倉庫の 関数が 返す crew）でも 同じ
//     ⑦月次（GetsujiAgg）も 止める
// ============================================================
const P = require('../../js/payroll-daily.js');

const ROLES = { '1種': { rate: 0.3, floor: 1000 }, '2種': { rate: 0.35, floor: 1150 } };

function raw(o) {
  const x = o || {};
  return {
    shifts: x.shifts || [
      {
        shift_id: 's1',
        device_id: 'd1',
        started_at: '2026-09-10T20:00:00+09:00',
        elapsed_sec: 3 * 3600,
        fare_total_yen: 30000,
        trip_count: x.trips === undefined ? 4 : x.trips,
        actual_total_m: 20000,
      },
    ],
    edits: [],
    labels: [],
    manualDays: [],
    employees: x.employees,
    workHours: x.workHours || [
      { work_date: '2026-09-10', employee_id: 'e1', device_id: 'd1', hours: 3 },
      { work_date: '2026-09-10', employee_id: 'e2', device_id: 'd1', hours: 3 },
    ],
    payrollSettings: { roles: ROLES, pay_extra: x.extra || null },
    crew: x.crew,
  };
}
const emp = (id, name, role, rate, floor) => ({
  employee_id: id,
  name,
  role,
  pay_rate: rate === undefined ? null : rate,
  pay_floor: floor === undefined ? null : floor,
});

describe('① 決まりに 在る 役割', () => {
  it('止めない・額は 前と 同じ', () => {
    const c = P.buildCtx(raw({ employees: [emp('e1', '甲', '2種'), emp('e2', '乙', '1種')] }));
    expect(c.yakuDame).toEqual([]);
    expect(c.yakuDameRiyuu).toBe('');
    const r = P.report(['2026-09-10'], c);
    const pay = r.employees.map((e) => e.cells[0].pay);
    expect(pay.every((v) => v > 0)).toBe(true);
  });
});

describe('② ③ 決まりに 無い 役割', () => {
  it('歩合・保証が 空なら 止める（名前と 役割が 訳に 出る）', () => {
    const c = P.buildCtx(raw({ employees: [emp('e1', '甲', '3種'), emp('e2', '乙', '1種')] }));
    expect(c.yakuDame).toEqual([
      { employee_id: 'e1', name: '甲', date: '2026-09-10', role: '3種', wake: 'yaku' },
    ]);
    expect(c.yakuDameRiyuu).toContain('甲（3種）');
    expect(c.yakuDameRiyuu).toContain('止めています');
  });
  it('歩合だけ 打って あっても 止める（保証が 引けない）', () => {
    const c = P.buildCtx(raw({ employees: [emp('e1', '甲', '3種', 0.4), emp('e2', '乙', '1種')] }));
    expect(c.yakuDame.length).toBe(1);
  });
  it('保証だけ 打って あっても 止める（歩合が 引けない）', () => {
    const c = P.buildCtx(
      raw({ employees: [emp('e1', '甲', '3種', null, 1200), emp('e2', '乙', '1種')] })
    );
    expect(c.yakuDame.length).toBe(1);
  });
  it('両方 打って あれば 止めない（08-25 の 決め）', () => {
    const c = P.buildCtx(
      raw({ employees: [emp('e1', '甲', '3種', 0.4, 1200), emp('e2', '乙', '1種')] })
    );
    expect(c.yakuDame).toEqual([]);
  });
  it('0 は 打った 内（空と 取り違えない）', () => {
    const c = P.buildCtx(
      raw({ employees: [emp('e1', '甲', '3種', 0, 0), emp('e2', '乙', '1種')] })
    );
    expect(c.yakuDame).toEqual([]);
  });
  it('役割が 空の 人も 決まりに 無い', () => {
    const c = P.buildCtx(raw({ employees: [emp('e1', '甲', ''), emp('e2', '乙', '1種')] }));
    expect(c.yakuDame.length).toBe(1);
    expect(c.yakuDameRiyuu).toContain('甲（役割 なし）');
  });
});

describe('④ 時数の 無い 日', () => {
  it('時数0・乗った 車も 無い 日は 見ない', () => {
    const c = P.buildCtx(
      raw({
        employees: [emp('e1', '甲', '3種'), emp('e2', '乙', '1種')],
        workHours: [
          { work_date: '2026-09-11', employee_id: 'e1', device_id: 'd9', hours: 0 },
          { work_date: '2026-09-10', employee_id: 'e2', device_id: 'd1', hours: 3 },
        ],
      })
    );
    expect(c.yakuDame).toEqual([]);
  });
});

describe('⑤ 回数・距離を 役割の 率の 比で 分ける 日', () => {
  const zenin = [emp('e1', '甲', '3種', 0.4, 1200), emp('e2', '乙', '1種')];
  it('相方の 役割が 決まりに 無ければ 相方の 側も 止める（自分の 取り分が 動く）', () => {
    const c = P.buildCtx(raw({ employees: zenin, extra: { kaisu: 100 } }));
    const ids = c.yakuDame.map((x) => x.employee_id + ':' + x.wake).sort();
    expect(ids).toEqual(['e1:hi', 'e2:hi']);
    expect(c.yakuDameRiyuu).toContain('等分');
  });
  it('人数で 等分なら 止めない', () => {
    const c = P.buildCtx(raw({ employees: zenin, extra: { kaisu: 100, bunpai: 'touwari' } }));
    expect(c.yakuDame).toEqual([]);
  });
  it('1台の 額が 0（回数0）なら 止めない', () => {
    const c = P.buildCtx(raw({ employees: zenin, extra: { kaisu: 100 }, trips: 0 }));
    expect(c.yakuDame).toEqual([]);
  });
  it('回数・距離の 歩合を 使わない 会社は 止めない', () => {
    const c = P.buildCtx(raw({ employees: zenin }));
    expect(c.yakuDame).toEqual([]);
  });
});

describe('⑥ 本人の 画面（crew は 倉庫の 関数から）', () => {
  it('相方の 役割が 決まりに 無ければ 止める', () => {
    const c = P.buildCtx(
      raw({
        employees: [emp('e2', '乙', '1種')],
        workHours: [{ work_date: '2026-09-10', employee_id: 'e2', device_id: 'd1', hours: 3 }],
        crew: [{ work_date: '2026-09-10', device_id: 'd1', roles: ['3種', '1種'] }],
        extra: { kaisu: 100 },
      })
    );
    expect(c.yakuDame.map((x) => x.employee_id)).toEqual(['e2']);
  });
  it('相方が 決まりに 在れば 止めない', () => {
    const c = P.buildCtx(
      raw({
        employees: [emp('e2', '乙', '1種')],
        workHours: [{ work_date: '2026-09-10', employee_id: 'e2', device_id: 'd1', hours: 3 }],
        crew: [{ work_date: '2026-09-10', device_id: 'd1', roles: ['2種', '1種'] }],
        extra: { kaisu: 100 },
      })
    );
    expect(c.yakuDame).toEqual([]);
  });
});

describe('⑦ 月次（GetsujiAgg）', () => {
  it('ctx.yakuDame が 在れば out.dame・訳は 同じ 字', () => {
    const G = require('../../js/getsuji-agg.js');
    const c = P.buildCtx(raw({ employees: [emp('e1', '甲', '3種'), emp('e2', '乙', '1種')] }));
    const r = G.month(2026, 9, c, []);
    expect(r.dame).toBe(true);
    expect(r.yaku).toBe(true);
    expect(r.riyuu).toBe(c.yakuDameRiyuu);
    const y = G.year(2026, c, []);
    expect(y.total.dame).toBe(true);
    expect(y.total.yaku).toBe(true);
  });
});
