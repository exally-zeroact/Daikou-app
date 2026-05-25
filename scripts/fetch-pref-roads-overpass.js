#!/usr/bin/env node
/**
 * 都道府県の道路データを Overpass API から取得し、
 * build-roads.js が期待する GeoJSON LineString FeatureCollection に変換する。
 *
 * 使い方:
 *   node scripts/fetch-pref-roads-overpass.js <pref>
 *   ex: node scripts/fetch-pref-roads-overpass.js ehime
 *
 * 出力:
 *   tmp/{pref}-roads-v6.geojson
 *   tmp/{pref}-roads-overpass.json (cache, 7日間)
 */
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const TMP = path.join(PROJECT_ROOT, 'tmp');

// ローマ字 → 日本語県名
const PREF_NAMES_JA = {
  hokkaido: '北海道',
  aomori: '青森県',
  iwate: '岩手県',
  miyagi: '宮城県',
  akita: '秋田県',
  yamagata: '山形県',
  fukushima: '福島県',
  ibaraki: '茨城県',
  tochigi: '栃木県',
  gunma: '群馬県',
  saitama: '埼玉県',
  chiba: '千葉県',
  tokyo: '東京都',
  kanagawa: '神奈川県',
  niigata: '新潟県',
  toyama: '富山県',
  ishikawa: '石川県',
  fukui: '福井県',
  yamanashi: '山梨県',
  nagano: '長野県',
  gifu: '岐阜県',
  shizuoka: '静岡県',
  aichi: '愛知県',
  mie: '三重県',
  shiga: '滋賀県',
  kyoto: '京都府',
  osaka: '大阪府',
  hyogo: '兵庫県',
  nara: '奈良県',
  wakayama: '和歌山県',
  tottori: '鳥取県',
  shimane: '島根県',
  okayama: '岡山県',
  hiroshima: '広島県',
  yamaguchi: '山口県',
  tokushima: '徳島県',
  kagawa: '香川県',
  ehime: '愛媛県',
  kochi: '高知県',
  fukuoka: '福岡県',
  saga: '佐賀県',
  nagasaki: '長崎県',
  kumamoto: '熊本県',
  oita: '大分県',
  miyazaki: '宮崎県',
  kagoshima: '鹿児島県',
  okinawa: '沖縄県',
};

const HIGHWAY_TYPES =
  'motorway|trunk|primary|secondary|tertiary|unclassified|residential' +
  '|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|track';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

async function fetchOverpass(jaName) {
  const Q =
    '[out:json][timeout:900];' +
    `area["name"="${jaName}"]->.ep;` +
    '(' +
    `way["highway"~"^(${HIGHWAY_TYPES})$"](area.ep);` +
    ');' +
    'out tags geom;';
  let lastErr = null;
  for (const ep of ENDPOINTS) {
    try {
      console.log(`  POST ${ep}`);
      const t0 = Date.now();
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 900000);
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

async function main() {
  const pref = process.argv[2];
  if (!pref) {
    console.error('Usage: fetch-pref-roads-overpass.js <pref>');
    process.exit(1);
  }
  const jaName = PREF_NAMES_JA[pref];
  if (!jaName) {
    console.error(`unknown pref: ${pref}`);
    process.exit(1);
  }

  fs.mkdirSync(TMP, { recursive: true });
  const OUT = path.join(TMP, `${pref}-roads-v6.geojson`);
  const CACHE = path.join(TMP, `${pref}-roads-overpass.json`);

  let json;
  if (fs.existsSync(CACHE) && Date.now() - fs.statSync(CACHE).mtimeMs < 7 * 86400000) {
    console.log(`  cache: ${CACHE}`);
    json = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  } else {
    json = await fetchOverpass(jaName);
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
  const pct = (n) => `${((n / Math.max(1, features.length)) * 100).toFixed(1)}%`;
  console.log(
    `  raw タグ充足: oneway ${pct(stats.oneway)} / incline ${pct(stats.incline)} / lanes ${pct(stats.lanes)} / width ${pct(stats.width)} / layer ${pct(stats.layer)}`
  );
}

if (require.main === module) {
  main().catch((e) => {
    console.error('FATAL:', e.message);
    process.exit(1);
  });
}
