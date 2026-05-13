#!/usr/bin/env node
/**
 * fetch-pref-poi-overpass.js
 *
 * 任意の都道府県の POI (50 カテゴリ) を Overpass API から取得し
 *   input/{pref}/poi.geojson
 * に出力する。
 *
 * 使い方:
 *   node scripts/fetch-pref-poi-overpass.js <pref>
 *   ex: node scripts/fetch-pref-poi-overpass.js ehime
 *
 * 出力 GeoJSON:
 *   FeatureCollection of Point
 *     properties: { category: <name>, name?, attrs? }
 */

const fs = require('fs');
const path = require('path');
const { classifyOsmTags, extractAttrsFromOsmTags } = require('./poi-categories.js');

const PREF_NAMES_JA = {
  hokkaido:'北海道',aomori:'青森県',iwate:'岩手県',miyagi:'宮城県',akita:'秋田県',yamagata:'山形県',fukushima:'福島県',
  ibaraki:'茨城県',tochigi:'栃木県',gunma:'群馬県',saitama:'埼玉県',chiba:'千葉県',tokyo:'東京都',kanagawa:'神奈川県',
  niigata:'新潟県',toyama:'富山県',ishikawa:'石川県',fukui:'福井県',yamanashi:'山梨県',nagano:'長野県',
  gifu:'岐阜県',shizuoka:'静岡県',aichi:'愛知県',mie:'三重県',shiga:'滋賀県',kyoto:'京都府',osaka:'大阪府',
  hyogo:'兵庫県',nara:'奈良県',wakayama:'和歌山県',
  tottori:'鳥取県',shimane:'島根県',okayama:'岡山県',hiroshima:'広島県',yamaguchi:'山口県',
  tokushima:'徳島県',kagawa:'香川県',ehime:'愛媛県',kochi:'高知県',
  fukuoka:'福岡県',saga:'佐賀県',nagasaki:'長崎県',kumamoto:'熊本県',oita:'大分県',miyazaki:'宮崎県',
  kagoshima:'鹿児島県',okinawa:'沖縄県',
};

const PROJECT_ROOT = path.join(__dirname, '..');
const TMP = path.join(PROJECT_ROOT, 'tmp');

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

function buildQuery(jaName) {
  return (
    '[out:json][timeout:600];' +
    `area["name"="${jaName}"]->.ep;` +
    '(' +
      'nwr["amenity"](area.ep);' +
      'nwr["shop"](area.ep);' +
      'nwr["tourism"](area.ep);' +
      'nwr["leisure"~"^(golf_course|adult_gaming_centre|hot_spring)$"](area.ep);' +
      'nwr["railway"~"^(station|level_crossing|crossing)$"](area.ep);' +
      'nwr["highway"~"^(bus_stop|services|traffic_signals)$"](area.ep);' +
      'nwr["aeroway"~"^(aerodrome|terminal)$"](area.ep);' +
      'nwr["emergency"="defibrillator"](area.ep);' +
      'nwr["natural"~"^(peak|volcano)$"](area.ep);' +
    ');' +
    'out center tags;'
  );
}

async function fetchOverpass(query) {
  let lastErr = null;
  for (const ep of ENDPOINTS) {
    try {
      console.log(`  POST ${ep}`);
      const t0 = Date.now();
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 600000);
      try {
        const res = await fetch(ep, {
          method: 'POST', signal: ctrl.signal,
          headers: { 'User-Agent': 'Daikou-app-test/0.1', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

function elemCenter(e) {
  if (e.type === 'node') return [e.lon, e.lat];
  if (e.center)          return [e.center.lon, e.center.lat];
  return null;
}

(async () => {
  const PREF = process.argv[2];
  const ja = PREF_NAMES_JA[PREF];
  if (!ja) { console.error(`unknown pref: ${PREF}`); process.exit(1); }
  const OUT_DIR = path.join(PROJECT_ROOT, 'input', PREF);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  const cache = path.join(TMP, `poi-overpass-${PREF}.json`);
  let json;
  if (fs.existsSync(cache) && (Date.now() - fs.statSync(cache).mtimeMs) < 7 * 86400000) {
    console.log(`  cache: ${path.basename(cache)}`);
    json = JSON.parse(fs.readFileSync(cache, 'utf8'));
  } else {
    json = await fetchOverpass(buildQuery(ja));
    fs.writeFileSync(cache, JSON.stringify(json));
  }

  const features = [];
  const counts = {};
  for (const e of (json.elements || [])) {
    const tags = e.tags || {};
    const cat = classifyOsmTags(tags);
    if (!cat) continue;
    const c = elemCenter(e);
    if (!c) continue;
    const props = { category: cat };
    if (tags.name) props.name = tags.name;
    const attrs = extractAttrsFromOsmTags(tags, cat);
    if (attrs) props.attrs = attrs;
    features.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: c } });
    counts[cat] = (counts[cat] || 0) + 1;
  }

  const fc = { type: 'FeatureCollection', features };
  const outPath = path.join(OUT_DIR, 'poi.geojson');
  fs.writeFileSync(outPath, JSON.stringify(fc));
  const size = fs.statSync(outPath).size;
  console.log(`✅ ${outPath}  features=${features.length} size=${(size/1024/1024).toFixed(2)} MB`);
  // 上位カテゴリ
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(`  top カテゴリ:`);
  top.forEach(([k, v]) => console.log(`    ${k}: ${v}`));
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
