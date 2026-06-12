// tests/integration/history-cross-midnight-retention.test.js
//
// ★設計変更宣言 (2026-06-06・司さん指示「履歴は全業務記録しとかないかん・20回でも30回でも」):
//   代行は深夜営業で日付をまたぐ。旧 cleanOldHistoryKeys は「今日以外の daikou_history_<日付> を
//   全削除」していたため、22時開始の業務が翌0時以降の起動で「昨日のキー」として消され、前夜分の
//   履歴が永久消失していた(実機 2026-06-06 で再現)。
//   本テストは index.html の cleanOldHistoryKeys を抽出して実行し、★直近30日のキーは保持・30日超過
//   のみ削除★ を検証する(= 日跨ぎの今夜分が消えないことを担保)。
//
// 絶対ルール準拠: distance_m / 課金 / _historyDedupeUpsert は無関係。表示/保持ロジックのみ。

'use strict';

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

// index.html インライン script から関数 1 つを波括弧マッチで抽出
function extractFn(name) {
  const start = HTML.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(name + ' 未検出');
  const braceStart = HTML.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < HTML.length; i++) {
    const c = HTML[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return HTML.slice(start, i + 1);
    }
  }
  throw new Error(name + ' の閉じ括弧未検出');
}

function makeLS() {
  const store = Object.create(null);
  return {
    getItem(k) {
      return k in store ? store[k] : null;
    },
    setItem(k, v) {
      store[k] = String(v);
    },
    removeItem(k) {
      delete store[k];
    },
    key(i) {
      return Object.keys(store)[i] || null;
    },
    get length() {
      return Object.keys(store).length;
    },
    _raw: store,
  };
}

function dayKey(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return 'daikou_history_' + d.toDateString();
}

function loadCleanFn(ls) {
  const src = extractFn('cleanOldHistoryKeys');
  const fn = new Function('localStorage', 'dlog', src + '\n;return cleanOldHistoryKeys;');
  return fn(ls, function () {});
}

describe('履歴 日跨ぎ保持 (cleanOldHistoryKeys = 30日 retention)', () => {
  it('今日のキーは保持される', () => {
    const ls = makeLS();
    ls.setItem(dayKey(0), JSON.stringify([{ distance_m: 1000, fare: 1300 }]));
    loadCleanFn(ls)();
    expect(ls.getItem(dayKey(0))).not.toBeNull();
  });

  it('★昨日のキー(=日跨ぎ前夜分)が保持される (旧実装はここで消えていた)', () => {
    const ls = makeLS();
    ls.setItem(dayKey(1), JSON.stringify([{ distance_m: 3570, fare: 1900 }]));
    ls.setItem(dayKey(0), JSON.stringify([{ distance_m: 3390, fare: 1900 }]));
    loadCleanFn(ls)();
    expect(ls.getItem(dayKey(1))).not.toBeNull(); // 前夜分が残る
    expect(ls.getItem(dayKey(0))).not.toBeNull();
  });

  it('29日前のキーは保持される', () => {
    const ls = makeLS();
    ls.setItem(dayKey(29), JSON.stringify([{ distance_m: 1000, fare: 1300 }]));
    loadCleanFn(ls)();
    expect(ls.getItem(dayKey(29))).not.toBeNull();
  });

  it('31日前のキーは削除される (retention 超過)', () => {
    const ls = makeLS();
    ls.setItem(dayKey(31), JSON.stringify([{ distance_m: 1000, fare: 1300 }]));
    ls.setItem(dayKey(0), JSON.stringify([{ distance_m: 2000, fare: 1500 }]));
    loadCleanFn(ls)();
    expect(ls.getItem(dayKey(31))).toBeNull();
    expect(ls.getItem(dayKey(0))).not.toBeNull();
  });

  it('日付パース不能の壊れたキーは削除される', () => {
    const ls = makeLS();
    ls.setItem('daikou_history_garbage', JSON.stringify([{ distance_m: 1 }]));
    loadCleanFn(ls)();
    expect(ls.getItem('daikou_history_garbage')).toBeNull();
  });

  it('daikou_history_ 以外のキーは触らない', () => {
    const ls = makeLS();
    ls.setItem('daikou_today', JSON.stringify({ count: 3 }));
    ls.setItem('daikou_business_history', JSON.stringify([{ start_time: 1 }]));
    loadCleanFn(ls)();
    expect(ls.getItem('daikou_today')).not.toBeNull();
    expect(ls.getItem('daikou_business_history')).not.toBeNull();
  });
});
