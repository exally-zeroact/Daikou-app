#!/usr/bin/env node
/**
 * build-poi.js
 *
 * POI（Point GeoJSON）を poi-{pref}.js に出力する。
 * 41 カテゴリ・属性付き・JSON のまま（base64化なし）。
 *
 * 使い方:
 *   node scripts/build-poi.js <input.geojson> <pref>
 *
 * 入力 GeoJSON:
 *   FeatureCollection（Point のみ）
 *   各 Feature の properties:
 *     - "category": string | number   （文字列なら poi-categories.js でID解決、数値ならそのまま）
 *     - "name":     string            （任意）
 *     - "attrs":    object            （任意：h24, open, fee, kind 等。既定キーは poi-categories.js コメント参照）
 *
 * 出力（JSON のまま）:
 *   window.POI_{PREF} = {
 *     v:2, prefecture, generated, precision:1e5, bbox, gridSize:1000,
 *     cats: { id: name, ... },
 *     grid: { "gy_gx": [poiIdx,...] },
 *     pois: [{ c, lat, lng, n?, a? }, ...]
 *   };
 */

const fs = require('fs');
const path = require('path');
const { CATEGORIES, CATEGORY_NAME_TO_ID, classifyOsmTags, extractAttrsFromOsmTags } = require('./poi-categories.js');
const { PRECISION, GRID_INT } = require('./encoding-utils.js');

const [, , INPUT, PREF] = process.argv;
if (!INPUT || !PREF) {
  console.error('Usage: build-poi.js <input.geojson> <pref>');
  process.exit(1);
}
if (!fs.existsSync(INPUT)) {
  console.error(`Input not found: ${INPUT}`);
  process.exit(1);
}

console.log(`[build-poi] prefecture=${PREF} input=${INPUT}`);
const geo = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
if (!geo.features) throw new Error('Invalid GeoJSON');

const bbox = [Infinity, Infinity, -Infinity, -Infinity];
const rawPois = [];
let droppedNoCategory = 0, droppedNoGeom = 0;

// 任意ジオメトリから代表点 [lon, lat] を取得する（Point はそのまま、Way/Polygon は重心）
function representativePoint(g) {
  if (!g) return null;
  if (g.type === 'Point' && Array.isArray(g.coordinates)) return g.coordinates;
  // 任意の coordinates ツリーから経度/緯度の平均を取る（粗いが Point 出力には十分）
  let sumLon = 0, sumLat = 0, n = 0;
  function walk(node) {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      sumLon += node[0]; sumLat += node[1]; n++;
      return;
    }
    for (const v of node) walk(v);
  }
  walk(g.coordinates);
  if (n === 0) return null;
  return [sumLon / n, sumLat / n];
}

for (const f of geo.features) {
  const g = f.geometry;
  const coord = representativePoint(g);
  if (!coord) { droppedNoGeom++; continue; }
  const props = f.properties || {};

  // カテゴリ解決
  let catId = null;
  let resolvedAttrs = null;
  if (typeof props.category === 'number') catId = props.category;
  else if (typeof props.category === 'string') catId = CATEGORY_NAME_TO_ID[props.category];

  // フォールバック：properties に category が無い場合は OSM 生タグから自動分類
  // （osmium export 直後の GeoJSON はこのケース）
  if (catId === undefined || catId === null || !(catId in CATEGORIES)) {
    const cat = classifyOsmTags(props);
    if (cat) {
      catId = CATEGORY_NAME_TO_ID[cat];
      resolvedAttrs = extractAttrsFromOsmTags(props, cat);
    }
  }
  if (catId === undefined || catId === null || !(catId in CATEGORIES)) {
    droppedNoCategory++;
    continue;
  }

  // GeoJSON は [lon, lat] 順
  const latInt = Math.round(coord[1] * PRECISION);
  const lngInt = Math.round(coord[0] * PRECISION);
  if (latInt < bbox[0]) bbox[0] = latInt;
  if (lngInt < bbox[1]) bbox[1] = lngInt;
  if (latInt > bbox[2]) bbox[2] = latInt;
  if (lngInt > bbox[3]) bbox[3] = lngInt;

  const poi = { c: catId, lat: latInt, lng: lngInt };
  if (props.name) poi.n = String(props.name);
  if (props.attrs && typeof props.attrs === 'object') {
    poi.a = props.attrs;
  } else if (resolvedAttrs) {
    poi.a = resolvedAttrs;
  }
  rawPois.push(poi);
}

if (droppedNoCategory) console.log(`  ⚠️ カテゴリ不明: ${droppedNoCategory} 件をスキップ`);
if (droppedNoGeom)     console.log(`  ⚠️ ジオメトリ無効: ${droppedNoGeom} 件をスキップ`);

// ─── 重複除去 ─────────────────────────────────────────────────────
// 同じ施設が OSM 上で node + way（建物）両方に POI タグ付与されているケースを統合。
// バケット: (category, name|"", lat10m_grid, lng10m_grid)  ※10m は約 0.0001度
// ※ name が異なる近接POIは別物として残す
const DEDUP_GRID = 10; // 1e5 整数で 10 ＝ 約11m
const dedupBucket = new Map();
let merged = 0;
for (const p of rawPois) {
  const key = [
    p.c,
    p.n || '',
    Math.floor(p.lat / DEDUP_GRID),
    Math.floor(p.lng / DEDUP_GRID),
  ].join('|');
  if (dedupBucket.has(key)) {
    // 既存にマージ：属性は既存優先、名前があるほうを優先
    const existing = dedupBucket.get(key);
    if (!existing.n && p.n) existing.n = p.n;
    if (!existing.a && p.a) existing.a = p.a;
    merged++;
  } else {
    dedupBucket.set(key, p);
  }
}
const pois = Array.from(dedupBucket.values());
if (merged) console.log(`  🔄 重複除去: ${merged} 件をマージ（同カテゴリ+同名+〜11m）`);

// ─── グリッド構築（dedup後の POIs に対して）─────────────────────
const grid = {};
for (let i = 0; i < pois.length; i++) {
  const p = pois[i];
  const key = Math.floor(p.lat / GRID_INT) + '_' + Math.floor(p.lng / GRID_INT);
  (grid[key] ||= []).push(i);
}

const out = {
  v: 2,
  prefecture: PREF,
  generated: new Date().toISOString(),
  precision: PRECISION,
  bbox: pois.length ? bbox : null,
  gridSize: GRID_INT,
  cats: CATEGORIES,
  grid,
  pois,
};

const VAR = `POI_${PREF.toUpperCase().replace(/-/g, '_')}`;
const header = [
  `// Auto-generated by scripts/build-poi.js`,
  `// Prefecture: ${PREF}`,
  `// Generated: ${out.generated}`,
  `// 形式 v2: 41カテゴリ・属性短縮キー（h24/open/fee/cap/height_m/self/full/diesel/er/kind）`,
  `window.${VAR} = ${JSON.stringify(out)};`,
  ''
].join('\n');

const outPath = path.join(__dirname, '..', 'data', `poi-${PREF}.js`);
fs.writeFileSync(outPath, header);
const size = fs.statSync(outPath).size;

// カテゴリ別件数
const byCat = {};
for (const p of pois) byCat[p.c] = (byCat[p.c] || 0) + 1;

console.log(`✅ ${outPath}`);
console.log(`  total=${pois.length} / cells=${Object.keys(grid).length} / size=${(size/1024).toFixed(2)} KB`);
const catLines = Object.entries(byCat).sort((a, b) => +a[0] - +b[0])
  .map(([id, n]) => `    [${id}] ${CATEGORIES[id]}: ${n}`).join('\n');
if (catLines) console.log('  カテゴリ別:\n' + catLines);
