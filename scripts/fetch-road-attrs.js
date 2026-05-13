#!/usr/bin/env node
/**
 * fetch-road-attrs.js
 *
 * 47 都道府県別に road-attrs (緊急輸送道路 + スクールゾーン) を生成する.
 *   ① KSJ N10-24 (緊急輸送道路, per-pref ZIP) をダウンロード+解凍
 *   ② Overpass で hazard=school_zone (per-pref bbox) をダウンロード
 *   ③ 既存 data/roads-{pref}.js (v6) を decode して polyline 化
 *   ④ N10 LineString / school_zone polygon を polyline に spatial match
 *   ⑤ 確定した roadIndices を持った GeoJSON を input/{pref}/{emergency,school}.geojson に出力
 *   ⑥ build-road-attrs.js を呼んで data/road-attrs-{pref}.js を出力
 *
 * 使い方:
 *   node scripts/fetch-road-attrs.js <pref>
 *
 * 依存: shapefile (npm i -g shapefile), iconv-lite (local), Overpass API
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function requireGlobal(name) {
  try { return require(name); } catch {}
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(root, name));
}
const shapefile = requireGlobal('shapefile');

const PREFS = {
  hokkaido:  '01',
  aomori:    '02', iwate:     '03', miyagi:    '04', akita:    '05', yamagata: '06', fukushima: '07',
  ibaraki:   '08', tochigi:   '09', gunma:     '10',
  saitama:   '11', chiba:     '12', tokyo:     '13', kanagawa:  '14',
  niigata:   '15', toyama:    '16', ishikawa:  '17', fukui:     '18',
  yamanashi: '19', nagano:    '20', gifu:      '21', shizuoka:  '22', aichi:    '23',
  mie:       '24', shiga:     '25', kyoto:     '26', osaka:     '27',
  hyogo:     '28', nara:      '29', wakayama:  '30',
  tottori:   '31', shimane:   '32', okayama:   '33', hiroshima: '34', yamaguchi:'35',
  tokushima: '36', kagawa:    '37', ehime:     '38', kochi:     '39',
  fukuoka:   '40', saga:      '41', nagasaki:  '42', kumamoto:  '43',
  oita:      '44', miyazaki:  '45', kagoshima: '46', okinawa:   '47',
};

const PREF = process.argv[2];
if (!PREF || !PREFS[PREF]) {
  console.error('Usage: fetch-road-attrs.js <pref>');
  console.error('Available:', Object.keys(PREFS).join(' '));
  process.exit(1);
}
const PCODE = PREFS[PREF];
const PROJECT_ROOT = path.join(__dirname, '..');
const INPUT_DIR = path.join(PROJECT_ROOT, 'input', PREF);
const RAW_DIR = path.join(INPUT_DIR, 'raw');
fs.mkdirSync(INPUT_DIR, { recursive: true });
fs.mkdirSync(RAW_DIR, { recursive: true });

const UA = { 'User-Agent': 'Daikou-app-test/0.1 (zeroact24.729@outlook.com)' };
const TOLERANCE_M = 30;        // 道路マッチング許容距離
const PRECISION = 1e5;
const GRID_INT = 1000;         // grid cell = 0.01 deg

async function fetchBuffer(url, timeoutMs = 600000, init) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: UA, ...init });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally { clearTimeout(t); }
}

function unzipTo(zipPath, dir) {
  fs.mkdirSync(dir, { recursive: true });
  try { execSync(`unzip -o "${zipPath}" -d "${dir}"`, { stdio: 'pipe' }); }
  catch (e) { if (e.status > 1) throw e; }
}

function findFiles(dir, pattern) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findFiles(p, pattern));
    else if (pattern.test(e.name)) out.push(p);
  }
  return out;
}

// ─── Step 1: N10 (緊急輸送道路) ─────────────────────────────────────
async function fetchN10() {
  const fname = `N10-24_${PCODE}_GML.zip`;
  const zipPath = path.join(RAW_DIR, fname);
  if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size < 1024) {
    const url = `https://nlftp.mlit.go.jp/ksj/gml/data/N10/N10-24/${fname}`;
    console.log(`  DL: ${url}`);
    const buf = await fetchBuffer(url);
    fs.writeFileSync(zipPath, buf);
    console.log(`  saved (${(buf.length/1024).toFixed(1)} KB)`);
  } else {
    console.log(`  cache: ${fname} (${(fs.statSync(zipPath).size/1024).toFixed(1)} KB)`);
  }
  const extractDir = path.join(RAW_DIR, `N10-24_${PCODE}_GML`);
  unzipTo(zipPath, extractDir);
  const shps = findFiles(extractDir, /\.shp$/i);
  if (shps.length === 0) throw new Error('N10 SHP 見つからず');
  const features = [];
  for (const shpPath of shps) {
    const dbfPath = shpPath.replace(/\.shp$/i, '.dbf');
    if (!fs.existsSync(dbfPath)) continue;
    const src = await shapefile.open(shpPath, dbfPath);
    while (true) {
      const r = await src.read();
      if (r.done) break;
      if (!r.value.geometry) continue;
      const g = r.value.geometry;
      if (g.type !== 'LineString' && g.type !== 'MultiLineString') continue;
      features.push(r.value);
    }
  }
  console.log(`  N10: ${features.length} LineString features`);
  return features;
}

// ─── Step 2: Overpass hazard=school_zone ────────────────────────────
async function fetchSchoolZones(bbox) {
  // bbox は roads-{pref}.js の bbox (1e5 int) → 度に変換
  const [minLat, minLng, maxLat, maxLng] = bbox.map(v => v / PRECISION);
  // hazard=school_zone と zone:traffic=school 両方拾う (OSM タグ揺れ対策)
  const q = `[out:json][timeout:180];
(
  way["hazard"="school_zone"](${minLat},${minLng},${maxLat},${maxLng});
  way["zone:traffic"~"school"](${minLat},${minLng},${maxLat},${maxLng});
  relation["hazard"="school_zone"](${minLat},${minLng},${maxLat},${maxLng});
  relation["zone:traffic"~"school"](${minLat},${minLng},${maxLat},${maxLng});
);
out geom;`;
  const ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];
  let lastErr;
  for (const ep of ENDPOINTS) {
    try {
      console.log(`  Overpass POST ${ep}`);
      const buf = await fetchBuffer(ep, 240000, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(q),
        headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const json = JSON.parse(buf.toString('utf8'));
      const elems = json.elements || [];
      console.log(`  school_zone elements: ${elems.length}`);
      return elems;
    } catch (err) {
      console.log(`  Overpass ${ep} 失敗: ${err.message}`);
      lastErr = err;
    }
  }
  throw lastErr || new Error('Overpass 全 endpoint 失敗');
}

function osmToFeatures(elements) {
  const features = [];
  for (const e of elements) {
    if (e.type === 'way' && Array.isArray(e.geometry)) {
      const coords = e.geometry.map(p => [p.lon, p.lat]);
      if (coords.length < 3) continue;
      // first/last が同じなら polygon 扱い、違えば line 扱い
      features.push({
        type: 'Feature',
        properties: { osm_id: e.id, ...e.tags },
        geometry: { type: 'Polygon', coordinates: [coords] },
      });
    } else if (e.type === 'relation' && Array.isArray(e.members)) {
      // 簡易: 各 way member を独立 polygon として追加
      for (const m of e.members) {
        if (m.type !== 'way' || !Array.isArray(m.geometry)) continue;
        const coords = m.geometry.map(p => [p.lon, p.lat]);
        if (coords.length < 3) continue;
        features.push({
          type: 'Feature',
          properties: { osm_id: e.id, role: m.role, ...e.tags },
          geometry: { type: 'Polygon', coordinates: [coords] },
        });
      }
    }
  }
  return features;
}

// ─── Step 3: roads-{pref}.js decoder ────────────────────────────────
function readVarint(buf, pos) {
  let n = 0, shift = 0;
  while (true) {
    const b = buf[pos++];
    n |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return [n, pos];
}
function zigzagDecode(n) { return (n >>> 1) ^ -(n & 1); }
function readSignedVarint(buf, pos) {
  const [n, p] = readVarint(buf, pos);
  return [zigzagDecode(n), p];
}

function decodeRoadsJs(jsPath) {
  const text = fs.readFileSync(jsPath, 'utf8');
  // window.X = { ... }; を抽出 (AKID 分割の "+" で連結された文字列も含む)
  const m = text.match(/window\.\w+\s*=\s*(\{[\s\S]*\})\s*;\s*$/);
  if (!m) throw new Error(`window.X = {...}; パターン抽出失敗: ${jsPath}`);
  // 評価 (JS としての文字列連結含む)
  // eslint-disable-next-line no-new-func
  const obj = (new Function(`"use strict"; return ${m[1]};`))();
  const buf = Buffer.from(obj.roadsB64, 'base64');
  const numRoads = obj.numRoads;
  let pos = 0;
  const roads = new Array(numRoads);
  for (let i = 0; i < numRoads; i++) {
    const bitmap = buf.readUInt16LE(pos); pos += 2;
    let n; [n, pos] = readVarint(buf, pos);
    const numPts = n;
    const points = new Array(numPts);
    if (numPts === 0) { roads[i] = { idx: i, bitmap, points }; continue; }
    let [lat, p1] = readSignedVarint(buf, pos); pos = p1;
    let [lng, p2] = readSignedVarint(buf, pos); pos = p2;
    points[0] = [lat, lng];
    for (let j = 1; j < numPts; j++) {
      let [dLat, q1] = readSignedVarint(buf, pos); pos = q1;
      let [dLng, q2] = readSignedVarint(buf, pos); pos = q2;
      lat += dLat; lng += dLng;
      points[j] = [lat, lng];
    }
    roads[i] = { idx: i, bitmap, points };
  }
  return { roads, bbox: obj.bbox, precision: obj.precision };
}

// ─── Step 4: 空間マッチング ────────────────────────────────────────
function buildRoadGrid(roads) {
  const grid = new Map();
  function add(key, idx) {
    let arr = grid.get(key);
    if (!arr) { arr = []; grid.set(key, arr); }
    arr.push(idx);
  }
  for (const r of roads) {
    const seen = new Set();
    const pts = r.points;
    for (let i = 0; i < pts.length; i++) {
      const gy = Math.floor(pts[i][0] / GRID_INT);
      const gx = Math.floor(pts[i][1] / GRID_INT);
      seen.add(gy + '_' + gx);
      if (i < pts.length - 1) {
        const dy = pts[i+1][0] - pts[i][0];
        const dx = pts[i+1][1] - pts[i][1];
        const dist = Math.sqrt(dy*dy + dx*dx);
        const numSamples = Math.ceil(dist / (GRID_INT / 4));
        for (let s = 1; s < numSamples; s++) {
          const t = s / numSamples;
          const lat = pts[i][0] + dy * t;
          const lng = pts[i][1] + dx * t;
          const ggy = Math.floor(lat / GRID_INT);
          const ggx = Math.floor(lng / GRID_INT);
          seen.add(ggy + '_' + ggx);
        }
      }
    }
    for (const k of seen) add(k, r.idx);
  }
  return grid;
}

// 1e5 整数座標での点-線分距離 2 乗 (近似 Euclid)
function ptSegDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx*dx + dy*dy;
  if (len2 === 0) {
    const ex = px - ax, ey = py - ay;
    return ex*ex + ey*ey;
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = ax + dx * t, cy = ay + dy * t;
  const ex = px - cx, ey = py - cy;
  return ex*ex + ey*ey;
}

// 1e5 整数距離平方 → メートル
// 緯度方向: 1e5 unit = 0.00001 deg ≈ 1.11 m  (実測 111000m/deg)
// 経度方向: cos(lat) で補正必要だが日本緯度帯では概ね 0.81-0.91. 簡易 fixed 0.83 で近似.
function intDist2ToM(d2, latI) {
  // d2 は (lat int)^2 + (lng int)^2 = (deg×1e5)^2 だが,
  // 経度方向は緯度依存なので両軸ごとに補正したい. しかし呼出側は lat/lng の差分単位を分けていない.
  // → 簡易: 1e5 unit ≒ 1.0m として cos 補正は呼出側で.
  // ここでは緯度補正係数 cos(lat) を仮定して dy^2 + (dx*cos)^2 を返したいが
  // ptSegDist2 は dx/dy 区別不能のため, 別関数 ptSegDist2LatLng を用意する.
  return d2;
}

// 経度 cos 補正版
function ptSegDist2LatLng(latP, lngP, latA, lngA, latB, lngB, cosLat) {
  // 1e5 int → 度 → m へ. latI = lat * 1e5 → lat度. m差分: dy_m = (lat - latRef)*1e5_unit → 1e5 unit = 0.00001 deg = 1.11m
  // 簡易: 1 int unit = 1.11 m (lat方向), 1.11*cosLat m (lng方向). m^2 で扱う.
  const M_PER_INT_LAT = 1.11;             // 1 int (=0.00001 deg) ≈ 1.11 m
  const M_PER_INT_LNG = 1.11 * cosLat;
  const ax = (lngA - lngP) * M_PER_INT_LNG;
  const ay = (latA - latP) * M_PER_INT_LAT;
  const bx = (lngB - lngP) * M_PER_INT_LNG;
  const by = (latB - latP) * M_PER_INT_LAT;
  // 点 P を原点とした座標系で線分 (A,B) との距離 2 乗
  const dx = bx - ax, dy = by - ay;
  const len2 = dx*dx + dy*dy;
  if (len2 === 0) return ax*ax + ay*ay;
  let t = (-ax * dx - ay * dy) / len2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = ax + dx * t, cy = ay + dy * t;
  return cx*cx + cy*cy;
}

function nearestRoadsForLine(coords, grid, roads, toleranceM) {
  // coords: [[lng, lat], ...] (GeoJSON 順)
  const matched = new Set();
  const tol2 = toleranceM * toleranceM;
  // 各セグメントを GRID_INT/4 程度の間隔でサンプリング
  for (let i = 0; i < coords.length; i++) {
    const [lng1, lat1] = coords[i];
    const next = coords[i + 1];
    const cosLat = Math.cos(lat1 * Math.PI / 180);
    const lat1I = Math.round(lat1 * PRECISION);
    const lng1I = Math.round(lng1 * PRECISION);
    samplePoint(lat1I, lng1I, cosLat);
    if (next) {
      const [lng2, lat2] = next;
      const lat2I = Math.round(lat2 * PRECISION);
      const lng2I = Math.round(lng2 * PRECISION);
      const dy = lat2I - lat1I;
      const dx = lng2I - lng1I;
      const dist = Math.sqrt(dy*dy + dx*dx);
      const numSamples = Math.ceil(dist / (GRID_INT / 4));
      for (let s = 1; s < numSamples; s++) {
        const t = s / numSamples;
        samplePoint(Math.round(lat1I + dy*t), Math.round(lng1I + dx*t), cosLat);
      }
    }
  }
  function samplePoint(latI, lngI, cosLat) {
    const gy = Math.floor(latI / GRID_INT);
    const gx = Math.floor(lngI / GRID_INT);
    const candidates = new Set();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cell = grid.get((gy + dy) + '_' + (gx + dx));
        if (cell) for (const idx of cell) candidates.add(idx);
      }
    }
    for (const idx of candidates) {
      if (matched.has(idx)) continue;
      const r = roads[idx];
      const pts = r.points;
      let minD2 = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const d2 = ptSegDist2LatLng(latI, lngI, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1], cosLat);
        if (d2 < minD2) minD2 = d2;
        if (minD2 <= tol2) break;
      }
      if (minD2 <= tol2) matched.add(idx);
    }
  }
  return matched;
}

function nearestRoadsForPolygon(rings, grid, roads, toleranceM) {
  // 多角形 → 内部+境界. 簡易: 境界線として扱い, さらに重心でも 1 サンプル.
  const matched = new Set();
  for (const ring of rings) {
    const m = nearestRoadsForLine(ring, grid, roads, toleranceM);
    for (const idx of m) matched.add(idx);
  }
  return matched;
}

// ─── Step 5: メイン ─────────────────────────────────────────────────
(async () => {
  console.log(`[fetch-road-attrs] pref=${PREF} pcode=${PCODE}`);
  const t0 = Date.now();

  // ① roads-{pref}.js decode
  const roadsPath = path.join(PROJECT_ROOT, 'data', `roads-${PREF}.js`);
  if (!fs.existsSync(roadsPath)) {
    console.error(`❌ ${roadsPath} 無し. roads v6 build を先に実行してください.`);
    process.exit(1);
  }
  console.log('[1/5] roads-{pref}.js decode');
  const decoded = decodeRoadsJs(roadsPath);
  console.log(`  numRoads=${decoded.roads.length}  bbox=${decoded.bbox.join(',')}`);

  console.log('[2/5] road grid 構築');
  const grid = buildRoadGrid(decoded.roads);
  console.log(`  grid cells=${grid.size}`);

  // ② N10 緊急輸送道路
  console.log('[3/5] N10 (緊急輸送道路) DL + 抽出');
  const n10features = await fetchN10();

  // ③ Overpass school_zone
  console.log('[4/5] Overpass hazard=school_zone DL');
  let schoolFeatures = [];
  try {
    const elems = await fetchSchoolZones(decoded.bbox);
    schoolFeatures = osmToFeatures(elems);
  } catch (e) {
    console.log(`  Overpass 失敗: ${e.message} → 0件で続行`);
  }
  console.log(`  school polygons: ${schoolFeatures.length}`);

  // ④ matching
  console.log('[5/5] spatial matching');
  const tStart = Date.now();
  const emergencyIdx = new Set();
  for (const f of n10features) {
    const g = f.geometry;
    if (g.type === 'LineString') {
      const m = nearestRoadsForLine(g.coordinates, grid, decoded.roads, TOLERANCE_M);
      for (const i of m) emergencyIdx.add(i);
    } else if (g.type === 'MultiLineString') {
      for (const ls of g.coordinates) {
        const m = nearestRoadsForLine(ls, grid, decoded.roads, TOLERANCE_M);
        for (const i of m) emergencyIdx.add(i);
      }
    }
  }
  console.log(`  emergency matched: ${emergencyIdx.size} / ${decoded.roads.length} (${(Date.now()-tStart)/1000|0}s)`);

  const schoolIdx = new Set();
  for (const f of schoolFeatures) {
    const g = f.geometry;
    if (g.type === 'Polygon') {
      const m = nearestRoadsForPolygon(g.coordinates, grid, decoded.roads, TOLERANCE_M);
      for (const i of m) schoolIdx.add(i);
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) {
        const m = nearestRoadsForPolygon(poly, grid, decoded.roads, TOLERANCE_M);
        for (const i of m) schoolIdx.add(i);
      }
    }
  }
  console.log(`  school matched: ${schoolIdx.size} / ${decoded.roads.length}`);

  // ⑤ output GeoJSON with roadIndices
  const emergencyOut = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { roadIndices: [...emergencyIdx].sort((a,b) => a-b), source: 'KSJ N10-24', count: emergencyIdx.size },
      geometry: { type: 'GeometryCollection', geometries: [] },
    }],
  };
  const schoolOut = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { roadIndices: [...schoolIdx].sort((a,b) => a-b), source: 'OSM hazard=school_zone', count: schoolIdx.size },
      geometry: { type: 'GeometryCollection', geometries: [] },
    }],
  };
  const emergencyPath = path.join(INPUT_DIR, 'emergency.geojson');
  const schoolPath = path.join(INPUT_DIR, 'school.geojson');
  fs.writeFileSync(emergencyPath, JSON.stringify(emergencyOut));
  fs.writeFileSync(schoolPath, JSON.stringify(schoolOut));

  // ⑥ build-road-attrs.js を呼ぶ
  console.log('[6/6] build-road-attrs.js 呼出');
  execSync(`node "${path.join(__dirname, 'build-road-attrs.js')}" ${PREF} "${emergencyPath}" "${schoolPath}"`,
    { stdio: 'inherit' });

  console.log(`✅ ${PREF} 完了 (${((Date.now()-t0)/1000).toFixed(1)}s)`);
})().catch(e => { console.error('FATAL:', e.stack || e); process.exit(1); });
