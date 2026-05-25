#!/usr/bin/env node
'use strict';

// ★設計変更宣言 (2026-05-15・住所データ 47 県分割スクリプト):
//   data/addresses-fine-jp.js (24.6 MB・全国一括 239,760 件) を 47 都道府県別に分割し
//   data/addresses-fine-{pref}.js を生成する。設計は roads-{pref}.js / bridges-{pref}.js と
//   揃え、js/data-registry.js の perPref エントリ経由で現在地の県のみ動的ロードする運用に
//   切り替えるための準備。
//
//   分割方針:
//     ・ 入力: window.ADDRESSES_FINE_JP.items 各 { lat, lng, n, c, p }
//       (lat/lng は 1e5 倍整数・p は JIS X 0401 都道府県コード 2 桁文字列)
//     ・ p (JIS コード) → ローマ字 pref 名 (ehime / osaka 等) に変換し 47 バケット振分け
//     ・ buildPointBundle で再度 grid index を再構築 (lat/lng は度数に戻してから渡す)
//     ・ 各県ファイル: window.ADDRESSES_FINE_{PREF_UPPER} = { v, items, grid, ... }
//     ・ 既存 addresses-fine-jp.js は削除せず残す (後方互換用・運用上は load しない)
//
//   使い方:
//     node scripts/build-address-split.js
//
//   絶対ルール準拠:
//     ✓ 既存 addresses-fine-jp.js (全国版) は破壊しない
//     ✓ 距離計算ロジックは不変・本スクリプトはデータ加工のみ
//     ✓ 県コード変換は build-address.js の PREF_CODE 表を流用 (二重メンテ防止)

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const u = require('./bundle-utils.js');

const PROJECT_ROOT = path.join(__dirname, '..');
const SOURCE = path.join(PROJECT_ROOT, 'data', 'addresses-fine-jp.js');
const OUT_DIR = path.join(PROJECT_ROOT, 'data');

// build-address.js と同一の 47 県順序・JIS X 0401 コード
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
const CODE_TO_PREF = {};
for (const k of Object.keys(PREF_CODE)) CODE_TO_PREF[PREF_CODE[k]] = k;

if (!fs.existsSync(SOURCE)) {
  console.error('source not found:', SOURCE);
  process.exit(1);
}

console.log('▼ loading source ' + SOURCE);
const src = fs.readFileSync(SOURCE, 'utf8');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'addresses-fine-jp.js' });

const allData = ctx.window.ADDRESSES_FINE_JP;
if (!allData || !Array.isArray(allData.items)) {
  console.error('ADDRESSES_FINE_JP not loaded or items not array');
  process.exit(1);
}

const precision = allData.precision || 100000;
console.log(
  '  loaded ' +
    allData.items.length +
    ' items (precision=' +
    precision +
    ' v=' +
    allData.v +
    ')'
);

// 県別 bucket・度数に戻して buildPointBundle に渡す (内部で再度 precision 倍 integer 化)
const buckets = {};
for (const pref of ALL_PREFS) buckets[pref] = [];

let skipped = 0;
const items = allData.items;
for (let i = 0; i < items.length; i++) {
  const it = items[i];
  const code = it.p;
  const pref = CODE_TO_PREF[code];
  if (!pref) {
    skipped++;
    continue;
  }
  buckets[pref].push({
    lat: it.lat / precision,
    lng: it.lng / precision,
    n: it.n,
    c: it.c,
    p: code,
  });
}

console.log('▼ writing 47 prefecture files');
let totalOut = 0;
let totalSize = 0;
for (const pref of ALL_PREFS) {
  const bucket = buckets[pref];
  const data = u.buildPointBundle(bucket, (it) => {
    const o = {};
    if (it.n) o.n = it.n;
    if (it.c) o.c = it.c;
    return o;
  });
  data.source = '国交省 街区レベル位置参照情報・代表フラグ=1 のみ・都道府県別分割版';
  data.prefecture = pref;
  data.prefCode = PREF_CODE[pref];
  const upperPref = pref.toUpperCase().replace(/-/g, '_');
  const varName = 'ADDRESSES_FINE_' + upperPref;
  const outFile = path.join(OUT_DIR, 'addresses-fine-' + pref + '.js');
  const size = u.writeBundleJs(outFile, varName, data, [
    '// 出典: 国交省 街区レベル位置参照情報 (PDL1.0)',
    '// 代表フラグ=1 の街区代表点のみ抽出・都道府県 ' + pref + ' (JIS ' + PREF_CODE[pref] + ') 限定',
    '// 件数 ' + bucket.length,
  ]);
  totalOut += bucket.length;
  totalSize += size;
  console.log(
    '  ' +
      pref.padEnd(10) +
      ' ' +
      ('items=' + bucket.length).padEnd(15) +
      ' ' +
      (size / 1024).toFixed(1).padStart(8) +
      ' KB  → ' +
      path.relative(PROJECT_ROOT, outFile)
  );
}

console.log(
  '\n✅ done. total items=' +
    totalOut +
    ' (source=' +
    allData.items.length +
    ' skipped=' +
    skipped +
    ')  total size=' +
    (totalSize / 1024 / 1024).toFixed(2) +
    ' MB'
);
