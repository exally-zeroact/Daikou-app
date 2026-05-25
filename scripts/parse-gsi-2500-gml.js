#!/usr/bin/env node
// [ARCHIVED 2026-05-09] GSI 1/2,500統合スクリプト
// 測量法申請リスクにより現在は未使用
// 将来国土地理院がオープンデータ化した場合に再活用予定
// build-roads.jsの--gsi-2500-dirフラグ未指定時は実行されない
/**
 * parse-gsi-2500-gml.js
 *
 * 国土地理院 基盤地図情報 (FGD: Foundation Geographic Data) 1/2,500 GML を
 * GeoJSON FeatureCollection に変換する。
 *
 * Phase E (2026-05-09): Daikou Map Matching 精度向上用
 *   OSM polyline (10-50m サンプル間隔) より高精度な
 *   1/2,500 道路縁データ (0.5-2.5m 精度) を build-roads.js に注入する目的。
 *
 * 入力:
 *   FG-GML-{mesh}-{layer}-...-RdEdg.xml
 *     mesh: 二次メッシュコード (例: 5237 = 松山市付近)
 *     layer: 道路縁 (RdEdg) のみ抽出・他レイヤ (BldA / WL 等) はスキップ
 *
 * 出力:
 *   GeoJSON FeatureCollection
 *   - geometry: LineString
 *   - properties:
 *       gsi_type:       国土地理院 道路区分 (主要道路 / 通常道路 / 軽車道 / 徒歩道)
 *       gsi_source:     'gsi-2500'
 *       gsi_mesh:       メッシュコード
 *
 * 使い方:
 *   node scripts/parse-gsi-2500-gml.js <gml-file> > output.geojson
 *   node scripts/parse-gsi-2500-gml.js <input-dir> --output=<dir>
 *
 * 備考:
 *   ・ 国土地理院 基盤地図情報の利用規約に従い出典明記必須
 *     (国土地理院長承認 第○○号・等の表記)
 *   ・ 座標系は JGD2011 (lat/lng degree) で WGS84 とほぼ同等 (<1m 差・無視可)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── GML 軽量パーサ (依存ゼロ・FGD RdEdg のみ対象) ────────────────
//   フル XML パーサは over-engineering なので tag 検索で十分
//   FGD RdEdg は単純な構造: <fgd:RdEdg> ... <gml:posList>...</gml:posList> ... </fgd:RdEdg>

function _extractTagBlocks(xml, tag) {
  // tag に合致する <{tag} ...> ... </{tag}> を全部返す (生 string)
  const open = '<' + tag;
  const close = '</' + tag + '>';
  const blocks = [];
  let pos = 0;
  while (true) {
    const start = xml.indexOf(open, pos);
    if (start < 0) break;
    const tagEnd = xml.indexOf('>', start);
    if (tagEnd < 0) break;
    // self-closing tag (<tag .../>) はスキップ
    if (xml[tagEnd - 1] === '/') {
      pos = tagEnd + 1;
      continue;
    }
    const closeStart = xml.indexOf(close, tagEnd);
    if (closeStart < 0) break;
    blocks.push(xml.substring(start, closeStart + close.length));
    pos = closeStart + close.length;
  }
  return blocks;
}

function _extractTagText(xml, tag) {
  const open = '<' + tag;
  const close = '</' + tag + '>';
  const start = xml.indexOf(open);
  if (start < 0) return null;
  const tagEnd = xml.indexOf('>', start);
  if (tagEnd < 0) return null;
  const closeStart = xml.indexOf(close, tagEnd);
  if (closeStart < 0) return null;
  return xml.substring(tagEnd + 1, closeStart).trim();
}

function _parsePosList(text) {
  // text: "lat lng lat lng ..." (空白区切り・改行含む)
  if (!text) return [];
  const tokens = text.trim().split(/\s+/);
  const points = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const lat = parseFloat(tokens[i]);
    const lng = parseFloat(tokens[i + 1]);
    if (!isNaN(lat) && !isNaN(lng)) points.push([lng, lat]); // GeoJSON は [lng, lat]
  }
  return points;
}

function parseGml(xml) {
  const features = [];
  const rdedgs = _extractTagBlocks(xml, 'fgd:RdEdg');
  for (const block of rdedgs) {
    const posListText = _extractTagText(block, 'gml:posList');
    if (!posListText) continue;
    const coords = _parsePosList(posListText);
    if (coords.length < 2) continue;
    const gsiType = _extractTagText(block, 'fgd:type') || 'unknown';
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {
        gsi_type: gsiType,
        gsi_source: 'gsi-2500',
      },
    });
  }
  return features;
}

// ─── CLI ────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: parse-gsi-2500-gml.js <gml-file> > output.geojson');
    console.error('       parse-gsi-2500-gml.js <input-dir> --output=<output-dir>');
    process.exit(1);
  }
  const input = args[0];
  const outputDirArg = args.find((a) => a.startsWith('--output='));
  const outputDir = outputDirArg ? outputDirArg.slice(9) : null;
  const stat = fs.statSync(input);
  if (stat.isFile()) {
    const xml = fs.readFileSync(input, 'utf8');
    const features = parseGml(xml);
    const fc = { type: 'FeatureCollection', features: features };
    process.stdout.write(JSON.stringify(fc));
    process.stderr.write('parsed ' + features.length + ' RdEdg features\n');
  } else if (stat.isDirectory()) {
    if (!outputDir) {
      console.error('--output=<dir> required for directory input');
      process.exit(1);
    }
    fs.mkdirSync(outputDir, { recursive: true });
    const files = fs.readdirSync(input).filter((f) => /RdEdg.*\.xml$/.test(f));
    let totalFeatures = 0;
    for (const f of files) {
      const xml = fs.readFileSync(path.join(input, f), 'utf8');
      const features = parseGml(xml);
      const fc = { type: 'FeatureCollection', features: features };
      const outPath = path.join(outputDir, f.replace(/\.xml$/, '.geojson'));
      fs.writeFileSync(outPath, JSON.stringify(fc));
      totalFeatures += features.length;
      console.error('  ' + f + ': ' + features.length + ' features');
    }
    console.error('TOTAL: ' + totalFeatures + ' features in ' + files.length + ' files');
  }
}

if (require.main === module) main();
module.exports = { parseGml };
