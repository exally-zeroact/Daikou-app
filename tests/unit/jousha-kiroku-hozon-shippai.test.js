'use strict';
// ============================================================
// ★乗車の 記録（daikou_history）の 保存に 失敗しても 黙らない・消さない・二重に 数えない★ 2026-10-11
//   前は renderFare の 中で 保存済みの 印（histSaved）を 立ててから 今日の 合計（daikou_today）を 書き、最後に 履歴を 書いた。
//   受け皿が 無く、端末の 空きが 足りないと「今日の 合計だけ 増えて 履歴の 1件が 残らない」・書き直しも されない・
//   運転手には 何も 出なかった（お金の 記録が 黙って 消える 道）。
//   ★本物の 塊を index.html から 切り出して 回す★（renderFare の 保存の 塊・onIdle の 精算終了の 知らせ・
//     _historyDedupeUpsert・_kyouWoKaku・_jouShaKirokuHozon）＝試験の 中に 写しを 持たない。
//   ★わざと壊して 赤に なった 記録（10-11・測った）★：知らせの 門を 外す 6本／知らせの 印を 立てない 6本／
//     知らせの 文を 入れ替える 4本／精算終了の 知らせを fare の 外へ 1本／印を「|| true」で 立てる 6本／
//     合計の 書き直しを 殺す 2本／読めない 履歴を 受けない 1本／合計で 転んだら 進めない 2本／今日の 合計を 先に 書く 2本／確定で 印を 戻さない（2つ それぞれ） 1本 赤。
//     「先に 印を 立てる」は 後で 保存の 返事で 必ず 書き直すので 動きが 変わらない（弱めていない）。
// ============================================================
const fs = require('fs');
const path = require('path');

const H = fs.readFileSync(path.resolve(__dirname, '..', '..', 'index.html'), 'utf8');

function tori(name) {
  const i = H.indexOf('function ' + name + '(');
  if (i < 0) throw new Error(name + ' が 見つからない');
  let d = 0;
  for (let j = H.indexOf('{', i); j < H.length; j++) {
    if (H[j] === '{') d++;
    else if (H[j] === '}' && --d === 0) return H.slice(i, j + 1);
  }
  throw new Error(name + ' の 終わりが 見つからない');
}
function kiridasu(hajime, owari) {
  const a = H.indexOf(hajime);
  if (a < 0) throw new Error('塊の 頭が 見つからない: ' + hajime.slice(0, 30));
  const b = H.indexOf(owari, a);
  if (b < 0) throw new Error('塊の 終わりが 見つからない');
  return H.slice(a, b + owari.length);
}

const HOZON = kiridasu(
  '        if (!histSaved) {\n          // ★保存済みの 印は 書けた 時だけ 立てる★',
  '            _kyouMiHozon = false;\n        }'
);
const IDLE = kiridasu('          if (!histSaved)\n            showToastLong(', ');');

// 業務の 始まりの 時刻＝履歴の 鍵の 日付（本物は 業務の 始まりの 日で 鍵を 作る）
const T0 = new Date(2026, 0, 5, 20, 0, 0).getTime();
const SRC = `
${tori('_historyDedupeUpsert')}${tori('_kyouWoKaku')}${tori('_jouShaKirokuHozon')}
var histSaved = false, _kyouMiHozon = false, _histHozonShippaiShirase = false;
var todayDist = 1000, todayCount = 1, todayFareYen = 1000, lastGoodTotalM = 0;
var surchargeOn = false, extras = [], discounts = [];
var shirase = [];
function showToastLong(m) { shirase.push(m); }
var TK = null;
var T0 = ${T0};
var Business = { getState: () => ({ start_time: T0 }), getCurrentTrip: () => ({ start_time: TK }) };
function byouga(s, fare, total) { ${HOZON} }
function seisanShuryo() { ${IDLE} }
function kakutei() { histSaved = false; _histHozonShippaiShirase = false; _kyouMiHozon = false; }
function modoru() { histSaved = false; }
return {
  byouga, seisanShuryo, kakutei, modoru,
  setTK(k) { TK = k; },
  get st() { return { histSaved, _kyouMiHozon, todayDist, todayCount, todayFareYen, shirase: shirase.slice() }; },
};
`;

function nisemono() {
  const m = new Map();
  let dame = () => false;
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      if (dame(k)) throw new Error('QuotaExceededError');
      m.set(k, v);
    },
    removeItem: (k) => m.delete(k),
    m,
    setDame(f) {
      dame = f;
    },
  };
}

function scen(tk, steps, rirekiNoNakami) {
  const ls = nisemono();
  const hk = 'daikou_history_' + new Date(T0).toDateString();
  ls.m.set(
    hk,
    rirekiNoNakami !== undefined
      ? rirekiNoNakami
      : JSON.stringify([{ trip_key: 'a', distance_m: 1000, fare: 1000 }])
  );
  // eslint-disable-next-line no-new-func
  const A = new Function('localStorage', SRC)(ls);
  A.setTK(tk);
  let nageta = 0;
  for (const st of steps) {
    if (st === 'kakutei') A.kakutei();
    else if (st === 'modoru') A.modoru();
    else if (st === 'seisan') A.seisanShuryo();
    else if (st.startsWith('dame:')) {
      const k = st.slice(5);
      ls.setDame(k === 'nashi' ? () => false : (x) => x === (k === 'rireki' ? hk : 'daikou_today'));
    } else if (st.startsWith('byouga'))
      for (let i = 0; i < +st.slice(6); i++) {
        try {
          A.byouga({ distance_m: 5000 }, 3000, 3000);
        } catch (_) {
          nageta++;
        }
      }
  }
  let hist = null;
  try {
    hist = JSON.parse(ls.getItem(hk));
  } catch (_) {
    hist = null;
  }
  const kyou = JSON.parse(ls.getItem('daikou_today') || 'null');
  return { hist, kyou, st: A.st, nageta };
}

describe('★乗車の 記録の 保存に 失敗しても 黙らない・消さない・二重に 数えない（10-11）★', () => {
  for (const tk of ['b', null]) {
    const shirushi = tk ? '在り' : '無し';
    for (const dame of ['rireki', 'kyou']) {
      it(`印 ${shirushi}・${dame === 'rireki' ? '履歴' : '今日の 合計'}で 5回 転ぶ → 空きが できた 後に 2件・4000円・知らせ 1回`, () => {
        const r = scen(tk, ['kakutei', 'dame:' + dame, 'byouga5', 'dame:nashi', 'byouga3']);
        expect(r.hist.length).toBe(2);
        expect(r.hist.reduce((a, b) => a + b.fare, 0)).toBe(4000);
        expect({ count: r.kyou.count, fare: r.kyou.fare }).toEqual({ count: 2, fare: 4000 });
        expect({ c: r.st.todayCount, f: r.st.todayFareYen }).toEqual({ c: 2, f: 4000 });
        expect(r.st.shirase.length).toBe(1);
        expect(r.st.shirase[0]).toMatch(
          dame === 'rireki' ? /^この 乗車の 履歴が/ : /^今日の 合計が/
        );
      });
    }

    it(`印 ${shirushi}・履歴で 転んだまま 精算終了 → 手元の 合計は 進めず・精算終了でも 知らせる`, () => {
      const r = scen(tk, ['kakutei', 'dame:rireki', 'byouga5', 'seisan']);
      expect(r.hist.length).toBe(1);
      expect({ c: r.st.todayCount, f: r.st.todayFareYen }).toEqual({ c: 1, f: 1000 });
      expect(r.kyou).toBe(null); // 保存場所の 今日の 合計も 進めていない
      expect(r.st.shirase.length).toBe(2);
      expect(r.st.shirase[1]).toMatch(/^この 乗車は 履歴に 残せませんでした/);
    });

    it(`印 ${shirushi}・合計で 転んだまま 精算終了 → 履歴は 在るので 精算終了の 知らせは 出さない`, () => {
      const r = scen(tk, ['kakutei', 'dame:kyou', 'byouga5', 'seisan']);
      expect(r.hist.length).toBe(2);
      expect(r.st.shirase.length).toBe(1);
    });

    it(`印 ${shirushi}・正常 → 知らせ 0・2件`, () => {
      const r = scen(tk, ['kakutei', 'byouga3', 'seisan']);
      expect(r.hist.length).toBe(2);
      expect(r.st.shirase.length).toBe(0);
    });
  }

  for (const kowareta of ['{"x":1}', '壊れた字']) {
    it(`履歴が 読めない（${kowareta.length}字）→ 転ばず・印を 立てず・知らせる（描き直し 1回＋精算終了 1回）`, () => {
      const r = scen('b', ['kakutei', 'byouga5', 'seisan'], kowareta);
      expect(r.nageta).toBe(0);
      expect(r.st.histSaved).toBe(false);
      expect(r.st.shirase.length).toBe(2);
    });
  }

  it('確定（onSend）で 知らせの 印と 合計の 書き直しの 印を 戻す（本物の 字で 縛る・試験の kakutei は その 写し）', () => {
    expect(H).toMatch(
      /appState = 'fare';\s*histSaved = false;\s*_histHozonShippaiShirase = false;[^\n]*\n\s*_kyouMiHozon = false;/
    );
  });

  it('精算終了の 知らせは 支払画面（fare）の 中だけ（取消の 後の 空車では 出ない）', () => {
    expect(H).toMatch(
      /if \(appState === 'fare'\) \{\s*\/\/ ★履歴が 書けていないまま 精算終了[\s\S]{0,400}if \(!histSaved\)\s*showToastLong\(/
    );
  });
});
