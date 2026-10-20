'use strict';
// ============================================================
// ★★画面・紙に 出す 実費の 名前の 決まり（JippiHozon.mieruKinds）★★ 2026-10-20
//   司さん「会社で設定したものがここや月次などに反映されるんやろが」
//   売上表（uriage.html）・月次集計（shukei.html の 画面と 紙）が この 1か所を 呼ぶ。
//   ★出す＝消していない 物 ＋ 消した・一覧に 行が 無い 物でも その 月に 額が 在る 物★
//   （隠れたまま 引かれる 事を 作らない）。お金は 見ない（引く 額は uriage-agg.js deductOf）。
//   わざと壊す：額を 見ない ⇒ ③④ 赤／2行の 時に 先の 行を 使う ⇒ ⑥ 赤
// ============================================================
globalThis.window = globalThis;
require('../../js/jippi-hozon.js');
const J = globalThis.JippiHozon;

const ZERO = [
  { kind_id: 'toll', label: '高速代', active: true, deleted_at: '2026-10-05T06:43:00Z' },
  { kind_id: 'bridge', label: '経費', active: true, deleted_at: null },
  { kind_id: 'other', label: 'その他', active: false, deleted_at: '2026-09-18T15:05:24Z' },
];
const ids = (l) => l.map((x) => x.kind_id + ':' + x.label);
const gaku = (o) => (k) => o[k] || 0;

describe('★実費の 名前の 決まり（mieruKinds）★', () => {
  it('① 一覧が 読めない・空 ⇒ 今までの 3つ', () => {
    expect(ids(J.mieruKinds(null))).toEqual(['toll:高速代', 'bridge:橋代', 'other:その他']);
    expect(ids(J.mieruKinds([]))).toEqual(['toll:高速代', 'bridge:橋代', 'other:その他']);
  });
  it('② 消した 物は 出さない（ZERO代行 の 形＝経費 だけ）', () => {
    expect(ids(J.mieruKinds(ZERO, gaku({})))).toEqual(['bridge:経費']);
  });
  it('③ 消した 物でも その 月に 額が 在れば 出す', () => {
    expect(ids(J.mieruKinds(ZERO, gaku({ toll: 800 })))).toEqual(['toll:高速代', 'bridge:経費']);
  });
  it('④ 一覧に 行が 無い 古い 3つでも 額が 在れば 出す', () => {
    const l = [{ kind_id: 'kabc', label: '駐車場代', deleted_at: null }];
    expect(ids(J.mieruKinds(l, gaku({ toll: 800, other: 1 })))).toEqual([
      'kabc:駐車場代',
      'toll:高速代',
      'other:その他',
    ]);
  });
  it('⑤ 打つ 欄（nyuryoku）は「使う」を 外した 物を 出さない（額が 在れば 出す）', () => {
    const l = ZERO.map((k) =>
      k.kind_id === 'other' ? Object.assign({}, k, { deleted_at: null }) : k
    );
    expect(ids(J.mieruKinds(l, gaku({}), { nyuryoku: true }))).toEqual(['bridge:経費']);
    expect(ids(J.mieruKinds(l, gaku({}), {}))).toEqual(['bridge:経費', 'other:その他']);
    expect(ids(J.mieruKinds(l, gaku({ other: 5 }), { nyuryoku: true }))).toEqual([
      'bridge:経費',
      'other:その他',
    ]);
  });
  it('⑥ 同じ kind_id が 2行 ⇒ 消していない 行を 使う・1つに まとめる', () => {
    const l = [
      { kind_id: 'bridge', label: '橋代', deleted_at: '2026-10-01T00:00:00Z' },
      { kind_id: 'bridge', label: '経費', deleted_at: null },
    ];
    expect(ids(J.mieruKinds(l, gaku({})))).toEqual(['bridge:経費']);
  });
  it('⑦ 一度 出した 物（mieta）は 0 に なっても 出す', () => {
    expect(ids(J.mieruKinds(ZERO, gaku({}), { mieta: { toll: 1 } }))).toEqual([
      'toll:高速代',
      'bridge:経費',
    ]);
  });
});
