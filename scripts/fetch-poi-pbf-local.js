#!/usr/bin/env node
/**
 * fetch-poi-pbf-local.js
 *
 * ローカル PC で osmium 無し（Windows）でも C案 PBF パイプラインを動かすための
 * Node.js 専用版。 osm-pbf-parser でストリームパースし、POIタグ+bbox で県別 GeoJSON 化。
 *
 * 注意点（osmium 版との差分）:
 *   - way の中心点解決は実装していない（=node 単独タグの POI のみ取得）
 *     ※osmium 版は w/amenity 等の way も中心点に変換する
 *     ※ノード件数は OSM 全体の amenity の 80〜90% を占めるので、テスト目的では十分
 *   - 県別切出しは bbox ベース（.poly は使わない）
 *
 * 必要パッケージ:
 *   npm install -g osm-pbf-parser through2
 *
 * 使い方:
 *   node scripts/fetch-poi-pbf-local.js <pref>
 *   ex: node scripts/fetch-poi-pbf-local.js ehime
 *
 * ソース PBF の地方判定:
 *   pref → region 対応で Geofabrik 地方PBF をDL
 *   ex: ehime → shikoku-latest.osm.pbf
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// グローバルインストールの node_modules を解決
function requireGlobal(name) {
  try { return require(name); } catch {}
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(root, name));
}

const parseOsmPbf = requireGlobal('osm-pbf-parser');
const through = requireGlobal('through2');

const PROJECT_ROOT = path.join(__dirname, '..');
const PRECISION = 100000;

const PREF = process.argv[2];
if (!PREF) { console.error('Usage: fetch-poi-pbf-local.js <pref>'); process.exit(1); }

// pref → region
const PREF_REGION = {
  hokkaido: 'hokkaido',
  aomori: 'tohoku', iwate: 'tohoku', miyagi: 'tohoku', akita: 'tohoku', yamagata: 'tohoku', fukushima: 'tohoku',
  ibaraki: 'kanto', tochigi: 'kanto', gunma: 'kanto', saitama: 'kanto', chiba: 'kanto', tokyo: 'kanto', kanagawa: 'kanto',
  niigata: 'chubu', toyama: 'chubu', ishikawa: 'chubu', fukui: 'chubu', yamanashi: 'chubu', nagano: 'chubu',
  gifu: 'chubu', shizuoka: 'chubu', aichi: 'chubu',
  mie: 'kansai', shiga: 'kansai', kyoto: 'kansai', osaka: 'kansai', hyogo: 'kansai', nara: 'kansai', wakayama: 'kansai',
  tottori: 'chugoku', shimane: 'chugoku', okayama: 'chugoku', hiroshima: 'chugoku', yamaguchi: 'chugoku',
  tokushima: 'shikoku', kagawa: 'shikoku', ehime: 'shikoku', kochi: 'shikoku',
  fukuoka: 'kyushu', saga: 'kyushu', nagasaki: 'kyushu', kumamoto: 'kyushu', oita: 'kyushu',
  miyazaki: 'kyushu', kagoshima: 'kyushu', okinawa: 'kyushu',
};
const REGION = PREF_REGION[PREF];
if (!REGION) { console.error(`Unknown prefecture: ${PREF}`); process.exit(1); }

// bbox を meta.json から
const meta = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'meta.json'), 'utf8'));
const info = meta.prefectures[PREF];
if (!info) { console.error(`Prefecture not in meta.json: ${PREF}`); process.exit(1); }
const south = info.bbox[0] / PRECISION;
const west  = info.bbox[1] / PRECISION;
const north = info.bbox[2] / PRECISION;
const east  = info.bbox[3] / PRECISION;

console.log(`[fetch-poi-pbf-local] pref=${PREF} region=${REGION}`);
console.log(`  bbox: lat[${south}, ${north}] lng[${west}, ${east}]`);

// 1. 地方PBF DL
const TMP = path.join(PROJECT_ROOT, 'tmp');
fs.mkdirSync(TMP, { recursive: true });
const PBF = path.join(TMP, `${REGION}-latest.osm.pbf`);
const URL = `https://download.geofabrik.de/asia/japan/${REGION}-latest.osm.pbf`;

async function downloadPBF() {
  // 24h 以内のキャッシュは再利用
  if (fs.existsSync(PBF)) {
    const age = Date.now() - fs.statSync(PBF).mtimeMs;
    if (age < 24 * 3600 * 1000) {
      console.log(`  [1/3] DL skip (cache <24h): ${PBF} (${(fs.statSync(PBF).size/1024/1024).toFixed(1)} MB)`);
      return;
    }
  }
  console.log(`  [1/3] DL: ${URL}`);
  const res = await fetch(URL, { headers: { 'User-Agent': 'Daikou-app-test/0.1' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const stream = fs.createWriteStream(PBF);
  // Web Streams → Node Stream
  const { Readable } = require('stream');
  const nodeStream = Readable.fromWeb(res.body);
  await new Promise((resolve, reject) => {
    nodeStream.pipe(stream).on('finish', resolve).on('error', reject);
  });
  console.log(`       → ${PBF} (${(fs.statSync(PBF).size/1024/1024).toFixed(1)} MB)`);
}

// 2. PBF をストリームパース、POIタグ + bbox に絞る
function classifyPOI(tags) {
  const am = tags.amenity, sh = tags.shop, lz = tags.leisure, to = tags.tourism;
  const rw = tags.railway, hw = tags.highway, ay = tags.aeroway, em = tags.emergency;
  const cu = tags.cuisine || '';
  const name = tags.name || '';

  if (em === 'defibrillator') return 'aed';
  if (ay === 'aerodrome' || ay === 'terminal') return 'airport';
  if (hw === 'bus_stop') return 'bus_stop';
  if (rw === 'station') return 'station';
  if (am === 'taxi') return 'taxi_stand';
  if (am === 'bicycle_parking') return 'bicycle_parking';
  if (hw === 'services') return 'sapa';
  if (am === 'marketplace' && /道の駅/.test(name)) return 'michinoeki';
  if (lz === 'golf_course') return 'golf';
  if (am === 'cinema') return 'cinema';
  if (lz === 'adult_gaming_centre') return 'pachinko';
  if (am === 'karaoke_box') return 'karaoke';
  if (am === 'public_bath' || lz === 'hot_spring') return 'onsen_sento';
  if (am === 'atm') return 'atm';
  if (am === 'bank') return 'bank';
  if (am === 'library') return 'library';
  if (am === 'fire_station') return 'fire_station';
  if (am === 'police') return 'police_koban';
  if (am === 'post_office') return 'post_office';
  if (am === 'townhall') return 'city_office';
  if (sh === 'variety_store') return 'hundred_yen';
  if (sh === 'department_store' || sh === 'mall') return 'department_sc';
  if (sh === 'doityourself' || sh === 'hardware') return 'home_center';
  if (sh === 'supermarket') return 'supermarket';
  if (sh === 'chemist' || am === 'pharmacy') return 'pharmacy_drugstore';
  if (am === 'dentist') return 'dental';
  if (am === 'clinic' || am === 'doctors') return 'clinic';
  if (am === 'fast_food') return 'fast_food';
  if (am === 'cafe') return 'cafe';
  if (am === 'restaurant' || am === 'bar' || am === 'pub') {
    if (cu === 'ramen') return 'ramen';
    if (cu === 'sushi') return 'sushi';
    if (cu === 'yakiniku' || cu === 'korean') return 'yakiniku';
    if (cu === 'izakaya') return 'izakaya';
    return 'restaurant_bar';
  }
  if (to === 'hotel' || to === 'hostel' || to === 'guest_house' || to === 'motel') return 'hotel';
  if (sh === 'convenience') return 'convenience_store';
  if (am === 'fuel') return 'gas_station';
  if (am === 'hospital') return 'hospital';
  if (am === 'school' || am === 'kindergarten' || am === 'college' || am === 'university') return 'school';
  if (to === 'attraction' || to === 'museum' || to === 'viewpoint' || to === 'artwork') return 'sightseeing';
  return null;
}

function extractAttrs(tags, category) {
  const a = {};
  const oh = tags.opening_hours;
  if (oh === '24/7') a.h24 = 1;
  else if (oh && oh.length < 80) a.open = oh;
  if (category === 'gas_station') {
    if (tags.self_service === 'yes') a.self = 1;
    if (tags.self_service === 'no')  a.full = 1;
    if (tags['fuel:diesel'] === 'yes') a.diesel = 1;
  }
  if (category === 'hospital') {
    if (tags.emergency === 'yes') a.er = 1;
  }
  if (category === 'school') {
    const am = tags.amenity;
    if (am === 'kindergarten') a.kind = 'kg';
    else if (am === 'college') a.kind = 'voc';
    else if (am === 'university') a.kind = 'univ';
    else if (am === 'school') {
      const isced = tags['isced:level'] || '';
      if (isced.includes('1'))      a.kind = 'elem';
      else if (isced.includes('2')) a.kind = 'jhs';
      else if (isced.includes('3')) a.kind = 'hs';
      else if (/(高校|高等)/.test(tags.name || '')) a.kind = 'hs';
      else if (/中学/.test(tags.name || ''))        a.kind = 'jhs';
      else if (/小学/.test(tags.name || ''))        a.kind = 'elem';
    }
  }
  return Object.keys(a).length ? a : null;
}

async function streamFilter() {
  console.log(`  [2/3] PBF parse + filter (POI tags + bbox + nodes only)`);
  const features = [];
  let nodeCount = 0;
  let matchedTagCount = 0;
  let inBboxCount = 0;
  await new Promise((resolve, reject) => {
    fs.createReadStream(PBF)
      .pipe(parseOsmPbf())
      .pipe(through.obj((items, enc, next) => {
        for (const item of items) {
          if (item.type !== 'node') continue;
          nodeCount++;
          const tags = item.tags || {};
          if (!tags.amenity && !tags.shop && !tags.tourism && !tags.leisure &&
              !tags.railway && !tags.highway && !tags.aeroway && !tags.emergency) continue;
          const cat = classifyPOI(tags);
          if (!cat) continue;
          matchedTagCount++;
          const lat = item.lat, lon = item.lon;
          if (lat < south || lat > north || lon < west || lon > east) continue;
          inBboxCount++;
          const props = { category: cat };
          if (tags.name) props.name = tags.name;
          const a = extractAttrs(tags, cat);
          if (a) props.attrs = a;
          features.push({
            type: 'Feature',
            properties: props,
            geometry: { type: 'Point', coordinates: [lon, lat] }
          });
        }
        next();
      }, () => resolve()))
      .on('error', reject);
  });
  console.log(`       parsed nodes=${nodeCount.toLocaleString()}  poi-tagged=${matchedTagCount.toLocaleString()}  in-bbox=${inBboxCount.toLocaleString()}`);
  return features;
}

(async () => {
  await downloadPBF();
  const features = await streamFilter();

  // 3. 出力
  console.log(`  [3/3] write GeoJSON`);
  const outDir = path.join(PROJECT_ROOT, 'input', PREF);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'poi.geojson');
  fs.writeFileSync(outPath, JSON.stringify({ type: 'FeatureCollection', features }));
  const size = fs.statSync(outPath).size;

  // カテゴリ別件数
  const byCat = {};
  for (const f of features) byCat[f.properties.category] = (byCat[f.properties.category] || 0) + 1;
  const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  console.log(`\n=========================================`);
  console.log(`✅ ${PREF}: ${features.length.toLocaleString()} 件 / ${(size/1024).toFixed(1)} KB → ${outPath}`);
  console.log(`=========================================`);
  console.log(`カテゴリ別:`);
  for (const [c, n] of sorted) console.log(`  ${c.padEnd(20)} ${n.toLocaleString()}`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
