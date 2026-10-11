'use strict';
// ============================================================
// ★事務所で 最低料金を 空に したら 下限 無し★ 2026-10-11（司さん「外したら外すやろが」）
//   事務所（ryokinhyou.html）で 空に すると 倉庫の 料金表から 鍵ごと 消える。
//   端末は 古い 写しを 先に 当て、倉庫の 料金表を 重ねる（meter.js の {...fareConfig, ...config}）ので、
//   前は 古い 写しの 最低料金が 上書きされずに 残っていた。最高料金も 同じ形。
// ============================================================
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const S = require(path.join(ROOT, 'js', 'fare-config-store.js'));
const M = require(path.join(ROOT, 'js', 'meter.js'));

const KIHON = {
  base_fare: 1300,
  base_distance_m: 1000,
  add_fare: 100,
  add_distance_m: 420,
  rounding: 1,
  tiers: [],
};

describe('★最低料金・最高料金を 空に したら 無し（10-11 司さん）★', () => {
  it('空に した 料金表は「無し」（null）を 持つ', () => {
    const t = S.totonoeru({ ...KIHON });
    expect(t.minFare).toBe(null);
    expect(t.maxFare).toBe(null);
  });

  it('古い 写しの 最低料金の 上に 空に した 料金表を 重ねると、下限 無しで 計算する', () => {
    M.setFareConfig(S.totonoeru({ ...KIHON, minFare: 5000 }));
    expect(M.calcFare(500)).toBe(5000);
    M.setFareConfig(S.totonoeru({ ...KIHON }));
    expect(M.calcFare(500)).toBe(1300);
  });

  it('古い 写しの 最高料金の 上に 空に した 料金表を 重ねると、上限 無しで 計算する', () => {
    M.setFareConfig(S.totonoeru({ ...KIHON, maxFare: 2000 }));
    expect(M.calcFare(30000)).toBe(2000);
    M.setFareConfig(S.totonoeru({ ...KIHON }));
    expect(M.calcFare(30000)).toBeGreaterThan(2000);
  });

  it('在る 最低料金・最高料金は 書き換えない', () => {
    const t = S.totonoeru({ ...KIHON, minFare: 2000, maxFare: 9000 });
    expect(t.minFare).toBe(2000);
    expect(t.maxFare).toBe(9000);
  });
});
