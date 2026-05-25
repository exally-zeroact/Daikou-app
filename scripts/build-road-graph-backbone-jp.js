#!/usr/bin/env node
// ============================================================
// scripts/build-road-graph-backbone-jp.js
//
// Phase B: 全国 motorway / trunk / primary（および _link 系）のみで
// 構成された軽量バックボーン road-graph を生成する。
// 県跨ぎ routing 用・サイズ目標 5〜10MB・常時 RAM 常駐。
//
// 入力: data/roads-{pref}.js 全 47 県（v6 形式）
// 出力: data/road-graph-backbone-jp.js
//   形式: window.ROAD_GRAPH_BACKBONE_JP = { v:1, ..., *B64 fields }
//
// 含める road タイプ（5〜10MB 目標で絞り込み）:
//   0=motorway, 1=trunk, 7=motorway_link, 8=trunk_link
// （primary を含めると 31MB 級になり常駐コストが過大）
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PREFECTURES = [
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

// C7 (2026-05-09): primary を追加して県跨ぎ精度を向上
//   typeCode: 0=motorway, 1=trunk, 2=primary, 7=motorway_link, 8=trunk_link, 9=primary_link
const BACKBONE_TYPES = new Set([0, 1, 2, 7, 8, 9]);
const OUT_PATH = path.join(__dirname, '..', 'data', 'road-graph-backbone-jp.js');

// 軽量デコーダー（依存ゼロ）
function readVarint(bytes, offset) {
  let result = 0,
    shift = 0;
  while (true) {
    const b = bytes[offset++];
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return [result >>> 0, offset];
}
function zigzagDecode(n) {
  return (n >>> 1) ^ -(n & 1);
}
function readSignedVarint(bytes, offset) {
  const r = readVarint(bytes, offset);
  return [zigzagDecode(r[0]), r[1]];
}
function haversineM(lat1, lng1, lat2, lng2) {
  if (lat1 === lat2 && lng1 === lng2) return 0;
  const R = 6371000,
    tr = Math.PI / 180;
  const dLat = (lat2 - lat1) * tr;
  const dLng = (lng2 - lng1) * tr;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * tr) * Math.cos(lat2 * tr) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── 全 47 県を順次処理してノード/エッジを集約 ─────────────────
const tStart = Date.now();
console.log('[backbone] 47 県の motorway/trunk/primary を抽出中...');

const nodeMap = new Map(); // "lat_lng" → globalNodeId
const nodeLatList = [];
const nodeLngList = [];
const edges = []; // { from, to, lenM, flags }

function getNodeId(latInt, lngInt) {
  const key = latInt + '_' + lngInt;
  let id = nodeMap.get(key);
  if (id === undefined) {
    id = nodeLatList.length;
    nodeMap.set(key, id);
    nodeLatList.push(latInt);
    nodeLngList.push(lngInt);
  }
  return id;
}

let prefsProcessed = 0;
let oversizedCount = 0;
const EDGE_LEN_QUANT_MAX = 65535;

for (const pref of PREFECTURES) {
  const roadsPath = path.join(__dirname, '..', 'data', `roads-${pref}.js`);
  if (!fs.existsSync(roadsPath)) {
    console.warn(`[backbone] skip ${pref} (file not found)`);
    continue;
  }
  const code = fs.readFileSync(roadsPath, 'utf8');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: roadsPath, timeout: 30000 });
  const VAR = 'ROADS_' + pref.toUpperCase().replace(/-/g, '_');
  const roads = ctx.window[VAR];
  if (!roads || roads.v < 6) {
    console.warn(`[backbone] skip ${pref} (v=${roads && roads.v})`);
    continue;
  }
  const bytes = Uint8Array.from(Buffer.from(roads.roadsB64, 'base64'));
  const precision = roads.precision || 1e5;
  const headerSize = 2; // v6

  let offset = 0;
  let kept = 0;
  for (let r = 0; r < roads.numRoads; r++) {
    const bits = bytes[offset] | (bytes[offset + 1] << 8);
    const typeCode = bits & 0x0f;
    const oneway = (bits >> 4) & 0x01;
    const layer = (bits >> 12) & 0x03;
    offset += headerSize;

    let numPoints;
    [numPoints, offset] = readVarint(bytes, offset);
    let lat, lng;
    [lat, offset] = readSignedVarint(bytes, offset);
    [lng, offset] = readSignedVarint(bytes, offset);

    // backbone タイプでなければ skip（ただしポリラインは offset 更新のため最後まで読む）
    const isBackbone = BACKBONE_TYPES.has(typeCode);

    let prevNode = isBackbone ? getNodeId(lat, lng) : -1;
    for (let i = 1; i < numPoints; i++) {
      let dLat, dLng;
      [dLat, offset] = readSignedVarint(bytes, offset);
      [dLng, offset] = readSignedVarint(bytes, offset);
      lat += dLat;
      lng += dLng;
      if (!isBackbone) continue;
      const currNode = getNodeId(lat, lng);
      if (prevNode === currNode) {
        prevNode = currNode;
        continue;
      }
      const lenM = haversineM(
        nodeLatList[prevNode] / precision,
        nodeLngList[prevNode] / precision,
        nodeLatList[currNode] / precision,
        nodeLngList[currNode] / precision
      );
      if (lenM > 6500) oversizedCount++;
      let flags = 0;
      if (oneway) flags |= 0x01;
      if (layer === 1) flags |= 0x04;
      if (layer === 2) flags |= 0x08;
      edges.push({ from: prevNode, to: currNode, lenM, flags });
      if (!oneway) {
        edges.push({ from: currNode, to: prevNode, lenM, flags: flags & ~0x01 });
      }
      prevNode = currNode;
    }
    if (isBackbone) kept++;
  }
  prefsProcessed++;
  process.stdout.write(
    `  ${pref}: ${kept} backbone roads・累計 nodes=${nodeLatList.length} edges=${edges.length}\r\n`
  );
}

const numNodes = nodeLatList.length;
const numEdges = edges.length;
console.log(
  `[backbone] 集約完了: prefs=${prefsProcessed}/47 nodes=${numNodes} edges=${numEdges} oversized=${oversizedCount}`
);

// ─── CSR 構築 ─────────────────────────────────────────────────
edges.sort(function (a, b) {
  if (a.from !== b.from) return a.from - b.from;
  return a.to - b.to;
});

const nodeLatArr = new Int32Array(numNodes);
const nodeLngArr = new Int32Array(numNodes);
for (let i = 0; i < numNodes; i++) {
  nodeLatArr[i] = nodeLatList[i];
  nodeLngArr[i] = nodeLngList[i];
}
const nodeOffset = new Uint32Array(numNodes + 1);
const edgeTo = new Uint32Array(numEdges);
const edgeLenM = new Uint16Array(numEdges); // Phase A: ×0.1m
const edgeFlags = new Uint8Array(numEdges);

let curNode = 0;
for (let i = 0; i < numEdges; i++) {
  const e = edges[i];
  while (curNode <= e.from) nodeOffset[curNode++] = i;
  edgeTo[i] = e.to;
  const quant = Math.round(e.lenM * 10);
  edgeLenM[i] = quant > EDGE_LEN_QUANT_MAX ? EDGE_LEN_QUANT_MAX : quant;
  edgeFlags[i] = e.flags;
}
while (curNode <= numNodes) nodeOffset[curNode++] = numEdges;

console.log(`[backbone] CSR done`);

// ─── 出力 ─────────────────────────────────────────────────────
function tabToB64(arr) {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
}

const precision = 100000;
const output = {
  v: 1,
  source: 'backbone-jp (motorway/trunk/primary 全 47 県)',
  generated: new Date().toISOString(),
  precision: precision,
  edgeLenScale: 0.1,
  numNodes: numNodes,
  numEdges: numEdges,
  numShortcuts: 0, // backbone は CH なし
  oversizedSegments: oversizedCount,
  prefsProcessed: prefsProcessed,
  // CSR
  nodeLatB64: tabToB64(nodeLatArr),
  nodeLngB64: tabToB64(nodeLngArr),
  nodeOffsetB64: tabToB64(nodeOffset),
  edgeToB64: tabToB64(edgeTo),
  edgeLenMB64: tabToB64(edgeLenM),
  edgeFlagsB64: tabToB64(edgeFlags),
};

const fileContent =
  `// Auto-generated by scripts/build-road-graph-backbone-jp.js\n` +
  `// 全国 motorway/trunk/primary バックボーン road-graph (Phase B)\n` +
  `// 県跨ぎ routing 用・常時 RAM 常駐想定（5〜10MB）\n` +
  `// edgeLenM is Uint16 × 0.1m\n` +
  `// 県別 road-graph-{pref}.js とは独立\n` +
  `window.ROAD_GRAPH_BACKBONE_JP = ${JSON.stringify(output)};\n`;

fs.writeFileSync(OUT_PATH, fileContent);
const sizeMB = (fs.statSync(OUT_PATH).size / 1024 / 1024).toFixed(2);
console.log(`[backbone] written ${OUT_PATH} (${sizeMB} MB)`);
console.log(`[backbone] DONE total=${((Date.now() - tStart) / 1000).toFixed(1)}s`);
