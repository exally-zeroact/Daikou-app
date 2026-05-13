#!/usr/bin/env node
/**
 * fetch-real-data.js
 *
 * 実データを公開APIから取得して input/{pref}/*.geojson に保存する。
 *
 * 使い方:
 *   node scripts/fetch-real-data.js <pref>
 *   ex: node scripts/fetch-real-data.js ehime
 *
 * 各ソースの実情（2026/05 時点・公開APIのみ）:
 *   - flood / landslide / tsunami : 国交省 国土数値情報 (KSJ) GML ZIP をダウンロード
 *                                    ogr2ogr が無い場合は本スクリプト同梱の簡易 GML→GeoJSON
 *                                    変換を使う（ポリゴン形状のみ・属性は粗い）
 *   - liquefaction               : ❌ 公開ポリゴンAPI無し
 *   - fault                       : ❌ 産総研活断層DBにWFS/JSON API無し → OSM geological=fault でフォールバック
 *   - emergency_route             : ❌ KSJ N04/N06 の県別URL不明 → スキップ
 *   - poi (41カテゴリ)            : ✅ OSM Overpass
 *   - school_zone                 : ✅ OSM Overpass (hazard=school_zone | maxspeed=*+near schools)
 *
 * 取得失敗・対象外は input/{pref}/_REPORT.json に記録する。
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PREF = process.argv[2] || 'ehime';

// 県別 bbox（precision=1e5 → /1e5 で度に戻して使う）。
// ehime: meta.json から拾った値。他県を加えるときは同様に。
const PREF_BBOX = {
  ehime: { south: 32.70859, west: 132.01828, north: 34.29947, east: 133.32927, name_ja: '愛媛県', code: '38' },
};

const PROJECT_ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(PROJECT_ROOT, 'input', PREF);
const RAW_DIR = path.join(OUT_DIR, 'raw');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(RAW_DIR, { recursive: true });

const bbox = PREF_BBOX[PREF];
if (!bbox) { console.error(`Unknown prefecture: ${PREF}`); process.exit(1); }

const report = []; // { source, status, file?, count?, bytes?, reason? }

function log(...args) { console.log(...args); }

// ────────────────────────────────────────────────────────────
// HTTP helper
// ────────────────────────────────────────────────────────────
const UA = { 'User-Agent': 'Daikou-app-test/0.1 (zeroact24.729@outlook.com)' };

async function fetchText(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 60000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, ...opts, headers: { ...UA, ...(opts.headers || {}) } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

async function fetchBuffer(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 120000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, ...opts, headers: { ...UA, ...(opts.headers || {}) } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } finally { clearTimeout(t); }
}

// ────────────────────────────────────────────────────────────
// Overpass POI / school_zone / fault fallback
// ────────────────────────────────────────────────────────────
const OVERPASS = 'https://overpass-api.de/api/interpreter';

async function overpassQuery(q, label, timeoutMs = 180000) {
  log(`  [Overpass] ${label}: query length=${q.length}`);
  const body = 'data=' + encodeURIComponent(q);
  const text = await fetchText(OVERPASS, {
    method: 'POST', body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeoutMs,
  });
  return JSON.parse(text);
}

function elemCenter(e) {
  if (e.type === 'node') return [e.lon, e.lat];
  if (e.center)          return [e.center.lon, e.center.lat];
  return null;
}

// 41 カテゴリの判定ロジック（OSM tags → 内部カテゴリ名）
// 排他的に判定したいので順序が大事
function classifyPOI(tags) {
  const am = tags.amenity, sh = tags.shop, lz = tags.leisure, to = tags.tourism, rw = tags.railway, hw = tags.highway, ay = tags.aeroway, em = tags.emergency, gl = tags.geological;
  const cu = tags.cuisine || '';
  const name = tags.name || '';

  // 防災
  if (em === 'defibrillator') return 'aed';
  // 交通
  if (ay === 'aerodrome' || ay === 'terminal' || ay === 'aeroway') return 'airport';
  if (hw === 'bus_stop')    return 'bus_stop';
  if (rw === 'station')     return 'station';
  // ドライブ
  if (am === 'taxi')        return 'taxi_stand';
  if (am === 'bicycle_parking') return 'bicycle_parking';
  if (hw === 'services')    return 'sapa';
  if (am === 'marketplace' && /道の駅/.test(name)) return 'michinoeki';
  // レジャー
  if (lz === 'golf_course') return 'golf';
  if (am === 'cinema')      return 'cinema';
  if (lz === 'adult_gaming_centre') return 'pachinko';
  if (am === 'karaoke_box') return 'karaoke';
  if (am === 'public_bath' || lz === 'hot_spring') return 'onsen_sento';
  // 金融
  if (am === 'atm')         return 'atm';
  if (am === 'bank')        return 'bank';
  // 行政
  if (am === 'library')     return 'library';
  if (am === 'fire_station') return 'fire_station';
  if (am === 'police')      return 'police_koban';
  if (am === 'post_office') return 'post_office';
  if (am === 'townhall')    return 'city_office';
  // 買い物
  if (sh === 'variety_store') return 'hundred_yen';
  if (sh === 'department_store' || sh === 'mall') return 'department_sc';
  if (sh === 'doityourself' || sh === 'hardware') return 'home_center';
  if (sh === 'supermarket') return 'supermarket';
  // 医療
  if (sh === 'chemist' || am === 'pharmacy') return 'pharmacy_drugstore';
  if (am === 'dentist')     return 'dental';
  if (am === 'clinic' || am === 'doctors') return 'clinic';
  // 飲食特化
  if (am === 'fast_food')   return 'fast_food';
  if (am === 'cafe')        return 'cafe';
  if (am === 'restaurant' || am === 'bar' || am === 'pub') {
    if (cu === 'ramen')     return 'ramen';
    if (cu === 'sushi')     return 'sushi';
    if (cu === 'yakiniku' || cu === 'korean') return 'yakiniku';
    if (cu === 'izakaya')   return 'izakaya';
    return 'restaurant_bar';
  }
  // 既存9のうち残り
  if (to === 'hotel' || to === 'hostel' || to === 'guest_house' || to === 'motel') return 'hotel';
  if (sh === 'convenience') return 'convenience_store';
  if (am === 'fuel')        return 'gas_station';
  if (am === 'hospital')    return 'hospital';
  if (am === 'school')      return 'school';   // 詳細種別は後で kind 設定
  if (am === 'kindergarten' || am === 'college' || am === 'university') return 'school';
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
    if (tags.emergency === 'yes' || tags['healthcare:speciality'] === 'emergency') a.er = 1;
  }
  if (category === 'school') {
    const am = tags.amenity;
    if (am === 'kindergarten')      a.kind = 'kg';
    else if (am === 'college')      a.kind = 'voc';
    else if (am === 'university')   a.kind = 'univ';
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
  if (category === 'parking' || tags.amenity === 'parking') {
    if (tags.fee && tags.fee !== 'no') a.fee = tags.fee === 'yes' ? 'yes' : tags.fee;
    if (tags.maxheight) {
      const m = String(tags.maxheight).match(/[\d.]+/);
      if (m) a.height_m = parseFloat(m[0]);
    }
    if (tags.capacity) {
      const c = parseInt(tags.capacity, 10);
      if (!isNaN(c)) a.cap = c;
    }
  }
  return Object.keys(a).length ? a : null;
}

async function fetchPOI() {
  // bbox での包括的取得（41カテゴリを判定するために幅広いタグを引いてくる）
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const q = `[out:json][timeout:240];
(
  nwr["amenity"](${b});
  nwr["shop"](${b});
  nwr["tourism"](${b});
  nwr["leisure"~"^(golf_course|adult_gaming_centre|hot_spring)$"](${b});
  nwr["railway"="station"](${b});
  nwr["highway"~"^(bus_stop|services)$"](${b});
  nwr["aeroway"~"^(aerodrome|terminal)$"](${b});
  nwr["emergency"="defibrillator"](${b});
);
out center tags;`;

  const json = await overpassQuery(q, `POI bbox=${b}`);
  const features = [];
  for (const e of json.elements) {
    const tags = e.tags || {};
    const cat = classifyPOI(tags);
    if (!cat) continue;
    const c = elemCenter(e);
    if (!c) continue;
    const props = { category: cat };
    if (tags.name) props.name = tags.name;
    const attrs = extractAttrs(tags, cat);
    if (attrs) props.attrs = attrs;
    features.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: c } });
  }
  return { type: 'FeatureCollection', features };
}

async function fetchSchoolZone() {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  // OSM の school zone 関連タグを拾う
  const q = `[out:json][timeout:120];
(
  way["hazard"="school_zone"](${b});
  way["traffic_sign"~"school"](${b});
  way["maxspeed:type"~"school"](${b});
);
out geom;`;
  const json = await overpassQuery(q, `school_zone bbox=${b}`);
  const features = [];
  for (const e of json.elements) {
    if (e.type !== 'way' || !e.geometry) continue;
    const coords = e.geometry.map(p => [p.lon, p.lat]);
    if (coords.length < 2) continue;
    const props = { name: (e.tags && e.tags.name) || `school_zone_${e.id}` };
    features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } });
  }
  return { type: 'FeatureCollection', features };
}

async function fetchFaultOSM() {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const q = `[out:json][timeout:90];
(
  way["geological"="fault"](${b});
  way["fault"="yes"](${b});
);
out geom;`;
  const json = await overpassQuery(q, `geological=fault bbox=${b}`);
  const features = [];
  for (const e of json.elements) {
    if (e.type !== 'way' || !e.geometry) continue;
    const coords = e.geometry.map(p => [p.lon, p.lat]);
    if (coords.length < 2) continue;
    const name = (e.tags && (e.tags.name || e.tags['name:ja'])) || `fault_${e.id}`;
    features.push({ type: 'Feature', properties: { name }, geometry: { type: 'LineString', coordinates: coords } });
  }
  return { type: 'FeatureCollection', features };
}

// ────────────────────────────────────────────────────────────
// MLIT KSJ ダウンロード + 簡易 GML→GeoJSON
// ────────────────────────────────────────────────────────────
async function downloadAndExtract(url, label, zipName) {
  const buf = await fetchBuffer(url, { timeoutMs: 240000 });
  const zipPath = path.join(RAW_DIR, zipName);
  fs.writeFileSync(zipPath, buf);
  log(`  [KSJ] ${label}: downloaded ${(buf.length/1024/1024).toFixed(1)} MB → ${zipName}`);
  // 抽出
  const extractDir = path.join(RAW_DIR, zipName.replace(/\.zip$/, ''));
  fs.mkdirSync(extractDir, { recursive: true });
  try {
    execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, { stdio: 'pipe' });
  } catch (e) {
    throw new Error(`unzip failed: ${e.message}`);
  }
  // GML ファイルを探す
  function findGml(dir) {
    const files = [];
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) files.push(...findGml(p));
      else if (/\.(gml|xml)$/i.test(f.name)) files.push(p);
    }
    return files;
  }
  const gmls = findGml(extractDir);
  log(`  [KSJ] ${label}: extracted, GML files=${gmls.length}`);
  return gmls;
}

// 簡易 GML → ポリゴン GeoJSON 変換（KSJ schema 想定）
// GML の <gml:posList>lat lon lat lon ...</gml:posList> を抽出するだけの粗い実装。
// 属性は本スクリプトでは "_raw_props": all_xml_attrs として全部 GeoJSON properties に入れて
// build-hazard.js 側で改名 or KSJ 仕様に合わせて再整形する想定。
function gmlToGeoJSON_polygons(gmlText, attrMap) {
  // attrMap: { keepKeys: [<element local name>], type: 'flood'|'landslide'|'tsunami' }
  const features = [];

  // ksj:Feature のような Feature 単位を拾う（タグ名は KSJ 各データで異なる）
  // ここでは「属性 + Polygon を持つ」要素を順に検出する単純な走査:
  //  1) <gml:posList ...> ... </gml:posList> を全部取得 → 各 ring を Coordinate 列に
  //  2) 各 posList の前方に並ぶ "属性らしき値" を拾って properties に詰める
  // KSJ の典型: <ksj:EFL_***>NN</ksj:EFL_***>
  // 実用上、属性マッピングは粗いため _raw_first_keys に取れた attr を保持する。

  const posListRegex = /<gml:posList[^>]*>([\s\S]*?)<\/gml:posList>/g;
  // 直前の文字列から ksj: で始まる属性タグを集める
  const ksjAttrRegex = /<ksj:([A-Za-z0-9_]+)[^>]*>([^<]*)<\/ksj:\1>/g;

  let m;
  let lastEnd = 0;
  let pendingAttrs = {};

  while ((m = posListRegex.exec(gmlText)) !== null) {
    // 直前の区間から属性を吸い上げる
    const slice = gmlText.slice(lastEnd, m.index);
    let am;
    while ((am = ksjAttrRegex.exec(slice)) !== null) {
      pendingAttrs[am[1]] = am[2].trim();
    }

    // posList: "lat lon lat lon ..."（GML 通常は lat lon の順）
    const nums = m[1].trim().split(/\s+/).map(Number);
    const coords = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      coords.push([nums[i + 1], nums[i]]); // GeoJSON は [lon, lat]
    }
    if (coords.length >= 4) {
      // 終点と始点が一致しているか確認（ない場合は閉じる）
      const [fx, fy] = coords[0], [lx, ly] = coords[coords.length - 1];
      if (fx !== lx || fy !== ly) coords.push([fx, fy]);

      const props = mapKsjAttrs(pendingAttrs, attrMap);
      features.push({
        type: 'Feature',
        properties: props,
        geometry: { type: 'Polygon', coordinates: [coords] },
      });
      // attrs はリングごとリセット
      pendingAttrs = {};
    }
    lastEnd = m.index + m[0].length;
  }

  return { type: 'FeatureCollection', features };
}

// KSJ 属性 → 本プロジェクト属性へのマッピング
function mapKsjAttrs(rawAttrs, attrMap) {
  const out = { _raw: rawAttrs };
  if (attrMap.type === 'flood' || attrMap.type === 'tsunami') {
    // 浸水深ランク。KSJ は 1〜6 の rank を入れていることが多い（A31 浸水ランク など）
    // 1: <0.5m, 2: 0.5-3m, 3: 3-5m, 4: 5-10m, 5: 10-20m, 6: >20m
    let rank = null;
    for (const k of Object.keys(rawAttrs)) {
      if (/(rank|RankCode|EFL.*rank|FloodRank|InundationDepth)/i.test(k)) {
        const v = parseInt(rawAttrs[k], 10);
        if (!isNaN(v)) { rank = v; break; }
      }
    }
    // 簡略化: 1→0, 2→1, 3→2, 4-6→3
    let depth = 0;
    if (rank === 2) depth = 1;
    else if (rank === 3) depth = 2;
    else if (rank >= 4) depth = 3;
    out.depth = depth;
  } else if (attrMap.type === 'landslide') {
    // A48: 区域種別 ('001'=警戒区域 yellow, '002'=特別警戒 red 等のコード)
    let kind = 'yellow';
    for (const k of Object.keys(rawAttrs)) {
      if (/(area_kind|landslide_kind|ZoneType|A48_002|A48_001)/i.test(k)) {
        const v = rawAttrs[k];
        if (v === '2' || v === '02' || /特別/.test(v)) kind = 'red';
      }
    }
    out.kind = kind;
  }
  return out;
}

async function fetchKsjPolygon(label, urls, attrMap, outName) {
  // 既に有効な出力がある場合はスキップ（idempotent）
  const outPathPrev = path.join(OUT_DIR, outName);
  if (fs.existsSync(outPathPrev) && fs.statSync(outPathPrev).size > 100) {
    const stat = fs.statSync(outPathPrev);
    log(`  ⏩ ${label}: 既存ファイルあり (${(stat.size/1024).toFixed(1)} KB) → スキップ`);
    try {
      const fc = JSON.parse(fs.readFileSync(outPathPrev, 'utf8'));
      report.push({ source: label, status: 'cached', file: outName, count: (fc.features||[]).length, bytes: stat.size });
    } catch {
      report.push({ source: label, status: 'cached', file: outName, bytes: stat.size });
    }
    return;
  }
  let lastErr = null;
  for (const url of urls) {
    try {
      const zipName = path.basename(url);
      const gmls = await downloadAndExtract(url, label, zipName);
      if (gmls.length === 0) throw new Error('GML not found in ZIP');
      // 全 GML を結合（巨大配列の spread はスタック溢れになるので push ループ）
      const allFeatures = [];
      for (const gmlPath of gmls) {
        const text = fs.readFileSync(gmlPath, 'utf8');
        const fc = gmlToGeoJSON_polygons(text, attrMap);
        for (const f of fc.features) allFeatures.push(f);
      }
      const fc = { type: 'FeatureCollection', features: allFeatures };
      const outPath = path.join(OUT_DIR, outName);
      fs.writeFileSync(outPath, JSON.stringify(fc));
      const size = fs.statSync(outPath).size;
      report.push({ source: label, status: 'ok', file: outName, count: allFeatures.length, bytes: size, url });
      log(`  ✅ ${label}: ${allFeatures.length} 件 / ${(size/1024).toFixed(1)} KB → ${outName}`);
      return;
    } catch (e) {
      lastErr = e;
      log(`  …試行失敗 (${url}): ${e.message}`);
    }
  }
  report.push({ source: label, status: 'failed', reason: lastErr ? lastErr.message : 'all URLs failed', tried: urls });
}

// ────────────────────────────────────────────────────────────
// メイン
// ────────────────────────────────────────────────────────────
(async () => {
  log(`[fetch-real-data] prefecture=${PREF} bbox=[${bbox.south},${bbox.west} - ${bbox.north},${bbox.east}]`);
  log(`  out: ${OUT_DIR}`);

  // 1. 洪水（A31-21）
  log('\n--- 1. 洪水浸水想定 (KSJ A31) ---');
  await fetchKsjPolygon(
    '洪水浸水想定',
    [`https://nlftp.mlit.go.jp/ksj/gml/data/A31/A31-21/A31-21_${bbox.code}_GML.zip`],
    { type: 'flood' },
    'flood.geojson'
  );

  // 2. 土砂災害警戒（A48-21）
  log('\n--- 2. 土砂災害警戒区域 (KSJ A48) ---');
  await fetchKsjPolygon(
    '土砂災害警戒区域',
    [`https://nlftp.mlit.go.jp/ksj/gml/data/A48/A48-21/A48-21_${bbox.code}_GML.zip`],
    { type: 'landslide' },
    'landslide.geojson'
  );

  // 3. 津波浸水想定（A40-16）
  log('\n--- 3. 津波浸水想定 (KSJ A40) ---');
  await fetchKsjPolygon(
    '津波浸水想定',
    [`https://nlftp.mlit.go.jp/ksj/gml/data/A40/A40-16/A40-16_${bbox.code}_GML.zip`],
    { type: 'tsunami' },
    'tsunami.geojson'
  );

  // 4. 液状化危険度
  log('\n--- 4. 液状化危険度 (国土地理院) ---');
  report.push({ source: '液状化危険度', status: 'skipped', reason: '公開ポリゴンAPI無し（地理院の液状化マップはラスタ画像タイルのみ・KSJに該当データセット無し）。J-SHIS/防災科研は確率値の格子データのため整合せず。県別データの取得は自治体公開Shapefileの個別ダウンロードが必要。' });
  log('  ⚠️ skip: 公開ポリゴンAPI無し');

  // 5. 活断層（産総研）
  log('\n--- 5. 活断層 (産総研→OSMフォールバック) ---');
  try {
    const fc = await fetchFaultOSM();
    const outPath = path.join(OUT_DIR, 'fault.geojson');
    fs.writeFileSync(outPath, JSON.stringify(fc));
    const size = fs.statSync(outPath).size;
    report.push({
      source: '活断層',
      status: fc.features.length > 0 ? 'ok-fallback-osm' : 'empty-fallback-osm',
      file: 'fault.geojson', count: fc.features.length, bytes: size,
      note: '産総研活断層DBは公開WFS/JSON APIが見つからず、OSM geological=fault でフォールバック。本格運用は産総研活断層DB(https://gbank.gsj.jp/activefault/) からのShape手動DLが必要。',
    });
    log(`  ✅ 活断層 (OSM fallback): ${fc.features.length} 件 / ${(size/1024).toFixed(1)} KB`);
  } catch (e) {
    report.push({ source: '活断層', status: 'failed', reason: e.message });
    log(`  ❌ 活断層: ${e.message}`);
  }

  // 6. POI
  log('\n--- 6. POI (Overpass) ---');
  try {
    const fc = await fetchPOI();
    const outPath = path.join(OUT_DIR, 'poi.geojson');
    fs.writeFileSync(outPath, JSON.stringify(fc));
    const size = fs.statSync(outPath).size;
    // カテゴリ別件数
    const byCat = {};
    for (const f of fc.features) byCat[f.properties.category] = (byCat[f.properties.category] || 0) + 1;
    report.push({ source: 'POI', status: 'ok', file: 'poi.geojson', count: fc.features.length, bytes: size, byCategory: byCat });
    log(`  ✅ POI: ${fc.features.length} 件 / ${(size/1024).toFixed(1)} KB / カテゴリ ${Object.keys(byCat).length} 種`);
  } catch (e) {
    report.push({ source: 'POI', status: 'failed', reason: e.message });
    log(`  ❌ POI: ${e.message}`);
  }

  // 7. スクールゾーン
  log('\n--- 7. スクールゾーン (Overpass) ---');
  try {
    const fc = await fetchSchoolZone();
    const outPath = path.join(OUT_DIR, 'school.geojson');
    fs.writeFileSync(outPath, JSON.stringify(fc));
    const size = fs.statSync(outPath).size;
    report.push({ source: 'スクールゾーン', status: 'ok', file: 'school.geojson', count: fc.features.length, bytes: size });
    log(`  ${fc.features.length > 0 ? '✅' : '⚠️ '} スクールゾーン: ${fc.features.length} 件 / ${(size/1024).toFixed(1)} KB`);
    if (fc.features.length === 0) {
      report[report.length - 1].note = 'OSM の hazard=school_zone タグはまだ整備が薄く 0 件になりがち。県オープンデータからの取り込みが本筋。';
    }
  } catch (e) {
    report.push({ source: 'スクールゾーン', status: 'failed', reason: e.message });
    log(`  ❌ スクールゾーン: ${e.message}`);
  }

  // 8. 緊急輸送道路
  log('\n--- 8. 緊急輸送道路 ---');
  report.push({
    source: '緊急輸送道路',
    status: 'skipped',
    reason: 'KSJ N04/N06 の県別URLパターンが見つからず、自動取得不可。各県の防災基本計画に紐づく本データは、愛媛県オープンデータカタログ（https://www.pref.ehime.jp/h12200/opendata/）または国土数値情報「緊急輸送道路」(https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N04.html) からのShape/CSV手動DLが必要。',
    estimated_size: '愛媛県内 数百〜千数百本（サイズ概算 100-300KB GeoJSON）',
  });
  log('  ⚠️ skip: 県別自動取得URL無し（report に詳細）');

  // ────────────────────────────────────────────────────────────
  fs.writeFileSync(path.join(OUT_DIR, '_REPORT.json'), JSON.stringify(report, null, 2));
  log('\n=========================================');
  log('  サマリ');
  log('=========================================');
  for (const r of report) {
    const tag = r.status === 'ok' ? '✅' : r.status.startsWith('ok-') ? '🟡' : r.status === 'skipped' ? '⏭️' : '❌';
    log(`  ${tag} ${r.source.padEnd(12)} ${r.status.padEnd(20)} ${r.count != null ? `count=${r.count}` : ''} ${r.bytes != null ? `size=${(r.bytes/1024).toFixed(1)}KB` : ''}`);
  }
  log(`\nレポート: input/${PREF}/_REPORT.json`);
})().catch(err => { console.error('FATAL:', err); process.exit(1); });
