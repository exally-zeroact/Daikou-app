#!/usr/bin/env node
/**
 * build-poly-files.js
 *
 * 47都道府県の Osmosis .poly ファイルを生成する。
 *
 * v1（本実装）: data/meta.json の bbox を使った 矩形 .poly を生成（簡便・処理高速）
 *               → osmium extract で県境をまたぐPOIが少し多めに含まれるが、
 *                 build-poi.js 側の県別判定（重心最近傍）で結局正しい県に落ちる
 *
 * v2（未実装・将来）: KSJ N03 行政区域 GML から市区町村ポリゴンを集約して
 *                    都道府県の正確な境界 .poly を生成（県境精度を上げたいときに切替）
 *
 * 出力: scripts/poly/{pref}.poly × 47
 *
 * Osmosis .poly 形式:
 *   <name>
 *   1
 *      <lon> <lat>      <- lon-lat 順（lat-lon ではない）
 *      <lon> <lat>
 *      ...
 *   END
 *   END
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const META_PATH = path.join(PROJECT_ROOT, 'data', 'meta.json');
const OUT_DIR = path.join(__dirname, 'poly');

if (!fs.existsSync(META_PATH)) {
  console.error(`meta.json not found: ${META_PATH}`);
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
const prefs = meta.prefectures || {};

const PRECISION = 100000; // meta.json の precision = 1e5

let count = 0;
let totalSize = 0;

for (const [pref, info] of Object.entries(prefs)) {
  if (!info || !Array.isArray(info.bbox) || info.bbox.length !== 4) {
    console.warn(`  skip ${pref}: bbox not found`);
    continue;
  }
  const [latMinI, lonMinI, latMaxI, lonMaxI] = info.bbox;
  const south = latMinI / PRECISION;
  const west  = lonMinI / PRECISION;
  const north = latMaxI / PRECISION;
  const east  = lonMaxI / PRECISION;

  // 5点（閉じ）の bbox poly。osmium は 「lon lat」順を期待。
  const lines = [
    pref,
    '1',
    `   ${west.toFixed(6)}   ${south.toFixed(6)}`,
    `   ${east.toFixed(6)}   ${south.toFixed(6)}`,
    `   ${east.toFixed(6)}   ${north.toFixed(6)}`,
    `   ${west.toFixed(6)}   ${north.toFixed(6)}`,
    `   ${west.toFixed(6)}   ${south.toFixed(6)}`,
    'END',
    'END',
    '',
  ];
  const content = lines.join('\n');
  const outPath = path.join(OUT_DIR, `${pref}.poly`);
  fs.writeFileSync(outPath, content);
  const size = fs.statSync(outPath).size;
  totalSize += size;
  count++;
  console.log(`  ✅ ${pref.padEnd(12)} bbox=[${south.toFixed(3)},${west.toFixed(3)} - ${north.toFixed(3)},${east.toFixed(3)}]  ${size}B`);
}

console.log(`\n📁 ${OUT_DIR}`);
console.log(`✅ 出力数: ${count} / 47 県  /  合計 ${totalSize} B`);
