#!/usr/bin/env node
/**
 * build-bundle-night-clinics-jp.js
 *
 * 全国の夜間・休日 急患診療所/急病センター
 *
 * 取得元（本番データ）:
 *   1. 国土数値情報 P04（医療機関分布データ・全181,312施設・国交省）
 *      https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P04.html
 *      → 名前正規表現で 夜間|休日|急病|急患|当番医|時間外 をフィルタ
 *   2. 不足分は OSM（Overpass API）から補完
 *      → P04 にない施設名（あれば）を地理近傍マッチで追加
 *
 * 種別 (k):
 *   1 = 病院, 2 = 診療所, 3 = 歯科診療所
 *
 * 出力: data/night-clinics-jp.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const u = require('./bundle-utils.js');

const PROJECT_ROOT = path.join(__dirname, '..');
const TMP = path.join(PROJECT_ROOT, 'tmp');
const OUT = path.join(PROJECT_ROOT, 'data', 'night-clinics-jp.js');
const P04_ZIP = path.join(TMP, 'p04', 'p04.zip');
const P04_DIR = path.join(TMP, 'p04-extract');
const P04_GEOJSON = path.join(P04_DIR, 'P04-20_GML', 'P04-20.geojson');
const P04_URL = 'https://nlftp.mlit.go.jp/ksj/gml/data/P04/P04-20/P04-20_GML.zip';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// ---- 名前フィルタ正規表現 ----
// 夜間/休日/急患/当番医/時間外 → 単独でも夜間診療所として確実
const POS_RE = /(夜間|休日|急患|当番医|時間外|平日夜間)/;
// 急病 は「東急病院」等の偽陽性を避けるため、救急の 急病 にマッチさせず
// かつクリニック語と組み合わせることを要求
const KYUBYO_RE = /(?<!救)急病/;
const KYUBYO_CTX_RE =
  /急病(?:.{0,4})(?:センタ|センタ|ｾﾝﾀ|診療|医療|外来|応急)|急病セ[ンﾝ][タﾀ][ーーｰー－-]/;

function isNightClinicName(name) {
  if (!name) return false;
  if (POS_RE.test(name)) return true;
  if (KYUBYO_RE.test(name) && KYUBYO_CTX_RE.test(name)) return true;
  return false;
}

// ---- P04 抽出 ----
async function ensureP04() {
  if (fs.existsSync(P04_GEOJSON)) return;
  if (!fs.existsSync(P04_ZIP)) {
    fs.mkdirSync(path.dirname(P04_ZIP), { recursive: true });
    console.log(`fetching P04 (${P04_URL}) ...`);
    const buf = await u.fetchBuffer(P04_URL, 600000);
    fs.writeFileSync(P04_ZIP, buf);
  }
  fs.mkdirSync(P04_DIR, { recursive: true });
  console.log(`unzipping P04 ...`);
  execSync(`unzip -o "${P04_ZIP}" -d "${P04_DIR}"`, { stdio: 'pipe' });
}

function loadP04Matches() {
  console.log(`loading P04 geojson ...`);
  const json = JSON.parse(fs.readFileSync(P04_GEOJSON, 'utf8'));
  const out = [];
  for (const f of (json.features || [])) {
    const p = f.properties || {};
    const name = p.P04_002 || '';
    if (!isNightClinicName(name)) continue;
    const c = f.geometry && f.geometry.coordinates;
    if (!c || typeof c[0] !== 'number') continue;
    out.push({
      lat: c[1],
      lng: c[0],
      n: name.replace(/　+$/g, '').trim(),
      k: p.P04_001 || 0,            // 1=病院 2=診療所 3=歯科
      addr: p.P04_003 || '',
    });
  }
  return out;
}

// ---- Overpass 補完（P04 にない施設） ----
async function fetchOverpassNightClinics() {
  // 日本全土から amenity in {clinic, doctors, hospital} かつ
  // 夜間/休日/急患/急病 名前パターンのもの
  const q =
    `[out:json][timeout:600];` +
    `area["ISO3166-1"="JP"][admin_level=2]->.jp;` +
    `(` +
      `nwr["amenity"~"^(clinic|doctors|hospital)$"]["name"~"夜間|休日|急患|急病|当番医|時間外"](area.jp);` +
      `nwr["healthcare"~"^(clinic|doctor|hospital)$"]["name"~"夜間|休日|急患|急病|当番医|時間外"](area.jp);` +
    `);` +
    `out center tags;`;
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 600000);
      try {
        const res = await fetch(ep, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'User-Agent': 'Daikou-app-test/0.1', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(q),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        return await res.json();
      } finally { clearTimeout(t); }
    } catch (err) {
      console.log(`    overpass ${ep} 失敗: ${err.message}`);
    }
  }
  throw new Error('all overpass endpoints failed');
}

async function loadOverpassMatches() {
  const cachePath = path.join(TMP, 'night-clinics-overpass.json');
  let json;
  if (fs.existsSync(cachePath) && (Date.now() - fs.statSync(cachePath).mtimeMs) < 7 * 86400000) {
    console.log(`  overpass cache: ${path.basename(cachePath)}`);
    json = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } else {
    console.log(`  overpass query (japan-wide) ...`);
    const t0 = Date.now();
    json = await fetchOverpassNightClinics();
    console.log(`  overpass got ${(json.elements || []).length} elements / ${((Date.now()-t0)/1000).toFixed(1)}s`);
    fs.writeFileSync(cachePath, JSON.stringify(json));
  }
  const out = [];
  for (const el of (json.elements || [])) {
    const tags = el.tags || {};
    const name = tags.name || '';
    if (!isNightClinicName(name)) continue;
    let lat, lng;
    if (el.type === 'node' && typeof el.lat === 'number') { lat = el.lat; lng = el.lon; }
    else if (el.center) { lat = el.center.lat; lng = el.center.lon; }
    else continue;
    const k = (tags.amenity === 'hospital' || tags.healthcare === 'hospital') ? 1
            : (tags.amenity === 'dentist' || tags.healthcare === 'dentist') ? 3
            : 2;
    out.push({ lat, lng, n: name.trim(), k });
  }
  return out;
}

// 緯度経度の度差→m概算
function distMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

(async () => {
  await ensureP04();
  const p04Items = loadP04Matches();
  console.log(`  P04 マッチ: ${p04Items.length}`);

  let osmItems = [];
  try {
    osmItems = await loadOverpassMatches();
    console.log(`  OSM マッチ: ${osmItems.length}`);
  } catch (err) {
    console.log(`  OSM 取得失敗 (P04 のみで継続): ${err.message}`);
  }

  // 0.005°（≈500m）グリッド索引で OSM の重複を判定
  const idx = new Map();
  for (const it of p04Items) {
    const k = `${Math.round(it.lat * 200)},${Math.round(it.lng * 200)}`;
    (idx.get(k) || idx.set(k, []).get(k)).push(it);
  }
  function near(lat, lng, name) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const k = `${Math.round(lat * 200) + dy},${Math.round(lng * 200) + dx}`;
        const cell = idx.get(k);
        if (!cell) continue;
        for (const c of cell) {
          if (distMeters(lat, lng, c.lat, c.lng) <= 300) return true;
          if (c.n && name && (c.n === name || c.n.includes(name) || name.includes(c.n))) return true;
        }
      }
    }
    return false;
  }
  const items = [...p04Items];
  let osmAdded = 0;
  for (const it of osmItems) {
    if (near(it.lat, it.lng, it.n)) continue;
    items.push(it);
    osmAdded++;
  }
  console.log(`  OSM 補完追加: ${osmAdded}`);
  console.log(`  合計: ${items.length}`);

  const data = u.buildPointBundle(items, (it) => {
    const o = {};
    if (it.n) o.n = it.n;
    if (it.k) o.k = it.k;
    return o;
  });
  data.source = '国土数値情報 P04（医療機関分布・国交省 2020）+ OSM Overpass 補完';
  data.kindLegend = { '1': '病院', '2': '診療所', '3': '歯科診療所' };

  const size = u.writeBundleJs(OUT, 'NIGHT_CLINICS_JP', data, [
    `// 出典: 国土数値情報 P04（医療機関分布・国交省 2020 / CC BY 4.0）`,
    `// 名前正規表現で夜間/休日/急患/急病/当番医/時間外 を抽出 + OSM 補完`,
    `// 件数 ${items.length}（病院${items.filter(i=>i.k===1).length} / 診療所${items.filter(i=>i.k===2).length} / 歯科${items.filter(i=>i.k===3).length}）`,
  ]);
  console.log(`✅ ${OUT}  count=${items.length} size=${(size/1024).toFixed(2)} KB`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
