#!/usr/bin/env node
// [ARCHIVED 2026-05-09] GSI 1/2,500統合スクリプト
// 測量法申請リスクにより現在は未使用
// 将来国土地理院がオープンデータ化した場合に再活用予定
// build-roads.jsの--gsi-2500-dirフラグ未指定時は実行されない
/**
 * merge-gsi-into-osm.js
 *
 * Phase E (2026-05-09): OSM 道路 GeoJSON に 国土地理院 1/2,500 道路縁データを
 * 重ね合わせて高精度 polyline を出力する.
 *
 * 戦略:
 *   1. OSM の各 LineString について、GSI 1/2,500 ポリラインで近接 (<5m) なものを探す
 *   2. 見つかれば OSM polyline 全体を GSI polyline に置換 (高精度)
 *   3. 見つからなければ OSM をそのまま採用
 *   4. OSM の properties (highway 等) は維持
 *
 * 注意:
 *   ・ DID 内 (国土地理院 1/2,500 取扱範囲) のみ高精度化
 *   ・ DID 外 (山間部・郊外) は OSM のみ
 *   ・ GSI には OSM の typeCode (motorway/trunk/...) 情報がないため
 *     OSM の properties (highway 等) を保持して build-roads.js に渡す
 *
 * 使い方:
 *   node scripts/merge-gsi-into-osm.js <osm.geojson> <gsi-dir> > merged.geojson
 *
 * 入力:
 *   <osm.geojson>: OSM 由来の FeatureCollection (LineString 多数)
 *   <gsi-dir>:     parse-gsi-2500-gml.js が出力した GeoJSON 群のディレクトリ
 *
 * アルゴリズム:
 *   ・ 全 GSI ポリラインを 100m × 100m 空間 grid に index 化
 *   ・ 各 OSM polyline の重心から半径 5m の grid を見て GSI 候補抽出
 *   ・ 候補と OSM の Hausdorff 距離 < 5m なら "同じ道路" と判定し置換
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PROXIMITY_M = 5; // OSM-GSI マッチング距離閾値
const GRID_DEG = 0.001; // 約 100m × 100m

function _haversine(lat1, lng1, lat2, lng2) {
  if (lat1 === lat2 && lng1 === lng2) return 0;
  const R = 6371000,
    tr = Math.PI / 180;
  const dLat = (lat2 - lat1) * tr;
  const dLng = (lng2 - lng1) * tr;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * tr) * Math.cos(lat2 * tr) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _gridKey(lat, lng) {
  return Math.floor(lat / GRID_DEG) + '_' + Math.floor(lng / GRID_DEG);
}

// LineString A から LineString B への片方向 max-min 距離 (Hausdorff の片側)
// 各 a in A について min_b in B haversine(a, b) を取り、最大を返す
function _maxMinDist(coordsA, coordsB) {
  let maxDist = 0;
  for (const [lngA, latA] of coordsA) {
    let minDist = Infinity;
    for (const [lngB, latB] of coordsB) {
      const d = _haversine(latA, lngA, latB, lngB);
      if (d < minDist) minDist = d;
    }
    if (minDist > maxDist) maxDist = minDist;
    if (maxDist > PROXIMITY_M * 4) return maxDist; // early exit
  }
  return maxDist;
}

// ライブラリ API: build-roads.js から呼ばれる
function mergeGsiIntoOsm(osm, gsiDir) {
  if (!osm || osm.type !== 'FeatureCollection') throw new Error('OSM is not a FeatureCollection');
  const gsiFiles = fs.readdirSync(gsiDir).filter((f) => f.endsWith('.geojson'));
  const gsiFeatures = [];
  for (const f of gsiFiles) {
    const fc = JSON.parse(fs.readFileSync(path.join(gsiDir, f), 'utf8'));
    if (fc && Array.isArray(fc.features)) {
      for (const feat of fc.features) {
        if (
          feat.geometry &&
          feat.geometry.type === 'LineString' &&
          feat.geometry.coordinates.length >= 2
        ) {
          gsiFeatures.push(feat);
        }
      }
    }
  }
  const gsiGrid = new Map();
  for (let i = 0; i < gsiFeatures.length; i++) {
    const coords = gsiFeatures[i].geometry.coordinates;
    const seen = new Set();
    for (const [lng, lat] of coords) {
      const k = _gridKey(lat, lng);
      if (seen.has(k)) continue;
      seen.add(k);
      let arr = gsiGrid.get(k);
      if (!arr) {
        arr = [];
        gsiGrid.set(k, arr);
      }
      arr.push(i);
    }
  }
  let replaced = 0,
    kept = 0;
  const merged = { type: 'FeatureCollection', features: [] };
  for (const feat of osm.features) {
    if (
      !feat.geometry ||
      feat.geometry.type !== 'LineString' ||
      feat.geometry.coordinates.length < 2
    ) {
      merged.features.push(feat);
      continue;
    }
    const osmCoords = feat.geometry.coordinates;
    const candIdx = new Set();
    for (const [lng, lat] of osmCoords) {
      const k = _gridKey(lat, lng);
      const arr = gsiGrid.get(k);
      if (arr) for (const i of arr) candIdx.add(i);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nk = Math.floor(lat / GRID_DEG) + dy + '_' + (Math.floor(lng / GRID_DEG) + dx);
          const nArr = gsiGrid.get(nk);
          if (nArr) for (const i of nArr) candIdx.add(i);
        }
      }
    }
    let bestIdx = -1,
      bestDist = PROXIMITY_M;
    for (const i of candIdx) {
      const gsiCoords = gsiFeatures[i].geometry.coordinates;
      const d = _maxMinDist(osmCoords, gsiCoords);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      merged.features.push({
        type: 'Feature',
        geometry: gsiFeatures[bestIdx].geometry,
        properties: Object.assign({}, feat.properties, {
          gsi_2500_merged: true,
          gsi_match_dist_m: bestDist.toFixed(2),
        }),
      });
      replaced++;
    } else {
      merged.features.push(feat);
      kept++;
    }
  }
  return { featureCollection: merged, replaced: replaced, kept: kept };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node merge-gsi-into-osm.js <osm.geojson> <gsi-dir> > merged.geojson');
    process.exit(1);
  }
  const osm = JSON.parse(fs.readFileSync(args[0], 'utf8'));
  console.error('[merge] reading GSI directory: ' + args[1]);
  const result = mergeGsiIntoOsm(osm, args[1]);
  console.error('[merge] DONE: replaced=' + result.replaced + ' kept=' + result.kept);
  console.error(
    '[merge] coverage rate: ' +
      ((result.replaced * 100) / Math.max(1, result.replaced + result.kept)).toFixed(1) +
      '%'
  );
  process.stdout.write(JSON.stringify(result.featureCollection));
}

if (require.main === module) main();
module.exports = { mergeGsiIntoOsm };
