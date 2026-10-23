'use strict';
// ============================================================
// ★★給料の 合計の ずれ（件G）★★ 2026-10-23
//
//   司さん「明細を全員分足した額と月次の給料の全員足した額がズレ」
//   払うのは 明細の 差引支給（人ごとの totalPay を Math.round）。
//   ⇒ 給料の 合計は どこでも「払う回ごとに 人ごとの 差引支給を 丸めてから 足す」。
//
//   偽の 会社：3人・端数が 出る 歩合・手当 1件・名簿に いない 人の 控除 333円 1件・月3回 締め
//   縛る 物：明細の 差引支給の 全員分の 和
//     ＝ 月次集計の 回の 額 ＝ 給料タブの みんなの給料 ＝ 給料表の 紙（月・日・年・個別）の 合計
//     ＝ 月次の 紙の 合計／会社に 残る分が 両画面で 同じ／帯が 出る／日の 欄の 注記
//
//   ★わざと壊して 赤（2026-10-23 実測）★
//     ①直す 前の 版（be349791a の js・kyuryo.html・shukei.html に 戻す）⇒ ★赤 18 / 緑 3★（21本）
//       （緑の 3本＝前提・給料表の 月ごと・日ごと＝この 偽の 会社では 丸める 前の 和を 丸めても 偶々 同じ）
//     ②直した 後 ⇒ 21本 全部 緑
//     ③直した 後で getsuji-agg の 回の 額を 前の 作り（日の staffTotal を 丸めずに 足す）に 戻す ⇒ ★赤 6 / 緑 15★
// ============================================================
const fs = require('fs');
const path = require('path');
const { parseHTML } = require('./_kami-dom.js');
global.document = {
  createElement() {
    const el = { className: '', _html: '' };
    Object.defineProperty(el, 'innerHTML', {
      get() {
        return el._html;
      },
      set(v) {
        el._html = String(v);
        Object.assign(el, parseHTML(el._html));
      },
    });
    return el;
  },
};
globalThis.PayrollPeriod = require('../../js/payroll-period.js');
globalThis.DaikoPayroll = require('../../js/daiko-payroll.js');
globalThis.UriageAgg = require('../../js/uriage-agg.js');
const PD = require('../../js/payroll-daily.js');
const GA = require('../../js/getsuji-agg.js');
const PP = globalThis.PayrollPeriod;
const K = require('../../js/kami-kumu.js');
global.KamiKumu = K;
const H = require('../../js/kami-hyou.js');
const KS = require('../../js/kami-shukei.js');

const ROOT = path.join(__dirname, '..', '..');
const KYU = fs.readFileSync(path.join(ROOT, 'kyuryo.html'), 'utf8');
const SHU = fs.readFileSync(path.join(ROOT, 'shukei.html'), 'utf8');

// ── 偽の 会社 ──
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
  md.push({ work_date: dt, device_id: 'carB', sales_yen: 9871 + d * 3, hours: 2.7 });
  wh.push({ work_date: dt, employee_id: 'e1', device_id: 'carA', hours: 0 });
  wh.push({ work_date: dt, employee_id: 'e2', device_id: 'carB', hours: 0 });
  if (d % 2) wh.push({ work_date: dt, employee_id: 'e3', device_id: 'carA', hours: 1.7 });
}
const adj = [
  {
    adj_id: 'a1',
    work_date: '2026-09-05',
    employee_id: 'e1',
    kind: 'teate',
    label: '待機',
    yen: 1000,
  },
  // ★名簿に いない 人の 控除★（明細に 載らない）
  {
    adj_id: 'a2',
    work_date: '2026-09-06',
    employee_id: 'ghost',
    kind: 'koujo',
    label: '前借り',
    yen: 333,
  },
];
const SET = { period_end_mode: 'thirds', period_start_day: 1 };
const ctx = PD.buildCtx({
  shifts: [],
  edits: [],
  workHours: wh,
  manualDays: md,
  adjustments: adj,
  labels: [],
  employees: emps,
  payrollSettings: SET,
  salesSettings: null,
});
const ps = PP.periodsOf(2026, 9, { kata: ctx.settings.periodKata });
const reps = ps.map((p) => PD.report(p.dates, ctx));
// ★明細の 差引支給＝人ごとの totalPay を 丸めた 額（試験の 中で 自分で 出す）★
const meisaiOf = (rep) => rep.employees.reduce((a, e) => a + Math.round(e.totalPay), 0);
const MEISAI = reps.map(meisaiOf);
const MEISAI_ZEN = MEISAI.reduce((a, b) => a + b, 0);
const m = GA.month(2026, 9, ctx, []);
const yr = GA.year(2026, ctx, []);

// kyuryo.html の 中の 関数を 切り出す（同じ 物を 試す）
function kiridasu(src, name, tsugi) {
  const a = src.indexOf('function ' + name + '(');
  const b = src.indexOf('function ' + tsugi + '(', a);
  if (a < 0 || b < 0) throw new Error(name + ' が 見つからない');
  return src.slice(a, b);
}
const kamiHito = new Function(
  'PayrollDaily',
  kiridasu(KYU, 'kamiHito', 'kamiNamae') + '\nreturn kamiHito;'
)(PD);
// 紙に 渡す 形（kyuryo.html kamiCtx の 戻りと 同じ）
const hibi = [];
ps.forEach((p) => p.dates.forEach((d) => hibi.push(d)));
const R = { ps, hibi, mainichi: false, kikanRep: reps, hiRep: PD.report(hibi, ctx) };
const HITO = kamiHito(R);
const KAISHA = { name: '偽の会社', year: 2026, month: 9, settings: SET };
const NAMAE = ps.map((p) => p.rangeLabel);
// 紙の 大きい 箱の 数を 読む
function hako(mai, k) {
  const html = mai.map((x) => x.el._html).join('');
  const re = new RegExp(
    '<div class="k">' + k + '</div><div class="v">([^<]*(?:<[^>]*>[^<]*)*?)</div></div>'
  );
  const x = re.exec(html);
  if (!x) throw new Error(k + ' の 箱が 無い');
  return Number(x[1].replace(/<[^>]*>/g, '').replace(/[^0-9-]/g, ''));
}

describe('★偽の 会社は 端数が 出る（試験の 前提）★', () => {
  it('丸める 前の 給料に 1円未満が 在る・名簿外の 控除が 在る', () => {
    expect(reps.some((r) => r.employees.some((e) => e.totalPay !== Math.round(e.totalPay)))).toBe(
      true
    );
    expect(ps.length).toBe(3);
    expect(MEISAI_ZEN).toBeGreaterThan(0);
  });
});

describe('★月次集計 ＝ 明細の 差引支給の 全員分★', () => {
  it('回の 欄（3回とも）', () => {
    expect(m.periods.map((p) => p.pay)).toEqual(MEISAI);
  });
  it('月の 欄', () => {
    expect(m.payTotal).toBe(MEISAI_ZEN);
  });
  it('年の 欄（月・回ごと）', () => {
    expect(yr.total.payTotal).toBe(MEISAI_ZEN);
    expect(yr.total.periods.map((p) => p.pay)).toEqual(MEISAI);
  });
  it('会社に 残る分 ＝ 売上 − 丸めた 給料 − 積立', () => {
    expect(m.ownerShare).toBeCloseTo(m.salesTotal - MEISAI_ZEN - m.reserve, 6);
  });
});

describe('★給料タブ ＝ 同じ 数★', () => {
  it('みんなの給料（回ごと）＝ 明細の 差引支給の 全員分', () => {
    expect(reps.map((r) => r.harai)).toEqual(MEISAI);
  });
  it('画面は REP.harai／REP.nokori を 出す（丸める 前の staffTotalAll・日ごとの ownerShareTotal を 出さない）', () => {
    const a = KYU.indexOf('<b>会社に残る分</b>');
    const kakera = KYU.slice(a, a + 900);
    expect(kakera).toMatch(/yen\(REP\.nokori\)/);
    expect(kakera).toMatch(/みんなの給料 ¥' \+\s*yen\(REP\.harai\)/);
    expect(kakera).not.toMatch(/REP\.staffTotalAll|REP\.ownerShareTotal/);
  });
  it('会社に 残る分が 両画面で 同じ（月3回＝回の 和 ＝ 月）', () => {
    const kyu = reps.reduce((a, r) => a + r.nokori, 0);
    expect(Math.round(kyu)).toBe(Math.round(m.ownerShare));
  });
});

describe('★給料表の 紙（月・日・年・個別）の 合計 ＝ 同じ 数★', () => {
  it('月ごと', () => {
    expect(hako(H.kyuryoTsuki(KAISHA, { namae: NAMAE, hito: HITO }), '給料 合計')).toBe(MEISAI_ZEN);
  });
  it('日ごと', () => {
    expect(hako(H.kyuryoHi(KAISHA, { hito: HITO }), '給料 合計')).toBe(MEISAI_ZEN);
  });
  it('個別（全員分を 足す）', () => {
    const s = HITO.reduce(
      (a, p) => a + hako(H.kyuryoKojin(KAISHA, { namae: NAMAE, hito: p }), '支給 合計'),
      0
    );
    expect(s).toBe(MEISAI_ZEN);
  });
  it('年ごと（kyuryo.html と 同じ まとめ方＝employee_id）', () => {
    // kyuryo.html の 年ごとの 組み方を 写す（下の 字の 見張りで 本体と 同じかを 縛る）
    const box = {};
    const na = {};
    HITO.forEach((p) => {
      const v = p.kikan.reduce((a, b) => a + (b || 0), 0);
      if (!v) return;
      box[p.id] = (box[p.id] || 0) + v;
      na[p.id] = p.name;
    });
    const hito = Object.keys(na).map((x) => ({ id: x, name: na[x] }));
    let zen = 0;
    Object.keys(box).forEach((x) => (zen += box[x]));
    expect(zen).toBe(MEISAI_ZEN);
    const mai = H.kyuryoNen({ ...KAISHA, month: 1 }, { hito, tsuki: { 9: box }, zen });
    const html = mai[0].el._html;
    const sum = /<tr class="sum">([\s\S]*?)<\/tr>/.exec(html)[1];
    const tds = sum
      .match(/<td>[^<]*(?:<span[^>]*>[^<]*<\/span>)?<\/td>/g)
      .map((t) => Number(t.replace(/<[^>]*>/g, '').replace(/[^0-9-]/g, '')));
    expect(tds[tds.length - 1]).toBe(MEISAI_ZEN);
  });
  it('年ごとは employee_id で まとめる（同じ 名前の 2人を 1列に しない）', () => {
    expect(KYU).toMatch(/box\[p\.id\] = \(box\[p\.id\] \|\| 0\) \+ v;/);
    expect(KYU).not.toMatch(/box\[p\.name\]/);
    const mai = H.kyuryoNen(
      { ...KAISHA, month: 1 },
      {
        hito: [
          { id: 'x1', name: '同じ' },
          { id: 'x2', name: '同じ' },
        ],
        tsuki: { 9: { x1: 100, x2: 200 } },
        zen: 300,
      }
    );
    const html = mai[0].el._html;
    expect((html.match(/<th>同じ<\/th>/g) || []).length).toBe(2);
    expect(html).toContain('>100<');
    expect(html).toContain('>200<');
  });
});

describe('★月次の 紙 ＝ 同じ 数★', () => {
  it('給料・会社に 残る分', () => {
    const mai = H.getsuji(KAISHA, KS.getsujiData(m, []));
    expect(hako(mai, '給料')).toBe(MEISAI_ZEN);
    expect(hako(mai, '会社に残る分')).toBe(Math.round(m.ownerShare));
  });
});

describe('★明細に 載らない 手当・控除の 帯★', () => {
  it('名簿外の 控除は 合計に 入れず 数だけ 返す（1件）', () => {
    expect(m.meisaiGai).toBe(1);
    expect(yr.total.meisaiGai).toBe(1);
    expect(reps.reduce((a, r) => a + r.meisaiGai.length, 0)).toBe(1);
  });
  it('帯の 字', () => {
    expect(PD.meisaiGaiJi(1)).toBe('明細に載らない手当・控除が1件あります（合計に入れていません）');
    expect(PD.meisaiGaiJi(0)).toBe('');
  });
  it('月次集計と 給料タブに 帯の 枠が 在り 数を 入れる', () => {
    expect(SHU).toContain('id="meisaiGaiObi"');
    expect(SHU).toMatch(/meisaiGaiObi\(t\.meisaiGai\)/);
    expect(KYU).toContain('id="meisaiGaiObi"');
    expect(KYU).toMatch(/PayrollDaily\.meisaiGaiJi\(\(REP\.meisaiGai \|\| \[\]\)\.length\)/);
  });
});

describe('★明細の 日の 欄の 注記（±1円）★', () => {
  it('偽の 会社には 日の 欄の 和が 差引支給と ずれる 人が 居る', () => {
    const zure = reps.flatMap((r) => r.employees.filter((e) => PD.hiNoZure(e)));
    expect(zure.length).toBeGreaterThan(0);
  });
  it('ずれない 人には 出さない', () => {
    const e = reps[0].employees.find((x) => x.employee_id === 'e1');
    expect(PD.hiNoZure(e)).toBe(false);
  });
  it('明細の 紙（kyuryo.html）と 給料表の 日ごと・個別の 紙に 出る', () => {
    expect(KYU).toMatch(/hiZureGyou\(e\)/);
    expect(H.kyuryoHi(KAISHA, { hito: HITO })[0].el._html).not.toContain(PD.HI_ZURE_JI);
    const p = HITO.find((x) => x.id === 'e2');
    expect(H.kyuryoKojin(KAISHA, { namae: NAMAE, hito: p })[0].el._html).not.toContain(
      PD.HI_ZURE_JI
    );
  });
  it('月次集計の 説明は 事実と 合う（「日ごとに出した分を足した物と一致」を 言わない）', () => {
    expect(SHU).not.toContain('日ごとに出した分を足した物と一致します');
  });
});
