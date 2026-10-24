// ============================================================
// ★★月次集計の 紙の「車ごと」は 端末ごと・名前は 売上表と 同じ★★ 2026-10-23 件G
//
//   前：kamiCarsOf（shukei.html）は 名前で まとめた
//     ＝同じ 名前の 2台が 1行に 足された／名前の 無い 車は 端末の ID（UUID）が そのまま 紙に 出た
//   今：端末ごとに 1行。名前は CarName.nameMap（売上表と 同じ・名前が 無ければ「車1」等）
//
//   ★わざと壊して 赤（2026-10-23 実測）★ 直す 前の kamiCarsOf ⇒ ★赤 2 / 緑 1★（額の 試験は 前も 緑）・直した 後 ⇒ 緑 3 / 3
// ============================================================
const fs = require('fs');
const path = require('path');
const CarName = require('../../js/car-name.js');

const SHU = fs.readFileSync(path.join(__dirname, '..', '..', 'shukei.html'), 'utf8');
function kiridasu(name) {
  const a = SHU.indexOf('function ' + name + '(');
  if (a < 0) throw new Error(name + ' が 無い');
  // 次の 関数の 頭まで（同じ 字下げの "        function "）
  const b = SHU.indexOf('\n        function ', a + 10);
  const c = SHU.indexOf('\n        // ', a + 10);
  const owari = [b, c].filter((x) => x > 0).reduce((x, y) => Math.min(x, y));
  return SHU.slice(a, owari);
}

const UUID1 = '0f8fad5b-d9cb-469f-a165-70867728950e';
const UUID2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const UUID3 = '9b2e6a1c-3f4d-4e5a-8b7c-1d2e3f4a5b6c';
const CTX = {
  byDate: {
    '2026-09-01': {
      [UUID1]: { device_id: UUID1, sales: 10000, expense: 500 },
      [UUID2]: { device_id: UUID2, sales: 20000, expense: 0 },
      [UUID3]: { device_id: UUID3, sales: 7000, expense: 100 },
    },
    '2026-09-02': {
      [UUID1]: { device_id: UUID1, sales: 3000, expense: 0 },
    },
    '2026-10-01': {
      [UUID2]: { device_id: UUID2, sales: 99999, expense: 0 },
    },
  },
  labels: {},
};
const RAW = {
  labels: [
    // ★同じ 名前の 2台★
    { device_id: UUID1, label: '1号車', sort_order: 1 },
    { device_id: UUID2, label: '1号車', sort_order: 2 },
    // UUID3 は 名前 無し
  ],
};

// ★その 月の 日は 会社の 締めの 期間で 決める★ 2026-10-24（kHi・tsukiNoHi も 切り出す・末日の 会社＝暦の 月）
const KaishaKikan = require('../../js/payroll-period.js').KaishaKikan;
const kamiCarsOf = new Function(
  'CTX',
  'RAW',
  'YEAR',
  'CarName',
  'window',
  'KaishaKikan',
  'KAISHA',
  [
    kiridasu('kHi'),
    kiridasu('tsukiNoHi'),
    kiridasu('uriHibi'),
    kiridasu('uriKuruma'),
    kiridasu('kamiCarsOf'),
    'return kamiCarsOf;',
  ].join('\n')
)(CTX, RAW, 2026, CarName, { CarName }, KaishaKikan, { ok: true, hi: null });

describe('★月次の 紙の 車ごと★', () => {
  const rows = kamiCarsOf(9);
  it('端末ごとに 1行（同じ 名前の 2台は 別の 行）', () => {
    expect(rows.length).toBe(3);
    expect(rows.filter((r) => r.name === '1号車').length).toBe(2);
  });
  it('額は 端末ごと（売上＝メーター − 実費・その 月だけ）', () => {
    const uri = rows.map((r) => r.uriage).sort((a, b) => a - b);
    expect(uri).toEqual([6900, 12500, 20000]);
    expect(rows.reduce((a, r) => a + r.jippi, 0)).toBe(600);
  });
  it('名前は 売上表と 同じ（CarName.nameMap・名前が 無ければ 車1）・UUID が 出ない', () => {
    const nm = CarName.nameMap([UUID1, UUID2, UUID3].sort(), RAW.labels);
    rows.forEach((r) => {
      expect(CarName.hasUuid(r.name), r.name).toBe(false);
    });
    expect(rows.map((r) => r.name).sort()).toEqual([nm[UUID1], nm[UUID2], nm[UUID3]].sort());
    expect(rows.map((r) => r.name)).toContain('車1');
  });
});
