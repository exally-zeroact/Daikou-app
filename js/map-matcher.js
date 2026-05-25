// ============================================================
/* eslint-disable no-console -- ★設計変更宣言 (2026-05-15・lint Phase 6):
   本ファイルは Web Worker 内で動作・window.dlog が未定義のため代替手段なし。
   内部 _dbg() ラッパーが console.log を呼ぶ箇所のみで使用 (= Class C)。 */
// map-matcher.js (Worker B)
// MM-1: 既存 _updateMapMatching 処理を Worker に移植・挙動同一
// MM-1.5: Cellular Network API による tunnel hint 受信・デッドレコニング
// MM-2: 多候補化 + emission スコア + Mahalanobis 楕円 +
//       Catmull-Rom 補間 + 遅延計測 + 道路種別遷移確率
// MM-3 (2026-05-08): 窓 Viterbi (N=5)
//                    時系列の連続性で最尤候補チェーンを推定
//                    遷移確率 = exp(-|routeDist - chordDist| / β)・β=30m
//                    一方通行違反は transition × 0.05（事実上除外）
//
// 設計方針:
//   - メーター本体（state.distance_m）には絶対影響しない（main 側で独立）
//   - 確定 snap（lastCommittedSnap）は Worker 内で完結保持
//   - 例外時は skip 扱いで返却・main の既存 fallback 経路に支障なし
//
// メッセージ仕様:
//   in:  loadRoads {pref, roadsData}
//        reset    （flush + 窓クリア）
//        gps {lat, lng, timestamp, accuracy?, speedKmh?, headingDeg?,
//             cellularLayerHint?, cellularConfidence?}
//   out: roadsLoaded {pref, ok, numRoads?, error?}
//        mmResult {mmIncrementM, snap, confidence, snapped, skipped,
//                  latencyMs, candidatesCount, pickedEmission,
//                  windowSize, committed?, _reason?}
// ============================================================

importScripts('roads-decoder.js');
importScripts('osrm-client.js'); // MM-6: OSRM /match クライアント

// 既存定数（MM-1 と同一・挙動互換のため不変）
const MM_MAX_SNAP_DIST_M = 50; // snap 単独の上限（fallback）
const MM_MAX_SEGMENT_DIST_M = 1000; // T9 (2026-05-09): 単純 skip ではなく「明らかな jump」判定の閾値として使用
const MM_GAP_RESET_SEC = 5;

// T4 (2026-05-09): turn:restriction 違反 transition のペナルティ
//   _violatesOneway と同じ ×0.05 (事実上除外だが完全 0 にはしない)
const TURN_RESTRICTION_PENALTY = 0.05;
// T9 (2026-05-09): GPS jump 関連
//   ・ jump prob が大きい候補 emission を緩める乗数 (1 - jumpProb × strength)
//   ・ jump prob 0.95 超で「明らかなジャンプ」として segment 加算 skip
const T9_JUMP_PENALTY_STRENGTH = 0.7; // jump prob×strength で emission 減衰
const T9_HARD_SKIP_PROB = 0.95; // 確率ベース skip 閾値

// MM-3 / MM-7: Viterbi パラメタ
// MM-7: 窓幅 N を 15 に拡張（MCM Lazy Viterbi）
//        p99 latency が 5ms 超過時に N=10 へ自動縮小（性能予算遵守）
const VITERBI_N_MAX = 15; // 通常運用の窓幅
const VITERBI_N_MIN = 10; // 性能逼迫時の縮小値
let _viterbiN = VITERBI_N_MAX;
// G6 (2026-05-09): iOS Safari の GPS 最大 1Hz 制限への対応
//   Android Chrome は最大 5Hz だが iOS は 1Hz 制限・Viterbi 窓が浅くなりがち
//   iOS 検出時は N=10 (= MIN) を default にして warmup 短縮
//   transitionFn は GPS 間隔関係なく動作するので問題なし
//   Catmull-Rom 既存補間は _curveLength4 / fallback で機能維持
let _platformIsIOS = false;
const TRANSITION_BETA_M = 30; // exp(-|routeDist-chordDist|/β) の β
const ONEWAY_PENALTY = 0.05; // 一方通行違反時の transition 乗数

// MM-7: Worker 内 latency 自己監視（p99 5ms 超過検知用）
const _WORKER_LAT_BUFFER_SIZE = 200;
const _workerLatBuf = new Float32Array(_WORKER_LAT_BUFFER_SIZE);
let _workerLatIdx = 0,
  _workerLatCount = 0;
let _viterbiShrinkLogged = false;
const _MCM_LAT_THRESHOLD_MS = 5.0;
const _MCM_CHECK_INTERVAL = 100; // GPS 更新 100 件ごとにチェック
let _mcmCheckCounter = 0;

function _recordWorkerLat(ms) {
  if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return;
  _workerLatBuf[_workerLatIdx] = ms;
  _workerLatIdx = (_workerLatIdx + 1) % _WORKER_LAT_BUFFER_SIZE;
  if (_workerLatCount < _WORKER_LAT_BUFFER_SIZE) _workerLatCount++;
}

function _calcWorkerP99() {
  if (_workerLatCount === 0) return 0;
  const arr = new Array(_workerLatCount);
  for (let i = 0; i < _workerLatCount; i++) arr[i] = _workerLatBuf[i];
  arr.sort(function (a, b) {
    return a - b;
  });
  return arr[Math.min(Math.floor(_workerLatCount * 0.99), _workerLatCount - 1)];
}

// MM-7: Viterbi 窓サイズの自動調整
// A6 (2026-05-09): 縮小後 5 分経過したら N=15 復帰試行を追加
const VITERBI_RECOVERY_INTERVAL_MS = 5 * 60 * 1000;
let _viterbiShrunkAt = 0;
function _maybeAdjustViterbiN() {
  _mcmCheckCounter++;
  if (_mcmCheckCounter < _MCM_CHECK_INTERVAL) return;
  _mcmCheckCounter = 0;
  if (_workerLatCount < 100) return;
  const p99 = _calcWorkerP99();
  if (p99 > _MCM_LAT_THRESHOLD_MS && _viterbiN > VITERBI_N_MIN) {
    const oldN = _viterbiN;
    _viterbiN = VITERBI_N_MIN;
    _viterbiShrunkAt = Date.now();
    if (viterbi) {
      viterbi.N = _viterbiN;
    }
    if (!_viterbiShrinkLogged) {
      _viterbiShrinkLogged = true;
      self.postMessage({ type: 'mcmShrink', from: oldN, to: _viterbiN, p99: p99 });
    }
  } else if (
    !_platformIsIOS &&
    _viterbiN < VITERBI_N_MAX &&
    _viterbiShrunkAt > 0 &&
    Date.now() - _viterbiShrunkAt > VITERBI_RECOVERY_INTERVAL_MS &&
    p99 < _MCM_LAT_THRESHOLD_MS * 0.6
  ) {
    // A6: 5 分経過 + p99 が閾値の 60% 以下なら N=15 復帰試行
    // G6: iOS は N=10 維持 (1Hz GPS で N=15 にしてもメリット薄)
    const oldN = _viterbiN;
    _viterbiN = VITERBI_N_MAX;
    if (viterbi) {
      viterbi.N = _viterbiN;
    }
    _viterbiShrunkAt = 0;
    _viterbiShrinkLogged = false;
    self.postMessage({ type: 'mcmRecover', from: oldN, to: _viterbiN, p99: p99 });
  }
}

// 県別 RoadDecoder
const decoders = new Map();
const loadedPrefs = new Set();

// D3 (2026-05-09): 緊急輸送道路指定 道路の Set (pref → Set<roadIdx>)
//   road-attrs-{pref}.js の emergencyRouteB64 を main 側で decode → forward
//   scoring で c.roadIndex がこの set に含まれていれば ×1.05 boost
const _emergencyRoutesByPref = new Map();

// ─── Phase B (2026-05-08): バックボーン graph + タイルキャッシュ ──────
// 全国 motorway/trunk バックボーンは常時 RAM 常駐（県跨ぎ routing 用）
let _backboneGraph = null;

// TileCache: LRU 25 タイル + pin/unpin（in-flight tile 保護）
const TILE_CACHE_MAX = 25;
function TileCache() {
  this.map = new Map(); // tileKey "pref/tx_ty" → tile data
  this.pinned = new Set(); // 解放禁止キー
  this.recencyOrder = []; // LRU
}
TileCache.prototype.get = function (key) {
  const t = this.map.get(key);
  if (!t) return null;
  // recency 更新
  const idx = this.recencyOrder.indexOf(key);
  if (idx >= 0) this.recencyOrder.splice(idx, 1);
  this.recencyOrder.push(key);
  return t;
};
TileCache.prototype.set = function (key, tile) {
  if (this.map.has(key)) {
    this.map.set(key, tile);
    return;
  }
  this.map.set(key, tile);
  this.recencyOrder.push(key);
  this._evict();
};
TileCache.prototype._evict = function () {
  while (this.map.size > TILE_CACHE_MAX) {
    let removed = false;
    for (let i = 0; i < this.recencyOrder.length; i++) {
      const k = this.recencyOrder[i];
      if (!this.pinned.has(k)) {
        this.recencyOrder.splice(i, 1);
        this.map.delete(k);
        removed = true;
        break;
      }
    }
    if (!removed) break; // 全 pin されてる場合は eviction 諦め（次回試行）
  }
};
TileCache.prototype.pin = function (key) {
  this.pinned.add(key);
};
TileCache.prototype.unpin = function (key) {
  this.pinned.delete(key);
};
TileCache.prototype.has = function (key) {
  return this.map.has(key);
};
TileCache.prototype.size = function () {
  return this.map.size;
};

const _tileCache = new TileCache();
const TILE_DEG = 0.05; // build-road-graph-tiled.js と一致

// Phase B runtime: タイル prefetch 状態（in-flight 重複 request 防止）
const _tilePrefetchInflight = new Set();
let _tileMissCount = 0;
let _tileHitCount = 0;
let _tileRequestCount = 0;

// M6 (2026-05-09): 現在 active な snap タイルを GPS 更新間で持続 pin
//   bestEmit / lastCommittedSnap が指すタイルを次の routing でも使うため
//   prefetch eviction で消されるのを防ぐ
let _activePinnedTileKey = null;
function _setActivePinnedTile(prefecture, snapLat, snapLng) {
  if (!prefecture || typeof snapLat !== 'number') return;
  const newKey = _tileKeyOf(prefecture, snapLat, snapLng);
  if (newKey === _activePinnedTileKey) return;
  if (_activePinnedTileKey) _tileCache.unpin(_activePinnedTileKey);
  _tileCache.pin(newKey);
  _activePinnedTileKey = newKey;
}
function _clearActivePinnedTile() {
  if (_activePinnedTileKey) {
    _tileCache.unpin(_activePinnedTileKey);
    _activePinnedTileKey = null;
  }
}

// 緯度経度 → タイルキー
function _tileKeyOf(pref, lat, lng) {
  const tx = Math.floor(lat / TILE_DEG);
  const ty = Math.floor(lng / TILE_DEG);
  return pref + '/' + tx + '_' + ty;
}

// Worker → main: タイル取得依頼
function _requestTileFromMain(pref, tx, ty) {
  const key = pref + '/' + tx + '_' + ty;
  if (_tileCache.has(key)) return;
  if (_tilePrefetchInflight.has(key)) return;
  _tilePrefetchInflight.add(key);
  _tileRequestCount++;
  try {
    self.postMessage({ type: 'requestTile', pref: pref, tx: tx, ty: ty });
  } catch (e) {
    _tilePrefetchInflight.delete(key);
  }
}

// GPS 進行方向の前方タイルを prefetch
function _prefetchTilesAround(lat, lng, headingDeg, speedKmh, pref) {
  if (!pref) return;
  const tx = Math.floor(lat / TILE_DEG);
  const ty = Math.floor(lng / TILE_DEG);
  // 現在地 + 8 近傍
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      _requestTileFromMain(pref, tx + dx, ty + dy);
    }
  }
  // 進行方向 30 秒先（最大 2km）の予測点
  if (headingDeg != null && speedKmh > 5) {
    const aheadM = Math.min(2000, (speedKmh / 3.6) * 30);
    const tr = Math.PI / 180;
    const dLat = (aheadM * Math.cos(headingDeg * tr)) / 111000;
    const cosLat = Math.cos(lat * tr);
    const dLng = cosLat > 0.01 ? (aheadM * Math.sin(headingDeg * tr)) / (111000 * cosLat) : 0;
    const ftx = Math.floor((lat + dLat) / TILE_DEG);
    const fty = Math.floor((lng + dLng) / TILE_DEG);
    if (ftx !== tx || fty !== ty) _requestTileFromMain(pref, ftx, fty);
  }
}

// タイル内 (roadIdx, segIdx) → local node index
// 初回参照時に index 構築（lazy）
function _buildTileRoadSegIndex(tile) {
  if (tile._roadSegIndex) return;
  // tile.edgeRoad / edgeSeg は decode 必要
  if (!tile._decoded) {
    tile._decoded = true;
    tile.nodeLat = new Int32Array(_b64ToArrayBuffer(tile.nodeLatB64));
    tile.nodeLng = new Int32Array(_b64ToArrayBuffer(tile.nodeLngB64));
    tile.globalId = new Uint32Array(_b64ToArrayBuffer(tile.globalIdB64));
    tile.nodeOffset = new Uint32Array(_b64ToArrayBuffer(tile.nodeOffsetB64));
    tile.edgeTo = new Uint32Array(_b64ToArrayBuffer(tile.edgeToB64));
    tile.edgeLenM = new Uint16Array(_b64ToArrayBuffer(tile.edgeLenMB64));
    tile.edgeFlags = new Uint8Array(_b64ToArrayBuffer(tile.edgeFlagsB64));
    tile.edgeRoad = new Uint32Array(_b64ToArrayBuffer(tile.edgeRoadB64));
    tile.edgeSeg = new Uint16Array(_b64ToArrayBuffer(tile.edgeSegB64));
  }
  const m = new Map();
  for (let e = 0; e < tile.numEdges; e++) {
    const key = tile.edgeRoad[e] * 65536 + tile.edgeSeg[e];
    if (!m.has(key)) m.set(key, e);
  }
  tile._roadSegIndex = m;
}

function _snapToTileNode(tile, snap) {
  _buildTileRoadSegIndex(tile);
  const key = snap.roadIndex * 65536 + (snap.segmentIndex || 0);
  const e = tile._roadSegIndex.get(key);
  if (e === undefined) return -1;
  // edge index → from-node を二分探索（tile.nodeOffset 上）
  let lo = 0,
    hi = tile.numNodes;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (tile.nodeOffset[mid + 1] <= e) lo = mid + 1;
    else hi = mid;
  }
  const fromN = lo;
  const toN = tile.edgeTo[e];
  return snap.t != null && snap.t >= 0.5 ? toN : fromN;
}

// Tile-local Dijkstra（タイル内のみ・cross-tile は呼出側で fallback）
function _runTileDijkstra(tile, srcN, dstN, maxDistM, deadline) {
  if (srcN < 0 || dstN < 0 || srcN >= tile.numNodes || dstN >= tile.numNodes) return null;
  if (srcN === dstN) return 0;
  if (!tile._dist || tile._dist.length !== tile.numNodes) {
    tile._dist = new Float32Array(tile.numNodes);
    tile._visited = new Uint8Array(tile.numNodes);
    tile._touched = [];
  }
  const dist = tile._dist;
  const visited = tile._visited;
  const touched = tile._touched;
  for (let i = 0; i < touched.length; i++) {
    dist[touched[i]] = Infinity;
    visited[touched[i]] = 0;
  }
  touched.length = 0;
  const precision = tile.precision || 1e5;
  const dstLat = tile.nodeLat[dstN] / precision;
  const dstLng = tile.nodeLng[dstN] / precision;
  dist[srcN] = 0;
  touched.push(srcN);
  const heap = new BinaryHeap();
  heap.push(srcN, 0);
  let iters = 0;
  const lenScale = tile.edgeLenScale || 0.1;
  while (heap.size() > 0) {
    if ((++iters & 0x3f) === 0 && deadline > 0 && performance.now() > deadline) return null;
    const top = heap.pop();
    const u = top.n;
    if (visited[u]) continue;
    visited[u] = 1;
    const du = dist[u];
    if (du > maxDistM) continue;
    if (u === dstN) return du;
    const eStart = tile.nodeOffset[u];
    const eEnd = tile.nodeOffset[u + 1];
    for (let k = eStart; k < eEnd; k++) {
      const v = tile.edgeTo[k];
      if (visited[v]) continue;
      const newD = du + tile.edgeLenM[k] * lenScale;
      if (newD < dist[v] && newD <= maxDistM) {
        dist[v] = newD;
        if (touched.length < 16384) touched.push(v);
        const h =
          _haversine(tile.nodeLat[v] / precision, tile.nodeLng[v] / precision, dstLat, dstLng) *
          0.9;
        heap.push(v, newD + h);
      }
    }
  }
  return null;
}

// Phase B runtime: タイル経路で route 距離を計算
//   src/dst が同一タイルかつタイル loaded → tile Dijkstra
//   T2 (2026-05-09): 隣接タイル両方 loaded → border node 接続でクロスタイル Dijkstra
//   それ以外 → null（呼出側で backbone / haversine fallback）
function _routeDistanceTileFirst(a, b) {
  if (!a || !b) return null;
  if (a.prefecture !== b.prefecture) return null;
  const tileA = _tileKeyOf(a.prefecture, a.snapLat, a.snapLng);
  const tileB = _tileKeyOf(b.prefecture, b.snapLat, b.snapLng);
  if (tileA !== tileB) {
    // T2: cross-tile・両方 loaded なら border node 接続で multi-tile Dijkstra を試す
    const partsA = tileA.split('/');
    const partsB = tileB.split('/');
    const txyA = partsA[1].split('_');
    const txyB = partsB[1].split('_');
    const txA = parseInt(txyA[0], 10),
      tyA = parseInt(txyA[1], 10);
    const txB = parseInt(txyB[0], 10),
      tyB = parseInt(txyB[1], 10);
    // 隣接 (chebyshev 距離 ≤ 1) かつ両方 loaded なら multi-tile Dijkstra へ
    const adj = Math.max(Math.abs(txA - txB), Math.abs(tyA - tyB)) <= 1;
    const tA = _tileCache.get(tileA);
    const tB = _tileCache.get(tileB);
    if (adj && tA && tB) {
      _tileCache.pin(tileA);
      _tileCache.pin(tileB);
      try {
        const r = _runTileDijkstraMulti([tA, tB], a, b);
        if (r != null) return { distanceM: r, onSameRoad: false, _via: 'tile-multi' };
      } finally {
        _tileCache.unpin(tileA);
        _tileCache.unpin(tileB);
      }
    }
    // 失敗時は両方 prefetch して呼出側 fallback
    _requestTileFromMain(a.prefecture, txA, tyA);
    _requestTileFromMain(a.prefecture, txB, tyB);
    return null;
  }
  const tile = _tileCache.get(tileA);
  if (!tile) {
    _tileMissCount++;
    const parts = tileA.split('/');
    const txy = parts[1].split('_');
    _requestTileFromMain(a.prefecture, parseInt(txy[0], 10), parseInt(txy[1], 10));
    return null;
  }
  _tileHitCount++;
  _tileCache.pin(tileA);
  try {
    const srcN = _snapToTileNode(tile, a);
    const dstN = _snapToTileNode(tile, b);
    if (srcN < 0 || dstN < 0) return null;
    const chordM = _haversine(a.snapLat, a.snapLng, b.snapLat, b.snapLng);
    const maxDistM = chordM * 1.5 + 200;
    const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
    const distM = _runTileDijkstra(tile, srcN, dstN, maxDistM, t0 + DIJKSTRA_TIMEOUT_MS);
    if (distM == null) return null;
    return { distanceM: distM, onSameRoad: false, _via: 'tile' };
  } finally {
    _tileCache.unpin(tileA);
  }
}

// T2 (2026-05-09): 複数タイルにわたる Dijkstra
//   各タイル node には globalId が割り当てられている (同 globalId = 物理的に同一 node)
//   2 つのタイルを (tileIdx, localNodeIdx) ペアでまとめ、
//   globalId 一致を「コスト 0 のリンク」として扱って探索する。
//   maxDistM 上限・DIJKSTRA_TIMEOUT_MS タイムアウトは既存と同じ。
function _runTileDijkstraMulti(tiles, a, b) {
  for (const t of tiles) _buildTileRoadSegIndex(t);
  // src/dst の所属タイル (tiles 中の index) を判定
  // a/b の snapLat/snapLng がどのタイルに含まれるかは _tileKeyOf で求める
  const srcTileKey = _tileKeyOf(a.prefecture, a.snapLat, a.snapLng);
  const dstTileKey = _tileKeyOf(b.prefecture, b.snapLat, b.snapLng);
  let srcTileIdx = -1,
    dstTileIdx = -1;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const tk = a.prefecture + '/' + t.tx + '_' + t.ty;
    if (tk === srcTileKey) srcTileIdx = i;
    if (tk === dstTileKey) dstTileIdx = i;
  }
  if (srcTileIdx < 0 || dstTileIdx < 0) return null;
  const srcLocal = _snapToTileNode(tiles[srcTileIdx], a);
  const dstLocal = _snapToTileNode(tiles[dstTileIdx], b);
  if (srcLocal < 0 || dstLocal < 0) return null;
  // 合計 node 数とオフセット
  const nodeOffsets = []; // tileIdx → 開始グローバル node 番号
  let totalNodes = 0;
  for (let i = 0; i < tiles.length; i++) {
    nodeOffsets.push(totalNodes);
    totalNodes += tiles[i].numNodes;
  }
  // globalId → 最初に登場した glob node 番号 (同 globalId はそこに統合)
  const gidToFirst = new Map();
  // glob node 番号 → 代表 (gidToFirst の値)
  function repr(gn) {
    const tileIdx = _tileIdxOfGlobalNode(nodeOffsets, gn);
    const localN = gn - nodeOffsets[tileIdx];
    const gid = tiles[tileIdx].globalId[localN];
    if (gid === 0) return gn; // gid=0 = 内部 node のみ
    if (!gidToFirst.has(gid)) {
      gidToFirst.set(gid, gn);
      return gn;
    }
    return gidToFirst.get(gid);
  }
  // 事前に全 node の代表を計算
  const reprArr = new Int32Array(totalNodes);
  for (let g = 0; g < totalNodes; g++) reprArr[g] = repr(g);
  // src/dst の代表
  const srcGN = reprArr[nodeOffsets[srcTileIdx] + srcLocal];
  const dstGN = reprArr[nodeOffsets[dstTileIdx] + dstLocal];
  if (srcGN === dstGN) return 0;
  const chordM = _haversine(a.snapLat, a.snapLng, b.snapLat, b.snapLng);
  const maxDistM = chordM * 1.5 + 500;
  const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
  const deadline = t0 + DIJKSTRA_TIMEOUT_MS;
  const dist = new Float32Array(totalNodes);
  const visited = new Uint8Array(totalNodes);
  for (let i = 0; i < totalNodes; i++) dist[i] = Infinity;
  dist[srcGN] = 0;
  const heap = new BinaryHeap();
  heap.push(srcGN, 0);
  let iters = 0;
  while (heap.size() > 0) {
    if ((++iters & 0x3f) === 0 && performance.now() > deadline) return null;
    const top = heap.pop();
    const u = top.n;
    if (visited[u]) continue;
    visited[u] = 1;
    const du = dist[u];
    if (du > maxDistM) continue;
    if (u === dstGN) return du;
    // u の所属タイル/local node
    const tileIdx = _tileIdxOfGlobalNode(nodeOffsets, u);
    const tile = tiles[tileIdx];
    const localU = u - nodeOffsets[tileIdx];
    const eStart = tile.nodeOffset[localU];
    const eEnd = tile.nodeOffset[localU + 1];
    const lenScale = tile.edgeLenScale || 0.1;
    for (let k = eStart; k < eEnd; k++) {
      const localV = tile.edgeTo[k];
      const v = reprArr[nodeOffsets[tileIdx] + localV];
      if (visited[v]) continue;
      const newD = du + tile.edgeLenM[k] * lenScale;
      if (newD < dist[v] && newD <= maxDistM) {
        dist[v] = newD;
        heap.push(v, newD);
      }
    }
  }
  return null;
}
function _tileIdxOfGlobalNode(nodeOffsets, gn) {
  for (let i = nodeOffsets.length - 1; i >= 0; i--) {
    if (gn >= nodeOffsets[i]) return i;
  }
  return 0;
}

// MM-5 (2026-05-08): DEM データ（高度データ）
// 形式: { bbox:[minLat,minLng,maxLat,maxLng], gridSize, numLat, numLng, alt:Int16Array }
// alt[y * numLng + x] = 該当グリッドの標高 (m, sea level 基準, Int16 範囲 -32768〜32767m)
let _demData = null;
const _LAYER_BOOST_FACTOR = 1.3; // accel/cellular hint と layer 一致時のブースト
const _LAYER_WRONG_PENALTY = 0.3; // 高架/地下 で alt 矛盾時のペナルティ

// T3 (2026-05-09): POI proximity prior
//   pref → 100m × 100m grid に POI 中心 [lat, lng] を index 化
//   proximity 50m 以内なら候補 emission を ×1.05 boost
//   未ロード時 (Map 空) は boost なしで既存挙動
const _poisGrid = new Map(); // pref → Map(gridKey → [[lat,lng], ...])
const POI_GRID_DEG = 0.001; // 約 100m
const POI_RADIUS_M = 50;
const POI_BOOST_FACTOR = 1.05;
function _setPois(pref, points) {
  // points: [[lat, lng], ...]
  const g = new Map();
  for (const p of points) {
    const lat = p[0],
      lng = p[1];
    if (!isFinite(lat) || !isFinite(lng)) continue;
    const k = Math.floor(lat / POI_GRID_DEG) + '_' + Math.floor(lng / POI_GRID_DEG);
    let arr = g.get(k);
    if (!arr) {
      arr = [];
      g.set(k, arr);
    }
    arr.push([lat, lng]);
  }
  _poisGrid.set(pref, g);
}
function _hasPoiNearby(pref, lat, lng) {
  const g = _poisGrid.get(pref);
  if (!g || g.size === 0) return false;
  const cy = Math.floor(lat / POI_GRID_DEG);
  const cx = Math.floor(lng / POI_GRID_DEG);
  const r2 = POI_RADIUS_M * POI_RADIUS_M;
  const mpd = _metersPerDegree(lat);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const arr = g.get(cy + dy + '_' + (cx + dx));
      if (!arr) continue;
      for (const p of arr) {
        const ex = (p[1] - lng) * mpd.lng;
        const ey = (p[0] - lat) * mpd.lat;
        if (ex * ex + ey * ey <= r2) return true;
      }
    }
  }
  return false;
}

// T11 (2026-05-09): 時間帯条件付き oneway / 通行制限
//   pref → roadIndex → [{startMin, endMin, days?, kind}]
//   kind: 'oneway' | 'no_through' (= 通行禁止)
//   現在時刻 (msg.timestamp 由来) が窓内なら oneway 違反/通行禁止 として transition penalty
const _conditionalRestrictionsByPref = new Map(); // pref → Map(roadIndex → array)
function _setConditionalRestrictions(pref, list) {
  const m = new Map();
  for (const r of list) {
    if (!r || typeof r.roadIndex !== 'number') continue;
    let arr = m.get(r.roadIndex);
    if (!arr) {
      arr = [];
      m.set(r.roadIndex, arr);
    }
    arr.push({
      startMin: r.startMin | 0,
      endMin: r.endMin | 0,
      days: Array.isArray(r.days) ? r.days : null, // 0=Sun..6=Sat / null=全日
      kind: r.kind || 'no_through',
    });
  }
  _conditionalRestrictionsByPref.set(pref, m);
}
function _isUnderConditionalRestriction(pref, roadIndex, ts) {
  const m = _conditionalRestrictionsByPref.get(pref);
  if (!m) return null;
  const list = m.get(roadIndex);
  if (!list) return null;
  const d = new Date(ts);
  const minOfDay = d.getHours() * 60 + d.getMinutes();
  const dow = d.getDay();
  for (const r of list) {
    if (r.days && r.days.indexOf(dow) < 0) continue;
    // 時間帯判定 (跨ぎ対応: end < start なら 24h ラップ)
    let inWindow;
    if (r.endMin >= r.startMin) {
      inWindow = minOfDay >= r.startMin && minOfDay < r.endMin;
    } else {
      inWindow = minOfDay >= r.startMin || minOfDay < r.endMin;
    }
    if (inWindow) return r.kind;
  }
  return null;
}

// T8 (2026-05-09): Cross-user pheromone (Firebase 連携)
//   pref → roadIndex → 他ドライバ走行カウント (ローカル _pheromoneByPref と独立)
//   main から 'updateCrossUserPheromone' message でロード
//   オフライン / 未接続時は空のまま (ブーストなし = 既存挙動)
const _crossUserPheromoneByPref = new Map(); // pref → Map(roadIndex → number)
const CROSS_USER_BOOST_PEAK = 1.1; // 高頻度道路に最大 +10% transition prior
function _setCrossUserPheromone(pref, list) {
  const m = new Map();
  for (const r of list) {
    if (typeof r.roadIndex === 'number' && typeof r.count === 'number') {
      m.set(r.roadIndex, r.count);
    }
  }
  _crossUserPheromoneByPref.set(pref, m);
}
function _getCrossUserBoost(pref, roadIndex) {
  if (!pref) return 1.0;
  const m = _crossUserPheromoneByPref.get(pref);
  if (!m) return 1.0;
  const c = m.get(roadIndex);
  if (!c || c <= 0) return 1.0;
  // 1 → 1.02 / 5 → 1.05 / ≥20 → 1.10
  const boost = 1.0 + Math.min(0.1, (Math.log(1 + c) / Math.log(20)) * 0.1);
  return boost > CROSS_USER_BOOST_PEAK ? CROSS_USER_BOOST_PEAK : boost;
}

// ─── MM-6 (2026-05-08): OSRM /match 教師信号 ───────────────────
// 30 秒分の GPS トレースをバッファし定期的に OSRM /match に送信。
// 返却される leg distance を「教師信号」として transition score に重み付き反映。
// オフライン時 / OSRM 失敗時は即スキップして既存処理に fallback。
const _osrmTraceBuffer = []; // [{lat,lng,timestamp,accuracy}]
const OSRM_BATCH_INTERVAL_MS = 30000; // 30 秒ごとに 1 回バッチ送信
const OSRM_MAX_BUFFER_SIZE = 60; // バッファ最大点数（1Hz×60s で安全側）
const OSRM_MIN_BATCH_POINTS = 5; // バッチ最小点数（短すぎ trace は無効）
const OSRM_TEACHER_TTL_MS = 60000; // 教師信号の有効期限 60 秒
const OSRM_BLEND_WEIGHT = 0.7; // 教師信号 0.7 + 自前 routing 0.3 で重み付き融合
let _lastOsrmBatchAt = 0;
let _osrmInflight = false; // 並列実行防止
let _osrmEnabled = true; // false で機能無効化（main から configOsrm で制御）

// 直近の教師信号: trace[i] と trace[i+1] 間の OSRM 計算距離 = legs[i]
const _osrmTeacher = {
  trace: [],
  legs: [],
  expiresAt: 0,
  // 統計（diagnostic 用）
  hits: 0,
  misses: 0,
  batches: 0,
  batchFails: 0,
};

// MM-4b: Dijkstra タイムアウト・LRU キャッシュ
const DIJKSTRA_TIMEOUT_MS = 3;
const ROUTE_CACHE_SIZE = 100;

// MM-3: 確定済み（commit 済み）snap・main 側の prev に相当
let lastCommittedSnap = null;
// MM-1/2 互換用 prevSnap（Viterbi 不在時の fallback 経路で使用）
let prevSnap = null;

// ─── MM-2: GPS バッファ（Catmull-Rom 用 4 点） ─────────────────
const _gpsBuffer = []; // [{lat,lng,timestamp}]
const _GPS_BUFFER_SIZE = 4;

function _pushGpsBuffer(p) {
  _gpsBuffer.push(p);
  if (_gpsBuffer.length > _GPS_BUFFER_SIZE) _gpsBuffer.shift();
}

// G1 (2026-05-09): HDOP/PDOP 簡易推定 (直近 GPS の不規則性ベース)
//   accuracy 値だけでは衛星配置偏りによる実誤差を捕えられない
//   直近 5 点の inter-step 距離の変動係数 (CV) で擬似 HDOP を算出
//   CV 大 = trajectory 不規則 = GPS 不安定 → σ multiplier で scoring 緩める
const _recentGpsBuf = [];
const _RECENT_GPS_BUF_SIZE = 5;
function _pushRecentGps(lat, lng, timestamp) {
  _recentGpsBuf.push({ lat: lat, lng: lng, t: timestamp });
  if (_recentGpsBuf.length > _RECENT_GPS_BUF_SIZE) _recentGpsBuf.shift();
}
function _estimatePdopMultiplier() {
  if (_recentGpsBuf.length < 3) return 1.0;
  const steps = [];
  for (let i = 1; i < _recentGpsBuf.length; i++) {
    const a = _recentGpsBuf[i - 1];
    const b = _recentGpsBuf[i];
    steps.push(_haversine(a.lat, a.lng, b.lat, b.lng));
  }
  let sum = 0;
  for (let i = 0; i < steps.length; i++) sum += steps[i];
  const mean = sum / steps.length;
  if (mean < 0.5) return 1.0; // 停車中・判定困難
  let varSum = 0;
  for (let i = 0; i < steps.length; i++) varSum += (steps[i] - mean) * (steps[i] - mean);
  const stddev = Math.sqrt(varSum / steps.length);
  const cv = stddev / mean; // 変動係数
  // CV>0.5 で「明らかに不規則」・>0.3 で「やや不規則」・以下は通常
  if (cv > 0.5) return 1.5;
  if (cv > 0.3) return 1.2;
  return 1.0;
}

// T9 (2026-05-09): GPS jump 確率推定
//   直近 4 step (= recent buf 5 点) の trajectory 一貫性を見て、現在の GPS 点が
//   「multipath による瞬間ジャンプ」なのか「実際の高速移動」なのかを区別する。
//   jumpProb ∈ [0,1]・1 に近いほど multipath ジャンプの確率が高い
//
//   要素:
//     speedJump: 直近の typical 速度に対する current step の速度比
//     bearingJump: 直近 trajectory bearing に対する current step bearing の差
//     ピーク検出: jumpProb = combine(speedJump, bearingJump)
//
//   _recentGpsBuf は _pushRecentGps で先に積まれている (現在の点を含む末尾)
//   末尾と prev (-2) で current step を計算
function _estimateJumpProb() {
  const n = _recentGpsBuf.length;
  if (n < 3) return 0;
  const curr = _recentGpsBuf[n - 1];
  const prev = _recentGpsBuf[n - 2];
  const dtCurr = (curr.t - prev.t) / 1000;
  if (dtCurr <= 0 || dtCurr > 30) return 0;
  const distCurr = _haversine(prev.lat, prev.lng, curr.lat, curr.lng);
  const speedCurrKmh = (distCurr / dtCurr) * 3.6;

  // ベースライン速度 (current 除外の median 的扱い)
  const baseSpeeds = [];
  for (let i = 1; i < n - 1; i++) {
    const a = _recentGpsBuf[i - 1];
    const b = _recentGpsBuf[i];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0 || dt > 30) continue;
    const d = _haversine(a.lat, a.lng, b.lat, b.lng);
    baseSpeeds.push((d / dt) * 3.6);
  }
  if (baseSpeeds.length === 0) return 0;
  baseSpeeds.sort(function (a, b) {
    return a - b;
  });
  const baseSpeedKmh = baseSpeeds[Math.floor(baseSpeeds.length / 2)]; // median

  // 速度比ベースの jump 確率
  //   ratio < 2.5 → 0   /   ratio = 5 → ~0.5   /   ratio > 7.5 → ~1.0
  //   但しベース速度が 5km/h 未満の場合は除算で爆発するので底上げ
  const refSpeed = Math.max(baseSpeedKmh, 5);
  const ratio = speedCurrKmh / refSpeed;
  let speedJumpProb = 0;
  if (ratio > 2.5) {
    speedJumpProb = Math.min(1.0, (ratio - 2.5) / 5.0);
  }

  // bearing change ベース
  let bearingJumpProb = 0;
  if (n >= 4) {
    const prev2 = _recentGpsBuf[n - 3];
    if (_haversine(prev2.lat, prev2.lng, prev.lat, prev.lng) > 1 && distCurr > 1) {
      const baseBearing = _segmentBearing(prev2.lat, prev2.lng, prev.lat, prev.lng);
      const currBearing = _segmentBearing(prev.lat, prev.lng, curr.lat, curr.lng);
      const diff = _angleDiff(baseBearing, currBearing);
      // 90° 以下なら 0・90-180° で線形 0→1
      bearingJumpProb = Math.max(0, Math.min(1, (diff - 90) / 90));
    }
  }

  // 速度 jump と bearing jump は独立的に見て max を採用 (どちらかが強ければ jump)
  // ただし両方弱い時は (1 - (1 - a)(1 - b)) で増幅 (= probabilistic OR)
  const orProb = 1 - (1 - speedJumpProb) * (1 - bearingJumpProb);
  return Math.max(speedJumpProb, bearingJumpProb, orProb * 0.9);
}

// M5 (2026-05-09): centripetal Catmull-Rom (alpha=0.5) でオーバーシュート抑制
//   旧: 一様 (uniform) パラメタ化 → 急カーブで実走より 0.5-2% 過大評価
//   新: chord 距離の sqrt を knot 距離として Barry-Goldman で評価
//       急カーブでも overshoot しない (centripetal の数学的性質)
function _catmullRom(p0, p1, p2, p3, t) {
  const ALPHA = 0.5; // 0=uniform / 0.5=centripetal / 1.0=chordal
  function knotDelta(a, b) {
    const d = _haversine(a.lat, a.lng, b.lat, b.lng);
    return Math.pow(d + 1e-9, ALPHA);
  }
  const t0 = 0;
  const t1 = t0 + knotDelta(p0, p1);
  const t2 = t1 + knotDelta(p1, p2);
  const t3 = t2 + knotDelta(p2, p3);
  // 入力 t∈[0,1] を実 knot 区間 [t1, t2] にマップ
  const T = t1 + t * (t2 - t1);
  // Barry-Goldman 再帰的 lerp で centripetal Catmull-Rom 評価
  function lerp(a, b, ta, tb) {
    if (tb === ta) return { lat: a.lat, lng: a.lng };
    const f = (T - ta) / (tb - ta);
    return {
      lat: (1 - f) * a.lat + f * b.lat,
      lng: (1 - f) * a.lng + f * b.lng,
    };
  }
  const A1 = lerp(p0, p1, t0, t1);
  const A2 = lerp(p1, p2, t1, t2);
  const A3 = lerp(p2, p3, t2, t3);
  const B1 = { lat: 0, lng: 0 };
  const B2 = { lat: 0, lng: 0 };
  if (t2 !== t0) {
    const f = (T - t0) / (t2 - t0);
    B1.lat = (1 - f) * A1.lat + f * A2.lat;
    B1.lng = (1 - f) * A1.lng + f * A2.lng;
  } else {
    B1.lat = A1.lat;
    B1.lng = A1.lng;
  }
  if (t3 !== t1) {
    const f = (T - t1) / (t3 - t1);
    B2.lat = (1 - f) * A2.lat + f * A3.lat;
    B2.lng = (1 - f) * A2.lng + f * A3.lng;
  } else {
    B2.lat = A2.lat;
    B2.lng = A2.lng;
  }
  if (t2 === t1) return { lat: B1.lat, lng: B1.lng };
  const f = (T - t1) / (t2 - t1);
  return {
    lat: (1 - f) * B1.lat + f * B2.lat,
    lng: (1 - f) * B1.lng + f * B2.lng,
  };
}

// p1〜p2 間の Catmull-Rom 曲線長を 10 分割で積分
// 4 点未満の場合は線形補間（haversine 弦距離）にフォールバック
function _curveLength4(p0, p1, p2, p3) {
  const samples = 10;
  let total = 0;
  let prev = p1;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const pt = _catmullRom(p0, p1, p2, p3, t);
    total += _haversine(prev.lat, prev.lng, pt.lat, pt.lng);
    prev = pt;
  }
  return total;
}

// ─── MM-2: 共通幾何ヘルパー ─────────────────────────────────────
function _haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000,
    tr = Math.PI / 180;
  const dLat = (lat2 - lat1) * tr;
  const dLng = (lng2 - lng1) * tr;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * tr) * Math.cos(lat2 * tr) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _segmentBearing(latA, lngA, latB, lngB) {
  const tr = Math.PI / 180;
  const φ1 = latA * tr,
    φ2 = latB * tr;
  const Δλ = (lngB - lngA) * tr;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function _angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function _metersPerDegree(refLat) {
  const tr = Math.PI / 180;
  return {
    lat: 111132.954 - 559.822 * Math.cos(2 * refLat * tr) + 1.175 * Math.cos(4 * refLat * tr),
    lng: 111319.488 * Math.cos(refLat * tr),
  };
}

// ─── MM-2: emission scoring ────────────────────────────────────

// 道路種別バケット（v6 typeCode → 共通カテゴリ）
function _roadTypeBucket(tc) {
  if (tc === 0 || tc === 7) return 'motorway'; // motorway, motorway_link
  if (tc === 1 || tc === 8) return 'trunk';
  if (tc === 2 || tc === 9) return 'primary';
  if (tc === 3 || tc === 10) return 'secondary';
  if (tc === 4 || tc === 11) return 'tertiary';
  if (tc === 5) return 'unclassified';
  if (tc === 6) return 'residential';
  if (tc === 12) return 'track';
  return 'unknown';
}

// 道路種別遷移ペナルティ（隣接バケットのみ自然・離れたら 0.05 倍）
const _ADJACENT_TYPES = {
  motorway: ['motorway', 'trunk', 'primary'],
  trunk: ['motorway', 'trunk', 'primary', 'secondary'],
  primary: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'],
  secondary: ['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential'],
  tertiary: ['primary', 'secondary', 'tertiary', 'unclassified', 'residential'],
  unclassified: ['secondary', 'tertiary', 'unclassified', 'residential', 'track'],
  residential: ['secondary', 'tertiary', 'unclassified', 'residential', 'track'],
  track: ['unclassified', 'residential', 'track'],
};

function _typeTransitionScore(prevBucket, currBucket) {
  if (!prevBucket || !currBucket || prevBucket === 'unknown') return 1.0;
  if (prevBucket === currBucket) return 1.0;
  const adj = _ADJACENT_TYPES[prevBucket];
  if (adj && adj.indexOf(currBucket) >= 0) return 1.0;
  return 0.05; // 不自然な遷移（motorway → residential 等）に強ペナルティ
}

// T7 (2026-05-09): 道路曲率による σ_perp 動的化
//   直近 commit 履歴 N=4 の segment bearing 差から平均角度差を推定
//   平均角度差大 (カーブ多) → σ_perp 緩和 (snap miss 防止)
//   平均角度差小 (直線) → σ_perp 厳格 (snap 精度向上)
//   範囲: 1.0σ (完全直線) 〜 2.5σ (急カーブ)・既定 1.5σ (履歴不足時)
const _CURVATURE_HISTORY_MAX = 4;
let _curvatureHistory = []; // bearing deg list (FIFO・新→旧 push 順)
let _currentSigmaPMult = 1.5; // _scoreCandidates → _mahalanobisEmission に渡す

function _updateCurvatureFromCommit(snap) {
  if (!snap || snap.segLatA == null || snap.segLatB == null) return;
  const bearing = _segmentBearing(snap.segLatA, snap.segLngA, snap.segLatB, snap.segLngB);
  _curvatureHistory.push(bearing);
  if (_curvatureHistory.length > _CURVATURE_HISTORY_MAX) {
    _curvatureHistory.shift();
  }
  if (_curvatureHistory.length >= 2) {
    let sumDiff = 0,
      count = 0;
    for (let i = 1; i < _curvatureHistory.length; i++) {
      sumDiff += _angleDiff(_curvatureHistory[i], _curvatureHistory[i - 1]);
      count++;
    }
    const avgDiffDeg = sumDiff / count;
    // 0° (直線) → 1.0σ・30° (急カーブ) 以上で 2.5σ・clamp
    //   avgDiffDeg / 20 を 1.0 に加算 (傾き調整) し [1.0, 2.5] にクランプ
    const mult = Math.max(1.0, Math.min(2.5, 1.0 + avgDiffDeg / 20));
    _currentSigmaPMult = mult;
  } else {
    _currentSigmaPMult = 1.5;
  }
}
function _resetCurvatureHistory() {
  _curvatureHistory = [];
  _currentSigmaPMult = 1.5;
}

// T6 (2026-05-09): maxspeed (3-bit) → σ_perp 乗数
//   高速制限道路 (100+) は GPS 横ブレ大なので σ 緩める = snap miss 防止
//   低速制限道路 (≤30) は細道なので σ 厳しく = 隣の道に snap 流出を防止
//   maxspeed が 0 (不明) の場合は中立 (1.0・既存挙動)
function _maxspeedSigmaMultiplier(maxspeedCode) {
  if (maxspeedCode == null || maxspeedCode === 0) return 1.0;
  switch (maxspeedCode) {
    case 1:
      return 0.7; // ≤30 km/h
    case 2:
      return 0.85; // 40 km/h
    case 3:
      return 0.85; // 50 km/h
    case 4:
      return 1.0; // 60 km/h (中立)
    case 5:
      return 1.0; // 70 km/h (中立)
    case 6:
      return 1.15; // 80 km/h
    case 7:
      return 1.3; // ≥100 km/h
    default:
      return 1.0;
  }
}

// Mahalanobis 楕円 emission（進行方向に短く・直交方向に長い）
// 走行方向 σ_along = 0.5σ
// 直交方向 σ_perp = (T7 曲率連動 _currentSigmaPMult × T6 maxspeed 乗数) × σ
// σ = 4 + 0.5 × accuracy
// heading 不明時は等方化（σ_along = σ_perp = σ）
function _mahalanobisEmission(snap, gpsLat, gpsLng, accuracy, headingDeg) {
  const mpd = _metersPerDegree(gpsLat);
  const dx = (snap.snapLng - gpsLng) * mpd.lng; // east m
  const dy = (snap.snapLat - gpsLat) * mpd.lat; // north m
  const sigma = 4 + 0.5 * accuracy;
  let along, perp;
  if (headingDeg != null) {
    const tr = Math.PI / 180;
    const sinH = Math.sin(headingDeg * tr);
    const cosH = Math.cos(headingDeg * tr);
    along = dx * sinH + dy * cosH; // 進行方向成分
    perp = -dx * cosH + dy * sinH; // 直交方向成分
    const sigmaA = 0.5 * sigma;
    // T7: 曲率連動 + T6: maxspeed 乗数
    const speedMult = _maxspeedSigmaMultiplier(snap.maxspeed);
    const sigmaP = _currentSigmaPMult * speedMult * sigma;
    const arg = -0.5 * ((along / sigmaA) ** 2 + (perp / sigmaP) ** 2);
    return Math.exp(arg);
  } else {
    // heading なし → 等方ガウス
    const r2 = dx * dx + dy * dy;
    return Math.exp((-0.5 * r2) / (sigma * sigma));
  }
}

// 候補配列に emission スコアを付与
// 総合 emission = 距離 × heading × Mahalanobis × 道路種別
// MM-5: DEM lookup（O(1) 2D グリッド）
// 高さ精度が DEM grid 解像度に依存。グリッド外は null。
function _demLookup(lat, lng) {
  if (!_demData) return null;
  const bbox = _demData.bbox;
  if (lat < bbox[0] || lat > bbox[2] || lng < bbox[1] || lng > bbox[3]) return null;
  const x = Math.floor((lng - bbox[1]) / _demData.gridSize);
  const y = Math.floor((lat - bbox[0]) / _demData.gridSize);
  if (x < 0 || x >= _demData.numLng || y < 0 || y >= _demData.numLat) return null;
  return _demData.alt[y * _demData.numLng + x];
}

// T1 (2026-05-09): DEM 3D 距離補正
//   水平距離 distM (haversine 等) + 標高差 |Δh| → 実距離 √(distM² + Δh²)
//   勾配 5-10% (Δh/distM = 0.05-0.10) で実距離は 0.12-0.5% 増加
//   両端の DEM lookup が成功した場合のみ補正・失敗時は distM を変更しない
function _apply3DCorrection(distM, lat1, lng1, lat2, lng2) {
  if (!_demData || !(distM > 0)) return distM;
  const h1 = _demLookup(lat1, lng1);
  const h2 = _demLookup(lat2, lng2);
  if (h1 == null || h2 == null) return distM;
  const dh = h2 - h1;
  if (!isFinite(dh) || dh === 0) return distM;
  // 勾配が現実的か検証 (>50% は誤データの可能性・補正しない)
  if (Math.abs(dh) > distM * 0.5) return distM;
  return Math.sqrt(distM * distM + dh * dh);
}

// 2026-05-09 (P4/P5): cellular/accel hint 廃止・layer score を road 属性のみで算出
//   c.layer: 0=平面 1=高架 2=地下 3=その他
//   gpsAlt: GPS 高度 (m)・null なら DEM 比較スキップ
//   prevLayer: 直前 commit snap の layer (連続性 boost 用)
function _computeLayerScore(c, gpsLat, gpsLng, gpsAlt, prevLayer) {
  let score = 1.0;

  // DEM 高度差ベースのスコア（DEM ロード済かつ GPS alt あり）
  if (gpsAlt != null && _demData) {
    const demAlt = _demLookup(gpsLat, gpsLng);
    if (demAlt != null) {
      const altDiff = gpsAlt - demAlt;
      if (c.layer === 1) {
        if (altDiff > 4) score *= 1.0;
        else if (altDiff > 0) score *= Math.exp(-(4 - altDiff) / 3);
        else score *= _LAYER_WRONG_PENALTY;
      } else if (c.layer === 2) {
        if (altDiff < -2) score *= 1.0;
        else if (altDiff < 0) score *= Math.exp(-(-altDiff - 2) / 3);
        else score *= _LAYER_WRONG_PENALTY;
      } else {
        const ad = Math.abs(altDiff);
        if (ad < 5) score *= 1.0;
        else score *= Math.exp(-ad / 5);
      }
    }
  }

  // 2026-05-09 (P4/P5 代替): layer 連続性 boost
  //   直前 snap が layer=1/2 (高架/地下) なら、同 layer 候補を ×1.3 boost
  //   トンネル進入後の数 GPS step 中はトンネル候補を維持しやすくする
  if ((prevLayer === 1 || prevLayer === 2) && c.layer === prevLayer) {
    score *= _LAYER_BOOST_FACTOR;
  }

  return score;
}

// MM-2/MM-5/MM-7: emission scoring
//   候補絞り込み後に layer score を最後段で乗算
//   MM-7: 地域別 GPS 誤差学習 (grid bias) で σ を補正
//   MM-7: フェロモン boost を最終乗算（常用ルートを優先）
function _scoreCandidates(
  cands,
  gpsLat,
  gpsLng,
  accuracy,
  headingDeg,
  prevTypeBucket,
  gpsAlt,
  prevLayer
) {
  // MM-7: grid bias 補正で σ を地域固有に調整
  const sigmaMult = _getGridSigmaMultiplier(gpsLat, gpsLng);
  // G1 (2026-05-09): trajectory 不規則性ベースの擬似 PDOP で σ 補正
  //   ビル街マルチパス・衛星配置偏りで accuracy が低くても実誤差大の状況に対応
  const pdopMult = _estimatePdopMultiplier();
  const sigma = (4 + 0.5 * accuracy) * sigmaMult * pdopMult;
  // T9 (2026-05-09): GPS jump 確率を一度だけ計算 (全候補共通)
  //   _recentGpsBuf は本関数の外で _pushRecentGps 済 (現在の点が末尾)
  const jumpProb = _estimateJumpProb();
  const jumpScale = 1 - jumpProb * T9_JUMP_PENALTY_STRENGTH; // [1 - 0.7, 1]
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    // ① 距離スコア exp(-d²/(2σ²))
    const distScore = Math.exp(-0.5 * (c.distanceM / sigma) ** 2);
    // ② heading スコア exp(-headingDiff/β)
    //   P9 (2026-05-09): GPS accuracy 劣化時は heading に強く依存 (β を狭める)
    //   accuracy>40m で β=15 (通常 30) → heading 一致候補を 2 倍以上 boost
    //   T10 (2026-05-09): Lane-level matching - 上下分離道路 (dual carriageway)
    //     oneway 候補は forward bearing のみ採用・反対方向は ×LANE_PENALTY
    //     非 oneway は両方向考慮 (既存挙動維持)
    //     これにより oneway 道路のペアで GPS heading に合う側のみが高スコアを得る
    let headScore = 1.0;
    let laneFlag = 0; // T10: diagnostic - 0=neutral / 1=lane-correct / 2=lane-wrong
    if (headingDeg != null) {
      const segB = _segmentBearing(c.segLatA, c.segLngA, c.segLatB, c.segLngB);
      const diffFwd = _angleDiff(headingDeg, segB);
      const diffRev = _angleDiff(headingDeg, (segB + 180) % 360);
      const beta = accuracy > 40 ? 15 : 30;
      if (c.oneway) {
        // T10: oneway 候補は forward に対する diff のみで scoring
        headScore = Math.exp(-diffFwd / beta);
        // 反対方向 (diffFwd >> diffRev) は車線判別失敗 → 追加ペナルティで除外
        if (diffFwd > 90 && diffRev < 60) {
          headScore *= 0.05; // 反対車線・oneway 違反系 → ほぼ除外
          laneFlag = 2;
        } else if (diffFwd < 60) {
          laneFlag = 1; // 進行方向一致
        }
      } else {
        // 非 oneway → 既存挙動 (両方向)
        const diff = Math.min(diffFwd, diffRev);
        headScore = Math.exp(-diff / beta);
      }
    }
    c._laneFlag = laneFlag; // T10 diagnostic
    // ③ Mahalanobis 楕円
    const mahalScore = _mahalanobisEmission(c, gpsLat, gpsLng, accuracy, headingDeg);
    // ④ 道路種別遷移
    const currBucket = _roadTypeBucket(c.typeCode);
    const typeScore = _typeTransitionScore(prevTypeBucket, currBucket);
    // ⑤ MM-5: layer score（候補絞り込み後）
    const layerScore = _computeLayerScore(c, gpsLat, gpsLng, gpsAlt, prevLayer);
    // ⑥ MM-7: フェロモン boost（常用ルート優先）
    const phBoost = _getPheromoneBoost(c.prefecture, c.roadIndex);
    // ⑦ C6 (2026-05-09): lanes/width/incline 属性 boost (各 ±5%)
    //   主要道路 (車線多・道幅広) を優先・狭路はわずかにペナルティ
    //   incline=急 (登り/下り急) は速度誤差大として heading scoring 緩めの代替指標
    let attrBoost = 1.0;
    if (c.lanes != null) {
      // lanes 0=不明 (中立) / 1=狭く ペナルティ / 2-4=主要 boost / 5+ 高速
      if (c.lanes === 1) attrBoost *= 0.95;
      else if (c.lanes >= 2 && c.lanes <= 4) attrBoost *= 1.05;
      else if (c.lanes >= 5) attrBoost *= 1.08;
    }
    if (c.width != null) {
      // width 0=不明 / 1=≤2m 狭路 / 2=2-5m 中 / 3=>5m 主要
      if (c.width === 1) attrBoost *= 0.95;
      else if (c.width === 3) attrBoost *= 1.05;
    }
    if (c.incline != null && c.incline !== 0) {
      // incline 1=登り急 / 2=下り急 / 3=方向不明
      // 急坂は GPS 高度誤差が出やすいので scoring わずかに緩める
      attrBoost *= 0.97;
    }
    // D3 (2026-05-09): 緊急輸送道路指定なら ×1.05 boost (主要道路優先)
    //   災害輸送道路 = 通常時も主要幹線・誤 snap 抑制に有効
    if (c.prefecture && c.roadIndex != null) {
      const emSet = _emergencyRoutesByPref.get(c.prefecture);
      if (emSet && emSet.has(c.roadIndex)) attrBoost *= 1.05;
    }
    // D1 (2026-05-09): access フラグでペナルティ
    //   public (0) → 通常
    //   private (1) → ×0.5 (関係者用・代行で通常使わない)
    //   no_motor (2) → ×0.05 (歩行者専用・絶対通らない)
    if (c.access === 1) attrBoost *= 0.5;
    else if (c.access === 2) attrBoost *= 0.05;
    // T9 (2026-05-09): GPS jump 確率分の emission 緩和
    //   全候補に共通の jumpScale (1 - jumpProb × strength) を乗算
    //   jump 時は全候補 emission が一律下がる → Viterbi 内で旧 commit 維持側が
    //   勝ちやすくなり、multipath による誤 snap を抑制
    //   実際の高速移動では bearing が一致するため bearingJumpProb が低く影響少
    attrBoost *= jumpScale;
    // T3 (2026-05-09): POI proximity prior (+5%)
    //   POI 50m 以内の候補は emission を ×1.05 boost (常用立寄り先での誤 snap 抑制)
    //   POI データ未ロード時は _hasPoiNearby が false → boost なし
    if (c.prefecture && _hasPoiNearby(c.prefecture, c.snapLat, c.snapLng)) {
      attrBoost *= POI_BOOST_FACTOR;
    }
    // 総合
    c._distScore = distScore;
    c._headScore = headScore;
    c._mahalScore = mahalScore;
    c._typeScore = typeScore;
    c._layerScore = layerScore;
    c._phBoost = phBoost;
    c._attrBoost = attrBoost;
    c._jumpProb = jumpProb; // T9: diagnostic
    c._typeBucket = currBucket;
    // M1 (2026-05-09): log 空間で和算化して数値 underflow を防止
    //   旧: 7 個の [0,1] 値を乗算 → 連続 100 step で 1e-30 以下に underflow
    //       Viterbi 全候補同点化 → snap 不安定
    //   新: log(emission) = log(distScore) + log(headScore) + ... + log(attrBoost)
    //       Viterbi 比較は log 値で行う・c.emission は表示/diagnostic 用に exp で復元
    //   各 score が 0 に近い場合は -Infinity 回避のため LOG_FLOOR で clamp
    const LOG_FLOOR = -50; // exp(-50) ≈ 1.9e-22 で Float64 安全圏
    function _safeLog(x) {
      return x <= 0 ? LOG_FLOOR : Math.max(LOG_FLOOR, Math.log(x));
    }
    const logEmission =
      _safeLog(distScore) +
      _safeLog(headScore) +
      _safeLog(mahalScore) +
      _safeLog(typeScore) +
      _safeLog(layerScore) +
      _safeLog(phBoost) +
      _safeLog(attrBoost);
    c.logEmission = logEmission;
    // 互換性のため emission も持つ (Viterbi 内では logEmission を優先利用)
    c.emission = Math.exp(logEmission);
  }
  return cands;
}

// ─── 多候補 snap（loadedPrefs 横断） ────────────────────────────
function _snapAllAcrossPrefs(lat, lng, accuracy) {
  if (loadedPrefs.size === 0) return [];
  // maxM は GPS accuracy × 1.5（最小30m・最大100m）で動的化
  const acc = typeof accuracy === 'number' && accuracy > 0 ? accuracy : 20;
  const maxM = Math.max(30, Math.min(100, acc * 1.5));
  const all = [];
  for (const pref of loadedPrefs) {
    const dec = decoders.get(pref);
    if (!dec || !dec.snapAllWithin) continue;
    const cands = dec.snapAllWithin(lat, lng, { maxDistM: maxM, K: 8 });
    for (let i = 0; i < cands.length; i++) {
      cands[i].prefecture = pref;
      all.push(cands[i]);
    }
  }
  all.sort(function (a, b) {
    return a.distanceM - b.distanceM;
  });
  return all.slice(0, 8);
}

// ─── 単一 snap（fallback / MM-1 互換） ──────────────────────────
function _snapAcrossPrefs(lat, lng) {
  if (loadedPrefs.size === 0) return null;
  let best = null,
    bestPref = null;
  for (const pref of loadedPrefs) {
    const dec = decoders.get(pref);
    if (!dec) continue;
    const s = dec.snapToNearestRoad(lat, lng, { maxDistM: MM_MAX_SNAP_DIST_M });
    if (s && (!best || s.distanceM < best.distanceM)) {
      best = s;
      bestPref = pref;
    }
  }
  if (best) best.prefecture = bestPref;
  return best;
}

// ─── MM-4b: road-graph デコード ─────────────────────────────────
// main から postMessage で受信した base64 を TypedArray に展開
function _b64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const buf = new ArrayBuffer(len);
  const view = new Uint8Array(buf);
  for (let i = 0; i < len; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

// バックボーン graph デコーダー (2026-05-09 簡素化):
//   入力は build-road-graph-backbone-jp.js が出力する CSR のみ
//   nodeLat/Lng/nodeOffset/edgeTo/edgeLenM(Uint16 ×0.1m)/edgeFlags
//   shortcut/edgeRoad/edgeSeg/nodeLevel/roadOffset 系は使用しない
function _decodeGraphData(g) {
  return {
    v: g.v || 1,
    prefecture: g.prefecture,
    precision: g.precision || 1e5,
    numNodes: g.numNodes,
    numEdges: g.numEdges,
    nodeLat: new Int32Array(_b64ToArrayBuffer(g.nodeLatB64)),
    nodeLng: new Int32Array(_b64ToArrayBuffer(g.nodeLngB64)),
    nodeOffset: new Uint32Array(_b64ToArrayBuffer(g.nodeOffsetB64)),
    edgeTo: new Uint32Array(_b64ToArrayBuffer(g.edgeToB64)),
    edgeLenM: new Uint16Array(_b64ToArrayBuffer(g.edgeLenMB64)),
    edgeLenScale: typeof g.edgeLenScale === 'number' ? g.edgeLenScale : 0.1,
    edgeFlags: new Uint8Array(_b64ToArrayBuffer(g.edgeFlagsB64)),
  };
}

// graph の RAM サイズを概算（debug 用）
function _calcGraphMemBytes(g) {
  let bytes = 0;
  const fields = [
    'nodeLat',
    'nodeLng',
    'nodeOffset',
    'edgeTo',
    'edgeLenM',
    'edgeFlags',
    '_dist',
    '_visited',
  ];
  for (const k of fields) {
    const arr = g[k];
    if (arr && arr.byteLength) bytes += arr.byteLength;
  }
  return bytes;
}

// ─── 2026-05-09 追加: バックボーン graph 空間インデックス + nearest-node ──
// 用途: cross-prefecture routing の src/dst を backbone node に snap する
// 5km 度グリッドで O(1) 近傍 cell 取得 → cell 内 node 列を線形探索
const BACKBONE_GRID_DEG = 0.05; // 5km cell
const BACKBONE_NEAREST_MAX_DIST_M = 5000; // backbone 道路から 5km 以内のみ snap

function _buildBackboneSpatialIndex(g) {
  if (g._spatialGrid) return;
  const grid = new Map();
  const inv = Math.round(g.precision * BACKBONE_GRID_DEG);
  const N = g.numNodes;
  for (let i = 0; i < N; i++) {
    const gy = Math.floor(g.nodeLat[i] / inv);
    const gx = Math.floor(g.nodeLng[i] / inv);
    const key = gy + '_' + gx;
    let arr = grid.get(key);
    if (!arr) {
      arr = [];
      grid.set(key, arr);
    }
    arr.push(i);
  }
  g._spatialGrid = grid;
}

// A12 (2026-05-09): chord 距離に応じた動的探索半径
//   maxDistOverride を渡せば優先・未指定時は固定 5km
function _backboneNearestNode(snapLat, snapLng, maxDistOverride) {
  if (!_backboneGraph) return -1;
  _buildBackboneSpatialIndex(_backboneGraph);
  const g = _backboneGraph;
  const inv = Math.round(g.precision * BACKBONE_GRID_DEG);
  const latI = Math.round(snapLat * g.precision);
  const lngI = Math.round(snapLng * g.precision);
  const gy = Math.floor(latI / inv);
  const gx = Math.floor(lngI / inv);
  const mpd = _metersPerDegree(snapLat);
  const maxDist =
    typeof maxDistOverride === 'number' && maxDistOverride > 0
      ? maxDistOverride
      : BACKBONE_NEAREST_MAX_DIST_M;
  const maxSq = maxDist * maxDist;
  let bestIdx = -1,
    bestSq = Infinity;
  // 中心 + 近傍を maxDist に応じて拡張 (5km/grid なので Math.ceil(maxDist/5km)+1)
  const ringMax = Math.max(2, Math.ceil(maxDist / 5000) + 1);
  for (let r = 1; r <= ringMax; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r === 2 && Math.abs(dy) !== r && Math.abs(dx) !== r) continue; // 内側既見
        const arr = g._spatialGrid.get(gy + dy + '_' + (gx + dx));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const idx = arr[i];
          const nLat = g.nodeLat[idx] / g.precision;
          const nLng = g.nodeLng[idx] / g.precision;
          const dxm = (nLng - snapLng) * mpd.lng;
          const dym = (nLat - snapLat) * mpd.lat;
          const sq = dxm * dxm + dym * dym;
          if (sq < bestSq && sq <= maxSq) {
            bestSq = sq;
            bestIdx = idx;
          }
        }
      }
    }
    if (bestIdx >= 0) return bestIdx;
  }
  return bestIdx;
}

// shortcut を from-node 順に整列して CSR-like インデックスを構築
// shortcutOffset[v..v+1] が v 始点の shortcut の sortedShortcutIdx 区間
function _buildShortcutIndex(g) {
  if (g.shortcutOffset) return;
  const N = g.numNodes,
    S = g.numShortcuts;
  if (!S || !g.shortcutEdgeFrom) {
    g.shortcutOffset = new Uint32Array(N + 1);
    g.shortcutIndexByFrom = new Uint32Array(0);
    return;
  }
  const offsets = new Uint32Array(N + 1);
  for (let i = 0; i < S; i++) offsets[g.shortcutEdgeFrom[i] + 1]++;
  for (let v = 1; v <= N; v++) offsets[v] += offsets[v - 1];
  const cursor = new Uint32Array(N);
  const sorted = new Uint32Array(S);
  for (let i = 0; i < S; i++) {
    const v = g.shortcutEdgeFrom[i];
    sorted[offsets[v] + cursor[v]] = i;
    cursor[v]++;
  }
  g.shortcutOffset = offsets;
  g.shortcutIndexByFrom = sorted;
}

// ─── MM-4b: Binary Heap（Priority Queue） ─────────────────────
function BinaryHeap() {
  this.items = [];
}
BinaryHeap.prototype.push = function (node, priority) {
  const items = this.items;
  let i = items.length;
  items.push({ n: node, p: priority });
  while (i > 0) {
    const parent = (i - 1) >>> 1;
    if (items[parent].p <= items[i].p) break;
    const tmp = items[parent];
    items[parent] = items[i];
    items[i] = tmp;
    i = parent;
  }
};
BinaryHeap.prototype.pop = function () {
  const items = this.items;
  if (items.length === 0) return null;
  const top = items[0];
  const last = items.pop();
  if (items.length > 0) {
    items[0] = last;
    let i = 0;
    const len = items.length;
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      if (left < len && items[left].p < items[smallest].p) smallest = left;
      if (right < len && items[right].p < items[smallest].p) smallest = right;
      if (smallest === i) break;
      const tmp = items[smallest];
      items[smallest] = items[i];
      items[i] = tmp;
      i = smallest;
    }
  }
  return top;
};
BinaryHeap.prototype.size = function () {
  return this.items.length;
};

// ─── MM-4b: LRU キャッシュ（Map の挿入順を利用） ──────────────
function LRUCache(maxSize) {
  this.maxSize = maxSize;
  this.cache = new Map();
}
LRUCache.prototype.get = function (key) {
  if (!this.cache.has(key)) return undefined;
  const v = this.cache.get(key);
  this.cache.delete(key);
  this.cache.set(key, v);
  return v;
};
LRUCache.prototype.set = function (key, value) {
  if (this.cache.has(key)) this.cache.delete(key);
  this.cache.set(key, value);
  if (this.cache.size > this.maxSize) {
    const firstKey = this.cache.keys().next().value;
    this.cache.delete(firstKey);
  }
};
LRUCache.prototype.clear = function () {
  this.cache.clear();
};

const _routeCache = new LRUCache(ROUTE_CACHE_SIZE);

// ─── MM-4b: CH-Dijkstra + A* ヒューリスティック ───────────────
// graph の CSR + shortcut を辿る forward 探索
// CH 制約: nodeLevel が 高い方向のみ relax（仕様）
//   ただし src の level より低いノードへの relax も初期段階では許容しないと
//   到達不能になるため、既に到達済みのノードからは upward のみとする
//   実装簡略化のため: forward は全方向 relax + shortcut 利用で correctness 保証
//   （shortcut が冗長 path を提供するため Dijkstra でも最短到達できる）
// A*: priority = dist + h, h = haversine(node, dst) × 0.9（admissible）
function _chDijkstra(g, srcNode, dstNode, maxDistM, deadline) {
  if (srcNode < 0 || dstNode < 0 || srcNode >= g.numNodes || dstNode >= g.numNodes) return null;
  if (srcNode === dstNode) return 0;

  // 動的 dist / visited を pre-allocate（lazy）
  if (!g._dist || g._dist.length !== g.numNodes) {
    g._dist = new Float32Array(g.numNodes);
    g._visited = new Uint8Array(g.numNodes);
    g._touched = [];
  }
  const dist = g._dist;
  const visited = g._visited;
  const touched = g._touched;

  // touched-list reset で前回呼び出し分だけクリア（O(touched)）
  for (let i = 0; i < touched.length; i++) {
    dist[touched[i]] = Infinity;
    visited[touched[i]] = 0;
  }
  touched.length = 0;

  _buildShortcutIndex(g);

  const precision = g.precision || 1e5;
  const dstLat = g.nodeLat[dstNode] / precision;
  const dstLng = g.nodeLng[dstNode] / precision;

  dist[srcNode] = 0;
  touched.push(srcNode);

  const heap = new BinaryHeap();
  heap.push(srcNode, 0);

  let iters = 0;
  while (heap.size() > 0) {
    // タイムアウトチェック（64 反復ごと）
    if ((++iters & 0x3f) === 0 && deadline > 0 && performance.now() > deadline) return null;

    const top = heap.pop();
    const u = top.n;
    if (visited[u]) continue;
    visited[u] = 1;
    const du = dist[u];
    if (du > maxDistM) continue;
    if (u === dstNode) return du;

    // 通常 forward edges
    const eStart = g.nodeOffset[u];
    const eEnd = g.nodeOffset[u + 1];
    const lenScale = g.edgeLenScale || 1.0; // Phase A v=2 で 0.1 / v=1 で 1.0
    for (let k = eStart; k < eEnd; k++) {
      const v = g.edgeTo[k];
      if (visited[v]) continue;
      const newD = du + g.edgeLenM[k] * lenScale;
      if (newD < dist[v] && newD <= maxDistM) {
        dist[v] = newD;
        if (touched.length < 16384) touched.push(v);
        const h =
          _haversine(g.nodeLat[v] / precision, g.nodeLng[v] / precision, dstLat, dstLng) * 0.9;
        heap.push(v, newD + h);
      }
    }

    // CH shortcuts
    if (g.shortcutOffset) {
      const sStart = g.shortcutOffset[u];
      const sEnd = g.shortcutOffset[u + 1];
      for (let i = sStart; i < sEnd; i++) {
        const idx = g.shortcutIndexByFrom[i];
        const v = g.shortcutEdgeTo[idx];
        if (visited[v]) continue;
        const newD = du + g.shortcutEdgeLenM[idx];
        if (newD < dist[v] && newD <= maxDistM) {
          dist[v] = newD;
          if (touched.length < 16384) touched.push(v);
          const h =
            _haversine(g.nodeLat[v] / precision, g.nodeLng[v] / precision, dstLat, dstLng) * 0.9;
          heap.push(v, newD + h);
        }
      }
    }
  }
  return null; // unreachable within budget / timeout
}

// ─── Phase B runtime: route 距離計算
// 優先順序: 同road=polyline → tile Dijkstra → 既存 graph → backbone → haversine
// すべて失敗時は haversine 弦距離を返す（業務継続性担保）
function _routeDistance(a, b) {
  if (!a || !b) return null;
  // 同 road → polyline 沿い距離（既存・最も正確）
  if (a.prefecture === b.prefecture && a.roadIndex === b.roadIndex) {
    const dec = decoders.get(a.prefecture);
    if (dec) {
      const r = dec.calcRoadDistance(a, b);
      if (r) {
        r._via = 'polyline';
        // T1 (2026-05-09): DEM 3D 補正・両端の標高差を加味
        r.distanceM = _apply3DCorrection(r.distanceM, a.snapLat, a.snapLng, b.snapLat, b.snapLng);
        return r;
      }
    }
  }
  // Phase B: タイル経路を最優先で試行（メモリ効率最重視）
  const tileResult = _routeDistanceTileFirst(a, b);
  if (tileResult) {
    tileResult.distanceM = _apply3DCorrection(
      tileResult.distanceM,
      a.snapLat,
      a.snapLng,
      b.snapLat,
      b.snapLng
    );
    return tileResult;
  }

  const chordM = _haversine(a.snapLat, a.snapLng, b.snapLat, b.snapLng);

  // 2026-05-09: backbone graph による cross-prefecture routing
  //   src/dst それぞれを backbone 上で nearest-node に snap し、
  //   両 node 間を A* で最短経路探索する。
  //   - 検索半径: chord × 1.5 + 5km (寄り道含む実走の上限)
  //   - LRU キャッシュ参照可・キーは backbone node id ペア
  //   - タイムアウトは DIJKSTRA_TIMEOUT_MS (3ms) で打ち切り → haversine fallback
  if (_backboneGraph) {
    // A12 (2026-05-09): chord×2 + 5km で動的拡張・遠距離 cross-pref ほど広く
    const dynMax = chordM * 2 + 5000;
    const srcN = _backboneNearestNode(a.snapLat, a.snapLng, dynMax);
    const dstN = _backboneNearestNode(b.snapLat, b.snapLng, dynMax);
    if (srcN >= 0 && dstN >= 0) {
      const cacheKey = 'bb:' + srcN + '|' + dstN;
      const cached = _routeCache.get(cacheKey);
      if (cached !== undefined) return cached;
      // src/dst 各々の snap 点 → backbone node 距離を加算 (両 stub 区間)
      const stubA = _haversine(
        a.snapLat,
        a.snapLng,
        _backboneGraph.nodeLat[srcN] / _backboneGraph.precision,
        _backboneGraph.nodeLng[srcN] / _backboneGraph.precision
      );
      const stubB = _haversine(
        b.snapLat,
        b.snapLng,
        _backboneGraph.nodeLat[dstN] / _backboneGraph.precision,
        _backboneGraph.nodeLng[dstN] / _backboneGraph.precision
      );
      const maxDistM = chordM * 1.5 + 5000;
      const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
      const deadline = t0 + DIJKSTRA_TIMEOUT_MS;
      const inner = _chDijkstra(_backboneGraph, srcN, dstN, maxDistM, deadline);
      if (inner != null) {
        let distM = inner + stubA + stubB;
        // T1: 補正 (両端の DEM から)
        distM = _apply3DCorrection(distM, a.snapLat, a.snapLng, b.snapLat, b.snapLng);
        const result = { distanceM: distM, onSameRoad: false, _via: 'backbone' };
        _routeCache.set(cacheKey, result);
        return result;
      }
      // Dijkstra failed (timeout or unreachable) → haversine fallback
    }
  }

  // 最終フォールバック: haversine 弦距離 (T1 補正付き)
  return {
    distanceM: _apply3DCorrection(chordM, a.snapLat, a.snapLng, b.snapLat, b.snapLng),
    onSameRoad: false,
    _via: 'haversine',
  };
}

// MM-2 互換用 _calcSnapDistance（Viterbi 不在時の fallback 経路で使用）
// Catmull-Rom 4 点バッファが揃っていれば曲線長・なければ haversine 弦距離
function _calcSnapDistance(a, b) {
  if (!a || !b) return null;
  if (a.prefecture !== b.prefecture) {
    const cr = _tryCatmullRomLength();
    if (cr != null) return { distanceM: cr, onSameRoad: false, _via: 'catmull-rom' };
    return {
      distanceM: _haversine(a.snapLat, a.snapLng, b.snapLat, b.snapLng),
      onSameRoad: false,
      _via: 'haversine',
    };
  }
  const dec = decoders.get(a.prefecture);
  if (!dec) return null;
  if (a.roadIndex !== b.roadIndex) {
    const cr = _tryCatmullRomLength();
    if (cr != null) return { distanceM: cr, onSameRoad: false, _via: 'catmull-rom' };
    return {
      distanceM: _haversine(a.snapLat, a.snapLng, b.snapLat, b.snapLng),
      onSameRoad: false,
      _via: 'haversine',
    };
  }
  const r = dec.calcRoadDistance(a, b);
  if (r) {
    r._via = 'polyline';
  }
  return r;
}

// バッファに 4 点あれば Catmull-Rom 曲線長を返す（MM-2 fallback 用）
function _tryCatmullRomLength() {
  if (_gpsBuffer.length < _GPS_BUFFER_SIZE) return null;
  return _curveLength4(_gpsBuffer[0], _gpsBuffer[1], _gpsBuffer[2], _gpsBuffer[3]);
}

// ─── MM-3: 一方通行違反検出 ────────────────────────────────────
// curr が一方通行で、進行が逆方向に向かっていれば true
//   - 同一道路上: segmentIndex 後退 or 同 segment 内 t 後退（>0.05）→ 違反
//   - 別道路: 移動方向 vs curr の segment 順方向 を 90° 超で違反
function _violatesOneway(prev, curr, prevGps, currGps) {
  if (!curr || !curr.oneway) return false;
  // 同一 road・同 pref → segment/t の方向で判定
  if (prev && prev.prefecture === curr.prefecture && prev.roadIndex === curr.roadIndex) {
    if (curr.segmentIndex < prev.segmentIndex) return true;
    if (curr.segmentIndex === prev.segmentIndex && curr.t < prev.t - 0.05) return true;
    return false;
  }
  // 別 road → GPS 移動方向 vs curr segment 順方向（90° 超ペナルティ）
  if (prevGps && currGps) {
    const movementBearing = _segmentBearing(prevGps.lat, prevGps.lng, currGps.lat, currGps.lng);
    const segBearing = _segmentBearing(curr.segLatA, curr.segLngA, curr.segLatB, curr.segLngB);
    if (_angleDiff(movementBearing, segBearing) > 90) return true;
  }
  return false;
}

// ─── MM-7: 蟻コロニー Pheromone（路網習熟）────────────────────
// 各 pref の roadIndex ごとに float32 のフェロモン値を持つ。
// snap 成功時に +1・1 乗務終了（reset）時に ×0.95 で蒸発。
// 候補生成時の emission に (1 + log(1 + pheromone)) で乗算 → 常用ルートを優先。
const _pheromoneByPref = new Map(); // pref → Float32Array(numRoads)
const PHEROMONE_EVAPORATION = 0.95;
const PHEROMONE_INC = 1.0;
const PHEROMONE_BOOST_CAP = 3.0; // log boost が暴走しないように上限 ×3

function _ensurePheromone(pref, numRoads) {
  if (_pheromoneByPref.has(pref)) return _pheromoneByPref.get(pref);
  const arr = new Float32Array(numRoads);
  _pheromoneByPref.set(pref, arr);
  return arr;
}

function _markPheromone(pref, roadIndex) {
  if (!pref) return;
  const arr = _pheromoneByPref.get(pref);
  if (!arr || roadIndex < 0 || roadIndex >= arr.length) return;
  arr[roadIndex] += PHEROMONE_INC;
}

function _getPheromoneBoost(pref, roadIndex) {
  if (!pref) return 1.0;
  const arr = _pheromoneByPref.get(pref);
  if (!arr || roadIndex < 0 || roadIndex >= arr.length) return 1.0;
  const ph = arr[roadIndex];
  if (ph <= 0) return 1.0;
  const boost = 1.0 + Math.log(1.0 + ph);
  return boost > PHEROMONE_BOOST_CAP ? PHEROMONE_BOOST_CAP : boost;
}

function _evaporatePheromones() {
  for (const arr of _pheromoneByPref.values()) {
    for (let i = 0; i < arr.length; i++) arr[i] *= PHEROMONE_EVAPORATION;
  }
}

function _countActivePheromoneRoads() {
  let total = 0;
  for (const arr of _pheromoneByPref.values()) {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] > 0.01) total++;
    }
  }
  return total;
}

// ─── MM-7: 地域別 GPS 誤差学習（500m × 500m grid bias） ────────
// snap 成功時の (gpsLat - snapLat, gpsLng - snapLng) を grid 単位で蓄積。
// 1000 サンプル超のセルは emission の σ を補正（地域固有 GPS bias を吸収）。
// IndexedDB 永続保存。サイズ上限 5MB（200k entry 相当）でそれ以上は古いセル順に discard。
const GRID_DEG = 0.005; // 約 500m × 500m
const GRID_MIN_SAMPLES = 1000; // この件数超で σ 補正発動
const GRID_MAX_CELLS = 200000; // 5MB 以内（24 bytes/cell × 200k = 4.8MB）
// stats 配列レイアウト (Float32 × 5): [count, sumDxM, sumDyM, sumDx2M2, sumDy2M2]
const GRID_FIELDS = 5;
const _gridBias = new Map(); // gridKey:string → Float32Array(GRID_FIELDS)

function _gridKey(lat, lng) {
  const gy = Math.floor(lat / GRID_DEG);
  const gx = Math.floor(lng / GRID_DEG);
  return gy + '_' + gx;
}

// M7 (2026-05-09): 真の LRU eviction
//   旧: 最古「挿入」順削除 (FIFO・頻繁訪問セルが消えるリスク)
//   新: 各 cell をアクセス時に delete + re-insert で末尾へ移動 (touch)
//       Map iteration は insertion order なので keys().next() が真の oldest になる
//   オーバーヘッド: アクセス毎の delete + set 操作・~100ns / call で許容
function _recordGridBiasSample(gpsLat, gpsLng, snapLat, snapLng) {
  const key = _gridKey(gpsLat, gpsLng);
  let cell = _gridBias.get(key);
  if (!cell) {
    if (_gridBias.size >= GRID_MAX_CELLS) {
      // 上限到達: 真の oldest (最後にアクセスされたのが一番古い) を削除
      const first = _gridBias.keys().next();
      if (!first.done) _gridBias.delete(first.value);
    }
    cell = new Float32Array(GRID_FIELDS);
  } else {
    // M7 touch: 既存 cell を末尾へ移動 (LRU 順を維持)
    _gridBias.delete(key);
  }
  _gridBias.set(key, cell);
  const mpd = _metersPerDegree(gpsLat);
  const dxM = (gpsLng - snapLng) * mpd.lng;
  const dyM = (gpsLat - snapLat) * mpd.lat;
  cell[0] += 1;
  cell[1] += dxM;
  cell[2] += dyM;
  cell[3] += dxM * dxM;
  cell[4] += dyM * dyM;
}

// セルが学習済（≥1000 samples）なら σ 補正係数を返す（>=1.0）
// 補正後 σ_corrected = σ × multiplier
function _getGridSigmaMultiplier(gpsLat, gpsLng) {
  const key = _gridKey(gpsLat, gpsLng);
  const cell = _gridBias.get(key);
  if (!cell || cell[0] < GRID_MIN_SAMPLES) return 1.0;
  // M7: read touch (LRU 順維持・GRID_MIN_SAMPLES 超の頻繁参照セルを保護)
  _gridBias.delete(key);
  _gridBias.set(key, cell);
  const n = cell[0];
  const meanX = cell[1] / n;
  const meanY = cell[2] / n;
  const varX = cell[3] / n - meanX * meanX;
  const varY = cell[4] / n - meanY * meanY;
  const stddev = Math.sqrt(Math.max(0, varX) + Math.max(0, varY));
  // σ は 4 + 0.5 × accuracy で典型 14m 程度。
  // この grid の実測 stddev が 20m なら σ を ×1.4 倍する
  if (stddev <= 0) return 1.0;
  const baseSigma = 14.0;
  const mult = stddev / baseSigma;
  return mult < 1.0 ? 1.0 : mult > 3.0 ? 3.0 : mult; // [1.0, 3.0] でクランプ
}

// ─── MM-7: IndexedDB 永続化（pheromone + grid_bias） ────────────
const _DB_NAME = 'daikome_mm7';
const _DB_VERSION = 1;
let _dbPromise = null;

function _openDb() {
  if (_dbPromise) return _dbPromise;
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  _dbPromise = new Promise(function (resolve) {
    try {
      const req = indexedDB.open(_DB_NAME, _DB_VERSION);
      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('pheromone')) {
          db.createObjectStore('pheromone', { keyPath: 'pref' });
        }
        if (!db.objectStoreNames.contains('gridBias')) {
          db.createObjectStore('gridBias', { keyPath: 'k' });
        }
      };
      req.onsuccess = function (e) {
        resolve(e.target.result);
      };
      req.onerror = function () {
        resolve(null);
      };
    } catch (e) {
      resolve(null);
    }
  });
  return _dbPromise;
}

function _savePheromoneAll() {
  return _openDb()
    .then(function (db) {
      if (!db) return;
      try {
        const tx = db.transaction('pheromone', 'readwrite');
        const store = tx.objectStore('pheromone');
        for (const [pref, arr] of _pheromoneByPref) {
          store.put({ pref: pref, data: arr.buffer });
        }
      } catch (e) {}
    })
    .catch(function () {});
}

function _loadPheromoneFor(pref, numRoads) {
  return _openDb()
    .then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          const tx = db.transaction('pheromone', 'readonly');
          const req = tx.objectStore('pheromone').get(pref);
          req.onsuccess = function () {
            if (req.result && req.result.data) {
              const restored = new Float32Array(req.result.data);
              // numRoads 不一致時は同サイズ確保で truncate or pad（roads データ更新時の保険）
              if (restored.length === numRoads) {
                _pheromoneByPref.set(pref, restored);
              } else {
                const arr = new Float32Array(numRoads);
                const lim = Math.min(numRoads, restored.length);
                for (let i = 0; i < lim; i++) arr[i] = restored[i];
                _pheromoneByPref.set(pref, arr);
              }
              resolve(_pheromoneByPref.get(pref));
            } else {
              resolve(null);
            }
          };
          req.onerror = function () {
            resolve(null);
          };
        } catch (e) {
          resolve(null);
        }
      });
    })
    .catch(function () {
      return null;
    });
}

function _saveGridBiasIncremental() {
  return _openDb()
    .then(function (db) {
      if (!db) return;
      try {
        const tx = db.transaction('gridBias', 'readwrite');
        const store = tx.objectStore('gridBias');
        // 全 entry 書き直し（write 量制御は後続最適化）
        for (const [key, arr] of _gridBias) {
          store.put({ k: key, d: arr.buffer });
        }
      } catch (e) {}
    })
    .catch(function () {});
}

function _loadGridBias() {
  return _openDb()
    .then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        try {
          const tx = db.transaction('gridBias', 'readonly');
          const req = tx.objectStore('gridBias').getAll();
          req.onsuccess = function () {
            const items = req.result || [];
            for (let i = 0; i < items.length; i++) {
              const it = items[i];
              if (it && it.k && it.d) {
                const arr = new Float32Array(it.d);
                if (arr.length === GRID_FIELDS) _gridBias.set(it.k, arr);
              }
            }
            resolve(_gridBias.size);
          };
          req.onerror = function () {
            resolve(0);
          };
        } catch (e) {
          resolve(0);
        }
      });
    })
    .catch(function () {
      return 0;
    });
}

// 起動時に grid bias を復元（pheromone は graph load 時に各 pref ごとに復元）
_loadGridBias();

// B9/B10 (2026-05-09): Pheromone / Grid bias を 5 分間隔で incremental save
//   タスクキル時の学習消失を防ぐ
//   reset 時の save とは独立・並行で動く
const PERSIST_INTERVAL_MS = 5 * 60 * 1000;
setInterval(function () {
  try {
    _savePheromoneAll();
  } catch (_) {}
  try {
    _saveGridBiasIncremental();
  } catch (_) {}
}, PERSIST_INTERVAL_MS);

// ─── MM-6: OSRM 教師信号 helpers ────────────────────────────────
function _addToOsrmBuffer(gps) {
  if (!_osrmEnabled) return;
  _osrmTraceBuffer.push({
    lat: gps.lat,
    lng: gps.lng,
    timestamp: gps.timestamp,
    accuracy: gps.accuracy || 20,
  });
  if (_osrmTraceBuffer.length > OSRM_MAX_BUFFER_SIZE) {
    _osrmTraceBuffer.shift();
  }
  const now = Date.now();
  if (
    now - _lastOsrmBatchAt >= OSRM_BATCH_INTERVAL_MS &&
    _osrmTraceBuffer.length >= OSRM_MIN_BATCH_POINTS &&
    !_osrmInflight
  ) {
    _lastOsrmBatchAt = now;
    _triggerOsrmBatch();
  }
}

function _triggerOsrmBatch() {
  if (_osrmInflight) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    // オフライン → 即スキップ
    return;
  }
  if (typeof self.OsrmClient === 'undefined' || !self.OsrmClient.matchBatch) return;
  const trace = _osrmTraceBuffer.slice();
  _osrmInflight = true;
  self.OsrmClient.matchBatch(trace)
    .then((result) => {
      _osrmInflight = false;
      _osrmTeacher.batches++;
      if (result && result.ok && result.legs && result.legs.length > 0) {
        _osrmTeacher.trace = trace;
        _osrmTeacher.legs = result.legs;
        _osrmTeacher.expiresAt = Date.now() + OSRM_TEACHER_TTL_MS;
      } else {
        _osrmTeacher.batchFails++;
        // 失敗時は教師信号を更新しない（既存の有効期限内の信号は維持）
      }
    })
    .catch(() => {
      _osrmInflight = false;
      _osrmTeacher.batchFails++;
    });
}

// 隣接 GPS 観測ペア間の OSRM 教師距離を返す（無ければ null）
// timestamps を厳密一致でマッチング・連続インデックスのみ返す
function _osrmTeacherDist(prevGps, currGps) {
  if (!_osrmTeacher.legs.length) return null;
  if (Date.now() > _osrmTeacher.expiresAt) return null;
  const trace = _osrmTeacher.trace;
  let prevIdx = -1,
    currIdx = -1;
  for (let i = 0; i < trace.length; i++) {
    if (trace[i].timestamp === prevGps.timestamp) prevIdx = i;
    if (trace[i].timestamp === currGps.timestamp) currIdx = i;
    if (prevIdx >= 0 && currIdx >= 0) break;
  }
  if (prevIdx < 0 || currIdx < 0) {
    _osrmTeacher.misses++;
    return null;
  }
  // 連続インデックスのみ（leg は隣接ペア間で定義される）
  if (currIdx - prevIdx !== 1) {
    _osrmTeacher.misses++;
    return null;
  }
  const legM = _osrmTeacher.legs[prevIdx];
  if (typeof legM !== 'number' || legM < 0) {
    _osrmTeacher.misses++;
    return null;
  }
  _osrmTeacher.hits++;
  return legM;
}

// ─── MM-3: 遷移確率（HMM transition score） ───────────────────
// score = exp(-|routeDist - chordDist| / β)・β = 30m
// oneway 違反は ×0.05 で事実上除外
function _transitionScore(prevSnapC, currSnapC, prevGps, currGps) {
  const chordM = _haversine(prevGps.lat, prevGps.lng, currGps.lat, currGps.lng);
  const r = _routeDistance(prevSnapC, currSnapC);
  let routeM = r ? r.distanceM : chordM;

  // MM-6: OSRM 教師信号があれば weighted blend で routing 距離を補正
  // 教師信号 0.7 + 自前 routing 0.3（OSRM をより信頼）
  // mm_distance_m への直接代入は禁止・transition score の補正にのみ使用
  const teacherM = _osrmTeacherDist(prevGps, currGps);
  if (teacherM != null) {
    routeM = OSRM_BLEND_WEIGHT * teacherM + (1 - OSRM_BLEND_WEIGHT) * routeM;
  }

  let score = Math.exp(-Math.abs(routeM - chordM) / TRANSITION_BETA_M);
  if (_violatesOneway(prevSnapC, currSnapC, prevGps, currGps)) {
    score *= ONEWAY_PENALTY;
  }
  // T4 (2026-05-09): turn:restriction 違反 (右折/直進禁止等) にペナルティ
  //   roads-{pref}.js の restrictions[] に [fromIdx, toIdx] が登録されていれば違反
  //   prev/curr が同 pref 異 road の遷移時のみ判定 (road 内移動は対象外)
  if (
    prevSnapC &&
    currSnapC &&
    prevSnapC.prefecture &&
    prevSnapC.prefecture === currSnapC.prefecture &&
    prevSnapC.roadIndex !== currSnapC.roadIndex
  ) {
    const dec = decoders.get(prevSnapC.prefecture);
    if (
      dec &&
      typeof dec.isRestrictedTransition === 'function' &&
      dec.isRestrictedTransition(prevSnapC.roadIndex, currSnapC.roadIndex)
    ) {
      score *= TURN_RESTRICTION_PENALTY;
    }
  }
  // T11 (2026-05-09): 時間帯条件付き oneway / 通行制限
  //   現在時刻が制限窓内かつ curr road が制限対象なら ×0.05 で除外
  //   currGps.timestamp を時刻ソースに使用 (実測値)
  if (currSnapC && currSnapC.prefecture && currGps && currGps.timestamp) {
    const cond = _isUnderConditionalRestriction(
      currSnapC.prefecture,
      currSnapC.roadIndex,
      currGps.timestamp
    );
    if (cond === 'no_through' || cond === 'oneway') {
      // oneway 違反は既に _violatesOneway で見るため、ここでは no_through 主体
      score *= TURN_RESTRICTION_PENALTY;
    }
  }
  // T8 (2026-05-09): cross-user pheromone (+10%)
  //   curr 候補が他ドライバ走行頻度が高い道路なら transition score を boost
  //   未連携時は _getCrossUserBoost が 1.0 → 影響なし
  if (currSnapC && currSnapC.prefecture && currSnapC.roadIndex != null) {
    score *= _getCrossUserBoost(currSnapC.prefecture, currSnapC.roadIndex);
  }
  // 数値安全化（log(0) 防止）
  return score < 1e-10 ? 1e-10 : score;
}

// ─── MM-3: ViterbiMatcher（窓 N=5・最尤候補チェーン推定） ─────
// step = { gps, cands: [{ c, score, back }] }
//   c     : 候補 snap オブジェクト
//   score : 累積対数確率 = sum(log(emission) + log(transition))
//   back  : 1 つ前ステップの cands index（バックトレース用）
function ViterbiMatcher(N) {
  this.N = N;
  this.steps = [];
}
ViterbiMatcher.prototype.size = function () {
  return this.steps.length;
};

ViterbiMatcher.prototype.reset = function () {
  this.steps = [];
};

// 1 ステップ追加。窓が溢れたら最古を確定 commit して返す。
// 戻り値: 確定された snap | null（commit なし）
ViterbiMatcher.prototype.push = function (gps, candidates, transitionFn) {
  if (!candidates || candidates.length === 0) return null;
  if (this.steps.length === 0) {
    // 初期ステップ：累積 = logEmission のみ・back=-1
    // M1 (2026-05-09): logEmission を直接使用 (再 log 取得不要・桁落ち防止)
    const cs = new Array(candidates.length);
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const eLog = c.logEmission != null ? c.logEmission : Math.log(c.emission + 1e-12);
      cs[i] = { c: c, score: eLog, back: -1 };
    }
    this.steps.push({ gps: gps, cands: cs });
    return null;
  }
  // 通常ステップ：前ステップ × 全候補で transition を評価
  const prev = this.steps[this.steps.length - 1];
  const newCands = new Array(candidates.length);
  for (let j = 0; j < candidates.length; j++) {
    const cand = candidates[j];
    // M1: logEmission 優先・後方互換で emission からも fall back
    const eLog = cand.logEmission != null ? cand.logEmission : Math.log(cand.emission + 1e-12);
    let bestScore = -Infinity;
    let bestBack = -1;
    for (let i = 0; i < prev.cands.length; i++) {
      const trans = transitionFn(prev.cands[i].c, cand, prev.gps, gps);
      const tLog = Math.log(trans);
      const sc = prev.cands[i].score + eLog + tLog;
      if (sc > bestScore) {
        bestScore = sc;
        bestBack = i;
      }
    }
    newCands[j] = { c: cand, score: bestScore, back: bestBack };
  }
  this.steps.push({ gps: gps, cands: newCands });
  // 窓溢れ → 最古を確定
  // M3 (2026-05-09): top-2 path 評価で confidence ギャップ小なら commit を遅延
  //   合流・分岐で top-1 と top-2 のスコアが拮抗時に誤確定するのを防止
  //   ギャップ閾値 < 0.5 log-space (= 60% 程度の確率比) で 2*N まで延長許容
  if (this.steps.length > this.N) {
    const last = this.steps[this.steps.length - 1];
    let topScore = -Infinity,
      top2Score = -Infinity;
    for (let i = 0; i < last.cands.length; i++) {
      const s = last.cands[i].score;
      if (s > topScore) {
        top2Score = topScore;
        topScore = s;
      } else if (s > top2Score) {
        top2Score = s;
      }
    }
    const COMMIT_GAP = 0.5;
    const MAX_DEFER_FACTOR = 2;
    const gap = topScore - top2Score;
    if (gap < COMMIT_GAP && this.steps.length < this.N * MAX_DEFER_FACTOR) {
      // 遅延 commit (top-1 / top-2 拮抗中・将来 step で disambiguate 期待)
      return null;
    }
    return this._commitOldest();
  }
  return null;
};

// 窓末尾から最高スコアチェーンをバックトレースし path[] を返す
ViterbiMatcher.prototype._backtrace = function () {
  if (this.steps.length === 0) return [];
  const last = this.steps[this.steps.length - 1];
  let bestIdx = 0;
  for (let i = 1; i < last.cands.length; i++) {
    if (last.cands[i].score > last.cands[bestIdx].score) bestIdx = i;
  }
  const path = new Array(this.steps.length);
  for (let t = this.steps.length - 1; t >= 0; t--) {
    const node = this.steps[t].cands[bestIdx];
    path[t] = node.c;
    bestIdx = node.back;
    if (bestIdx < 0) {
      // 残り未確定 → 残ステップは null（呼び出し側で扱う）
      for (let u = t - 1; u >= 0; u--) path[u] = null;
      break;
    }
  }
  return path;
};

// 最古ステップを確定（path[0]）し shift。新先頭の back は -1 に切る。
// 戻り値: snap オブジェクト + observationTimestamp（呼び出し側 dt 判定用）
ViterbiMatcher.prototype._commitOldest = function () {
  if (this.steps.length === 0) return null;
  const oldestGps = this.steps[0].gps;
  const path = this._backtrace();
  const oldest = path[0];
  let result = null;
  if (oldest) {
    result = Object.assign({}, oldest, {
      observationTimestamp: oldestGps ? oldestGps.timestamp : null,
    });
  }
  this.steps.shift();
  if (this.steps.length > 0) {
    const head = this.steps[0].cands;
    for (let i = 0; i < head.length; i++) head[i].back = -1;
  }
  return result;
};

// 残窓全体を確定して path[] を返す（業務終了時の reset 前に呼ぶ）
// 各要素は snap + observationTimestamp を持つ
ViterbiMatcher.prototype.flush = function () {
  const stepsSnapshot = this.steps.slice();
  const path = this._backtrace();
  this.steps = [];
  const out = [];
  for (let i = 0; i < path.length; i++) {
    if (path[i]) {
      out.push(
        Object.assign({}, path[i], {
          observationTimestamp: stepsSnapshot[i].gps ? stepsSnapshot[i].gps.timestamp : null,
        })
      );
    }
  }
  return out;
};

// MM-3 / MM-7: Viterbi インスタンス（reset で使い回し・N=15 で開始）
const viterbi = new ViterbiMatcher(_viterbiN);

// 実機デバッグログ (2026-05-09 追加・既定 OFF)
//   true で gps 受信・候補スコア・mmResult を console.log 出力
//   index.html → configDebug メッセージで動的切替・通常運用は OFF 維持
let _mmDebug = false;
function _dbg() {
  if (!_mmDebug) return;
  const args = ['[MM]'];
  for (let i = 0; i < arguments.length; i++) args.push(arguments[i]);
  try {
    console.log.apply(console, args);
  } catch (_) {}
}

// ★設計変更宣言 (2026-05-13・大改修 C5): 全国共通 coarse data (粗粒度 POI/地形)
//   data-registry.js から data-loader 経由で msgType='loadCoarse' で受信
//   将来的に snap 事前フィルタ (50km 圏外候補除外) で活用予定
//   現段階は受信 + 保存のみ・利用ロジックは別 commit
let _coarseData = null;

// ★設計変更宣言 (2026-05-13・大改修 C6): 全国共通 pref-borders data (47 県境界)
//   msgType='loadPrefBorders' で受信
//   将来的に county 跨ぎ判定 smooth 化で活用予定 (重心距離→真の境界判定)
let _prefBordersData = null;

// ★設計変更宣言 (2026-05-13・大改修 C7): 全国共通 highways data (高速道路概略)
//   msgType='loadHighways' で受信
//   将来的に粗→詳 階層 snap (粗 highways → 詳 roads-{pref}) で latency 改善
let _highwaysData = null;

// ★設計変更宣言 (2026-05-13・大改修 C8): 全国共通 coastline data (海岸線)
//   msgType='loadCoastline' で受信
//   将来的に GPS 海上 jump 検知 (海岸線越え) で emission penalty 強化
let _coastlineData = null;

// ★設計変更宣言 (2026-05-13・大改修 C9): 全国共通 railways data (鉄道)
//   msgType='loadRailways' で受信
//   将来的に電車 GPS 検知 (線路上を高速移動) で代行業務外と判定・mmResult.skipped
let _railwaysData = null;

// ─── メッセージハンドラ ─────────────────────────────────────────
self.onmessage = function (e) {
  const msg = e.data;
  if (!msg || !msg.type) return;

  // 実機デバッグログ ON/OFF
  if (msg.type === 'configDebug') {
    _mmDebug = !!msg.enabled;
    self.postMessage({ type: 'debugConfigured', enabled: _mmDebug });
    return;
  }

  // G6 (2026-05-09): プラットフォーム情報受領 (iOS 検出時に Viterbi N を切替)
  if (msg.type === 'configPlatform') {
    if (msg.isIOS && !_platformIsIOS) {
      _platformIsIOS = true;
      _viterbiN = VITERBI_N_MIN; // iOS は最小窓幅で warmup 短縮
      if (viterbi) viterbi.N = _viterbiN;
      _viterbiShrunkAt = Date.now();
      _viterbiShrinkLogged = true; // 自動 shrink 検出を抑止 (既に MIN なので)
      self.postMessage({
        type: 'platformConfigured',
        isIOS: true,
        viterbiN: _viterbiN,
        _reason: 'iOS 1Hz GPS detected → N=10 default',
      });
    } else if (!msg.isIOS && _platformIsIOS) {
      // iOS フラグ解除 (異例だが後方互換)
      _platformIsIOS = false;
      _viterbiN = VITERBI_N_MAX;
      if (viterbi) viterbi.N = _viterbiN;
      _viterbiShrunkAt = 0;
      _viterbiShrinkLogged = false;
    }
    return;
  }

  // 県データ受け取り
  if (msg.type === 'loadRoads') {
    try {
      if (loadedPrefs.has(msg.pref)) {
        self.postMessage({
          type: 'roadsLoaded',
          pref: msg.pref,
          ok: true,
          numRoads: decoders.get(msg.pref).numRoads,
          _reason: 'already loaded',
        });
        return;
      }
      const dec = new self.RoadDecoder(msg.roadsData);
      dec.buildOffsetTable();
      decoders.set(msg.pref, dec);
      loadedPrefs.add(msg.pref);
      self.postMessage({
        type: 'roadsLoaded',
        pref: msg.pref,
        ok: true,
        numRoads: dec.numRoads,
      });
    } catch (err) {
      self.postMessage({
        type: 'roadsLoaded',
        pref: msg.pref,
        ok: false,
        error: err.message,
      });
    }
    return;
  }

  // T3 (2026-05-09): POI ロード
  //   msg.points: [[lat, lng], ...] (種別問わず全 POI を一括)
  if (msg.type === 'loadPois') {
    if (msg.pref && Array.isArray(msg.points)) {
      _setPois(msg.pref, msg.points);
      self.postMessage({ type: 'poisLoaded', pref: msg.pref, count: msg.points.length });
    }
    return;
  }

  // T11 (2026-05-09): 時間帯条件付き制限ロード
  //   msg.list: [{ roadIndex, startMin, endMin, days?, kind }]
  if (msg.type === 'loadConditionalRestrictions') {
    if (msg.pref && Array.isArray(msg.list)) {
      _setConditionalRestrictions(msg.pref, msg.list);
      self.postMessage({
        type: 'conditionalRestrictionsLoaded',
        pref: msg.pref,
        count: msg.list.length,
      });
    }
    return;
  }

  // T8 (2026-05-09): Firebase 経由の cross-user pheromone 更新
  //   msg.list: [{ roadIndex, count }, ...]
  if (msg.type === 'updateCrossUserPheromone') {
    if (msg.pref && Array.isArray(msg.list)) {
      _setCrossUserPheromone(msg.pref, msg.list);
      self.postMessage({
        type: 'crossUserPheromoneUpdated',
        pref: msg.pref,
        count: msg.list.length,
      });
    }
    return;
  }

  // ★設計変更宣言 (2026-05-13・大改修 C5): 全国共通 coarse data 受信
  //   msg.data: COARSE_JP 構造体 (粗粒度 POI/地形・全国カバー)
  //   現段階は保存のみ・将来 snap 事前フィルタで活用
  if (msg.type === 'loadCoarse') {
    if (msg.data) {
      _coarseData = msg.data;
      self.postMessage({ type: 'coarseLoaded', ok: true });
    } else {
      self.postMessage({ type: 'coarseLoaded', ok: false, _reason: 'no data' });
    }
    return;
  }

  // ★設計変更宣言 (2026-05-13・大改修 C6): 全国共通 pref-borders data 受信
  //   msg.data: PREF_BORDERS_JP 構造体 (47 県境界 polygon)
  //   現段階は保存のみ・将来 county 跨ぎ判定 smooth 化で活用
  if (msg.type === 'loadPrefBorders') {
    if (msg.data) {
      _prefBordersData = msg.data;
      self.postMessage({ type: 'prefBordersLoaded', ok: true });
    } else {
      self.postMessage({ type: 'prefBordersLoaded', ok: false, _reason: 'no data' });
    }
    return;
  }

  // ★設計変更宣言 (2026-05-13・大改修 C7): 全国共通 highways data 受信
  //   msg.data: HIGHWAYS_JP 構造体 (高速道路概略 polyline)
  //   現段階は保存のみ・将来 粗→詳 階層 snap で latency 改善
  if (msg.type === 'loadHighways') {
    if (msg.data) {
      _highwaysData = msg.data;
      self.postMessage({ type: 'highwaysLoaded', ok: true });
    } else {
      self.postMessage({ type: 'highwaysLoaded', ok: false, _reason: 'no data' });
    }
    return;
  }

  // ★設計変更宣言 (2026-05-13・大改修 C8): 全国共通 coastline data 受信
  //   msg.data: COASTLINE_JP 構造体 (海岸線 polyline)
  //   現段階は保存のみ・将来 GPS 海上 jump 検知で emission penalty 強化
  if (msg.type === 'loadCoastline') {
    if (msg.data) {
      _coastlineData = msg.data;
      self.postMessage({ type: 'coastlineLoaded', ok: true });
    } else {
      self.postMessage({ type: 'coastlineLoaded', ok: false, _reason: 'no data' });
    }
    return;
  }

  // ★設計変更宣言 (2026-05-13・大改修 C9): 全国共通 railways data 受信
  //   msg.data: RAILWAYS_JP 構造体 (鉄道 polyline)
  //   現段階は保存のみ・将来 電車 GPS 検知で代行業務外判定・skipped 返却
  if (msg.type === 'loadRailways') {
    if (msg.data) {
      _railwaysData = msg.data;
      self.postMessage({ type: 'railwaysLoaded', ok: true });
    } else {
      self.postMessage({ type: 'railwaysLoaded', ok: false, _reason: 'no data' });
    }
    return;
  }

  // MM-7: 統計取得（debug 用）
  if (msg.type === 'getMm7Stats') {
    // ★設計変更宣言 (2026-05-17・Worker B decode 確認手段の追加):
    //   loadedPrefs.size (実 decode 済 県数) と decoders 全体の numRoads 合計を mm7Stats に追加。
    //   main 側から Worker B 内 RoadDecoder 構築成否を直接観測可能にする。
    //   既存フィールドは一切変更しない (= 後方互換)。
    let _loadedRoadsTotal = 0;
    for (const _dec of decoders.values()) {
      _loadedRoadsTotal += _dec && _dec.numRoads ? _dec.numRoads : 0;
    }
    self.postMessage({
      type: 'mm7Stats',
      mcm_window_size: _viterbiN,
      mcm_window_max: VITERBI_N_MAX,
      mcm_shrunk: _viterbiN < VITERBI_N_MAX,
      pheromone_roads_count: _countActivePheromoneRoads(),
      pheromone_prefs: _pheromoneByPref.size,
      grid_cells_count: _gridBias.size,
      grid_cells_max: GRID_MAX_CELLS,
      worker_p99_ms: _calcWorkerP99(),
      worker_lat_samples: _workerLatCount,
      loaded_prefs_count: loadedPrefs.size,
      loaded_roads_total: _loadedRoadsTotal,
    });
    return;
  }

  // MM-6: OSRM 統計取得（debug 用）
  if (msg.type === 'getOsrmStats') {
    self.postMessage({
      type: 'osrmStats',
      enabled: _osrmEnabled,
      endpoint: typeof self.OsrmClient !== 'undefined' ? self.OsrmClient.getEndpoint() : null,
      bufferSize: _osrmTraceBuffer.length,
      teacherActive: Date.now() <= _osrmTeacher.expiresAt,
      teacherLegs: _osrmTeacher.legs.length,
      hits: _osrmTeacher.hits,
      misses: _osrmTeacher.misses,
      batches: _osrmTeacher.batches,
      batchFails: _osrmTeacher.batchFails,
      onLine: typeof navigator !== 'undefined' ? navigator.onLine : null,
    });
    return;
  }

  // MM-6: OSRM エンドポイント設定
  // payload: { endpoint?: string, enabled?: boolean }
  if (msg.type === 'configOsrm') {
    try {
      if (
        typeof msg.endpoint === 'string' &&
        msg.endpoint.length > 0 &&
        typeof self.OsrmClient !== 'undefined'
      ) {
        self.OsrmClient.setEndpoint(msg.endpoint);
      }
      if (typeof msg.enabled === 'boolean') {
        _osrmEnabled = msg.enabled;
      }
      self.postMessage({
        type: 'osrmConfigured',
        ok: true,
        endpoint: typeof self.OsrmClient !== 'undefined' ? self.OsrmClient.getEndpoint() : null,
        enabled: _osrmEnabled,
      });
    } catch (err) {
      self.postMessage({ type: 'osrmConfigured', ok: false, error: err.message });
    }
    return;
  }

  // Phase B: バックボーン graph 受け取り（全国 motorway/trunk・常駐）
  // 2026-05-09: cross-prefecture routing で nearest-node 探索に使うため
  //   load 時に空間インデックスも一緒に構築する。
  if (msg.type === 'loadBackbone') {
    try {
      const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
      _backboneGraph = _decodeGraphData(msg.graphData);
      _buildBackboneSpatialIndex(_backboneGraph);
      const t1 = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
      self.postMessage({
        type: 'backboneLoaded',
        ok: true,
        numNodes: _backboneGraph.numNodes,
        numEdges: _backboneGraph.numEdges,
        gridCells: _backboneGraph._spatialGrid.size,
        decodeMs: t1 - t0,
      });
    } catch (err) {
      self.postMessage({ type: 'backboneLoaded', ok: false, error: err.message });
    }
    return;
  }

  // Phase B: タイル受け取り（main 側 RoadGraphTileLoader 経由）
  if (msg.type === 'loadTile') {
    try {
      const key = msg.pref + '/' + msg.tx + '_' + msg.ty;
      _tilePrefetchInflight.delete(key);
      if (msg.tileData) {
        // T2 (2026-05-09): tx/ty を tile オブジェクトに記録 (multi-tile Dijkstra で使う)
        msg.tileData.tx = msg.tx;
        msg.tileData.ty = msg.ty;
        msg.tileData.pref = msg.pref;
        _tileCache.set(key, msg.tileData);
      }
      // tileLoaded post は頻発するためサイレント（必要時のみ）
    } catch (err) {
      const key = msg.pref + '/' + msg.tx + '_' + msg.ty;
      _tilePrefetchInflight.delete(key);
    }
    return;
  }

  // Phase B: タイル取得失敗通知（404 等）
  if (msg.type === 'tileNotFound') {
    const key = msg.pref + '/' + msg.tx + '_' + msg.ty;
    _tilePrefetchInflight.delete(key);
    return;
  }

  // Phase B: タイルキャッシュ統計取得
  if (msg.type === 'getTileStats') {
    const total = _tileHitCount + _tileMissCount;
    self.postMessage({
      type: 'tileStats',
      cacheSize: _tileCache.size(),
      cacheMax: TILE_CACHE_MAX,
      pinnedCount: _tileCache.pinned.size,
      inflight: _tilePrefetchInflight.size,
      hitCount: _tileHitCount,
      missCount: _tileMissCount,
      hitRate: total > 0 ? _tileHitCount / total : 0,
      requestCount: _tileRequestCount,
      backboneLoaded: !!_backboneGraph,
      backboneNodes: _backboneGraph ? _backboneGraph.numNodes : 0,
    });
    return;
  }

  // MM-5: DEM データ受け取り
  // payload: { bbox:[minLat,minLng,maxLat,maxLng], gridSize, numLat, numLng, altB64 }
  // alt は Int16Array を base64 化したもの（標高 m, sea level 基準）
  if (msg.type === 'loadDem') {
    try {
      const altBuf = _b64ToArrayBuffer(msg.altB64);
      _demData = {
        bbox: msg.bbox,
        gridSize: msg.gridSize,
        numLat: msg.numLat,
        numLng: msg.numLng,
        alt: new Int16Array(altBuf),
      };
      self.postMessage({
        type: 'demLoaded',
        ok: true,
        cells: _demData.numLat * _demData.numLng,
        sizeMB: (altBuf.byteLength / 1024 / 1024).toFixed(2),
      });
    } catch (err) {
      self.postMessage({ type: 'demLoaded', ok: false, error: err.message });
    }
    return;
  }

  // 連続性リセット（Meter.start / reset 時・業務終了時）
  // MM-3: 窓内に残った確定前ステップを全て flush して mm_distance_m に加算してから clear
  if (msg.type === 'reset') {
    let totalIncrement = 0;
    let lastSnapAfterFlush = null;
    if (viterbi.size() > 0) {
      const path = viterbi.flush();
      let prev = lastCommittedSnap;
      for (let i = 0; i < path.length; i++) {
        const c = path[i];
        if (prev) {
          // observationTimestamp ベースで dt 判定（同じ MM_GAP_RESET_SEC 上限）
          const prevObsT = prev.observationTimestamp;
          const currObsT = c.observationTimestamp;
          const dtSec = prevObsT != null && currObsT != null ? (currObsT - prevObsT) / 1000 : 0;
          if (dtSec <= MM_GAP_RESET_SEC) {
            const r = _routeDistance(prev, c);
            if (r && typeof r.distanceM === 'number' && r.distanceM >= 0) {
              // T9 (2026-05-09): flush 経路でも物理上限ベースの判定に統一
              const physMaxM = 58 * Math.max(1, dtSec) + 50;
              const allowedMaxM = Math.max(MM_MAX_SEGMENT_DIST_M, physMaxM);
              if (r.distanceM <= allowedMaxM) {
                totalIncrement += r.distanceM;
              } else {
                // flush は業務終了時の最終 commit・最後に多少の不確実性は許容
                // ただし jumpProb 高なら skip
                const jp = _estimateJumpProb();
                if (jp < T9_HARD_SKIP_PROB) {
                  totalIncrement += allowedMaxM;
                }
              }
            }
          }
        }
        prev = c;
      }
      lastSnapAfterFlush = prev;
    }
    if (totalIncrement > 0) {
      self.postMessage({
        type: 'mmResult',
        mmIncrementM: totalIncrement,
        snap: lastSnapAfterFlush,
        confidence: 1.0,
        snapped: 0, // flush 中は snap_count 加算しない
        skipped: 0,
        latencyMs: 0,
        candidatesCount: 0,
        windowSize: 0,
        committed: true,
        _reason: 'flush before reset',
      });
    }
    viterbi.reset();
    lastCommittedSnap = null;
    prevSnap = null;
    _gpsBuffer.length = 0;
    _clearActivePinnedTile(); // M6: アクティブ pin も解除
    _resetCurvatureHistory(); // T7: 業務終了で曲率履歴もクリア
    // MM-7: 業務終了時に pheromone を蒸発・grid bias を含め IDB に永続保存
    _evaporatePheromones();
    _savePheromoneAll();
    _saveGridBiasIncremental();
    return;
  }

  // D3 (2026-05-09): 緊急輸送道路指定の forward
  if (msg.type === 'loadEmergencyAttrs') {
    if (msg.pref && Array.isArray(msg.roadIndices)) {
      _emergencyRoutesByPref.set(msg.pref, new Set(msg.roadIndices));
    }
    return;
  }

  // F5 (2026-05-09): trip 終了時の soft reset
  //   lastCommittedSnap / prevSnap のみクリア・Viterbi 窓は維持
  //   次の trip 開始時に warmup 不要・走行データ連続性を保つ
  if (msg.type === 'softReset') {
    lastCommittedSnap = null;
    prevSnap = null;
    _clearActivePinnedTile(); // M6: アクティブ pin も解除
    return;
  }

  // Phase 1.C (2026-05-10): Off-Road Mode の境界制御
  //   meter.js の Off-Road 起動 / 終了で送信される
  //   起動時: Off-Road 中に Worker B が古い lastCommittedSnap を起点に
  //           大きな mmIncrement を出すのを防ぐため null 化
  //   終了時: Off-Road でカバー済の commit を「再起点化」するため null 化
  //   Viterbi 窓は維持 (snap 候補蓄積を継続)・pheromone/grid bias も維持
  if (msg.type === 'resetCommittedSnap') {
    lastCommittedSnap = null;
    return;
  }

  // B6 (2026-05-09): 停車検出時の hint
  //   main 側で停車検知したら _gpsBuffer をクリアして
  //   再走行時に古い走行前 4 点で Catmull-Rom 計算するのを防ぐ
  if (msg.type === 'stationaryHint') {
    _gpsBuffer.length = 0;
    return;
  }

  // GPS 更新
  if (msg.type === 'gps') {
    const t0 =
      typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    if (_mmDebug)
      _dbg(
        'gps',
        msg.lat.toFixed(6),
        msg.lng.toFixed(6),
        'acc=' + (msg.accuracy != null ? msg.accuracy : '?'),
        'spd=' + (msg.speedKmh != null ? msg.speedKmh : '?') + 'km/h'
      );

    // 2026-05-09 (P4/P5): cellular tunnel hint EARLY RETURN 廃止
    //   トンネルでも MM を止めず・layer 連続性 boost で道路追従させる
    //   トンネル道路が roads データにあれば snap は成功・課金継続

    _pushGpsBuffer({ lat: msg.lat, lng: msg.lng, timestamp: msg.timestamp });
    // G1: trajectory 不規則性推定用に直近 GPS 履歴を維持
    _pushRecentGps(msg.lat, msg.lng, msg.timestamp);

    // MM-6: OSRM 教師信号用バッファ追加（30 秒ごとに自動でバッチ送信トリガ）
    _addToOsrmBuffer({
      lat: msg.lat,
      lng: msg.lng,
      timestamp: msg.timestamp,
      accuracy: msg.accuracy,
    });

    let mmIncrementM = 0;
    // ★設計変更宣言 (2026-05-16・Tier 2 リードインジケータ): preview 用 単 step 道路距離
    //   通常 commit (mmIncrementM > 0) とは独立。main で tier2_pending_m に加算される。
    let tentativeIncrementM = 0;
    let snapped = 0,
      skipped = 0;
    let outSnap = null;
    let reason = null;
    let candCount = 0;
    let pickedEmission = 0;
    let committed = false;

    try {
      // ① 多候補 snap
      const cands = _snapAllAcrossPrefs(msg.lat, msg.lng, msg.accuracy);
      candCount = cands.length;
      if (candCount === 0) {
        // 候補ゼロ = snap miss（窓状態は維持・skip カウントなし）
        reason = 'no candidates';
      } else {
        // ② emission scoring（直前 commit 済 snap の type bucket / layer を prev として渡す）
        const prevBucket =
          lastCommittedSnap && lastCommittedSnap._typeBucket
            ? lastCommittedSnap._typeBucket
            : prevSnap && prevSnap._typeBucket
              ? prevSnap._typeBucket
              : null;
        const prevLayer =
          lastCommittedSnap && lastCommittedSnap.layer != null
            ? lastCommittedSnap.layer
            : prevSnap && prevSnap.layer != null
              ? prevSnap.layer
              : null;
        // P4/P5 (2026-05-09): cellular/accel hint 引数を廃止・prevLayer のみ
        _scoreCandidates(
          cands,
          msg.lat,
          msg.lng,
          msg.accuracy || 20,
          msg.headingDeg,
          prevBucket,
          msg.altitude,
          prevLayer
        );

        // 出力用に「最高 emission の 1 件」を選んでおく（diagnostic / mmResult.snap 用）
        // M1 (2026-05-09): logEmission で比較 (underflow 安全)
        let bestEmit = cands[0];
        let bestLog =
          bestEmit.logEmission != null ? bestEmit.logEmission : Math.log(bestEmit.emission + 1e-12);
        for (let i = 1; i < cands.length; i++) {
          const cur = cands[i];
          const curLog = cur.logEmission != null ? cur.logEmission : Math.log(cur.emission + 1e-12);
          if (curLog > bestLog) {
            bestEmit = cur;
            bestLog = curLog;
          }
        }
        pickedEmission = bestEmit.emission;
        snapped = 1;
        outSnap = bestEmit;
        // ★設計変更宣言 (2026-05-16・Tier 2 リードインジケータ Worker B 経由実装):
        //   旧設計: main thread で _inlineSnapAndIncrement (RegionLoader.snapToNearestRoad) を呼んで
        //           毎 GPS step 道路距離を算出 → tier2_pending_m に加算する設計だったが、
        //           RegionLoader が main thread に存在せず常に null フォールバック・Tier 2 が動かない
        //           (= 走行距離が ~300m 走らないと更新されない事象 2026-05-15 報告)。
        //   新設計: Worker B 内に既にある dec.calcRoadDistance を使い、prevSnap (前 step の bestEmit)
        //           から current bestEmit までの道路距離を毎 GPS step 計算し、mmResult.tentativeIncrementM
        //           として main に送信する。main は tier2_pending_m += tentativeIncrementM のみ。
        //   絶対ルール準拠:
        //     ✓ 道路ジオメトリ距離 (_routeDistance = dec.calcRoadDistance) を使用・GPS 直線禁止
        //     ✓ 課金 (distance_m) は Tier 1 (Viterbi commit) のみで更新・本実装で変更なし
        //     ✓ 物理上限 (200m/step) で異常値 skip・jumpProb 高なら skip
        //     ✓ iOS/Android 共通 (Worker B 同一動作)
        if (prevSnap && prevSnap.timestamp != null) {
          const _dtTentative = (msg.timestamp - prevSnap.timestamp) / 1000;
          if (_dtTentative > 0 && _dtTentative <= MM_GAP_RESET_SEC) {
            try {
              const _rt = _routeDistance(prevSnap, bestEmit);
              if (_rt && typeof _rt.distanceM === 'number' && _rt.distanceM >= 0) {
                // 物理上限: 1 GPS step (~1-5Hz) で 200m 超は GPS jump 扱いで skip
                //   通常運転 60km/h=16.7m/s・高速 120km/h=33.3m/s・1秒なら最大 50m 程度
                //   200m は十分余裕のある上限値 (= 720km/h 相当の異常時のみ trip)
                if (_rt.distanceM <= 200) {
                  tentativeIncrementM = _rt.distanceM;
                }
              }
            } catch (_) {
              // calcRoadDistance 失敗は無視 (= preview 不要・課金には影響しない)
            }
          }
        }
        // M6 (2026-05-09): bestEmit のタイルを持続 pin (eviction 防止)
        _setActivePinnedTile(bestEmit.prefecture, bestEmit.snapLat, bestEmit.snapLng);
        if (_mmDebug)
          _dbg(
            'score cand=' + candCount,
            'pickedEmit=' + bestEmit.emission.toFixed(3),
            'road=' + bestEmit.roadIndex,
            'dist=' + bestEmit.distanceM.toFixed(1) + 'm',
            'layer=' + (bestEmit.layer != null ? bestEmit.layer : '?')
          );

        // MM-7: 蟻コロニー pheromone を採用 road にマーク
        _markPheromone(bestEmit.prefecture, bestEmit.roadIndex);
        // MM-7: 地域別 GPS 誤差学習を蓄積
        _recordGridBiasSample(msg.lat, msg.lng, bestEmit.snapLat, bestEmit.snapLng);
        // Phase B runtime: GPS 進行方向の前方タイルを prefetch
        _prefetchTilesAround(
          msg.lat,
          msg.lng,
          msg.headingDeg,
          msg.speedKmh || 0,
          bestEmit.prefecture
        );

        // ③ Viterbi 窓に push
        const gpsObs = { lat: msg.lat, lng: msg.lng, timestamp: msg.timestamp };
        const newCommitted = viterbi.push(gpsObs, cands, _transitionScore);

        // ④ commit が起きた場合、lastCommittedSnap → newCommitted 間の距離を加算
        // newCommitted.observationTimestamp は確定された GPS 観測時刻（N 秒前）
        if (newCommitted) {
          committed = true;
          if (lastCommittedSnap) {
            const prevObsT = lastCommittedSnap.observationTimestamp;
            const currObsT = newCommitted.observationTimestamp;
            const dtSec = prevObsT != null && currObsT != null ? (currObsT - prevObsT) / 1000 : 0;
            if (dtSec > MM_GAP_RESET_SEC) {
              reason = 'gap reset between commits';
            } else {
              const r = _routeDistance(lastCommittedSnap, newCommitted);
              if (r && typeof r.distanceM === 'number' && r.distanceM >= 0) {
                // T9 (2026-05-09): 旧 MM_MAX_SEGMENT_DIST_M=1000 の単純 skip を廃止
                //   ・ 短時間に 1km 超過は通常 ありえないが、120km/h 高速道路なら 30 秒で 1km
                //     普通車でも実 13.3m/s × dtSec 程度は妥当
                //   ・ 物理的に許容できる移動距離 + jumpProb の確信度で skip 判定
                //   許容上限: max(MM_MAX_SEGMENT_DIST_M, 物理上限速度 × dtSec × 余裕係数)
                //   物理上限 = 160km/h ≈ 44.4 m/s × 1.3 余裕 ≈ 58 m/s
                const physMaxM = 58 * Math.max(1, dtSec) + 50; // dtSec=1s でも下限 108m
                const allowedMaxM = Math.max(MM_MAX_SEGMENT_DIST_M, physMaxM);
                const lastJumpProb = _estimateJumpProb();
                if (r.distanceM <= allowedMaxM) {
                  // 物理範囲内 → 加算 (jumpProb は scoring で既に減衰済)
                  mmIncrementM = r.distanceM;
                } else if (lastJumpProb < T9_HARD_SKIP_PROB) {
                  // 物理範囲超過だが jump 確率が低い (実際の高速移動の可能性)
                  // → 物理上限まで採用 (絶対ルール「過少課金禁止」と整合)
                  mmIncrementM = allowedMaxM;
                  reason =
                    'capped at phys-max ' +
                    allowedMaxM.toFixed(0) +
                    'm (raw ' +
                    r.distanceM.toFixed(0) +
                    'm via ' +
                    r._via +
                    ', jumpProb=' +
                    lastJumpProb.toFixed(2) +
                    ')';
                } else {
                  // 物理範囲超過 + jump 確率高 → 「明らかな multipath ジャンプ」と確信して skip
                  skipped = 1;
                  reason =
                    'jump skip dist=' +
                    r.distanceM.toFixed(0) +
                    'm jumpProb=' +
                    lastJumpProb.toFixed(2) +
                    ' via ' +
                    r._via;
                }
              }
            }
          }
          lastCommittedSnap = newCommitted; // observationTimestamp を含む
          // T7 (2026-05-09): commit ごとに曲率履歴を更新
          _updateCurvatureFromCommit(newCommitted);
        }

        // MM-2 互換 prevSnap も更新（Viterbi 不在時 fallback 経路用に維持）
        prevSnap = Object.assign({}, bestEmit, { timestamp: msg.timestamp });
      }
    } catch (err) {
      skipped = 1;
      reason = 'error: ' + err.message;
    }

    // ★設計変更宣言 (2026-05-16・Step4・停車中 mmIncrement / tentativeIncrement 0 化):
    //   main 側から msg.isStationary=true が伝達された場合、本 step の mmIncrementM と
    //   tentativeIncrementM を強制的に 0 にする。
    //   目的:
    //     ・distance_m / business_distance_m の整合性確保 (= 両経路で同じ Worker B 出力を見る)
    //     ・「停車中も distance_m が GPS ジッターで増加」事象を Worker B 側で根本対策
    //   絶対ルール準拠:
    //     ・main 側 state.distance_m += m.mmIncrementM (= += 0) で値は不変
    //     ・「distance_m に触れない」は main 側 += ロジック不変 = 遵守
    //     ・Worker B 出力値の制御で結果として停車中加算ゼロを実現
    //   Viterbi window / pheromone / grid bias 学習は通常通り進める (= 停車後の再走行時に
    //   学習履歴が連続する利点を維持)。出力値だけ 0 にする。
    if (msg.isStationary === true) {
      mmIncrementM = 0;
      tentativeIncrementM = 0;
    }

    const t1 =
      typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    // MM-7: Worker 内 latency 自己監視 → 必要なら N を縮小
    _recordWorkerLat(t1 - t0);
    _maybeAdjustViterbiN();
    if (_mmDebug)
      _dbg(
        'result mmInc=' + mmIncrementM.toFixed(2) + 'm',
        'snap=' + snapped,
        'skip=' + skipped,
        'commit=' + (committed ? 1 : 0),
        'lat_ms=' + (t1 - t0).toFixed(2),
        'win=' + viterbi.size(),
        reason ? 'reason=' + reason : ''
      );
    self.postMessage({
      type: 'mmResult',
      mmIncrementM: mmIncrementM,
      // ★設計変更宣言 (2026-05-16・Tier 2 リードインジケータ Worker B 経由):
      //   commit (mmIncrementM) を待たない preview 用の単 step 道路距離。
      //   main 側で state.tier2_pending_m に加算し、commit で 0 リセットされる。
      tentativeIncrementM: tentativeIncrementM,
      snap: outSnap,
      confidence: pickedEmission > 0 ? Math.min(1.0, pickedEmission) : 1.0,
      windowSize: viterbi.size(),
      mcmN: _viterbiN,
      committed: committed,
      snapped: snapped,
      skipped: skipped,
      latencyMs: t1 - t0,
      candidatesCount: candCount,
      pickedEmission: pickedEmission,
      _reason: reason,
    });
  }
};
