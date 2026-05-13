#!/usr/bin/env node
/**
 * fetch-dem-tiles.js
 *
 * 都道府県 bbox から国土地理院 標高タイル PNG を一括ダウンロード。
 *   優先: 5mDEM (dem5a_png)  /  カバー外: 10mDEM (dem_png) でフォールバック
 *   ズーム: z=14 デフォルト (1 tile ≒ 1.2km × 1.5km, 5-10m/pixel 解像度)
 *
 * 出典: 国土地理院コンテンツ利用規約 (出典明示で商用可)
 *   https://maps.gsi.go.jp/development/demtile.html
 *
 * 保存先: tmp/tiles/dem5a_png/{z}/{x}/{y}.png
 *         tmp/tiles/dem_png  /{z}/{x}/{y}.png  (フォールバック分)
 *
 * 使い方:
 *   node scripts/fetch-dem-tiles.js <pref>
 *   node scripts/fetch-dem-tiles.js <pref> --zoom=14 --concurrency=4 --delay=250
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const TILES_DIR = path.join(PROJECT_ROOT, 'tmp', 'tiles');

// 都道府県別 bbox [south, west, north, east]
const PREF_BBOX = {
  hokkaido:  [41.35, 139.70, 45.55, 145.85],
  aomori:    [40.20, 139.40, 41.55, 141.70],
  iwate:     [38.75, 140.65, 40.45, 142.15],
  miyagi:    [37.75, 140.30, 39.00, 141.70],
  akita:     [38.85, 139.65, 40.55, 141.05],
  yamagata:  [37.70, 139.50, 39.10, 140.65],
  fukushima: [36.75, 139.15, 38.00, 141.05],
  ibaraki:   [35.70, 139.65, 36.95, 140.85],
  tochigi:   [36.20, 139.30, 37.20, 140.30],
  gunma:     [35.95, 138.40, 37.10, 139.70],
  saitama:   [35.75, 138.70, 36.30, 139.95],
  chiba:     [34.90, 139.70, 36.10, 140.90],
  tokyo:     [24.20, 136.05, 35.90, 142.30], // 小笠原・南鳥島含む
  kanagawa:  [35.10, 138.90, 35.70, 139.80],
  niigata:   [36.75, 137.60, 38.60, 139.90],
  toyama:    [36.25, 136.80, 36.95, 137.75],
  ishikawa:  [36.05, 136.20, 37.55, 137.40],
  fukui:     [35.30, 135.45, 36.30, 136.85],
  yamanashi: [35.15, 138.20, 35.95, 139.15],
  nagano:    [35.20, 137.30, 37.05, 138.75],
  gifu:      [35.15, 136.25, 36.50, 137.65],
  shizuoka:  [34.55, 137.45, 35.65, 139.20],
  aichi:     [34.55, 136.65, 35.45, 137.85],
  mie:       [33.70, 135.85, 35.30, 136.95],
  shiga:     [34.75, 135.75, 35.70, 136.45],
  kyoto:     [34.70, 134.85, 35.80, 136.05],
  osaka:     [34.25, 135.10, 35.05, 135.75],
  hyogo:     [34.15, 134.20, 35.70, 135.45],
  nara:      [33.85, 135.65, 34.80, 136.20],
  wakayama:  [33.40, 135.00, 34.40, 136.05],
  tottori:   [35.05, 133.10, 35.65, 134.50],
  shimane:   [34.30, 131.60, 36.40, 133.40],
  okayama:   [34.30, 133.20, 35.40, 134.45],
  hiroshima: [34.00, 132.00, 35.10, 133.50],
  yamaguchi: [33.70, 130.75, 34.80, 132.45],
  tokushima: [33.50, 133.65, 34.30, 134.75],
  kagawa:    [34.05, 133.45, 34.55, 134.45],
  ehime:     [32.85, 132.00, 34.50, 133.75],
  kochi:     [32.70, 132.45, 33.95, 134.35],
  fukuoka:   [33.10, 130.05, 34.00, 131.20],
  saga:      [32.90, 129.70, 33.70, 130.55],
  nagasaki:  [32.55, 128.55, 34.75, 130.45],
  kumamoto:  [32.05, 129.95, 33.25, 131.30],
  oita:      [32.70, 130.80, 33.75, 132.10],
  miyazaki:  [31.30, 130.70, 32.85, 131.90],
  kagoshima: [27.00, 128.40, 32.20, 131.20],
  okinawa:   [24.00, 122.80, 27.90, 131.40],
};

// ─── XYZ tile math (web mercator) ─────────────────────────────────
function lat2tileY(lat, z) {
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
}
function lng2tileX(lng, z) {
  return Math.floor((lng + 180) / 360 * Math.pow(2, z));
}

function bboxToTileRange(bbox, z) {
  const [s, w, n, e] = bbox;
  const x1 = lng2tileX(w, z);
  const x2 = lng2tileX(e, z);
  const y1 = lat2tileY(n, z); // north → smaller y
  const y2 = lat2tileY(s, z);
  return { xMin: Math.min(x1, x2), xMax: Math.max(x1, x2), yMin: Math.min(y1, y2), yMax: Math.max(y1, y2) };
}

// ─── HTTP fetch with cache ────────────────────────────────────────
async function fetchTile(url, dest, ua) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': ua } });
    if (res.status === 404) return { ok: false, status: 404 };
    if (!res.ok) return { ok: false, status: res.status };
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    return { ok: true, status: 200, bytes: buf.length };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  } finally { clearTimeout(t); }
}

async function downloadAll(jobs, opts) {
  const concurrency = opts.concurrency || 4;
  const delayMs = opts.delay || 250;
  const ua = 'Daikou-app-test/0.1 (+https://github.com/exally-zeroact/Daikou-app-test)';
  const stats = { ok: 0, cached: 0, fail404: 0, failOther: 0, fallbackOk: 0, totalBytes: 0 };
  let cursor = 0;
  let lastReport = Date.now();

  async function worker(id) {
    while (cursor < jobs.length) {
      const i = cursor++;
      const job = jobs[i];
      // 5mDEM 試行
      let r = { ok: false };
      if (fs.existsSync(job.dest5)) {
        stats.cached++;
      } else {
        r = await fetchTile(job.url5, job.dest5, ua);
        if (r.ok) { stats.ok++; stats.totalBytes += r.bytes; }
        else if (r.status === 404) {
          // 10mDEM フォールバック
          if (fs.existsSync(job.dest10)) {
            stats.cached++;
            stats.fallbackOk++;
          } else {
            const r2 = await fetchTile(job.url10, job.dest10, ua);
            if (r2.ok) { stats.fallbackOk++; stats.totalBytes += r2.bytes; }
            else if (r2.status === 404) stats.fail404++;
            else stats.failOther++;
            await sleep(delayMs);
          }
        } else {
          stats.failOther++;
        }
        await sleep(delayMs);
      }
      // 進捗 5 秒ごと
      if (Date.now() - lastReport > 5000) {
        lastReport = Date.now();
        const total = stats.ok + stats.cached + stats.fallbackOk + stats.fail404 + stats.failOther;
        console.log(`  [${total}/${jobs.length}] ok=${stats.ok} cached=${stats.cached} fallback=${stats.fallbackOk} 404=${stats.fail404} err=${stats.failOther}`);
      }
    }
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
  return stats;
}

// ─── main ──────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: fetch-dem-tiles.js <pref> [--zoom=14] [--concurrency=4] [--delay=250]');
    process.exit(1);
  }
  const pref = args[0];
  const zoom = parseInt((args.find(a => a.startsWith('--zoom=')) || '--zoom=14').slice(7), 10);
  const concurrency = parseInt((args.find(a => a.startsWith('--concurrency=')) || '--concurrency=4').slice(14), 10);
  const delay = parseInt((args.find(a => a.startsWith('--delay=')) || '--delay=250').slice(8), 10);

  const bbox = PREF_BBOX[pref];
  if (!bbox) { console.error(`未定義 prefecture: ${pref}`); process.exit(1); }

  const range = bboxToTileRange(bbox, zoom);
  const numTiles = (range.xMax - range.xMin + 1) * (range.yMax - range.yMin + 1);
  console.log(`▼ ${pref} z=${zoom}`);
  console.log(`  bbox: [${bbox.join(', ')}]`);
  console.log(`  tile range: x=${range.xMin}..${range.xMax} y=${range.yMin}..${range.yMax}`);
  console.log(`  total tiles: ${numTiles}`);
  console.log(`  concurrency=${concurrency} delay=${delay}ms`);

  const dem5Base = 'https://cyberjapandata.gsi.go.jp/xyz/dem5a_png';
  const dem10Base = 'https://cyberjapandata.gsi.go.jp/xyz/dem_png';
  const jobs = [];
  for (let y = range.yMin; y <= range.yMax; y++) {
    for (let x = range.xMin; x <= range.xMax; x++) {
      jobs.push({
        url5: `${dem5Base}/${zoom}/${x}/${y}.png`,
        dest5: path.join(TILES_DIR, 'dem5a_png', String(zoom), String(x), `${y}.png`),
        url10: `${dem10Base}/${zoom}/${x}/${y}.png`,
        dest10: path.join(TILES_DIR, 'dem_png', String(zoom), String(x), `${y}.png`),
      });
    }
  }

  const t0 = Date.now();
  const stats = await downloadAll(jobs, { concurrency, delay });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n  完了 ${elapsed}s`);
  console.log(`  ok(5m)=${stats.ok}  cached=${stats.cached}  fallback(10m)=${stats.fallbackOk}  404=${stats.fail404}  err=${stats.failOther}`);
  console.log(`  total bytes: ${(stats.totalBytes / 1024 / 1024).toFixed(2)} MB`);
}

if (require.main === module) {
  main().catch(e => { console.error('FATAL:', e); process.exit(1); });
}

module.exports = { lat2tileY, lng2tileX, bboxToTileRange, PREF_BBOX };
