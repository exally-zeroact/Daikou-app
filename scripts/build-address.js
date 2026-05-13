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
 * 使い方:
 *   node scripts/build-address.js --coarse
 *   node scripts/build-address.js --fine
 *   node scripts/build-address.js --coarse --pref=ehime    # 1 県だけ
 */

const fs = require('fs');
const path = require('path');
const u = require('./bundle-utils.js');

const args = process.argv.slice(2);
const MODE_COARSE = args.includes('--coarse');
const MODE_FINE = args.includes('--fine');
const prefArg = args.find(a => a.startsWith('--pref='));
const ONLY_PREF = prefArg ? prefArg.slice(7) : null;

if (!MODE_COARSE && !MODE_FINE) {
  console.error('Usage: build-address.js --coarse | --fine [--pref=<name>]');
  process.exit(1);
}

const PROJECT_ROOT = path.join(__dirname, '..');
const INPUT_ROOT = path.join(PROJECT_ROOT, 'input');
const ALL_PREFS = [
  'hokkaido','aomori','iwate','miyagi','akita','yamagata','fukushima',
  'ibaraki','tochigi','gunma','saitama','chiba','tokyo','kanagawa',
  'niigata','toyama','ishikawa','fukui','yamanashi','nagano','gifu','shizuoka','aichi',
  'mie','shiga','kyoto','osaka','hyogo','nara','wakayama',
  'tottori','shimane','okayama','hiroshima','yamaguchi',
  'tokushima','kagawa','ehime','kochi',
  'fukuoka','saga','nagasaki','kumamoto','oita','miyazaki','kagoshima','okinawa',
];
// JIS X 0401 都道府県コード (2 桁)
const PREF_CODE = {
  hokkaido: '01',
  aomori: '02', iwate: '03', miyagi: '04', akita: '05', yamagata: '06', fukushima: '07',
  ibaraki: '08', tochigi: '09', gunma: '10',
  saitama: '11', chiba: '12', tokyo: '13', kanagawa: '14',
  niigata: '15', toyama: '16', ishikawa: '17', fukui: '18',
  yamanashi: '19', nagano: '20', gifu: '21', shizuoka: '22', aichi: '23',
  mie: '24', shiga: '25', kyoto: '26', osaka: '27',
  hyogo: '28', nara: '29', wakayama: '30',
  tottori: '31', shimane: '32', okayama: '33', hiroshima: '34', yamaguchi: '35',
  tokushima: '36', kagawa: '37', ehime: '38', kochi: '39',
  fukuoka: '40', saga: '41', nagasaki: '42', kumamoto: '43',
  oita: '44', miyazaki: '45', kagoshima: '46', okinawa: '47',
};
const targetPrefs = ONLY_PREF ? [ONLY_PREF] : ALL_PREFS;

// ─── 任意ジオメトリから重心 [lat, lng] を計算 ────────────────────
function centroid(geometry) {
  let sumLat = 0, sumLng = 0, n = 0;
  function walk(node) {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      sumLng += node[0]; sumLat += node[1]; n++;
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
    for (const f of (json.features || [])) {
      const c = centroid(f.geometry);
      if (!c) continue;
      const p = f.properties || {};
      const code = p.code || (p.pref + p.city); // フォールバック
      if (!cityMap.has(code)) {
        cityMap.set(code, {
          sumLat: 0, sumLng: 0, n: 0,
          pref: p.pref || '', county: p.county || '', city: p.city || '', code,
        });
      }
      const e = cityMap.get(code);
      e.sumLat += c.lat; e.sumLng += c.lng; e.n++;
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
      let cur = '', inQ = false;
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        if (ch === '"') { inQ = !inQ; continue; }
        if (ch === ',' && !inQ) { cols.push(cur); cur = ''; continue; }
        cur += ch;
      }
      cols.push(cur);
      if (cols.length < 12) continue;
      if (cols[11] !== '1') continue; // 代表フラグ=1 のみ
      const city  = cols[1] || '';
      const oaza  = cols[2] || '';
      const koaza = cols[3] || '';
      const key = city + '|' + oaza + '|' + koaza;
      if (seen.has(key)) continue;
      seen.add(key);
      const lat = parseFloat(cols[8]);
      const lng = parseFloat(cols[9]);
      if (isNaN(lat) || isNaN(lng)) continue;
      items.push({
        lat, lng,
        n: oaza + (koaza || ''),
        c: city,
        p: pcode,   // 都道府県コード (2 桁・JIS X 0401)
      });
      count++;
    }
    prefsProcessed++;
    console.log(`  ${pref}: ${count} 大字`);
  }
  return { items, prefsProcessed };
}

// ─── main ──────────────────────────────────────────────────────────
(async () => {
  if (MODE_COARSE) {
    console.log(`▼ build coarse (中精度・市区町村代表点)`);
    const { items, prefsProcessed } = buildCoarse();
    if (items.length === 0) { console.error('❌ no items'); process.exit(1); }
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
    console.log(`✅ ${OUT}  count=${items.length} size=${(size/1024).toFixed(2)} KB`);
  }

  if (MODE_FINE) {
    console.log(`▼ build fine (詳細・大字代表点)`);
    const { items, prefsProcessed } = buildFine();
    if (items.length === 0) { console.error('❌ no items'); process.exit(1); }
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
    console.log(`✅ ${OUT}  count=${items.length} size=${(size/1024).toFixed(2)} KB`);
  }
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
