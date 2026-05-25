#!/usr/bin/env node
/* eslint-env node */
// scripts/build-town-polygons.js (= dev tool・新規 2026-05-23)
//
// ★設計変更宣言 (2026-05-23・住所① 案 C 高精度版・町丁字 polygon build):
//   NII Geoshape 国勢調査町丁・字等境界 2020 (CC BY 4.0) を・市町村別 TopoJSON で取得・
//   県別に・合成 + 適応簡略化 + quantize + JSON 出力する。
//
// 入力:
//   tmp/nii-geoshape/{5桁JIS code}.topojson (= 1 市町村 1 file・curl 等で・別途取得)
//   data/addresses-coarse-jp.js (= 全 1919 市町村 JIS code list source)
// 出力:
//   data/town-polygons-{pref}.js (= 47 県別・既存 fine bundle 互換 globalKey)
//
// schema (= 既存 fine bundle pattern):
//   window.TOWN_POLYGONS_{PREF} = {
//     v: 1,
//     generated: '<ISO>',
//     precision: 100000,       // int × 1e5 quantize (= 既存 fine 整合)
//     prefecture: 'ehime',
//     prefCode: 38,
//     bbox: [latMin*1e5, lngMin*1e5, latMax*1e5, lngMax*1e5],
//     gridSize: 1000,          // ~1km tile (= 既存 fine 整合)
//     items: [
//       {
//         id: <int>,             // item index
//         n: '本町七丁目',         // S_NAME (= 町字名)
//         c: '今治市',             // CITY_NAME (= 市町村名)
//         code: '38202001001',   // KEY_CODE (= 識別)
//         rings: [               // 簡略化後 polygon rings (= 外周 + 穴・複数 ring 対応)
//           [[latI, lngI], ...]  // int × 1e5 quantize
//         ],
//         bbox: [latMinI, lngMinI, latMaxI, lngMaxI],
//       },
//       ...
//     ],
//     grid: {                   // 1km tile index・key = '{tileLat}_{tileLng}'
//       '34077_132997': [itemIdx, ...],
//       ...
//     },
//     source: '...',            // CC BY 4.0 credit (= 必須)
//     license: 'CC BY 4.0',
//   };
//
// 適応簡略化:
//   ・小 polygon (= AREA < 50000 m²): DP tolerance 5m (= 都市部・密 町)
//   ・大 polygon (= AREA >= 50000 m²): DP tolerance 50m (= 郊外・大 町)
//   ・判定: TopoJSON properties.AREA を使用 (= 面積 m²・実 data field)
//
// 絶対ルール準拠:
//   ✓ distance_m / 課金 / Worker B 本体には・1 byte も触れない (= 表示専用)
//   ✓ 既存 fine bundle 形式 互換 (= 同 pattern で・loader 自動対応)
//   ✓ CC BY 4.0 出典明記 (= source field + 法的ページ反映)
//
// 使い方:
//   1. 各 市町村 TopoJSON を・tmp/nii-geoshape/{code}.topojson に取得 (curl)
//   2. node scripts/build-town-polygons.js {pref}
//      例: node scripts/build-town-polygons.js ehime
//      pref 省略 → 全 47 県 build
//
// 出典:
//   「『国勢調査町丁・字等別境界データセット』(CODH 作成)」+
//   「令和2年国勢調査町丁・字等別境界データ (e-Stat)」を加工して作成
//   https://geoshape.ex.nii.ac.jp/ka/

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'tmp', 'nii-geoshape');
const OUT_DIR = path.join(ROOT, 'data');
const COARSE_JS = path.join(ROOT, 'data', 'addresses-coarse-jp.js');

const COORD_SCALE = 100000;
const GRID_SIZE = 1000; // 1km tile (= 既存 fine 整合)

// 適応簡略化 thresholds
const URBAN_AREA_THRESHOLD = 50000; // m² (= 5 万 m² 未満 = 小 polygon = 都市部)
const URBAN_DP_M = 5; // 都市部・5m
const RURAL_DP_M = 100; // 郊外・100m (= 2026-05-23 第2回会議 B 採用・hokkaido 8.17MB 解消・全国 -30%)

// 出典 (= CC BY 4.0 必須)
const SOURCE_CREDIT =
  '『国勢調査町丁・字等別境界データセット』(CODH 作成) + 令和2年国勢調査町丁・字等別境界データ (e-Stat) を加工';
const LICENSE = 'CC BY 4.0';

// 全 prefecture (= JIS 2 桁) 名 mapping
const PREF_NAMES = {
  '01': 'hokkaido',
  '02': 'aomori',
  '03': 'iwate',
  '04': 'miyagi',
  '05': 'akita',
  '06': 'yamagata',
  '07': 'fukushima',
  '08': 'ibaraki',
  '09': 'tochigi',
  10: 'gunma',
  11: 'saitama',
  12: 'chiba',
  13: 'tokyo',
  14: 'kanagawa',
  15: 'niigata',
  16: 'toyama',
  17: 'ishikawa',
  18: 'fukui',
  19: 'yamanashi',
  20: 'nagano',
  21: 'gifu',
  22: 'shizuoka',
  23: 'aichi',
  24: 'mie',
  25: 'shiga',
  26: 'kyoto',
  27: 'osaka',
  28: 'hyogo',
  29: 'nara',
  30: 'wakayama',
  31: 'tottori',
  32: 'shimane',
  33: 'okayama',
  34: 'hiroshima',
  35: 'yamaguchi',
  36: 'tokushima',
  37: 'kagawa',
  38: 'ehime',
  39: 'kochi',
  40: 'fukuoka',
  41: 'saga',
  42: 'nagasaki',
  43: 'kumamoto',
  44: 'oita',
  45: 'miyazaki',
  46: 'kagoshima',
  47: 'okinawa',
};

// ─── TopoJSON arc decode → GeoJSON polygon ───
// 標準 TopoJSON (= transform あり) / 絶対座標 mode (= transform なし・NII Geoshape) 両対応
function topojsonDecode(topology) {
  const transform = topology.transform;
  if (transform && transform.scale && transform.translate) {
    // 標準 TopoJSON: delta encoding + scale + translate
    const scale = transform.scale;
    const translate = transform.translate;
    return topology.arcs.map((arc) => {
      let x = 0;
      let y = 0;
      return arc.map((pair) => {
        x += pair[0];
        y += pair[1];
        return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
      });
    });
  }
  // 絶対座標 mode (= NII Geoshape は・transform なし・各 arc pair が・[lng, lat] 絶対値)
  return topology.arcs.map((arc) => arc.map((pair) => [pair[0], pair[1]]));
}

function topoArcsToCoords(arcsIndices, decodedArcs) {
  // arcsIndices = [arc1, arc2, ...] (= arc index・負値で逆順)
  const coords = [];
  arcsIndices.forEach((idx, i) => {
    const reverse = idx < 0;
    const arcIdx = reverse ? ~idx : idx;
    const arc = decodedArcs[arcIdx];
    if (!arc) return;
    const seq = reverse ? arc.slice().reverse() : arc;
    if (i === 0) {
      coords.push(...seq);
    } else {
      // 連結時・末尾と先頭が重複・skip
      coords.push(...seq.slice(1));
    }
  });
  return coords;
}

function topoGeometryToRings(geom, decodedArcs) {
  // GeometryCollection 内・1 geometry を polygon rings に変換
  // type: 'Polygon' → arcs: [[outerRing], [hole1], ...]
  // type: 'MultiPolygon' → arcs: [[[outerRing], [hole1]], ...]
  if (geom.type === 'Polygon') {
    return [geom.arcs.map((ringArcs) => topoArcsToCoords(ringArcs, decodedArcs))];
  }
  if (geom.type === 'MultiPolygon') {
    return geom.arcs.map((poly) => poly.map((ringArcs) => topoArcsToCoords(ringArcs, decodedArcs)));
  }
  return [];
}

// ─── Douglas-Peucker simplify (= scripts/build-roads.js 同 logic) ───
// _haversineM: 将来用 helper (= 距離計算 needed なら使う・現状 DP は pointToSegMeterDist の平面近似で済む)
// eslint-disable-next-line no-unused-vars
function _haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const T = Math.PI / 180;
  const dLat = (lat2 - lat1) * T;
  const dLng = (lng2 - lng1) * T;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * T) * Math.cos(lat2 * T) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointToSegMeterDist(p, a, b) {
  // 簡略化: 緯度経度 → 平面近似 (= 短距離なので・度差を・m に変換)
  const mPerDegLat = 111000;
  const mPerDegLng = 111000 * Math.cos((p[0] * Math.PI) / 180);
  const px = p[1] * mPerDegLng;
  const py = p[0] * mPerDegLat;
  const ax = a[1] * mPerDegLng;
  const ay = a[0] * mPerDegLat;
  const bx = b[1] * mPerDegLng;
  const by = b[0] * mPerDegLat;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// iterative Douglas-Peucker (= stack ベース・recursive 回避で・大 polygon 高速化)
function douglasPeucker(points, toleranceM) {
  const n = points.length;
  if (n < 3) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  // stack: [startIdx, endIdx] のペア
  const stack = [[0, n - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop();
    if (e - s < 2) continue;
    let maxDist = 0;
    let maxIdx = -1;
    const first = points[s];
    const last = points[e];
    for (let i = s + 1; i < e; i++) {
      const d = pointToSegMeterDist(points[i], first, last);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > toleranceM && maxIdx > 0) {
      keep[maxIdx] = 1;
      stack.push([s, maxIdx]);
      stack.push([maxIdx, e]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push(points[i]);
  }
  return out;
}

// ─── ring → quantized int rings (= int × 1e5) ───
function quantizeRing(ring) {
  return ring.map((p) => [
    Math.round(p[1] * COORD_SCALE), // lat (= note: TopoJSON は・[lng, lat] 順)
    Math.round(p[0] * COORD_SCALE), // lng
  ]);
}

// ─── grid index 構築 (= 1km tile・既存 fine 整合) ───
// _gridKey: 将来用 helper (= 現状 grid build は runtime lazy で・business.js consumer 側・本 script では未使用)
// eslint-disable-next-line no-unused-vars
function _gridKey(latI, lngI) {
  return Math.floor(latI / GRID_SIZE) + '_' + Math.floor(lngI / GRID_SIZE);
}

function buildGridIndex(items) {
  const grid = {};
  items.forEach((it, idx) => {
    if (!it.bbox) return;
    const [latMin, lngMin, latMax, lngMax] = it.bbox;
    const tLatMin = Math.floor(latMin / GRID_SIZE);
    const tLatMax = Math.floor(latMax / GRID_SIZE);
    const tLngMin = Math.floor(lngMin / GRID_SIZE);
    const tLngMax = Math.floor(lngMax / GRID_SIZE);
    for (let tlat = tLatMin; tlat <= tLatMax; tlat++) {
      for (let tlng = tLngMin; tlng <= tLngMax; tlng++) {
        const key = tlat + '_' + tlng;
        if (!grid[key]) grid[key] = [];
        grid[key].push(idx);
      }
    }
  });
  return grid;
}

// ─── 1 県分 build ───
function buildPref(prefCode, prefName, cityCodes) {
  console.log('[build] pref=' + prefName + ' (' + prefCode + ') / cities=' + cityCodes.length);
  const items = [];
  let totalVerticesBefore = 0;
  let totalVerticesAfter = 0;
  let skipped = 0;
  let urbanCount = 0;
  let ruralCount = 0;

  for (const code of cityCodes) {
    const file = path.join(CACHE_DIR, code + '.topojson');
    if (!fs.existsSync(file)) {
      console.log('  skip ' + code + ' (file not found)');
      skipped++;
      continue;
    }
    let topology;
    try {
      topology = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      console.log('  parse fail ' + code + ': ' + e.message);
      skipped++;
      continue;
    }
    if (!topology.objects || !topology.objects.town) {
      console.log('  no town objects ' + code);
      skipped++;
      continue;
    }
    const decodedArcs = topojsonDecode(topology);
    const geometries = topology.objects.town.geometries || [];
    const beforeItems = items.length;
    const t0 = Date.now();
    geometries.forEach((g) => {
      const props = g.properties || {};
      const sName = props.S_NAME;
      const cName = props.CITY_NAME;
      const kCode = props.KEY_CODE;
      const area = props.AREA || 0;
      if (!sName || !cName) return;
      const polys = topoGeometryToRings(g, decodedArcs);
      if (polys.length === 0) return;
      // 適応簡略化: AREA で・tolerance 切替
      const isUrban = area < URBAN_AREA_THRESHOLD;
      const tolerance = isUrban ? URBAN_DP_M : RURAL_DP_M;
      if (isUrban) urbanCount++;
      else ruralCount++;
      // 複数 polygon (= MultiPolygon) → 全 ring を結合
      polys.forEach((rings) => {
        const simplifiedRings = rings.map((ring) => {
          totalVerticesBefore += ring.length;
          const simplified = douglasPeucker(ring, tolerance);
          totalVerticesAfter += simplified.length;
          return quantizeRing(simplified);
        });
        // bbox 計算
        let latMin = Infinity;
        let lngMin = Infinity;
        let latMax = -Infinity;
        let lngMax = -Infinity;
        simplifiedRings.forEach((r) =>
          r.forEach(([la, ln]) => {
            if (la < latMin) latMin = la;
            if (la > latMax) latMax = la;
            if (ln < lngMin) lngMin = ln;
            if (ln > lngMax) lngMax = ln;
          })
        );
        items.push({
          id: items.length,
          n: sName,
          c: cName,
          code: kCode,
          rings: simplifiedRings,
          bbox: [latMin, lngMin, latMax, lngMax],
        });
      });
    });
    const dt = Date.now() - t0;
    console.log(
      '  ✓ ' +
        code +
        ' geometries=' +
        geometries.length +
        ' added=' +
        (items.length - beforeItems) +
        ' (' +
        dt +
        'ms)'
    );
  }
  console.log('  [' + prefName + '] cities done, total items=' + items.length);

  // 県全体 bbox
  let prefLatMin = Infinity;
  let prefLngMin = Infinity;
  let prefLatMax = -Infinity;
  let prefLngMax = -Infinity;
  items.forEach((it) => {
    if (!it.bbox) return;
    if (it.bbox[0] < prefLatMin) prefLatMin = it.bbox[0];
    if (it.bbox[1] < prefLngMin) prefLngMin = it.bbox[1];
    if (it.bbox[2] > prefLatMax) prefLatMax = it.bbox[2];
    if (it.bbox[3] > prefLngMax) prefLngMax = it.bbox[3];
  });

  // grid index は・runtime (= business.js consumer side) で・初回 lazy build に・委譲
  // (= build script size 縮小・hang 回避・~3000 items naive iter ms 単位で許容)
  console.log('  [' + prefName + '] grid: runtime-built (skip)');

  const out = {
    v: 1,
    generated: new Date().toISOString(),
    precision: COORD_SCALE,
    prefecture: prefName,
    prefCode: prefCode,
    bbox: prefLatMin === Infinity ? null : [prefLatMin, prefLngMin, prefLatMax, prefLngMax],
    gridSize: GRID_SIZE,
    items: items,
    // grid は runtime build (= business.js consumer 側で・初回 PIP 時に lazy build)
    source: SOURCE_CREDIT,
    license: LICENSE,
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://geoshape.ex.nii.ac.jp/ka/',
  };

  const globalKey = 'TOWN_POLYGONS_' + prefName.toUpperCase();
  const outFile = path.join(OUT_DIR, 'town-polygons-' + prefName + '.js');
  const header =
    '// Auto-generated by scripts/build-town-polygons.js\n' +
    '// Generated: ' +
    out.generated +
    '\n' +
    '// 出典: ' +
    SOURCE_CREDIT +
    '\n' +
    '// License: ' +
    LICENSE +
    ' (' +
    out.licenseUrl +
    ')\n' +
    '// Source URL: ' +
    out.sourceUrl +
    '\n' +
    '// 件数: ' +
    items.length +
    ' polygons / ' +
    urbanCount +
    ' urban (≤5m DP) / ' +
    ruralCount +
    ' rural (≤50m DP)\n' +
    '// vertex 減: ' +
    totalVerticesBefore +
    ' → ' +
    totalVerticesAfter +
    ' (' +
    ((totalVerticesAfter / totalVerticesBefore) * 100).toFixed(1) +
    '%)\n';
  console.log('  [' + prefName + '] stringify...');
  const body = 'window.' + globalKey + ' = ' + JSON.stringify(out) + ';\n';
  console.log('  [' + prefName + '] write to ' + outFile);
  fs.writeFileSync(outFile, header + body);
  const size = fs.statSync(outFile).size;
  console.log(
    '[build] wrote ' +
      outFile +
      ' size=' +
      (size / 1024).toFixed(1) +
      'KB' +
      ' / polygons=' +
      items.length +
      ' / vertices ' +
      totalVerticesBefore +
      '→' +
      totalVerticesAfter +
      ' (urban=' +
      urbanCount +
      ', rural=' +
      ruralCount +
      (skipped > 0 ? ', skipped=' + skipped : '') +
      ')'
  );
  return { items: items.length, size: size, prefName: prefName };
}

// ─── 全市町村 JIS code を・addresses-coarse-jp から・抽出 ───
function loadCityCodes() {
  const sandbox = {};
  const src = fs.readFileSync(COARSE_JS, 'utf8');
  new Function('window', src)(sandbox);
  const coarse = sandbox.ADDRESSES_COARSE_JP;
  if (!coarse || !Array.isArray(coarse.items)) {
    throw new Error('addresses-coarse-jp.js 読み込み失敗');
  }
  const byPref = {};
  coarse.items.forEach((it) => {
    if (!it.c || typeof it.c !== 'string' || it.c.length !== 5) return;
    const prefCode = it.c.substring(0, 2);
    if (!byPref[prefCode]) byPref[prefCode] = [];
    byPref[prefCode].push(it.c);
  });
  return byPref;
}

function main() {
  const args = process.argv.slice(2);
  const onlyPref = args[0];
  const cityByPref = loadCityCodes();
  const results = [];
  for (const prefCode of Object.keys(PREF_NAMES).sort()) {
    const prefName = PREF_NAMES[prefCode];
    if (onlyPref && onlyPref !== prefName && onlyPref !== prefCode) continue;
    const cityCodes = cityByPref[prefCode] || [];
    if (cityCodes.length === 0) {
      console.log('[build] skip ' + prefName + ' (no city codes)');
      continue;
    }
    const r = buildPref(prefCode, prefName, cityCodes);
    results.push(r);
  }
  // 合計サマリ
  const totalSize = results.reduce((s, r) => s + r.size, 0);
  const totalPoly = results.reduce((s, r) => s + r.items, 0);
  console.log('');
  console.log('===== build summary =====');
  console.log('prefs:', results.length);
  console.log('total polygons:', totalPoly);
  console.log('total size:', (totalSize / 1024 / 1024).toFixed(2), 'MB');
  console.log('avg per pref:', (totalSize / results.length / 1024).toFixed(0), 'KB');
  // 大きい / 小さい 県 top 3
  results.sort((a, b) => b.size - a.size);
  console.log('largest:');
  results
    .slice(0, 3)
    .forEach((r) =>
      console.log(
        '  ' + r.prefName + ' ' + (r.size / 1024).toFixed(0) + 'KB / ' + r.items + ' polys'
      )
    );
}

if (require.main === module) {
  try {
    main();
    process.exit(0);
  } catch (e) {
    console.error('[build] FATAL:', e && (e.stack || e.message));
    process.exit(1);
  }
}

module.exports = {
  topojsonDecode,
  topoArcsToCoords,
  topoGeometryToRings,
  douglasPeucker,
  quantizeRing,
  buildGridIndex,
  buildPref,
};
