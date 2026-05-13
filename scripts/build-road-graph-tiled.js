#!/usr/bin/env node
// ============================================================
// scripts/build-road-graph-tiled.js
//
// Phase B: 1 県の road-graph を 5km × 5km タイルに分割して出力する。
// runtime（map-matcher.js TileCache）が必要なタイルのみ動的ロードする想定。
//
// Usage:
//   node scripts/build-road-graph-tiled.js <pref> [--tile-deg 0.05]
//
// 出力:
//   data/road-graph-tiles/{pref}/index.json    タイル一覧 + bbox
//   data/road-graph-tiles/{pref}/{tx}_{ty}.js  タイル本体（window.ROAD_GRAPH_TILE_{PREF}_{tx}_{ty}）
//
// 各タイル:
//   - 内部 nodes（タイル bbox 内の全ノード）
//   - 内部 edges（両端が tile 内 or 片端のみ tile 内）
//   - border nodes（隣接タイルへの edge を持つノード・global nodeId 参照）
//
// 注: 本実装は Phase B 基盤・runtime 統合は後続コミットで対応
// ============================================================

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PREF = process.argv[2];
if(!PREF){
  console.error('Usage: node build-road-graph-tiled.js <pref> [--tile-deg 0.05]');
  process.exit(1);
}

let TILE_DEG = 0.05;   // 既定 0.05° ≈ 5km
for(let i = 3; i < process.argv.length; i++){
  if(process.argv[i] === '--tile-deg' && process.argv[i+1]){
    TILE_DEG = parseFloat(process.argv[i+1]);
  }
}

const ROADS_PATH = path.join(__dirname, '..', 'data', `roads-${PREF}.js`);
const OUT_DIR = path.join(__dirname, '..', 'data', 'road-graph-tiles', PREF);

if(!fs.existsSync(ROADS_PATH)){
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
const roads = ctx.window[VAR];
if(!roads){
  console.error(`[${PREF}] ${VAR} not set`);
  process.exit(1);
}
console.log(`[${PREF}] roads v=${roads.v} numRoads=${roads.numRoads} tile-deg=${TILE_DEG}`);

// ─── デコーダー ─────────────────────────────────────────────────
function readVarint(b, o){
  let r = 0, s = 0;
  while(true){ const v = b[o++]; r |= (v & 0x7f) << s; if((v & 0x80) === 0) break; s += 7; }
  return [r >>> 0, o];
}
function zz(n){ return (n >>> 1) ^ -(n & 1); }
function readSV(b, o){ const r = readVarint(b, o); return [zz(r[0]), r[1]]; }
function haversineM(lat1, lng1, lat2, lng2){
  if(lat1 === lat2 && lng1 === lng2) return 0;
  const R = 6371000, tr = Math.PI / 180;
  const dLat = (lat2 - lat1) * tr;
  const dLng = (lng2 - lng1) * tr;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*tr) * Math.cos(lat2*tr) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const bytes = Uint8Array.from(Buffer.from(roads.roadsB64, 'base64'));
const precision = roads.precision || 1e5;
const headerSize = roads.v >= 6 ? 2 : 1;

// ─── Pass 1: 全 road の polyline と tile 集合を抽出 ─────────────
console.log(`[${PREF}] decoding roads...`);
const tDec = Date.now();

const allRoads = [];   // {typeCode, oneway, layer, points:[[lat,lng]...]}
let offset = 0;

for(let r = 0; r < roads.numRoads; r++){
  let typeCode = 0, oneway = 0, layer = 0;
  if(headerSize === 2){
    const bits = bytes[offset] | (bytes[offset+1] << 8);
    typeCode = bits & 0x0F;
    oneway = (bits >> 4) & 0x01;
    layer = (bits >> 12) & 0x03;
  } else {
    typeCode = bytes[offset];
  }
  offset += headerSize;
  let np;
  [np, offset] = readVarint(bytes, offset);
  let lat, lng;
  [lat, offset] = readSV(bytes, offset);
  [lng, offset] = readSV(bytes, offset);
  const points = [[lat, lng]];
  for(let i = 1; i < np; i++){
    let dLat, dLng;
    [dLat, offset] = readSV(bytes, offset);
    [dLng, offset] = readSV(bytes, offset);
    lat += dLat;
    lng += dLng;
    points.push([lat, lng]);
  }
  allRoads.push({ typeCode, oneway, layer, points });
}
console.log(`[${PREF}] decoded ${allRoads.length} roads (${((Date.now() - tDec) / 1000).toFixed(1)}s)`);

// ─── Pass 2: ノード列挙 + tile 割付 ───────────────────────────────
console.log(`[${PREF}] tiling...`);
const nodeMap = new Map();   // "lat_lng" → { id, tx, ty }
const nodeArr = [];          // index = id → {latI, lngI, tx, ty}

function tileOf(latI, lngI){
  const lat = latI / precision;
  const lng = lngI / precision;
  return [Math.floor(lat / TILE_DEG), Math.floor(lng / TILE_DEG)];
}

function getNode(latI, lngI){
  const k = latI + '_' + lngI;
  let n = nodeMap.get(k);
  if(!n){
    const [tx, ty] = tileOf(latI, lngI);
    n = { id: nodeArr.length, tx: tx, ty: ty };
    nodeMap.set(k, n);
    nodeArr.push({ latI, lngI, tx, ty });
  }
  return n;
}

// road 単位で edge 列挙・tile ごとに振り分け
// tileEdges[`tx_ty`] = [{ from, to, lenM, flags, road, seg, fromTile, toTile }]
const tileEdges = new Map();
const tileBorderNodes = new Map();   // tileKey → Set<nodeId>

function pushTileEdge(tx, ty, e){
  const k = tx + '_' + ty;
  if(!tileEdges.has(k)) tileEdges.set(k, []);
  tileEdges.get(k).push(e);
}
function markBorderNode(tx, ty, nodeId){
  const k = tx + '_' + ty;
  if(!tileBorderNodes.has(k)) tileBorderNodes.set(k, new Set());
  tileBorderNodes.get(k).add(nodeId);
}

let oversized = 0;
const EDGE_LEN_QUANT_MAX = 65535;

for(let r = 0; r < allRoads.length; r++){
  const road = allRoads[r];
  const { typeCode, oneway, layer, points } = road;
  let prev = getNode(points[0][0], points[0][1]);
  for(let i = 1; i < points.length; i++){
    const curr = getNode(points[i][0], points[i][1]);
    if(prev.id === curr.id){ prev = curr; continue; }
    const lenM = haversineM(
      nodeArr[prev.id].latI / precision, nodeArr[prev.id].lngI / precision,
      nodeArr[curr.id].latI / precision, nodeArr[curr.id].lngI / precision
    );
    if(lenM > 6500) oversized++;
    let flags = 0;
    if(oneway) flags |= 0x01;
    if(layer === 1) flags |= 0x04;
    if(layer === 2) flags |= 0x08;

    const e = { from: prev.id, to: curr.id, lenM, flags, road: r, seg: i - 1,
                fromTx: prev.tx, fromTy: prev.ty, toTx: curr.tx, toTy: curr.ty };
    // 同 tile → 該当 tile に追加
    // 跨ぎ → 両 tile に追加（border node マーク）
    pushTileEdge(prev.tx, prev.ty, e);
    if(prev.tx !== curr.tx || prev.ty !== curr.ty){
      pushTileEdge(curr.tx, curr.ty, e);
      markBorderNode(prev.tx, prev.ty, curr.id);
      markBorderNode(curr.tx, curr.ty, prev.id);
    }
    if(!oneway){
      const re = { from: curr.id, to: prev.id, lenM, flags: flags & ~0x01, road: r, seg: i - 1,
                   fromTx: curr.tx, fromTy: curr.ty, toTx: prev.tx, toTy: prev.ty };
      pushTileEdge(curr.tx, curr.ty, re);
      if(prev.tx !== curr.tx || prev.ty !== curr.ty){
        pushTileEdge(prev.tx, prev.ty, re);
      }
    }
    prev = curr;
  }
}

const numTiles = tileEdges.size;
console.log(`[${PREF}] tiles=${numTiles} nodes=${nodeArr.length} oversized=${oversized}`);

// ─── Pass 3: 各タイルを書き出し ─────────────────────────────────
if(!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function tabToB64(arr){
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
}

const tileIndex = [];
let totalSize = 0;

for(const [tileKey, edges] of tileEdges){
  // タイル内 / 跨ぎ含めたノード集合を抽出
  const nodeSet = new Set();
  for(const e of edges){ nodeSet.add(e.from); nodeSet.add(e.to); }
  const localNodeIds = Array.from(nodeSet).sort(function(a, b){ return a - b; });
  const localIdMap = new Map();   // global → local
  for(let i = 0; i < localNodeIds.length; i++){
    localIdMap.set(localNodeIds[i], i);
  }
  const N = localNodeIds.length;
  const E = edges.length;

  const localLat = new Int32Array(N);
  const localLng = new Int32Array(N);
  const globalIds = new Uint32Array(N);
  for(let i = 0; i < N; i++){
    const gid = localNodeIds[i];
    localLat[i] = nodeArr[gid].latI;
    localLng[i] = nodeArr[gid].lngI;
    globalIds[i] = gid;
  }

  // CSR for this tile
  edges.sort(function(a, b){
    const fa = localIdMap.get(a.from), fb = localIdMap.get(b.from);
    if(fa !== fb) return fa - fb;
    return localIdMap.get(a.to) - localIdMap.get(b.to);
  });
  const nodeOffset = new Uint32Array(N + 1);
  const edgeTo = new Uint32Array(E);
  const edgeLenM = new Uint16Array(E);
  const edgeFlags = new Uint8Array(E);
  const edgeRoadG = new Uint32Array(E);   // global road index
  const edgeSegG = new Uint16Array(E);
  const edgeToGlobal = new Uint32Array(E);

  let cur = 0;
  for(let i = 0; i < E; i++){
    const e = edges[i];
    const fromLocal = localIdMap.get(e.from);
    while(cur <= fromLocal) nodeOffset[cur++] = i;
    edgeTo[i] = localIdMap.get(e.to);
    edgeToGlobal[i] = e.to;
    const q = Math.round(e.lenM * 10);
    edgeLenM[i] = q > EDGE_LEN_QUANT_MAX ? EDGE_LEN_QUANT_MAX : q;
    edgeFlags[i] = e.flags;
    edgeRoadG[i] = e.road;
    edgeSegG[i] = Math.min(e.seg, 65535);
  }
  while(cur <= N) nodeOffset[cur++] = E;

  // border nodes（このタイルに登録された隣接タイル参照）
  const borderSet = tileBorderNodes.get(tileKey) || new Set();
  const borderArr = new Uint32Array(borderSet.size);
  let bi = 0;
  for(const gid of borderSet){ borderArr[bi++] = gid; }

  const [txStr, tyStr] = tileKey.split('_');
  const tx = parseInt(txStr, 10), ty = parseInt(tyStr, 10);

  const out = {
    v: 1,
    prefecture: PREF,
    tx, ty,
    tileDeg: TILE_DEG,
    bbox: [
      ty * TILE_DEG, tx * TILE_DEG,
      (ty + 1) * TILE_DEG, (tx + 1) * TILE_DEG,
    ],   // [minLng-ish, minLat-ish 注: tx は lat 系・ty は lng 系で混乱注意]
    precision: precision,
    edgeLenScale: 0.1,
    numNodes: N,
    numEdges: E,
    numBorderNodes: borderArr.length,
    nodeLatB64: tabToB64(localLat),
    nodeLngB64: tabToB64(localLng),
    globalIdB64: tabToB64(globalIds),
    nodeOffsetB64: tabToB64(nodeOffset),
    edgeToB64: tabToB64(edgeTo),
    edgeToGlobalB64: tabToB64(edgeToGlobal),
    edgeLenMB64: tabToB64(edgeLenM),
    edgeFlagsB64: tabToB64(edgeFlags),
    edgeRoadB64: tabToB64(edgeRoadG),
    edgeSegB64: tabToB64(edgeSegG),
    borderNodesB64: tabToB64(borderArr),
  };
  const VAR_NAME = 'ROAD_GRAPH_TILE_' + PREF.toUpperCase() + '_' + tx + '_' + ty;
  const fileContent =
    `// Auto-generated by build-road-graph-tiled.js\n` +
    `window.${VAR_NAME} = ${JSON.stringify(out)};\n`;
  const filePath = path.join(OUT_DIR, `${tx}_${ty}.js`);
  fs.writeFileSync(filePath, fileContent);
  totalSize += fs.statSync(filePath).size;
  tileIndex.push({ tx, ty, numNodes: N, numEdges: E, sizeMB: fs.statSync(filePath).size / 1024 / 1024 });
}

const indexFile = path.join(OUT_DIR, 'index.json');
fs.writeFileSync(indexFile, JSON.stringify({
  prefecture: PREF,
  tileDeg: TILE_DEG,
  generated: new Date().toISOString(),
  numTiles: numTiles,
  tiles: tileIndex,
}));

const totalMB = (totalSize / 1024 / 1024).toFixed(2);
console.log(`[${PREF}] tiles written: ${numTiles} files・total ${totalMB}MB`);
console.log(`[${PREF}] DONE total=${((Date.now() - tStart) / 1000).toFixed(1)}s`);
