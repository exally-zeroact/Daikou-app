#!/usr/bin/env node
/**
 * 愛媛県の道路データを Overpass API から取得し、
 * build-roads.js が期待する GeoJSON LineString FeatureCollection に変換する。
 *
 * 出力: tmp/ehime-roads-v6.geojson
 */
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const TMP = path.join(PROJECT_ROOT, 'tmp');
const OUT = path.join(TMP, 'ehime-roads-v6.geojson');
const CACHE = path.join(TMP, 'ehime-roads-overpass.json');

const HIGHWAY_TYPES =
  'motorway|trunk|primary|secondary|tertiary|unclassified|residential' +
  '|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|track';

const Q =
  '[out:json][timeout:600];' +
  'area["name"="愛媛県"]->.ep;' +
  '(' +
  `way["highway"~"^(${HIGHWAY_TYPES})$"](area.ep);` +
  ');' +
  'out tags geom;';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

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
          headers: {
            'User-Agent': 'Daikou-app-test/0.1',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'data=' + encodeURIComponent(Q),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const json = await res.json();
        console.log(
          `  got elements=${(json.elements || []).length} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`
        );
        return json;
      } finally {
        clearTimeout(t);
      }
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
  if (fs.existsSync(CACHE) && Date.now() - fs.statSync(CACHE).mtimeMs < 7 * 86400000) {
    console.log(`  cache: ${CACHE}`);
    json = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  } else {
    json = await fetchOverpass();
    fs.writeFileSync(CACHE, JSON.stringify(json));
  }

  const features = [];
  for (const el of json.elements || []) {
    if (el.type !== 'way' || !el.geometry) continue;
    const tags = el.tags || {};
    if (!tags.highway) continue;
    const coords = el.geometry.map((g) => [g.lon, g.lat]);
    if (coords.length < 2) continue;
    features.push({
      type: 'Feature',
      properties: {
        highway: tags.highway,
        oneway: tags.oneway || null,
        incline: tags.incline || null,
        lanes: tags.lanes || null,
        width: tags.width || null,
        layer: tags.layer || null,
      },
      geometry: { type: 'LineString', coordinates: coords },
    });
  }

  const fc = { type: 'FeatureCollection', features };
  fs.writeFileSync(OUT, JSON.stringify(fc));
  const size = fs.statSync(OUT).size;
  console.log(`✅ ${OUT}  ways=${features.length}  size=${(size / 1024 / 1024).toFixed(2)} MB`);

  // 簡易タグ統計
  const stats = { highway: {}, oneway: 0, incline: 0, lanes: 0, width: 0, layer: 0 };
  for (const f of features) {
    const p = f.properties;
    stats.highway[p.highway] = (stats.highway[p.highway] || 0) + 1;
    if (p.oneway) stats.oneway++;
    if (p.incline) stats.incline++;
    if (p.lanes) stats.lanes++;
    if (p.width) stats.width++;
    if (p.layer) stats.layer++;
  }
  console.log(`  highway 分布:`, stats.highway);
  const pct = (n) => `${((n / features.length) * 100).toFixed(1)}%`;
  console.log(
    `  raw タグ充足: oneway ${pct(stats.oneway)} / incline ${pct(stats.incline)} / lanes ${pct(stats.lanes)} / width ${pct(stats.width)} / layer ${pct(stats.layer)}`
  );
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
