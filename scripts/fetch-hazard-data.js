#!/usr/bin/env node
/**
 * fetch-hazard-data.js
 *
 * 47都道府県別に KSJ ZIP をダウンロードして
 *   input/{pref}/{flood,tsunami,landslide}.geojson
 * を「正しい属性付き」で出力する。
 *
 * 既存の fetch-real-data.js は 簡易 GML パーサで属性が落ちる問題があり
 * 本スクリプトは ZIP 同梱の GEOJSON / Shapefile を直接読むことで
 * KSJ オリジナル属性 (A31_105, A40_003, A48_004) を確実に保持する。
 *
 * 使い方:
 *   node scripts/fetch-hazard-data.js <pref>
 *   ex: node scripts/fetch-hazard-data.js ehime
 *
 * 出典:
 *   A31-21 国土数値情報「洪水浸水想定区域」(国交省)
 *   A40-16 国土数値情報「津波浸水想定」(国交省)
 *   A48-21 国土数値情報「土砂災害警戒区域」(国交省)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function requireGlobal(name) {
  try {
    return require(name);
  } catch {}
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(root, name));
}
const shapefile = requireGlobal('shapefile');

// 47 都道府県 + KSJ コード (JIS X 0401)
const PREFS = {
  hokkaido: '01',
  aomori: '02',
  iwate: '03',
  miyagi: '04',
  akita: '05',
  yamagata: '06',
  fukushima: '07',
  ibaraki: '08',
  tochigi: '09',
  gunma: '10',
  saitama: '11',
  chiba: '12',
  tokyo: '13',
  kanagawa: '14',
  niigata: '15',
  toyama: '16',
  ishikawa: '17',
  fukui: '18',
  yamanashi: '19',
  nagano: '20',
  gifu: '21',
  shizuoka: '22',
  aichi: '23',
  mie: '24',
  shiga: '25',
  kyoto: '26',
  osaka: '27',
  hyogo: '28',
  nara: '29',
  wakayama: '30',
  tottori: '31',
  shimane: '32',
  okayama: '33',
  hiroshima: '34',
  yamaguchi: '35',
  tokushima: '36',
  kagawa: '37',
  ehime: '38',
  kochi: '39',
  fukuoka: '40',
  saga: '41',
  nagasaki: '42',
  kumamoto: '43',
  oita: '44',
  miyazaki: '45',
  kagoshima: '46',
  okinawa: '47',
};

const PROJECT_ROOT = path.join(__dirname, '..');
const UA = { 'User-Agent': 'Daikou-app-test/0.1 (zeroact24.729@outlook.com)' };

const PREF = process.argv[2];
if (!PREF || !PREFS[PREF]) {
  console.error('Usage: fetch-hazard-data.js <pref>');
  console.error('Available:', Object.keys(PREFS).join(' '));
  process.exit(1);
}
const PCODE = PREFS[PREF];
const OUT_DIR = path.join(PROJECT_ROOT, 'input', PREF);
const RAW_DIR = path.join(OUT_DIR, 'raw');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(RAW_DIR, { recursive: true });

console.log(`[fetch-hazard-data] pref=${PREF} code=${PCODE}`);

// ─── HTTP / unzip helpers ──────────────────────────────────────────
async function fetchBuffer(url, timeoutMs = 240000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

function unzipTo(zipPath, dir) {
  fs.mkdirSync(dir, { recursive: true });
  // KSJ ZIP は Windows パス区切り (\) のため unzip が warn を出すが
  // 抽出自体は成功する。exit code 1 (warning) は許容する。
  try {
    execSync(`unzip -o "${zipPath}" -d "${dir}"`, { stdio: 'pipe' });
  } catch (err) {
    // warning レベル (exit 1) は無視。それ以外 (>=2) は再 throw
    if (err.status > 1) throw err;
  }
}

function findFiles(dir, pattern) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findFiles(p, pattern));
    else if (pattern.test(e.name)) out.push(p);
  }
  return out;
}

async function downloadZipIfNeeded(url, fname) {
  const zipPath = path.join(RAW_DIR, fname);
  if (fs.existsSync(zipPath) && fs.statSync(zipPath).size > 1024) {
    console.log(`  cache: ${fname} (${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB)`);
    return zipPath;
  }
  console.log(`  DL: ${url}`);
  const buf = await fetchBuffer(url);
  fs.writeFileSync(zipPath, buf);
  console.log(`  saved ${fname} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
  return zipPath;
}

// ─── A31 洪水 (浸水想定区域) ──────────────────────────────────────
// ZIP 内に多数の GEOJSON ファイル (河川別) → マージ
// 属性 A31_105 = 浸水ランク (1=<0.5m, 2=0.5-3m, 3=3-5m, 4=5-10m, 5=10-20m, 6=>20m)
// → depth 0-3 にマッピング:  1→0, 2→1, 3→2, 4-6→3
function rankToDepth(rank) {
  if (rank <= 1) return 0;
  if (rank === 2) return 1;
  if (rank === 3) return 2;
  return 3;
}

// 1次メッシュ番号は 4 桁: 上 2 桁 = (lat * 1.5)、下 2 桁 = (lng - 100)
// 都道府県別の 1次メッシュ一覧 (A31-22 メッシュ単位 ZIP 取得用)
// 各 pref の bbox 内に含まれる 1次メッシュ・cls=10 (洪水予報河川) と
// cls=20 (その他) を両方取得。実際のポリゴンは bbox check で県別フィルタ。
const PREF_MESHES = {
  aichi: ['5236', '5237', '5337', '5338'],
  kyoto: ['5135', '5235', '5335'],
  nara: ['5135', '5235'],
};
const PREF_FLOOD_BBOX = {
  aichi: [34.55, 136.65, 35.45, 137.85],
  kyoto: [34.7, 134.85, 35.8, 136.05],
  nara: [33.85, 135.65, 34.8, 136.2],
};

// 大きな GML を SAX ストリーム解析 (Node の string limit 回避)
function parseA31GmlStream(xmlPath, prefBbox, outAccumulator) {
  const sax = requireGlobal('sax');
  return new Promise((resolve, reject) => {
    const parser = sax.createStream(true, { trim: true });
    const curveById = {}; // cvId → posList string
    const surfToCurve = {}; // sfId → cvId
    let curveId = null;
    let surfId = null;
    let posListBuf = '';
    let inPosList = false;
    let surfHref = null;
    let scaleSurfHref = null;
    let scaleDepth = null;
    let inWaterDepth = false;

    parser.on('opentag', (node) => {
      const name = node.name;
      const attrs = node.attributes || {};
      if (name === 'gml:Curve' && attrs['gml:id']) {
        curveId = attrs['gml:id'];
      } else if (name === 'gml:Surface' && attrs['gml:id']) {
        surfId = attrs['gml:id'];
      } else if (name === 'gml:posList') {
        inPosList = true;
        posListBuf = '';
      } else if (name === 'gml:curveMember' && surfId && attrs['xlink:href']) {
        surfHref = attrs['xlink:href'].replace('#', '');
        surfToCurve[surfId] = surfHref;
      } else if (name === 'ksj:bounds' && attrs['xlink:href']) {
        scaleSurfHref = attrs['xlink:href'].replace('#', '');
      } else if (name === 'ksj:waterDepth') {
        inWaterDepth = true;
      }
    });
    parser.on('text', (t) => {
      if (inPosList) posListBuf += t;
      if (inWaterDepth) scaleDepth = (scaleDepth || '') + t;
    });
    parser.on('closetag', (name) => {
      if (name === 'gml:posList') {
        inPosList = false;
        if (curveId) curveById[curveId] = posListBuf;
        posListBuf = '';
      } else if (name === 'gml:Curve') {
        curveId = null;
      } else if (name === 'gml:Surface') {
        surfId = null;
        surfHref = null;
      } else if (name === 'ksj:waterDepth') {
        inWaterDepth = false;
      } else if (name === 'ksj:MaximumScale' || name === 'ksj:PlannedScale') {
        // フィーチャ完成
        const sfId = scaleSurfHref;
        const rank = parseInt(scaleDepth, 10);
        scaleSurfHref = null;
        scaleDepth = null;
        if (!sfId || isNaN(rank)) return;
        const cvId = surfToCurve[sfId];
        if (!cvId) return;
        const posList = curveById[cvId];
        if (!posList) return;
        const nums = posList.trim().split(/\s+/).map(parseFloat);
        if (nums.length < 6) return;
        const coords = [];
        let cLat = 0,
          cLng = 0,
          cnt = 0;
        for (let i = 0; i + 1 < nums.length; i += 2) {
          const lat = nums[i],
            lng = nums[i + 1];
          coords.push([lng, lat]);
          cLat += lat;
          cLng += lng;
          cnt++;
        }
        if (cnt < 3) return;
        const cx = cLng / cnt,
          cy = cLat / cnt;
        if (cy < prefBbox[0] || cy > prefBbox[2] || cx < prefBbox[1] || cx > prefBbox[3]) return;
        if (
          coords[0][0] !== coords[coords.length - 1][0] ||
          coords[0][1] !== coords[coords.length - 1][1]
        ) {
          coords.push(coords[0]);
        }
        const depth = rankToDepth(rank);
        outAccumulator.counts[depth]++;
        outAccumulator.features.push({
          type: 'Feature',
          properties: { depth, rank, _raw: { waterDepth: rank }, _src: 'A31-22' },
          geometry: { type: 'Polygon', coordinates: [coords] },
        });
      }
    });
    parser.on('error', (err) => reject(err));
    parser.on('end', () => resolve());
    fs.createReadStream(xmlPath).pipe(parser);
  });
}

// A31-22 メッシュ ZIP 内の GML を解析して
// 都道府県 bbox 内の想定最大規模ポリゴンを抽出 (ストリーム解析)
async function fetchA31FromMeshes(meshes, prefBbox) {
  const acc = { features: [], counts: { 0: 0, 1: 0, 2: 0, 3: 0 } };
  for (const mesh of meshes) {
    for (const cls of ['20', '10']) {
      const url = `https://nlftp.mlit.go.jp/ksj/gml/data/A31/A31-22/A31-22_${cls}_${mesh}_GML.zip`;
      const fname = `A31-22_${cls}_${mesh}_GML.zip`;
      let zipPath;
      try {
        zipPath = await downloadZipIfNeeded(url, fname);
      } catch (e) {
        console.log(`    mesh=${mesh} cls=${cls} 取得失敗 (OK)`);
        continue;
      }
      const extractDir = path.join(RAW_DIR, `A31-22_${cls}_${mesh}_GML`);
      unzipTo(zipPath, extractDir);
      // 想定最大規模 (20_*A31-20-22*.xml) のみ
      const xmls = findFiles(extractDir, /^A31-20-22_.*\.xml$/i);
      for (const xp of xmls) {
        const before = acc.features.length;
        await parseA31GmlStream(xp, prefBbox, acc);
        console.log(`    parsed ${path.basename(xp)} → +${acc.features.length - before} feats`);
      }
    }
  }
  return acc;
}

async function fetchA31() {
  // KSJ A31 浸水想定区域 ダウンロード戦略 (本番運用・命に関わる情報):
  //   1. A31-21 (2021版・県別 ZIP) を試す → 多くの県
  //   2. 失敗 (404) なら A31-20 (2020版・県別 ZIP) → 鳥取
  //   3. 失敗 (404) なら A31-22 (2022版・1次メッシュ単位) → 愛知/京都/奈良
  //   ※ A31-12 (2012) は H29水防法改正前のため使わない
  const candidates = [
    {
      ver: 'A31-21',
      url: `https://nlftp.mlit.go.jp/ksj/gml/data/A31/A31-21/A31-21_${PCODE}_GML.zip`,
    },
    {
      ver: 'A31-20',
      url: `https://nlftp.mlit.go.jp/ksj/gml/data/A31/A31-20/A31-20_${PCODE}_GML.zip`,
    },
  ];
  let zipPath = null,
    usedVer = null;
  for (const c of candidates) {
    try {
      zipPath = await downloadZipIfNeeded(c.url, `${c.ver}_${PCODE}_GML.zip`);
      usedVer = c.ver;
      break;
    } catch (err) {
      console.log(`  A31 ${c.ver} 失敗: ${err.message}`);
    }
  }
  // A31-22 メッシュベースフォールバック (4.0版 最新・想定最大規模)
  if (!zipPath && PREF_MESHES[PREF]) {
    console.log(`  A31-22 メッシュフォールバック: ${PREF_MESHES[PREF].join(',')}`);
    const { features, counts } = await fetchA31FromMeshes(PREF_MESHES[PREF], PREF_FLOOD_BBOX[PREF]);
    fs.writeFileSync(
      path.join(OUT_DIR, 'flood.geojson'),
      JSON.stringify({ type: 'FeatureCollection', features })
    );
    console.log(
      `  A31-22 → flood.geojson: ${features.length} feats / depth 0:${counts[0]} 1:${counts[1]} 2:${counts[2]} 3:${counts[3]}`
    );
    return features.length;
  }
  if (!zipPath) {
    console.log(`  A31 取得不可・空 flood.geojson 出力`);
    fs.writeFileSync(
      path.join(OUT_DIR, 'flood.geojson'),
      JSON.stringify({ type: 'FeatureCollection', features: [] })
    );
    return 0;
  }
  console.log(`  A31 採用版: ${usedVer}`);
  const extractDir = path.join(RAW_DIR, `${usedVer}_${PCODE}_GML`);
  unzipTo(zipPath, extractDir);
  const geojsons = findFiles(extractDir, /^A31-.*\.geojson$/i);
  console.log(`  A31: ${geojsons.length} 河川別 GEOJSON 発見`);
  const features = [];
  let counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const gp of geojsons) {
    let text;
    try {
      text = fs.readFileSync(gp, 'utf8');
    } catch {
      continue;
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      continue;
    }
    for (const f of json.features || []) {
      if (!f.geometry) continue;
      const props = f.properties || {};
      // KSJ A31 各版で属性キーが異なる:
      //   A31-21: A31_105 (計画規模) / A31_205 (想定最大規模)
      //   A31-20: A31_405 (想定最大規模)
      //   いずれも 5 番目フィールド = 浸水ランク (1-6)
      const rankKey = Object.keys(props).find((k) => /^A31_\d05$/.test(k));
      if (!rankKey) continue;
      const rank = parseInt(props[rankKey], 10);
      if (isNaN(rank)) continue;
      const depth = rankToDepth(rank);
      counts[depth]++;
      const basinKey = rankKey.replace('5', '2');
      features.push({
        type: 'Feature',
        properties: {
          depth,
          rank,
          basin: props[basinKey] || '',
          _raw: { [rankKey]: rank },
        },
        geometry: f.geometry,
      });
    }
  }
  fs.writeFileSync(
    path.join(OUT_DIR, 'flood.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features })
  );
  console.log(
    `  A31 → flood.geojson: ${features.length} feats / depth 0:${counts[0]} 1:${counts[1]} 2:${counts[2]} 3:${counts[3]}`
  );
  return features.length;
}

// ─── A40 津波 (浸水想定) ───────────────────────────────────────────
// ZIP 内は Shapefile (.shp/.dbf)・GEOJSON 同梱無し
// 属性 A40_003 = 浸水深テキスト (Shift-JIS)
//   "0.01m〜0.3m未満" / "0.3m〜1m未満" / ... / "20m以上"
// 数値の先頭部分 (ASCII) は文字化けせずに残るので正規表現で抽出
async function fetchA40() {
  const url = `https://nlftp.mlit.go.jp/ksj/gml/data/A40/A40-16/A40-16_${PCODE}_GML.zip`;
  let zipPath;
  try {
    zipPath = await downloadZipIfNeeded(url, `A40-16_${PCODE}_GML.zip`);
  } catch (err) {
    console.log(`  A40: 取得失敗 (内陸県は津波データ無いので OK) ${err.message}`);
    fs.writeFileSync(
      path.join(OUT_DIR, 'tsunami.geojson'),
      JSON.stringify({ type: 'FeatureCollection', features: [] })
    );
    return 0;
  }
  const extractDir = path.join(RAW_DIR, `A40-16_${PCODE}_GML`);
  unzipTo(zipPath, extractDir);
  const shps = findFiles(extractDir, /^A40-.*\.shp$/i);
  if (shps.length === 0) {
    console.log(`  A40: shapefile 見つからず`);
    fs.writeFileSync(
      path.join(OUT_DIR, 'tsunami.geojson'),
      JSON.stringify({ type: 'FeatureCollection', features: [] })
    );
    return 0;
  }
  const features = [];
  let counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const shpPath of shps) {
    const dbfPath = shpPath.replace(/\.shp$/i, '.dbf');
    if (!fs.existsSync(dbfPath)) continue;
    const src = await shapefile.open(shpPath, dbfPath);
    while (true) {
      const r = await src.read();
      if (r.done) break;
      const props = r.value.properties || {};
      const s = props.A40_003 || '';
      const m = s.match(/^([\d.]+)m/);
      const lead = m ? parseFloat(m[1]) : NaN;
      let depth;
      if (isNaN(lead)) depth = 0;
      else if (lead < 1) depth = 0;
      else if (lead < 2) depth = 1;
      else if (lead < 5) depth = 2;
      else depth = 3;
      counts[depth]++;
      features.push({
        type: 'Feature',
        properties: { depth, _raw: { lead_m: lead } },
        geometry: r.value.geometry,
      });
    }
  }
  fs.writeFileSync(
    path.join(OUT_DIR, 'tsunami.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features })
  );
  console.log(
    `  A40 → tsunami.geojson: ${features.length} feats / depth 0:${counts[0]} 1:${counts[1]} 2:${counts[2]} 3:${counts[3]}`
  );
  return features.length;
}

// ─── A48 土砂災害警戒区域 ──────────────────────────────────────────
// ZIP 内に GEOJSON 同梱
// 属性 A48_004 = 区域種別
//   1 = 警戒区域 (yellow)
//   2 = 特別警戒区域 (red)
async function fetchA48() {
  const url = `https://nlftp.mlit.go.jp/ksj/gml/data/A48/A48-21/A48-21_${PCODE}_GML.zip`;
  let zipPath;
  try {
    zipPath = await downloadZipIfNeeded(url, `A48-21_${PCODE}_GML.zip`);
  } catch (err) {
    console.log(`  A48: 取得失敗 ${err.message}`);
    fs.writeFileSync(
      path.join(OUT_DIR, 'landslide.geojson'),
      JSON.stringify({ type: 'FeatureCollection', features: [] })
    );
    return 0;
  }
  const extractDir = path.join(RAW_DIR, `A48-21_${PCODE}_GML`);
  unzipTo(zipPath, extractDir);
  const geojsons = findFiles(extractDir, /^A48-.*\.geojson$/i);
  if (geojsons.length === 0) {
    console.log(`  A48: GEOJSON 見つからず`);
    fs.writeFileSync(
      path.join(OUT_DIR, 'landslide.geojson'),
      JSON.stringify({ type: 'FeatureCollection', features: [] })
    );
    return 0;
  }
  const features = [];
  let counts = { red: 0, yellow: 0 };
  for (const gp of geojsons) {
    let text;
    try {
      text = fs.readFileSync(gp, 'utf8');
    } catch {
      continue;
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      continue;
    }
    for (const f of json.features || []) {
      if (!f.geometry) continue;
      const props = f.properties || {};
      const code = parseInt(props.A48_004, 10);
      const kind = code === 2 ? 'red' : 'yellow';
      counts[kind]++;
      features.push({
        type: 'Feature',
        properties: {
          kind,
          name: props.A48_005 || '',
          city: props.A48_002 || '',
          _raw: { A48_004: code },
        },
        geometry: f.geometry,
      });
    }
  }
  fs.writeFileSync(
    path.join(OUT_DIR, 'landslide.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features })
  );
  console.log(
    `  A48 → landslide.geojson: ${features.length} feats / red:${counts.red} yellow:${counts.yellow}`
  );
  return features.length;
}

// ─── 都道府県名 ja → Overpass area 用 ───────────────────────────
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

// ─── 活断層 (OSM Overpass) ─────────────────────────────────────
async function fetchFault() {
  const ja = PREF_NAMES_JA[PREF];
  const q =
    '[out:json][timeout:300];' +
    `area["name"="${ja}"]->.ep;` +
    '(' +
    'way["geological"="fault"](area.ep);' +
    'way["fault"="yes"](area.ep);' +
    ');' +
    'out tags geom;';
  const ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];
  let json = null;
  for (const ep of ENDPOINTS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 300000);
      try {
        const res = await fetch(ep, {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'User-Agent': UA['User-Agent'],
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'data=' + encodeURIComponent(q),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        json = await res.json();
        break;
      } finally {
        clearTimeout(t);
      }
    } catch (err) {
      console.log(`  fault overpass ${ep} failed: ${err.message}`);
    }
  }
  const features = [];
  if (json && json.elements) {
    for (const e of json.elements) {
      if (e.type !== 'way' || !e.geometry) continue;
      const coords = e.geometry.map((p) => [p.lon, p.lat]);
      if (coords.length < 2) continue;
      const name = (e.tags && (e.tags.name || e.tags['name:ja'])) || `fault_${e.id}`;
      features.push({
        type: 'Feature',
        properties: { name },
        geometry: { type: 'LineString', coordinates: coords },
      });
    }
  }
  fs.writeFileSync(
    path.join(OUT_DIR, 'fault.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features })
  );
  console.log(`  fault → fault.geojson: ${features.length} ways`);
  return features.length;
}

// ─── 液状化: 公開API無いので空ファイル (ehime テストフィクスチャは保持) ──
function ensureLiquefaction() {
  const fp = path.join(OUT_DIR, 'liquefaction.geojson');
  if (fs.existsSync(fp)) return -1; // 既存テスト固定値があれば触らない
  fs.writeFileSync(fp, JSON.stringify({ type: 'FeatureCollection', features: [] }));
  console.log(`  liquefaction → 空ファイル (公開API無し)`);
  return 0;
}

// ─── main ──────────────────────────────────────────────────────────
(async () => {
  const t0 = Date.now();
  let f31 = 0,
    f40 = 0,
    f48 = 0,
    ff = 0,
    fl = 0;
  try {
    f31 = await fetchA31();
  } catch (e) {
    console.log(`  A31 failed: ${e.message}`);
  }
  try {
    f40 = await fetchA40();
  } catch (e) {
    console.log(`  A40 failed: ${e.message}`);
  }
  try {
    f48 = await fetchA48();
  } catch (e) {
    console.log(`  A48 failed: ${e.message}`);
  }
  try {
    ff = await fetchFault();
  } catch (e) {
    console.log(`  fault failed: ${e.message}`);
  }
  try {
    fl = ensureLiquefaction();
  } catch (e) {
    console.log(`  liquefaction failed: ${e.message}`);
  }
  console.log(
    `✅ ${PREF}: flood=${f31} tsunami=${f40} landslide=${f48} fault=${ff} liquefaction=${fl >= 0 ? fl : 'kept'} (${((Date.now() - t0) / 1000).toFixed(1)}s)`
  );
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
