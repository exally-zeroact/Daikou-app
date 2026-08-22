'use strict';
// ============================================================
// 請求先マスタ(端末キャッシュ)テスト (2026-08-01)
//
//   ★マスタの唯一の正は「代行請求書アプリの companies」★
//   ダイコメ側に別マスタは作らない(会社を2箇所に登録させない・司さん指摘)。
//   端末はそれを取ってきてキャッシュし、オフラインでも一覧を出せるようにする。
//
//   ★守る性質★
//     1. オフラインでも前回の一覧が出る(キャッシュを消さない)
//     2. 通信に失敗しても throw しない・キャッシュを壊さない
//     3. 変な応答が来てもキャッシュを汚さない
//     4. 未活性化の端末(自社運用)は何もしない
// ============================================================
const CM = require('../../js/customer-master.js');

describe('請求先マスタ: 受け取った一覧を整える', () => {
  it('id と name だけを取り出す', () => {
    const out = CM.normalize([
      { id: 1, name: '株式会社マルヨシ' },
      { id: 'abc', name: '大和運輸' },
    ]);
    expect(out).toEqual([
      { customer_id: '1', name: '株式会社マルヨシ', active: true },
      { customer_id: 'abc', name: '大和運輸', active: true },
    ]);
  });

  it('名前が無い/壊れた行は捨てる', () => {
    const out = CM.normalize([
      { id: 1, name: '○○商事' },
      { id: 2, name: '' },
      { id: 3 },
      null,
      'x',
      { name: '名前だけでIDなし' },
    ]);
    expect(out.map((c) => c.name)).toEqual(['○○商事']);
  });

  it('★何が来ても throw しない★', () => {
    expect(() => CM.normalize(null)).not.toThrow();
    expect(() => CM.normalize('x')).not.toThrow();
    expect(() => CM.normalize({})).not.toThrow();
    expect(CM.normalize(null)).toEqual([]);
  });

  it('多すぎる場合は上限までにする(端末を埋めない)', () => {
    const big = [];
    for (let i = 0; i < 2000; i++) big.push({ id: i, name: '会社' + i });
    expect(CM.normalize(big).length).toBe(CM.MAX_CUSTOMERS);
  });

  it('名前が同じでも別IDなら両方残す(支店違いを潰さない)', () => {
    const out = CM.normalize([
      { id: 1, name: '大和運輸' },
      { id: 2, name: '大和運輸' },
    ]);
    expect(out.length).toBe(2);
  });
});

describe('請求先マスタ: キャッシュの扱い', () => {
  it('空の応答でキャッシュを消さない(通信の一瞬の不調で現場の一覧が消えたら事故)', () => {
    const before = [{ customer_id: '1', name: '○○商事', active: true }];
    expect(CM.mergeCache(before, [])).toEqual(before);
    expect(CM.mergeCache(before, null)).toEqual(before);
  });

  it('新しい一覧が来たら入れ替える', () => {
    const before = [{ customer_id: '1', name: '古い会社', active: true }];
    const next = [{ customer_id: '2', name: '新しい会社', active: true }];
    expect(CM.mergeCache(before, next)).toEqual(next);
  });

  it('★何が来ても throw しない★', () => {
    expect(() => CM.mergeCache(null, null)).not.toThrow();
    expect(CM.mergeCache(null, null)).toEqual([]);
  });
});
