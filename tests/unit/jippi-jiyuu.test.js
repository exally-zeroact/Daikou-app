// ============================================================
// ★★実費を 自由に 足せる／消せる（お金は 1円も 変えない）★★ 2026-09-06
//
//   ★司さん★「この項目ってユーザーは自由に決めれるん？追加や削除できる？」→「ウ（自由に）」
//
//   ★前（決め打ち）★
//     dk_shift_edits … toll_yen / bridge_yen / other_yen ＝★列が 3本 固定★
//     ⇒ 増やせない／減らせない／名前も「その他」しか 変えられない
//   ★今★
//     ①dk_expense_kinds … 会社ごとの 名前の 一覧（足す／消す／並べ替え）
//     ②dk_shift_edits.expenses（jsonb）… { 名前のid: 金額 } で いくつでも
//     ★古い 3列は 消しません★（前の 記録が 読めなくなる 事故を 防ぐ）
//
//   ★★この 見張りが 守る 物★★
//     ①★今までの 行（expenses が 無い）は 1円も 変わらない★
//     ②足した 物は ★引かれる★
//     ③★古い 名前が expenses に 紛れても 二重に 引かない★
//     ④「引く/引かない」の チェックは ★古い 3つにだけ★ 効く（前と 同じ）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-06 実測）★★
//     ①expenses を 足さない（soto を 消す）………… ★赤★（②が 落ちる）
//     ②古い 名前を はじかない ……………………… ★赤★（③が 落ちる＝二重に 引く）
// ============================================================
'use strict';

const U = require('../../js/uriage-agg.js');

const ZENBU = { deduct_toll: true, deduct_bridge: true, deduct_other: true };

describe('★実費を 自由に 足せる（お金は 変わらない）★', () => {
  it('★①今までの 行（expenses が 無い）は 1円も 変わらない★', () => {
    // ★直す前の 式を そのまま 書き写した物★と 突き合わせる
    const n = (v) => (isFinite(Number(v)) ? Number(v) : 0);
    const mae = (e, st) =>
      (st.deduct_toll ? n(e.toll_yen) : 0) +
      (st.deduct_bridge ? n(e.bridge_yen) : 0) +
      (st.deduct_other ? n(e.other_yen) : 0);
    const tesuto = [
      {},
      { toll_yen: 1200 },
      { toll_yen: 1200, bridge_yen: 300 },
      { toll_yen: 1200, bridge_yen: 300, other_yen: 450 },
      { toll_yen: 0, bridge_yen: 0, other_yen: 0 },
      { toll_yen: '1200', bridge_yen: null },
    ];
    const st2 = [
      ZENBU,
      { deduct_toll: false, deduct_bridge: true, deduct_other: true },
      { deduct_toll: true, deduct_bridge: false, deduct_other: false },
    ];
    const chigau = [];
    tesuto.forEach((e) => {
      st2.forEach((st) => {
        const a = mae(e, st);
        const b = U.deductOf(e, st);
        if (a !== b) chigau.push({ e, st, mae: a, ima: b });
      });
    });
    expect(chigau, '★今までの 行で 金額が 変わりました★').toEqual([]);
  });

  it('★②足した 物は 引かれる★', () => {
    expect(U.deductOf({ toll_yen: 1200, expenses: { k1: 500 } }, ZENBU)).toBe(1700);
    expect(U.deductOf({ expenses: { k1: 500, k2: 250 } }, ZENBU)).toBe(750);
  });

  it('★③古い 名前が expenses に 紛れても 二重に 引かない★', () => {
    // ★toll / bridge / other は 列の 方で 数える★（expenses 側は 無視）
    expect(U.deductOf({ toll_yen: 1200, expenses: { toll: 9999 } }, ZENBU)).toBe(1200);
    expect(U.deductOf({ bridge_yen: 300, expenses: { bridge: 9999, k1: 100 } }, ZENBU)).toBe(400);
    expect(U.deductOf({ other_yen: 50, expenses: { other: 9999 } }, ZENBU)).toBe(50);
  });

  it('★④チェックは 古い 3つにだけ 効く（足した 物は いつも 引く）★', () => {
    const kiru = { deduct_toll: false, deduct_bridge: false, deduct_other: false };
    // ★足した 物には「引く/引かない」の チェックが 在りません（足した＝引く 物）★
    expect(U.deductOf({ toll_yen: 1200, expenses: { k1: 500 } }, kiru)).toBe(500);
  });

  it('★⑤壊れた 中身でも 落ちない★', () => {
    expect(U.deductOf({ expenses: null }, ZENBU)).toBe(0);
    expect(U.deductOf({ expenses: 'こわれた' }, ZENBU)).toBe(0);
    expect(U.deductOf({ expenses: { k1: 'あ' } }, ZENBU)).toBe(0);
    expect(U.deductOf(null, ZENBU)).toBe(0);
  });
});
