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
 *   node scripts/fetch-address-data.js <pref>            # 両方 (= 既存挙動・--rsdt/--chiban は含めない)
 *   node scripts/fetch-address-data.js <pref> --coarse   # 中精度のみ
 *   node scripts/fetch-address-data.js <pref> --fine     # 詳細のみ
 *   node scripts/fetch-address-data.js <pref> --rsdt     # 号 (ABR 住居マスター) のみ
 *   node scripts/fetch-address-data.js <pref> --chiban   # 地番 (ABR 地番マスター・市区町村別) のみ
 *
 * 号 (--rsdt) の出典 (= 住所 STEP2 commit2 で追加):
 *   デジタル庁 アドレス・ベース・レジストリ (ABR)
 *   https://data.address-br.digital.go.jp/  (CC-BY 4.0)
 *     mt_rsdtdsp_rsdt/pref/mt_rsdtdsp_rsdt_pref{NN}.csv.zip      (本体属性)
 *     mt_rsdtdsp_rsdt_pos/pref/mt_rsdtdsp_rsdt_pos_pref{NN}.csv.zip (座標)
 *   出力: input/_abr/mt_rsdtdsp_rsdt_pref{NN}.csv + ..._pos_pref{NN}.csv
 *
 * 地番 (--chiban) の出典 (= 住所 STEP2 commit3 で追加):
 *   デジタル庁 アドレス・ベース・レジストリ (ABR) ・地番マスター + 地番マスター位置参照拡張 (CC-BY 4.0)
 *     mt_parcel/city/mt_parcel_city{LG6}.csv.zip          (本体・属性 + 主地番/枝番)
 *     mt_parcel_pos/city/mt_parcel_pos_city{LG6}.csv.zip  (座標・3キー JOIN 用)
 *   市区町村別 zip (= 県別ではない)・LG コードは DCAT カタログから・県内全自治体抽出
 *   ★ 既知バグ: pos CSV の rep_lon/rep_lat 列・値が swap (build 側で・auto-detect 修正)
 *   出力: input/_abr/mt_parcel_city{LG6}.csv + ..._pos_city{LG6}.csv (= 県内全自治体分)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function requireGlobal(name) {
  try {
    return require(name);
  } catch (_e) {
    // not in local node_modules → fallback to global path below
  }
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(root, name));
}

// ─── 47都道府県 + KSJ コード ───────────────────────────────────────
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

const args = process.argv.slice(2);
const PREF = args[0];
const ONLY_COARSE = args.includes('--coarse');
const ONLY_FINE = args.includes('--fine');
const ONLY_RSDT = args.includes('--rsdt');
const ONLY_CHIBAN = args.includes('--chiban');
// 既存挙動保持: flag 無し = coarse + fine (= 旧 default)。--rsdt / --chiban は・明示時のみ実行
//   (= 新規 大容量 DL を・暗黙誘発しない)
const DEFAULT_BOTH = !ONLY_COARSE && !ONLY_FINE && !ONLY_RSDT && !ONLY_CHIBAN;
const DO_COARSE = ONLY_COARSE || DEFAULT_BOTH;
const DO_FINE = ONLY_FINE || DEFAULT_BOTH;
const DO_RSDT = ONLY_RSDT;
const DO_CHIBAN = ONLY_CHIBAN;

if (!PREF || !PREFS[PREF]) {
  console.error('Usage: fetch-address-data.js <pref> [--coarse|--fine|--rsdt|--chiban]');
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
  } finally {
    clearTimeout(t);
  }
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
    console.log(`  cache: ${fname} (${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB)`);
    return zipPath;
  }
  console.log(`  DL: ${url}`);
  const buf = await fetchBuffer(url);
  fs.writeFileSync(zipPath, buf);
  console.log(`  saved ${fname} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
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
  let zipPath = null,
    usedDate = null;
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
    try {
      json = JSON.parse(text);
    } catch {
      continue;
    }
    for (const f of json.features || []) {
      if (!f.geometry) continue;
      const props = f.properties || {};
      features.push({
        type: 'Feature',
        properties: {
          pref: props.N03_001 || '', // 都道府県名
          subpref: props.N03_002 || '', // 支庁・振興局
          county: props.N03_003 || '', // 郡・政令市
          city: props.N03_004 || '', // 市区町村名
          code: props.N03_007 || '', // 行政区域コード (5桁)
        },
        geometry: f.geometry,
      });
    }
  }
  fs.writeFileSync(
    path.join(OUT_DIR, 'admin.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features })
  );
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
  let zipPath = null,
    usedVer = null;
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
  const lines = utf8.split('\n').filter((l) => l.trim()).length;
  console.log(
    `  ISJ → streets.csv: ${lines - 1} 街区 (${(utf8.length / 1024 / 1024).toFixed(2)} MB UTF-8)`
  );
  return lines - 1;
}

// ─── 号 (--rsdt): ABR 住居マスター (CSV・ZIP・UTF-8 / CC-BY 4.0) ─────
// 配布: デジタル庁 アドレス・ベース・レジストリ
//   https://data.address-br.digital.go.jp/
//     mt_rsdtdsp_rsdt/pref/mt_rsdtdsp_rsdt_pref{NN}.csv.zip      (本体属性)
//     mt_rsdtdsp_rsdt_pos/pref/mt_rsdtdsp_rsdt_pos_pref{NN}.csv.zip (座標)
// 都道府県別 zip・各 1 CSV 同梱。{NN}=都道府県 JIS コード (01-47)。
// 5 キー (lg_code + town_id + blk_id + addr_id + addr2_id) で・本体 × 座標 を JOIN。
// 出力:
//   input/_abr/mt_rsdtdsp_rsdt_pref{NN}.csv      (本体)
//   input/_abr/mt_rsdtdsp_rsdt_pos_pref{NN}.csv  (座標)
async function fetchAbrRsdt() {
  const ABR_DIR = path.join(PROJECT_ROOT, 'input', '_abr');
  const ABR_RAW = path.join(ABR_DIR, 'raw');
  fs.mkdirSync(ABR_DIR, { recursive: true });
  fs.mkdirSync(ABR_RAW, { recursive: true });

  const BASE = 'https://data.address-br.digital.go.jp';
  const targets = [
    {
      kind: 'body',
      url: `${BASE}/mt_rsdtdsp_rsdt/pref/mt_rsdtdsp_rsdt_pref${PCODE}.csv.zip`,
      zipName: `mt_rsdtdsp_rsdt_pref${PCODE}.csv.zip`,
      outName: `mt_rsdtdsp_rsdt_pref${PCODE}.csv`,
    },
    {
      kind: 'pos',
      url: `${BASE}/mt_rsdtdsp_rsdt_pos/pref/mt_rsdtdsp_rsdt_pos_pref${PCODE}.csv.zip`,
      zipName: `mt_rsdtdsp_rsdt_pos_pref${PCODE}.csv.zip`,
      outName: `mt_rsdtdsp_rsdt_pos_pref${PCODE}.csv`,
    },
  ];

  let bodyLines = 0,
    posLines = 0;
  for (const t of targets) {
    const zipPath = path.join(ABR_RAW, t.zipName);
    if (fs.existsSync(zipPath) && fs.statSync(zipPath).size > 1024) {
      console.log(
        `  cache: ${t.zipName} (${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(2)} MB)`
      );
    } else {
      console.log(`  DL: ${t.url}`);
      const buf = await fetchBuffer(t.url);
      fs.writeFileSync(zipPath, buf);
      console.log(`  saved ${t.zipName} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
    }
    const extractDir = path.join(ABR_RAW, t.zipName.replace(/\.zip$/, ''));
    unzipTo(zipPath, extractDir);
    const csvs = findFiles(extractDir, /\.csv$/i);
    if (csvs.length === 0) throw new Error(`ABR ${t.kind}: CSV 見つからず`);
    // zip 内 1 CSV 同梱前提・複数あれば最大サイズ採用
    csvs.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
    const outPath = path.join(ABR_DIR, t.outName);
    fs.copyFileSync(csvs[0], outPath);
    // 行数カウント (UTF-8・BOM あっても問題なし)
    const text = fs.readFileSync(outPath, 'utf8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim()).length - 1;
    if (t.kind === 'body') bodyLines = lines;
    else posLines = lines;
    console.log(
      `  ABR ${t.kind} → ${t.outName}: ${lines} 行 (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB)`
    );
  }
  return { bodyLines, posLines };
}

// ─── 地番 (--chiban): ABR 地番マスター + 位置参照拡張 (CSV・ZIP・UTF-8 / CC-BY 4.0) ─
// 配布: デジタル庁 アドレス・ベース・レジストリ
//   https://data.address-br.digital.go.jp/
//     mt_parcel/city/mt_parcel_city{LG6}.csv.zip          (本体・主地番/枝番/大字属性)
//     mt_parcel_pos/city/mt_parcel_pos_city{LG6}.csv.zip  (座標)
// ★市区町村別 zip (= 県別では・ない)・LG コード = 6 桁 (= JIS X 0402 拡張)。
// LG コードは DCAT-US 1.1 カタログ (= ABR 公式 catalog) から・県内全自治体抽出する:
//   https://dataset.address-br.digital.go.jp/api/feed/dcat-us/1.1.json
// 3 キー (lg_code + machiaza_id + prc_id) で・本体 × 座標 を JOIN (= build-address.js 側)。
// ★ 既知バグ: pos CSV の・rep_lon と rep_lat 列の・値が swap (= header label と・data 逆順)
//   → build 側で・数値範囲 auto-detect (= Japan domain: lat 20-46 / lon 122-154) で・修正
// 出力 (= 県内全自治体分・LG ごとに 1 ペア):
//   input/_abr/mt_parcel_city{LG6}.csv         (本体)
//   input/_abr/mt_parcel_pos_city{LG6}.csv     (座標)

const DCAT_URL = 'https://dataset.address-br.digital.go.jp/api/feed/dcat-us/1.1.json';
const PREF_JP_NAME = {
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

// DCAT カタログを 1 日 cache で取得 (= 13 MB あるため・大容量)
async function loadDcatCatalog(rawDir) {
  const cachePath = path.join(rawDir, 'dcat-us-1.1.json');
  const ONE_DAY_MS = 86400000;
  if (
    fs.existsSync(cachePath) &&
    Date.now() - fs.statSync(cachePath).mtimeMs < ONE_DAY_MS &&
    fs.statSync(cachePath).size > 1024
  ) {
    console.log(
      `  cache: dcat-us-1.1.json (${(fs.statSync(cachePath).size / 1024 / 1024).toFixed(2)} MB)`
    );
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  }
  console.log(`  DL: ${DCAT_URL}`);
  const buf = await fetchBuffer(DCAT_URL);
  fs.writeFileSync(cachePath, buf);
  console.log(`  saved dcat-us-1.1.json (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
  return JSON.parse(buf.toString('utf8'));
}

// 県内 全自治体 LG コード + body/pos URL の・抽出
function extractChibanTargetsFromDcat(dcat, prefJp) {
  const byLg = new Map();
  for (const d of dcat.dataset || []) {
    if (!d.title || !d.title.startsWith(prefJp)) continue;
    if (!/地番マスター/.test(d.title)) continue;
    const isPos = /位置参照拡張/.test(d.title);
    for (const dist of d.distribution || []) {
      const url = dist.accessURL || dist.downloadURL || '';
      const m = url.match(/mt_parcel(?:_pos)?\/city\/mt_parcel(?:_pos)?_city(\d{6})\.csv\.zip$/);
      if (!m) continue;
      const lg = m[1];
      if (!byLg.has(lg)) {
        const name = d.title
          .replace(prefJp, '')
          .replace(/地番マスター位置参照拡張$/, '')
          .replace(/地番マスター$/, '')
          .trim();
        byLg.set(lg, { lg, name, bodyUrl: null, posUrl: null });
      }
      const e = byLg.get(lg);
      if (isPos) e.posUrl = url;
      else e.bodyUrl = url;
    }
  }
  return Array.from(byLg.values()).sort((a, b) => a.lg.localeCompare(b.lg));
}

async function fetchAbrChiban() {
  const ABR_DIR = path.join(PROJECT_ROOT, 'input', '_abr');
  const ABR_RAW = path.join(ABR_DIR, 'raw');
  fs.mkdirSync(ABR_DIR, { recursive: true });
  fs.mkdirSync(ABR_RAW, { recursive: true });

  const prefJp = PREF_JP_NAME[PREF];
  if (!prefJp) throw new Error(`PREF_JP_NAME に・${PREF} の・日本語名 が・未登録`);
  const dcat = await loadDcatCatalog(ABR_RAW);
  const targets = extractChibanTargetsFromDcat(dcat, prefJp);
  console.log(`  ${PREF} (${prefJp}): DCAT から ${targets.length} 自治体 検出`);
  if (targets.length === 0) {
    throw new Error(`${prefJp} の・地番マスター dataset が・DCAT に・無い`);
  }

  let ok = 0,
    missing = 0,
    totalBodyMB = 0,
    totalPosMB = 0,
    failed = 0;
  const lgDetails = [];
  for (const t of targets) {
    if (!t.bodyUrl || !t.posUrl) {
      missing++;
      console.log(
        `  skip ${t.lg} (${t.name}): body=${t.bodyUrl ? 'OK' : 'MISSING'} pos=${t.posUrl ? 'OK' : 'MISSING'}`
      );
      continue;
    }
    let lgOk = true;
    let lgBodyMB = 0,
      lgPosMB = 0;
    for (const kind of ['body', 'pos']) {
      const url = kind === 'body' ? t.bodyUrl : t.posUrl;
      const zipName = path.basename(url);
      const outName = zipName.replace(/\.zip$/, '');
      const zipPath = path.join(ABR_RAW, zipName);
      const outPath = path.join(ABR_DIR, outName);
      try {
        // CSV が・既にある なら・skip (= rebuild without re-DL)
        if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1024) {
          // zip が・無ければ DL
          if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size < 100) {
            const buf = await fetchBuffer(url);
            fs.writeFileSync(zipPath, buf);
          }
          // unzip
          const extractDir = path.join(ABR_RAW, zipName.replace(/\.zip$/, ''));
          unzipTo(zipPath, extractDir);
          const csvs = findFiles(extractDir, /\.csv$/i);
          if (csvs.length === 0) {
            console.log(`  fail ${t.lg} ${kind}: unzip に・CSV 無し`);
            lgOk = false;
            continue;
          }
          csvs.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
          fs.copyFileSync(csvs[0], outPath);
        }
        const sz = fs.statSync(outPath).size;
        if (kind === 'body') lgBodyMB = sz / 1048576;
        else lgPosMB = sz / 1048576;
      } catch (err) {
        console.log(`  fail ${t.lg} ${kind}: ${err.message}`);
        lgOk = false;
      }
    }
    if (lgOk) {
      ok++;
      totalBodyMB += lgBodyMB;
      totalPosMB += lgPosMB;
      lgDetails.push({ lg: t.lg, name: t.name, bodyMB: lgBodyMB, posMB: lgPosMB });
      console.log(
        `  ✓ ${t.lg} ${t.name}: body=${lgBodyMB.toFixed(2)}MB pos=${lgPosMB.toFixed(2)}MB`
      );
    } else {
      failed++;
    }
  }
  console.log(
    `  ${PREF}: ${ok}/${targets.length} 自治体 OK / body合計 ${totalBodyMB.toFixed(1)}MB / pos合計 ${totalPosMB.toFixed(1)}MB` +
      (missing ? ` (skip ${missing}: URL片方欠落)` : '') +
      (failed ? ` (fail ${failed})` : '')
  );
  return { count: ok, missing, failed, totalBodyMB, totalPosMB, lgDetails };
}

// ─── main ──────────────────────────────────────────────────────────
(async () => {
  const t0 = Date.now();
  let coarseCount = 0,
    fineCount = 0,
    rsdtBody = 0,
    rsdtPos = 0,
    chibanCount = 0,
    chibanBodyMB = 0,
    chibanPosMB = 0;
  if (DO_COARSE) {
    try {
      coarseCount = await fetchN03();
    } catch (e) {
      console.log(`  N03 failed: ${e.message}`);
    }
  }
  if (DO_FINE) {
    try {
      fineCount = await fetchISJ();
    } catch (e) {
      console.log(`  ISJ failed: ${e.message}`);
    }
  }
  if (DO_RSDT) {
    try {
      const r = await fetchAbrRsdt();
      rsdtBody = r.bodyLines;
      rsdtPos = r.posLines;
    } catch (e) {
      console.log(`  ABR rsdt failed: ${e.message}`);
    }
  }
  if (DO_CHIBAN) {
    try {
      const r = await fetchAbrChiban();
      chibanCount = r.count;
      chibanBodyMB = r.totalBodyMB;
      chibanPosMB = r.totalPosMB;
    } catch (e) {
      console.log(`  ABR chiban failed: ${e.message}`);
    }
  }
  const parts = [];
  if (DO_COARSE) parts.push(`coarse=${coarseCount}`);
  if (DO_FINE) parts.push(`fine=${fineCount}`);
  if (DO_RSDT) parts.push(`rsdt(body=${rsdtBody},pos=${rsdtPos})`);
  if (DO_CHIBAN)
    parts.push(
      `chiban(${chibanCount}自治体・body=${chibanBodyMB.toFixed(1)}MB・pos=${chibanPosMB.toFixed(1)}MB)`
    );
  console.log(`✅ ${PREF}: ${parts.join(' ')} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
