#!/usr/bin/env node
/**
 * split-poi-by-region.js
 *
 * 地方単位の POI GeoJSON（osmium export 出力）を、各 feature の代表点に基づいて
 * 都道府県別に振り分け、input/{pref}/poi.geojson として出力する。
 *
 * 既存の osm-update.yml が build-roads.js で行っているのと同じ
 * 「重心最近傍ルール」での県振り分けを POI に適用する。
 *
 * 使い方:
 *   node scripts/split-poi-by-region.js <regional.geojson> <region>
 *
 * 入力:
 *   - regional.geojson: tags-filter + export 後の地方単位 GeoJSON
 *     ジオメトリは Point / LineString / Polygon / MultiPolygon が混在する想定
 *   - region: hokkaido | tohoku | kanto | chubu | kansai | chugoku | shikoku | kyushu
 *
 * 出力:
 *   input/{pref}/poi.geojson  （地方内の各県分・FeatureCollection）
 */

const fs = require('fs');
const path = require('path');
const { REGION_PREFS, nearestPrefecture } = require('./encoding-utils.js');

const [, , INPUT, REGION] = process.argv;
if (!INPUT || !REGION) {
  console.error('Usage: split-poi-by-region.js <regional.geojson> <region>');
  process.exit(1);
}

const prefs = REGION_PREFS[REGION];
if (!prefs) {
  console.error(`Unknown region: ${REGION}`);
  process.exit(1);
}

if (!fs.existsSync(INPUT)) {
  console.error(`Input not found: ${INPUT}`);
  process.exit(1);
}

console.log(`[split-poi-by-region] region=${REGION} prefs=${prefs.length}`);

// 任意ジオメトリ → 代表点 [lon, lat]
function representativePoint(g) {
  if (!g) return null;
  if (g.type === 'Point' && Array.isArray(g.coordinates)) return g.coordinates;
  let sumLon = 0,
    sumLat = 0,
    n = 0;
  function walk(node) {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      sumLon += node[0];
      sumLat += node[1];
      n++;
      return;
    }
    for (const v of node) walk(v);
  }
  walk(g.coordinates);
  if (n === 0) return null;
  return [sumLon / n, sumLat / n];
}

const fc = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
if (!fc || !Array.isArray(fc.features)) {
  console.error('Invalid GeoJSON FeatureCollection');
  process.exit(1);
}

// バケット初期化
const buckets = {};
for (const pref of prefs) buckets[pref] = [];

let dropped = 0;
for (const f of fc.features) {
  const c = representativePoint(f.geometry);
  if (!c) {
    dropped++;
    continue;
  }
  // 中点 [lon, lat] → 県（地方内のみ評価）
  const pref = nearestPrefecture(c[1], c[0], prefs);
  if (!pref) {
    dropped++;
    continue;
  }
  buckets[pref].push(f);
}

const PROJECT_ROOT = path.join(__dirname, '..');
let total = 0;
for (const pref of prefs) {
  const arr = buckets[pref];
  total += arr.length;
  const dir = path.join(PROJECT_ROOT, 'input', pref);
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, 'poi.geojson');
  fs.writeFileSync(outPath, JSON.stringify({ type: 'FeatureCollection', features: arr }));
  const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(
    `  ${pref.padEnd(12)} count=${String(arr.length).padStart(6)}  size=${sizeKB.padStart(8)} KB`
  );
}
console.log(`  ─────────────────`);
console.log(`  total=${total}  dropped(no-geom)=${dropped}`);
