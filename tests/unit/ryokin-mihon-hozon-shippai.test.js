'use strict';
// ============================================================
// ★追加料金・値引きの 見本の 保存に 失敗したら 黙らずに 知らせる★ 2026-10-11
//   前は saveExtras / saveDiscounts が catch(_){} で 飲み込み、運転手は 保存できたと 思い込んだ
//   （端末の 空きが 足りない 等で 保存されず、開き直すと 前の 見本に 戻っていた）。
//   ★わざと壊して 赤に なった 記録（10-11）★：catch の 中の 知らせを 消すと 2本 赤。
// ============================================================
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.resolve(__dirname, '..', '..', 'index.html'), 'utf8');

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

function hashiru(name, items, kowareru) {
  const shirase = [];
  const kaita = {};
  const localStorage = {
    setItem(k, v) {
      if (kowareru) throw new Error('QuotaExceededError');
      kaita[k] = v;
    },
  };
  // eslint-disable-next-line no-new-func
  const ok = new Function(
    'localStorage',
    'extraItems',
    'discountItems',
    'showToast',
    toridasu(name) + '; return ' + name + '();'
  )(localStorage, items, items, (m) => shirase.push(m));
  return { ok, shirase, kaita };
}

describe('★見本の 保存に 失敗したら 知らせる（10-11）★', () => {
  for (const [name, key] of [
    ['saveExtras', 'daikou_extras'],
    ['saveDiscounts', 'daikou_discounts'],
  ]) {
    it(name + '：保存できた 時は 黙って 書く・失敗した 時は 知らせて false', () => {
      const items = [{ name: 'た', amount: 300 }];
      const yoi = hashiru(name, items, false);
      expect(yoi.ok).toBe(true);
      expect(yoi.shirase.length).toBe(0);
      expect(JSON.parse(yoi.kaita[key])).toEqual(items);
      const warui = hashiru(name, items, true);
      expect(warui.ok).toBe(false);
      expect(warui.shirase.length).toBe(1);
      expect(warui.shirase[0]).toMatch(/保存できませんでした/);
    });
  }
});
