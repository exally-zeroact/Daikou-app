#!/usr/bin/env node
/**
 * build-bundle-emergency-medical-jp.js
 *
 * 災害拠点病院（厚労省指定 743 施設）を data/emergency-medical-jp.js に出力
 *
 * 取得元:
 *   EMIS（厚労省「広域災害救急医療情報システム」）の ArcGIS Feature Service
 *     https://services8.arcgis.com/rGc6Kyg1ETR5TWY9/arcgis/rest/services/hospital_base_auto/FeatureServer/0
 *   - 743 件・座標・住所・二次医療圏付き
 *   - 'name' フィールドはこの公開レイヤでは null（EMIS 仕様）
 *     → 表示名は OSM POI 病院（c=4）から最近傍マッチで補完し、無ければ住所を使用
 */
const fs = require('fs');
const path = require('path');
const u = require('./bundle-utils.js');

const PROJECT_ROOT = path.join(__dirname, '..');
const TMP = path.join(PROJECT_ROOT, 'tmp');
const OUT = path.join(PROJECT_ROOT, 'data', 'emergency-medical-jp.js');
const EMIS_URL =
  'https://services8.arcgis.com/rGc6Kyg1ETR5TWY9/arcgis/rest/services/hospital_base_auto/FeatureServer/0/query'
  + '?where=1%3D1&outFields=name,%E4%BD%8F%E6%89%80,%E4%BA%8C%E6%AC%A1%E5%8C%BB%E7%99%82%E5%9C%8F'
  + '&returnGeometry=true&outSR=4326&resultRecordCount=2000&f=json';

const MATCH_RADIUS_M = 400; // OSM 病院との最大マッチ距離

// ---- ユーティリティ ----
// 緯度経度の度差→m概算（小範囲なら平面近似で十分）
function distMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 0.01°（≈1.1km）グリッド索引（OSM 病院）
function buildOsmHospitalIndex() {
  const index = new Map(); // key="latGrid,lngGrid" -> [{lat,lng,n,h24}]
  const dataDir = path.join(PROJECT_ROOT, 'data');
  const poiFiles = fs.readdirSync(dataDir).filter(f => /^poi-.+\.js$/.test(f));
  let count = 0;
  for (const file of poiFiles) {
    const text = fs.readFileSync(path.join(dataDir, file), 'utf8');
    const m = text.match(/window\.[A-Z_]+ = (\{[\s\S]*?\});/);
    if (!m) continue;
    const o = JSON.parse(m[1]);
    const prec = o.precision || 100000;
    for (const p of (o.pois || [])) {
      if (p.c !== 4) continue;
      const lat = p.lat / prec;
      const lng = p.lng / prec;
      const key = `${Math.floor(lat * 100)},${Math.floor(lng * 100)}`;
      const entry = { lat, lng, n: p.n || '', h24: p.a && p.a.h24 ? 1 : 0 };
      (index.get(key) || index.set(key, []).get(key)).push(entry);
      count++;
    }
  }
  return { index, count };
}

function nearestOsmHospital(lat, lng, idx) {
  const cellLat = Math.floor(lat * 100);
  const cellLng = Math.floor(lng * 100);
  let best = null, bestD = Infinity;
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLng = -1; dLng <= 1; dLng++) {
      const key = `${cellLat + dLat},${cellLng + dLng}`;
      const cell = idx.get(key);
      if (!cell) continue;
      for (const h of cell) {
        const d = distMeters(lat, lng, h.lat, h.lng);
        if (d < bestD) { bestD = d; best = h; }
      }
    }
  }
  return { hospital: best, dist: bestD };
}

// 「県名 市区町村」だけを抽出（フル住所からの推定用）
function inferPrefFromAddress(addr) {
  if (!addr) return '';
  const m = addr.match(/^(北海道|.{2,3}[都府県])/);
  return m ? m[1] : '';
}

(async () => {
  console.log(`fetching EMIS Feature Service ...`);
  const cachePath = path.join(TMP, 'emis-features.json');
  let raw;
  if (fs.existsSync(cachePath) && (Date.now() - fs.statSync(cachePath).mtimeMs) < 86400000) {
    console.log(`  using cache: ${cachePath}`);
    raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } else {
    const text = await u.fetchText(EMIS_URL, 60000);
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(cachePath, text);
    raw = JSON.parse(text);
  }
  if (raw.error) throw new Error('EMIS API error: ' + JSON.stringify(raw.error));
  const features = raw.features || [];
  console.log(`  EMIS features: ${features.length} / exceededTransferLimit=${raw.exceededTransferLimit ? 'yes' : 'no'}`);

  console.log(`indexing OSM hospitals ...`);
  const { index: osmIdx, count: osmCount } = buildOsmHospitalIndex();
  console.log(`  OSM hospitals: ${osmCount}`);

  console.log(`matching EMIS → OSM ...`);
  const items = [];
  let matched = 0, addrFallback = 0;
  for (const f of features) {
    const g = f.geometry;
    if (!g || typeof g.x !== 'number' || typeof g.y !== 'number') continue;
    const lat = g.y, lng = g.x;
    const a = f.attributes || {};
    const addr = a['住所'] || '';
    const region = a['二次医療圏'] || '';

    const { hospital, dist } = nearestOsmHospital(lat, lng, osmIdx);
    let name = '';
    let h24 = 0;
    if (hospital && dist <= MATCH_RADIUS_M && hospital.n) {
      name = hospital.n;
      h24 = hospital.h24;
      matched++;
    } else if (addr) {
      name = addr;
      addrFallback++;
    } else if (region) {
      name = region + ' 災害拠点病院';
      addrFallback++;
    } else {
      name = '災害拠点病院';
      addrFallback++;
    }
    items.push({ lat, lng, n: name, h24 });
  }
  console.log(`  OSM 名前マッチ: ${matched} / 住所フォールバック: ${addrFallback}`);

  const data = u.buildPointBundle(items, (it) => {
    const o = {};
    if (it.n) o.n = it.n;
    if (it.h24) o.h = 1;
    return o;
  });
  data.source = 'EMIS（厚労省 広域災害救急医療情報システム）災害拠点病院 743 施設';
  data.note = `名前は OSM 病院近傍マッチ（${MATCH_RADIUS_M}m 以内）または EMIS 住所をフォールバック`;

  const size = u.writeBundleJs(OUT, 'EMERGENCY_MEDICAL_JP', data, [
    `// 出典: EMIS（厚労省 広域災害救急医療情報システム）`,
    `// services8.arcgis.com/rGc6Kyg1ETR5TWY9 hospital_base_auto/FeatureServer/0`,
    `// 件数 ${items.length} 施設（厚労省指定災害拠点病院）`,
    `// 表示名: OSM POI 名前 ${matched} / 住所 ${addrFallback}`,
  ]);
  console.log(`✅ ${OUT}  count=${items.length} size=${(size/1024).toFixed(2)} KB`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
