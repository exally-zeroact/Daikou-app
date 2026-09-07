// ============================================================
// ★★赤（最低保証で 出した日）は「丸めた 後」で 決める★★ 2026-09-06
//
//   ★司さん★「丸め込み含め 最低時給に なった時は 赤って いうたろが」
//
//   ★何が 悪かったか（実測 2026-09-06）★
//     判定 … `usedFloor = byFloor >= byRate` ＝★丸める 前の 生の 数★で 比べていた
//     出す … 画面も 紙も `Math.round`（1円まで）
//     ⇒ 例）歩合 9000.4円 ／ 最低保証 9000.0円
//        生 … 歩合が 勝ち ＝ ★黒★
//        出る額 … どちらも ★9,000円★
//        ⇒★★払った 額は 最低保証と 同じ なのに 赤に ならない★★
//     ⇒★見た 通りに なっていなかった★
//
//   ★直し★ ★出す 額（丸めた 後）で 比べる★
//     ★払う 額（pay）は 1円も 変えていません★（Math.max のまま）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-06 実測）★★
//     ①丸める 前で 比べる（元に 戻す）… ★赤★
// ============================================================
'use strict';

global.window = global;
require('../../js/daiko-payroll.js');
const D = global.DaikoPayroll;

// ★1日ぶんを 計算させる 小さい 台★
//   ★実物の DaikoPayroll.compute を そのまま 呼びます★（写しを 作らない）
//   売上と 時数から 時給が 出て、歩合 と 最低保証 の 高い方が 払う額。
function hakaru(uriage, hito) {
  return D.compute(
    {
      owner: { sales: 0, expense: 0, hours: 0 },
      cars: [{ id: 'c1', sales: uriage, expense: 0, hours: hito[0].hours }],
      staff: hito,
    },
    {
      poolMode: 'others_total',
      deductReserveBeforeRate: false,
      reservePoolRate: 0,
      reserveOwnerRate: 0,
      roles: { '1種': { rate: 0.3, floor: 1000 }, '2種': { rate: 0.35, floor: 1150 } },
    }
  );
}

describe('★赤は 丸めた 後で 決める★', () => {
  it('★① 出る額が どちらも 同じ なら 赤★（丸めで 並んだ時）', () => {
    // ★歩合が ほんの わずかに 高いが、1円に 丸めると 同じ★
    //   時給 h ／ 歩合 rate 0.3 ／ 時数 hours ／ 最低保証 1000
    //   byFloor = 1000 * hours ／ byRate = h * 0.3 * hours
    //   ⇒ h*0.3 を 1000 より ★ほんの少し 上★に すると 丸めて 同じに なる
    const hours = 1;
    const floor = 1000;
    // ★h*0.3*1 = 1000.4 に なる 売上を 逆算★（時給 = 売上 / 時数）
    const h = 1000.4 / 0.3;
    const uriage = h * hours;
    const r = hakaru(uriage, [{ name: 'あ', role: '1種', hours: hours }]);
    const row = r.staff[0];
    expect(Math.round(row.byRate), '★下ごしらえが 違います★').toBe(floor);
    expect(Math.round(row.byFloor), '★下ごしらえが 違います★').toBe(floor);
    expect(row.byRate > row.byFloor, '★歩合の方が 生では 高い はず★').toBe(true);
    // ★出る額は 同じ ⇒ 赤★
    expect(
      row.usedFloor,
      '★出る額は どちらも ' +
        floor +
        '円 なのに 赤に なりません★\n' +
        '  ⇒ ★丸めた 後で 比べてください★（見た 通りに する）'
    ).toBe(true);
  });

  it('★② 歩合が はっきり 勝つ日は 赤に しない★', () => {
    const r = hakaru(100000, [{ name: 'あ', role: '1種', hours: 1 }]);
    const row = r.staff[0];
    expect(row.byRate > row.byFloor, '★下ごしらえが 違います★').toBe(true);
    expect(row.usedFloor, '★歩合で 出したのに 赤に なっています★').toBe(false);
  });

  it('★③ 最低保証が 勝つ日は 赤★', () => {
    const r = hakaru(1000, [{ name: 'あ', role: '1種', hours: 8 }]);
    const row = r.staff[0];
    expect(row.byFloor > row.byRate, '★下ごしらえが 違います★').toBe(true);
    expect(row.usedFloor, '★最低保証で 出したのに 赤に なりません★').toBe(true);
  });

  it('★④ 払う 額は 1円も 変わっていない★（高い方の まま）', () => {
    [
      [100000, 1],
      [1000, 8],
      [1000.4 / 0.3, 1],
      [0, 3],
    ].forEach(function (x) {
      const r = hakaru(x[0], [{ name: 'あ', role: '1種', hours: x[1] }]);
      const row = r.staff[0];
      expect(row.pay, '★払う額が 高い方に なっていません★').toBe(Math.max(row.byRate, row.byFloor));
    });
  });
});
