// ============================================================
// ★★料金表の 説明文は 入れた数字で 書く（決め打ちにしない）★★ 2026-09-03（司さん）
//
//   ★司さんの言葉★「説明の1000mまでの解釈が違うやろが メーターのコード確認しろ」
//
//   ★何が 間違っていたか（実測）★
//     画面の 説明 … 「例）最初 1,300円 で ★1,000m まで★、その先 420m ごとに 100円 ずつ 上がる。」
//     ⇒ この 1,300 / 1,000 / 420 / 100 は ★全部 決め打ちの 文字★でした。
//       司さんが ★999m★ と 入れても 画面は ★1,000m まで★ と 出る＝★嘘★
//
//   ★メーターの 本当の 決まり（js/fare-calc.js:71）★
//     `if (distanceM <= config.base_distance_m) fare = config.base_fare;`
//     ＝★入れた距離 ちょうども 基本料金★（≤ を 含む）。
//       999 なら ★999m ちょうどまで 1,300円／1,000m は 次の段★。
//     ⇒ 説明にも ★「ちょうども」を 書く★（ここが 司さんの 言う「解釈」）
//
//   ★決まりは 1本★ … 文を 組み立てるのは js/fare-calc.js の setsumeiBun（メーターも 事務所も 同じ）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-03 実測・下に 数を 書く）★★
// ============================================================
'use strict';

const path = require('path');
const fs = require('fs');
const FareCalc = require(path.join(__dirname, '..', '..', 'js', 'fare-calc.js'));

const cfg = (base_distance_m, base_fare, add_distance_m, add_fare, rounding) => ({
  base_distance_m,
  base_fare,
  add_distance_m,
  add_fare,
  rounding,
  tiers: [],
});

describe('★料金表の 説明文は 入れた数字で 書く★', () => {
  it('★① 入れた 距離が そのまま 出る（999 と 入れたら 999）★', () => {
    const s = FareCalc.setsumeiBun(cfg(999, 1300, 420, 100, 10));
    expect(s, '★入れた 距離が 出ていません★').toContain('999m');
    expect(s, '★決め打ちの 1,000m が 出ています★').not.toContain('1,000m');
  });

  it('★★② 「ちょうども」が 書いてある（メーターは ≤ で 判定している）★★', () => {
    const s = FareCalc.setsumeiBun(cfg(1000, 1300, 420, 100, 10));
    expect(s, '★ちょうどの時に どうなるかが 書いてありません★').toMatch(/ちょうど/);
  });

  it('★③ 入れた 金額・刻みも そのまま 出る★', () => {
    const s = FareCalc.setsumeiBun(cfg(999, 1500, 300, 120, 10));
    expect(s).toContain('1,500円');
    expect(s).toContain('300m');
    expect(s).toContain('120円');
  });

  it('★④ 説明の 中身が 実際の 計算と 合っている（ちょうどは 基本料金）★', () => {
    const c = cfg(999, 1300, 420, 100, 10);
    const now = new Date('2026-09-03T12:00:00+09:00');
    expect(FareCalc.keisan(999, c, null, [], 0, now), '★ちょうどが 基本料金では ない★').toBe(1300);
    expect(FareCalc.keisan(1000, c, null, [], 0, now), '★1m 超えて 上がっていない★').toBe(1400);
  });

  it('★⑤ 画面は 決め打ちの 文を 持っていない（同じ物を 2か所に 書かない）★', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'ryokinhyou.html'), 'utf8');
    expect(html, '★決め打ちの 説明文が 画面に 残っています★').not.toMatch(
      /例）最初 1,300円 で 1,000m まで/
    );
    expect(html, '★説明文を 組み立てる所を 呼んでいません★').toMatch(/setsumeiBun/);
  });
});
