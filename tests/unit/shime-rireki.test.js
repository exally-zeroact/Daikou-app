// ============================================================
// 締めの 形（明細の 期間の 払い方）の「何日から」（PayrollPeriod.rirekiKata・periodsOf）2026-10-19
//   docs/nannichi-kara-shime.md。司さん 10-17「その日より前は前の値」・10-19「短い期は元の期の月に揃える」
//
//   守る 事：
//     ①記録が 無い 会社は 今と 1日も 違わない（undefined と []）
//     ②1つの 形から 切られずに 出来た 月は その 形の 期と 一字一句 同じ（名前・index・kind）
//     ③変えた 日の 前日で 切れる・前の 形の 側は 元の 期の 月の 分・新しい 形の 側は 切った 後の 日付
//     ④どの 日も ちょうど 1つの 期・1つの 月（乱数の 歴 600通り）
//     ⑤隣と 同じ 形は まとめる（期を 切らない）
//     ⑥読めない・形が 違う＝止める（dame）
//     ⑦給料（normSettings・buildCtx）と 月次（getsuji の 年の 期ごと）に 通る
//     ⑧画面の 呼び口が 全部 記録を 渡す
// ============================================================
const fs = require('fs');
const path = require('path');
const P = require('../../js/payroll-period.js');
const D = require('../../js/payroll-daily.js');
const G = require('../../js/getsuji-agg.js');

const KATA = [
  { kind: 'tsuki', hi: [10, 20, 0] }, // 月3回
  { kind: 'tsuki', hi: [15, 0] },
  { kind: 'tsuki', hi: [0] },
  { kind: 'tsuki', hi: [20], nazuke: 'shime' },
  { kind: 'tsuki', hi: [20], nazuke: 'hajime' },
  { kind: 'tsuki', hi: [5, 25], nazuke: 'shime' },
  { kind: 'shuu', youbi: 0, nazuke: 'shime' },
  { kind: 'shuu', youbi: 3, nazuke: 'hajime' },
  { kind: 'hi' },
  { kind: 'tsuki', hi: [1], nazuke: 'shime' },
  { kind: 'tsuki', hi: [30], nazuke: 'hajime' },
];
const k = (v) => P.seiki(v).kata;
const tsuki = [];
for (let i = 0; i < 24; i++) tsuki.push({ y: 2026 + Math.floor(i / 12), m: (i % 12) + 1 });
const kugiri = (ps) => ps.map((p) => p.start + '〜' + p.end + (p.kiri ? '*' : ''));

describe('締めの 何日から', () => {
  it('① 記録が 無い 会社は 今と 同じ（undefined と []）', () => {
    KATA.forEach((v) => {
      const kt = k(v);
      expect(P.rirekiKata(kt, undefined)).toBe(kt);
      expect(P.rirekiKata(kt, [])).toBe(kt);
      tsuki.forEach(({ y, m }) => {
        expect(P.periodsOf(y, m, { kata: P.rirekiKata(kt, []) })).toEqual(
          P.periodsOf(y, m, { kata: kt })
        );
      });
    });
  });

  it('② 切られて いない 月は その 形の 期と 一字一句 同じ', () => {
    KATA.forEach((a) => {
      KATA.forEach((b) => {
        const ka = k(a);
        const kb = k(b);
        if (JSON.stringify(ka) === JSON.stringify(kb)) return;
        const kt = P.rirekiKata(ka, [{ from_date: '2026-10-15', value: b }]);
        expect(kt.kind).toBe('rireki');
        // 前の 形だけの 月（7月）と 新しい 形だけの 月（2027年1月）
        expect(P.periodsOf(2026, 7, { kata: kt })).toEqual(P.periodsOf(2026, 7, { kata: ka }));
        expect(P.periodsOf(2027, 1, { kata: kt })).toEqual(P.periodsOf(2027, 1, { kata: kb }));
        expect(P.tsukiNoKata(kt, 2026, 7)).toEqual(ka);
        expect(P.tsukiNoKata(kt, 2027, 1)).toEqual(kb);
      });
    });
    // 月3回は 今の 道（THIRDS の 名前・kind 無し）の まま
    const kt = P.rirekiKata(k(KATA[2]), [{ from_date: '2026-11-01', value: KATA[0] }]);
    const ps = P.periodsOf(2026, 12, { kata: kt });
    expect(ps.map((p) => p.name)).toEqual(['1〜10日', '11〜20日', '21日〜末日']);
    expect(ps[0].kind).toBe(undefined);
  });

  it('③ 変えた 日の 前日で 切れる・前の 形の 側は 元の 期の 月・新しい 形の 側は 切った 日付（司さん 10-19）', () => {
    // 20日締め（締めた 日の 月の 分）→ 10/1 から 末日締め
    const kt = P.rirekiKata(k(KATA[3]), [{ from_date: '2026-10-01', value: KATA[2] }]);
    expect(kugiri(P.periodsOf(2026, 9, { kata: kt }))).toEqual(['2026-08-21〜2026-09-20']);
    expect(kugiri(P.periodsOf(2026, 10, { kata: kt }))).toEqual([
      '2026-09-21〜2026-09-30*', // ★元の 9/21〜10/20 は 10月分＝切っても 10月分★
      '2026-10-01〜2026-10-31',
    ]);
    expect(P.tsukiNoKata(kt, 2026, 10)).toBe(null);
    // 年を またぐ：2027-01-01 から＝12/21〜12/31 は 元の 期（〜1/20）の 2027年1月分
    const kn = P.rirekiKata(k(KATA[3]), [{ from_date: '2027-01-01', value: KATA[2] }]);
    expect(kugiri(P.periodsOf(2026, 12, { kata: kn }))).toEqual(['2026-11-21〜2026-12-20']);
    expect(kugiri(P.periodsOf(2027, 1, { kata: kn }))).toEqual([
      '2026-12-21〜2026-12-31*',
      '2027-01-01〜2027-01-31',
    ]);
    // 始まった 日の 月の 分：元の 9/21〜10/20 は 9月分
    const kh = P.rirekiKata(k(KATA[4]), [{ from_date: '2026-10-01', value: KATA[2] }]);
    expect(kugiri(P.periodsOf(2026, 9, { kata: kh }))).toEqual(['2026-09-21〜2026-09-30*']);
    expect(kugiri(P.periodsOf(2026, 10, { kata: kh }))).toEqual(['2026-10-01〜2026-10-31']);
    // ★新しい 形の 側は 切った 後の 日付で★（司さん 10-19 2回目）：末日締め → 10/15 から 20日締め・始まった 日の 月の 分
    //   10/15〜10/20 は 新しい 形の 9/21〜10/20（9月分）の 一部だが、払い終えた 9月分に 入れず 10月分
    const kb = P.rirekiKata(k(KATA[2]), [{ from_date: '2026-10-15', value: KATA[4] }]);
    expect(kugiri(P.periodsOf(2026, 9, { kata: kb }))).toEqual(['2026-09-01〜2026-09-30']);
    expect(kugiri(P.periodsOf(2026, 10, { kata: kb }))).toEqual([
      '2026-10-01〜2026-10-14*',
      '2026-10-15〜2026-10-20*',
      '2026-10-21〜2026-11-20',
    ]);
    // ★前の 側の 月より 前に しない★（司さん 10-19 3回目）：20日締め → 9/25 から 末日締め
    const kc = P.rirekiKata(k(KATA[3]), [{ from_date: '2026-09-25', value: KATA[2] }]);
    expect(kugiri(P.periodsOf(2026, 9, { kata: kc }))).toEqual(['2026-08-21〜2026-09-20']);
    expect(kugiri(P.periodsOf(2026, 10, { kata: kc }))).toEqual([
      '2026-09-21〜2026-09-24*',
      '2026-09-25〜2026-09-30*',
      '2026-10-01〜2026-10-31',
    ]);
    // 月3回 → 10/15 から 末日締め
    const k3 = P.rirekiKata({ kind: 'thirds' }, [{ from_date: '2026-10-15', value: KATA[2] }]);
    expect(kugiri(P.periodsOf(2026, 10, { kata: k3 }))).toEqual([
      '2026-10-01〜2026-10-10',
      '2026-10-11〜2026-10-14*',
      '2026-10-15〜2026-10-31*',
    ]);
    // 両方の 形で 区切りの 日なら 短い 期は 出ない（月3回 → 11/1 から 末日）
    const k4 = P.rirekiKata({ kind: 'thirds' }, [{ from_date: '2026-11-01', value: KATA[2] }]);
    expect(kugiri(P.periodsOf(2026, 11, { kata: k4 }))).toEqual(['2026-11-01〜2026-11-30']);
    // 片方だけの 区切り（20日締め → 10/21 から 末日）＝新しい 形の 側が 短い
    const k5 = P.rirekiKata(k(KATA[3]), [{ from_date: '2026-10-21', value: KATA[2] }]);
    expect(kugiri(P.periodsOf(2026, 10, { kata: k5 }))).toEqual([
      '2026-09-21〜2026-10-20',
      '2026-10-21〜2026-10-31*',
    ]);
  });

  it('④ どの 日も ちょうど 1つの 期・1つの 月（乱数の 歴 600通り）', () => {
    let seed = 12345;
    const rnd = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const pad = (x) => String(x).padStart(2, '0');
    const zure = [];
    let nichi = 0;
    for (let t = 0; t < 600; t++) {
      const rows = [];
      const used = {};
      const nRec = 1 + rnd(4);
      for (let i = 0; i < nRec; i++) {
        const y = 2026 + rnd(2);
        const m = 1 + rnd(12);
        const d = 1 + rnd(31);
        if (d > new Date(y, m, 0).getDate()) continue;
        const hi = y + '-' + pad(m) + '-' + pad(d);
        if (used[hi]) continue;
        used[hi] = 1;
        rows.push({ from_date: hi, value: KATA[rnd(KATA.length)] });
      }
      const kt = P.rirekiKata(k(KATA[rnd(KATA.length)]), rows);
      expect(kt.dame).toBeFalsy();
      const kazu = {};
      const tsukiNo = {};
      let maeTsuki = 0;
      for (let i = -2; i < 28; i++) {
        const y = 2026 + Math.floor((i + 12) / 12) - 1;
        const m = (((i % 12) + 12) % 12) + 1;
        const ps = P.periodsOf(y, m, { kata: kt });
        // ★月の 中で 期の 名前が 重ならない★（紙の 列の 見出し・対立役 4回目 直1）
        const na = ps.map((p) => p.name);
        if (new Set(na).size !== na.length) zure.push([t, y, m, 'namae', na.join(',')]);
        ps.forEach((p, j) => {
          if (p.dame) zure.push([t, y, m, 'dame']);
          // 月の 中の 期は 日付順で 重ならない
          if (j > 0 && !(p.start > ps[j - 1].end)) zure.push([t, y, m, 'kasanari', p.start]);
          // ★どの 期も 始まりの 日の 月より 前の 月の 分に しない★（払い終えた 月に 後から 日を 入れない・司さん 10-19 2回目）
          if (p.start.slice(0, 7) > y + '-' + pad(m)) zure.push([t, y, m, 'mae-no-tsuki', p.start]);
          p.dates.forEach((d) => (kazu[d] = (kazu[d] || 0) + 1));
          p.dates.forEach((d) => (tsukiNo[d] = y * 12 + m));
        });
      }
      // 2026-02-01〜2027-12-31 の どの 日も ちょうど 1回
      for (let x = new Date(2026, 1, 1); x <= new Date(2027, 11, 31); x.setDate(x.getDate() + 1)) {
        const s = x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
        nichi++;
        if (kazu[s] !== 1) zure.push([t, s, kazu[s] || 0]);
        // ★後の 日が 前の 日より 前の 月の 分に ならない★（司さん 10-19 3回目・対立役 3回目 止1）
        if (maeTsuki && tsukiNo[s] < maeTsuki) zure.push([t, s, 'gyaku']);
        maeTsuki = tsukiNo[s];
      }
    }
    // ★食い違いは 集めて 1回で 比べる★（日ごとに expect を 呼ぶと 14万回＝重くて 時間切れ・2026-10-19）
    expect(zure.slice(0, 5)).toEqual([]);
    expect(nichi).toBe(600 * 699);
  }, 20000); // ★重い 試験（600通り×699日）＝並べて 回すと 5秒を 越える★

  it('⑤ 隣と 同じ 形は まとめる（期を 切らない）', () => {
    const kt = P.rirekiKata(k(KATA[2]), [
      { from_date: '2026-10-15', value: { kind: 'tsuki', hi: [31] } }, // 31日＝末日＝同じ 形
    ]);
    expect(kt).toEqual(k(KATA[2]));
    const k2 = P.rirekiKata(k(KATA[2]), [
      { from_date: '2026-10-15', value: KATA[1] },
      { from_date: '2026-12-01', value: { kind: 'tsuki', hi: [0, 15] } }, // 並びが 違っても 同じ 形
    ]);
    expect(k2.segs.length).toBe(2);
  });

  it('⑥ 読めない・形が 違う＝止める', () => {
    const b = k(KATA[2]);
    const n = P.rirekiKata(b, null);
    expect(n.dame).toBe(true);
    expect(n.tsushin).toBe(true);
    expect(P.rirekiKata(b, { a: 1 }).dame).toBe(true);
    expect(P.rirekiKata(b, [{ from_date: '2026-02-30', value: KATA[0] }]).dame).toBe(true);
    expect(P.rirekiKata(b, [{ from_date: 20261001, value: KATA[0] }]).dame).toBe(true);
    expect(
      P.rirekiKata(b, [{ from_date: '2026-10-01', value: { kind: 'tsuki', hi: 'x' } }]).dame
    ).toBe(true);
    expect(
      P.rirekiKata(b, [{ from_date: '2026-10-01', value: { kind: 'tsuki', hi: [20] } }]).dame
    ).toBe(true); // 何月分が 無い
    expect(
      P.rirekiKata(b, [
        { from_date: '2026-10-01', value: KATA[0] },
        { from_date: '2026-10-01', value: KATA[1] },
      ]).dame
    ).toBe(true);
    // 列が 壊れて いれば 記録が 在っても 止める
    const z = { dame: true, riyuu: 'x' };
    expect(P.rirekiKata(z, [{ from_date: '2026-10-01', value: KATA[0] }])).toBe(z);
  });

  it('⑦ 給料（normSettings・buildCtx）と 月次 に 通る', () => {
    const row = { period_shime: KATA[3], period_end_mode: 'shime' };
    const rows = [{ from_date: '2026-10-01', value: KATA[2] }];
    expect(D.normSettings(row).periodKata).toEqual(k(KATA[3]));
    expect(D.normSettings(row, rows).periodKata.kind).toBe('rireki');
    expect(D.normSettings(row, null).periodKata.dame).toBe(true);
    const ctx = D.buildCtx({ payrollSettings: row, shimeRireki: rows });
    expect(ctx.settings.periodKata.kind).toBe('rireki');
    const mo = G.month(2026, 10, ctx, []);
    expect(mo.dame).toBeFalsy();
    expect(mo.kind).toBe('rireki');
    expect(mo.periods.map((p) => p.start + '〜' + p.end)).toEqual([
      '2026-09-21〜2026-09-30',
      '2026-10-01〜2026-10-31',
    ]);
    // 年の 期ごとの 合計：形が 変わった 年は 出さない／変わらない 年は 今の 通り
    const yr = G.year(2026, ctx, []);
    expect(yr.total.periods).toEqual([]);
    const ctx0 = D.buildCtx({ payrollSettings: { period_end_mode: 'thirds' }, shimeRireki: [] });
    expect(G.year(2026, ctx0, []).total.periods.length).toBe(3);
    // 20日締め と 25日締め（どちらも tsuki）を 同じ 列に 足さない（対立役 直2）
    const c25 = D.buildCtx({
      payrollSettings: row,
      shimeRireki: [
        { from_date: '2026-07-21', value: { kind: 'tsuki', hi: [25], nazuke: 'shime' } },
      ],
    });
    expect(G.year(2026, c25, []).total.periods).toEqual([]);
    // 読めない 記録＝月次も 止める
    const cz = D.buildCtx({ payrollSettings: row, shimeRireki: null });
    expect(G.month(2026, 10, cz, []).dame).toBe(true);
  });

  it('⑧ 画面の 呼び口が 全部 記録を 渡す（呼び忘れると 黙って 列の 形で 区切る・対立役 止2）', () => {
    const ky = fs.readFileSync(path.join(__dirname, '../../kyuryo.html'), 'utf8');
    const sk = fs.readFileSync(path.join(__dirname, '../../shukei.html'), 'utf8');
    const ns = ky.match(/normSettings\([^)]*\)/g);
    expect(ns.length).toBeGreaterThanOrEqual(14);
    ns.forEach((c) => expect(c).toBe('normSettings(SET, RAW.shimeRireki)'));
    // 給料・紙・月次の buildCtx は RAW ごと か shimeRireki を 名指し
    const bc = ky.split('PayrollDaily.buildCtx(').slice(1);
    const kyuNoBc = bc.filter((t) => /shifts:|Object\.assign\(\{\}, RAW/.test(t.slice(0, 600)));
    expect(kyuNoBc.length).toBe(2);
    kyuNoBc.forEach((t) =>
      expect(/shimeRireki: RAW\.shimeRireki|Object\.assign\(\{\}, RAW/.test(t.slice(0, 900))).toBe(
        true
      )
    );
    expect(sk).toContain('PayrollDaily.buildCtx(RAW)');
    // 両方の 画面が 記録を 読み、読めない 時は null（止める）
    [ky, sk].forEach((s) => {
      expect(s).toContain(
        "kaishaDake('dk_shime_rireki?select=*&order=from_date.asc&limit=100000')"
      );
      expect(s).toMatch(/RAW\.shimeRireki = SHIME_RIREKI_YOMI\.failed > 0 \? null :/);
    });
    // 本人：関数が 返さない＝止める
    expect(ky).toContain('if (!Array.isArray(r.shimeRireki)) {');
  });
});
