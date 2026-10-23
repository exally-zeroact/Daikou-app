// ============================================================
// ★★「自分の車も入れて全部」（all_total）の 2回 数えを 直す★★ 2026-10-23 件G
//
//   司さんの 答え：自分の 車の 積立 5% は「経費を 引いた 後の 売上」に 掛ける（みんなの 車と 同じ 決まり）
//   前：母数（自分の 車 込み）×率 ＋ 自分の 車の 売上（経費 前）×率 ＝自分の 車の 積立を 2回 取り、
//       会社に 残る分には 自分の 車の 売上−積立−経費を もう 1回 足した。月次集計は 積立の 自分の 車の 分を 2回 引いた。
//
//   決まりから 出す 数（1日・率は 既定 5%／5%・2種 0.35 / 1,150）
//     自分の 車 売上 10,000・経費 1,000（9,000）／他の 車 20,000・時数 5／自分の 車 時数 3
//     母数 29,000・時数 8
//     積立 ＝ 他の 車 20,000×5% ＝1,000 ＋ 自分の 車 9,000×5% ＝450 ＝ 1,450
//     単価 ＝ (29,000 − 1,450) ÷ 8 ＝ 3,443.75 ⇒ 1人 4時間 ＝ 3,443.75×0.35×4 ＝ 4,821.25（保証 4,600 より 上）
//     会社に 残る分 ＝ 29,000 − 1,450 − 4,821.25 ＝ 22,728.75（前は 31,228.75）
//   既定（others_total）：給料は 変えない・自分の 車の 積立だけ 経費 後（司さんの 答え 10-23 ②）
//     母数 20,000・時数 5・積立 1,000 ＋ 自分の 車 9,000×5% ＝450（前は 経費 前 10,000×5% ＝500）
//     単価 (20,000−1,000)÷5 ＝3,800 ⇒ 4時間 5,320（前と 同じ）
//     会社に 残る分 ＝ 20,000 − 1,000 − 5,320 ＋ 9,000 − 450 ＝ 22,230（前は 22,180）
//   ★給料は 変えない★（司さんの 答え 10-23 ①）：単価の 前に 引く 積立は 母数 × みんなの 率（前の 通り）
//     ＝all_total で 率が 違う 時も 給料は 前と 同じ（古い 版との 比べは kyuryo-kawaranai-g4.test.js）
//
//   ★わざと壊して 赤（2026-10-23 実測）★ 直す 前の 版 ⇒ ★赤 8 / 緑 4★（緑は 既定・per_car が 変わらない 事と others_total の 会社に 残る分・日ごと）・直した 後 ⇒ 緑 12 / 12
// ============================================================
const fs = require('fs');
const path = require('path');
globalThis.PayrollPeriod = require('../../js/payroll-period.js');
globalThis.DaikoPayroll = require('../../js/daiko-payroll.js');
globalThis.UriageAgg = require('../../js/uriage-agg.js');
const P = globalThis.DaikoPayroll;
const PD = require('../../js/payroll-daily.js');
const GA = require('../../js/getsuji-agg.js');
const PP = globalThis.PayrollPeriod;
const KYU = fs.readFileSync(path.join(__dirname, '..', '..', 'kyuryo.html'), 'utf8');

const INPUT = {
  owner: { sales: 10000, expense: 1000, hours: 3 },
  cars: [{ id: '2', sales: 20000, expense: 0, hours: 5 }],
  staff: [{ name: '甲', hours: 4, role: '2種' }],
};

describe('★1日の 計算（決まりから 出した 数）★', () => {
  it('all_total：積立は 全部の 車で「売上−経費」×率・1回だけ', () => {
    const r = P.compute(INPUT, { poolMode: 'all_total' });
    expect(r.poolSales).toBe(29000);
    expect(r.reservePool).toBeCloseTo(1000, 6);
    expect(r.reserveOwner).toBeCloseTo(450, 6);
    expect(r.staffTotal).toBeCloseTo(4821.25, 6);
    expect(r.ownerShare).toBeCloseTo(22728.75, 6);
    // 売上 ＝ 会社に 残る分 ＋ 給料 ＋ 積立（どれも 1回）
    expect(r.ownerShare + r.staffTotal + r.reservePool + r.reserveOwner).toBeCloseTo(29000, 6);
  });
  it('既定（others_total）：給料は 前と 同じ・自分の 車の 積立は 経費 後', () => {
    const r = P.compute(INPUT, {});
    expect(r.poolSales).toBe(20000);
    expect(r.reservePool).toBeCloseTo(1000, 6);
    expect(r.reserveOwner).toBeCloseTo(450, 6);
    expect(r.staffTotal).toBeCloseTo(5320, 6);
    expect(r.ownerShare).toBeCloseTo(22230, 6);
  });
  it('per_car も 自分の 車の 積立は「売上−経費」×率', () => {
    const r = P.compute(INPUT, { poolMode: 'per_car' });
    expect(r.reserveOwner).toBeCloseTo(450, 6);
  });
  it('all_total で 率が 違っても 単価・給料は 母数 × みんなの 率を 引いた 前の 通り', () => {
    const r = P.compute(INPUT, { poolMode: 'all_total', reserveOwnerRate: 0.1 });
    // 単価 ＝ (29,000 − 29,000×5%) ÷ 8 ＝ 3,443.75（自分の 車の 率は 単価に 効かない）
    expect(r.hourly).toBeCloseTo(3443.75, 6);
    expect(r.staffTotal).toBeCloseTo(4821.25, 6);
    // 積立 ＝ 20,000×5% ＋ 9,000×10% ＝ 1,900
    expect(r.reservePool + r.reserveOwner).toBeCloseTo(1900, 6);
    expect(r.ownerShare).toBeCloseTo(29000 - 1900 - 4821.25, 6);
  });
});

// ── 偽の 会社（月3回）で 月次集計と 給料タブを 比べる ──
function ctxOf(pool_mode) {
  const emps = [1, 2, 3].map((i) => ({
    employee_id: 'e' + i,
    name: '人' + i,
    role: '2種',
    sort_order: i,
    active: true,
  }));
  const md = [];
  const wh = [];
  for (let d = 1; d <= 30; d++) {
    const dt = '2026-09-' + String(d).padStart(2, '0');
    md.push({ work_date: dt, device_id: 'carA', sales_yen: 12347 + d * 7, hours: 3.3 });
    md.push({
      work_date: dt,
      device_id: 'carB',
      sales_yen: 9871 + d * 3,
      toll_yen: 500,
      hours: 2.7,
    });
    md.push({ work_date: dt, device_id: 'carC', sales_yen: 15001 + d, hours: 3.1 });
    wh.push({ work_date: dt, employee_id: 'e1', device_id: 'carA', hours: 0 });
    wh.push({ work_date: dt, employee_id: 'e2', device_id: 'carC', hours: 0 });
    if (d % 2) wh.push({ work_date: dt, employee_id: 'e3', device_id: 'carA', hours: 1.7 });
  }
  return PD.buildCtx({
    shifts: [],
    edits: [],
    workHours: wh,
    manualDays: md,
    adjustments: [],
    labels: [],
    employees: emps,
    payrollSettings: {
      period_end_mode: 'thirds',
      period_start_day: 1,
      owner_device_id: 'carB',
      pool_mode: pool_mode,
    },
    salesSettings: { toll: true },
  });
}

for (const mode of ['all_total', 'others_total']) {
  describe('★' + mode + '：月次集計と 給料タブで 会社に 残る分・積立・売上が 同じ★', () => {
    const ctx = ctxOf(mode);
    const m = GA.month(2026, 9, ctx, []);
    const reps = PP.periodsOf(2026, 9, { kata: ctx.settings.periodKata }).map((p) =>
      PD.report(p.dates, ctx)
    );
    const wa = (f) => reps.reduce((a, r) => a + f(r), 0);
    it('積立', () => {
      expect(m.reserve).toBeGreaterThan(0);
      expect(wa((r) => r.reserveTotal + r.reserveOwnerTotal)).toBeCloseTo(m.reserve, 6);
    });
    it('会社に 残る分', () => {
      expect(wa((r) => r.nokori)).toBeCloseTo(m.ownerShare, 6);
    });
    it('売上（自分の 車も 入れた 全部）', () => {
      expect(wa((r) => r.uriageZen)).toBeCloseTo(m.salesTotal, 6);
    });
    it('日ごとの 会社に 残る分を 足した 物とも 丸めの 幅で 合う（2回 数え 無し）', () => {
      expect(Math.abs(m.ownerShareDaily - m.ownerShare)).toBeLessThanOrEqual(0.5 * 3 * 3);
    });
  });
}

describe('★給料タブの 字★', () => {
  it('売上合計・積立は 自分の 車も 入れた 全部（月次集計と 同じ 数）を 出す', () => {
    const a = KYU.indexOf('<b>会社に残る分</b>');
    const k = KYU.slice(a, a + 1200);
    expect(k).toMatch(/yen\(REP\.uriageZen\)/);
    expect(k).toMatch(/yen\(REP\.reserveTotal \+ REP\.reserveOwnerTotal\)/);
  });
});
