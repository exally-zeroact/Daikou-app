'use strict';
// ============================================================
// ★★給料の 締め（period_shime）★★ 2026-10-07
//   司さん「この払い方がまだ対応できてないやろが」
//   司さんの 決め（10-07）: 何月分と 呼ぶかは ★会社が 選ぶ★（nazuke）／月次の 給料は 締めた 分
//   ★守る 性質★
//     1. 2020〜2030 の 全部の 日が ★ちょうど 1つ★の 期に 入る（隙間も 重なりも 無い）
//     2. 月3回（10・20・末日）は 今の thirds と ★全部の 項目が 同じ★
//     3. 壊れた・知らない・昔の month_end/days・何月分が 無い ⇒ dame（黙って 月3回に しない）
// ============================================================
const P = require('../../js/payroll-period.js');

function zenbu(kata) {
  // 2020-01〜2030-12 の 期を 全部 並べ、日ごとに 何回 出たか 数える
  const kai = {};
  const mondai = [];
  const kara = []; // 期が 0 の 月（30日締め＋始まった月の分 の 2月 等）
  for (let y = 2020; y <= 2030; y++) {
    for (let m = 1; m <= 12; m++) {
      const ps = P.periodsOf(y, m, { kata: kata });
      if (!ps.length) kara.push(y + '-' + m);
      let mae = null;
      ps.forEach((p) => {
        if (!p.dates.length) mondai.push(p.label + ' 空');
        if (p.dates[0] !== p.start || p.dates[p.dates.length - 1] !== p.end)
          mondai.push(p.rangeLabel + ' 端が 違う');
        if (mae && p.start <= mae) mondai.push(p.rangeLabel + ' 逆');
        mae = p.end;
        p.dates.forEach((d) => {
          kai[d] = (kai[d] || 0) + 1;
        });
      });
    }
  }
  // 端の 月（2020-01 の 前・2030-12 の 後）に はみ出た 日を 除いて 見る
  const hi = [];
  for (let t = new Date(2020, 1, 1); t < new Date(2030, 10, 1); t.setDate(t.getDate() + 1)) {
    const d =
      t.getFullYear() +
      '-' +
      String(t.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(t.getDate()).padStart(2, '0');
    if (kai[d] !== 1) hi.push(d + '=' + (kai[d] || 0));
  }
  return { mondai: mondai, hi: hi.slice(0, 5), nHi: hi.length, kara: kara };
}

const KATA = [];
[
  [10, 20, 0],
  [15, 0],
  [0],
  [20],
  [25],
  [5, 15, 25],
  [1],
  [30],
  [31],
  [5, 10, 15, 20, 25, 0],
].forEach((hi) => {
  ['shime', 'hajime'].forEach((nz) => KATA.push({ kind: 'tsuki', hi: hi, nazuke: nz }));
});
for (let w = 0; w < 7; w++) {
  KATA.push({ kind: 'shuu', youbi: w, nazuke: 'shime' });
  KATA.push({ kind: 'shuu', youbi: w, nazuke: 'hajime' });
}
KATA.push({ kind: 'hi' });

describe('★どの 形でも 全部の 日が ちょうど 1回★（2020〜2030）', () => {
  KATA.forEach((sh) => {
    it(JSON.stringify(sh), () => {
      const y = P.seiki(sh);
      expect(y.ok, JSON.stringify(y)).toBe(true);
      const r = zenbu(y.kata);
      expect(r.mondai.slice(0, 5)).toEqual([]);
      expect(r.nHi, '抜け/重なり ' + r.hi.join(',')).toBe(0);
      // ★期が 0 の 月は 30日締め＋始まった月の分 だけ（2月の 前の 1/31 から 始まる 期は 1月分）★
      const ari =
        sh.kind === 'tsuki' && sh.nazuke === 'hajime' && sh.hi.length === 1 && sh.hi[0] === 30;
      expect(r.kara.length > 0, '期が 0 の 月 ' + r.kara.slice(0, 3).join(',')).toBe(ari);
    });
  });
});

describe('★月3回（10・20・末日）は 今の thirds と 全部 同じ★', () => {
  it('2020〜2030 全月 toEqual', () => {
    const y = P.seiki({ kind: 'tsuki', hi: [20, 0, 10] });
    expect(y.kata.kind).toBe('thirds');
    for (let yy = 2020; yy <= 2030; yy++)
      for (let m = 1; m <= 12; m++)
        expect(P.periodsOf(yy, m, { kata: y.kata })).toEqual(
          P.periodsOf(yy, m, { endMode: 'thirds' })
        );
  });
  it('昔の 列（period_end_mode=thirds・period_shime 無し）も 同じ', () => {
    const y = P.yomu({ period_end_mode: 'thirds', period_start_day: 21, period_days: 11 });
    expect(y.kata.kind).toBe('thirds');
  });
});

describe('★20日締め★', () => {
  it('締めた 月の 分 ⇒ 10月分 = 9/21〜10/20', () => {
    const k = P.seiki({ kind: 'tsuki', hi: [20], nazuke: 'shime' }).kata;
    const ps = P.periodsOf(2026, 10, { kata: k });
    expect(ps.length).toBe(1);
    expect([ps[0].start, ps[0].end, ps[0].label]).toEqual(['2026-09-21', '2026-10-20', '10月分']);
    expect(ps[0].name).toBe('9/21 ~ 10/20');
  });
  it('始まった 月の 分 ⇒ 10月分 = 10/21〜11/20', () => {
    const k = P.seiki({ kind: 'tsuki', hi: [20], nazuke: 'hajime' }).kata;
    const ps = P.periodsOf(2026, 10, { kata: k });
    expect([ps[0].start, ps[0].end]).toEqual(['2026-10-21', '2026-11-20']);
  });
  it('30日締めの 2月 ⇒ 末日（2/28）で 締める', () => {
    const k = P.seiki({ kind: 'tsuki', hi: [30], nazuke: 'shime' }).kata;
    const ps = P.periodsOf(2026, 2, { kata: k });
    expect([ps[0].start, ps[0].end]).toEqual(['2026-01-31', '2026-02-28']);
    expect(P.periodsOf(2026, 3, { kata: k })[0].start).toBe('2026-03-01');
  });
  it('月2回（15・末日）は 月の 中で 閉じる＝名前は 日だけ', () => {
    const k = P.seiki({ kind: 'tsuki', hi: [15, 0] }).kata;
    expect(P.periodsOf(2026, 2, { kata: k }).map((p) => p.name)).toEqual(['1〜15日', '16日〜末日']);
  });
});

describe('★週・毎日★', () => {
  it('日曜締め・締めた 月の 分 ⇒ 2026年10月 は 締め日が 10月の 4週', () => {
    const k = P.seiki({ kind: 'shuu', youbi: 0, nazuke: 'shime' }).kata;
    const ps = P.periodsOf(2026, 10, { kata: k });
    expect(ps.map((p) => p.end)).toEqual(['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']);
    expect(ps[0].start).toBe('2026-09-28');
    expect(ps.every((p) => p.dates.length === 7)).toBe(true);
  });
  it('毎日 ⇒ その月の 日の 数', () => {
    const ps = P.periodsOf(2028, 2, { kata: { kind: 'hi' } });
    expect(ps.length).toBe(29);
    expect(ps[28].name).toBe('29日');
  });
});

describe('★止める（黙って 月3回に しない）★', () => {
  const D = [
    ['昔の month_end', { period_end_mode: 'month_end', period_start_day: 21 }],
    ['昔の days', { period_end_mode: 'days', period_days: 11 }],
    ['知らない 値', { period_end_mode: 'month3' }],
    ['壊れた 形', { period_end_mode: 'thirds', period_shime: { kind: 'tsuki', hi: ['x'] } }],
    ['知らない 形', { period_end_mode: 'thirds', period_shime: { kind: 'nanika' } }],
    ['空の 締め日', { period_shime: { kind: 'tsuki', hi: [] } }],
    ['20日締めで 何月分が 無い', { period_shime: { kind: 'tsuki', hi: [20] } }],
    ['週で 何月分が 無い', { period_shime: { kind: 'shuu', youbi: 0 } }],
    ['曜日が おかしい', { period_shime: { kind: 'shuu', youbi: 7, nazuke: 'shime' } }],
    ['何月分が 知らない 値', { period_shime: { kind: 'tsuki', hi: [20], nazuke: 'raigetsu' } }],
  ];
  D.forEach(([na, row]) => {
    it(na + ' ⇒ dame・期は 0', () => {
      const y = P.yomu(row);
      expect(y.dame, JSON.stringify(y)).toBe(true);
      expect(typeof y.riyuu).toBe('string');
      expect(P.periodsOf(2026, 10, { kata: y })).toEqual([]);
    });
  });
  it('末日で 終わる 形は 何月分が 無くても よい（またがない）', () => {
    expect(P.yomu({ period_shime: { kind: 'tsuki', hi: [15, 0] } }).ok).toBe(true);
    expect(P.yomu({ period_shime: { kind: 'hi' } }).ok).toBe(true);
  });
});

// ============================================================
// ★★月次集計（司さん「イ」＝その月に 締めた 分）★★
// ============================================================
const fs = require('fs');
const path = require('path');
const D = require('../../js/payroll-daily.js');
const G = require('../../js/getsuji-agg.js');
const FIXM = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'daiko-month-jan2026.json'), 'utf8')
);
function ctxOf(shime) {
  const f = JSON.parse(JSON.stringify(FIXM));
  f.payrollSettings = Object.assign({}, f.payrollSettings, {
    period_shime: shime,
    period_end_mode: shime ? 'shime' : 'thirds',
  });
  return D.buildCtx(f);
}

describe('★月次集計の 給料＝締めた 分★', () => {
  it('★月3回は 今までの 作り（期の 中の その月の 日 → 期の 小計 → 月）と ビットで 同じ（===）★', () => {
    const ctx = ctxOf(null);
    for (let m = 1; m <= 12; m++) {
      const mae = P.periodsOf(2026, m, { endMode: 'thirds' }).reduce((s, p) => {
        let pay = 0;
        p.dates
          .filter((d) => d.slice(0, 7) === '2026-' + String(m).padStart(2, '0'))
          .forEach((d) => {
            pay += Number(D.computeDay(d, ctx).staffTotal) || 0;
          });
        return s + pay;
      }, 0);
      expect(G.month(2026, m, ctx, []).payTotal === mae, m + '月').toBe(true);
    }
  });

  it('★20日締め・締めた月の分：1月分 + 2月分 ＝ 1月の 日 全部（期の 外に 落ちた 日が 無い）★', () => {
    const c3 = ctxOf(null);
    const c20 = ctxOf({ kind: 'tsuki', hi: [20], nazuke: 'shime' });
    const zen = G.month(2026, 1, c3, []).payTotal;
    const a = G.month(2026, 1, c20, []);
    const b = G.month(2026, 2, c20, []);
    expect(zen).toBeGreaterThan(0);
    expect(a.periods.map((p) => p.rangeLabel)).toEqual(['12/21 ~ 1/20']);
    expect(b.periods.map((p) => p.rangeLabel)).toEqual(['1/21 ~ 2/20']);
    expect(a.payTotal + b.payTotal).toBeCloseTo(zen, 6);
    // ★②の 行の 和 ＝ 合計★
    expect(a.periods.reduce((s, p) => s + p.pay, 0)).toBe(a.payTotal);
  });

  it('★始まった月の分：12月分（12/21〜1/20）に 1月の 1〜20日が 入る★', () => {
    const c = ctxOf({ kind: 'tsuki', hi: [20], nazuke: 'hajime' });
    const dec = G.month(2025, 12, c, []);
    expect(dec.periods.map((p) => p.rangeLabel)).toEqual(['12/21 ~ 1/20']);
    expect(dec.payTotal).toBeGreaterThan(0);
  });

  it('★設定が 読めない・形が 無い ⇒ 月次は 止める（給料 0 で 進まない）★', () => {
    const c = ctxOf(null);
    c.settings.periodKata = { dame: true, riyuu: 'て' };
    expect(G.month(2026, 1, c, []).dame).toBe(true);
    delete c.settings.periodKata;
    expect(G.month(2026, 1, c, []).dame).toBe(true);
    expect(G.year(2026, c, []).total.dame).toBe(true);
    // ★読めなかった 行（通信）★
    expect(P.yomu({ yomenai: true }).dame).toBe(true);
    // ★「開き直して」は 文の 字でなく 印で 分ける★（対立役 10-07 B）
    expect(P.yomu({ yomenai: true }).tsushin).toBe(true);
    expect(P.yomu({ period_end_mode: 'month_end' }).tsushin).toBeUndefined();
    const c2 = ctxOf(null);
    c2.settings.periodKata = P.yomu({ yomenai: true });
    expect(G.year(2026, c2, []).total.tsushin).toBe(true);
  });

  it('★毎日・週は 年の 期の 列を 出さない★／月3回は 数の 順', () => {
    expect(G.year(2026, ctxOf({ kind: 'hi' }), []).total.periods).toEqual([]);
    expect(G.year(2026, ctxOf(null), []).total.periods.map((p) => p.index)).toEqual([0, 1, 2]);
  });
});

// ============================================================
// ★★門：区切りは 必ず 設定の 形（kata）で 呼ぶ★★（対立役 10-07 I）
//   昔の 低い 道（endMode を 直に 渡す）で 呼ぶと 知らない 値が 黙って 月3回に なる
// ============================================================
describe('★門：画面と 集計は periodsOf を kata で 呼ぶ★', () => {
  it('kata を 渡さない 呼び出しが 0 か所', () => {
    const R = path.join(__dirname, '..', '..');
    const files = ['kyuryo.html', 'shukei.html', 'uriage.html', 'nyuryoku.html'].concat(
      fs
        .readdirSync(path.join(R, 'js'))
        .filter((x) => x.endsWith('.js') && x !== 'payroll-period.js')
        .map((x) => 'js/' + x)
    );
    const dame = [];
    let mita = 0;
    files.forEach((f) => {
      const p = path.join(R, f);
      // ★無い ファイルは 読めずに 落ちる＝赤★（黙って 飛ばさない）
      const s = fs.readFileSync(p, 'utf8');
      const re = /periodsOf\(([^;]*?)\)\s*;/g;
      let m;
      while ((m = re.exec(s))) {
        mita++;
        if (m[1].indexOf('kata') < 0) dame.push(f + ': ' + m[0].slice(0, 80));
      }
    });
    expect(mita, '★1つも 見ていない＝空回り★').toBeGreaterThanOrEqual(5);
    expect(dame).toEqual([]);
  });
});

// ============================================================
// ★★紙の 日の 並び（k.hibi）★★（対立役 10-07 B：月の 何日で 数えると 前の月の 日が 重なる）
// ============================================================
describe('★紙は 日付の 並びで 日の 列を 作る★', () => {
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
  const K = require('../../js/kami-kumu.js');
  global.KamiKumu = K;
  const H = require('../../js/kami-hyou.js');
  it('20日締め 10月分（9/21〜10/20＝30日）：前の月の 日は「9/21」・日数 30・合計 ＝ 日の 和', () => {
    const k20 = P.seiki({ kind: 'tsuki', hi: [20], nazuke: 'shime' }).kata;
    const hibi = P.periodsOf(2026, 10, { kata: k20 })[0].dates;
    expect(hibi.length).toBe(30);
    const hi = hibi.map((_, i) => (i + 1) * 100);
    const k = { name: 'て', year: 2026, month: 10, settings: {}, kinds: [], hibi: hibi };
    const html = H.kyuryoHi(k, { hito: [{ name: '山田', hi: hi, hiJikan: hi.map(() => 1) }] })
      .map((x) => x.el._html)
      .join('');
    expect(html).toContain('>9/21<span');
    expect(html).toContain('>20<span'); // 10/20 は その月の 日＝日にちだけ
    expect(html).not.toContain('>31<span'); // 10/31 は この期に 無い
    expect(html).toContain('前半（9/21 〜 10/5）');
    const kei = hi.reduce((a, b) => a + b, 0);
    expect(html).toContain(kei.toLocaleString());
  });
  it('毎日（期の 名前 空）：給料表の 期の 列は 出さず 合計は 消えない', () => {
    const k = { name: 'て', year: 2026, month: 10, settings: {}, kinds: [] };
    const html = H.kyuryoTsuki(k, {
      namae: [],
      hito: [{ name: '山田', kikan: [100, 200, 300], jikan: 3 }],
    })
      .map((x) => x.el._html)
      .join('');
    expect(html).not.toContain('1〜10日');
    expect(html).toContain('600');
  });
});
