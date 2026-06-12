// tests/integration/overcount-zero-routing.test.js
//
// ★設計変更宣言 (2026-06-06・司さん指示「過大も直せ・精度は上がってるから捨てすぎるな」):
//   実機0606 で map-matching の別道路 routing が ノイズGPS の flip 迂回を拾い、課金距離を
//   タイヤ値超え(過大請求方向)に押し上げていた(iPhone13 trip2 +2.74%)。
//   対策 = routing 受理専用上限 routingAcceptMaxRatio=2.5(never-over ガード routingMaxRatio=4.0
//   とは分離・トンネルcoast温存)。生GPS/sameRoad弧は不変=捨てすぎ無し。
//
//   本テストは実機 fixture(0606+realtest3・愛媛)を distance コアに流し、★全業務で過大ゼロ
//   (eng ≤ tire) かつ 過小なし(≥ -4% 国交省バンド)★ を恒久ガードする。
//   過大が復活(routingAcceptMaxRatio を 4.0 に戻す等)したら即 FAIL。
//
// 絶対ルール準拠: calcFare 非依存・distance_m 算出のみ。

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FIX = path.join(__dirname, '..', 'fixtures');
let computeDistance, DEFAULTS, dec;

beforeAll(() => {
  // ★VM sandbox で隔離 (グローバル汚染回避)★: roads-decoder/roads-ehime は browser IIFE
  //   (window/self に公開) のため、global を直接汚すと フルスイートで他テストと干渉する
  //   (単独緑・フル赤 の典型)。専用 context に window を向けて完全隔離する。
  const sandbox = {
    console: console,
    atob: typeof atob !== 'undefined' ? atob : (b) => Buffer.from(b, 'base64').toString('binary'),
    btoa: typeof btoa !== 'undefined' ? btoa : (s) => Buffer.from(s, 'binary').toString('base64'),
    Uint8Array: Uint8Array,
    TextDecoder: typeof TextDecoder !== 'undefined' ? TextDecoder : undefined,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'roads-decoder.js'), 'utf8'),
    sandbox,
    { filename: 'roads-decoder.js' }
  );
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'roads-ehime.js'), 'utf8'),
    sandbox,
    { filename: 'roads-ehime.js' }
  );
  if (!sandbox.RoadDecoder || !sandbox.ROADS_EHIME) throw new Error('roads sandbox ロード失敗');
  dec = new sandbox.RoadDecoder(sandbox.ROADS_EHIME);
  dec.buildOffsetTable();
  const mod = require(path.join(__dirname, '..', '..', 'js', 'pipeline-distance.js'));
  computeDistance = mod.computeDistance;
  DEFAULTS = mod.DEFAULTS;
}, 60000);

function splitTrips(s) {
  const trips = [];
  let cur = null;
  for (let i = 0; i < s.length; i++) {
    const b = s[i].biz || {};
    const it = b.it != null ? b.it : b.run;
    if (it === 1) {
      if (!cur) cur = { s: i, e: i };
      cur.e = i;
    } else if (cur) {
      trips.push(cur);
      cur = null;
    }
  }
  if (cur) trips.push(cur);
  return trips.filter((t) => t.e - t.s > 20);
}

function tripsOf(file) {
  let a;
  try {
    a = JSON.parse(fs.readFileSync(path.join(FIX, file), 'utf8'));
  } catch (_) {
    return null;
  }
  a = a.filter((x) => x && Number.isFinite(x.lat)).sort((x, y) => x.t - y.t);
  return { all: a, trips: splitTrips(a) };
}

// 各データセット: tire[i] は trip(i+1) のタイヤ値(null=参照なし)。
// fixture は slim 版 (lat/lng/t/acc/spd/biz のみ・accel等の生センサー配列を除いた軽量版)。
const CASES = [
  { f: '0606-Android.slim.json', tire: [null, 3.57, 3.39] },
  { f: '0606-iPhone13.slim.json', tire: [null, 3.57, 3.39] },
  { f: '0606-iPhoneSE.slim.json', tire: [null, 3.57, 3.39] },
  { f: 'realtest3-iPhoneSE.slim.json', tire: [1.5, 8.58, 9.59, 1.72] },
  { f: 'realtest3-Android.slim.json', tire: [1.5, 8.58, 9.59, 1.72] },
];

describe('過大ゼロ routing de-bias (実機fixture・愛媛)', () => {
  it('routingAcceptMaxRatio の既定は 2.5 (never-over guard 4.0 と分離)', () => {
    expect(DEFAULTS.routingAcceptMaxRatio).toBe(2.5);
    expect(DEFAULTS.routingMaxRatio).toBe(4.0);
  });

  it('★全業務で過大ゼロ(eng ≤ tire) かつ 過小なし(≥ -4%)', () => {
    const violations = [];
    for (const c of CASES) {
      const t = tripsOf(c.f);
      if (!t) {
        violations.push(c.f + ' READ ERR');
        continue;
      }
      t.trips.forEach((tr, i) => {
        const tv = c.tire[i];
        if (tv == null) return;
        const seg = t.all.slice(tr.s, tr.e + 1);
        const eng = computeDistance(seg, dec, { enableRouting: true }).distance_m / 1000;
        const pct = (eng / tv - 1) * 100;
        // 過大ゼロ: 課金距離はタイヤ値を超えない(+0.05% の浮動小数許容のみ)。
        if (pct > 0.05)
          violations.push(
            `${c.f} trip${i + 1} 過大 +${pct.toFixed(2)}% (eng=${eng.toFixed(3)} tire=${tv})`
          );
        // 過小なし(捨てすぎ防止): 国交省バンド -4% 内。
        if (pct < -4) violations.push(`${c.f} trip${i + 1} 過小 ${pct.toFixed(2)}% (捨てすぎ)`);
      });
    }
    if (violations.length) throw new Error('過大/過小 違反:\n  ' + violations.join('\n  '));
  }, 30000);

  it('routingAcceptMaxRatio=4.0(旧値)に戻すと過大が復活する (=本パラメータが効いている証明)', () => {
    // 旧値で iPhone13 trip2 が過大化することを確認(回帰の逆証明)。
    // ★smoothedRawMode 出荷 (2026-06-07)★: 本パラメータは snap-arc (OFF) 経路の routing 受理上限。
    //   ON では距離源が平滑弦になり flip 迂回が構造的に距離へ入らないため、この逆証明は
    //   ★OFF (fallback) 経路の契約★ として OFF を明示 pin して検証する (rollback 時の保証を維持)。
    const t = tripsOf('0606-iPhone13.slim.json');
    const tr = t.trips[1]; // trip2 (tire 3.57)
    const seg = t.all.slice(tr.s, tr.e + 1);
    const engOld =
      computeDistance(seg, dec, {
        enableRouting: true,
        routingAcceptMaxRatio: 4.0,
        smoothedRawMode: false,
        adaptiveMode: false, // ★rollback経路の routing 受理上限契約を検証(adaptive は snap=null で routing 不通過)★
      }).distance_m / 1000;
    const engNew =
      computeDistance(seg, dec, {
        enableRouting: true,
        smoothedRawMode: false,
        adaptiveMode: false,
      }).distance_m / 1000;
    expect(engOld / 3.57 - 1).toBeGreaterThan(0.01); // 旧値は +1% 超の過大
    expect(engNew).toBeLessThanOrEqual(3.57 * 1.0005); // 新値は過大ゼロ
    expect(engNew).toBeLessThan(engOld); // 新値の方が小さい(過大を削った)
  }, 30000);
});
