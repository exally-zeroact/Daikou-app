#!/usr/bin/env node
/**
 * fetch-liquefaction.js
 *
 * 国土地理院 重ねるハザードマップ「液状化全国」タイルから
 * 都道府県別の液状化ハザード polygon GeoJSON を生成し,
 * build-hazard.js liquefaction で data/hazard-liquefaction-{pref}.js に出力する.
 *
 * タイル URL : https://disaportal.gsi.go.jp/data/raster/08_03_ekijoka_zenkoku/{z}/{x}/{y}.png
 * 既定 zoom : 12
 * 色 → rank :
 *    rgb(255,245,0)   → rank 0 (低い・黄)
 *    rgb(255,170,0)   → rank 1 (やや高い・橙)
 *    rgb(255,40,0)    → rank 2 (高い・赤)
 *    rgb(200,0,255)   → rank 3 (極めて高い・紫)
 *    rgb(200,200,203) → skip   (対象外・灰)
 *    transparent      → skip   (no data)
 *
 * polygon 化 : ピクセル → row-run-length 矩形 merge
 *            (marching squares 不採用 - 矩形でも navigation アプリ用途では十分)
 *
 * 使い方:
 *   node scripts/fetch-liquefaction.js <pref> [--zoom=12]
 */
'use strict';

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
const pngjs = requireGlobal('pngjs');

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

const args = process.argv.slice(2);
const PREF = args[0];
const zoomArg = args.find((a) => a.startsWith('--zoom='));
const ZOOM = zoomArg ? parseInt(zoomArg.slice(7), 10) : 12;

if (!PREF || !PREFS[PREF]) {
  console.error('Usage: fetch-liquefaction.js <pref> [--zoom=12]');
  console.error('Available:', Object.keys(PREFS).join(' '));
  process.exit(1);
}

const PROJECT_ROOT = path.join(__dirname, '..');
const INPUT_DIR = path.join(PROJECT_ROOT, 'input', PREF);
const TILE_CACHE = path.join(PROJECT_ROOT, 'tmp', 'liq-tiles', String(ZOOM));
fs.mkdirSync(INPUT_DIR, { recursive: true });
fs.mkdirSync(TILE_CACHE, { recursive: true });

const TILE_URL = (z, x, y) =>
  `https://disaportal.gsi.go.jp/data/raster/08_03_ekijoka_zenkoku/${z}/${x}/${y}.png`;
const UA = { 'User-Agent': 'Daikou-app-test/0.1 (zeroact24.729@outlook.com)' };

// ─── 県 bbox (roads-{pref}.js から復元) ────────────────────────────
function loadPrefBbox() {
  const fp = path.join(PROJECT_ROOT, 'data', `roads-${PREF}.js`);
  if (!fs.existsSync(fp)) throw new Error(`roads-${PREF}.js が無い`);
  const text = fs.readFileSync(fp, 'utf8');
  const m = text.match(/"bbox":\[([^\]]+)\]/);
  if (!m) throw new Error('bbox 抽出失敗');
  const [latMin, lngMin, latMax, lngMax] = m[1].split(',').map((s) => parseInt(s, 10) / 1e5);
  return { latMin, lngMin, latMax, lngMax };
}

// ─── tile <-> lat/lng (Mercator) ───────────────────────────────────
function lng2tx(lng, z) {
  return ((lng + 180) / 360) * Math.pow(2, z);
}
function lat2ty(lat, z) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z);
}
function tx2lng(tx, z) {
  return (tx / Math.pow(2, z)) * 360 - 180;
}
function ty2lat(ty, z) {
  const n = Math.PI - (2 * Math.PI * ty) / Math.pow(2, z);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

// ─── 色 → rank ────────────────────────────────────────────────────
function classifyColor(r, g, b, a) {
  if (a < 200) return -1; // transparent / anti-aliased fade → skip
  // 主要色を寛容にマッチ (PNG anti-aliasing 吸収)
  const dist = (a, b, c, d, e, f) => Math.abs(a - d) + Math.abs(b - e) + Math.abs(c - f);
  if (dist(r, g, b, 200, 0, 255) < 30) return 3; // 紫 極めて高い
  if (dist(r, g, b, 255, 40, 0) < 30) return 2; // 赤 高い
  if (dist(r, g, b, 255, 170, 0) < 30) return 1; // 橙 やや高い
  if (dist(r, g, b, 255, 245, 0) < 30) return 0; // 黄 低い
  // 灰 (対象外) は skip
  return -1;
}

// ─── タイル DL (キャッシュあり) ─────────────────────────────────────
async function fetchTile(z, x, y) {
  const cachePath = path.join(TILE_CACHE, `${x}_${y}.png`);
  const missMark = path.join(TILE_CACHE, `${x}_${y}.miss`);
  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath);
  }
  if (fs.existsSync(missMark)) {
    return null;
  }
  const url = TILE_URL(z, x, y);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: UA });
    if (res.status === 404) {
      fs.writeFileSync(missMark, '');
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(cachePath, buf);
    return buf;
  } finally {
    clearTimeout(t);
  }
}

// ─── ピクセル分類 + row-run-length 矩形抽出 ──────────────────────
// 入力: 256x256 RGBA PNG buffer
// 出力: { ranks: [{ rank, rect: [tlPx, tlPy, brPx, brPy] }] } in タイル相対 px
function extractRectangles(pngBuffer) {
  const png = pngjs.PNG.sync.read(pngBuffer);
  const W = png.width,
    H = png.height;
  // ピクセル → rank マトリクス (-1 = skip)
  const m = new Int8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      m[y * W + x] = classifyColor(png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]);
    }
  }
  // 行ごとに run-length → 矩形列
  const rects = [];
  for (let y = 0; y < H; y++) {
    let runStart = -1,
      runRank = -1;
    for (let x = 0; x <= W; x++) {
      const r = x < W ? m[y * W + x] : -2;
      if (r !== runRank) {
        if (runRank >= 0 && runStart >= 0) {
          rects.push({ rank: runRank, x0: runStart, y0: y, x1: x, y1: y + 1 });
        }
        runStart = r >= 0 ? x : -1;
        runRank = r;
      }
    }
  }
  // 上下に拡張 merge: 同じ x 範囲で連続行 + 同じ rank → 縦に伸ばす
  // (現状 row 単位のままでも build-hazard.js は呼べるが count を抑える)
  const merged = [];
  rects.sort((a, b) => a.rank - b.rank || a.x0 - b.x0 || a.y0 - b.y0);
  // 同 (rank, x0, x1) のグループを連結 y で結合
  let i = 0;
  while (i < rects.length) {
    const cur = rects[i];
    let y1 = cur.y1;
    let j = i + 1;
    while (
      j < rects.length &&
      rects[j].rank === cur.rank &&
      rects[j].x0 === cur.x0 &&
      rects[j].x1 === cur.x1 &&
      rects[j].y0 === y1
    ) {
      y1 = rects[j].y1;
      j++;
    }
    merged.push({ rank: cur.rank, x0: cur.x0, y0: cur.y0, x1: cur.x1, y1 });
    i = j;
  }
  return merged;
}

// ─── メイン ─────────────────────────────────────────────────────────
(async () => {
  console.log(`[fetch-liquefaction] pref=${PREF} zoom=${ZOOM}`);
  const t0 = Date.now();
  const bb = loadPrefBbox();
  console.log(`  bbox: lat ${bb.latMin}-${bb.latMax} / lng ${bb.lngMin}-${bb.lngMax}`);

  // タイル範囲 (ループ用 [tx0..tx1] × [ty0..ty1])
  const tx0 = Math.floor(lng2tx(bb.lngMin, ZOOM));
  const tx1 = Math.floor(lng2tx(bb.lngMax, ZOOM));
  const ty0 = Math.floor(lat2ty(bb.latMax, ZOOM)); // 北 = y 小
  const ty1 = Math.floor(lat2ty(bb.latMin, ZOOM));
  const total = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
  console.log(`  タイル範囲: x[${tx0}..${tx1}] y[${ty0}..${ty1}]  total=${total}`);

  const features = [];
  const counts = [0, 0, 0, 0];
  let dl = 0,
    miss = 0,
    withData = 0;
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      const buf = await fetchTile(ZOOM, tx, ty);
      if (!buf) {
        miss++;
        continue;
      }
      dl++;
      const rects = extractRectangles(buf);
      if (rects.length === 0) continue;
      withData++;
      // 各矩形を lat/lng polygon に変換
      const W = 256,
        H = 256;
      for (const rec of rects) {
        // タイル相対 px → 世界 px → lng/lat
        const wx0 = tx * W + rec.x0;
        const wx1 = tx * W + rec.x1;
        const wy0 = ty * H + rec.y0;
        const wy1 = ty * H + rec.y1;
        // タイル全体の世界 px 数
        const worldPx = W * Math.pow(2, ZOOM);
        const lng0 = (wx0 / worldPx) * 360 - 180;
        const lng1 = (wx1 / worldPx) * 360 - 180;
        const lat0 = ty2lat(wy0 / H, ZOOM);
        const lat1 = ty2lat(wy1 / H, ZOOM);
        // GeoJSON Polygon (lng,lat 順 / 反時計回りでも build-hazard は無関心)
        features.push({
          type: 'Feature',
          properties: { rank: rec.rank, _src: '08_03_ekijoka_zenkoku' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [lng0, lat0],
                [lng1, lat0],
                [lng1, lat1],
                [lng0, lat1],
                [lng0, lat0],
              ],
            ],
          },
        });
        counts[rec.rank]++;
      }
    }
  }
  const tDL = Date.now() - t0;
  console.log(`  DL: ok=${dl}  404=${miss}  withData=${withData}  (${(tDL / 1000).toFixed(1)}s)`);
  console.log(
    `  rect counts: rank0=${counts[0]} rank1=${counts[1]} rank2=${counts[2]} rank3=${counts[3]}  total=${features.length}`
  );

  // GeoJSON 出力
  const outGj = path.join(INPUT_DIR, 'liquefaction.geojson');
  fs.writeFileSync(outGj, JSON.stringify({ type: 'FeatureCollection', features }));
  console.log(`  → ${outGj} (${(fs.statSync(outGj).size / 1024).toFixed(1)} KB)`);

  if (features.length === 0) {
    // 空ファイル: build-hazard を呼ぶと count=0 で出力される
    console.log('  (features=0 → 空 hazard ファイル出力)');
  }

  // ─ build-hazard.js 呼出 ─
  // build-hazard.js は liquefaction 型で properties.rank を直接読み, 属性 {r: rank} を保存する.
  console.log('  build-hazard.js liquefaction 呼出');
  execSync(`node "${path.join(__dirname, 'build-hazard.js')}" liquefaction "${outGj}" ${PREF}`, {
    stdio: 'inherit',
  });

  console.log(`✅ ${PREF} 完了 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
})().catch((e) => {
  console.error('FATAL:', e.stack || e);
  process.exit(1);
});
