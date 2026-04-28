#!/usr/bin/env node
/**
 * GeoJSON道路データ → ダイコメ用 roads-<region>.js 変換 v3
 *
 * v3で追加: バイナリエンコーディング（Varint + Zigzag + Base64）
 *
 * 圧縮パイプライン:
 *   1. Douglas-Peucker 5m 簡略化（v2踏襲）
 *   2. 道路名削除（v2踏襲）
 *   3. 1e5精度整数化（v2踏襲）
 *   4. デルタ圧縮（v2踏襲）
 *   5. Varint Zigzag エンコード（v3新規）
 *   6. Base64文字列化（v3新規）
 *
 * 出力フォーマット:
 *   window.ROADS_<REGION> = {
 *     v: 3,
 *     ...meta,
 *     types: {0: "motorway", ...},
 *     grid: {gy_gx: [roadIdx,...]},
 *     roadsB64: "base64string..."
 *   }
 *
 * 使い方: node build-roads.js input.geojson output.js region_name
 */

const fs = require('fs');

const [, , INPUT, OUTPUT, REGION] = process.argv;
if (!INPUT || !OUTPUT || !REGION) {
  console.error('Usage: build-roads.js <input.geojson> <output.js> <region>');
  process.exit(1);
}

// ─── 道路種別コード ────────────────────────────────────────────────
const TYPE_CODES = {
  motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4,
  unclassified: 5, residential: 6,
  motorway_link: 7, trunk_link: 8, primary_link: 9,
  secondary_link: 10, tertiary_link: 11,
};

// ─── Douglas-Peucker（v2と同じ）────────────────────────────────────
const DP_TOLERANCE = 5;

function pointLineDist(p, a, b) {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const tC = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + tC * dx), py - (ay + tC * dy));
}

function douglasPeucker(points, tolerance) {
  if (points.length < 3) return points;
  let maxDist = 0, maxIdx = 0;
  const first = points[0], last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointLineDist(points[i], first, last);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > tolerance) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), tolerance);
    const right = douglasPeucker(points.slice(maxIdx), tolerance);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

// ─── Varint + Zigzag エンコーディング（v3新規）─────────────────────
// Zigzag: 符号付き整数を符号なしへマップ（小さい絶対値が小さいバイト数になる）
function zigzagEncode(n) {
  return (n << 1) ^ (n >> 31);
}

// Varint: 7ビットずつバイトに分割・MSBで継続フラグ
function writeVarint(buf, n) {
  // n は >= 0 の前提（zigzag後の値）
  while (n >= 0x80) {
    buf.push((n & 0x7f) | 0x80);
    n = n >>> 7;
  }
  buf.push(n & 0x7f);
}

function writeSignedVarint(buf, n) {
  writeVarint(buf, zigzagEncode(n));
}

// ─── デコーダ（検証用）─────────────────────────────────────────────
function zigzagDecode(n) {
  return (n >>> 1) ^ -(n & 1);
}

function decodeAll(bytes) {
  const roads = [];
  let i = 0;
  while (i < bytes.length) {
    const typeCode = bytes[i++];

    // num_points (varint)
    let numPoints = 0, shift = 0;
    while (true) {
      const b = bytes[i++];
      numPoints |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }

    // first_lat, first_lon (signed varint)
    function readSigned() {
      let v = 0, sh = 0;
      while (true) {
        const b = bytes[i++];
        v |= (b & 0x7f) << sh;
        if ((b & 0x80) === 0) break;
        sh += 7;
      }
      return zigzagDecode(v);
    }
    const points = [];
    let lat = readSigned(), lon = readSigned();
    points.push([lat, lon]);
    for (let k = 1; k < numPoints; k++) {
      lat += readSigned();
      lon += readSigned();
      points.push([lat, lon]);
    }
    roads.push([typeCode, points]);
  }
  return roads;
}

// ─── メイン処理 ─────────────────────────────────────────────────────
console.log(`  → 入力: ${INPUT}`);
const raw = fs.readFileSync(INPUT, 'utf8');
const geo = JSON.parse(raw);
if (!geo.features) throw new Error('Invalid GeoJSON');

let totalRoads = 0;
let totalPointsBefore = 0, totalPointsAfter = 0;
let droppedUnknownType = 0;

// 道路ごとの (typeCode, simplified[][]) を蓄積
const roadEntries = [];
let bbox = [Infinity, Infinity, -Infinity, -Infinity];

for (const f of geo.features) {
  if (!f.geometry) continue;
  const g = f.geometry;
  const lines = g.type === 'LineString' ? [g.coordinates]
              : g.type === 'MultiLineString' ? g.coordinates : null;
  if (!lines) continue;

  const props = f.properties || {};
  const typeCode = TYPE_CODES[props.highway];
  if (typeCode === undefined) { droppedUnknownType++; continue; }

  for (const coords of lines) {
    if (coords.length < 2) continue;
    const intPoints = coords.map(([lon, lat]) => [
      Math.round(lat * 1e5), Math.round(lon * 1e5),
    ]);
    totalPointsBefore += intPoints.length;
    const simplified = douglasPeucker(intPoints, DP_TOLERANCE);
    if (simplified.length < 2) continue;
    totalPointsAfter += simplified.length;

    for (const [lat, lon] of simplified) {
      if (lat < bbox[0]) bbox[0] = lat;
      if (lon < bbox[1]) bbox[1] = lon;
      if (lat > bbox[2]) bbox[2] = lat;
      if (lon > bbox[3]) bbox[3] = lon;
    }
    roadEntries.push([typeCode, simplified]);
    totalRoads++;
  }
}

console.log(`  → 道路数: ${totalRoads}`);
console.log(`  → 不明な道路種別スキップ: ${droppedUnknownType}`);
console.log(`  → 簡略化前後の点数: ${totalPointsBefore} → ${totalPointsAfter} (${((1 - totalPointsAfter / totalPointsBefore) * 100).toFixed(1)}%削減)`);

// ─── バイナリエンコード ────────────────────────────────────────────
const byteBuf = [];
for (const [typeCode, points] of roadEntries) {
  byteBuf.push(typeCode);                      // 種別 1B
  writeVarint(byteBuf, points.length);         // 点数 varint

  // 最初の点（絶対値）
  writeSignedVarint(byteBuf, points[0][0]);
  writeSignedVarint(byteBuf, points[0][1]);

  // 残りの点（デルタ）
  for (let i = 1; i < points.length; i++) {
    writeSignedVarint(byteBuf, points[i][0] - points[i - 1][0]);
    writeSignedVarint(byteBuf, points[i][1] - points[i - 1][1]);
  }
}

const binarySize = byteBuf.length;
console.log(`  → バイナリサイズ: ${(binarySize / 1024 / 1024).toFixed(2)} MB`);

// Base64エンコード
const buffer = Buffer.from(byteBuf);
const roadsB64 = buffer.toString('base64');
console.log(`  → Base64サイズ: ${(roadsB64.length / 1024 / 1024).toFixed(2)} MB`);

// ─── 自己検証（エンコード→デコードで一致するか）────────────────────
const decoded = decodeAll(byteBuf);
if (decoded.length !== roadEntries.length) {
  throw new Error(`検証失敗: ${roadEntries.length} → ${decoded.length}`);
}
let mismatch = 0;
for (let i = 0; i < Math.min(100, decoded.length); i++) {
  const orig = roadEntries[i];
  const dec = decoded[i];
  if (orig[0] !== dec[0]) mismatch++;
  if (orig[1].length !== dec[1].length) mismatch++;
  for (let j = 0; j < orig[1].length; j++) {
    if (orig[1][j][0] !== dec[1][j][0] || orig[1][j][1] !== dec[1][j][1]) mismatch++;
  }
}
if (mismatch > 0) throw new Error(`検証失敗: ${mismatch}件不一致`);
console.log(`  → ✅ エンコード/デコード検証OK（先頭100本サンプル）`);

// ─── グリッドインデックス ─────────────────────────────────────────
const GRID_INT = 1000;
const grid = {};
roadEntries.forEach(([, points], idx) => {
  const gy = Math.floor(points[0][0] / GRID_INT);
  const gx = Math.floor(points[0][1] / GRID_INT);
  const key = `${gy}_${gx}`;
  (grid[key] ||= []).push(idx);
});
console.log(`  → グリッドセル数: ${Object.keys(grid).length}`);

// ─── JS出力 ───────────────────────────────────────────────────────
const REGION_UPPER = REGION.toUpperCase().replace(/-/g, '_');
const out = `// Auto-generated by .github/workflows/osm-update.yml
// Source: Geofabrik ${REGION}-latest.osm.pbf
// Generated: ${new Date().toISOString()}
// Format v3: binary varint + base64
// © OpenStreetMap contributors (ODbL)
// DO NOT EDIT MANUALLY
window.ROADS_${REGION_UPPER} = ${JSON.stringify({
  v: 3,
  region: REGION,
  generated: new Date().toISOString(),
  precision: 1e5,
  bbox,
  gridSize: GRID_INT,
  numRoads: totalRoads,
  types: Object.fromEntries(Object.entries(TYPE_CODES).map(([k, v]) => [v, k])),
  grid,
  roadsB64,
})};
`;

fs.writeFileSync(OUTPUT, out);
const size = fs.statSync(OUTPUT).size;
console.log(`  → 出力サイズ: ${(size / 1024 / 1024).toFixed(2)} MB`);
console.log(`✅ ${OUTPUT} 生成完了`);
