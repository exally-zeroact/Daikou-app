// ============================================================
// 役割の 決まり（歩合・最低保証）の「何日から」（ctx.yakuRireki・settingsOn）2026-10-18
//   docs/nannichi-kara-yaku.md。司さん 10-17「その日より前は前の値」「1週間前の日付で設定したら遡って変わる」
//
//   守る 事：
//     ①記録が 無い 会社は 今と 1円も 違わない（記録 [] と 渡さない の 2通り）
//     ②記録の 日から 後だけ 新しい 値・前の 日は 列の 値
//     ③次の 記録の 日まで 効く
//     ④先の 日の 記録は 今日に 効かない
//     ⑤記録が 読めなかった（null・形が 違う）＝止める
//     ⑥本人の 画面（crew を 倉庫が 返す）でも 同じ 額
//     ⑦列に 無い 役割の 記録は 使わない（別の 役割の 額を 動かさない）
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
    yakuRireki: x.yakuRireki,
    crew: x.crew,
  };
}
const kiroku = (yaku, key, from_date, value) => ({ yaku, key, from_date, value });
function pay(c) {
  return HI.map((d) => {
    const r = P.computeDay(d, c);
    return r.staff[0] ? Math.round(r.staff[0].pay) : null;
  });
}

describe('役割の 決まりの 何日から', () => {
  const moto = pay(P.buildCtx(raw({})));
  it('① 記録が 無い 会社は 今と 同じ（[] と 渡さない）', () => {
    expect(moto.every((v) => v > 0)).toBe(true);
    expect(pay(P.buildCtx(raw({ yakuRireki: [] })))).toEqual(moto);
    expect(P.buildCtx(raw({ yakuRireki: [] })).yakuDame).toEqual([]);
    const c = P.buildCtx(raw({ yakuRireki: [] }));
    expect(P.settingsOn(c, HI[0])).toBe(c.settings);
  });
  it('② 記録の 日から 後だけ 新しい 歩合（前は 列の 値）', () => {
    const c = P.buildCtx(raw({ yakuRireki: [kiroku('2種', 'rate', '2026-09-11', 0.5)] }));
    const p = pay(c);
    expect(p[0]).toBe(moto[0]);
    expect(p[1]).toBeGreaterThan(moto[1]);
    expect(p[2]).toBe(p[1]);
    expect(c.yakuDame).toEqual([]);
    // 列は 書き換えない
    expect(c.settings.roles['2種'].rate).toBe(0.35);
  });
  it('③ 次の 記録の 日まで 効く', () => {
    const c = P.buildCtx(
      raw({
        yakuRireki: [
          kiroku('2種', 'rate', '2026-09-12', 0.35),
          kiroku('2種', 'rate', '2026-09-11', 0.5),
        ],
      })
    );
    const p = pay(c);
    expect(p[0]).toBe(moto[0]);
    expect(p[1]).toBeGreaterThan(moto[1]);
    expect(p[2]).toBe(moto[2]);
  });
  it('③-2 最低保証の 記録', () => {
    const c = P.buildCtx(raw({ yakuRireki: [kiroku('2種', 'floor', '2026-09-12', 99999)] }));
    const p = pay(c);
    expect(p[0]).toBe(moto[0]);
    expect(p[1]).toBe(moto[1]);
    expect(p[2]).toBeGreaterThanOrEqual(99999);
  });
  it('④ 先の 日の 記録は 今日に 効かない', () => {
    const c = P.buildCtx(raw({ yakuRireki: [kiroku('2種', 'rate', '2099-01-01', 0.9)] }));
    expect(pay(c)).toEqual(moto);
    expect(P.settingsOn(c, '2099-01-01').roles['2種'].rate).toBe(0.9);
    expect(P.settingsOn(c, '2098-12-31').roles['2種'].rate).toBe(0.35);
  });
  it('⑤ 記録が 読めなかった・形が 違う＝止める', () => {
    for (const bad of [
      null,
      {},
      [{ yaku: '2種', key: 'xx', from_date: '2026-09-11', value: 1 }],
      [{ key: 'rate', from_date: '2026-09-11', value: 1 }],
      [{ yaku: '2種', key: 'rate', from_date: '9/11', value: 1 }],
      [{ yaku: '2種', key: 'rate', from_date: '2026-09-11', value: null }],
      [{ yaku: '2種', key: 'rate', from_date: '2026-09-11', value: 'abc' }],
      [{ yaku: '2種', key: 'rate', from_date: '2026-09-11', value: '' }],
    ]) {
      const c = P.buildCtx(raw({ yakuRireki: bad }));
      expect(c.yakuDame.some((x) => x.wake === 'yakuRireki')).toBe(true);
      expect(c.yakuDameRiyuu).toContain('役割の 決まりの 変えた 記録を 読めませんでした');
    }
  });
  it('⑤-2 倉庫の numeric が 字で 来ても 数に 直す', () => {
    const a = pay(P.buildCtx(raw({ yakuRireki: [kiroku('2種', 'rate', '2026-09-11', 0.5)] })));
    const b = pay(P.buildCtx(raw({ yakuRireki: [kiroku('2種', 'rate', '2026-09-11', '0.5')] })));
    expect(b).toEqual(a);
  });
  it('⑥ 本人の 画面（crew あり）でも 同じ 額', () => {
    const r = [kiroku('2種', 'floor', '2026-09-11', 99999)];
    const jimu = pay(P.buildCtx(raw({ yakuRireki: r })));
    const crew = HI.map((d) => ({ work_date: d, device_id: 'd1', roles: ['2種'] }));
    const honnin = pay(P.buildCtx(raw({ yakuRireki: r, crew })));
    expect(honnin).toEqual(jimu);
    expect(jimu[1]).toBeGreaterThanOrEqual(99999);
  });
  it('⑦ 列に 無い 役割の 記録は 使わない・別の 役割の 額は 動かない', () => {
    const c = P.buildCtx(
      raw({
        yakuRireki: [
          kiroku('3種', 'rate', '2026-09-10', 0.9),
          kiroku('1種', 'rate', '2026-09-10', 0.9),
        ],
      })
    );
    expect(pay(c)).toEqual(moto);
    expect(P.settingsOn(c, HI[0]).roles['3種']).toBe(undefined);
    expect(c.settings.roles['1種'].rate).toBe(0.3);
    // ★決まりに 無い 役割の 記録が 残っている＝止める★（同じ 名前を 足すと 黙って 生き返る・対立役 2回目 止1）
    expect(c.yakuDame.filter((x) => x.wake === 'yakuNokori').map((x) => x.role)).toEqual(['3種']);
    expect(c.yakuDameRiyuu).toContain('「3種」');
    expect(c.yakuDameRiyuu).toContain('記録が 残っています');
  });
  it('⑦-2 決まりに 在る 役割の 記録だけ なら 止めない', () => {
    const c = P.buildCtx(raw({ yakuRireki: [kiroku('1種', 'rate', '2026-09-10', 0.9)] }));
    expect(c.yakuDame).toEqual([]);
  });
});

// ★製品の 呼び口が 役割の 記録を 渡す★（渡し忘れると 記録無し＝列の 値で 黙って 出る）
describe('呼び口と 読み', () => {
  const fs = require('fs');
  const path = require('path');
  const yomu = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
  it('設定を 渡す buildCtx は 全部 yakuRireki も 渡す', () => {
    let n = 0;
    for (const f of ['kyuryo.html', 'shukei.html']) {
      const s = yomu(f);
      expect(/var RAW = \{[\s\S]*?yakuRireki: \[\][\s\S]*?\};/.test(s), f + ' の RAW').toBe(true);
      const re = /PayrollDaily\.buildCtx\(([\s\S]*?)\);/g;
      let m;
      while ((m = re.exec(s))) {
        const a = m[1].trim();
        if (
          /^RAW\b|^toshiDake\(RAW\)|^Object\.assign\(\{\}, RAW, \{ yakuRireki: yakuRirekiNoIma\(\) \}\)$/.test(
            a
          )
        ) {
          n++;
          continue;
        }
        if (/payrollSettings/.test(a)) {
          n++;
          expect(/\byakuRireki:/.test(a), f + ' の buildCtx(' + a.slice(0, 40) + ')').toBe(true);
        }
      }
    }
    // 製品の 呼び口 4か所＋設定の 画面の 選んだ 日の 決まり（yakuNoHiAtai）1か所
    expect(n).toBe(5);
  });
  it('記録の 読みは limit が 1000 より 大きい・並びの 鍵・本人の 関数が 返す', () => {
    let n = 0;
    for (const f of ['kyuryo.html', 'shukei.html']) {
      const re = /'dk_yaku_rireki\?select=[^']*'/g;
      let m;
      while ((m = re.exec(yomu(f)))) {
        n++;
        const l = /[?&]limit=(\d+)/.exec(m[0]);
        expect(l && Number(l[1]) > 1000, f + ' の ' + m[0]).toBe(true);
      }
    }
    expect(n).toBe(3);
    expect(yomu('js/dk-session.js')).toMatch(/dk_yaku_rireki: 'from_date\.asc,rireki_id\.asc'/);
    expect(yomu('kyuryo.html')).toMatch(
      /RAW\.yakuRireki = Array\.isArray\(r\.yakuRireki\) \? r\.yakuRireki : null;/
    );
    expect(yomu('supabase/apply-kyuryo-honnin-kansuu.sql')).toMatch(/'yakuRireki', \(/);
  });
});

describe('名前の 形', () => {
  it('__proto__ と いう 役割の 名前でも 他を 汚さず、残った 記録として 止める', () => {
    const c = P.buildCtx(
      raw({ yakuRireki: [{ yaku: '__proto__', key: 'floor', from_date: '2026-09-11', value: 1 }] })
    );
    expect({}.floor).toBe(undefined);
    expect(c.yakuDame.some((x) => x.wake === 'yakuNokori')).toBe(true);
  });
});
