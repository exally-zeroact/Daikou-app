#!/usr/bin/env node
/**
 * GeoJSON道路データ → ダイコメ用 roads-<region>.js 変換 v2
 *
 * v2で追加された圧縮策:
 *  1. 道路名削除（Map Matchingに不要）
 *  2. 座標精度 1e5 (1m精度・GPS精度より十分高い)
 *  3. 配列形式 [type, [coords]] でキー名を排除
 *  4. Douglas-Peucker 簡略化（直線部の中間点削除）
 *
 * 出力: window.ROADS_<REGION> = { meta, types, grid, roads }
 *  - types: 道路種別の整数コード
 *  - roads: [[type_code, [encoded_coords]], ...]
 *  - grid: 1km四方の空間インデックス
 *
 * 使い方: node build-roads.js input.geojson output.js region_name
 */

const fs = require('fs');

const [, , INPUT, OUTPUT, REGION] = process.argv;
if (!INPUT || !OUTPUT || !REGION) {
  console.error('Usage: build-roads.js <input.geojson> <output.js> <region>');
  process.exit(1);
}

// ─── 道路種別コード（日本語ファイルにする時はここで対応表を見る）─────
const TYPE_CODES = {
  motorway: 0,
  trunk: 1,
  primary: 2,
  secondary: 3,
  tertiary: 4,
  unclassified: 5,
  residential: 6,
  motorway_link: 7,
  trunk_link: 8,
  primary_link: 9,
  secondary_link: 10,
  tertiary_link: 11,
};

// ─── Douglas-Peucker 簡略化 ─────────────────────────────────────────
// tolerance: メートル単位（座標は1e5倍整数なので、5m = 5e-5 deg ≈ 5e-5*1e5 = 5）
// 緯度方向：1度 ≈ 111km、なので5m ≈ 4.5e-5 deg → int換算で4.5
// 経度方向：日本の緯度35°で1度 ≈ 91km、なので5m ≈ 5.5e-5 deg → int換算で5.5
// 簡易的に整数距離 5 として扱う（混合座標で雑だが実用範囲）
const DP_TOLERANCE = 5; // 1e5精度の整数距離

function pointLineDist(p, a, b) {
  // p, a, b は [lat, lon] の整数(1e5倍)
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    return Math.hypot(px - ax, py - ay);
  }
  // 線分abにp点から下ろした垂線
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const tClamped = Math.max(0, Math.min(1, t));
  const projX = ax + tClamped * dx;
  const projY = ay + tClamped * dy;
  return Math.hypot(px - projX, py - projY);
}

function douglasPeucker(points, tolerance) {
  if (points.length < 3) return points;
  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointLineDist(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  if (maxDist > tolerance) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), tolerance);
    const right = douglasPeucker(points.slice(maxIdx), tolerance);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

// ─── メイン処理 ─────────────────────────────────────────────────────
console.log(`  → 入力: ${INPUT}`);
const raw = fs.readFileSync(INPUT, 'utf8');
const geo = JSON.parse(raw);
if (!geo.features) throw new Error('Invalid GeoJSON');

let totalRoads = 0;
let totalPointsBefore = 0;
let totalPointsAfter = 0;
let droppedUnknownType = 0;

const roads = [];
let bbox = [Infinity, Infinity, -Infinity, -Infinity];

for (const f of geo.features) {
  if (!f.geometry) continue;
  const g = f.geometry;
  const lines = g.type === 'LineString' ? [g.coordinates]
              : g.type === 'MultiLineString' ? g.coordinates
              : null;
  if (!lines) continue;

  const props = f.properties || {};
  const highway = props.highway || '';
  const typeCode = TYPE_CODES[highway];
  if (typeCode === undefined) {
    droppedUnknownType++;
    continue;
  }

  for (const coords of lines) {
    if (coords.length < 2) continue;

    // [lon,lat] → [lat,lon] 並び替え + 1e5精度の整数化（ロスをここで確定させる）
    const intPoints = coords.map(([lon, lat]) => [
      Math.round(lat * 1e5),
      Math.round(lon * 1e5),
    ]);
    totalPointsBefore += intPoints.length;

    // Douglas-Peucker 簡略化
    const simplified = douglasPeucker(intPoints, DP_TOLERANCE);
    if (simplified.length < 2) continue;
    totalPointsAfter += simplified.length;

    // bbox更新（1e5精度のまま）
    for (const [lat, lon] of simplified) {
      if (lat < bbox[0]) bbox[0] = lat;
      if (lon < bbox[1]) bbox[1] = lon;
      if (lat > bbox[2]) bbox[2] = lat;
      if (lon > bbox[3]) bbox[3] = lon;
    }

    // デルタ圧縮
    const encoded = [];
    let prevLat = null, prevLon = null;
    for (const [lat, lon] of simplified) {
      if (prevLat === null) {
        encoded.push(lat, lon);
      } else {
        encoded.push(lat - prevLat, lon - prevLon);
      }
      prevLat = lat;
      prevLon = lon;
    }

    // 配列形式で格納： [type_code, [encoded_coords]]
    roads.push([typeCode, encoded]);
    totalRoads++;
  }
}

console.log(`  → 道路数: ${totalRoads}`);
console.log(`  → 不明な道路種別スキップ: ${droppedUnknownType}`);
console.log(`  → 簡略化前後の点数: ${totalPointsBefore} → ${totalPointsAfter} (${((1 - totalPointsAfter / totalPointsBefore) * 100).toFixed(1)}%削減)`);
console.log(`  → bbox(1e5): ${bbox.join(', ')}`);

// ─── グリッドインデックス ──────────────────────────────────────────
// 0.01度グリッド（1e5精度では 1000 単位）
const GRID_INT = 1000; // 0.01度 = 1km四方
const grid = {};
roads.forEach((r, idx) => {
  const startLat = r[1][0]; // 最初の点の絶対値
  const startLon = r[1][1];
  const gy = Math.floor(startLat / GRID_INT);
  const gx = Math.floor(startLon / GRID_INT);
  const key = `${gy}_${gx}`;
  (grid[key] ||= []).push(idx);
});

console.log(`  → グリッドセル数: ${Object.keys(grid).length}`);

// ─── JS出力 ───────────────────────────────────────────────────────
const REGION_UPPER = REGION.toUpperCase().replace(/-/g, '_');
const out = `// Auto-generated by .github/workflows/osm-update.yml
// Source: Geofabrik ${REGION}-latest.osm.pbf
// Generated: ${new Date().toISOString()}
// Format v2: array-form, 1e5 precision, Douglas-Peucker 5m, no names
// © OpenStreetMap contributors (ODbL)
// DO NOT EDIT MANUALLY
window.ROADS_${REGION_UPPER} = ${JSON.stringify({
  v: 2,
  region: REGION,
  generated: new Date().toISOString(),
  precision: 1e5,
  bbox,
  gridSize: GRID_INT,
  types: Object.fromEntries(Object.entries(TYPE_CODES).map(([k, v]) => [v, k])),
  grid,
  roads,
})};
`;

fs.writeFileSync(OUTPUT, out);
const size = fs.statSync(OUTPUT).size;
console.log(`  → 出力サイズ: ${(size / 1024 / 1024).toFixed(2)} MB`);
console.log(`✅ ${OUTPUT} 生成完了`);
