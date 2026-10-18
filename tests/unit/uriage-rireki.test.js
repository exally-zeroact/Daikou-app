// ============================================================
// 売上から 引く 物（高速・橋・その他）の「何日から」（UriageAgg.rirekiKumu・settingsOnDay）2026-10-18
//   docs/nannichi-kara-uriage.md。司さん 10-17「その日より前は前の値」「1週間前の日付で設定したら遡って変わる」
//
//   守る 事：
//     ①記録が 無い 会社は 今と 1円も 違わない（記録 [] と 渡さない・売上表の 足し方も 今の 式）
//     ②記録の 日から 後だけ 新しい 引き方・前の 日は 列の 値
//     ③次の 記録の 日まで 効く
//     ④先の 日の 記録は 今日に 効かない
//     ⑤記録が 読めなかった（null・形が 違う）＝止める（給料）・throw（売上表）
//     ⑥本人の 画面（crew）でも 同じ 額
//     ⑦手で 入れた 日も その 日の 引き方
//     ⑧売上表（byDevice・byDay）と 給料の 実費が 同じ
// ============================================================
const U = require('../../js/uriage-agg.js');
const P = require('../../js/payroll-daily.js');

const ROLES = { '1種': { rate: 0.3, floor: 0 } };
const HI = ['2026-09-10', '2026-09-11', '2026-09-12'];
const SS = { deduct_toll: true, deduct_bridge: true, deduct_other: false };

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
    edits: HI.map((d, i) => ({
      shift_id: 's' + i,
      toll_yen: 1000,
      bridge_yen: 200,
      other_yen: 30,
    })),
    labels: [],
    manualDays: x.manualDays || [],
    employees: [{ employee_id: 'e1', name: '甲', role: '1種', pay_rate: null, pay_floor: null }],
    workHours: HI.map((d) => ({ work_date: d, employee_id: 'e1', device_id: 'd1', hours: 3 })),
    payrollSettings: { roles: ROLES, pay_extra: null },
    salesSettings: x.salesSettings === undefined ? SS : x.salesSettings,
    uriageRireki: x.uriageRireki,
    crew: x.crew,
  };
}
const kiroku = (key, from_date, value) => ({ key, from_date, value });
function jippi(c) {
  return HI.map((d) => (c.byDate[d] && c.byDate[d].d1 ? c.byDate[d].d1.expense : null));
}
function pay(c) {
  return HI.map((d) => {
    const r = P.computeDay(d, c);
    return r.staff[0] ? Math.round(r.staff[0].pay) : null;
  });
}

describe('売上から 引く 物の 何日から（給料）', () => {
  const moto = P.buildCtx(raw({}));
  it('① 記録が 無い 会社は 今と 同じ（[] と 渡さない）', () => {
    expect(jippi(moto)).toEqual([1200, 1200, 1200]);
    const c = P.buildCtx(raw({ uriageRireki: [] }));
    expect(jippi(c)).toEqual(jippi(moto));
    expect(pay(c)).toEqual(pay(moto));
    expect(c.yakuDame).toEqual([]);
  });
  it('② 記録の 日から 後だけ 新しい 引き方（前は 列の 値）', () => {
    const c = P.buildCtx(raw({ uriageRireki: [kiroku('other', '2026-09-11', true)] }));
    expect(jippi(c)).toEqual([1200, 1230, 1230]);
    expect(pay(c)[0]).toBe(pay(moto)[0]);
    expect(pay(c)[1]).toBeLessThan(pay(moto)[1]);
    expect(c.yakuDame).toEqual([]);
  });
  it('③ 次の 記録の 日まで 効く', () => {
    const c = P.buildCtx(
      raw({
        uriageRireki: [kiroku('toll', '2026-09-12', true), kiroku('toll', '2026-09-11', false)],
      })
    );
    expect(jippi(c)).toEqual([1200, 200, 1200]);
  });
  it('④ 先の 日の 記録は 今日に 効かない', () => {
    const c = P.buildCtx(raw({ uriageRireki: [kiroku('bridge', '2099-01-01', false)] }));
    expect(jippi(c)).toEqual(jippi(moto));
    expect(U.settingsOnDay(SS, c.uriageKumi, '2099-01-01').deduct_bridge).toBe(false);
    expect(U.settingsOnDay(SS, c.uriageKumi, '2098-12-31').deduct_bridge).toBe(true);
  });
  it('⑤ 記録が 読めなかった・形が 違う＝止める', () => {
    for (const bad of [
      null,
      {},
      [{ key: 'xx', from_date: '2026-09-11', value: true }],
      [{ key: 'toll', from_date: '9/11', value: true }],
      [{ key: 'toll', from_date: '2026-09-11', value: 'true' }],
      [{ key: 'toll', from_date: '2026-09-11', value: null }],
      [{ key: 'toll', from_date: '2026-09-11' }],
      [null],
    ]) {
      const c = P.buildCtx(raw({ uriageRireki: bad }));
      expect(c.yakuDame.some((x) => x.wake === 'uriageRireki')).toBe(true);
      expect(c.yakuDameRiyuu).toContain('売上から 引く 物の 変えた 記録を 読めませんでした');
      expect(() => U.rirekiKumu(bad)).toThrow();
    }
  });
  it('⑥ 本人の 画面（crew あり）でも 同じ 額', () => {
    const r = [kiroku('toll', '2026-09-11', false)];
    const jimu = pay(P.buildCtx(raw({ uriageRireki: r })));
    const crew = HI.map((d) => ({ work_date: d, device_id: 'd1', roles: ['1種'] }));
    const honnin = pay(P.buildCtx(raw({ uriageRireki: r, crew })));
    expect(honnin).toEqual(jimu);
    expect(jimu[1]).toBeGreaterThan(pay(moto)[1]);
  });
  it('⑦ 手で 入れた 日も その 日の 引き方', () => {
    const md = [
      {
        work_date: '2026-09-20',
        device_id: 'd2',
        sales_yen: 10000,
        toll_yen: 500,
        bridge_yen: 0,
        other_yen: 7,
        hours: 2,
      },
      {
        work_date: '2026-09-21',
        device_id: 'd2',
        sales_yen: 10000,
        toll_yen: 500,
        bridge_yen: 0,
        other_yen: 7,
        hours: 2,
      },
    ];
    const c = P.buildCtx(
      raw({ manualDays: md, uriageRireki: [kiroku('other', '2026-09-21', true)] })
    );
    expect(c.byDate['2026-09-20'].d2.expense).toBe(500);
    expect(c.byDate['2026-09-21'].d2.expense).toBe(507);
  });
});

describe('売上から 引く 物の 何日から（売上表）', () => {
  const r0 = raw({});
  it('① 記録が 無い＝今の 式（車の 合計に 1回）と 同じ', () => {
    const a = U.byDevice(r0.shifts, r0.edits, [], SS);
    const b = U.byDevice(r0.shifts, r0.edits, [], SS, U.rirekiKumu([]));
    expect(a[0].deduct_yen).toBe(3600);
    expect(b).toEqual(a);
    expect(a[0].deduct_hi).toBe(undefined);
  });
  it('⑧ 記録が 在る＝業務ごとに その 日の 引き方・給料の 実費と 同じ', () => {
    const rr = [kiroku('other', '2026-09-11', true), kiroku('toll', '2026-09-12', false)];
    const k = U.rirekiKumu(rr);
    const car = U.byDevice(r0.shifts, r0.edits, [], SS, k);
    const c = P.buildCtx(raw({ uriageRireki: rr }));
    const kyu = jippi(c).reduce((a, b) => a + b, 0);
    expect(car[0].deduct_yen).toBe(1200 + 1230 + 230);
    expect(car[0].deduct_yen).toBe(kyu);
    const days = U.byDay(r0.shifts, r0.edits, [], SS, k);
    expect(days.map((d) => d.deduct_yen)).toEqual(jippi(c));
    expect(car[0].net_fare_yen).toBe(90000 - kyu);
  });
  it('列が 無い 会社（既定）にも 記録が 重なる', () => {
    expect(
      U.settingsOnDay(null, U.rirekiKumu([kiroku('other', '2026-01-01', true)]), '2026-02-01')
    ).toEqual({
      deduct_toll: true,
      deduct_bridge: true,
      deduct_other: true,
    });
    expect(U.settingsOnDay(null, null, '2026-02-01')).toEqual(U.normSettings(null));
  });
});

describe('月次の 紙の「引く 物」', () => {
  const K = require('../../js/kami-shukei.js');
  const na = (k) => k.kinds.filter((x) => x.hiku).map((x) => x.label);
  it('記録が 無い＝今と 同じ', () => {
    expect(na(K.kaisha('', 2026, 9, null, SS, null, true))).toEqual(['高速代', '橋代']);
    expect(na(K.kaisha('', 2026, 9, null, SS, null, true, null))).toEqual(['高速代', '橋代']);
  });
  it('月の 中で 変わる 物は 日の 幅', () => {
    const k = U.rirekiKumu([
      kiroku('toll', '2026-09-15', false),
      kiroku('other', '2026-09-30', true),
      kiroku('bridge', '2026-08-01', false),
    ]);
    expect(na(K.kaisha('', 2026, 9, null, SS, null, true, k))).toEqual([
      '高速代（1〜14日）',
      'その他（30日）',
    ]);
    // 前の 月は 列の 値（橋は 8月から 引かない）
    expect(na(K.kaisha('', 2026, 7, null, SS, null, true, k))).toEqual(['高速代', '橋代']);
    expect(na(K.kaisha('', 2026, 10, null, SS, null, true, k))).toEqual(['その他']);
  });
  it('実費の 一覧を 渡しても 同じ 決まり・足した 物は いつも 引く', () => {
    const k = U.rirekiKumu([kiroku('toll', '2026-09-15', false)]);
    const kinds = [
      { kind_id: 'toll', label: '高速' },
      { kind_id: 'x1', label: '駐車場' },
    ];
    expect(na(K.kaisha('', 2026, 9, null, SS, kinds, true, k))).toEqual([
      '高速（1〜14日）',
      '駐車場',
    ]);
  });
});
