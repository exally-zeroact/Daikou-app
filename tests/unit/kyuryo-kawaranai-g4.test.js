// ============================================================
// ★★積立を 直しても 従業員の 給料は 1円も 変えない★★ 2026-10-23 件G の 続き（司さんの 答え ①②）
//
//   ① 給料は 変えない：どの 設定・どの 率でも、人ごとの pay・totalPay・明細の 差引支給・時給の 単価は
//      件G の 直しの 前（テスト線 b21023ab5 の js/daiko-payroll.js）と 同じ。
//      時給の 元から 引く 積立は 前の 通り（母数の 売上 × みんなの 率）。
//   ② 既定（others_total）と per_car でも、自分の 車の 積立は「自分の 車の 売上 − 経費」× 自分の 率。
//      all_total は 他の 車（経費 後）× みんなの 率 ＋ 自分の 車（経費 後）× 自分の 率（2回 数えない）。
//   ⇒ 変わるのは 積立と 会社に 残る分 だけ。
//
//   古い 版は tests/fixtures/kyuryo-mae-b21023ab5/daiko-payroll.js（b21023ab5 の 写し・本番の repo でも 同じ 物で 比べる）
//   月次集計・給料タブは js/payroll-daily.js が globalThis.DaikoPayroll を 使う＝入れ替えて 同じ 入力で 比べる
// ============================================================
const path = require('path');
globalThis.PayrollPeriod = require('../../js/payroll-period.js');
globalThis.UriageAgg = require('../../js/uriage-agg.js');
const OLD = require(
  path.join(__dirname, '..', 'fixtures', 'kyuryo-mae-b21023ab5', 'daiko-payroll.js')
);
const NEW = require('../../js/daiko-payroll.js');
globalThis.DaikoPayroll = NEW;
const PD = require('../../js/payroll-daily.js');
const GA = require('../../js/getsuji-agg.js');
const PP = globalThis.PayrollPeriod;

const MODES = ['others_total', 'per_car', 'all_total', undefined, 'bogus'];
// 率の 組：未指定（既定 5%/5%）・同じ・違う（両向き）・0
const RATES = [
  [undefined, undefined],
  [0.05, 0.05],
  [0.05, 0.1],
  [0.1, 0.03],
  [0, 0.05],
  [0.05, 0],
  [0, 0],
];
const DEDUCT = [undefined, true, false];

function mkRnd(seed) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function makeInputs() {
  const rnd = mkRnd(20261023);
  const out = [];
  for (const mode of MODES) {
    for (const [pr, or] of RATES) {
      for (const dd of DEDUCT) {
        for (let k = 0; k < 30; k++) {
          const st = { poolMode: mode };
          if (pr !== undefined) st.reservePoolRate = pr;
          if (or !== undefined) st.reserveOwnerRate = or;
          if (dd !== undefined) st.deductReserveBeforeRate = dd;
          const ncar = Math.floor(rnd() * 4);
          const cars = [];
          for (let c = 0; c < ncar; c++) {
            cars.push({
              id: 'c' + c,
              sales: Math.floor(rnd() * 40000),
              expense: rnd() < 0.3 ? Math.floor(rnd() * 3000) : 0,
              hours: Math.round(rnd() * 80) / 10,
            });
          }
          const owner = {
            sales: Math.floor(rnd() * 30000),
            expense: rnd() < 0.6 ? Math.floor(rnd() * 8000) : 0,
            hours: Math.round(rnd() * 60) / 10,
          };
          const staff = [];
          const ns = Math.floor(rnd() * 4);
          for (let s = 0; s < ns; s++) {
            staff.push({
              name: 's' + s,
              hours: Math.round(rnd() * 60) / 10,
              role: rnd() < 0.5 ? '2種' : '1種',
              car: 'c' + Math.floor(rnd() * Math.max(1, ncar)),
            });
          }
          out.push({ input: { owner, cars, staff }, st });
        }
      }
    }
  }
  return out;
}

const CASES = makeInputs();

describe('★1日の 計算：古い 版（b21023ab5）と 新しい 版で 給料が 同じ★', () => {
  it('件数（5 設定 × 7 率の 組 × 3 割り方 × 30）', () => {
    expect(CASES.length).toBe(5 * 7 * 3 * 30);
  });
  it('人ごとの 行（pay・歩合・保証）・給料の 合計・時給の 単価の 違いが 0 件', () => {
    const diffs = [];
    CASES.forEach(({ input, st }, i) => {
      const a = OLD.compute(input, st);
      const b = NEW.compute(input, st);
      if (a.hourly !== b.hourly) diffs.push([i, 'hourly', a.hourly, b.hourly]);
      if (a.staffTotal !== b.staffTotal) diffs.push([i, 'staffTotal', a.staffTotal, b.staffTotal]);
      if (JSON.stringify(a.staff) !== JSON.stringify(b.staff)) diffs.push([i, 'staff']);
    });
    expect(diffs.slice(0, 5)).toEqual([]);
    expect(diffs.length).toBe(0);
  });
  it('積立は 決まり通り（自分の 車は 経費 後 × 自分の 率・2回 数えない）・売上 ＝ 会社に残る分 ＋ 給料 ＋ 積立', () => {
    const bad = [];
    CASES.forEach(({ input, st }, i) => {
      const s = NEW.normSettings(st);
      const r = NEW.compute(input, st);
      const ownerNet = input.owner.sales - input.owner.expense;
      const othersNet = input.cars.reduce((a, c) => a + c.sales - c.expense, 0);
      const allTotal = s.poolMode === 'all_total';
      const ePool = othersNet * s.reservePoolRate;
      const eOwner = ownerNet * s.reserveOwnerRate;
      const zen = othersNet + ownerNet; // 全部の 車の 売上（経費 後）
      const near = (x, y) => Math.abs(x - y) < 1e-6;
      if (!near(r.reservePool, ePool)) bad.push([i, 'reservePool', r.reservePool, ePool]);
      if (!near(r.reserveOwner, eOwner)) bad.push([i, 'reserveOwner', r.reserveOwner, eOwner]);
      if (!near(r.ownerShare + r.staffTotal + r.reservePool + r.reserveOwner, zen))
        bad.push([i, 'zen']);
      // 母数は 前と 同じ（all_total は 自分の 車 込み）
      if (!near(r.poolSales, allTotal ? zen : othersNet)) bad.push([i, 'poolSales']);
    });
    expect(bad.slice(0, 5)).toEqual([]);
    expect(bad.length).toBe(0);
  });
});

// ── 偽の 会社（月3回・手当・控除 込み）で 給料タブ・明細・月次集計を 比べる ──
function ctxOf(pool_mode, rates, deduct) {
  const emps = [1, 2, 3].map((i) => ({
    employee_id: 'e' + i,
    name: '人' + i,
    role: i === 3 ? '1種' : '2種',
    sort_order: i,
    active: true,
  }));
  const md = [];
  const wh = [];
  const adj = [];
  for (let d = 1; d <= 30; d++) {
    const dt = '2026-09-' + String(d).padStart(2, '0');
    md.push({ work_date: dt, device_id: 'carA', sales_yen: 12347 + d * 7, hours: 3.3 });
    md.push({
      work_date: dt,
      device_id: 'carB',
      sales_yen: 9871 + d * 3,
      toll_yen: 500 + d * 11,
      hours: 2.7,
    });
    md.push({ work_date: dt, device_id: 'carC', sales_yen: 15001 + d, hours: 3.1 });
    wh.push({ work_date: dt, employee_id: 'e1', device_id: 'carA', hours: 0 });
    wh.push({ work_date: dt, employee_id: 'e2', device_id: 'carC', hours: 0 });
    if (d % 2) wh.push({ work_date: dt, employee_id: 'e3', device_id: 'carA', hours: 1.7 });
    if (d % 5 === 0) {
      adj.push({
        adj_id: 'x' + d,
        work_date: dt,
        employee_id: 'e' + ((d % 3) + 1),
        kind: d % 2 ? 'koujo' : 'teate',
        label: 't',
        yen: 1000 + d,
      });
    }
  }
  const ps = {
    period_end_mode: 'thirds',
    period_start_day: 1,
    owner_device_id: 'carB',
    pool_mode: pool_mode,
  };
  if (rates[0] !== undefined) ps.reserve_pool_rate = rates[0];
  if (rates[1] !== undefined) ps.reserve_owner_rate = rates[1];
  if (deduct !== undefined) ps.deduct_reserve_before_rate = deduct;
  return PD.buildCtx({
    shifts: [],
    edits: [],
    workHours: wh,
    manualDays: md,
    adjustments: adj,
    labels: [],
    employees: emps,
    payrollSettings: ps,
    salesSettings: { toll: true },
  });
}

function withEngine(eng, fn) {
  const keep = globalThis.DaikoPayroll;
  globalThis.DaikoPayroll = eng;
  try {
    return fn();
  } finally {
    globalThis.DaikoPayroll = keep;
  }
}

function payOf(ctx) {
  const ps = PP.periodsOf(2026, 9, { kata: ctx.settings.periodKata });
  return ps.map((p) => {
    const R = PD.report(p.dates, ctx);
    return {
      harai: R.harai,
      emp: R.employees.map((e) => ({
        id: e.employee_id,
        totalPay: e.totalPay,
        sashihiki: PD.haraiGaku(e.totalPay),
        cells: (e.cells || []).map((c) => (c ? c.pay : null)),
      })),
    };
  });
}

const RCASES = [];
for (const mode of ['others_total', 'per_car', 'all_total', undefined]) {
  for (const rates of RATES) {
    for (const dd of [undefined, false]) RCASES.push([mode, rates, dd]);
  }
}

describe('★給料タブ・明細：古い 版と 新しい 版で 同じ（4 設定 × 7 率の 組 × 2 割り方）★', () => {
  it('人ごとの totalPay・差引支給・日の 欄・みんなの 給料の 違いが 0 件', () => {
    const diffs = [];
    RCASES.forEach(([mode, rates, dd]) => {
      const ctx = ctxOf(mode, rates, dd);
      const a = withEngine(OLD, () => payOf(ctx));
      const b = withEngine(NEW, () => payOf(ctx));
      if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push([String(mode), rates, dd]);
      // 空の 比べで 緑に ならない 様に
      expect(a.some((x) => x.emp.some((e) => e.totalPay > 0))).toBe(true);
    });
    expect(diffs).toEqual([]);
  });
});

describe('★積立・会社に 残る分：月次集計と 給料タブが 同じ・決まり通り★', () => {
  RCASES.forEach(([mode, rates, dd]) => {
    it(String(mode) + ' ' + JSON.stringify(rates) + ' ' + String(dd), () => {
      const ctx = ctxOf(mode, rates, dd);
      const m = GA.month(2026, 9, ctx, []);
      const reps = PP.periodsOf(2026, 9, { kata: ctx.settings.periodKata }).map((p) =>
        PD.report(p.dates, ctx)
      );
      const wa = (f) => reps.reduce((a, r) => a + f(r), 0);
      // 決まりから 出す 積立（日ごと）
      let eRes = 0;
      for (let d = 1; d <= 30; d++) {
        const dt = '2026-09-' + String(d).padStart(2, '0');
        const day = PD.computeDay(dt, ctx);
        const ownerNet = day.owner.sales - day.owner.expense;
        expect(day.owner.expense).toBeGreaterThan(0); // 自分の 車に 経費が ある 日で 縛る
        const others = mode === 'all_total' ? day.poolSales - ownerNet : day.poolSales;
        const pr = rates[0] === undefined ? 0.05 : rates[0];
        const or = rates[1] === undefined ? 0.05 : rates[1];
        eRes += others * pr + ownerNet * or;
      }
      expect(m.reserve).toBeCloseTo(eRes, 6);
      expect(wa((r) => r.reserveTotal + r.reserveOwnerTotal)).toBeCloseTo(m.reserve, 6);
      expect(wa((r) => r.nokori)).toBeCloseTo(m.ownerShare, 6);
      expect(wa((r) => r.uriageZen)).toBeCloseTo(m.salesTotal, 6);
      // 売上 ＝ 会社に 残る分 ＋ 給料 ＋ 積立（どれも 1回）
      expect(m.ownerShare + m.payTotal + m.reserve).toBeCloseTo(m.salesTotal, 6);
    });
  });
});
