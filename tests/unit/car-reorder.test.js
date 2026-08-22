'use strict';
// ============================================================
// ★車を上下に動かして並べ替える★ 2026-08-09
//
//   ★司さんの言葉★
//     「ここで名前の変更と並べかえで上にある順から売上とかも一緒の並びになるように」
//
//   ★今どうなっていたか★
//     並びの元(dk_device_labels.sort_order)は★既にある★。
//     売上・給料(js/car-name.js / js/payroll-daily.js)はそれを使っている。
//     ところが ★事務所の「有効化した端末」だけ 最終利用の新しい順★ で並べていた
//     （dashboard.html: '&order=last_seen.desc.nullslast'）。
//     ＝ 司さんが決めた並びが、この画面だけ効かない。写真が 車3→車2→車1→車4 だったのはそのため。
//
//   ★ここで決めること★
//     ・上下に動かした時の 新しい並び番号を どう振るか
//     ・★全部に連番を振り直す★（虫食いを残さない＝次に動かした時にズレない）
//     ・端は動かない（一番上で▲、一番下で▼は 何も起きない）
// ============================================================
const CarName = require('../../js/car-name.js');

const ids = ['a', 'b', 'c', 'd'];

describe('★上下に動かす★', () => {
  it('真ん中を上へ', () => {
    const r = CarName.reorder(ids, 2, -1); // c を上へ
    expect(r.order).toEqual(['a', 'c', 'b', 'd']);
  });

  it('真ん中を下へ', () => {
    const r = CarName.reorder(ids, 1, 1); // b を下へ
    expect(r.order).toEqual(['a', 'c', 'b', 'd']);
  });

  it('★一番上で 上へ は 何も起きない★', () => {
    const r = CarName.reorder(ids, 0, -1);
    expect(r.order).toEqual(ids);
    expect(r.changed, '動いていないのに保存しようとしている').toBe(false);
  });

  it('★一番下で 下へ は 何も起きない★', () => {
    const r = CarName.reorder(ids, 3, 1);
    expect(r.order).toEqual(ids);
    expect(r.changed).toBe(false);
  });

  it('★動いたら 全部に連番を振り直す★（虫食いを残さない）', () => {
    const r = CarName.reorder(ids, 2, -1);
    expect(r.changed).toBe(true);
    expect(r.rows).toEqual([
      { device_id: 'a', sort_order: 1 },
      { device_id: 'c', sort_order: 2 },
      { device_id: 'b', sort_order: 3 },
      { device_id: 'd', sort_order: 4 },
    ]);
  });

  it('壊れた入力でも落ちない（業務を止めない）', () => {
    expect(CarName.reorder(null, 0, 1).order).toEqual([]);
    expect(CarName.reorder(ids, 99, 1).order).toEqual(ids);
    expect(CarName.reorder(ids, 0, 0).changed).toBe(false);
  });
});

describe('★決めた並びが そのまま使われる★', () => {
  it('並べ替えた結果を sortIds に渡すと 同じ順になる', () => {
    const r = CarName.reorder(ids, 2, -1);
    const labels = r.rows.map((x) => ({ device_id: x.device_id, sort_order: x.sort_order }));
    expect(CarName.sortIds(ids, labels), '★決めた順にならない＝売上や給料と食い違う★').toEqual(
      r.order
    );
  });

  it('まだ何も決めていなければ 今までどおり（端末IDの順）', () => {
    expect(CarName.sortIds(['c', 'a', 'b'], [])).toEqual(['a', 'b', 'c']);
  });
});
