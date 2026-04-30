#!/usr/bin/env node
/**
 * GeoJSON道路データ → ダイコメ用 roads-<prefecture>.js 変換 v4
 *
 * v4で追加: 都道府県別分割
 *
 * 圧縮パイプライン（v3踏襲 + 都道府県振り分け）:
 *   1. Douglas-Peucker 5m 簡略化
 *   2. 道路名削除
 *   3. 1e5精度整数化
 *   4. 都道府県振り分け（NEW）：重心からの最近傍
 *   5. デルタ圧縮
 *   6. Varint Zigzag エンコード
 *   7. Base64文字列化
 *
 * 入力: 一地方分のGeoJSON（例：shikoku-roads.geojson）
 * 出力: その地方に含まれる都道府県分の roads-<pref>.js + meta-<region>.json
 *
 * 使い方: node build-roads.js <input.geojson> <output_dir> <region>
 *   ex: node build-roads.js shikoku.geojson data/ shikoku
 *       → data/roads-ehime.js, data/roads-kagawa.js,
 *         data/roads-tokushima.js, data/roads-kochi.js,
 *         data/meta-shikoku.json
 */

const fs = require('fs');
const path = require('path');

const [, , INPUT, OUTPUT_DIR, REGION] = process.argv;
if (!INPUT || !OUTPUT_DIR || !REGION) {
  console.error('Usage: build-roads.js <input.geojson> <output_dir> <region>');
  process.exit(1);
}

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ─── 都道府県データ（重心 + 地方所属）─────────────────────────────
// 各都道府県の重心 [lat, lon] と Geofabrik 地方区分
const PREFECTURES = {
  hokkaido:  [43.3, 142.8],
  // 東北6県
  aomori:    [40.8, 140.7], iwate:    [39.7, 141.2], miyagi:    [38.3, 140.9],
  akita:     [39.7, 140.4], yamagata: [38.2, 140.0], fukushima: [37.4, 140.2],
  // 関東7都県
  ibaraki:   [36.4, 140.4], tochigi:  [36.7, 139.9], gunma:     [36.4, 139.0],
  saitama:   [35.9, 139.4], chiba:    [35.5, 140.2], tokyo:     [35.7, 139.7],
  kanagawa:  [35.4, 139.4],
  // 中部9県
  niigata:   [37.5, 138.9], toyama:   [36.6, 137.2], ishikawa:  [36.6, 136.7],
  fukui:     [35.8, 136.2], yamanashi:[35.6, 138.6], nagano:    [36.2, 138.0],
  gifu:      [35.6, 137.0], shizuoka: [34.9, 138.4], aichi:     [35.1, 137.0],
  // 関西7府県
  mie:       [34.6, 136.5], shiga:    [35.1, 136.1], kyoto:     [35.2, 135.7],
  osaka:     [34.6, 135.5], hyogo:    [35.0, 134.9], nara:      [34.4, 135.8],
  wakayama:  [33.8, 135.5],
  // 中国5県
  tottori:   [35.4, 134.0], shimane:  [35.0, 132.8], okayama:   [34.9, 133.8],
  hiroshima: [34.5, 132.7], yamaguchi:[34.2, 131.6],
  // 四国4県
  tokushima: [33.9, 134.4], kagawa:   [34.3, 134.0],
  ehime:     [33.7, 132.9], kochi:    [33.5, 133.5],
  // 九州沖縄8県
  fukuoka:   [33.6, 130.7], saga:     [33.3, 130.1], nagasaki:  [32.9, 129.9],
  kumamoto:  [32.7, 130.7], oita:     [33.2, 131.4], miyazaki:  [32.0, 131.4],
  kagoshima: [31.4, 130.6], okinawa:  [26.5, 128.0],
};

// 地方 → 都道府県リスト
const REGION_PREFECTURES = {
  hokkaido: ['hokkaido'],
  tohoku:   ['aomori','iwate','miyagi','akita','yamagata','fukushima'],
  kanto:    ['ibaraki','tochigi','gunma','saitama','chiba','tokyo','kanagawa'],
  chubu:    ['niigata','toyama','ishikawa','fukui','yamanashi','nagano','gifu','shizuoka','aichi'],
  kansai:   ['mie','shiga','kyoto','osaka','hyogo','nara','wakayama'],
  chugoku:  ['tottori','shimane','okayama','hiroshima','yamaguchi'],
  shikoku:  ['tokushima','kagawa','ehime','kochi'],
  kyushu:   ['fukuoka','saga','nagasaki','kumamoto','oita','miyazaki','kagoshima','okinawa'],
};

const targetPrefs = REGION_PREFECTURES[REGION];
if (!targetPrefs) throw new Error(`未知の地方: ${REGION}`);
console.log(`  → 地方: ${REGION} (${targetPrefs.length}県: ${targetPrefs.join(', ')})`);

// ─── 道路種別コード ────────────────────────────────────────────────
const TYPE_CODES = {
  motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4,
  unclassified: 5, residential: 6,
  motorway_link: 7, trunk_link: 8, primary_link: 9,
  secondary_link: 10, tertiary_link: 11,
};

// ─── Douglas-Peucker ──────────────────────────────────────────────
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

// ─── Varint + Zigzag ──────────────────────────────────────────────
function zigzagEncode(n) { return (n << 1) ^ (n >> 31); }
function zigzagDecode(n) { return (n >>> 1) ^ -(n & 1); }

function writeVarint(buf, n) {
  while (n >= 0x80) { buf.push((n & 0x7f) | 0x80); n = n >>> 7; }
  buf.push(n & 0x7f);
}
function writeSignedVarint(buf, n) { writeVarint(buf, zigzagEncode(n)); }

// ─── 都道府県判定（重心からの最近傍）──────────────────────────────
// 入力都道府県群の中から、点[lat,lon]に最も近い県を返す
function nearestPrefecture(lat, lon, prefList) {
  let best = null, bestDist = Infinity;
  for (const pref of prefList) {
    const [pLat, pLon] = PREFECTURES[pref];
    // 緯度経度の二乗距離（球面距離は不要・順序判定だけ）
    const dLat = lat - pLat;
    const dLon = lon - pLon;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestDist) { bestDist = d; best = pref; }
  }
  return best;
}

// ─── メイン処理 ─────────────────────────────────────────────────────
console.log(`  → 入力: ${INPUT}`);
const raw = fs.readFileSync(INPUT, 'utf8');
const geo = JSON.parse(raw);
if (!geo.features) throw new Error('Invalid GeoJSON');

let totalRoads = 0;
let totalPointsBefore = 0, totalPointsAfter = 0;
let droppedUnknownType = 0;

// 都道府県別バケット: { ehime: [[typeCode, simplifiedPoints], ...], kagawa: [...], ... }
const buckets = {};
const bboxByPref = {};
for (const p of targetPrefs) { buckets[p] = []; bboxByPref[p] = [Infinity, Infinity, -Infinity, -Infinity]; }

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

    // 中点で都道府県判定
    const midIdx = Math.floor(simplified.length / 2);
    const [midLat, midLon] = simplified[midIdx];
    const pref = nearestPrefecture(midLat / 1e5, midLon / 1e5, targetPrefs);
    if (!pref) continue; // 念のため

    // bbox 更新（県別）
    const bb = bboxByPref[pref];
    for (const [lat, lon] of simplified) {
      if (lat < bb[0]) bb[0] = lat;
      if (lon < bb[1]) bb[1] = lon;
      if (lat > bb[2]) bb[2] = lat;
      if (lon > bb[3]) bb[3] = lon;
    }
    buckets[pref].push([typeCode, simplified]);
    totalRoads++;
  }
}

console.log(`  → 道路数: ${totalRoads}`);
console.log(`  → 不明な道路種別スキップ: ${droppedUnknownType}`);
console.log(`  → 簡略化前後の点数: ${totalPointsBefore} → ${totalPointsAfter} (${((1 - totalPointsAfter / totalPointsBefore) * 100).toFixed(1)}%削減)`);

// ─── 各都道府県についてバイナリ→Base64→.js出力 ───────────────────
const meta = { region: REGION, generated: new Date().toISOString(), prefectures: {} };

for (const pref of targetPrefs) {
  const entries = buckets[pref];
  if (entries.length === 0) {
    console.log(`  → ⚠️  ${pref}: 道路0件（スキップ）`);
    continue;
  }

  // バイナリエンコード
  const byteBuf = [];
  for (const [typeCode, points] of entries) {
    byteBuf.push(typeCode);
    writeVarint(byteBuf, points.length);
    writeSignedVarint(byteBuf, points[0][0]);
    writeSignedVarint(byteBuf, points[0][1]);
    for (let i = 1; i < points.length; i++) {
      writeSignedVarint(byteBuf, points[i][0] - points[i - 1][0]);
      writeSignedVarint(byteBuf, points[i][1] - points[i - 1][1]);
    }
  }

  const buffer = Buffer.from(byteBuf);
  const roadsB64 = buffer.toString('base64');

  // グリッドインデックス（v5: 全通過グリッド登録）
  // 2026/04/30: v4 は道路の始点グリッドにのみ登録していたため、
  //             長い道路の途中を走行中に snap が見つからない問題があった。
  //             v5 では各セグメントの通過グリッド全てに登録することで
  //             snap 成功率を大幅に向上（ファイルサイズは約1.5〜2倍に）。
  const GRID_INT = 1000;
  const grid = {};

  // 線分 A→B の通過グリッドを cells (Set) に追加
  // A, B = [lat_int, lng_int]（precision=1e5 で整数化済み）
  function addCellsAlongSegment(cells, A, B) {
    const dy = B[0] - A[0];
    const dx = B[1] - A[1];
    const dist = Math.sqrt(dy * dy + dx * dx);
    // サンプリング間隔：グリッドサイズの 1/4（漏れなくカバーするため過剰に取る）
    const SAMPLE_INTERVAL = GRID_INT / 4;
    const numSamples = Math.ceil(dist / SAMPLE_INTERVAL);
    if (numSamples <= 1) return; // 短い線分（同じ or 隣接グリッド内）はスキップ
    for (let s = 1; s < numSamples; s++) {
      const t = s / numSamples;
      const lat = A[0] + dy * t;
      const lng = A[1] + dx * t;
      const gy = Math.floor(lat / GRID_INT);
      const gx = Math.floor(lng / GRID_INT);
      cells.add(gy + '_' + gx);
    }
  }

  entries.forEach(([, points], idx) => {
    const cellsForRoad = new Set();
    // 各節点のグリッドを登録
    for (let i = 0; i < points.length; i++) {
      const gy = Math.floor(points[i][0] / GRID_INT);
      const gx = Math.floor(points[i][1] / GRID_INT);
      cellsForRoad.add(gy + '_' + gx);
      // 次の節点との間の通過グリッドも登録
      if (i < points.length - 1) {
        addCellsAlongSegment(cellsForRoad, points[i], points[i + 1]);
      }
    }
    // 通過グリッド全てに idx を登録
    for (const key of cellsForRoad) {
      (grid[key] ||= []).push(idx);
    }
  });

  const PREF_UPPER = pref.toUpperCase().replace(/-/g, '_');
  const out = `// Auto-generated by .github/workflows/osm-update.yml
// Source: Geofabrik ${REGION}-latest.osm.pbf → ${pref}
// Generated: ${new Date().toISOString()}
// Format v5: per-prefecture, binary varint + base64 + 全通過グリッド登録
// © OpenStreetMap contributors (ODbL)
window.ROADS_${PREF_UPPER} = ${JSON.stringify({
    v: 5,
    region: REGION,
    prefecture: pref,
    generated: new Date().toISOString(),
    precision: 1e5,
    bbox: bboxByPref[pref],
    gridSize: GRID_INT,
    numRoads: entries.length,
    types: Object.fromEntries(Object.entries(TYPE_CODES).map(([k, v]) => [v, k])),
    grid,
    roadsB64,
  })};
`;

  const outPath = path.join(OUTPUT_DIR, `roads-${pref}.js`);
  fs.writeFileSync(outPath, out);
  const size = fs.statSync(outPath).size;
  console.log(`  → ${pref}: ${entries.length}本・${(size / 1024 / 1024).toFixed(2)} MB → ${outPath}`);

  meta.prefectures[pref] = {
    numRoads: entries.length,
    sizeBytes: size,
    bbox: bboxByPref[pref],
  };
}

// ─── meta-{region}.json 出力 ──────────────────────────────────────
const metaPath = path.join(OUTPUT_DIR, `meta-${REGION}.json`);
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
console.log(`  → meta: ${metaPath}`);
console.log(`✅ 全${targetPrefs.length}県の出力完了`);
