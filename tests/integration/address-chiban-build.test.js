// tests/integration/address-chiban-build.test.js
//
// ★設計変更宣言 (= 住所 STEP2 commit3・地番=ABR 地番マスター build verify):
//   build-address.js の・--chiban モードを・本物 ABR CSV 形式 fixture
//   (= UTF-8 + 実カラム名 header + 3 キー JOIN + rep_lon/lat 値 swap + rsdt_addr_flg=0/1 混在)
//   で・regression 防止。司さん指示「decimal mock 禁止」「本物データ形式 fixture」準拠。
//
// 検証内容:
//   1. 3 キー JOIN (lg_code + machiaza_id + prc_id) ロジック
//   2. rep_lon / rep_lat 値 swap auto-detect (= 配布側 既知バグ・Japan 数値範囲で・判定)
//   3. 座標欠落 skip (= pos に・対応行が無い body は・skipNoPos)
//   4. rsdt_addr_flg=0/1 混在許容 (= filter しない・両方を points に・含める)
//   5. POI v2 形式 ({v:2, prefecture, oazas, grid, points} + k(主地番) + g(枝番))
//   6. 座標 int×1e5 + bbox + grid (= street / rsdt と完全同形式)
//   7. 大字 dict 圧縮 (= 同 city+ward+oaza_cho+chome+koaza は 1 entry)
//   8. prc_num2 枝番 → 'k-g' / prc_num3 → 'g=p2-p3' / prc_num2 空 → g省略 (= k のみ)
//   9. 不正データ skip (= city 空 / prc_num1 空 / 緯度経度 範囲外)
//  10. CSV 列順変更耐性 (= header 名で・動的解決)
//  11. UTF-8 BOM 耐性
//  12. 実 ehime data (= data/addresses-chiban-ehime.js) load + 司さん GPS hit verify (= build 後・skip 可)
//
// 絶対ルール準拠: 距離 / 課金 / Worker B / map-matcher 完全無関係・住所表示専用。

'use strict';

const fs = require('fs');
const path = require('path');
const { buildChibanFromCsv, detectJapanLatLng } = require(
  path.join(__dirname, '..', '..', 'scripts', 'build-address.js')
);

// ─── 本物 ABR 地番 CSV 形式 fixture helper ───────────────────────
// 本体 (mt_parcel_city{LG6}.csv) の・実カラム名 header
function makeChibanBodyCsv(rows) {
  const headers = [
    'lg_code',
    'machiaza_id',
    'prc_id',
    'city',
    'ward',
    'oaza_cho',
    'chome',
    'koaza',
    'machiaza_dist',
    'prc_num1',
    'prc_num2',
    'prc_num3',
    'rsdt_addr_flg',
  ];
  const def = (v, d) => (v === undefined ? d : v);
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      [
        def(r.lg_code, '382027'),
        def(r.machiaza_id, '0185001'),
        def(r.prc_id, '000010000100000'),
        def(r.city, '今治市'),
        def(r.ward, ''),
        def(r.oaza_cho, '松本町'),
        def(r.chome, '１丁目'),
        def(r.koaza, ''),
        def(r.machiaza_dist, ''),
        def(r.prc_num1, '6'),
        def(r.prc_num2, ''),
        def(r.prc_num3, ''),
        def(r.rsdt_addr_flg, '0'),
      ].join(',')
    );
  }
  return lines.join('\n');
}

// 座標 (mt_parcel_pos_city{LG6}.csv) の・実カラム名 header
// ★実 配布 では・rep_lon カラムに・lat 値 / rep_lat カラムに・lon 値 が入る swap バグあり
function makeChibanPosCsv(rows) {
  const headers = [
    'lg_code',
    'machiaza_id',
    'prc_id',
    'rep_lon',
    'rep_lat',
    'rep_srid',
    'rep_scale',
  ];
  const def = (v, d) => (v === undefined ? d : v);
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      [
        def(r.lg_code, '382027'),
        def(r.machiaza_id, '0185001'),
        def(r.prc_id, '000010000100000'),
        r.rep_lon, // 配布 swap 時は・ここに lat 値 (例 34.064833)
        r.rep_lat, // 配布 swap 時は・ここに lon 値 (例 133.001439)
        'EPSG:6668',
        '2500',
      ].join(',')
    );
  }
  return lines.join('\n');
}

// ─── 0. detectJapanLatLng unit test (= swap auto-detect の・核心ロジック) ─
describe('detectJapanLatLng: Japan 数値範囲で・lat/lng を・auto-detect', () => {
  it('normal (rep_lon=132, rep_lat=34) → swapped=false / lat=34, lng=132', () => {
    const r = detectJapanLatLng('132.96', '34.06');
    expect(r).not.toBeNull();
    expect(r.swapped).toBe(false);
    expect(r.lat).toBeCloseTo(34.06, 2);
    expect(r.lng).toBeCloseTo(132.96, 2);
  });
  it('swapped (rep_lon=34, rep_lat=132) → swapped=true / lat=34, lng=132', () => {
    const r = detectJapanLatLng('34.06', '132.96');
    expect(r).not.toBeNull();
    expect(r.swapped).toBe(true);
    expect(r.lat).toBeCloseTo(34.06, 2);
    expect(r.lng).toBeCloseTo(132.96, 2);
  });
  it('range 外 → null', () => {
    expect(detectJapanLatLng('1.0', '2.0')).toBeNull();
    expect(detectJapanLatLng('200.0', '34.06')).toBeNull();
  });
  it('NaN / 空 → null', () => {
    expect(detectJapanLatLng('abc', '34.06')).toBeNull();
    expect(detectJapanLatLng('', '34.06')).toBeNull();
    expect(detectJapanLatLng('34.06', '')).toBeNull();
  });
});

// ─── 1. 3 キー JOIN ──────────────────────────────────────────────
describe('build-address.js --chiban: 3 キー JOIN', () => {
  it('3 キー (lg_code+machiaza_id+prc_id) 一致 → JOIN', () => {
    const body = makeChibanBodyCsv([
      {
        lg_code: '382027',
        machiaza_id: '0185001',
        prc_id: '000010000100000',
        prc_num1: '6',
      },
    ]);
    // pos は・実配布通り swap (rep_lon カラムに・lat 値)
    const pos = makeChibanPosCsv([
      {
        lg_code: '382027',
        machiaza_id: '0185001',
        prc_id: '000010000100000',
        rep_lon: '34.064833',
        rep_lat: '133.001439',
      },
    ]);
    const b = buildChibanFromCsv(body, pos, 'ehime');
    expect(b.points.length).toBe(1);
    expect(b.points[0].lat).toBe(3406483);
    expect(b.points[0].lng).toBe(13300144);
  });

  it('座標 pos に対応行が無い body → skipNoPos', () => {
    const body = makeChibanBodyCsv([{ prc_id: '000010000100000' }, { prc_id: '000010000200000' }]);
    const pos = makeChibanPosCsv([
      { prc_id: '000010000100000', rep_lon: '34.064833', rep_lat: '133.001439' },
      // prc_id=200000 は pos に無い
    ]);
    const b = buildChibanFromCsv(body, pos, 'ehime');
    expect(b.points.length).toBe(1);
  });

  it('prc_id が異なれば・別 entry', () => {
    const body = makeChibanBodyCsv([{ prc_id: '000010000100000' }, { prc_id: '000010000200000' }]);
    const pos = makeChibanPosCsv([
      { prc_id: '000010000100000', rep_lon: '34.064833', rep_lat: '133.001439' },
      { prc_id: '000010000200000', rep_lon: '34.064900', rep_lat: '133.001500' },
    ]);
    const b = buildChibanFromCsv(body, pos, 'ehime');
    expect(b.points.length).toBe(2);
  });
});

// ─── 2. rep_lon / rep_lat 値 swap auto-detect ─────────────────
describe('build-address.js --chiban: rep_lon/rep_lat 値 swap auto-detect', () => {
  it('swap 配布 (rep_lon=lat値) でも・lat/lng は・正しい意味に・補正される', () => {
    const body = makeChibanBodyCsv([{ prc_id: '000010000100000', prc_num1: '6' }]);
    const pos = makeChibanPosCsv([
      {
        prc_id: '000010000100000',
        rep_lon: '34.064833', // 配布 swap = lat 値
        rep_lat: '133.001439', // 配布 swap = lon 値
      },
    ]);
    const b = buildChibanFromCsv(body, pos, 'ehime');
    expect(b.points[0].lat).toBe(3406483); // 34.064833 → 3406483
    expect(b.points[0].lng).toBe(13300144); // 133.001439 → 13300144
  });

  it('normal 配布 (rep_lon=lon値) でも・正しく解釈', () => {
    const body = makeChibanBodyCsv([{ prc_id: '000010000100000' }]);
    const pos = makeChibanPosCsv([
      {
        prc_id: '000010000100000',
        rep_lon: '133.001439', // normal = lon 値
        rep_lat: '34.064833', // normal = lat 値
      },
    ]);
    const b = buildChibanFromCsv(body, pos, 'ehime');
    expect(b.points[0].lat).toBe(3406483);
    expect(b.points[0].lng).toBe(13300144);
  });

  it('範囲外座標 → skip (= posOutOfRange に・カウント・point にならない)', () => {
    const body = makeChibanBodyCsv([{ prc_id: '000010000100000' }]);
    const pos = makeChibanPosCsv([
      {
        prc_id: '000010000100000',
        rep_lon: '999.0',
        rep_lat: '999.0',
      },
    ]);
    const b = buildChibanFromCsv(body, pos, 'ehime');
    expect(b.points.length).toBe(0);
    expect(b._stats.posOutOfRange).toBe(1);
  });
});

// ─── 3. rsdt_addr_flg=0/1 混在許容 ────────────────────────────
describe('build-address.js --chiban: rsdt_addr_flg=0/1 混在許容', () => {
  it('flg=0 (= 地番地区) も・flg=1 (= 住居表示地区) も・両方 points に含む', () => {
    const body = makeChibanBodyCsv([
      { prc_id: '000010000100000', prc_num1: '1', rsdt_addr_flg: '0' },
      { prc_id: '000010000200000', prc_num1: '2', rsdt_addr_flg: '1' },
      { prc_id: '000010000300000', prc_num1: '3', rsdt_addr_flg: '0' },
    ]);
    const pos = makeChibanPosCsv([
      { prc_id: '000010000100000', rep_lon: '34.06', rep_lat: '133.00' },
      { prc_id: '000010000200000', rep_lon: '34.07', rep_lat: '133.01' },
      { prc_id: '000010000300000', rep_lon: '34.08', rep_lat: '133.02' },
    ]);
    const b = buildChibanFromCsv(body, pos, 'ehime');
    expect(b.points.length).toBe(3);
    expect(b._stats.countByFlg[0]).toBe(2);
    expect(b._stats.countByFlg[1]).toBe(1);
  });
});

// ─── 4. POI v2 構造 + k(主地番) + g(枝番) ─────────────────────
describe('build-address.js --chiban: POI v2 構造 + k/g', () => {
  it('output は・{v:2, prefecture, generated, precision, bbox, gridSize, oazas, grid, points}', () => {
    const body = makeChibanBodyCsv([{ prc_id: '000010000100000', prc_num1: '6', prc_num2: '33' }]);
    const pos = makeChibanPosCsv([
      { prc_id: '000010000100000', rep_lon: '34.064833', rep_lat: '133.001439' },
    ]);
    const b = buildChibanFromCsv(body, pos, 'ehime');
    expect(b.v).toBe(2);
    expect(b.prefecture).toBe('ehime');
    expect(typeof b.generated).toBe('string');
    expect(b.precision).toBe(100000);
    expect(typeof b.gridSize).toBe('number');
    expect(typeof b.oazas).toBe('object');
    expect(typeof b.grid).toBe('object');
    expect(Array.isArray(b.points)).toBe(true);
  });

  it('点 は・k=prc_num1 (= 主地番) を必須・g=prc_num2 (= 枝番) は・任意', () => {
    const body = makeChibanBodyCsv([
      { prc_id: '000010000100000', prc_num1: '6', prc_num2: '33' },
      { prc_id: '000010000200000', prc_num1: '7', prc_num2: '' },
    ]);
    const pos = makeChibanPosCsv([
      { prc_id: '000010000100000', rep_lon: '34.06', rep_lat: '133.00' },
      { prc_id: '000010000200000', rep_lon: '34.07', rep_lat: '133.01' },
    ]);
    const b = buildChibanFromCsv(body, pos, 'ehime');
    expect(b.points[0].k).toBe('6');
    expect(b.points[0].g).toBe('33');
    expect(b.points[1].k).toBe('7');
    expect(b.points[1].g).toBeUndefined(); // g 省略
  });

  it('prc_num3 (= 枝番2) があれば・g = "枝1-枝2"', () => {
    const body = makeChibanBodyCsv([
      { prc_id: '000010000100000', prc_num1: '6', prc_num2: '33', prc_num3: '1' },
    ]);
    const pos = makeChibanPosCsv([
      { prc_id: '000010000100000', rep_lon: '34.06', rep_lat: '133.00' },
    ]);
    const b = buildChibanFromCsv(body, pos, 'ehime');
    expect(b.points[0].g).toBe('33-1');
  });
});

// ─── 5. 座標 int×1e5 + bbox + grid ──────────────────────────
describe('build-address.js --chiban: 座標 int×1e5 + bbox + grid', () => {
  it('lat/lng は・int × 1e5 (= 既存 POI / street / rsdt と完全統一)', () => {
    const body = makeChibanBodyCsv([{ prc_id: '000010000100000' }]);
    const pos = makeChibanPosCsv([
      { prc_id: '000010000100000', rep_lon: '34.064833', rep_lat: '133.001439' },
    ]);
    const b = buildChibanFromCsv(body, pos, 'ehime');
    expect(b.points[0].lat).toBe(3406483);
    expect(b.points[0].lng).toBe(13300144);
  });

  it('bbox = [minLat, minLng, maxLat, maxLng] integer', () => {
    const body = makeChibanBodyCsv([{ prc_id: '000010000100000' }, { prc_id: '000010000200000' }]);
    const pos = makeChibanPosCsv([
      { prc_id: '000010000100000', rep_lon: '34.064833', rep_lat: '133.001439' },
      { prc_id: '000010000200000', rep_lon: '34.064500', rep_lat: '133.001000' },
    ]);
    const b = buildChibanFromCsv(body, pos, 'ehime');
    expect(b.bbox[0]).toBe(3406450);
    expect(b.bbox[1]).toBe(13300100);
    expect(b.bbox[2]).toBe(3406483);
    expect(b.bbox[3]).toBe(13300144);
  });

  it('grid 索引 = encoding-utils.gridKey に・point index 登録', () => {
    const body = makeChibanBodyCsv([{ prc_id: '000010000100000' }]);
    const pos = makeChibanPosCsv([
      { prc_id: '000010000100000', rep_lon: '34.064833', rep_lat: '133.001439' },
    ]);
    const b = buildChibanFromCsv(body, pos, 'ehime');
    const keys = Object.keys(b.grid);
    expect(keys.length).toBe(1);
    expect(b.grid[keys[0]]).toEqual([0]);
  });
});

// ─── 6. 大字 dict 圧縮 ─────────────────────────────────────────
describe('build-address.js --chiban: 大字 dict 圧縮', () => {
  it('同 city+ward+oaza_cho+chome+koaza → 1 entry・c は・同 idx', () => {
    const body = makeChibanBodyCsv([
      {
        prc_id: '000010000100000',
        city: '今治市',
        oaza_cho: '松本町',
        chome: '１丁目',
        prc_num1: '6',
      },
      {
        prc_id: '000010000200000',
        city: '今治市',
        oaza_cho: '松本町',
        chome: '１丁目',
        prc_num1: '7',
      },
      {
        prc_id: '000010000300000',
        city: '今治市',
        oaza_cho: '末広町',
        chome: '１丁目',
        prc_num1: '1',
      },
    ]);
    const pos = makeChibanPosCsv([
      { prc_id: '000010000100000', rep_lon: '34.06', rep_lat: '133.00' },
      { prc_id: '000010000200000', rep_lon: '34.07', rep_lat: '133.01' },
      { prc_id: '000010000300000', rep_lon: '34.08', rep_lat: '133.02' },
    ]);
    const b = buildChibanFromCsv(body, pos, 'ehime');
    expect(Object.keys(b.oazas).length).toBe(2);
    expect(b.points[0].c).toBe(b.points[1].c);
    expect(b.points[0].c).not.toBe(b.points[2].c);
    expect(b.oazas[b.points[0].c]).toBe('今治市松本町１丁目');
  });
});

// ─── 7. 不正データ skip ────────────────────────────────────────
describe('build-address.js --chiban: 不正データ skip', () => {
  it('city が空 → skipInvalid', () => {
    const body = makeChibanBodyCsv([{ prc_id: '000010000100000', city: '' }]);
    const pos = makeChibanPosCsv([
      { prc_id: '000010000100000', rep_lon: '34.06', rep_lat: '133.00' },
    ]);
    const b = buildChibanFromCsv(body, pos, 'ehime');
    expect(b.points.length).toBe(0);
    expect(b._stats.skippedInvalid).toBe(1);
  });

  it('prc_num1 (= 主地番) が空 → skipInvalid', () => {
    const body = makeChibanBodyCsv([{ prc_id: '000010000100000', prc_num1: '' }]);
    const pos = makeChibanPosCsv([
      { prc_id: '000010000100000', rep_lon: '34.06', rep_lat: '133.00' },
    ]);
    const b = buildChibanFromCsv(body, pos, 'ehime');
    expect(b.points.length).toBe(0);
  });

  it('座標 NaN → posWithCoord に・含まれない', () => {
    const body = makeChibanBodyCsv([{ prc_id: '000010000100000' }]);
    const pos = makeChibanPosCsv([{ prc_id: '000010000100000', rep_lon: 'abc', rep_lat: 'xyz' }]);
    const b = buildChibanFromCsv(body, pos, 'ehime');
    expect(b.points.length).toBe(0);
    expect(b._stats.skippedNoPos).toBe(1);
  });
});

// ─── 8. CSV 列順変更耐性 ──────────────────────────────────────
describe('build-address.js --chiban: CSV 列順変更耐性', () => {
  it('body の・列順を入れ替えても・正しく抽出', () => {
    const body =
      'rsdt_addr_flg,prc_num3,prc_num2,prc_num1,koaza,chome,oaza_cho,city,prc_id,machiaza_id,lg_code\n' +
      '0,,33,6,,１丁目,松本町,今治市,000010000100000,0185001,382027';
    const pos = makeChibanPosCsv([
      { prc_id: '000010000100000', rep_lon: '34.06', rep_lat: '133.00' },
    ]);
    const b = buildChibanFromCsv(body, pos, 'ehime');
    expect(b.points.length).toBe(1);
    expect(b.points[0].k).toBe('6');
    expect(b.points[0].g).toBe('33');
    expect(b.oazas[0]).toBe('今治市松本町１丁目');
  });

  it('必須 3 キー (machiaza_id) が・無ければ・throw', () => {
    const body =
      'lg_code,prc_id,city,oaza_cho,prc_num1\n' + '382027,000010000100000,今治市,松本町,6';
    const pos = makeChibanPosCsv([
      { prc_id: '000010000100000', rep_lon: '34.06', rep_lat: '133.00' },
    ]);
    expect(() => buildChibanFromCsv(body, pos, 'ehime')).toThrow(/machiaza_id/);
  });

  it('pos に・rep_lat 列 が・無ければ・throw', () => {
    const body = makeChibanBodyCsv([{ prc_id: '000010000100000' }]);
    const pos = 'lg_code,machiaza_id,prc_id,rep_lon\n' + '382027,0185001,000010000100000,34.06';
    expect(() => buildChibanFromCsv(body, pos, 'ehime')).toThrow(/rep_lat/);
  });
});

// ─── 9. UTF-8 BOM 耐性 ────────────────────────────────────────
describe('build-address.js --chiban: UTF-8 BOM 耐性', () => {
  it('先頭 BOM があっても・header 解釈 OK', () => {
    const body = '﻿' + makeChibanBodyCsv([{ prc_id: '000010000100000' }]);
    const pos =
      '﻿' + makeChibanPosCsv([{ prc_id: '000010000100000', rep_lon: '34.06', rep_lat: '133.00' }]);
    const b = buildChibanFromCsv(body, pos, 'ehime');
    expect(b.points.length).toBe(1);
  });
});

// ─── 10. ★ 実 ehime data 司さん GPS hit verify (build 後・skip 可) ──
describe('build-address.js --chiban: 実 ehime data 司さん GPS hit verify', () => {
  const REAL_PATH = path.join(__dirname, '..', '..', 'data', 'addresses-chiban-ehime.js');

  // 実 ehime data (= 164 MB JS) は・load + 271 万点 sweep に・~7 秒 → vitest default 5 秒で timeout
  // 60 秒 まで・拡張 (= 既存 rsdt verify と同様・実機 verify テスト)
  it('生成済 data/addresses-chiban-ehime.js は・load 可能 + 全構造一致', { timeout: 60000 }, () => {
    if (!fs.existsSync(REAL_PATH)) {
      console.warn('data/addresses-chiban-ehime.js 未生成・skip (= build 未実行)');
      return;
    }
    const win = {};
    new Function('window', fs.readFileSync(REAL_PATH, 'utf8'))(win);
    const b = win.ADDRESSES_CHIBAN_EHIME;
    expect(b.v).toBe(2);
    expect(b.prefecture).toBe('ehime');
    expect(b.precision).toBe(100000);
    expect(b.points.length).toBeGreaterThan(100000);
    expect(Object.keys(b.oazas).length).toBeGreaterThan(1000);
    expect(Object.keys(b.grid).length).toBeGreaterThan(100);
    // 全点が k を持つ (= g は任意)
    for (let i = 0; i < Math.min(100, b.points.length); i++) {
      expect(typeof b.points[i].k).toBe('string');
    }
  });

  it(
    '★ 司さん GPS (34.06467, 133.0015) → 「今治市松本町１丁目 6-33番地」が・5m 以内で hit',
    { timeout: 60000 },
    () => {
      if (!fs.existsSync(REAL_PATH)) {
        console.warn('data/addresses-chiban-ehime.js 未生成・skip');
        return;
      }
      const win = {};
      new Function('window', fs.readFileSync(REAL_PATH, 'utf8'))(win);
      const b = win.ADDRESSES_CHIBAN_EHIME;
      function hav(lat1, lng1, lat2, lng2) {
        const R = 6371000;
        const T = Math.PI / 180;
        const dLat = (lat2 - lat1) * T;
        const dLng = (lng2 - lng1) * T;
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(lat1 * T) * Math.cos(lat2 * T) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }
      let best = null;
      let bestD = Infinity;
      for (const p of b.points) {
        const d = hav(34.06467, 133.0015, p.lat / 100000, p.lng / 100000);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      expect(bestD).toBeLessThan(5);
      expect(b.oazas[best.c]).toBe('今治市松本町１丁目');
      expect(best.k).toBe('6');
      expect(best.g).toBe('33');
    }
  );
});
