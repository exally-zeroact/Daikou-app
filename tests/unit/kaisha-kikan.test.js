'use strict';
// ============================================================
// ★★会社の 締め日（月 → 会社の 期間）★★ 2026-10-24（司さん「会社の締め日も決めれるようにしとかないかんな」）
//   KaishaKikan（js/payroll-period.js の 後ろ）の 決まり：
//     ・20日締めの 10月＝9/21〜10/20（締めた 月の 名前）
//     ・末日＝暦の 月（今まで 通り）
//     ・2020〜2030 の どの 日も ちょうど 1つの 月の 期間に 入る（2月・うるう年も 割れない）
//     ・読めない（列が 無い・値が おかしい）⇒ 末日に 倒さず dame（叩き役 K-8）
// ============================================================
const KK = require('../../js/payroll-period.js').KaishaKikan;

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

describe('★20日締め★', () => {
  it('10月＝9/21〜10/20（30日）', () => {
    const k = KK.kikan(2026, 10, 20);
    expect([k.start, k.end, k.label, k.rangeLabel]).toEqual([
      '2026-09-21',
      '2026-10-20',
      '10月',
      '9/21 〜 10/20',
    ]);
    expect(k.dates).toEqual(hibi('2026-09-21', '2026-10-20'));
  });
  it('1月＝前の 年の 12/21〜1/20', () => {
    const k = KK.kikan(2026, 1, 20);
    expect([k.start, k.end]).toEqual(['2025-12-21', '2026-01-20']);
  });
  it('日 → 月：10/20＝10月・10/21＝11月・12/21＝次の 年の 1月', () => {
    expect(KK.tsukiOf('2026-10-20', 20)).toEqual({ year: 2026, month: 10 });
    expect(KK.tsukiOf('2026-10-21', 20)).toEqual({ year: 2026, month: 11 });
    expect(KK.tsukiOf('2026-12-21', 20)).toEqual({ year: 2027, month: 1 });
  });
  it('★今日の 月★ 20日締めで 10/24 に 開いたら 11月', () => {
    const now = Date.parse('2026-10-24T12:00:00+09:00');
    expect(KK.kyou(20, now)).toEqual({ year: 2026, month: 11 });
    expect(KK.kyou(null, now)).toEqual({ year: 2026, month: 10 });
  });
  it('年の 幅＝前の 年の 12/21〜12/20', () => {
    expect(KK.nen(2026, 20)).toEqual({ start: '2025-12-21', end: '2026-12-20' });
  });
});

describe('★末日＝暦の 月（今まで 通り）★', () => {
  it('2020〜2030 の 全部の 月で 1日〜末日', () => {
    for (let y = 2020; y <= 2030; y++)
      for (let m = 1; m <= 12; m++) {
        const k = KK.kikan(y, m, null);
        const last = new Date(y, m, 0).getDate();
        const mm = String(m).padStart(2, '0');
        expect(k.dates).toEqual(hibi(y + '-' + mm + '-01', y + '-' + mm + '-' + last));
      }
  });
});

describe('★2月が 割れない・どの 日も ちょうど 1つの 期間（1〜28日・末日 × 2020〜2030）★', () => {
  const HI = [null];
  for (let h = 1; h <= 28; h++) HI.push(h);
  HI.forEach((hi) => {
    it('締め日 ' + KK.hiNoJi(hi), () => {
      const kai = {};
      const mondai = [];
      for (let y = 2020; y <= 2030; y++)
        for (let m = 1; m <= 12; m++) {
          const k = KK.kikan(y, m, hi);
          if (!k.dates.length) mondai.push(y + '-' + m + ' 空');
          if (k.dates[0] !== k.start || k.dates[k.dates.length - 1] !== k.end)
            mondai.push(y + '-' + m + ' 端');
          k.dates.forEach((d) => {
            kai[d] = (kai[d] || 0) + 1;
            const t = KK.tsukiOf(d, hi);
            if (t.year !== y || t.month !== m) mondai.push(d + ' の 月が 違う');
          });
        }
      const zure = hibi('2020-02-01', '2030-11-30').filter((d) => kai[d] !== 1);
      expect(mondai.slice(0, 5)).toEqual([]);
      expect(zure.slice(0, 5)).toEqual([]);
    });
  });
  it('28日締めの 3月（2月が 28日まで）＝3/1〜3/28・うるう年の 3月＝2/29〜3/28', () => {
    expect([KK.kikan(2026, 3, 28).start, KK.kikan(2026, 3, 28).end]).toEqual([
      '2026-03-01',
      '2026-03-28',
    ]);
    expect([KK.kikan(2024, 3, 28).start, KK.kikan(2024, 3, 28).end]).toEqual([
      '2024-02-29',
      '2024-03-28',
    ]);
  });
});

describe('★読めない 時は 末日に 倒さない（叩き役 K-8）★', () => {
  it('行が 無い（まだ 1度も 保存していない 会社）＝末日', () => {
    expect(KK.yomu(null)).toEqual({ ok: true, hi: null });
  });
  it('列が null＝末日・20＝20日', () => {
    expect(KK.yomu({ kaisha_shime_hi: null })).toEqual({ ok: true, hi: null });
    expect(KK.yomu({ kaisha_shime_hi: 20 })).toEqual({ ok: true, hi: 20 });
  });
  it('★行は 在るのに 列が 無い（読み足し忘れ・倉庫に 列が 無い）＝dame★', () => {
    expect(KK.yomu({ deduct_toll: true }).dame).toBe(true);
  });
  it('0・29・31・小数・字＝dame', () => {
    [0, 29, 31, 20.5, 'abc', -1, {}].forEach((v) =>
      expect(KK.yomu({ kaisha_shime_hi: v }).dame, String(v)).toBe(true)
    );
  });
});
