// ============================================================
// 勤め始めの 日 2026-10-19（司さん「新しい従業員（1人）を10/19で選んだらみんなこれが反映されとんはなぜ？」）
//   勤め始め＝①登録した 日（created_at）②「何日から」の 記録 の 早い 方
//   守る 事：
//     ①勤め始めより 前の 期間の 明細には 今いる人でも 出さない（働いた 日・手当・控除が 在れば 出す）
//     ②登録した 時刻が 2人 以上 同じ（倉庫の 引っ越しで まとめて 作った）人は 登録日を 使わない＝いつも 出す
//     ③「何日から」を 登録日より 前の 日に すれば その 日から（登録日が 使えない 人には 使わない）
//     ④乗った 記録が 登録日より 前に 在れば その 日から（前へ 動かす だけ・2026-10-20 本番前の 叩き N2）
// ============================================================
import { describe, it, expect } from 'vitest';
const D = require('../../js/payroll-daily.js');

const CO = 'c1';
const MATOME = '2026-08-06T14:59:12.00606+00:00';
function raw(extra) {
  return Object.assign(
    {
      payrollSettings: { company_id: CO },
      salesSettings: null,
      labels: [{ device_id: 'car1', label: '1号' }],
      shifts: [],
      edits: [],
      manualDays: [],
      employees: [
        { employee_id: 'mae', name: '前から', role: '2種', active: true, created_at: MATOME },
        { employee_id: 'mae2', name: '前から2', role: '2種', active: true, created_at: MATOME },
        {
          employee_id: 'atara',
          name: '新しい',
          role: '2種',
          active: true,
          created_at: '2026-10-19T01:00:00Z',
        },
        { employee_id: 'nazo', name: '分からない', role: '2種', active: true },
      ],
      workHours: [],
      adjustments: [],
    },
    extra || {}
  );
}
const tooka = (a, b) => {
  const out = [];
  for (let i = a; i <= b; i++) out.push('2026-10-' + String(i).padStart(2, '0'));
  return out;
};
const ids = (r) => r.employees.map((e) => e.employee_id).sort();

describe('勤め始めの 日', () => {
  it('②まとめて 作った 人は 空＝いつも 出す・新しい 人は 登録した 日本の 日付から', () => {
    const ctx = D.buildCtx(raw());
    expect(D.hajimeOf(ctx, 'mae')).toBe('');
    expect(D.hajimeOf(ctx, 'mae2')).toBe('');
    expect(D.hajimeOf(ctx, 'nazo')).toBe('');
    expect(D.hajimeOf(ctx, 'atara')).toBe('2026-10-19');
    expect(D.hajimatteIru(ctx, 'atara', '2026-10-14')).toBe(false);
    expect(D.hajimatteIru(ctx, 'atara', '2026-10-19')).toBe(true);
    expect(D.hajimatteIru(ctx, 'mae', '2026-01-01')).toBe(true);
  });

  it('①10/1〜10/10 の 明細に 10/19 から の 人は 出ない・10/11〜10/20 には 出る', () => {
    const ctx = D.buildCtx(raw());
    expect(ids(D.report(tooka(1, 10), ctx))).toEqual(['mae', 'mae2', 'nazo']);
    expect(ids(D.report(tooka(11, 20), ctx))).toEqual(['atara', 'mae', 'mae2', 'nazo']);
  });

  it('③「何日から」を 前の 日に すれば その 日から', () => {
    const ctx = D.buildCtx(
      raw({
        rireki: [{ employee_id: 'atara', key: 'pay_rate', from_date: '2026-10-01', value: 0.35 }],
      })
    );
    expect(D.hajimeOf(ctx, 'atara')).toBe('2026-10-01');
    expect(ids(D.report(tooka(1, 10), ctx))).toEqual(['atara', 'mae', 'mae2', 'nazo']);
  });

  it('④乗った 記録が 登録日より 前に 在れば その 日から・前の 期間に 手当・控除が 在れば 明細には 出す', () => {
    const ctx = D.buildCtx(
      raw({
        workHours: [
          {
            company_id: CO,
            work_date: '2026-10-05',
            employee_id: 'atara',
            device_id: 'car1',
            hours: 0,
          },
        ],
        adjustments: [
          {
            adj_id: 'a1',
            work_date: '2026-10-05',
            employee_id: 'atara',
            kind: 'teate',
            label: 'x',
            yen: 100,
          },
        ],
      })
    );
    expect(D.hajimeOf(ctx, 'atara')).toBe('2026-10-05');
    expect(ids(D.report(tooka(1, 10), ctx))).toContain('atara');
    // 前から 居る 人（登録日が 使えない）は 乗った 記録で 遅れない
    const ctx2 = D.buildCtx(
      raw({
        workHours: [
          {
            company_id: CO,
            work_date: '2026-10-05',
            employee_id: 'mae',
            device_id: 'car1',
            hours: 3,
          },
        ],
      })
    );
    expect(D.hajimeOf(ctx2, 'mae')).toBe('');
    // 乗った 記録が 登録日より 後なら 動かない
    const ctx3 = D.buildCtx(
      raw({
        workHours: [
          {
            company_id: CO,
            work_date: '2026-10-25',
            employee_id: 'atara',
            device_id: 'car1',
            hours: 3,
          },
        ],
      })
    );
    expect(D.hajimeOf(ctx3, 'atara')).toBe('2026-10-19');
  });

  it('⑧乗った 記録が 無くても 勤め始めより 前の 期間に 手当・控除が 在れば 明細に 出す（額が どの 明細にも 出ないのを 防ぐ・N1）', () => {
    const ctx = D.buildCtx(
      raw({
        adjustments: [
          {
            adj_id: 'a1',
            work_date: '2026-10-05',
            employee_id: 'atara',
            kind: 'teate',
            label: 'x',
            yen: 5000,
          },
        ],
      })
    );
    // 乗った 記録が 無いので 勤め始めは 登録日の まま
    expect(D.hajimeOf(ctx, 'atara')).toBe('2026-10-19');
    const r = D.report(tooka(1, 10), ctx);
    const atara = r.employees.find((e) => e.employee_id === 'atara');
    expect(atara, '手当だけの 人が 明細から 消えた').toBeTruthy();
    expect(atara.adj.length).toBe(1);
    expect(atara.totalPay).toBe(5000);
  });

  it('⑦同じ 時刻を 違う 書き方で 返されても まとめて 作った 人と 見る（N3）', () => {
    const r = raw();
    r.employees[0].created_at = '2026-08-06T14:59:12.00606+00:00';
    r.employees[1].created_at = '2026-08-06 14:59:12.006060+00';
    r.employees[3].created_at = '2026-08-06T14:59:12.006Z';
    const ctx = D.buildCtx(r);
    expect(D.hajimeOf(ctx, 'mae')).toBe('');
    expect(D.hajimeOf(ctx, 'mae2')).toBe('');
    expect(D.hajimeOf(ctx, 'nazo')).toBe('');
    expect(D.hajimeOf(ctx, 'atara')).toBe('2026-10-19');
  });

  it('⑤前から 居る 人に 先の 日付で 率を 変えた 記録を 入れても 消えない・新しい 人も 後ろの 記録で 遅れない', () => {
    const ctx = D.buildCtx(
      raw({
        rireki: [
          { employee_id: 'mae', key: 'pay_rate', from_date: '2026-11-01', value: 0.4 },
          { employee_id: 'atara', key: 'pay_rate', from_date: '2026-12-01', value: 0.4 },
        ],
      })
    );
    expect(D.hajimeOf(ctx, 'mae')).toBe('');
    expect(D.hajimeOf(ctx, 'atara')).toBe('2026-10-19');
  });

  it('⑥事務所の 画面で 人が 1人しか 居ない 時は 登録日を 使わない（本人の 画面＝ctx.honnin は 下）', () => {
    const r = raw();
    r.employees = [r.employees[2]];
    const ctx = D.buildCtx(r);
    expect(D.hajimeOf(ctx, 'atara')).toBe('');
  });
});

// ★本人の 画面（1人・ctx.honnin）★ 2026-10-21（N4：勤め始める 前の 期が ¥0 の 紙で 出た）
//   わざと 壊して 赤：hajimeOf の honnin の 道を 外す ⇒ ⑤-1 が 赤（空＝いつも 出す）
describe('勤め始めの 日・本人の 画面', () => {
  const hitori = (extra) =>
    raw(
      Object.assign(
        {
          employees: [
            {
              employee_id: 'atara',
              name: '新しい',
              role: '2種',
              active: true,
              created_at: '2026-10-19T01:00:00Z',
            },
          ],
        },
        extra || {}
      )
    );
  it('⑤-1 本人の 画面は 1人でも 登録日から（勤め始める 前の 日は 勤めていない）', () => {
    const ctx = D.buildCtx(hitori());
    ctx.honnin = true;
    expect(D.hajimeOf(ctx, 'atara')).toBe('2026-10-19');
    expect(D.hajimatteIru(ctx, 'atara', '2026-10-14')).toBe(false);
    expect(D.hajimatteIru(ctx, 'atara', '2026-10-19')).toBe(true);
  });
  it('⑤-2 事務所の 画面で 1人しか 居ない 時は 今まで 通り 使わない（まとめて 作ったか 分からない）', () => {
    const ctx = D.buildCtx(hitori());
    expect(D.hajimeOf(ctx, 'atara')).toBe('');
  });
  it('⑤-3 本人の 画面でも 登録日が 無い 人は 空＝いつも 出す', () => {
    const ctx = D.buildCtx(
      hitori({
        employees: [{ employee_id: 'nazo', name: '分からない', role: '2種', active: true }],
      })
    );
    ctx.honnin = true;
    expect(D.hajimeOf(ctx, 'nazo')).toBe('');
  }); // ★登録日は 日本の 日付で 切る★（対立役 2回目 M3：UTC の 日付に しても 赤が 0本だった）
  it('⑤-4 本人の 画面の 登録日は 日本時間の 日付（10/10 15:30Z＝10/11・14:59Z＝10/10）', () => {
    const hi = (t) => {
      const ctx = D.buildCtx(
        hitori({
          employees: [
            { employee_id: 'atara', name: '新しい', role: '2種', active: true, created_at: t },
          ],
        })
      );
      ctx.honnin = true;
      return D.hajimeOf(ctx, 'atara');
    };
    expect(hi('2026-10-10T15:30:00Z')).toBe('2026-10-11');
    expect(hi('2026-10-10T14:59:00Z')).toBe('2026-10-10');
    expect(hi('2026-10-19 01:00:00.123456+00')).toBe('2026-10-19');
  });
});
