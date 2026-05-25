// tests/integration/address-rsdt-build.test.js
//
// ★設計変更宣言 (= 住所 STEP2 commit2・号=ABR 住居マスター build verify):
//   build-address.js の・--rsdt モードを・本物 ABR CSV 形式 fixture
//   (= UTF-8 + 実カラム名 header + 5 キー JOIN + rsdt_addr_flg=1/0 両方) で・regression 防止。
//   司さん指示「decimal mock 禁止」「本物データ形式 fixture」準拠。
//
// 検証内容:
//   1. 5 キー JOIN (lg_code+town_id+blk_id+addr_id+addr2_id) ロジック
//   2. rsdt_addr_flg=1 のみ抽出 (flg=0 は・skip)
//   3. POI v2 形式 ({v:2, prefecture, oazas, grid, points} + k(番) + g(号))
//   4. 座標 int×1e5 + bbox + grid 索引 (= street と完全同形式)
//   5. 大字 dict 圧縮 (= 同 city+oaza_cho+chome+koaza は 1 entry)
//   6. rsdt_num2 枝号 → 'k-g' or 'k' (= rsdt_num のみ) フォーマット
//   7. 座標欠落 (= pos に対応行なし) / 緯度経度 NaN は・skip
//   8. CSV 列順変更耐性 (= header 名で・動的解決)
//   9. ★ 実 ehime data (= data/addresses-rsdt-ehime.js) を・load 可能 (build 後・skip 可)
//
// 絶対ルール準拠: 距離 / 課金 / Worker B / map-matcher 完全無関係・住所表示専用。

'use strict';

const fs = require('fs');
const path = require('path');
const { buildRsdtFromCsv } = require(
  path.join(__dirname, '..', '..', 'scripts', 'build-address.js')
);

// ─── 本物 ABR CSV 形式 fixture helper ────────────────────────────
// 本体 (mt_rsdtdsp_rsdt) の・実カラム名 を・先頭行 header に並べる
function makeBodyCsv(rows) {
  const headers = [
    'lg_code',
    'town_id',
    'blk_id',
    'addr_id',
    'addr2_id',
    'city_name',
    'oaza_cho_name',
    'chome_name',
    'koaza_name',
    'blk_num',
    'rsdt_num',
    'rsdt_num2',
    'rsdt_addr_flg',
  ];
  // 空文字 '' を・default に置換しない (= '' は・「明示的に空」を意味する)
  const def = (v, d) => (v === undefined ? d : v);
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      [
        def(r.lg_code, '382027'),
        def(r.town_id, '0001'),
        def(r.blk_id, '001'),
        def(r.addr_id, '001'),
        def(r.addr2_id, ''),
        def(r.city_name, '今治市'),
        def(r.oaza_cho_name, '松本町'),
        def(r.chome_name, '一丁目'),
        def(r.koaza_name, ''),
        def(r.blk_num, '6'),
        def(r.rsdt_num, '1'),
        def(r.rsdt_num2, ''),
        r.rsdt_addr_flg == null ? '1' : String(r.rsdt_addr_flg),
      ].join(',')
    );
  }
  return lines.join('\n');
}

// 座標 (mt_rsdtdsp_rsdt_pos) の・実カラム名
function makePosCsv(rows) {
  const headers = ['lg_code', 'town_id', 'blk_id', 'addr_id', 'addr2_id', 'rep_lat', 'rep_lon'];
  const def = (v, d) => (v === undefined ? d : v);
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      [
        def(r.lg_code, '382027'),
        def(r.town_id, '0001'),
        def(r.blk_id, '001'),
        def(r.addr_id, '001'),
        def(r.addr2_id, ''),
        r.rep_lat,
        r.rep_lon,
      ].join(',')
    );
  }
  return lines.join('\n');
}

// ─── 1. 5 キー JOIN ──────────────────────────────────────────────
describe('build-address.js --rsdt: 5 キー JOIN', () => {
  it('5 キーが完全一致した body × pos のみ JOIN される', () => {
    const body = makeBodyCsv([
      {
        lg_code: '382027',
        town_id: '0001',
        blk_id: '001',
        addr_id: '001',
        addr2_id: '',
        blk_num: '6',
        rsdt_num: '1',
      },
    ]);
    const pos = makePosCsv([
      {
        lg_code: '382027',
        town_id: '0001',
        blk_id: '001',
        addr_id: '001',
        addr2_id: '',
        rep_lat: '34.064833',
        rep_lon: '133.001439',
      },
    ]);
    const b = buildRsdtFromCsv(body, pos, 'ehime');
    expect(b.points.length).toBe(1);
    expect(b.points[0].lat).toBe(3406483);
    expect(b.points[0].lng).toBe(13300144);
  });

  it('座標 pos に・対応行が無い body は・skip (= JOIN 失敗・skipNoPos)', () => {
    const body = makeBodyCsv([
      { lg_code: '382027', town_id: '0001', blk_id: '001', addr_id: '001', addr2_id: '' },
      { lg_code: '382027', town_id: '0001', blk_id: '001', addr_id: '002', addr2_id: '' },
    ]);
    const pos = makePosCsv([
      {
        lg_code: '382027',
        town_id: '0001',
        blk_id: '001',
        addr_id: '001',
        addr2_id: '',
        rep_lat: '34.064833',
        rep_lon: '133.001439',
      },
      // addr_id=002 は・pos に無い
    ]);
    const b = buildRsdtFromCsv(body, pos, 'ehime');
    expect(b.points.length).toBe(1);
  });

  it('addr2_id が異なれば・別 key (= 同 lg+town+blk+addr でも・別 entry)', () => {
    const body = makeBodyCsv([
      { addr_id: '001', addr2_id: '' },
      { addr_id: '001', addr2_id: 'A' },
    ]);
    const pos = makePosCsv([
      { addr_id: '001', addr2_id: '', rep_lat: '34.064833', rep_lon: '133.001439' },
      { addr_id: '001', addr2_id: 'A', rep_lat: '34.064900', rep_lon: '133.001500' },
    ]);
    const b = buildRsdtFromCsv(body, pos, 'ehime');
    expect(b.points.length).toBe(2);
  });
});

// ─── 2. rsdt_addr_flg=1 のみ抽出 ─────────────────────────────────
describe('build-address.js --rsdt: rsdt_addr_flg=1 のみ抽出', () => {
  it('flg=1 → include / flg=0 → skip (= 地番地区は・号 build しない)', () => {
    const body = makeBodyCsv([
      { addr_id: '001', rsdt_num: '1', rsdt_addr_flg: '1' },
      { addr_id: '002', rsdt_num: '2', rsdt_addr_flg: '0' },
      { addr_id: '003', rsdt_num: '3', rsdt_addr_flg: '1' },
    ]);
    const pos = makePosCsv([
      { addr_id: '001', rep_lat: '34.064833', rep_lon: '133.001439' },
      { addr_id: '002', rep_lat: '34.064900', rep_lon: '133.001500' },
      { addr_id: '003', rep_lat: '34.064950', rep_lon: '133.001600' },
    ]);
    const b = buildRsdtFromCsv(body, pos, 'ehime');
    expect(b.points.length).toBe(2);
    expect(b.points.map((p) => p.g).sort()).toEqual(['1', '3']);
  });

  it('全行 flg=0 → points 空 + bbox=null', () => {
    const body = makeBodyCsv([{ addr_id: '001', rsdt_addr_flg: '0' }]);
    const pos = makePosCsv([{ addr_id: '001', rep_lat: '34.064833', rep_lon: '133.001439' }]);
    const b = buildRsdtFromCsv(body, pos, 'ehime');
    expect(b.points.length).toBe(0);
    expect(b.bbox).toBeNull();
  });
});

// ─── 3. POI v2 形式 構造 + k(番) + g(号) ─────────────────────────
describe('build-address.js --rsdt: POI v2 構造 + k(番) + g(号)', () => {
  it('output は・{v:2, prefecture, generated, precision, bbox, gridSize, oazas, grid, points}', () => {
    const body = makeBodyCsv([{ addr_id: '001' }]);
    const pos = makePosCsv([{ addr_id: '001', rep_lat: '34.064833', rep_lon: '133.001439' }]);
    const b = buildRsdtFromCsv(body, pos, 'ehime');
    expect(b.v).toBe(2);
    expect(b.prefecture).toBe('ehime');
    expect(typeof b.generated).toBe('string');
    expect(b.precision).toBe(100000);
    expect(typeof b.gridSize).toBe('number');
    expect(typeof b.oazas).toBe('object');
    expect(typeof b.grid).toBe('object');
    expect(Array.isArray(b.points)).toBe(true);
  });

  it('点 は・k (= blk_num 街区符号・番) と g (= rsdt_num 号) を・両方持つ', () => {
    const body = makeBodyCsv([{ addr_id: '001', blk_num: '6', rsdt_num: '12' }]);
    const pos = makePosCsv([{ addr_id: '001', rep_lat: '34.064833', rep_lon: '133.001439' }]);
    const b = buildRsdtFromCsv(body, pos, 'ehime');
    expect(b.points[0].k).toBe('6');
    expect(b.points[0].g).toBe('12');
  });

  it('rsdt_num2 (枝号) が・あれば g = "号-枝号"', () => {
    const body = makeBodyCsv([{ addr_id: '001', blk_num: '6', rsdt_num: '12', rsdt_num2: '3' }]);
    const pos = makePosCsv([{ addr_id: '001', rep_lat: '34.064833', rep_lon: '133.001439' }]);
    const b = buildRsdtFromCsv(body, pos, 'ehime');
    expect(b.points[0].g).toBe('12-3');
  });

  it('rsdt_num2 (枝号) が・空なら g = 号のみ', () => {
    const body = makeBodyCsv([{ addr_id: '001', blk_num: '6', rsdt_num: '12', rsdt_num2: '' }]);
    const pos = makePosCsv([{ addr_id: '001', rep_lat: '34.064833', rep_lon: '133.001439' }]);
    const b = buildRsdtFromCsv(body, pos, 'ehime');
    expect(b.points[0].g).toBe('12');
  });
});

// ─── 4. 座標 int×1e5 + bbox + grid (= street と完全同形式) ───────
describe('build-address.js --rsdt: 座標 int×1e5 + bbox + grid', () => {
  it('lat/lng は・int × 1e5 (= 既存 POI / street と完全統一)', () => {
    const body = makeBodyCsv([{ addr_id: '001' }]);
    const pos = makePosCsv([{ addr_id: '001', rep_lat: '34.064833', rep_lon: '133.001439' }]);
    const b = buildRsdtFromCsv(body, pos, 'ehime');
    expect(b.points[0].lat).toBe(3406483);
    expect(b.points[0].lng).toBe(13300144);
  });

  it('bbox = [minLat, minLng, maxLat, maxLng] integer', () => {
    const body = makeBodyCsv([{ addr_id: '001' }, { addr_id: '002' }]);
    const pos = makePosCsv([
      { addr_id: '001', rep_lat: '34.064833', rep_lon: '133.001439' },
      { addr_id: '002', rep_lat: '34.064500', rep_lon: '133.001000' },
    ]);
    const b = buildRsdtFromCsv(body, pos, 'ehime');
    expect(b.bbox[0]).toBe(3406450);
    expect(b.bbox[1]).toBe(13300100);
    expect(b.bbox[2]).toBe(3406483);
    expect(b.bbox[3]).toBe(13300144);
  });

  it('grid 索引 = encoding-utils.gridKey に・point index 登録', () => {
    const body = makeBodyCsv([{ addr_id: '001' }]);
    const pos = makePosCsv([{ addr_id: '001', rep_lat: '34.064833', rep_lon: '133.001439' }]);
    const b = buildRsdtFromCsv(body, pos, 'ehime');
    const keys = Object.keys(b.grid);
    expect(keys.length).toBe(1);
    expect(b.grid[keys[0]]).toEqual([0]);
  });
});

// ─── 5. 大字 dict 圧縮 ──────────────────────────────────────────
describe('build-address.js --rsdt: 大字 dict 圧縮', () => {
  it('同 city+oaza_cho+chome+koaza → 1 entry に集約・c は・同 idx', () => {
    const body = makeBodyCsv([
      {
        addr_id: '001',
        city_name: '今治市',
        oaza_cho_name: '松本町',
        chome_name: '一丁目',
        rsdt_num: '1',
      },
      {
        addr_id: '002',
        city_name: '今治市',
        oaza_cho_name: '松本町',
        chome_name: '一丁目',
        rsdt_num: '2',
      },
      {
        addr_id: '003',
        city_name: '今治市',
        oaza_cho_name: '末広町',
        chome_name: '一丁目',
        rsdt_num: '1',
      },
    ]);
    const pos = makePosCsv([
      { addr_id: '001', rep_lat: '34.064833', rep_lon: '133.001439' },
      { addr_id: '002', rep_lat: '34.064900', rep_lon: '133.001500' },
      { addr_id: '003', rep_lat: '34.064500', rep_lon: '133.001000' },
    ]);
    const b = buildRsdtFromCsv(body, pos, 'ehime');
    expect(Object.keys(b.oazas).length).toBe(2);
    expect(b.points[0].c).toBe(b.points[1].c);
    expect(b.points[0].c).not.toBe(b.points[2].c);
  });

  it('oazas value は・「市 + 大字 + 丁目 (+ 小字)」結合 (= street と同形式)', () => {
    const body = makeBodyCsv([
      {
        addr_id: '001',
        city_name: '今治市',
        oaza_cho_name: '松本町',
        chome_name: '一丁目',
      },
    ]);
    const pos = makePosCsv([{ addr_id: '001', rep_lat: '34.064833', rep_lon: '133.001439' }]);
    const b = buildRsdtFromCsv(body, pos, 'ehime');
    expect(b.oazas[0]).toBe('今治市松本町一丁目');
  });
});

// ─── 6. 不正データ skip ─────────────────────────────────────────
describe('build-address.js --rsdt: 不正データ skip', () => {
  it('rep_lat / rep_lon が NaN → skip', () => {
    const body = makeBodyCsv([{ addr_id: '001' }]);
    const pos = makePosCsv([{ addr_id: '001', rep_lat: 'abc', rep_lon: 'xyz' }]);
    const b = buildRsdtFromCsv(body, pos, 'ehime');
    expect(b.points.length).toBe(0);
  });

  it('rsdt_num が空 → skip (= 号レベル必須)', () => {
    const body = makeBodyCsv([{ addr_id: '001', rsdt_num: '' }]);
    const pos = makePosCsv([{ addr_id: '001', rep_lat: '34.064833', rep_lon: '133.001439' }]);
    const b = buildRsdtFromCsv(body, pos, 'ehime');
    expect(b.points.length).toBe(0);
  });

  it('blk_num が空 → skip (= 番レベル必須)', () => {
    const body = makeBodyCsv([{ addr_id: '001', blk_num: '' }]);
    const pos = makePosCsv([{ addr_id: '001', rep_lat: '34.064833', rep_lon: '133.001439' }]);
    const b = buildRsdtFromCsv(body, pos, 'ehime');
    expect(b.points.length).toBe(0);
  });
});

// ─── 7. CSV 列順変更耐性 (= header 名で・動的解決) ────────────────
describe('build-address.js --rsdt: header 名で列解決 (= 列順変更耐性)', () => {
  it('body の・列順を入れ替えても・正しく抽出される', () => {
    // 列順を逆にした body CSV (= header 名 match で・正しく拾えるか)
    const body =
      'rsdt_addr_flg,rsdt_num2,rsdt_num,blk_num,koaza_name,chome_name,oaza_cho_name,city_name,addr2_id,addr_id,blk_id,town_id,lg_code\n' +
      '1,,5,7,,二丁目,松本町,今治市,,001,001,0001,382027';
    const pos = makePosCsv([{ addr_id: '001', rep_lat: '34.064833', rep_lon: '133.001439' }]);
    const b = buildRsdtFromCsv(body, pos, 'ehime');
    expect(b.points.length).toBe(1);
    expect(b.points[0].k).toBe('7');
    expect(b.points[0].g).toBe('5');
    expect(b.oazas[0]).toBe('今治市松本町二丁目');
  });

  it('pos の・rep_lng (= rep_lon の別表記) も・受理する', () => {
    const body = makeBodyCsv([{ addr_id: '001' }]);
    // rep_lon → rep_lng で・代替表記
    const pos =
      'lg_code,town_id,blk_id,addr_id,addr2_id,rep_lat,rep_lng\n' +
      '382027,0001,001,001,,34.064833,133.001439';
    const b = buildRsdtFromCsv(body, pos, 'ehime');
    expect(b.points.length).toBe(1);
    expect(b.points[0].lng).toBe(13300144);
  });

  it('body に・rsdt_addr_flg 列が・無ければ・throw (= 必須列の欠落 detect)', () => {
    const body =
      'lg_code,town_id,blk_id,addr_id,addr2_id,city_name,oaza_cho_name,chome_name,blk_num,rsdt_num\n' +
      '382027,0001,001,001,,今治市,松本町,一丁目,6,1';
    const pos = makePosCsv([{ addr_id: '001', rep_lat: '34.064833', rep_lon: '133.001439' }]);
    expect(() => buildRsdtFromCsv(body, pos, 'ehime')).toThrow(/rsdt_addr_flg/);
  });
});

// ─── 8. UTF-8 BOM 耐性 (= ABR は・通常 BOM 付き UTF-8) ────────
describe('build-address.js --rsdt: UTF-8 BOM 耐性', () => {
  it('先頭 BOM (= \\uFEFF) があっても・header 解釈 OK', () => {
    const body = '﻿' + makeBodyCsv([{ addr_id: '001' }]);
    const pos = '﻿' + makePosCsv([{ addr_id: '001', rep_lat: '34.064833', rep_lon: '133.001439' }]);
    const b = buildRsdtFromCsv(body, pos, 'ehime');
    expect(b.points.length).toBe(1);
  });
});

// ─── 9. ★ 実 ehime data 最近傍 verify (build 後・skip 可) ─────
describe('build-address.js --rsdt: 実 ehime data 最近傍 verify', () => {
  const REAL_PATH = path.join(__dirname, '..', '..', 'data', 'addresses-rsdt-ehime.js');

  it('生成済 data/addresses-rsdt-ehime.js は・load 可能 + 全構造一致', () => {
    if (!fs.existsSync(REAL_PATH)) {
      console.warn('data/addresses-rsdt-ehime.js 未生成・skip (= build 未実行)');
      return;
    }
    const win = {};
    new Function('window', fs.readFileSync(REAL_PATH, 'utf8'))(win);
    const b = win.ADDRESSES_RSDT_EHIME;
    expect(b.v).toBe(2);
    expect(b.prefecture).toBe('ehime');
    expect(b.precision).toBe(100000);
    expect(b.points.length).toBeGreaterThan(10000);
    expect(Object.keys(b.oazas).length).toBeGreaterThan(100);
    expect(Object.keys(b.grid).length).toBeGreaterThan(50);
    // 全点が k + g を持つ
    for (let i = 0; i < Math.min(100, b.points.length); i++) {
      expect(typeof b.points[i].k).toBe('string');
      expect(typeof b.points[i].g).toBe('string');
    }
  });

  // ★ 司さん GPS (34.06467, 133.0015) の・所在地「今治市松本町一丁目」は・地番地区
  //   (= ABR rsdt_addr_flg=0 → ABR rsdt に・含まれない)。これは設計通り (= 号無し領域)。
  //   commit4 SEARCH_CHAIN で・rsdt MISS → street で 「松本町一丁目6」 fallback する。
  //   よって rsdt 単独 verify は・実 ABR 住居表示地区 GPS で実施。
  it('司さん GPS (34.06467, 133.0015) は・地番地区 = ABR rsdt に・近傍 100m 内 hit なし (= 設計通り・SEARCH_CHAIN で street fallback)', () => {
    if (!fs.existsSync(REAL_PATH)) {
      console.warn('data/addresses-rsdt-ehime.js 未生成・skip');
      return;
    }
    const win = {};
    new Function('window', fs.readFileSync(REAL_PATH, 'utf8'))(win);
    const b = win.ADDRESSES_RSDT_EHIME;
    function hav(lat1, lng1, lat2, lng2) {
      const R = 6371000;
      const T = Math.PI / 180;
      const dLat = (lat2 - lat1) * T;
      const dLng = (lng2 - lng1) * T;
      const a =
        Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * T) * Math.cos(lat2 * T) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    let bestD = Infinity;
    for (const p of b.points) {
      const d = hav(34.06467, 133.0015, p.lat / 100000, p.lng / 100000);
      if (d < bestD) bestD = d;
    }
    // 100m 以内に・ABR rsdt point は無いはず (= 松本町一丁目は・地番地区)
    expect(bestD).toBeGreaterThan(100);
  });

  it('★ 住居表示地区 GPS (34.06124, 132.99625 = 今治市常盤町５丁目1番1号) → 同住所が・20m 以内 hit', () => {
    if (!fs.existsSync(REAL_PATH)) {
      console.warn('data/addresses-rsdt-ehime.js 未生成・skip');
      return;
    }
    const win = {};
    new Function('window', fs.readFileSync(REAL_PATH, 'utf8'))(win);
    const b = win.ADDRESSES_RSDT_EHIME;
    function hav(lat1, lng1, lat2, lng2) {
      const R = 6371000;
      const T = Math.PI / 180;
      const dLat = (lat2 - lat1) * T;
      const dLng = (lng2 - lng1) * T;
      const a =
        Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * T) * Math.cos(lat2 * T) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    let best = null;
    let bestD = Infinity;
    for (const p of b.points) {
      const d = hav(34.06124, 132.99625, p.lat / 100000, p.lng / 100000);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    expect(bestD).toBeLessThan(20);
    expect(b.oazas[best.c]).toBe('今治市常盤町５丁目');
    expect(best.k).toBe('1');
    expect(best.g).toBe('1');
  });
});
