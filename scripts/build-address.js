#!/usr/bin/env node
/**
 * build-address.js
 *
 * 住所データを 全国 1 ファイルにまとめて出力する.
 *
 * 中精度 (--coarse):
 *   各県の input/{pref}/admin.geojson の市区町村ポリゴンの
 *   重心 (代表点) を集約 → data/addresses-coarse-jp.js
 *   buildPointBundle 形式 + grid 索引付き
 *
 * 詳細 (--fine):
 *   各県の input/{pref}/streets.csv (代表フラグ=1 行のみ) を集約
 *   → data/addresses-fine-jp.js
 *   buildPointBundle 形式
 *
 * 番 (--street):  ★設計変更宣言 (2026-05-22・住所STEP2 commit1):
 *   各県の input/{pref}/streets.csv (代表フラグ=1 行のみ) を県別バンドル化
 *   → data/addresses-street-{pref}.js (= 47 県別・lazy load 対象)
 *   形式: POI v2 同等 ({v:2, prefecture, oazas:{idx:"市+大字+丁目"}, grid, points:[{c,lat,lng,k}]})
 *   絶対ルール準拠:
 *     ・住所は表示専用 (= 距離 / 課金 / Worker B / map-matcher・無関係)
 *     ・既存 --coarse / --fine モードは・1 byte も触らない (= 並列追加)
 *     ・既存 encoding-utils PRECISION / GRID_INT / gridKey を流用 (= 新エンコーダなし)
 *
 * 号 (--rsdt):  ★設計変更宣言 (2026-05-22・住所STEP2 commit2):
 *   input/_abr/mt_rsdtdsp_rsdt_pref{NN}.csv  (本体属性)
 *   input/_abr/mt_rsdtdsp_rsdt_pos_pref{NN}.csv (座標)
 *   を 5 キー (lg_code + town_id + blk_id + addr_id + addr2_id) で JOIN し
 *   rsdt_addr_flg=1 (= 住居表示実施地区) の行のみを県別バンドル化
 *   → data/addresses-rsdt-{pref}.js (= 47 県別・lazy load 対象)
 *   形式: --street と完全同形式の POI v2
 *     ({v:2, prefecture, oazas, grid, points:[{c,lat,lng,k:"街区符号",g:"号(-枝号)"}]})
 *   絶対ルール準拠:
 *     ・距離 / 課金 / Worker B / map-matcher・完全無関係 (= 表示専用・入力データ追加のみ)
 *     ・既存 --coarse / --fine / --street は・1 byte も触らない (= 並列追加)
 *     ・--street の buildStreetFromCsvText と・同方式 (大字 dict / grid / int×1e5)
 *
 * 地番 (--chiban):  ★設計変更宣言 (2026-05-22・住所STEP2 commit3):
 *   入力: 県内 全自治体分・市区町村別 ペア (= LG 6 桁) (DCAT カタログ由来)
 *     input/_abr/mt_parcel_city{LG6}.csv         (本体・属性 + 主地番/枝番)
 *     input/_abr/mt_parcel_pos_city{LG6}.csv     (座標・rep_lon/lat 値 swap 既知バグ)
 *   3 キー (lg_code + machiaza_id + prc_id) で JOIN・rep_lon/lat swap auto-detect 適用。
 *   座標欠落行 (= pos に・対応行が無い body) は skip。rsdt_addr_flg=0/1 両方含む
 *   (= 住居表示実施地区の・地番 entry も・ABR 地番マスターに・存在するため・filter しない)。
 *   県内全自治体を・1 ファイルに集約 → data/addresses-chiban-{pref}.js (= 47 県別)。
 *   形式: --rsdt と・同 POI v2 (= k=prc_num1 主地番・g=prc_num2(-prc_num3) 枝番)
 *   絶対ルール準拠:
 *     ・距離 / 課金 / Worker B / map-matcher 完全無関係 (= 表示専用・入力データ追加のみ)
 *     ・既存 --coarse / --fine / --street / --rsdt は・1 byte も触らない
 *
 * 使い方:
 *   node scripts/build-address.js --coarse
 *   node scripts/build-address.js --fine
 *   node scripts/build-address.js --street               # 47 県全 build
 *   node scripts/build-address.js --street --pref=ehime  # 1 県だけ
 *   node scripts/build-address.js --rsdt --pref=ehime    # 号・1 県だけ (= commit2 検証)
 *   node scripts/build-address.js --rsdt                 # 号・47 県全 (= 別承認後)
 *   node scripts/build-address.js --chiban --pref=ehime  # 地番・1 県だけ (= commit3 検証)
 *   node scripts/build-address.js --chiban               # 地番・47 県全 (= 別承認後)
 */

const fs = require('fs');
const path = require('path');
const u = require('./bundle-utils.js');
const enc = require('./encoding-utils.js');

const args = process.argv.slice(2);
const MODE_COARSE = args.includes('--coarse');
const MODE_FINE = args.includes('--fine');
const MODE_STREET = args.includes('--street');
const MODE_RSDT = args.includes('--rsdt');
const MODE_CHIBAN = args.includes('--chiban');
const prefArg = args.find((a) => a.startsWith('--pref='));
const ONLY_PREF = prefArg ? prefArg.slice(7) : null;

// 注: Usage チェックは main() 内で実施 (= require 時は・関数 export のみ・exit させない)

const PROJECT_ROOT = path.join(__dirname, '..');
const INPUT_ROOT = path.join(PROJECT_ROOT, 'input');
const ALL_PREFS = [
  'hokkaido',
  'aomori',
  'iwate',
  'miyagi',
  'akita',
  'yamagata',
  'fukushima',
  'ibaraki',
  'tochigi',
  'gunma',
  'saitama',
  'chiba',
  'tokyo',
  'kanagawa',
  'niigata',
  'toyama',
  'ishikawa',
  'fukui',
  'yamanashi',
  'nagano',
  'gifu',
  'shizuoka',
  'aichi',
  'mie',
  'shiga',
  'kyoto',
  'osaka',
  'hyogo',
  'nara',
  'wakayama',
  'tottori',
  'shimane',
  'okayama',
  'hiroshima',
  'yamaguchi',
  'tokushima',
  'kagawa',
  'ehime',
  'kochi',
  'fukuoka',
  'saga',
  'nagasaki',
  'kumamoto',
  'oita',
  'miyazaki',
  'kagoshima',
  'okinawa',
];
// JIS X 0401 都道府県コード (2 桁)
const PREF_CODE = {
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
const targetPrefs = ONLY_PREF ? [ONLY_PREF] : ALL_PREFS;

// ─── 任意ジオメトリから重心 [lat, lng] を計算 ────────────────────
function centroid(geometry) {
  let sumLat = 0,
    sumLng = 0,
    n = 0;
  function walk(node) {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      sumLng += node[0];
      sumLat += node[1];
      n++;
      return;
    }
    for (const v of node) walk(v);
  }
  walk(geometry.coordinates);
  if (n === 0) return null;
  return { lat: sumLat / n, lng: sumLng / n };
}

// ─── 中精度: N03 admin.geojson → 市区町村別代表点 ────────────────
function buildCoarse() {
  const items = [];
  let prefsProcessed = 0;
  for (const pref of targetPrefs) {
    const fp = path.join(INPUT_ROOT, pref, 'admin.geojson');
    if (!fs.existsSync(fp)) {
      console.log(`  skip ${pref}: admin.geojson 無し`);
      continue;
    }
    const json = JSON.parse(fs.readFileSync(fp, 'utf8'));
    // 同一 城市 (city + code) の複数ポリゴンを合算重心化
    const cityMap = new Map(); // key=code → { sumLat, sumLng, n, pref, county, city }
    for (const f of json.features || []) {
      const c = centroid(f.geometry);
      if (!c) continue;
      const p = f.properties || {};
      const code = p.code || p.pref + p.city; // フォールバック
      if (!cityMap.has(code)) {
        cityMap.set(code, {
          sumLat: 0,
          sumLng: 0,
          n: 0,
          pref: p.pref || '',
          county: p.county || '',
          city: p.city || '',
          code,
        });
      }
      const e = cityMap.get(code);
      e.sumLat += c.lat;
      e.sumLng += c.lng;
      e.n++;
    }
    for (const e of cityMap.values()) {
      if (e.n === 0) continue;
      items.push({
        lat: e.sumLat / e.n,
        lng: e.sumLng / e.n,
        n: (e.county ? e.county + ' ' : '') + e.city,
        p: e.pref,
        c: e.code,
      });
    }
    prefsProcessed++;
    console.log(`  ${pref}: ${cityMap.size} 市区町村`);
  }
  return { items, prefsProcessed };
}

// ─── 詳細: streets.csv → 大字 (町丁目) 単位 代表点 ───────────────────
// CSV 列: pref(0),city(1),oaza(2),koaza(3),blockCode(4),coordSys(5),
//         X(6),Y(7),lat(8),lng(9),jushoFlag(10),daihyouFlag(11),...
//
// 全街区のうち 代表フラグ=1 で各 (city,oaza,koaza) ごとに 1 点だけ採用。
// (街区レベルだと 17M 件で JSON 化不可・大字レベルで 約 30 万件に収まる)
function buildFine() {
  const items = [];
  let prefsProcessed = 0;
  for (const pref of targetPrefs) {
    const fp = path.join(INPUT_ROOT, pref, 'streets.csv');
    if (!fs.existsSync(fp)) {
      console.log(`  skip ${pref}: streets.csv 無し`);
      continue;
    }
    const pcode = PREF_CODE[pref] || '';
    const text = fs.readFileSync(fp, 'utf8');
    const lines = text.split(/\r?\n/);
    const seen = new Set();
    let count = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      // 簡易 CSV パース (引用符付きフィールド対応)
      const cols = [];
      let cur = '',
        inQ = false;
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        if (ch === '"') {
          inQ = !inQ;
          continue;
        }
        if (ch === ',' && !inQ) {
          cols.push(cur);
          cur = '';
          continue;
        }
        cur += ch;
      }
      cols.push(cur);
      if (cols.length < 12) continue;
      if (cols[11] !== '1') continue; // 代表フラグ=1 のみ
      const city = cols[1] || '';
      const oaza = cols[2] || '';
      const koaza = cols[3] || '';
      const key = city + '|' + oaza + '|' + koaza;
      if (seen.has(key)) continue;
      seen.add(key);
      const lat = parseFloat(cols[8]);
      const lng = parseFloat(cols[9]);
      if (isNaN(lat) || isNaN(lng)) continue;
      items.push({
        lat,
        lng,
        n: oaza + (koaza || ''),
        c: city,
        p: pcode, // 都道府県コード (2 桁・JIS X 0401)
      });
      count++;
    }
    prefsProcessed++;
    console.log(`  ${pref}: ${count} 大字`);
  }
  return { items, prefsProcessed };
}

// ─── 番 (--street): streets.csv → 県別 街区バンドル (= 番=街区符号レベル) ───
// CSV 列: pref(0),city(1),oaza(2),koaza(3),blockCode(4),coordSys(5),
//         X(6),Y(7),lat(8),lng(9),jushoFlag(10),daihyouFlag(11),...
//
// 代表フラグ=1 の各行を・1 街区点として保存。
// 出力形式 = POI v2 同等:
//   {
//     v: 2, prefecture, generated, precision: 100000, bbox, gridSize: GRID_INT,
//     oazas: { 0: '市区町村+大字・丁目+小字', 1: ..., ... },     ← 大字 dict (= POI cats と同位置)
//     grid:  { 'gridKey': [pointIdx, ...], ... },                ← grid 索引 (= POI grid と同位置)
//     points:[ { c: oazaIdx, lat: latInt, lng: lngInt, k: '番' }, ... ]  ← POI pois と同位置
//   }
// 絶対ルール準拠: 距離 / 課金 / Worker B / map-matcher 無関係・表示専用。
function buildStreetFromCsvText(csvText, prefName) {
  const lines = csvText.split(/\r?\n/);
  const oazaToIdx = new Map();
  const oazas = {};
  let nextOazaIdx = 0;
  const points = [];
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const grid = {};
  let skippedNoFlag = 0;
  let skippedInvalid = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // CSV パース (= 既存 buildFine と同じ簡易パーサ)
    const cols = [];
    let cur = '';
    let inQ = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') {
        inQ = !inQ;
        continue;
      }
      if (ch === ',' && !inQ) {
        cols.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    cols.push(cur);
    if (cols.length < 12) {
      skippedInvalid++;
      continue;
    }
    if (cols[11] !== '1') {
      skippedNoFlag++;
      continue;
    }
    const city = cols[1] || '';
    const oaza = cols[2] || '';
    const koaza = cols[3] || '';
    const kuban = cols[4] || '';
    const lat = parseFloat(cols[8]);
    const lng = parseFloat(cols[9]);
    if (isNaN(lat) || isNaN(lng) || !city || !oaza || !kuban) {
      skippedInvalid++;
      continue;
    }
    // 大字 dict (= 市区町村+大字+丁目+小字 で・unique 化・getNearestAddress 組立時 "市付近 + 番" で十分な情報)
    const oazaKey = city + oaza + (koaza || '');
    let oazaIdx = oazaToIdx.get(oazaKey);
    if (oazaIdx === undefined) {
      oazaIdx = nextOazaIdx++;
      oazaToIdx.set(oazaKey, oazaIdx);
      oazas[oazaIdx] = oazaKey;
    }
    const latI = Math.round(lat * enc.PRECISION);
    const lngI = Math.round(lng * enc.PRECISION);
    if (latI < bbox[0]) bbox[0] = latI;
    if (lngI < bbox[1]) bbox[1] = lngI;
    if (latI > bbox[2]) bbox[2] = latI;
    if (lngI > bbox[3]) bbox[3] = lngI;
    const pointIdx = points.length;
    points.push({ c: oazaIdx, lat: latI, lng: lngI, k: kuban });
    const key = enc.gridKey(latI, lngI);
    (grid[key] ||= []).push(pointIdx);
  }
  return {
    v: 2,
    prefecture: prefName,
    generated: new Date().toISOString(),
    precision: enc.PRECISION,
    bbox: points.length ? bbox : null,
    gridSize: enc.GRID_INT,
    oazas,
    grid,
    points,
    _stats: { skippedNoFlag, skippedInvalid }, // 内部用 (= JS 出力時に削除)
  };
}

// 県別ファイルパスから・buildStreet を実行
function buildStreetForPref(prefName) {
  const fp = path.join(INPUT_ROOT, prefName, 'streets.csv');
  if (!fs.existsSync(fp)) return null;
  const text = fs.readFileSync(fp, 'utf8');
  return buildStreetFromCsvText(text, prefName);
}

// ─── 号 (--rsdt): ABR 住居マスター → 県別 号バンドル (= POI v2 同形式) ───
// 入力 CSV (UTF-8・カンマ区切り・先頭行 header):
//   本体 mt_rsdtdsp_rsdt_pref{NN}.csv :
//     lg_code, machiaza_id, blk_id, rsdt_id, rsdt2_id,  (5 キー)
//     city, ward, oaza_cho, chome, koaza, blk_num,
//     rsdt_num, rsdt_num2,                              (住居番号・枝住居番号 → g)
//     rsdt_addr_flg,                                    (1=住居表示・0=地番)
//     ...
//   座標 mt_rsdtdsp_rsdt_pos_pref{NN}.csv :
//     lg_code, machiaza_id, blk_id, rsdt_id, rsdt2_id, rep_lat, rep_lon, ...
//
// 列の存在は・header 名で動的解決 (= ABR 仕様変更耐性・旧仕様/spec 名にも・fallback 対応)。
// 5 キー JOIN で 本体 × 座標 を結合 → rsdt_addr_flg=1 のみ採用 →
// 大字 key = city(+ward) + oaza_cho + chome + koaza (= street と同 方式) で・dict 圧縮
// 点フィールド: { c:oazaIdx, lat:int×1e5, lng:int×1e5, k:blk_num, g:rsdt_num(-rsdt_num2) }

function parseAbrCsv(text) {
  // UTF-8 BOM 除去
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return { headers: [], rows: [] };
  const parseLine = (line) => {
    const cols = [];
    let cur = '';
    let inQ = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') {
        inQ = !inQ;
        continue;
      }
      if (ch === ',' && !inQ) {
        cols.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    cols.push(cur);
    return cols;
  };
  const headers = parseLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    rows.push(parseLine(lines[i]));
  }
  return { headers, rows };
}

function findCol(headers, ...candidateNames) {
  for (const n of candidateNames) {
    const i = headers.indexOf(n);
    if (i !== -1) return i;
  }
  return -1;
}

function buildRsdtFromCsv(bodyCsvText, posCsvText, prefName) {
  const body = parseAbrCsv(bodyCsvText);
  const pos = parseAbrCsv(posCsvText);

  // 5 キー (= 本体 / 座標 で・同名・並びは・任意)
  // 実 ABR 配布 (= 2025-10 時点) : lg_code, machiaza_id, blk_id, rsdt_id, rsdt2_id
  // 旧仕様 / spec 名 (= fallback): town_id / addr_id / addr2_id
  const KEY_ALIASES = [
    ['lg_code'],
    ['machiaza_id', 'town_id'],
    ['blk_id'],
    ['rsdt_id', 'addr_id'],
    ['rsdt2_id', 'addr2_id'],
  ];
  const bodyKeyIdx = KEY_ALIASES.map((aliases) => findCol(body.headers, ...aliases));
  const posKeyIdx = KEY_ALIASES.map((aliases) => findCol(pos.headers, ...aliases));
  for (let i = 0; i < KEY_ALIASES.length; i++) {
    if (bodyKeyIdx[i] === -1)
      throw new Error(`ABR body CSV: 5キー列 ${KEY_ALIASES[i].join('/')} 見つからず`);
    if (posKeyIdx[i] === -1)
      throw new Error(`ABR pos CSV: 5キー列 ${KEY_ALIASES[i].join('/')} 見つからず`);
  }
  const flgIdx = findCol(body.headers, 'rsdt_addr_flg');
  if (flgIdx === -1) throw new Error('ABR body CSV: rsdt_addr_flg 列が無い');
  const rsdtNumIdx = findCol(body.headers, 'rsdt_num');
  const rsdtNum2Idx = findCol(body.headers, 'rsdt_num2');
  // 実 ABR 列名 (= city/ward/oaza_cho/chome/koaza) を・第一候補。旧 spec 名は・fallback
  const cityIdx = findCol(body.headers, 'city', 'city_name');
  const wardIdx = findCol(body.headers, 'ward'); // 政令市 区名 (= 任意・ehime は・空)
  const oazaIdx = findCol(body.headers, 'oaza_cho', 'oaza_cho_name', 'oaza_name');
  const chomeIdx = findCol(body.headers, 'chome', 'chome_name');
  const koazaIdx = findCol(body.headers, 'koaza', 'koaza_name');
  const blkNumIdx = findCol(body.headers, 'blk_num');
  const latIdx = findCol(pos.headers, 'rep_lat', 'rep_pnt_lat');
  const lngIdx = findCol(pos.headers, 'rep_lon', 'rep_lng', 'rep_pnt_lng', 'rep_pnt_lon');
  if (latIdx === -1) throw new Error('ABR pos CSV: 緯度列 (rep_lat 等) 見つからず');
  if (lngIdx === -1) throw new Error('ABR pos CSV: 経度列 (rep_lon 等) 見つからず');

  // 座標 を 5 キーで Map 化
  const posMap = new Map();
  for (const r of pos.rows) {
    const k = posKeyIdx.map((i) => r[i] || '').join('|');
    posMap.set(k, r);
  }

  const oazaToIdx = new Map();
  const oazas = {};
  let nextOazaIdx = 0;
  const points = [];
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const grid = {};
  let skippedFlgZero = 0;
  let skippedNoPos = 0;
  let skippedInvalid = 0;

  for (const r of body.rows) {
    if (r[flgIdx] !== '1') {
      skippedFlgZero++;
      continue;
    }
    const k = bodyKeyIdx.map((i) => r[i] || '').join('|');
    const posRow = posMap.get(k);
    if (!posRow) {
      skippedNoPos++;
      continue;
    }
    const lat = parseFloat(posRow[latIdx]);
    const lng = parseFloat(posRow[lngIdx]);
    if (isNaN(lat) || isNaN(lng)) {
      skippedInvalid++;
      continue;
    }
    const city = (cityIdx !== -1 ? r[cityIdx] : '') || '';
    const ward = (wardIdx !== -1 ? r[wardIdx] : '') || '';
    const oazaCho = (oazaIdx !== -1 ? r[oazaIdx] : '') || '';
    const chome = (chomeIdx !== -1 ? r[chomeIdx] : '') || '';
    const koaza = (koazaIdx !== -1 ? r[koazaIdx] : '') || '';
    const blkNum = (blkNumIdx !== -1 ? r[blkNumIdx] : '') || '';
    const rsdtNum = (rsdtNumIdx !== -1 ? r[rsdtNumIdx] : '') || '';
    const rsdtNum2 = (rsdtNum2Idx !== -1 ? r[rsdtNum2Idx] : '') || '';
    // oazaCho が・空でも・「市区町村+番」だけは・保持 (= 中心市街地は・oazaCho 無しのケース有)。
    // 司さん必須要件: city + blkNum + rsdtNum が・揃う行のみ採用 (= 号レベル保証)。
    if (!city || !blkNum || !rsdtNum) {
      skippedInvalid++;
      continue;
    }
    // 大字 key (= street と同方式): 市 + 区 + 大字町 + 丁目 + 小字
    const oazaKey = city + (ward || '') + (oazaCho || '') + (chome || '') + (koaza || '');
    let oazaIdxVal = oazaToIdx.get(oazaKey);
    if (oazaIdxVal === undefined) {
      oazaIdxVal = nextOazaIdx++;
      oazaToIdx.set(oazaKey, oazaIdxVal);
      oazas[oazaIdxVal] = oazaKey;
    }
    const latI = Math.round(lat * enc.PRECISION);
    const lngI = Math.round(lng * enc.PRECISION);
    if (latI < bbox[0]) bbox[0] = latI;
    if (lngI < bbox[1]) bbox[1] = lngI;
    if (latI > bbox[2]) bbox[2] = latI;
    if (lngI > bbox[3]) bbox[3] = lngI;
    const g = rsdtNum2 ? rsdtNum + '-' + rsdtNum2 : rsdtNum;
    const pointIdx = points.length;
    points.push({ c: oazaIdxVal, lat: latI, lng: lngI, k: blkNum, g });
    const gk = enc.gridKey(latI, lngI);
    (grid[gk] ||= []).push(pointIdx);
  }
  return {
    v: 2,
    prefecture: prefName,
    generated: new Date().toISOString(),
    precision: enc.PRECISION,
    bbox: points.length ? bbox : null,
    gridSize: enc.GRID_INT,
    oazas,
    grid,
    points,
    _stats: {
      bodyRows: body.rows.length,
      posRows: pos.rows.length,
      skippedFlgZero,
      skippedNoPos,
      skippedInvalid,
    },
  };
}

function buildRsdtForPref(prefName) {
  const pcode = PREF_CODE[prefName];
  if (!pcode) return null;
  const bodyPath = path.join(INPUT_ROOT, '_abr', `mt_rsdtdsp_rsdt_pref${pcode}.csv`);
  const posPath = path.join(INPUT_ROOT, '_abr', `mt_rsdtdsp_rsdt_pos_pref${pcode}.csv`);
  if (!fs.existsSync(bodyPath) || !fs.existsSync(posPath)) return null;
  const bodyCsv = fs.readFileSync(bodyPath, 'utf8');
  const posCsv = fs.readFileSync(posPath, 'utf8');
  return buildRsdtFromCsv(bodyCsv, posCsv, prefName);
}

// ─── 地番 (--chiban): ABR 地番マスター + 位置参照拡張 → 県別 地番バンドル (= POI v2 同形式) ─
// 入力 CSV (UTF-8・カンマ区切り・先頭行 header):
//   本体 mt_parcel_city{LG6}.csv :
//     lg_code, machiaza_id, prc_id,                       (3 キー)
//     city, ward, oaza_cho, chome, koaza, machiaza_dist,
//     prc_num1, prc_num2, prc_num3,                       (主地番・枝番1・枝番2 → k / g)
//     rsdt_addr_flg,                                      (0=地番地区・1=住居表示地区 / 両方を保持)
//     prc_rec_flg, prc_area_code, ...
//   座標 mt_parcel_pos_city{LG6}.csv :
//     lg_code, machiaza_id, prc_id,
//     rep_lon, rep_lat,                                   ★ 値が swap (= buildChibanFromCsv で・auto-detect)
//     rep_srid, rep_scale, ...
// 3 キー JOIN: lg_code + machiaza_id + prc_id (= rsdt は・5 キー / 地番は・3 キー)
// 座標 swap auto-detect: Japan domain (= lat 20-46 / lon 122-154) で・行ごとに判定 (= 全行 swap 想定)
// 大字 key: city + ward + oaza_cho + chome + koaza (= rsdt / street と・同方式)
// 点フィールド: { c:oazaIdx, lat:int×1e5, lng:int×1e5, k:prc_num1, g:prc_num2(-prc_num3) }
//   ・g は・prc_num2 が空 なら・省略 (= rsdt と・同・「k(番)のみ」も・正常)

// 座標値の lat/lng を・数値範囲で・auto-detect (= Japan: lat 20-46, lon 122-154)
// 戻り値: { lat, lng, swapped } / range 外 は null
function detectJapanLatLng(aStr, bStr) {
  if (!aStr || !bStr) return null;
  const a = parseFloat(aStr);
  const b = parseFloat(bStr);
  if (isNaN(a) || isNaN(b)) return null;
  if (a >= 20 && a <= 46 && b >= 122 && b <= 154) return { lat: a, lng: b, swapped: true };
  if (a >= 122 && a <= 154 && b >= 20 && b <= 46) return { lat: b, lng: a, swapped: false };
  return null;
}

function buildChibanFromCsv(bodyCsvText, posCsvText, prefName) {
  const body = parseAbrCsv(bodyCsvText);
  const pos = parseAbrCsv(posCsvText);

  // 3 キー (= 本体 / 座標 で・同名)
  const KEY_NAMES = ['lg_code', 'machiaza_id', 'prc_id'];
  const bodyKeyIdx = KEY_NAMES.map((n) => findCol(body.headers, n));
  const posKeyIdx = KEY_NAMES.map((n) => findCol(pos.headers, n));
  for (let i = 0; i < KEY_NAMES.length; i++) {
    if (bodyKeyIdx[i] === -1)
      throw new Error(`ABR chiban body CSV: 3キー列 ${KEY_NAMES[i]} 見つからず`);
    if (posKeyIdx[i] === -1)
      throw new Error(`ABR chiban pos CSV: 3キー列 ${KEY_NAMES[i]} 見つからず`);
  }
  const cityIdx = findCol(body.headers, 'city', 'city_name');
  const wardIdx = findCol(body.headers, 'ward');
  const oazaIdx = findCol(body.headers, 'oaza_cho', 'oaza_cho_name', 'oaza_name');
  const chomeIdx = findCol(body.headers, 'chome', 'chome_name');
  const koazaIdx = findCol(body.headers, 'koaza', 'koaza_name');
  const p1Idx = findCol(body.headers, 'prc_num1');
  const p2Idx = findCol(body.headers, 'prc_num2');
  const p3Idx = findCol(body.headers, 'prc_num3');
  const flgIdx = findCol(body.headers, 'rsdt_addr_flg');
  if (p1Idx === -1) throw new Error('ABR chiban body CSV: prc_num1 列が無い');
  // 座標 列は・header label 順序 (= rep_lon が・前 / rep_lat が・後) を・指す
  const lonHdrIdx = findCol(pos.headers, 'rep_lon', 'rep_pnt_lon');
  const latHdrIdx = findCol(pos.headers, 'rep_lat', 'rep_pnt_lat');
  if (lonHdrIdx === -1) throw new Error('ABR chiban pos CSV: rep_lon 列が無い');
  if (latHdrIdx === -1) throw new Error('ABR chiban pos CSV: rep_lat 列が無い');

  // 座標 を 3 キーで Map 化 + swap auto-detect (= 行ごと判定・全行 swap 想定でも 1 件単位で正しく扱う)
  const posMap = new Map();
  let posWithCoord = 0,
    posSwapped = 0,
    posNormal = 0,
    posOutOfRange = 0;
  for (const r of pos.rows) {
    const det = detectJapanLatLng(r[lonHdrIdx], r[latHdrIdx]);
    if (!det) {
      if (r[lonHdrIdx] && r[latHdrIdx]) posOutOfRange++;
      continue;
    }
    if (det.swapped) posSwapped++;
    else posNormal++;
    posWithCoord++;
    const k = posKeyIdx.map((i) => r[i] || '').join('|');
    posMap.set(k, [det.lat, det.lng]);
  }

  // body 走査 + JOIN
  const oazaToIdx = new Map();
  const oazas = {};
  let nextOazaIdx = 0;
  const points = [];
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const grid = {};
  let skippedNoPos = 0;
  let skippedInvalid = 0;
  const countByFlg = { 0: 0, 1: 0, other: 0 };

  for (const r of body.rows) {
    const k = bodyKeyIdx.map((i) => r[i] || '').join('|');
    const p = posMap.get(k);
    if (!p) {
      skippedNoPos++;
      continue;
    }
    const city = (cityIdx !== -1 ? r[cityIdx] : '') || '';
    const ward = (wardIdx !== -1 ? r[wardIdx] : '') || '';
    const oazaCho = (oazaIdx !== -1 ? r[oazaIdx] : '') || '';
    const chome = (chomeIdx !== -1 ? r[chomeIdx] : '') || '';
    const koaza = (koazaIdx !== -1 ? r[koazaIdx] : '') || '';
    const p1 = (p1Idx !== -1 ? r[p1Idx] : '') || '';
    const p2 = (p2Idx !== -1 ? r[p2Idx] : '') || '';
    const p3 = (p3Idx !== -1 ? r[p3Idx] : '') || '';
    if (!city || !p1) {
      skippedInvalid++;
      continue;
    }
    const flg = flgIdx !== -1 ? r[flgIdx] : '';
    if (flg === '0') countByFlg[0]++;
    else if (flg === '1') countByFlg[1]++;
    else countByFlg.other++;

    // 大字 key (= street / rsdt と同方式・市 + 区 + 大字町 + 丁目 + 小字)
    const oazaKey = city + (ward || '') + (oazaCho || '') + (chome || '') + (koaza || '');
    let oazaIdxVal = oazaToIdx.get(oazaKey);
    if (oazaIdxVal === undefined) {
      oazaIdxVal = nextOazaIdx++;
      oazaToIdx.set(oazaKey, oazaIdxVal);
      oazas[oazaIdxVal] = oazaKey;
    }
    const latI = Math.round(p[0] * enc.PRECISION);
    const lngI = Math.round(p[1] * enc.PRECISION);
    if (latI < bbox[0]) bbox[0] = latI;
    if (lngI < bbox[1]) bbox[1] = lngI;
    if (latI > bbox[2]) bbox[2] = latI;
    if (lngI > bbox[3]) bbox[3] = lngI;
    const point = { c: oazaIdxVal, lat: latI, lng: lngI, k: p1 };
    if (p2) point.g = p3 ? p2 + '-' + p3 : p2;
    const pointIdx = points.length;
    points.push(point);
    const gk = enc.gridKey(latI, lngI);
    (grid[gk] ||= []).push(pointIdx);
  }
  return {
    v: 2,
    prefecture: prefName,
    generated: new Date().toISOString(),
    precision: enc.PRECISION,
    bbox: points.length ? bbox : null,
    gridSize: enc.GRID_INT,
    oazas,
    grid,
    points,
    _stats: {
      bodyRows: body.rows.length,
      posRows: pos.rows.length,
      posWithCoord,
      posSwapped,
      posNormal,
      posOutOfRange,
      skippedNoPos,
      skippedInvalid,
      countByFlg,
    },
  };
}

// 県内 全自治体の・地番 CSV ペアを・読み込んで・1 bundle に集約
//   入力: input/_abr/mt_parcel_city{LG6}.csv + mt_parcel_pos_city{LG6}.csv
//         LG6 が・pcode (= 2 桁) で始まる・全 file を対象 (= 県内全自治体)
//   出力: POI v2 同形式 + _stats.lgCodes (= 自治体ごとの・カバレッジ情報)
function buildChibanForPref(prefName) {
  const pcode = PREF_CODE[prefName];
  if (!pcode) return null;
  const abrDir = path.join(INPUT_ROOT, '_abr');
  if (!fs.existsSync(abrDir)) return null;
  const all = fs.readdirSync(abrDir);
  const bodyRe = new RegExp('^mt_parcel_city(' + pcode + '\\d{4})\\.csv$');
  const bodyFiles = all.filter((f) => bodyRe.test(f)).sort();
  if (bodyFiles.length === 0) return null;

  const merged = {
    v: 2,
    prefecture: prefName,
    generated: new Date().toISOString(),
    precision: enc.PRECISION,
    bbox: [Infinity, Infinity, -Infinity, -Infinity],
    gridSize: enc.GRID_INT,
    oazas: {},
    grid: {},
    points: [],
    _stats: {
      lgCodes: [],
      bodyRows: 0,
      posRows: 0,
      posWithCoord: 0,
      posSwapped: 0,
      posNormal: 0,
      posOutOfRange: 0,
      skippedNoPos: 0,
      skippedInvalid: 0,
      countByFlg: { 0: 0, 1: 0, other: 0 },
    },
  };
  const oazaToIdx = new Map();
  let nextOazaIdx = 0;

  for (const bodyFile of bodyFiles) {
    const m = bodyFile.match(/^mt_parcel_city(\d{6})\.csv$/);
    if (!m) continue;
    const lg = m[1];
    const posFile = `mt_parcel_pos_city${lg}.csv`;
    if (!all.includes(posFile)) {
      merged._stats.lgCodes.push({ lg, status: 'no_pos_file', points: 0 });
      continue;
    }
    const bodyCsv = fs.readFileSync(path.join(abrDir, bodyFile), 'utf8');
    const posCsv = fs.readFileSync(path.join(abrDir, posFile), 'utf8');
    let part;
    try {
      part = buildChibanFromCsv(bodyCsv, posCsv, prefName);
    } catch (err) {
      merged._stats.lgCodes.push({ lg, status: 'build_error', error: err.message, points: 0 });
      continue;
    }

    // 大字 dict と・grid と・points を・遷移マージ
    const oazaRemap = {};
    for (const [partIdxStr, name] of Object.entries(part.oazas)) {
      let g = oazaToIdx.get(name);
      if (g === undefined) {
        g = nextOazaIdx++;
        oazaToIdx.set(name, g);
        merged.oazas[g] = name;
      }
      oazaRemap[partIdxStr] = g;
    }
    for (const p of part.points) {
      const mergedPointIdx = merged.points.length;
      const np = { c: oazaRemap[p.c], lat: p.lat, lng: p.lng, k: p.k };
      if (p.g) np.g = p.g;
      merged.points.push(np);
      const gk = enc.gridKey(p.lat, p.lng);
      (merged.grid[gk] ||= []).push(mergedPointIdx);
      if (p.lat < merged.bbox[0]) merged.bbox[0] = p.lat;
      if (p.lng < merged.bbox[1]) merged.bbox[1] = p.lng;
      if (p.lat > merged.bbox[2]) merged.bbox[2] = p.lat;
      if (p.lng > merged.bbox[3]) merged.bbox[3] = p.lng;
    }

    const ps = part._stats;
    merged._stats.bodyRows += ps.bodyRows;
    merged._stats.posRows += ps.posRows;
    merged._stats.posWithCoord += ps.posWithCoord;
    merged._stats.posSwapped += ps.posSwapped;
    merged._stats.posNormal += ps.posNormal;
    merged._stats.posOutOfRange += ps.posOutOfRange;
    merged._stats.skippedNoPos += ps.skippedNoPos;
    merged._stats.skippedInvalid += ps.skippedInvalid;
    merged._stats.countByFlg[0] += ps.countByFlg[0];
    merged._stats.countByFlg[1] += ps.countByFlg[1];
    merged._stats.countByFlg.other += ps.countByFlg.other;
    merged._stats.lgCodes.push({
      lg,
      status: 'ok',
      points: part.points.length,
      bodyRows: ps.bodyRows,
      posRows: ps.posRows,
      coverage:
        ps.bodyRows > 0 ? ((part.points.length / ps.bodyRows) * 100).toFixed(1) + '%' : '0%',
    });
  }
  if (merged.points.length === 0) merged.bbox = null;
  return merged;
}

// ─── main ──────────────────────────────────────────────────────────
async function main() {
  if (!MODE_COARSE && !MODE_FINE && !MODE_STREET && !MODE_RSDT && !MODE_CHIBAN) {
    console.error(
      'Usage: build-address.js --coarse | --fine | --street | --rsdt | --chiban [--pref=<name>]'
    );
    process.exit(1);
  }
  if (MODE_COARSE) {
    console.log(`▼ build coarse (中精度・市区町村代表点)`);
    const { items, prefsProcessed } = buildCoarse();
    if (items.length === 0) {
      console.error('❌ no items');
      process.exit(1);
    }
    const data = u.buildPointBundle(items, (it) => {
      const o = {};
      if (it.n) o.n = it.n;
      if (it.p) o.p = it.p;
      if (it.c) o.c = it.c;
      return o;
    });
    data.source = '国土数値情報 N03 (行政区域・国交省)・市区町村単位代表点';
    const OUT = path.join(PROJECT_ROOT, 'data', 'addresses-coarse-jp.js');
    const size = u.writeBundleJs(OUT, 'ADDRESSES_COARSE_JP', data, [
      `// 出典: 国土数値情報 N03 (行政区域・国交省・PDL1.0)`,
      `// 市区町村単位の代表点 (ポリゴン重心) を集約`,
      `// 全国 ${items.length} 件 / ${prefsProcessed}/${targetPrefs.length} 県`,
    ]);
    console.log(`✅ ${OUT}  count=${items.length} size=${(size / 1024).toFixed(2)} KB`);
  }

  if (MODE_FINE) {
    console.log(`▼ build fine (詳細・大字代表点)`);
    const { items, prefsProcessed } = buildFine();
    if (items.length === 0) {
      console.error('❌ no items');
      process.exit(1);
    }
    const data = u.buildPointBundle(items, (it) => {
      const o = {};
      if (it.n) o.n = it.n;
      if (it.c) o.c = it.c;
      if (it.p) o.p = it.p;
      return o;
    });
    data.source = '国交省 街区レベル位置参照情報・代表フラグ=1 のみ';
    const OUT = path.join(PROJECT_ROOT, 'data', 'addresses-fine-jp.js');
    const size = u.writeBundleJs(OUT, 'ADDRESSES_FINE_JP', data, [
      `// 出典: 国交省 街区レベル位置参照情報 (PDL1.0)`,
      `// 代表フラグ=1 の街区代表点のみ抽出`,
      `// 全国 ${items.length} 件 / ${prefsProcessed}/${targetPrefs.length} 県`,
    ]);
    console.log(`✅ ${OUT}  count=${items.length} size=${(size / 1024).toFixed(2)} KB`);
  }

  if (MODE_STREET) {
    console.log(`▼ build street (= ISJ 街区・番レベル・47 県分割)`);
    let totalPoints = 0;
    let prefsOk = 0;
    for (const pref of targetPrefs) {
      const bundle = buildStreetForPref(pref);
      if (!bundle) {
        console.log(`  skip ${pref}: streets.csv 無し`);
        continue;
      }
      const stats = bundle._stats || {};
      delete bundle._stats; // 出力 file には・含めない
      const pcode = (enc.PREFECTURES && enc.PREFECTURES[pref]) || '';
      bundle.source = '国交省 街区レベル位置参照情報 (PDL1.0)・代表フラグ=1 のみ';
      const OUT = path.join(PROJECT_ROOT, 'data', `addresses-street-${pref}.js`);
      const varName = 'ADDRESSES_STREET_' + pref.toUpperCase().replace(/-/g, '_');
      const size = u.writeBundleJs(OUT, varName, bundle, [
        `// Prefecture: ${pref}${pcode ? ' (JIS ' + pcode + ')' : ''}`,
        `// 出典: 国交省 街区レベル位置参照情報 (PDL1.0)`,
        `// 代表フラグ=1 の街区代表点のみ抽出 (= 番=街区符号レベル)`,
        `// 件数 ${bundle.points.length} / 大字 ${Object.keys(bundle.oazas).length}`,
      ]);
      totalPoints += bundle.points.length;
      prefsOk++;
      console.log(
        `  ✅ ${pref}: ${bundle.points.length} 街区 / ${Object.keys(bundle.oazas).length} 大字` +
          ` / ${(size / 1024 / 1024).toFixed(2)} MB` +
          (stats.skippedNoFlag ? ` (skip 代表フラグ=0: ${stats.skippedNoFlag})` : '')
      );
    }
    console.log(`▼ 完了: ${prefsOk}/${targetPrefs.length} 県 / 合計 ${totalPoints} 街区点`);
  }

  if (MODE_RSDT) {
    console.log(`▼ build rsdt (= ABR 住居マスター・号レベル・47 県分割)`);
    let totalPoints = 0;
    let prefsOk = 0;
    for (const pref of targetPrefs) {
      const bundle = buildRsdtForPref(pref);
      if (!bundle) {
        console.log(`  skip ${pref}: input/_abr/mt_rsdtdsp_rsdt_pref{NN}.csv が無い`);
        continue;
      }
      const stats = bundle._stats || {};
      delete bundle._stats; // 出力 file には・含めない
      const pcode = PREF_CODE[pref] || '';
      bundle.source =
        'デジタル庁 アドレス・ベース・レジストリ (ABR・CC-BY 4.0)・rsdt_addr_flg=1 のみ';
      const OUT = path.join(PROJECT_ROOT, 'data', `addresses-rsdt-${pref}.js`);
      const varName = 'ADDRESSES_RSDT_' + pref.toUpperCase().replace(/-/g, '_');
      const size = u.writeBundleJs(OUT, varName, bundle, [
        `// Prefecture: ${pref}${pcode ? ' (JIS ' + pcode + ')' : ''}`,
        `// 出典: デジタル庁 アドレス・ベース・レジストリ (ABR・CC-BY 4.0)`,
        `// 5 キー JOIN: lg_code+town_id+blk_id+addr_id+addr2_id`,
        `// 住居表示実施地区 (rsdt_addr_flg=1) のみ抽出 (= 号レベル)`,
        `// 件数 ${bundle.points.length} / 大字 ${Object.keys(bundle.oazas).length}`,
      ]);
      totalPoints += bundle.points.length;
      prefsOk++;
      console.log(
        `  ✅ ${pref}: ${bundle.points.length} 号 / ${Object.keys(bundle.oazas).length} 大字` +
          ` / ${(size / 1024 / 1024).toFixed(2)} MB` +
          ` (body=${stats.bodyRows} pos=${stats.posRows}` +
          ` skipFlg0=${stats.skippedFlgZero} noPos=${stats.skippedNoPos} invalid=${stats.skippedInvalid})`
      );
    }
    console.log(`▼ 完了: ${prefsOk}/${targetPrefs.length} 県 / 合計 ${totalPoints} 号点`);
  }

  if (MODE_CHIBAN) {
    console.log(`▼ build chiban (= ABR 地番マスター・地番レベル・47 県分割・市区町村集約)`);
    let totalPoints = 0;
    let prefsOk = 0;
    for (const pref of targetPrefs) {
      const bundle = buildChibanForPref(pref);
      if (!bundle) {
        console.log(`  skip ${pref}: input/_abr/mt_parcel_city{LG6}.csv が無い`);
        continue;
      }
      const stats = bundle._stats || {};
      delete bundle._stats; // 出力 file には・含めない
      const pcode = PREF_CODE[pref] || '';
      bundle.source =
        'デジタル庁 アドレス・ベース・レジストリ (ABR 地番マスター + 位置参照拡張・CC-BY 4.0)';
      const OUT = path.join(PROJECT_ROOT, 'data', `addresses-chiban-${pref}.js`);
      const varName = 'ADDRESSES_CHIBAN_' + pref.toUpperCase().replace(/-/g, '_');
      const cityOk = (stats.lgCodes || []).filter((l) => l.status === 'ok').length;
      const cityTotal = (stats.lgCodes || []).length;
      const size = u.writeBundleJs(OUT, varName, bundle, [
        `// Prefecture: ${pref}${pcode ? ' (JIS ' + pcode + ')' : ''}`,
        `// 出典: デジタル庁 アドレス・ベース・レジストリ (ABR 地番マスター + 位置参照拡張・CC-BY 4.0)`,
        `// 3 キー JOIN: lg_code+machiaza_id+prc_id (= 市区町村別 zip を県内集約)`,
        `// 地番マスター・rsdt_addr_flg=0/1 両方含む (= 地番地区+住居表示地区の地番)`,
        `// 自治体 ${cityOk}/${cityTotal} OK / 件数 ${bundle.points.length} / 大字 ${Object.keys(bundle.oazas).length}`,
        `// pos座標 swap=${stats.posSwapped} normal=${stats.posNormal} outOfRange=${stats.posOutOfRange}`,
      ]);
      totalPoints += bundle.points.length;
      prefsOk++;
      console.log(
        `  ✅ ${pref}: ${bundle.points.length} 地番 / ${Object.keys(bundle.oazas).length} 大字 / ${cityOk}/${cityTotal} 自治体` +
          ` / ${(size / 1024 / 1024).toFixed(2)} MB` +
          ` (body=${stats.bodyRows} pos=${stats.posRows} noPos=${stats.skippedNoPos} invalid=${stats.skippedInvalid}` +
          ` flg0=${stats.countByFlg[0]} flg1=${stats.countByFlg[1]} swap=${stats.posSwapped})`
      );
    }
    console.log(`▼ 完了: ${prefsOk}/${targetPrefs.length} 県 / 合計 ${totalPoints} 地番点`);
  }
}

// CLI (= node scripts/build-address.js ...) で起動された時のみ・main 実行
// require() 経由 (= test) では・main 実行せず・export のみ
if (typeof require !== 'undefined' && require.main === module) {
  main().catch((e) => {
    console.error('FATAL:', e);
    process.exit(1);
  });
}

// テスト / 他 script からの再利用用 export (= browser 環境では・require 無し)
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = {
    buildStreetFromCsvText,
    buildStreetForPref,
    buildRsdtFromCsv,
    buildRsdtForPref,
    buildChibanFromCsv,
    buildChibanForPref,
    detectJapanLatLng,
    parseAbrCsv,
    findCol,
  };
}
