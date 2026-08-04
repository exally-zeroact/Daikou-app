'use strict';
// ============================================================
// ★画面にUUIDを出さない 2026-08-04★
//
//   ★司さん「売上1の横の英語のやつ邪魔でしょうがない」★
//     給料明細に 売上1(7e1919ef-4aaa-411e-8db0-ba0424…) と出ていた。
//     dk_device_labels が0件なので、端末ID(UUID)がそのまま画面に出ていた。
//
//   決まり:
//     1. 名前が付いていれば その名前（司さんの呼び方＝4987 / 1466 / 1173）
//     2. 付いていなければ 「車1」「車2」…
//     3. ★UUIDは画面に出さない★
// ============================================================
const path = require('path');
const CN = require(path.resolve(__dirname, '..', '..', 'js', 'car-name.js'));

const A = '7e1919ef-4aaa-411e-8db0-ba0424111111';
const B = 'f3527369-bbbb-411e-8db0-ba0424222222';
const C = '22849fdb-cccc-411e-8db0-ba0424333333';

describe('★名前が付いていれば その名前★', () => {
  it('司さんの呼び方が出る', () => {
    const m = CN.nameMap(
      [A, B, C],
      [
        { device_id: A, label: '4987' },
        { device_id: B, label: '1466' },
        { device_id: C, label: '1173' },
      ]
    );
    expect(m[A]).toBe('4987');
    expect(m[B]).toBe('1466');
    expect(m[C]).toBe('1173');
  });

  it('空の名前は「付いていない」扱い', () => {
    const m = CN.nameMap([A], [{ device_id: A, label: '   ' }]);
    expect(m[A]).toBe('車1');
  });
});

describe('★名前が無ければ「車1」「車2」（UUIDは出さない）★', () => {
  it('名前が1つも無くても、短い仮名が出る', () => {
    const m = CN.nameMap([A, B, C], []);
    const names = [m[A], m[B], m[C]].sort();
    expect(names).toEqual(['車1', '車2', '車3']);
  });

  it('★出す名前にUUIDが1文字も混ざらない★', () => {
    const m = CN.nameMap([A, B, C], []);
    Object.keys(m).forEach(function (k) {
      expect(CN.hasUuid(m[k]), '★画面にUUIDが出ている★ ' + m[k]).toBe(false);
      expect(m[k].length, '長すぎる（画面からはみ出す）').toBeLessThanOrEqual(8);
    });
  });

  it('名前が付いている車と、付いていない車が混ざっても大丈夫', () => {
    const m = CN.nameMap([A, B, C], [{ device_id: B, label: '1466' }]);
    expect(m[B]).toBe('1466');
    expect(CN.hasUuid(m[A])).toBe(false);
    expect(CN.hasUuid(m[C])).toBe(false);
  });
});

describe('★毎回おなじ番号になること（開くたびに入れ替わらない）★', () => {
  it('渡す順番が変わっても、同じ車は同じ番号', () => {
    const m1 = CN.nameMap([A, B, C], []);
    const m2 = CN.nameMap([C, A, B], []);
    expect(m2[A]).toBe(m1[A]);
    expect(m2[B]).toBe(m1[B]);
    expect(m2[C]).toBe(m1[C]);
  });

  it('同じ端末IDが2回来ても1台として数える', () => {
    const m = CN.nameMap([A, A, B], []);
    expect(Object.keys(m).length).toBe(2);
  });
});

describe('★UUIDを見つける目（画面の点検に使う）★', () => {
  it('UUIDの形を見つける', () => {
    expect(CN.hasUuid('売上1(' + A + ')')).toBe(true);
    expect(CN.hasUuid(A.slice(0, 8) + '…')).toBe(false); // 短縮形は見逃す（別に禁止する）
  });

  it('ふつうの文字は見つけない', () => {
    ['4987', '車1', '売上1', '2026-08-04', '5,320円'].forEach(function (s) {
      expect(CN.hasUuid(s), s).toBe(false);
    });
  });
});

describe('★壊れた入力で落ちないこと★', () => {
  it('空でも落ちない', () => {
    expect(CN.nameMap(null, null)).toEqual({});
    expect(CN.nameMap([], [])).toEqual({});
  });

  it('変な行が混ざっても落ちない', () => {
    const m = CN.nameMap([A], [null, {}, { device_id: null }, 'こわれている']);
    expect(m[A]).toBe('車1');
  });

  it('1件だけ欲しい時', () => {
    expect(CN.nameOf(A, [A, B], [{ device_id: A, label: '4987' }])).toBe('4987');
    expect(CN.hasUuid(CN.nameOf(B, [A, B], []))).toBe(false);
  });
});
