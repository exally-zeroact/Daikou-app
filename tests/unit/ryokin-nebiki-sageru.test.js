'use strict';
// ============================================================
// ★値引きは 必ず 下げる・マイナスの 追加料金は 足さずに 知らせる★ 2026-10-11（司さん）
//   ★司さんの言葉★「値引きでなんで上がるんど下げるんが普通やろが」
//   前は 値引きに -500 と 打つと 料金が 500円 上がった（追加料金の マイナスは 値引きとして 働いた）。
//   追加料金の マイナスは 黙って 0 に しない（お金は 止めて 警告）＝足さずに「値引きで 登録して」と 知らせる。
//   ★過去に 保存した 業務の 記録（js/trip-edit.js）は 触らない★＝符号を 変えると 昔の 業務の 元の 料金の 割り戻しが 変わる。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// index.html の 関数を 1つ 取り出す（字の 形でなく 出る 数で 見る 所は 動かす）
function toridasu(name) {
  const i = HTML.indexOf('function ' + name + '(');
  if (i < 0) throw new Error(name + ' が 見つからない');
  let d = 0;
  for (let j = HTML.indexOf('{', i); j < HTML.length; j++) {
    if (HTML[j] === '{') d++;
    else if (HTML[j] === '}' && --d === 0) return HTML.slice(i, j + 1);
  }
  throw new Error(name + ' の 終わりが 見つからない');
}

describe('★値引きは 必ず 下げる・マイナスの 追加料金は 足さずに 知らせる（10-11 司さん）★', () => {
  it('値引きの 合計は 打った数の 大きさで 足す（-500 と 300 で 800円）', () => {
    // eslint-disable-next-line no-new-func
    const f = new Function('discounts', toridasu('_discountTotal') + '; return _discountTotal();');
    expect(f([{ amount: -500 }, { amount: 300 }])).toBe(800);
    expect(f([{ amount: '200' }, {}])).toBe(200);
    expect(f(null)).toBe(0);
  });

  it('見本を 選ぶ 時：値引きは 大きさ・マイナスの 追加料金は 足さずに 知らせる', () => {
    const ls = {
      daikou_discounts: JSON.stringify([{ name: 'わ', amount: -500 }]),
      daikou_extras: JSON.stringify([{ name: 'た', amount: -300 }]),
    };
    const env = {
      localStorage: { getItem: (k) => ls[k] || null },
      discounts: [],
      extras: [],
      closeDiscountModal() {},
      closeExtraModal() {},
      shirase: [],
    };
    // eslint-disable-next-line no-new-func
    new Function(
      'localStorage',
      'discounts',
      'extras',
      'closeDiscountModal',
      'closeExtraModal',
      'showToast',
      toridasu('addDiscount') + toridasu('addExtra') + 'addDiscount(0); addExtra(0);'
    )(
      env.localStorage,
      env.discounts,
      env.extras,
      env.closeDiscountModal,
      env.closeExtraModal,
      (m) => env.shirase.push(m)
    );
    expect(env.discounts[0].amount).toBe(500);
    expect(env.extras.length).toBe(0); // 黙って 0 で 足さない
    expect(env.shirase.length).toBe(1); // 知らせた
  });

  it('業務を 後で 直す 画面の 一覧：マイナスの 追加料金は ¥ の 中に 入れずに「使えません」と 出す', () => {
    // _yen は 字を ¥0 に する（10-11 taiketsu 実測）＝「使えません」は _yen の 外で 出す
    expect(HTML).not.toMatch(/_yen\([^)]*使えません/);
    expect(HTML).toMatch(
      /\? '使えません（値引きで登録）'\s*: _yen\(Number\(x\.amount\) \|\| 0\)\)/
    );
  });

  it('設定の 欄と 業務を 後で 直す 画面も 同じ 形で 正す（字の 形で 見る）', () => {
    expect(HTML).toMatch(/discountItems\[i\]\.amount = Math\.abs\(parseInt\(v, 10\) \|\| 0\)/);
    expect(HTML).toMatch(/if \(n < 0\) \{\s*showToast\('マイナスの 追加料金は 使えません/);
    expect(HTML).toMatch(
      /_cur\.discounts\.push\(\{ name: x\.name, amount: Math\.abs\(Number\(x\.amount\) \|\| 0\) \}\)/
    );
    expect(HTML).toMatch(
      /if \(\(Number\(x\.amount\) \|\| 0\) < 0\) \{\s*if \(typeof showToast === 'function'\)\s*showToast\(/
    );
  });
});
