'use strict';
// ============================================================
// ★★月次集計は 暦の 月で 切らない＝月 → 期間は KaishaKikan（js/payroll-period.js）の 1か所を 通す★★ 2026-10-24
//   （司さん「会社の締め日」・叩き役 K-6／K-7）
//
//   前：shukei.html の 23か所・js/kami-shukei.js の tsukiNo・js/getsuji-agg.js が
//       「'2026-10' で 始まる 日」「.slice(5, 7) === '10'」「getMonth() + 1」で 暦の 月を 切っていた
//       ＝20日締めの 会社で 10月（9/21〜10/20）に 10/21〜10/31 が 混ざり 9/21〜9/30 が 抜ける。
//   ここで 縛る：その 切り方の 字が 1つでも 戻ったら 赤（動きは tests/e2e/shukei-kaisha-shime.spec.js が 縛る）
//   ★わざと壊して 赤を 見た（2026-10-24）★ 売上の 表の 月ごと（renderUri）を 暦の 月（h.slice(5, 7) === 月）に 戻す ⇒ 赤 1／緑 15
//     直す 前の shukei.html・js（origin/main）⇒ この ファイルは 赤
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const yomu = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
// 注釈の 行は 見ない（「前は .slice(5, 7) で 切っていた」と 書けるように）
const kodo = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|<!--)/.test(l))
    .join('\n');

const SHUKEI = kodo(yomu('shukei.html'));
const SCRIPT = SHUKEI.slice(SHUKEI.indexOf("(function () {\n        'use strict';"));

// 暦の 月で 切る 字（比べる・鍵に する 形）
const KOYOMI = [
  [/\.slice\(5, 7\)\s*[!=]==/, '「.slice(5, 7) === 月」で 比べる'],
  [/[!=]==\s*\w+\.slice\(5, 7\)/, '「月 === .slice(5, 7)」で 比べる'],
  [/\[\s*\w+\.slice\(0, 7\)\s*\]/, '「[日.slice(0, 7)]」を 月の 鍵に する'],
  [/indexOf\(YEAR\s*\+\s*'-'\)/, '「YEAR + ' - ' で 始まる 日」で 年を 切る'],
  [/indexOf\(pre\)/, '「月の 頭の 字で 始まる 日」で 切る'],
  [/getU?T?C?Month\(\)\s*\+\s*1/, '「getMonth() + 1」で 今日の 月を 決める'],
  [/new Date\(YEAR, tsuki, 0\)/, '暦の 月の 日数で 日を 並べる'],
  [/monthDates\(/, '暦の 月の 日の 並び（PayrollPeriod.monthDates）'],
];

describe('★shukei.html は 暦の 月で 切らない★', () => {
  it('台本が 読めている（0字を 見て 緑に しない）', () => {
    expect(SCRIPT.length).toBeGreaterThan(50000);
    expect(SCRIPT).toContain('KaishaKikan.tsukiOf');
    expect(SCRIPT).toContain('KaishaKikan.kikan');
  });
  KOYOMI.forEach(([re, na]) => {
    it(na + ' が 無い', () => {
      const m = SCRIPT.match(re);
      expect(m ? m[0] : null, na).toBeNull();
    });
  });
  it('KaishaKikan（js/payroll-period.js）を getsuji-agg.js より 先に 読む', () => {
    const a = SHUKEI.indexOf('src="js/payroll-period.js"');
    const b = SHUKEI.indexOf('src="js/getsuji-agg.js"');
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(b);
  });
  // ★新しい js は 事務所の 中継の 名簿（別 repo）に 無いと 404＝月次集計が 開かない★（実配信の 見張り jimusho-haishin-todoku が 赤に した）
  it('会社の 締め日の 3画面が 読む js は 全部 事務所の 中継の 名簿（office-host/vercel.json）に 在る', () => {
    const meibo = yomu('office-host/vercel.json');
    const nai = [];
    ['shukei.html', 'uriage.html', 'dashboard.html'].forEach((g) => {
      (yomu(g).match(/src="(js\/[^"]+)"/g) || []).forEach((m) => {
        const u = m.replace(/^src="|"$/g, '');
        if (meibo.indexOf('"/' + u + '"') < 0) nai.push(g + ' → ' + u);
      });
    });
    expect(nai).toEqual([]);
  });
  it('読み始めの 日＝前の 年の 11月（会社 5日締め × 給料 25日締め の 前の 年の 11/26 に 届く・叩き役 K-4）', () => {
    expect(SCRIPT).toMatch(/var KARA = YEAR - 1 \+ '-11-01';/);
  });
  it('GetsujiAgg に 会社の 締め日と 読んだ 日の 幅を 渡す（読めない 締め日は dame の まま 渡す・叩き役 K-8）', () => {
    expect(SCRIPT).toMatch(/GetsujiAgg\.year\(\s*YEAR,\s*CTX_KYU,\s*pays,\s*KAISHA\.dame/);
  });
});

describe('★GetsujiAgg・紙は 暦の 月で 切らない★', () => {
  it('getsuji-agg.js は 月の 日を KaishaKikan.kikan から 取る', () => {
    const s = kodo(yomu('js/getsuji-agg.js'));
    expect(s).not.toMatch(/monthDates\(/);
    expect(s).toMatch(/KK\.kikan\(y, m, hi\)/);
  });
});

describe('★紙の 日の 並び・題の 期間の 字も 会社の 期間（KamiShukei.kaisha）★', () => {
  // 件J（2026-10-24）で 引く 物は 全部 hiku:true・日の 幅の 字は 無くなった＝ここは 期間の 並びと 字だけ
  const KS = require('../../js/kami-shukei.js');
  const KK = require('../../js/payroll-period.js').KaishaKikan;
  const kinds = [{ kind_id: 'toll', label: '高速代' }];
  it('20日締めの 10月（9/21〜10/20）＝紙の 日は 9/21 から 30日・題の 字', () => {
    const k = KS.kaisha('偽', 2026, 10, null, null, kinds, false, KK.kikan(2026, 10, 20));
    expect(k.kinds).toEqual([{ label: '高速代', hiku: true }]);
    expect(k.hibi.length).toBe(30);
    expect(k.hibi[0]).toBe('2026-09-21');
    expect(k.kikanJi).toBe('9/21 〜 10/20');
  });
  it('末日（暦の 月）は 今まで 通り＝日の 並びも 期間の 字も 付けない', () => {
    const k = KS.kaisha('偽', 2026, 10, null, null, kinds, false, KK.kikan(2026, 10, null));
    const k0 = KS.kaisha('偽', 2026, 10, null, null, kinds, false);
    expect(k).toEqual(k0);
    expect(k.hibi).toBeUndefined();
    expect(k.kikanJi).toBeUndefined();
  });
});
