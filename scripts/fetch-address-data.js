#!/usr/bin/env node
/**
 * fetch-address-data.js
 *
 * 47都道府県別に住所関連データをダウンロードして
 *   input/{pref}/admin.geojson      (中精度・行政区域ポリゴン)
 *   input/{pref}/streets.csv        (詳細・街区レベル位置参照情報)
 * を出力する。
 *
 * 出典:
 *   中精度: 国土数値情報 N03 (行政区域・国交省)
 *           https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-v2_4.html
 *   詳細  : 街区レベル位置参照情報 (国交省)
 *           https://nlftp.mlit.go.jp/isj/
 *
 * 使い方:
 *   node scripts/fetch-address-data.js <pref>            # 両方
 *   node scripts/fetch-address-data.js <pref> --coarse   # 中精度のみ
 *   node scripts/fetch-address-data.js <pref> --fine     # 詳細のみ
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function requireGlobal(name) {
  try { return require(name); } catch {}
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(root, name));
}

// ─── 47都道府県 + KSJ コード ───────────────────────────────────────
const PREFS = {
  hokkaido:  '01',
  aomori:    '02', iwate:     '03', miyagi:    '04', akita:    '05', yamagata: '06', fukushima: '07',
  ibaraki:   '08', tochigi:   '09', gunma:     '10',
  saitama:   '11', chiba:     '12', tokyo:     '13', kanagawa:  '14',
  niigata:   '15', toyama:    '16', ishikawa:  '17', fukui:     '18',
  yamanashi: '19', nagano:    '20', gifu:      '21', shizuoka:  '22', aichi:    '23',
  mie:       '24', shiga:     '25', kyoto:     '26', osaka:     '27',
  hyogo:     '28', nara:      '29', wakayama:  '30',
  tottori:   '31', shimane:   '32', okayama:   '33', hiroshima: '34', yamaguchi:'35',
  tokushima: '36', kagawa:    '37', ehime:     '38', kochi:     '39',
  fukuoka:   '40', saga:      '41', nagasaki:  '42', kumamoto:  '43',
  oita:      '44', miyazaki:  '45', kagoshima: '46', okinawa:   '47',
};

const PROJECT_ROOT = path.join(__dirname, '..');
const UA = { 'User-Agent': 'Daikou-app-test/0.1 (zeroact24.729@outlook.com)' };

const args = process.argv.slice(2);
const PREF = args[0];
const ONLY_COARSE = args.includes('--coarse');
const ONLY_FINE = args.includes('--fine');
const DO_COARSE = ONLY_COARSE || (!ONLY_COARSE && !ONLY_FINE);
const DO_FINE = ONLY_FINE || (!ONLY_COARSE && !ONLY_FINE);

if (!PREF || !PREFS[PREF]) {
  console.error('Usage: fetch-address-data.js <pref> [--coarse|--fine]');
  console.error('Available:', Object.keys(PREFS).join(' '));
  process.exit(1);
}
const PCODE = PREFS[PREF];
const OUT_DIR = path.join(PROJECT_ROOT, 'input', PREF);
const RAW_DIR = path.join(OUT_DIR, 'raw');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(RAW_DIR, { recursive: true });

console.log(`[fetch-address-data] pref=${PREF} code=${PCODE}`);

// ─── HTTP / unzip helpers ──────────────────────────────────────────
async function fetchBuffer(url, timeoutMs = 240000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally { clearTimeout(t); }
}

function unzipTo(zipPath, dir) {
  fs.mkdirSync(dir, { recursive: true });
  try {
    execSync(`unzip -o "${zipPath}" -d "${dir}"`, { stdio: 'pipe' });
  } catch (err) {
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
    console.log(`  cache: ${fname} (${(fs.statSync(zipPath).size/1024/1024).toFixed(1)} MB)`);
    return zipPath;
  }
  console.log(`  DL: ${url}`);
  const buf = await fetchBuffer(url);
  fs.writeFileSync(zipPath, buf);
  console.log(`  saved ${fname} (${(buf.length/1024/1024).toFixed(1)} MB)`);
  return zipPath;
}

// ─── 中精度: N03 行政区域 ─────────────────────────────────────────
// ZIP 内に GeoJSON 同梱. 属性 N03_001=都道府県名 / N03_002=支庁・振興局
//   N03_003=郡・政令市 / N03_004=市区町村名 / N03_007=行政区域コード
// 出力: input/{pref}/admin.geojson (ポリゴン保持)
async function fetchN03() {
  // 最新年度 (2024年→2025年版に切替) を試行 → 旧年度フォールバック
  const candidates = [
    { date: '20250101', dir: 'N03-2025' },
    { date: '20240101', dir: 'N03-2024' },
    { date: '20230101', dir: 'N03-2023' },
    { date: '20220101', dir: 'N03-2022' },
  ];
  let zipPath = null, usedDate = null;
  for (const c of candidates) {
    const url = `https://nlftp.mlit.go.jp/ksj/gml/data/N03/${c.dir}/N03-${c.date}_${PCODE}_GML.zip`;
    const fname = `N03-${c.date}_${PCODE}_GML.zip`;
    try {
      zipPath = await downloadZipIfNeeded(url, fname);
      usedDate = c.date;
      break;
    } catch (err) {
      console.log(`  N03 ${c.date} 失敗: ${err.message}`);
    }
  }
  if (!zipPath) throw new Error('N03 各年度とも 404');
  console.log(`  N03 採用: ${usedDate}`);
  const extractDir = path.join(RAW_DIR, `N03-${usedDate}_${PCODE}_GML`);
  unzipTo(zipPath, extractDir);
  const geojsons = findFiles(extractDir, /^N03-.+\.geojson$/i);
  if (geojsons.length === 0) throw new Error('N03 GEOJSON 見つからず');
  console.log(`  N03: ${geojsons.length} GEOJSON 発見`);

  const features = [];
  for (const gp of geojsons) {
    const text = fs.readFileSync(gp, 'utf8');
    let json;
    try { json = JSON.parse(text); } catch { continue; }
    for (const f of (json.features || [])) {
      if (!f.geometry) continue;
      const props = f.properties || {};
      features.push({
        type: 'Feature',
        properties: {
          pref:    props.N03_001 || '',           // 都道府県名
          subpref: props.N03_002 || '',           // 支庁・振興局
          county:  props.N03_003 || '',           // 郡・政令市
          city:    props.N03_004 || '',           // 市区町村名
          code:    props.N03_007 || '',           // 行政区域コード (5桁)
        },
        geometry: f.geometry,
      });
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'admin.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features }));
  console.log(`  N03 → admin.geojson: ${features.length} feats`);
  return features.length;
}

// ─── 詳細: 街区レベル位置参照情報 (CSV・SJIS) ──────────────────────
// ZIP 内に NN_YYYY.csv (Shift-JIS). 列:
//   都道府県名, 市区町村名, 大字・町丁目名, 小字・通称名,
//   街区符号・地番, 座標系番号, X座標, Y座標, 緯度, 経度,
//   住居表示フラグ, 代表フラグ, 更新前履歴フラグ, 更新後履歴フラグ
// 出力: input/{pref}/streets.csv (UTF-8 に変換) + サマリ
async function fetchISJ() {
  // 最新版 → 旧版フォールバック
  const versions = ['23.0a', '22.0a', '20.0a', '19.0a'];
  let zipPath = null, usedVer = null;
  for (const v of versions) {
    const url = `https://nlftp.mlit.go.jp/isj/dls/data/${v}/${PCODE}000-${v}.zip`;
    const fname = `isj-${PCODE}000-${v}.zip`;
    try {
      zipPath = await downloadZipIfNeeded(url, fname);
      usedVer = v;
      break;
    } catch (err) {
      console.log(`  ISJ ${v} 失敗: ${err.message}`);
    }
  }
  if (!zipPath) throw new Error('ISJ 各版とも 404');
  console.log(`  ISJ 採用: ${usedVer}`);
  const extractDir = path.join(RAW_DIR, `isj-${PCODE}000-${usedVer}`);
  unzipTo(zipPath, extractDir);
  const csvs = findFiles(extractDir, /\.csv$/i);
  if (csvs.length === 0) throw new Error('ISJ CSV 見つからず');

  // 全 CSV を SJIS → UTF-8 で結合 (1 県分通常 1 ファイル)
  const iconv = requireGlobal('iconv-lite');
  const buf = fs.readFileSync(csvs[0]); // 1 県は通常 1 ファイル
  const utf8 = iconv.decode(buf, 'shift_jis');
  const outPath = path.join(OUT_DIR, 'streets.csv');
  fs.writeFileSync(outPath, utf8);
  // 行数 (- ヘッダ)
  const lines = utf8.split('\n').filter(l => l.trim()).length;
  console.log(`  ISJ → streets.csv: ${lines - 1} 街区 (${(utf8.length/1024/1024).toFixed(2)} MB UTF-8)`);
  return lines - 1;
}

// ─── main ──────────────────────────────────────────────────────────
(async () => {
  const t0 = Date.now();
  let coarseCount = 0, fineCount = 0;
  if (DO_COARSE) {
    try { coarseCount = await fetchN03(); } catch (e) { console.log(`  N03 failed: ${e.message}`); }
  }
  if (DO_FINE) {
    try { fineCount = await fetchISJ(); } catch (e) { console.log(`  ISJ failed: ${e.message}`); }
  }
  console.log(`✅ ${PREF}: coarse=${coarseCount} fine=${fineCount} (${((Date.now()-t0)/1000).toFixed(1)}s)`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
