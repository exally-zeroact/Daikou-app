#!/usr/bin/env node
// ============================================================
// scripts/build-road-graph.js
//
// data/roads-{pref}.js から MM-4b 用 CSR road-graph を生成する。
// ノード = 道路ポリラインの全頂点（座標一致でデデュプ＝交差点で結合）。
// エッジ = ポリラインのセグメント。bidirectional は逆向きも追加。
// CH（Contraction Hierarchies）は次数 ≤ 4 のノードを次数昇順で contract する
// 簡易版を採用（正確だが witness search 省略のため shortcut が冗長傾向）。
//
// Usage: node scripts/build-road-graph.js <pref>
//
// Output (v2 / Phase A):
//   data/road-graph-{pref}.js          : main graph
//   data/road-graph-{pref}-extras.js   : shortcutMidNode（lazy load 用・非必須）
//
//   形式: window.ROAD_GRAPH_{PREF} = { v:2, prefecture, ..., *B64 fields }
//   全 TypedArray は ArrayBuffer を base64 化して埋め込み（little-endian 前提）
//
// Phase A 圧縮（2026-05-08）:
//   - edgeLenM : Float32 → Uint16 ×0.1m 量子化（max 6553.5m）
//   - 6500m 超 segment を WARNING 出力（実機データ稀・閾値クランプで処理続行）
//   - roadOffset / roadSegFromNode / roadSegToNode 新出力
//     → runtime の roadSegToEdge Map（40MB）を compile-time index（4MB）に置換
//   - edgeRoad / edgeSeg を runtime からドロップ（roadSeg* で代替）
//   - nodeLevel を出力しない（MM-4b で未使用）
//   - shortcutMidNode は extras ファイルへ分離（lazy load 想定）
//   - shortcutEdgeLenM は Float32 維持（連続 contraction で 5km+ shortcut あり得るため）
//
// メモリ削減目標: Worker B RAM 85MB → 約 40MB
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PREF = process.argv[2];
if (!PREF) {
  console.error('Usage: node build-road-graph.js <pref>');
  process.exit(1);
}

const ROADS_PATH = path.join(__dirname, '..', 'data', `roads-${PREF}.js`);
const OUT_PATH   = path.join(__dirname, '..', 'data', `road-graph-${PREF}.js`);

if (!fs.existsSync(ROADS_PATH)) {
  console.error(`[${PREF}] not found: ${ROADS_PATH}`);
  process.exit(1);
}

console.log(`[${PREF}] loading ${ROADS_PATH}...`);
const tStart = Date.now();
const code = fs.readFileSync(ROADS_PATH, 'utf8');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx, { filename: ROADS_PATH, timeout: 30000 });
const VAR = 'ROADS_' + PREF.toUpperCase().replace(/-/g, '_');
const roadsData = ctx.window[VAR];
if (!roadsData) {
  console.error(`[${PREF}] global ${VAR} not set in roads file`);
  process.exit(1);
}
console.log(`[${PREF}] roads v=${roadsData.v}, numRoads=${roadsData.numRoads}`);

// ── 軽量デコーダー（roads-decoder.js と同じ仕様・依存ゼロのため再実装） ──
function readVarint(bytes, offset) {
  let result = 0, shift = 0;
  while (true) {
    const b = bytes[offset++];
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return [result >>> 0, offset];
}
function zigzagDecode(n) { return (n >>> 1) ^ -(n & 1); }
function readSignedVarint(bytes, offset) {
  const r = readVarint(bytes, offset);
  return [zigzagDecode(r[0]), r[1]];
}
function haversineM(lat1, lng1, lat2, lng2) {
  if (lat1 === lat2 && lng1 === lng2) return 0;
  const R = 6371000, tr = Math.PI / 180;
  const dLat = (lat2 - lat1) * tr;
  const dLng = (lng2 - lng1) * tr;
  const a = Math.sin(dLat/2) ** 2
          + Math.cos(lat1*tr) * Math.cos(lat2*tr) * Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const bytes = Uint8Array.from(Buffer.from(roadsData.roadsB64, 'base64'));
const precision = roadsData.precision || 1e5;
const headerSize = roadsData.v >= 6 ? 2 : 1;

// ── Pass 1: ノード列挙 + エッジ生成 ────────────────────────────
console.log(`[${PREF}] decoding roads + building edges...`);
const tDecode = Date.now();

const nodeMap = new Map();    // "lat_lng" → nodeId
const nodeLatList = [];       // index = nodeId → lat ×precision
const nodeLngList = [];

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

const edges = [];   // {from, to, lenM, flags, road, seg}
let offset = 0;

// Phase A: per-road segment index（roadOffset / roadSegFromNode / roadSegToNode）
// 各 road の polyline segment ごとに from-node / to-node を記録（self-loop は from==to）
// snap.roadIndex × snap.segmentIndex → graph node を O(1) で引けるようにする
const roadOffsetArr = new Uint32Array(roadsData.numRoads + 1);
const roadSegFromNodeBuf = [];   // 後で Uint32Array に変換
const roadSegToNodeBuf   = [];
let segPos = 0;

// Phase A: 6500m 超 segment（Uint16 ×0.1m の表現範囲超）の検出と統計
let oversizedCount = 0;
let maxSegmentLen = 0;
const OVERSIZED_THRESHOLD_M = 6500;
const EDGE_LEN_QUANT_MAX    = 65535;   // Uint16 max（×0.1m で 6553.5m）

for (let roadIdx = 0; roadIdx < roadsData.numRoads; roadIdx++) {
  roadOffsetArr[roadIdx] = segPos;
  let typeCode = 0, oneway = 0, layer = 0;
  if (headerSize === 2) {
    const bits = bytes[offset] | (bytes[offset + 1] << 8);
    typeCode = bits & 0x0F;
    oneway   = (bits >> 4) & 0x01;
    layer    = (bits >> 12) & 0x03;     // 0=平面 1=高架 2=地下 3=その他
  } else {
    typeCode = bytes[offset];
  }
  offset += headerSize;

  let numPoints;
  [numPoints, offset] = readVarint(bytes, offset);
  let lat, lng;
  [lat, offset] = readSignedVarint(bytes, offset);
  [lng, offset] = readSignedVarint(bytes, offset);

  let prevNode = getNodeId(lat, lng);
  for (let i = 1; i < numPoints; i++) {
    let dLat, dLng;
    [dLat, offset] = readSignedVarint(bytes, offset);
    [dLng, offset] = readSignedVarint(bytes, offset);
    lat += dLat;
    lng += dLng;
    const currNode = getNodeId(lat, lng);

    // Phase A: roadSegFromNode/ToNode は self-loop も含めて全 segment を記録
    // （snap.segmentIndex は roads-decoder.js 側の polyline 通し番号と整合させる必要あり）
    roadSegFromNodeBuf.push(prevNode);
    roadSegToNodeBuf.push(currNode);
    segPos++;

    // セルフループは edge 生成スキップ（同座標連続点の保険）
    if (prevNode === currNode) {
      prevNode = currNode;
      continue;
    }

    const lenM = haversineM(
      nodeLatList[prevNode] / precision, nodeLngList[prevNode] / precision,
      nodeLatList[currNode] / precision, nodeLngList[currNode] / precision
    );

    // Phase A: 6500m 超を統計収集（量子化で頭打ちになる稀ケース）
    if (lenM > maxSegmentLen) maxSegmentLen = lenM;
    if (lenM > OVERSIZED_THRESHOLD_M) {
      oversizedCount++;
      if (oversizedCount <= 5) {
        console.warn(`  [WARN] segment > ${OVERSIZED_THRESHOLD_M}m: road=${roadIdx} seg=${i - 1} len=${lenM.toFixed(1)}m → 6553.5m にクランプ`);
      }
    }

    // bit0=oneway forward only / bit2=bridge / bit3=tunnel
    let flags = 0;
    if (oneway)       flags |= 0x01;
    if (layer === 1)  flags |= 0x04;
    if (layer === 2)  flags |= 0x08;

    edges.push({
      from: prevNode, to: currNode,
      lenM: lenM, flags: flags,
      road: roadIdx, seg: i - 1,
    });

    if (!oneway) {
      // 双方向道路: 逆向きエッジも追加
      // 逆向きは oneway フラグなし・bridge/tunnel は維持
      const revFlags = flags & ~0x01;
      edges.push({
        from: currNode, to: prevNode,
        lenM: lenM, flags: revFlags,
        road: roadIdx, seg: i - 1,
      });
    }

    prevNode = currNode;
  }

  if ((roadIdx & 0x3FFF) === 0 && roadIdx > 0) {
    process.stdout.write(`  decode ${roadIdx}/${roadsData.numRoads}\r`);
  }
}

// Phase A: roadOffset の最終要素（番兵）
roadOffsetArr[roadsData.numRoads] = segPos;
const roadSegFromNodeArr = Uint32Array.from(roadSegFromNodeBuf);
const roadSegToNodeArr   = Uint32Array.from(roadSegToNodeBuf);

const numNodes = nodeLatList.length;
const numEdges = edges.length;
const numRoadSegs = segPos;
console.log(`[${PREF}] decoded: nodes=${numNodes} edges=${numEdges} roadSegs=${numRoadSegs} (${((Date.now() - tDecode) / 1000).toFixed(1)}s)`);
if (oversizedCount > 0) {
  console.warn(`[${PREF}] WARN: ${oversizedCount} segments > ${OVERSIZED_THRESHOLD_M}m (max=${maxSegmentLen.toFixed(1)}m)・Uint16 でクランプ済`);
}

// ── Pass 2: CSR 構築 ─────────────────────────────────────────
console.log(`[${PREF}] building CSR...`);
const tCsr = Date.now();

edges.sort(function (a, b) {
  if (a.from !== b.from) return a.from - b.from;
  return a.to - b.to;
});

const nodeLatArr  = new Int32Array(numNodes);
const nodeLngArr  = new Int32Array(numNodes);
for (let i = 0; i < numNodes; i++) {
  nodeLatArr[i] = nodeLatList[i];
  nodeLngArr[i] = nodeLngList[i];
}
const nodeOffset  = new Uint32Array(numNodes + 1);
const edgeTo      = new Uint32Array(numEdges);
// Phase A: edgeLenM は Uint16 ×0.1m（最大 6553.5m・超えるものはクランプ）
const edgeLenM    = new Uint16Array(numEdges);
const edgeFlags   = new Uint8Array(numEdges);
// Phase A: edgeRoad / edgeSeg は runtime からドロップ（roadSeg* で代替）

let curNode = 0;
for (let i = 0; i < numEdges; i++) {
  const e = edges[i];
  while (curNode <= e.from) nodeOffset[curNode++] = i;
  edgeTo[i]     = e.to;
  // Phase A: 0.1m 単位で量子化・上限 65535 (= 6553.5m) でクランプ
  const quant = Math.round(e.lenM * 10);
  edgeLenM[i]   = quant > EDGE_LEN_QUANT_MAX ? EDGE_LEN_QUANT_MAX : quant;
  edgeFlags[i]  = e.flags;
}
while (curNode <= numNodes) nodeOffset[curNode++] = numEdges;

console.log(`[${PREF}] CSR done (${((Date.now() - tCsr) / 1000).toFixed(1)}s)`);

// ── Pass 3: CH 簡易ビルド（次数 ≤ 4 を次数昇順 contract） ────
console.log(`[${PREF}] building CH (simplified deg≤4 contraction)...`);
const tCh = Date.now();

// active set 用の隣接リスト（contract 中に動的更新するので Array<{...}>）
const inAdj  = new Array(numNodes);
const outAdj = new Array(numNodes);
for (let v = 0; v < numNodes; v++) {
  inAdj[v]  = [];
  outAdj[v] = [];
}
for (let v = 0; v < numNodes; v++) {
  const start = nodeOffset[v], end = nodeOffset[v + 1];
  for (let k = start; k < end; k++) {
    const w = edgeTo[k];
    // Phase A: edgeLenM は Uint16 ×0.1m なので CH 中の lenM は実距離 (m) に戻す
    const lenM_real = edgeLenM[k] * 0.1;
    outAdj[v].push({ to: w, lenM: lenM_real, flags: edgeFlags[k] });
    inAdj[w].push({ from: v, lenM: lenM_real, flags: edgeFlags[k] });
  }
}

// 初期次数で昇順ソートした contract 順
const order = new Array(numNodes);
for (let v = 0; v < numNodes; v++) order[v] = v;
order.sort(function (a, b) {
  return (inAdj[a].length + outAdj[a].length) - (inAdj[b].length + outAdj[b].length);
});

const nodeLevel  = new Uint16Array(numNodes);
const shortcuts  = [];
const MAX_DEG    = 4;
let contractedCount = 0;
let skippedHighDeg = 0;

for (let i = 0; i < order.length; i++) {
  const v = order[i];
  nodeLevel[v] = i < 65535 ? i : 65535;

  const ins  = inAdj[v];
  const outs = outAdj[v];
  if (ins.length + outs.length > MAX_DEG) { skippedHighDeg++; continue; }
  if (ins.length === 0 || outs.length === 0) {
    // 端点 / 孤立ノード: contract せず（shortcut 生成不要）
    inAdj[v]  = null;
    outAdj[v] = null;
    contractedCount++;
    continue;
  }

  // 全 (u, v, w) ペアでショートカット作成
  for (let a = 0; a < ins.length; a++) {
    for (let b = 0; b < outs.length; b++) {
      const u = ins[a].from;
      const w = outs[b].to;
      if (u === w || u === v || w === v) continue;  // セルフ除外
      // 防御: u or w が既に contract 済（重複 entry の名残等）ならスキップ
      // （contracted ノードへの shortcut は routing 上意味がない）
      if (!outAdj[u] || !inAdj[w]) continue;
      const sc = {
        from:  u,
        to:    w,
        lenM:  ins[a].lenM + outs[b].lenM,
        flags: ins[a].flags | outs[b].flags,
        mid:   v,
      };
      shortcuts.push(sc);
      // active 隣接リスト更新（後続 contract で再利用される）
      outAdj[u].push({ to: w, lenM: sc.lenM, flags: sc.flags });
      inAdj[w].push({ from: u, lenM: sc.lenM, flags: sc.flags });
    }
  }

  // v を隣接ノードの active 集合から除去
  for (let a = 0; a < ins.length; a++) {
    const list = outAdj[ins[a].from];
    if (!list) continue;
    for (let j = list.length - 1; j >= 0; j--) {
      if (list[j].to === v) list.splice(j, 1);
    }
  }
  for (let b = 0; b < outs.length; b++) {
    const list = inAdj[outs[b].to];
    if (!list) continue;
    for (let j = list.length - 1; j >= 0; j--) {
      if (list[j].from === v) list.splice(j, 1);
    }
  }
  inAdj[v]  = null;
  outAdj[v] = null;
  contractedCount++;

  if ((i & 0xFFFF) === 0 && i > 0) {
    process.stdout.write(`  CH ${i}/${order.length} sc=${shortcuts.length}\r`);
  }
}

const numShortcuts = shortcuts.length;
console.log(`[${PREF}] CH done: contracted=${contractedCount} skippedHighDeg=${skippedHighDeg} shortcuts=${numShortcuts} (${((Date.now() - tCh) / 1000).toFixed(1)}s)`);

// ── Pass 4: shortcut を TypedArray にパック ───────────────────
const shortcutEdgeFrom  = new Uint32Array(numShortcuts);
const shortcutEdgeTo    = new Uint32Array(numShortcuts);
const shortcutEdgeLenM  = new Float32Array(numShortcuts);
const shortcutEdgeFlags = new Uint8Array(numShortcuts);
const shortcutMidNode   = new Uint32Array(numShortcuts);
for (let i = 0; i < numShortcuts; i++) {
  shortcutEdgeFrom[i]  = shortcuts[i].from;
  shortcutEdgeTo[i]    = shortcuts[i].to;
  shortcutEdgeLenM[i]  = shortcuts[i].lenM;
  shortcutEdgeFlags[i] = shortcuts[i].flags;
  shortcutMidNode[i]   = shortcuts[i].mid;
}

// ── Pass 5: ファイル書き出し ──────────────────────────────────
function tabToB64(arr) {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
}

const output = {
  v: 2,                          // Phase A 圧縮形式
  prefecture: PREF,
  generated: new Date().toISOString(),
  source: `roads-${PREF}.js v${roadsData.v}`,
  precision: precision,
  numNodes: numNodes,
  numEdges: numEdges,
  // Phase A: Uint16 量子化情報
  edgeLenScale: 0.1,             // edgeLenM[k] × edgeLenScale = 実距離 (m)
  oversizedSegments: oversizedCount,
  maxSegmentLenM: maxSegmentLen,
  // Phase A: roadSeg index 用
  numRoads: roadsData.numRoads,
  numRoadSegs: numRoadSegs,
  numShortcuts: numShortcuts,
  // ノード座標（×precision 整数）
  nodeLatB64: tabToB64(nodeLatArr),
  nodeLngB64: tabToB64(nodeLngArr),
  // CSR forward graph (Phase A: edgeLenM Uint16 × 0.1m / edgeRoad/Seg ドロップ)
  nodeOffsetB64: tabToB64(nodeOffset),
  edgeToB64: tabToB64(edgeTo),
  edgeLenMB64: tabToB64(edgeLenM),
  edgeFlagsB64: tabToB64(edgeFlags),
  // Phase A: roadSeg compile-time index（runtime Map 廃止用）
  roadOffsetB64: tabToB64(roadOffsetArr),
  roadSegFromNodeB64: tabToB64(roadSegFromNodeArr),
  roadSegToNodeB64: tabToB64(roadSegToNodeArr),
  // CH (Phase A: nodeLevel ドロップ・shortcutMidNode は extras に分離)
  shortcutEdgeFromB64: tabToB64(shortcutEdgeFrom),
  shortcutEdgeToB64: tabToB64(shortcutEdgeTo),
  shortcutEdgeLenMB64: tabToB64(shortcutEdgeLenM),
  shortcutEdgeFlagsB64: tabToB64(shortcutEdgeFlags),
};

const VAR_NAME = 'ROAD_GRAPH_' + PREF.toUpperCase().replace(/-/g, '_');
const fileContent =
  `// Auto-generated by scripts/build-road-graph.js\n` +
  `// Source: data/roads-${PREF}.js (v${roadsData.v})\n` +
  `// Generated: ${output.generated}\n` +
  `// Format v2 (Phase A): CSR + simplified CH (deg≤4 contraction)\n` +
  `//   nodeOffset[v..v+1] gives forward edge slice in edgeTo/edgeLenM(×0.1m)/edgeFlags\n` +
  `//   roadOffset[r..r+1] gives polyline segment slice in roadSegFromNode/ToNode\n` +
  `//   shortcutEdge* arrays = bypass edges added by CH for fast routing\n` +
  `//   edgeFlags bit0=oneway-forward bit2=bridge bit3=tunnel\n` +
  `//   edgeLenM is Uint16 × 0.1m (max 6553.5m・oversized=${oversizedCount})\n` +
  `//   shortcutMidNode is in road-graph-${PREF}-extras.js (lazy load)\n` +
  `//   TypedArrays are little-endian base64 (browsers + Node on x86/ARM64)\n` +
  `window.${VAR_NAME} = ${JSON.stringify(output)};\n`;

fs.writeFileSync(OUT_PATH, fileContent);
const stat = fs.statSync(OUT_PATH);
const sizeMB = (stat.size / 1024 / 1024).toFixed(2);

// Phase A: shortcutMidNode を別ファイルに分離（lazy load 用）
const EXTRAS_PATH = path.join(__dirname, '..', 'data', `road-graph-${PREF}-extras.js`);
const extrasOutput = {
  v: 2,
  prefecture: PREF,
  generated: output.generated,
  numShortcuts: numShortcuts,
  shortcutMidNodeB64: tabToB64(shortcutMidNode),
};
const EXTRAS_VAR = VAR_NAME + '_EXTRAS';
const extrasContent =
  `// Auto-generated by scripts/build-road-graph.js (Phase A extras)\n` +
  `// shortcutMidNode（経路復元用・MM-4b では未使用・MM-7+ で lazy load 想定）\n` +
  `window.${EXTRAS_VAR} = ${JSON.stringify(extrasOutput)};\n`;
fs.writeFileSync(EXTRAS_PATH, extrasContent);
const extrasSizeMB = (fs.statSync(EXTRAS_PATH).size / 1024 / 1024).toFixed(2);

console.log(`[${PREF}] written ${OUT_PATH} (${sizeMB} MB)`);
console.log(`[${PREF}] written ${EXTRAS_PATH} (${extrasSizeMB} MB extras)`);
console.log(`[${PREF}] DONE total=${((Date.now() - tStart) / 1000).toFixed(1)}s`);
console.log(`[${PREF}] SUMMARY nodes=${numNodes} edges=${numEdges} roadSegs=${numRoadSegs} shortcuts=${numShortcuts} main=${sizeMB}MB extras=${extrasSizeMB}MB`);
