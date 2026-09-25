'use strict';
// ============================================================
// ★★紙の 型（A4）＝司さんが 決めた 事を 機械で 縛る★★ 2026-09-25
//
//   ★司さんの 言葉（この 試験が 守る 物）★
//     「月の列の余白を少なくして他に幅を与えろ」
//     「請求書の列がないやないか」
//     「回数とか距離とか…売上表とかに出せってゆうてなかろが／回数や距離はまた別項目で作れや」
//     「ユーザーごとに対応できるようにしとんか？」
//     「日付の横に曜日（月、火など）も入れて 日曜の列は背景を薄い赤にして」
//     「色は日曜だけでええ」
//     「そのままでやれや銀行やないんど」（＝金額は ★円のまま★・千円に しない）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-25 実測 ＝ 下に 書く）★★
//     ①給料の 区切りを 10日 固定に 戻す ………………… ★赤★
//     ②日曜の 印を 付けない ………………………………… ★赤★
//     ③土曜にも 色を 付ける ………………………………… ★赤★
//     ④先頭の 列の width:1% を 外す ……………………… ★赤★
// ============================================================

const K = require('../../js/kami-kumu.js');

describe('★①会社ごとに 変わる（焼き付け 0）★', () => {
  it('★給料の 区切りは 会社設定から 出す★', () => {
    // 10日ごと（司さん）… 1〜10 / 11〜20 / 21日〜末日
    expect(K.kikan(2026, 9, { period_start_day: 1, period_days: 10 })).toEqual([
      '1〜10日',
      '11〜20日',
      '21日〜末日',
    ]);
    // ★7日ごとの 会社★ … 31日の 月なら 5期
    expect(K.kikan(2026, 1, { period_start_day: 1, period_days: 7 }).length).toBe(5);
    // ★15日ごと★
    expect(K.kikan(2026, 2, { period_start_day: 1, period_days: 15 })).toEqual([
      '1〜15日',
      '16日〜末日',
    ]);
    // ★設定が 無い会社は 10日ごと（既定）★
    expect(K.kikan(2026, 9, null).length).toBe(3);
  });

  it('★月の 日数は 月ごとに 変わる（28/29/30/31）★', () => {
    expect(K.matsubi(2026, 1)).toBe(31);
    expect(K.matsubi(2026, 2)).toBe(28);
    expect(K.matsubi(2024, 2)).toBe(29); // うるう年
    expect(K.matsubi(2026, 9)).toBe(30);
  });
});

describe('★★②曜日と 日曜の 赤★★', () => {
  it('★曜日が 合っている★', () => {
    // 2026-09-01 は 火曜（実測で 確かめた 日）
    expect(K.YOUBI[K.youbi(2026, 9, 1)]).toBe('火');
    expect(K.YOUBI[K.youbi(2026, 9, 6)]).toBe('日');
    expect(K.YOUBI[K.youbi(2026, 1, 1)]).toBe('木');
  });

  it('★★日曜だけ 印が 付く（土曜には 付けない）★★', () => {
    expect(K.nichiyo(2026, 9, 6)).toBe(true); // 日
    expect(K.nichiyo(2026, 9, 5)).toBe(false); // ★土＝付けない★（司さん「色は日曜だけでええ」）
    expect(K.nichiyo(2026, 9, 7)).toBe(false); // 月
  });

  it('★見出しに 曜日が 出て 日曜だけ nichi が 付く★', () => {
    const nichi = K.thHi(2026, 9, 6);
    const doyo = K.thHi(2026, 9, 5);
    expect(nichi).toContain('class="nichi"');
    expect(nichi).toContain('日');
    expect(doyo, '★土曜に 色が 付いています★（司さん「日曜だけでええ」）').not.toContain('nichi');
    expect(doyo).toContain('土');
  });

  it('★升目も 日曜だけ 塗る★', () => {
    expect(K.tdHi(2026, 9, 6, '9.5')).toContain('class="nichi"');
    expect(K.tdHi(2026, 9, 5, '9.5')).not.toContain('nichi');
  });

  it('★★色は 日曜の 1色だけ（土曜の 決まりを 置かない）★★', () => {
    expect(K.CSS).toContain('.dk-kami .nichi{background:#fdeaea');
    expect(K.CSS, '★土曜の 色が 残っています★').not.toContain('doyo');
  });
});

describe('★★③金額は 円のまま（千円に しない）★★', () => {
  it('★10,400 は 10,400 と 出す★', () => {
    // 司さん「そのままでやれや銀行やないんど」＝千円（10.4）に しない
    expect(K.en(10400)).toBe('10,400');
    expect(K.en(1912800)).toBe('1,912,800');
  });

  it('★0 は 薄く／未入力は 横棒★', () => {
    expect(K.en(0)).toContain('class="z"');
    expect(K.en(0)).toContain('0');
    expect(K.en(null)).toContain('—');
    expect(K.en(undefined)).toContain('—');
  });

  it('★数でない物を 渡されても 落ちない★', () => {
    expect(() => K.en('abc')).not.toThrow();
    expect(K.en('abc')).toContain('0');
  });
});

describe('★④先頭の 列の 余白（司さん 2026-09-25）★', () => {
  it('★先頭の 列は 中身の分だけ（width:1%）★', () => {
    expect(
      K.CSS.indexOf('.dk-kami th:first-child,.dk-kami td:first-child{text-align:left;width:1%') >=
        0,
      '★先頭の 列を 狭くしていません★＝月の 列に 余白が 戻ります'
    ).toBe(true);
  });
});

describe('★⑤1枚に 入る 数（実測の 値を 動かさない）★', () => {
  it('★給料 日ごと＝1枚 9人まで★', () => {
    // 10人以上は 枚を 分ける（実測 12人で 横80px・20人で 569px はみ出した）
    expect(K.HITO_1MAI).toBe(9);
  });
  it('★車ごと＝7台以上は 2列★', () => {
    // 実測 12台で 縦234px はみ出した
    expect(K.KURUMA_2RETSU).toBe(7);
  });
});

describe('★⑥字を そのまま 入れない（混ぜ物よけ）★', () => {
  it('★会社名に 字を 混ぜられない★', () => {
    expect(K.esc('<script>x</script>')).toBe('&lt;script&gt;x&lt;/script&gt;');
    expect(K.esc('"A" & B')).toBe('&quot;A&quot; &amp; B');
  });
  it('★頭に 入れた 会社名も 逃がす★', () => {
    const h = K.atama({ name: '<b>ZERO</b>' }, '月次集計', '2026年 9月');
    expect(h).not.toContain('<b>ZERO</b>');
    expect(h).toContain('&lt;b&gt;ZERO&lt;/b&gt;');
  });
});
