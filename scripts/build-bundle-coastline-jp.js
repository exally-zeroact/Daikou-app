#!/usr/bin/env node
/**
 * build-bundle-coastline-jp.js
 *
 * 8地方ごとに natural=coastline ways を抽出 → DP簡略化 → varint+base64
 *
 * データ取得:
 *   1. 地方PBF（Geofabrik / openstreetmap.fr ミラー）が tmp/ にあれば使用
 *   2. 無い／壊れていれば Overpass API（overpass-api.de）で bbox クエリにフォールバック
 *      Geofabrik は kanto/chubu/kansai/kyushu で頻繁にタイムアウトするため Overpass を併用。
 *
 * 出力: data/coastline-jp.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const u = require('./bundle-utils.js');

function requireGlobal(name) {
  try { return require(name); } catch {}
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(root, name));
}
const parseOsmPbf = requireGlobal('osm-pbf-parser');
const through = requireGlobal('through2');

const PROJECT_ROOT = path.join(__dirname, '..');
const TMP = path.join(PROJECT_ROOT, 'tmp');
const OUT = path.join(PROJECT_ROOT, 'data', 'coastline-jp.js');

const REGIONS = ['hokkaido','tohoku','kanto','chubu','kansai','chugoku','shikoku','kyushu'];

// Overpass フォールバック用 bbox [south, west, north, east]
// Geofabrik 地方区分を概ねカバー。重複は wayId で重複排除する。
const REGION_BBOX = {
  hokkaido: [41.30, 139.30, 45.70, 146.10],
  tohoku:   [36.70, 138.70, 41.65, 142.20],
  kanto:    [34.50, 138.40, 37.30, 141.10],
  chubu:    [33.40, 135.50, 38.40, 140.00],
  kansai:   [33.30, 133.90, 36.50, 136.80],
  chugoku:  [33.60, 130.70, 36.00, 134.60],
  shikoku:  [32.50, 131.90, 34.80, 134.90],
  kyushu:   [24.00, 122.80, 34.90, 132.40], // 沖縄含む
};

const PBF_OK_BYTES = 50 * 1024 * 1024; // <50MB なら部分DLとみなしフォールバック

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// ---- Douglas-Peucker ----
function pointLineDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0]-a[0], p[1]-a[1]);
  const t = Math.max(0, Math.min(1, ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / (dx*dx + dy*dy)));
  return Math.hypot(p[0]-(a[0]+t*dx), p[1]-(a[1]+t*dy));
}
function douglasPeucker(pts, tol) {
  if (pts.length < 3) return pts;
  let maxD = 0, maxIdx = 0;
  const a = pts[0], b = pts[pts.length-1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointLineDist(pts[i], a, b);
    if (d > maxD) { maxD = d; maxIdx = i; }
  }
  if (maxD > tol) {
    return douglasPeucker(pts.slice(0, maxIdx+1), tol).slice(0,-1)
      .concat(douglasPeucker(pts.slice(maxIdx), tol));
  }
  return [a, b];
}

// ---- PBF 経由抽出 ----
async function extractFromPbf(pbfPath) {
  const ways = []; // { id, coords:[[lng,lat]...] }

  // Pass 1: way (natural=coastline) を集めて nodeIds を記録
  const coastlineWays = []; // [{ id, refs:[nodeId,...] }]
  const neededNodes = new Set();
  await new Promise((resolve, reject) => {
    fs.createReadStream(pbfPath)
      .pipe(parseOsmPbf())
      .pipe(through.obj((items, _enc, next) => {
        for (const item of items) {
          if (item.type === 'way' && item.tags && item.tags.natural === 'coastline') {
            coastlineWays.push({ id: item.id, refs: item.refs });
            for (const id of item.refs) neededNodes.add(id);
          }
        }
        next();
      }, () => resolve()))
      .on('error', reject);
  });

  if (coastlineWays.length === 0) return [];

  // Pass 2: 必要な node の lat/lng
  const nodeMap = new Map();
  await new Promise((resolve, reject) => {
    fs.createReadStream(pbfPath)
      .pipe(parseOsmPbf())
      .pipe(through.obj((items, _enc, next) => {
        for (const item of items) {
          if (item.type === 'node' && neededNodes.has(item.id)) {
            nodeMap.set(item.id, [item.lon, item.lat]);
          }
        }
        next();
      }, () => resolve()))
      .on('error', reject);
  });

  for (const w of coastlineWays) {
    const coords = [];
    for (const id of w.refs) {
      const c = nodeMap.get(id);
      if (c) coords.push(c);
    }
    if (coords.length >= 2) ways.push({ id: w.id, coords });
  }
  return ways;
}

// ---- Overpass API 経由抽出 ----
async function fetchOverpass(bbox) {
  const [s, w, n, e] = bbox;
  const query =
    `[out:json][timeout:600];` +
    `(way["natural"="coastline"](${s},${w},${n},${e}););` +
    `out geom;`;

  let lastErr = null;
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 600000);
      try {
        const res = await fetch(ep, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'User-Agent': 'Daikou-app-test/0.1', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const json = await res.json();
        return json;
      } finally { clearTimeout(t); }
    } catch (err) {
      console.log(`    overpass ${ep} 失敗: ${err.message}, 次のミラーへ`);
      lastErr = err;
    }
  }
  throw lastErr || new Error('all overpass endpoints failed');
}

async function extractFromOverpass(region, bbox) {
  const cachePath = path.join(TMP, `coastline-overpass-${region}.json`);
  let json;
  if (fs.existsSync(cachePath) && (Date.now() - fs.statSync(cachePath).mtimeMs) < 7 * 86400000) {
    console.log(`    overpass cache: ${path.basename(cachePath)}`);
    json = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } else {
    console.log(`    overpass query: bbox=[${bbox.join(',')}]`);
    const t0 = Date.now();
    json = await fetchOverpass(bbox);
    console.log(`    overpass got ${(json.elements || []).length} elements / ${((Date.now()-t0)/1000).toFixed(1)}s`);
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(json));
  }
  const ways = [];
  for (const el of (json.elements || [])) {
    if (el.type !== 'way' || !el.geometry) continue;
    const coords = el.geometry.map(g => [g.lon, g.lat]);
    if (coords.length >= 2) ways.push({ id: el.id, coords });
  }
  return ways;
}

(async () => {
  const TOL_DEG = 0.0005; // ≈50m
  const seenWayIds = new Set();
  const allLines = [];

  for (const region of REGIONS) {
    console.log(`▼ ${region}`);
    const pbfPath = path.join(TMP, `${region}-latest.osm.pbf`);
    const hasPbf = fs.existsSync(pbfPath) && fs.statSync(pbfPath).size >= PBF_OK_BYTES;

    let ways = [];
    if (hasPbf) {
      try {
        const t0 = Date.now();
        console.log(`  PBF parse (${(fs.statSync(pbfPath).size/1024/1024).toFixed(1)} MB)`);
        ways = await extractFromPbf(pbfPath);
        console.log(`  PBF: ${ways.length} coastline ways / ${((Date.now()-t0)/1000).toFixed(1)}s`);
      } catch (err) {
        console.log(`  PBF parse 失敗: ${err.message}, Overpass フォールバック`);
        ways = [];
      }
    } else {
      console.log(`  PBF 無い／部分DL → Overpass フォールバック`);
    }

    if (ways.length === 0 && REGION_BBOX[region]) {
      try {
        ways = await extractFromOverpass(region, REGION_BBOX[region]);
        console.log(`  overpass: ${ways.length} coastline ways`);
      } catch (err) {
        console.log(`  ❌ overpass 失敗: ${err.message}`);
      }
    }

    let totalBefore = 0, totalAfter = 0, dup = 0;
    for (const w of ways) {
      if (seenWayIds.has(w.id)) { dup++; continue; }
      seenWayIds.add(w.id);
      totalBefore += w.coords.length;
      const simp = douglasPeucker(w.coords, TOL_DEG);
      totalAfter += simp.length;
      const intPts = simp.map(([lng, lat]) => [Math.round(lat*u.PRECISION), Math.round(lng*u.PRECISION)]);
      allLines.push(intPts);
    }
    if (ways.length) {
      console.log(`  pts: ${totalBefore.toLocaleString()} → ${totalAfter.toLocaleString()} (削減 ${(100-(100*totalAfter/Math.max(1,totalBefore))).toFixed(1)}% / 重複way ${dup})`);
    }
  }

  console.log(`\n  total lines: ${allLines.length}`);

  if (allLines.length === 0) {
    console.error('❌ No coastline data extracted');
    process.exit(1);
  }

  const grid = {};
  const linesB64 = allLines.map((pts, idx) => {
    const mid = pts[Math.floor(pts.length/2)];
    const k = u.gridKey(mid[0], mid[1]);
    (grid[k] ||= []).push(idx);
    return u.encodeLineB64(pts);
  });

  let bbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const pts of allLines) for (const [lat, lng] of pts) {
    if (lat<bbox[0]) bbox[0]=lat; if (lng<bbox[1]) bbox[1]=lng;
    if (lat>bbox[2]) bbox[2]=lat; if (lng>bbox[3]) bbox[3]=lng;
  }

  const data = {
    v: 1,
    generated: new Date().toISOString(),
    precision: u.PRECISION,
    gridSize: u.GRID_INT,
    bbox,
    grid,
    lines: linesB64,
    source: 'OSM (natural=coastline)・Geofabrik PBF + Overpass API・DP 50m簡略',
  };

  const size = u.writeBundleJs(OUT, 'COASTLINE_JP', data, [
    `// 出典: OpenStreetMap (ODbL)・natural=coastline ways`,
    `// PBF（Geofabrik / openstreetmap.fr）＋ Overpass API・Douglas-Peucker 50m 簡略化`,
    `// 全国 ${allLines.length} ライン`,
  ]);
  console.log(`✅ ${OUT}  lines=${allLines.length} size=${(size/1024).toFixed(2)} KB`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
