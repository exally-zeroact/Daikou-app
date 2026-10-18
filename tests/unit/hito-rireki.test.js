// ============================================================
// 人ごとの 歩合・最低保証・役割の「何日から」（ctx.rireki・empOn）2026-10-18
//   docs/nannichi-kara-hito.md。司さん 10-17「その日より前は前の値」「1週間前の日付で設定したら遡って変わる」
//
//   守る 事：
//     ①記録が 無い 人は 今と 1円も 違わない（記録 [] と 渡さない の 2通り）
//     ②記録の 日から 後だけ 新しい 値・前の 日は 列の 値
//     ③次の 記録の 日まで 効く（間に 挟まった 期間）
//     ④value null＝空（歩合・保証は 役割どおりに 戻る）
//     ⑤役割の 記録で 決まりに 無い 役割に なった 日は 止める（その前の 日は 止めない）
//     ⑥記録が 読めなかった（null・形が 違う）＝止める
//     ⑦本人の 画面（crew を 倉庫が 返す）でも 同じ 額
// ============================================================
const P = require('../../js/payroll-daily.js');

const ROLES = { '1種': { rate: 0.3, floor: 1000 }, '2種': { rate: 0.35, floor: 1150 } };
const HI = ['2026-09-10', '2026-09-11', '2026-09-12'];

function raw(o) {
  const x = o || {};
  return {
    shifts: HI.map((d, i) => ({
      shift_id: 's' + i,
      device_id: 'd1',
      started_at: d + 'T20:00:00+09:00',
      elapsed_sec: 3 * 3600,
      fare_total_yen: 30000,
    })),
    edits: [],
    labels: [],
    manualDays: [],
    employees: [{ employee_id: 'e1', name: '甲', role: '2種', pay_rate: null, pay_floor: null }],
    workHours: HI.map((d) => ({ work_date: d, employee_id: 'e1', device_id: 'd1', hours: 3 })),
    payrollSettings: { roles: ROLES, pay_extra: null },
    rireki: x.rireki,
    crew: x.crew,
  };
}
const kiroku = (key, from_date, value) => ({ employee_id: 'e1', key, from_date, value });
function pay(c) {
  return HI.map((d) => {
    const r = P.computeDay(d, c);
    return r.staff[0] ? Math.round(r.staff[0].pay) : null;
  });
}

describe('人の 何日から', () => {
  const moto = pay(P.buildCtx(raw({})));
  it('① 記録が 無い 人は 今と 同じ（[] と 渡さない）', () => {
    expect(moto.every((v) => v > 0)).toBe(true);
    expect(pay(P.buildCtx(raw({ rireki: [] })))).toEqual(moto);
    expect(P.buildCtx(raw({ rireki: [] })).yakuDame).toEqual([]);
  });
  it('② 記録の 日から 後だけ 新しい 歩合（前は 列の 値）', () => {
    const c = P.buildCtx(raw({ rireki: [kiroku('pay_rate', '2026-09-11', 0.5)] }));
    const p = pay(c);
    expect(p[0]).toBe(moto[0]);
    expect(p[1]).toBeGreaterThan(moto[1]);
    expect(p[2]).toBe(p[1]);
    expect(c.yakuDame).toEqual([]);
  });
  it('③ 次の 記録の 日まで 効く', () => {
    const c = P.buildCtx(
      raw({
        rireki: [kiroku('pay_rate', '2026-09-12', null), kiroku('pay_rate', '2026-09-11', 0.5)],
      })
    );
    const p = pay(c);
    expect(p[0]).toBe(moto[0]);
    expect(p[1]).toBeGreaterThan(moto[1]);
    expect(p[2]).toBe(moto[2]); // ④ null＝役割どおりに 戻る
  });
  it('⑤ 役割の 記録で 決まりに 無い 役割に なった 日から 止める', () => {
    const c = P.buildCtx(raw({ rireki: [kiroku('role', '2026-09-12', '3種')] }));
    expect(c.yakuDame.map((x) => x.date)).toEqual(['2026-09-12']);
    expect(c.yakuDameRiyuu).toContain('3種');
  });
  it('⑤-2 役割の 記録で 別の 役割の 決まりの 額', () => {
    const c = P.buildCtx(raw({ rireki: [kiroku('role', '2026-09-11', '1種')] }));
    const p = pay(c);
    expect(p[0]).toBe(moto[0]);
    expect(p[1]).not.toBe(moto[1]);
    expect(c.yakuDame).toEqual([]);
  });
  it('⑥ 記録が 読めなかった・形が 違う＝止める', () => {
    for (const bad of [
      null,
      {},
      [{ employee_id: 'e1', key: 'xx', from_date: '2026-09-11' }],
      [{ key: 'role' }],
      // 値の 形が 違う（歩合に 字・役割に 数）＝止める（10-18 対立役：黙って 役割どおりに 倒れていた）
      [{ employee_id: 'e1', key: 'pay_rate', from_date: '2026-09-11', value: 'abc' }],
      [{ employee_id: 'e1', key: 'role', from_date: '2026-09-11', value: 3 }],
    ]) {
      const c = P.buildCtx(raw({ rireki: bad }));
      expect(c.yakuDame.some((x) => x.wake === 'rireki')).toBe(true);
      expect(c.yakuDameRiyuu).toContain('変えた 記録を 読めませんでした');
    }
  });
  it('⑦ 本人の 画面（crew あり）でも 同じ 額', () => {
    const r = [kiroku('pay_floor', '2026-09-11', 99999)];
    const jimu = pay(P.buildCtx(raw({ rireki: r })));
    const crew = HI.map((d) => ({ work_date: d, device_id: 'd1', roles: ['2種'] }));
    const honnin = pay(P.buildCtx(raw({ rireki: r, crew })));
    expect(honnin).toEqual(jimu);
    expect(jimu[1]).toBeGreaterThanOrEqual(99999);
  });
  it('⑧ empOn は 記録の 無い 人に 同じ 物を 返す・先の 日の 記録は 今日に 効かない', () => {
    const c = P.buildCtx(raw({ rireki: [kiroku('pay_rate', '2099-01-01', 0.9)] }));
    expect(P.empOn(c, 'e1', '2026-09-12').pay_rate).toBe(null);
    expect(P.empOn(c, 'e1', '2099-01-01').pay_rate).toBe(0.9);
    expect(pay(c)).toEqual(moto);
  });
});

// ★製品の buildCtx の 呼び口が 全部 記録を 渡す★（渡し忘れると 記録無し＝列の 値で 黙って 出る・10-18 対立役 D1）
describe('呼び口', () => {
  const fs = require('fs');
  const path = require('path');
  const yomu = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
  it('kyuryo・shukei の buildCtx は 全部 rireki を 持つ 物を 渡す', () => {
    let n = 0;
    for (const f of ['kyuryo.html', 'shukei.html']) {
      const s = yomu(f);
      // RAW を 渡す 所は RAW に rireki が 在る事・物を 並べて 渡す 所は その 中に rireki: が 在る事
      expect(
        /var RAW = \{[\s\S]*?rireki: \[\][\s\S]*?\};/.test(s),
        f + ' の RAW に rireki が 無い'
      ).toBe(true);
      const re = /PayrollDaily\.buildCtx\(([\s\S]*?)\);/g;
      let m;
      while ((m = re.exec(s))) {
        const a = m[1].trim();
        // 人を 渡さない 呼び口（役割の 決まりの 日の 値だけ 引く・10-18）は 人の 記録が 要らない
        if (/^\{ payrollSettings: SET, yakuRireki: mine \}$/.test(a)) continue;
        n++;
        const ok =
          /^RAW\b|^toshiDake\(RAW\)|^Object\.assign\(\{\}, RAW,/.test(a) ||
          (/^\{/.test(a) && /\brireki:/.test(a));
        expect(ok, f + ' の buildCtx(' + a.slice(0, 40) + ') が 記録を 渡していない').toBe(true);
      }
    }
    // 製品の 呼び口は 4か所＋画面の その 日の 人（hiNoHito）1か所
    expect(n).toBe(5);
  });
});

// ★記録の 読みは 1000行で 切れない★（limit が 無いと softList は 1回しか 頼まない＝新しい 記録が 落ちる・10-18 対立役 N1）
describe('記録の 読みの 全部', () => {
  const fs = require('fs');
  const path = require('path');
  const yomu = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
  it('kyuryo・shukei の 記録の 読みは 全部 limit が 1000 より 大きい・並びの 鍵が 在る', () => {
    let n = 0;
    for (const f of ['kyuryo.html', 'shukei.html']) {
      const re = /'dk_hito_rireki\?select=[^']*'/g;
      let m;
      while ((m = re.exec(yomu(f)))) {
        n++;
        const l = /[?&]limit=(\d+)/.exec(m[0]);
        expect(l && Number(l[1]) > 1000, f + ' の ' + m[0] + ' は 1000行で 切れる').toBe(true);
      }
    }
    expect(n).toBe(3);
    expect(yomu('js/dk-session.js')).toMatch(/dk_hito_rireki: 'from_date\.asc,rireki_id\.asc'/);
  });
});
