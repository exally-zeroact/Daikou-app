#!/usr/bin/env node
/**
 * build-bundle-hiking-trails-jp.js
 *
 * 全国の登山道 (sac_scale or foot=designated) を Overpass から取得し
 * data/hiking-trails-jp.js に出力。
 *
 * フィルタ:
 *   way[highway=path][sac_scale]
 *   way[highway=path][foot=designated]
 *   way[highway=footway][sac_scale]
 *   way[highway=bridleway][sac_scale]
 *
 * 構造 (coastline-jp.js と同型 + typeCode 1byte/line):
 *   { v, precision, gridSize, bbox, grid, types[], lines[] }
 *   types[i] : 0=path 1=footway 2=bridleway
 *   lines[i] : delta-varint zigzag base64 (始点 + デルタ列)
 */
const fs = require('fs');
const path = require('path');
const u = require('./bundle-utils.js');

const PROJECT_ROOT = path.join(__dirname, '..');
const TMP = path.join(PROJECT_ROOT, 'tmp');
const OUT = path.join(PROJECT_ROOT, 'data', 'hiking-trails-jp.js');
const CACHE = path.join(TMP, 'hiking-trails-overpass.json');

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const QUERY =
  '[out:json][timeout:600];' +
  'area["ISO3166-1"="JP"][admin_level=2]->.jp;' +
  '(' +
    'way["highway"="path"]["sac_scale"](area.jp);' +
    'way["highway"="path"]["foot"="designated"](area.jp);' +
    'way["highway"="footway"]["sac_scale"](area.jp);' +
    'way["highway"="bridleway"]["sac_scale"](area.jp);' +
  ');' +
  'out tags geom;';

const TYPE_CODES = { path: 0, footway: 1, bridleway: 2 };

// Douglas-Peucker
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

async function fetchOverpass() {
  let lastErr = null;
  for (const ep of ENDPOINTS) {
    try {
      console.log(`  POST ${ep}`);
      const t0 = Date.now();
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 600000);
      try {
        const res = await fetch(ep, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'User-Agent': 'Daikou-app-test/0.1', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(QUERY),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const json = await res.json();
        console.log(`  got elements=${(json.elements||[]).length} elapsed=${((Date.now()-t0)/1000).toFixed(1)}s`);
        return json;
      } finally { clearTimeout(t); }
    } catch (err) {
      console.log(`  failed: ${err.message}`);
      lastErr = err;
    }
  }
  throw lastErr || new Error('all overpass endpoints failed');
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });

  let json;
  if (fs.existsSync(CACHE) && (Date.now() - fs.statSync(CACHE).mtimeMs) < 7 * 86400000) {
    console.log(`  cache: ${CACHE}`);
    json = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  } else {
    json = await fetchOverpass();
    fs.writeFileSync(CACHE, JSON.stringify(json));
  }

  const TOL_DEG = 0.00005; // ≈5m
  const seenIds = new Set();
  const types = [];
  const intLines = [];
  let totalBefore = 0, totalAfter = 0;

  for (const el of (json.elements || [])) {
    if (el.type !== 'way' || !el.geometry) continue;
    if (seenIds.has(el.id)) continue;
    seenIds.add(el.id);
    const tags = el.tags || {};
    const t = TYPE_CODES[tags.highway];
    if (t === undefined) continue;
    const coords = el.geometry.map(g => [g.lon, g.lat]);
    if (coords.length < 2) continue;
    totalBefore += coords.length;
    const simp = douglasPeucker(coords, TOL_DEG);
    if (simp.length < 2) continue;
    totalAfter += simp.length;
    const intPts = simp.map(([lng, lat]) => [Math.round(lat*u.PRECISION), Math.round(lng*u.PRECISION)]);
    types.push(t);
    intLines.push(intPts);
  }

  console.log(`  ways: ${intLines.length} / pts ${totalBefore} → ${totalAfter} (${(100-100*totalAfter/Math.max(1,totalBefore)).toFixed(1)}% 削減)`);
  if (intLines.length === 0) { console.error('❌ no hiking trails'); process.exit(1); }

  // grid 索引 (代表点 = 中点)
  const grid = {};
  const linesB64 = intLines.map((pts, idx) => {
    const mid = pts[Math.floor(pts.length/2)];
    const k = u.gridKey(mid[0], mid[1]);
    (grid[k] ||= []).push(idx);
    return u.encodeLineB64(pts);
  });

  // bbox
  let bbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const pts of intLines) for (const [lat, lng] of pts) {
    if (lat<bbox[0]) bbox[0]=lat; if (lng<bbox[1]) bbox[1]=lng;
    if (lat>bbox[2]) bbox[2]=lat; if (lng>bbox[3]) bbox[3]=lng;
  }

  const typesB64 = Buffer.from(types).toString('base64');

  const data = {
    v: 1,
    generated: new Date().toISOString(),
    precision: u.PRECISION,
    gridSize: u.GRID_INT,
    bbox,
    grid,
    types: typesB64,           // 1 byte/way の連続 base64
    typeLegend: { 0: 'path', 1: 'footway', 2: 'bridleway' },
    lines: linesB64,
    source: 'OpenStreetMap (ODbL)・sac_scale または foot=designated 付き path / footway / bridleway',
  };

  const size = u.writeBundleJs(OUT, 'HIKING_TRAILS_JP', data, [
    `// 出典: OpenStreetMap (ODbL)`,
    `// 全国 ${intLines.length} ways (登山道)`,
    `// DP 簡略後 ${totalAfter} 点`,
  ]);
  console.log(`✅ ${OUT}  ways=${intLines.length} size=${(size/1024).toFixed(2)} KB`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
