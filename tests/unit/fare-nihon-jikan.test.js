'use strict';
// ============================================================
// ★★料金の 自動割増は 日本時間で 判じる（日本の 外の 端末でも）★★ 2026-10-08
//   司さん「揃えろ（ただしおれらのような夜から始まって日を跨ぐことも考慮しろ」
//
//   ・深夜（night）… その 瞬間の 日本時間の 時
//   ・土日（weekend）・冬（winter）… ★業務を 始めた 日（日本時間）★＝給料・売上と 同じ 日の 切り方
//     金曜の 夜に 始めて 土曜 1時に 走る ⇒ 金曜の 業務＝土日の 割増なし
//     日曜の 夜に 始めて 月曜 1時に 走る ⇒ 日曜の 業務＝土日の 割増あり
//
//   ★この 試験だけ わざと ロサンゼルスの 時間帯で 走らせる★（日本の 端末では 前と 同じ 答えに なるので 守れない）
//
//   ★わざと壊して 赤（2026-10-08 実測）★
//     ①fare-calc.js の 深夜を now.getHours() に 戻す ⇒ 赤
//     ②土日を 業務の 始めでなく その 瞬間（ima.dow）に する ⇒ 赤
//     ③meter.js の _gyomuHajime() を 渡さない ⇒ 赤
// ============================================================
const path = require('path');
/* global vi */ // vitest の globals（vitest.config.js globals: true）

const FC_PATH = path.join(__dirname, '..', '..', 'js', 'fare-calc.js');
const METER_PATH = path.join(__dirname, '..', '..', 'js', 'meter.js');

function yomu(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}

const HYOU = {
  base_fare: 1000,
  base_distance_m: 1000,
  add_fare: 100,
  add_distance_m: 500,
  rounding_unit: 1,
  autoSurcharges: {
    night: { enabled: true, from: 22, to: 5, rate: 1.2 },
    weekend: { enabled: true, rate: 1.1 },
    winter: { enabled: true, from: '12-15', to: '03-15', rate: 1.1 },
  },
};

// 日本時間の 字から 瞬間を 作る
const J = (s) => new Date(s + '+09:00');

let motoTZ;
beforeAll(() => {
  motoTZ = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
});
afterAll(() => {
  if (motoTZ === undefined) delete process.env.TZ;
  else process.env.TZ = motoTZ;
});

describe('★自動割増は 日本時間・土日／冬は 業務を 始めた 日★（ロサンゼルスの 端末）', () => {
  it('★① 端末は 本当に 日本の 外（空回りしていない）★', () => {
    // 日本時間 2026-10-09 23:30 は ロサンゼルスでは 朝 7時台
    expect(J('2026-10-09T23:30:00').getHours()).toBe(7);
  });

  const KESU = [
    // [名前, 走った 瞬間（日本時間）, 業務の 始め（日本時間 or null）, 掛け率]
    ['金曜 23:30（業務の 始め 無し）＝深夜だけ', '2026-10-09T23:30:00', null, 1.2],
    [
      '金曜 21:00 に 始めて 土曜 01:00 ＝深夜だけ（金曜の 業務）',
      '2026-10-10T01:00:00',
      '2026-10-09T21:00:00',
      1.2,
    ],
    ['土曜 01:00（業務の 始め 無し）＝深夜＋土日', '2026-10-10T01:00:00', null, 1.32],
    [
      '日曜 21:00 に 始めて 月曜 01:00 ＝深夜＋土日（日曜の 業務）',
      '2026-10-12T01:00:00',
      '2026-10-11T21:00:00',
      1.32,
    ],
    ['水曜 12:00 ＝割増なし', '2026-10-14T12:00:00', '2026-10-14T11:00:00', 1.0],
    [
      '12/14 21:00 に 始めて 12/15 00:30 ＝深夜だけ（冬は 12/15 から）',
      '2026-12-15T00:30:00',
      '2026-12-14T21:00:00',
      1.2,
    ],
    [
      '3/15 21:00 に 始めて 3/16 01:00 ＝深夜＋冬（3/15 の 業務）',
      '2027-03-16T01:00:00',
      '2027-03-15T21:00:00',
      1.32,
    ],
    ['1/1 05:00（深夜の 終わり）＝冬だけ', '2026-01-01T05:00:00', '2025-12-31T20:00:00', 1.1],
  ];

  for (const [na, hashitta, hajime, kake] of KESU) {
    it('★' + na + '★', () => {
      const FC = yomu(FC_PATH);
      const m = FC._autoMul(HYOU, J(hashitta), hajime ? J(hajime).getTime() : null);
      expect(m).toBeCloseTo(kake, 10);
    });
  }

  it('★★② メーターの 道（calcFare）も 業務を 始めた 日で 判じる★★', () => {
    vi.useFakeTimers();
    try {
      // 金曜 21:00 に 始めた 業務・土曜 01:00 に 走る
      vi.setSystemTime(J('2026-10-10T01:00:00'));
      global.Business = {
        getState: () => ({ active: true, start_time: J('2026-10-09T21:00:00').getTime() }),
      };
      const M = yomu(METER_PATH);
      M.setFareConfig(JSON.parse(JSON.stringify(HYOU)));
      const kinyo = M.calcFare(1000);
      // 業務が 無い（終わった）時は その 瞬間の 日＝土曜
      global.Business = {
        getState: () => ({ active: false, start_time: J('2026-10-09T21:00:00').getTime() }),
      };
      const doyo = M.calcFare(1000);
      // eslint-disable-next-line no-console
      console.log('★メーター★ 金曜の 業務=' + kinyo + '円 / 業務 無し(土曜)=' + doyo + '円');
      expect(kinyo, '★金曜に 始めた 業務に 土日の 割増が 掛かった★').toBe(1200);
      expect(doyo, '★土曜の 深夜に 土日の 割増が 掛からない★').toBe(1320);
    } finally {
      delete global.Business;
      vi.useRealTimers();
    }
  });
});
