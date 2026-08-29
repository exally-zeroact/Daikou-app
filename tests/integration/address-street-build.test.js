// tests/integration/address-street-build.test.js
//
// ★設計変更宣言 (= 住所 STEP2 commit1・番=ISJ 街区 build verify):
//   build-address.js の・--street モードを・本物 ISJ 形式 fixture (= int×1e5 + 実カラム)
//   で・regression 防止。司さん指示「decimal mock 禁止」準拠。
//
// 検証内容:
//   1. CSV パース + 代表フラグ=1 抽出 (= 旧 fine と同 ロジック)
//   2. POI v2 形式 ({v:2, prefecture, oazas, grid, points, ...})
//   3. 座標 int×1e5 + bbox 計算
//   4. 大字 dict 圧縮 (= 同 city+oaza は・1 entry)
//   5. grid 索引 (= encoding-utils.gridKey)
//   6. 街区符号 k field 保持
//   7. ★ 司さん GPS (= 34.06467, 133.0015) → 「今治市松本町一丁目6」18.6m at 実 ehime data
//
// 絶対ルール準拠: 距離 / 課金 / Worker B / map-matcher 完全無関係・住所表示専用。

'use strict';

const fs = require('fs');
const path = require('path');
const { buildStreetFromCsvText } = require(
  path.join(__dirname, '..', '..', 'scripts', 'build-address.js')
);

// 本物 ISJ CSV 形式 (= 14 column・引用符付き) の・fixture helper
function makeStreetsCsv(rows) {
  const header =
    '"都道府県名","市区町村名","大字・丁目名","小字・通称名","街区符号・地番","座標系番号","Ｘ座標","Ｙ座標","緯度","経度","住居表示フラグ","代表フラグ","更新前履歴フラグ","更新後履歴フラグ"';
  return (
    header +
    '\n' +
    rows
      .map(
        (r) =>
          `"${r.pref || '愛媛県'}","${r.city}","${r.oaza}","${r.koaza || ''}","${r.kuban}","4","0","0","${r.lat}","${r.lng}","${r.jukyo || '1'}","${r.daihyou || '1'}","0","0"`
      )
      .join('\n')
  );
}

// ─── 1. CSV パース + 代表フラグ=1 抽出 ──────────────────────────

describe('build-address.js --street: CSV パース + 代表フラグ=1 抽出', () => {
  it('代表フラグ=1 のみ抽出・=0 は skip', () => {
    const csv = makeStreetsCsv([
      {
        city: '今治市',
        oaza: '松本町一丁目',
        kuban: '6',
        lat: 34.064833,
        lng: 133.001439,
        daihyou: '1',
      },
      {
        city: '今治市',
        oaza: '松本町一丁目',
        kuban: '7',
        lat: 34.064972,
        lng: 133.00189,
        daihyou: '1',
      },
      {
        city: '今治市',
        oaza: '松本町一丁目',
        kuban: '99',
        lat: 34.066,
        lng: 133.002,
        daihyou: '0',
      },
    ]);
    const bundle = buildStreetFromCsvText(csv, 'ehime');
    expect(bundle.points.length).toBe(2);
  });

  it('全行 fail (= 全 代表フラグ=0) → points 空 + bbox=null', () => {
    const csv = makeStreetsCsv([
      {
        city: '今治市',
        oaza: '松本町一丁目',
        kuban: '6',
        lat: 34.064833,
        lng: 133.001439,
        daihyou: '0',
      },
    ]);
    const bundle = buildStreetFromCsvText(csv, 'ehime');
    expect(bundle.points.length).toBe(0);
    expect(bundle.bbox).toBeNull();
  });

  it('header 行のみ・data 0 行 → points 空', () => {
    const csv = makeStreetsCsv([]);
    const bundle = buildStreetFromCsvText(csv, 'ehime');
    expect(bundle.points.length).toBe(0);
  });

  it('緯度経度 NaN → skip', () => {
    const csv = makeStreetsCsv([
      { city: '今治市', oaza: '松本町一丁目', kuban: '6', lat: 'abc', lng: 'xyz' },
    ]);
    const bundle = buildStreetFromCsvText(csv, 'ehime');
    expect(bundle.points.length).toBe(0);
  });
});

// ─── 2. POI v2 形式 (= {v:2, prefecture, oazas, grid, points, ...}) ──

describe('build-address.js --street: POI v2 形式 構造 verify', () => {
  it('output は・{ v:2, prefecture, generated, precision, bbox, gridSize, oazas, grid, points }', () => {
    const csv = makeStreetsCsv([
      { city: '今治市', oaza: '松本町一丁目', kuban: '6', lat: 34.064833, lng: 133.001439 },
    ]);
    const bundle = buildStreetFromCsvText(csv, 'ehime');
    expect(bundle.v).toBe(2);
    expect(bundle.prefecture).toBe('ehime');
    expect(typeof bundle.generated).toBe('string');
    expect(bundle.precision).toBe(100000);
    expect(typeof bundle.gridSize).toBe('number');
    expect(typeof bundle.oazas).toBe('object');
    expect(typeof bundle.grid).toBe('object');
    expect(Array.isArray(bundle.points)).toBe(true);
  });

  it('precision = 100000 (= 既存 POI / fine と統一)', () => {
    const csv = makeStreetsCsv([
      { city: '今治市', oaza: '松本町一丁目', kuban: '6', lat: 34.064833, lng: 133.001439 },
    ]);
    const bundle = buildStreetFromCsvText(csv, 'ehime');
    expect(bundle.precision).toBe(100000);
  });
});

// ─── 3. 座標 int×1e5 + bbox 計算 ────────────────────────────

describe('build-address.js --street: 座標 int×1e5 + bbox', () => {
  it('lat/lng が・整数 × 1e5 で格納 (= 既存 POI と統一)', () => {
    const csv = makeStreetsCsv([
      { city: '今治市', oaza: '松本町一丁目', kuban: '6', lat: 34.064833, lng: 133.001439 },
    ]);
    const bundle = buildStreetFromCsvText(csv, 'ehime');
    expect(bundle.points[0].lat).toBe(3406483);
    expect(bundle.points[0].lng).toBe(13300144);
  });

  it('bbox = [minLat, minLng, maxLat, maxLng] integer 形式', () => {
    const csv = makeStreetsCsv([
      { city: '今治市', oaza: '松本町一丁目', kuban: '6', lat: 34.064833, lng: 133.001439 },
      { city: '今治市', oaza: '末広町一丁目', kuban: '6', lat: 34.0645, lng: 133.001 },
    ]);
    const bundle = buildStreetFromCsvText(csv, 'ehime');
    expect(bundle.bbox[0]).toBe(3406450); // min lat
    expect(bundle.bbox[1]).toBe(13300100); // min lng
    expect(bundle.bbox[2]).toBe(3406483); // max lat
    expect(bundle.bbox[3]).toBe(13300144); // max lng
  });
});

// ─── 4. 大字 dict 圧縮 ────────────────────────────────────────

describe('build-address.js --street: 大字 dict 圧縮', () => {
  it('同 city+oaza は・1 entry に集約・points は・oazaIdx 参照', () => {
    const csv = makeStreetsCsv([
      { city: '今治市', oaza: '松本町一丁目', kuban: '6', lat: 34.064833, lng: 133.001439 },
      { city: '今治市', oaza: '松本町一丁目', kuban: '7', lat: 34.064972, lng: 133.00189 },
      { city: '今治市', oaza: '末広町一丁目', kuban: '6', lat: 34.0645, lng: 133.001 },
    ]);
    const bundle = buildStreetFromCsvText(csv, 'ehime');
    expect(Object.keys(bundle.oazas).length).toBe(2);
    expect(bundle.points[0].c).toBe(bundle.points[1].c); // 同 oaza → 同 idx
    expect(bundle.points[0].c).not.toBe(bundle.points[2].c);
  });

  it('小字 (= koaza) も・unique key の・一部に含まれる', () => {
    const csv = makeStreetsCsv([
      { city: '今治市', oaza: '松本町', koaza: '甲', kuban: '6', lat: 34.064833, lng: 133.001439 },
      { city: '今治市', oaza: '松本町', koaza: '乙', kuban: '6', lat: 34.064972, lng: 133.00189 },
    ]);
    const bundle = buildStreetFromCsvText(csv, 'ehime');
    expect(Object.keys(bundle.oazas).length).toBe(2); // 甲・乙 で・別 entry
  });

  it('oazas value は・「市区町村 + 大字・丁目 (+ 小字)」結合文字列', () => {
    const csv = makeStreetsCsv([
      { city: '今治市', oaza: '松本町一丁目', kuban: '6', lat: 34.064833, lng: 133.001439 },
    ]);
    const bundle = buildStreetFromCsvText(csv, 'ehime');
    expect(bundle.oazas[0]).toBe('今治市松本町一丁目');
  });
});

// ─── 5. grid 索引 ───────────────────────────────────────────

describe('build-address.js --street: grid 索引 (= encoding-utils.gridKey)', () => {
  it('各 point は・対応 grid cell に・登録される', () => {
    const csv = makeStreetsCsv([
      { city: '今治市', oaza: '松本町一丁目', kuban: '6', lat: 34.064833, lng: 133.001439 },
    ]);
    const bundle = buildStreetFromCsvText(csv, 'ehime');
    const gridKeys = Object.keys(bundle.grid);
    expect(gridKeys.length).toBe(1);
    expect(bundle.grid[gridKeys[0]]).toEqual([0]);
  });

  it('複数 grid cell に・分散 point は・別 cell に登録', () => {
    const csv = makeStreetsCsv([
      { city: '今治市', oaza: '松本町一丁目', kuban: '6', lat: 34.064833, lng: 133.001439 },
      { city: '今治市', oaza: '遠方', kuban: '1', lat: 34.2, lng: 133.1 }, // 別 cell
    ]);
    const bundle = buildStreetFromCsvText(csv, 'ehime');
    expect(Object.keys(bundle.grid).length).toBe(2);
  });
});

// ─── 6. 街区符号 k field 保持 ────────────────────────────────

describe('build-address.js --street: 街区符号 k field', () => {
  it('k は・CSV column 5 (= 街区符号・地番) を・文字列で保持', () => {
    const csv = makeStreetsCsv([
      { city: '今治市', oaza: '松本町一丁目', kuban: '6', lat: 34.064833, lng: 133.001439 },
      { city: '今治市', oaza: '松本町一丁目', kuban: '17', lat: 34.064972, lng: 133.00189 },
    ]);
    const bundle = buildStreetFromCsvText(csv, 'ehime');
    expect(bundle.points[0].k).toBe('6');
    expect(bundle.points[1].k).toBe('17');
  });

  it('地番地区 (= 数字 + 枝番) も・そのまま保持', () => {
    const csv = makeStreetsCsv([
      { city: '今治市', oaza: '島', kuban: '123-4', lat: 34.064833, lng: 133.001439 },
    ]);
    const bundle = buildStreetFromCsvText(csv, 'ehime');
    expect(bundle.points[0].k).toBe('123-4');
  });
});

// ─── 7. ★ 実 ehime data で・司さん GPS 最近傍 verify ───────

describe('build-address.js --street: 実 ehime data 最近傍 verify', () => {
  const REAL_PATH = path.join(__dirname, '..', '..', 'data', 'addresses-street-ehime.js');

  it('生成済 data/addresses-street-ehime.js は・load 可能 + 全構造一致', () => {
    if (!fs.existsSync(REAL_PATH)) {
      // ★2026-08-28: 前は「skip」と出して 緑で終わっていました＝★読む人には 合格に見える★。
      //   この生成物は ★repo に置いていません★（build で作る物・2026-08-28 実測で 3本とも 無い）。
      //   ⇒★赤にはしません★（無いのが 普通）。ただし ★未測定★と はっきり言います。
      console.warn('★未測定★ data/addresses-street-ehime.js が 在りません（build を回していない）');
      console.warn('  MISOKUTEI=1 reason=build-output-not-in-repo');
      console.warn('  ⇒「測っていない」であって「異常なし」ではありません。');
      return;
    }
    const win = {};
    new Function('window', fs.readFileSync(REAL_PATH, 'utf8'))(win);
    const b = win.ADDRESSES_STREET_EHIME;
    expect(b.v).toBe(2);
    expect(b.prefecture).toBe('ehime');
    expect(b.precision).toBe(100000);
    expect(b.points.length).toBeGreaterThan(100000);
    expect(Object.keys(b.oazas).length).toBeGreaterThan(1000);
    expect(Object.keys(b.grid).length).toBeGreaterThan(100);
  });

  it('★ 司さん GPS (34.06467, 133.0015) → 「今治市松本町一丁目6」が・20m 以内で hit', () => {
    if (!fs.existsSync(REAL_PATH)) {
      // ★2026-08-28: ここも「skip」で 緑で終わっていました（同じ形が 2か所ありました）。
      console.warn('★未測定★ data/addresses-street-ehime.js が 在りません（build を回していない）');
      console.warn('  MISOKUTEI=1 reason=build-output-not-in-repo');
      return;
    }
    const win = {};
    new Function('window', fs.readFileSync(REAL_PATH, 'utf8'))(win);
    const b = win.ADDRESSES_STREET_EHIME;
    const userLat = 34.06467;
    const userLng = 133.0015;
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
      const d = hav(userLat, userLng, p.lat / 100000, p.lng / 100000);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    expect(bestD).toBeLessThan(20); // 20m 以内 hit
    expect(b.oazas[best.c] + best.k).toBe('今治市松本町一丁目6');
  });
});
