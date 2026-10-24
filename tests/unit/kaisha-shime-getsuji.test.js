'use strict';
// ============================================================
// ★★月次集計の 月＝会社の 締めの 期間★★ 2026-10-24（司さん「会社の締め日」・叩き役 K-3／K-4／K-7／K-8）
//
//   材料＝1月の 実物（tests/fixtures/daiko-month-jan2026.json）の 日ごとの 業務を 2025-10〜2027-02 の 毎月に 写した 物
//   物差しは ★この 試験の 中で 日付を 手で 並べて★ 足す（KaishaKikan を 使わない＝決まりの 勘違いを 写さない）
//
//   合格：
//   ① 20日締めの 偽の 会社で 10月＝9/21〜10/20 の 売上・実費・積立・請求書・電子決済、
//      給料＝「名前の 日」（締めた 日／始まった 日）が その 期間に ある 回
//   ② 末日の 会社は 今と 1円も 同じ（何月分を 締めた 日で 呼ぶ・始まった 日で 呼ぶ の 両方・月3回・週・毎日）
//      ＋ 会社の 期間の 道を 末日で 通しても 今と 同じ（決まりが 末日で 今の「何月分」に 戻る）
//   ③ 5日締め × 給料 25日締め：1月（前の 年の 12/6〜1/5）に 前の 年の 11/26〜12/25 の 回が 入り、抜けない
//      読んだ 日の 幅が 届かなければ 止める（叩き役 K-4）
//   ④ 2月が 割れない（28日締め・1日締め・うるう年）
//   ⑤ 締め日が 読めない ⇒ 止める（叩き役 K-8）
// ============================================================
const path = require('path');
const fs = require('fs');
const D = require('../../js/payroll-daily.js');
const G = require('../../js/getsuji-agg.js');
const P = require('../../js/payroll-period.js');

const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'daiko-month-jan2026.json'), 'utf8')
);

function p2(x) {
  return String(x).padStart(2, '0');
}
// ★1月の 日ごとの 業務を 毎月の 同じ 日に 写す★（その 月に 無い 日＝29〜31日 は 飛ばす）
function utsusu(payrollSettings) {
  const raw = {
    labels: FIX.labels,
    employees: FIX.employees,
    shifts: [],
    edits: [],
    workHours: [],
    payrollSettings: payrollSettings,
    salesSettings: FIX.salesSettings,
  };
  const pays = [];
  for (let t = new Date(2025, 9, 1); t < new Date(2027, 2, 1); t.setMonth(t.getMonth() + 1)) {
    const y = t.getFullYear();
    const m = t.getMonth() + 1;
    const last = new Date(y, m, 0).getDate();
    const ym = y + '-' + p2(m);
    const hiOf = (s) => +String(s).slice(8, 10);
    FIX.shifts.forEach((s) => {
      const d = hiOf(s.started_at);
      if (d > last) return;
      const id = s.shift_id + '@' + ym;
      raw.shifts.push(
        Object.assign({}, s, { shift_id: id, started_at: ym + String(s.started_at).slice(7) })
      );
      const e = FIX.edits.find((x) => x.shift_id === s.shift_id);
      if (e) raw.edits.push(Object.assign({}, e, { shift_id: id }));
    });
    FIX.workHours.forEach((w) => {
      const d = hiOf(w.work_date);
      if (d > last) return;
      raw.workHours.push(Object.assign({}, w, { work_date: ym + '-' + p2(d) }));
    });
    FIX.payments.forEach((x) => {
      const d = hiOf(x.pay_date);
      if (d > last) return;
      pays.push(Object.assign({}, x, { pay_date: ym + '-' + p2(d) }));
    });
  }
  return { ctx: D.buildCtx(raw), pays: pays };
}
function hibi(a, b) {
  const out = [];
  for (
    let t = new Date(a + 'T00:00:00Z');
    t <= new Date(b + 'T00:00:00Z');
    t.setUTCDate(t.getUTCDate() + 1)
  )
    out.push(t.toISOString().slice(0, 10));
  return out;
}
// ★物差し★ その 日の 並びの 売上・実費・積立・請求書・電子決済（手で 並べた 日だけ）
function monosashi(ctx, pays, dates) {
  const set = {};
  dates.forEach((d) => (set[d] = 1));
  const o = { uri: 0, jippi: 0, tsumi: 0, seikyu: 0, denshi: 0 };
  dates.forEach((d) => {
    const cars = ctx.byDate[d] || {};
    Object.keys(cars).forEach((dev) => {
      o.uri += cars[dev].sales - cars[dev].expense;
      o.jippi += cars[dev].expense;
    });
    const day = D.computeDay(d, ctx);
    o.tsumi += (day.reservePool || 0) + (day.reserveOwner || 0);
  });
  pays.forEach((x) => {
    if (!set[x.pay_date]) return;
    o.seikyu += x.invoice_yen || 0;
    o.denshi += x.denshi_yen || 0;
  });
  return o;
}
function harai(ctx, a, b) {
  return D.haraiGoukei(D.report(hibi(a, b), ctx));
}
const kataOf = (sh) => ({ owner_device_id: 'devT', period_end_mode: 'shime', period_shime: sh });

describe('① 20日締めの 偽の 会社：10月＝9/21〜10/20', () => {
  const { ctx, pays } = utsusu(FIX.payrollSettings); // 給料は 月3回（1〜10／11〜20／21〜末日）
  const m = G.month(2026, 10, ctx, pays, { hi: 20 });
  const o = monosashi(ctx, pays, hibi('2026-09-21', '2026-10-20'));
  it('止まらない・期間の 字', () => {
    expect(m.dame, m.riyuu).toBeFalsy();
    expect([m.kikanStart, m.kikanEnd, m.rangeLabel]).toEqual([
      '2026-09-21',
      '2026-10-20',
      '9/21 〜 10/20',
    ]);
  });
  it('売上・実費・積立・請求書・電子決済＝9/21〜10/20 の 日だけ', () => {
    expect(o.uri).toBeGreaterThan(0);
    expect(m.salesTotal).toBeCloseTo(o.uri, 6);
    expect(m.expense).toBeCloseTo(o.jippi, 6);
    expect(m.reserve).toBeCloseTo(o.tsumi, 6);
    expect(m.invoice).toBeCloseTo(o.seikyu, 6);
    expect(m.denshi).toBeCloseTo(o.denshi, 6);
    expect(m.cash).toBeCloseTo(o.uri - o.seikyu - o.denshi, 6);
  });
  it('給料＝9/21〜9/30・10/1〜10/10・10/11〜10/20 の 3回（明細の 差引支給の 和）', () => {
    expect(m.periods.map((p) => [p.start, p.end])).toEqual([
      ['2026-09-21', '2026-09-30'],
      ['2026-10-01', '2026-10-10'],
      ['2026-10-11', '2026-10-20'],
    ]);
    const w =
      harai(ctx, '2026-09-21', '2026-09-30') +
      harai(ctx, '2026-10-01', '2026-10-10') +
      harai(ctx, '2026-10-11', '2026-10-20');
    expect(w).toBeGreaterThan(0);
    expect(m.payTotal).toBe(w);
    expect(m.ownerShare).toBeCloseTo(o.uri - w - o.tsumi, 6);
  });
  it('給料 25日締め（締めた 日の 月の 分）＝名前の 日 9/25 ⇒ 8/26〜9/25 の 回', () => {
    const c = utsusu(kataOf({ kind: 'tsuki', hi: [25], nazuke: 'shime' }));
    const x = G.month(2026, 10, c.ctx, c.pays, { hi: 20 });
    expect(x.dame, x.riyuu).toBeFalsy();
    expect(x.periods.map((p) => [p.start, p.end])).toEqual([['2026-08-26', '2026-09-25']]);
    expect(x.payTotal).toBe(harai(c.ctx, '2026-08-26', '2026-09-25'));
  });
  it('給料 25日締め（始まった 日の 月の 分）＝名前の 日 9/26 ⇒ 9/26〜10/25 の 回', () => {
    const c = utsusu(kataOf({ kind: 'tsuki', hi: [25], nazuke: 'hajime' }));
    const x = G.month(2026, 10, c.ctx, c.pays, { hi: 20 });
    expect(x.dame, x.riyuu).toBeFalsy();
    expect(x.periods.map((p) => [p.start, p.end])).toEqual([['2026-09-26', '2026-10-25']]);
    expect(x.payTotal).toBe(harai(c.ctx, '2026-09-26', '2026-10-25'));
  });
  it('★年の 12期間で 給料の 回が ちょうど 1回ずつ（抜けも 2回も 無い）★', () => {
    ['shime', 'hajime'].forEach((nz) => {
      const c = utsusu(kataOf({ kind: 'tsuki', hi: [25], nazuke: nz }));
      const yr = G.year(2026, c.ctx, c.pays, { hi: 20 });
      const kai = yr.months.map((mm) => mm.periods.length);
      expect(kai, nz).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    });
  });
});

describe('② 末日の 会社は 今と 1円も 同じ', () => {
  const KATA = [
    null, // 月3回（設定の まま）
    { kind: 'tsuki', hi: [20], nazuke: 'shime' },
    { kind: 'tsuki', hi: [20], nazuke: 'hajime' },
    { kind: 'tsuki', hi: [25], nazuke: 'shime' },
    { kind: 'tsuki', hi: [25], nazuke: 'hajime' },
    { kind: 'tsuki', hi: [5, 15, 25], nazuke: 'hajime' },
    { kind: 'tsuki', hi: [15, 0], nazuke: 'shime' },
    { kind: 'shuu', youbi: 0, nazuke: 'shime' },
    { kind: 'shuu', youbi: 3, nazuke: 'hajime' },
    { kind: 'hi' },
  ];
  KATA.forEach((sh) => {
    it(JSON.stringify(sh), () => {
      const c = utsusu(sh ? kataOf(sh) : FIX.payrollSettings);
      const ima = G.year(2026, c.ctx, c.pays); // 今（引数 無し）
      const matsu = G.year(2026, c.ctx, c.pays, { hi: null }); // 末日を 選んだ 会社
      const ippan = G.year(2026, c.ctx, c.pays, { hi: null, ippan: true }); // 会社の 期間の 道を 末日で
      expect(ima.total.dame, ima.total.riyuu).toBeFalsy();
      const kazu = (yr) =>
        yr.months.map((mm) => [
          mm.salesTotal,
          mm.expense,
          mm.reserve,
          mm.invoice,
          mm.denshi,
          mm.cash,
          mm.payTotal,
          mm.ownerShare,
          mm.periods.map((p) => [p.start, p.end, p.pay, p.index]),
        ]);
      expect(kazu(matsu)).toEqual(kazu(ima));
      expect(matsu.total.periods).toEqual(ima.total.periods);
      expect(kazu(ippan)).toEqual(kazu(ima));
      expect(ippan.total.payTotal).toBe(ima.total.payTotal);
    });
  });
});

describe('③ 5日締め × 給料 25日締め：前の 年の 11月に かかる 回が 抜けない', () => {
  const c = utsusu(kataOf({ kind: 'tsuki', hi: [25], nazuke: 'shime' }));
  it('1月（2025-12-06〜2026-01-05）＝2025-11-26〜12-25 の 回', () => {
    const x = G.month(2026, 1, c.ctx, c.pays, { hi: 5, kara: '2025-11-01', made: '2027-01-31' });
    expect(x.dame, x.riyuu).toBeFalsy();
    expect([x.kikanStart, x.kikanEnd]).toEqual(['2025-12-06', '2026-01-05']);
    expect(x.periods.map((p) => [p.start, p.end])).toEqual([['2025-11-26', '2025-12-25']]);
    const w = harai(c.ctx, '2025-11-26', '2025-12-25');
    expect(w).toBeGreaterThan(harai(c.ctx, '2025-12-01', '2025-12-25')); // 11月の 日も 入っている
    expect(x.payTotal).toBe(w);
  });
  it('★読んだ 日が 12/1 から（前の 作り）なら 止める（抜けた 給料で 出さない）★', () => {
    const x = G.month(2026, 1, c.ctx, c.pays, { hi: 5, kara: '2025-12-01', made: '2027-01-31' });
    expect(x.dame).toBe(true);
    expect(x.haba).toBe(true);
    const yr = G.year(2026, c.ctx, c.pays, { hi: 5, kara: '2025-12-01', made: '2027-01-31' });
    expect(yr.total.dame).toBe(true);
  });
});

describe('④ 2月が 割れない', () => {
  const c = utsusu(FIX.payrollSettings);
  [
    [2026, 28, '2026-01-29', '2026-02-28'],
    [2026, 1, '2026-01-02', '2026-02-01'],
    [2026, 27, '2026-01-28', '2026-02-27'],
  ].forEach(([y, hi, a, b]) => {
    it(y + '年 2月 ' + hi + '日締め＝' + a + '〜' + b, () => {
      const x = G.month(y, 2, c.ctx, c.pays, { hi: hi });
      expect(x.dame, x.riyuu).toBeFalsy();
      expect([x.kikanStart, x.kikanEnd]).toEqual([a, b]);
      const o = monosashi(c.ctx, c.pays, hibi(a, b));
      expect(x.salesTotal).toBeCloseTo(o.uri, 6);
    });
  });
  it('28日締めの 3月（3/1〜3/28）は 月3回の 回が 3/1〜3/10・3/11〜3/20 の 2回（2/21〜2/28 は 2月）', () => {
    const x = G.month(2026, 3, c.ctx, c.pays, { hi: 28 });
    expect(x.periods.map((p) => [p.start, p.end])).toEqual([
      ['2026-03-01', '2026-03-10'],
      ['2026-03-11', '2026-03-20'],
    ]);
    const f = G.month(2026, 2, c.ctx, c.pays, { hi: 28 });
    expect(f.periods.map((p) => p.start)).toEqual([
      '2026-01-21',
      '2026-02-01',
      '2026-02-11',
      '2026-02-21',
    ]);
  });
  it('★年の 合計＝12期間の 和（日も 回も 2回 数えない）★', () => {
    [1, 5, 15, 20, 27, 28].forEach((hi) => {
      const yr = G.year(2026, c.ctx, c.pays, { hi: hi });
      const o = monosashi(c.ctx, c.pays, hibi(yr.months[0].kikanStart, yr.months[11].kikanEnd));
      expect(yr.total.salesTotal, String(hi)).toBeCloseTo(o.uri, 4);
      // 月3回の 回の 名前の 日（締めた 日）＝期間の 中の 回だけ・全部で 36回
      expect(
        yr.months.reduce((s, mm) => s + mm.periods.length, 0),
        String(hi)
      ).toBe(36);
    });
  });
});

describe('⑤ 締め日が 読めない ⇒ 止める（末日に 倒さない）', () => {
  const c = utsusu(FIX.payrollSettings);
  it('dame を 渡すと 月も 年も 止まる・訳が 出る', () => {
    const k = { dame: true, riyuu: '会社の 締め日（kaisha_shime_hi）を 読めませんでした' };
    const x = G.month(2026, 10, c.ctx, c.pays, k);
    expect(x.dame).toBe(true);
    expect(x.kaishaShime).toBe(true);
    expect(x.payTotal).toBe(0);
    expect(x.salesTotal).toBe(0);
    const yr = G.year(2026, c.ctx, c.pays, k);
    expect(yr.total.dame).toBe(true);
    expect(yr.total.kaishaShime).toBe(true);
    expect(yr.total.riyuu).toContain('締め日');
  });
});

describe('★年の 給料の 列（会社の 期間）★', () => {
  it('20日締め × 月3回 ＝ 3列（全部の 月で 回の 数が 揃う）・列の 和＝年の 給料', () => {
    const c = utsusu(FIX.payrollSettings);
    const yr = G.year(2026, c.ctx, c.pays, { hi: 20 });
    expect(yr.total.periods.length).toBe(3);
    const wa = yr.total.periods.reduce((s, p) => s + p.pay, 0);
    expect(wa).toBeCloseTo(yr.total.payTotal, 6);
  });
  it('28日締め × 給料 末日締め（2月に 2回・3月に 0回）＝列を 出さない（違う 回を 同じ 列に 足さない）', () => {
    const c = utsusu(kataOf({ kind: 'tsuki', hi: [0], nazuke: 'shime' }));
    const yr = G.year(2026, c.ctx, c.pays, { hi: 28 });
    expect(yr.total.dame, yr.total.riyuu).toBeFalsy();
    expect(yr.months[1].periods.length).toBe(2);
    expect(yr.months[2].periods.length).toBe(0);
    expect(yr.total.periods).toEqual([]);
  });
  it('記録（何日から）で 締めが 変わった 会社も 会社の 期間で 回が 抜けない・2回 数えない', () => {
    const k0 = P.yomu(kataOf({ kind: 'tsuki', hi: [20], nazuke: 'shime' })).kata;
    const kata = P.rirekiKata(k0, [
      { from_date: '2026-06-11', value: { kind: 'tsuki', hi: [0], nazuke: 'shime' } },
    ]);
    const c = utsusu(kataOf({ kind: 'tsuki', hi: [20], nazuke: 'shime' }));
    c.ctx.settings.periodKata = kata;
    const yr = G.year(2026, c.ctx, c.pays, { hi: 15 });
    expect(yr.total.dame, yr.total.riyuu).toBeFalsy();
    const kai = {};
    yr.months.forEach((mm) =>
      mm.periods.forEach((p) => hibi(p.start, p.end).forEach((d) => (kai[d] = (kai[d] || 0) + 1)))
    );
    const nibai = Object.keys(kai).filter((d) => kai[d] > 1);
    expect(nibai).toEqual([]);
    // 抜けも 無い（最初の 回の 頭〜最後の 回の 尻の 日が 全部 ちょうど 1回）
    const l = Object.keys(kai).sort();
    expect(hibi(l[0], l[l.length - 1]).filter((d) => kai[d] !== 1)).toEqual([]);
  });
});
