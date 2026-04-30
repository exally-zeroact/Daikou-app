// ============================================================
// roads-decoder.js v1
// 
// roads-{prefecture}.js の道路データを部分デコードする軽量デコーダー
// メモリ消費を抑えるため、オフセットテーブルだけ事前構築し、
// 必要な道路だけオンデマンドデコードする。
// 
// 対応フォーマット：v4（build-roads.js の出力）
// 
// エンコード仕様：
//   各道路 = [typeCode 1byte][numPoints varint][lat0 svarint][lng0 svarint]
//            [(dLat svarint)(dLng svarint) × (numPoints-1)]
//   varint：LSB7bit + 継続フラグ（0x80）
//   signed varint = zigzag varint
// ============================================================

(function(global){
  'use strict';
  
  // base64 → Uint8Array（ブラウザ互換）
  function base64ToBytes(b64) {
    if (typeof Buffer !== 'undefined') {
      // Node.js
      return new Uint8Array(Buffer.from(b64, 'base64'));
    }
    // ブラウザ
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  
  // varint デコード（unsigned）
  // 戻り値：[値, 新オフセット]
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
  
  // varint スキップ（値読まずバイトだけ進める・高速）
  function skipVarint(bytes, offset) {
    while (bytes[offset++] & 0x80) {}
    return offset;
  }
  
  // zigzag デコード
  function zigzagDecode(n) {
    return (n >>> 1) ^ -(n & 1);
  }
  
  // signed varint デコード
  function readSignedVarint(bytes, offset) {
    const r = readVarint(bytes, offset);
    return [zigzagDecode(r[0]), r[1]];
  }
  
  // 1道路のバイト長を計算（デコードせず）
  // 戻り値：次の道路の開始オフセット
  function skipRoad(bytes, offset) {
    offset++; // typeCode 1byte
    let numPoints;
    [numPoints, offset] = readVarint(bytes, offset);
    // 始点 lat, lng
    offset = skipVarint(bytes, offset);
    offset = skipVarint(bytes, offset);
    // 残り (numPoints - 1) × 2 個の signed varint
    const skipCount = (numPoints - 1) * 2;
    for (let i = 0; i < skipCount; i++) {
      offset = skipVarint(bytes, offset);
    }
    return offset;
  }
  
  // 1道路を部分デコード
  // 戻り値：{ typeCode, points: [[lat*1e5, lng*1e5], ...] }
  function decodeRoadAtOffset(bytes, offset) {
    const typeCode = bytes[offset++];
    let numPoints;
    [numPoints, offset] = readVarint(bytes, offset);
    let lat, lng;
    [lat, offset] = readSignedVarint(bytes, offset);
    [lng, offset] = readSignedVarint(bytes, offset);
    const points = new Array(numPoints);
    points[0] = [lat, lng];
    for (let i = 1; i < numPoints; i++) {
      let dLat, dLng;
      [dLat, offset] = readSignedVarint(bytes, offset);
      [dLng, offset] = readSignedVarint(bytes, offset);
      lat += dLat;
      lng += dLng;
      points[i] = [lat, lng];
    }
    return { typeCode: typeCode, points: points };
  }
  
  // ─── RoadDecoder クラス ────────────────────────────────────────
  function RoadDecoder(roadsData) {
    if (!roadsData || roadsData.v !== 4) {
      throw new Error('[RoadDecoder] 未対応フォーマット v=' + (roadsData && roadsData.v));
    }
    this.data = roadsData;
    this.bytes = base64ToBytes(roadsData.roadsB64);
    this.offsetTable = null;  // buildOffsetTable() で構築
    this.gridSize = roadsData.gridSize || 1000;
    this.precision = roadsData.precision || 1e5;
    this.types = roadsData.types || {};
    this.grid = roadsData.grid || {};
    this.numRoads = roadsData.numRoads || 0;
    this.prefecture = roadsData.prefecture || '';
  }
  
  // オフセットテーブル構築（起動時1回・線形スキャン）
  RoadDecoder.prototype.buildOffsetTable = function() {
    const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    const offsets = new Uint32Array(this.numRoads);
    let offset = 0;
    let i = 0;
    while (offset < this.bytes.length && i < this.numRoads) {
      offsets[i++] = offset;
      offset = skipRoad(this.bytes, offset);
    }
    if (i !== this.numRoads) {
      throw new Error('[RoadDecoder] オフセット数不一致 expected=' + this.numRoads + ' got=' + i);
    }
    this.offsetTable = offsets;
    const t1 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    return { ms: t1 - t0, count: i };
  };
  
  // 1道路をインデックスでデコード
  RoadDecoder.prototype.decodeRoadAt = function(index) {
    if (!this.offsetTable) {
      throw new Error('[RoadDecoder] buildOffsetTable() を先に呼んでください');
    }
    if (index < 0 || index >= this.numRoads) {
      return null;
    }
    return decodeRoadAtOffset(this.bytes, this.offsetTable[index]);
  };
  
  // グリッドキー内の全道路を取得
  RoadDecoder.prototype.getRoadsInGrid = function(gridKey) {
    const ids = this.grid[gridKey];
    if (!ids || ids.length === 0) return [];
    const result = new Array(ids.length);
    for (let i = 0; i < ids.length; i++) {
      result[i] = this.decodeRoadAt(ids[i]);
    }
    return result;
  };
  
  // GPS座標から周辺グリッドの全道路を取得
  // lat, lng: 実緯度経度（×1e5 ではない）
  // radiusGrids: 周辺何グリッド見るか（デフォルト1=±1の9グリッド）
  RoadDecoder.prototype.getRoadsNear = function(lat, lng, radiusGrids) {
    if (radiusGrids == null) radiusGrids = 1;
    const latInt = Math.round(lat * this.precision);
    const lngInt = Math.round(lng * this.precision);
    const gy = Math.floor(latInt / this.gridSize);
    const gx = Math.floor(lngInt / this.gridSize);
    const result = [];
    const seen = {};  // 重複防止
    for (let dy = -radiusGrids; dy <= radiusGrids; dy++) {
      for (let dx = -radiusGrids; dx <= radiusGrids; dx++) {
        const key = (gy + dy) + '_' + (gx + dx);
        const ids = this.grid[key];
        if (!ids) continue;
        for (let i = 0; i < ids.length; i++) {
          const id = ids[i];
          if (seen[id]) continue;
          seen[id] = 1;
          result.push(this.decodeRoadAt(id));
        }
      }
    }
    return result;
  };
  
  // 道路タイプコード → 名前
  RoadDecoder.prototype.typeName = function(typeCode) {
    return this.types[typeCode] || ('unknown_' + typeCode);
  };
  
  // ─── Map Matching 用ヘルパー関数 ────────────────────────────────
  
  // Haversine 球面距離（メートル）
  function haversineM(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLng = (lng2 - lng1) * toRad;
    const a = Math.sin(dLat/2) ** 2 +
              Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
              Math.sin(dLng/2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  
  // 緯度経度差をメートル換算する係数（平面近似用）
  // refLat における 1度あたりのメートル数を返す
  function metersPerDegree(refLat) {
    const toRad = Math.PI / 180;
    return {
      lat: 111132.954 - 559.822 * Math.cos(2 * refLat * toRad) + 1.175 * Math.cos(4 * refLat * toRad),
      lng: 111319.488 * Math.cos(refLat * toRad)
    };
  }
  
  // ─── snapToNearestRoad ─────────────────────────────────────────
  // GPS座標 (lat, lng) を最寄りの道路に snap する
  // options:
  //   maxDistM: 最大許容距離（デフォルト50m・これを超えると null）
  //   typeFilter: 道路タイプの配列（例:[0,1] = motorway/trunk のみ）
  //   radiusGrids: 周辺グリッド検索範囲（明示指定なしならフォールバック検索）
  //     ※ build-roads.js v4 は道路を「始点グリッド」にしか登録しないため、
  //        長い道路を捕捉するには広い範囲が必要。
  //        2026/04/30: フォールバック検索追加
  //        - options.radiusGrids 未指定: まず 5 で検索、失敗なら 9 で再試行
  //        - options.radiusGrids 指定: その値のみで検索（既存挙動）
  //        将来的に build-roads.js を改修して全通過グリッドに登録するなら 1 で良い。
  // 戻り値：{ roadIndex, segmentIndex, t, snapLat, snapLng, distanceM, typeCode }
  //         または null（道路が遠すぎる）
  RoadDecoder.prototype.snapToNearestRoad = function(lat, lng, options) {
    options = options || {};
    // radiusGrids 明示指定がある場合は1回だけ検索（既存挙動）
    if (options.radiusGrids != null) {
      return this._searchSnap(lat, lng, options, options.radiusGrids);
    }
    // 未指定の場合はフォールバック検索（軽い→重いの順）
    // 1回目: radiusGrids=5（121グリッド）通常時はこれで成功
    let result = this._searchSnap(lat, lng, options, 5);
    if (result) return result;
    // 2回目: radiusGrids=9（361グリッド）長い道路の始点が遠い場合のフォールバック
    return this._searchSnap(lat, lng, options, 9);
  };

  // 内部関数：実際の snap 検索（radiusGrids 固定で1回だけ実行）
  // 公開 API は snapToNearestRoad を使うこと（フォールバック付き）
  RoadDecoder.prototype._searchSnap = function(lat, lng, options, radiusGrids) {
    const maxDistM = options.maxDistM != null ? options.maxDistM : 50;
    const typeFilter = options.typeFilter || null;
    
    // 平面化用係数
    const mpd = metersPerDegree(lat);
    const mpdLat = mpd.lat;
    const mpdLng = mpd.lng;
    const precision = this.precision;
    
    // GPS座標 → 平面（メートル）
    // 基準点を GPS 座標に置く（差分で計算するため、絶対値はどうでもいい）
    // 道路の点(整数lat*1e5, 整数lng*1e5) → メートル変換は
    //   dx = (roadLng/1e5 - lng) * mpdLng
    //   dy = (roadLat/1e5 - lat) * mpdLat
    
    // 周辺グリッドから道路ID列を取得
    const latInt = Math.round(lat * precision);
    const lngInt = Math.round(lng * precision);
    const gy = Math.floor(latInt / this.gridSize);
    const gx = Math.floor(lngInt / this.gridSize);
    
    // 二乗距離で比較（√計算を最後だけ）
    const maxDistSq = maxDistM * maxDistM;
    let bestDistSq = Infinity;
    let bestRoadIndex = -1;
    let bestSegmentIndex = -1;
    let bestT = 0;
    let bestSnapLat = 0;
    let bestSnapLng = 0;
    let bestTypeCode = -1;
    
    const seen = {};
    for (let dy = -radiusGrids; dy <= radiusGrids; dy++) {
      for (let dx = -radiusGrids; dx <= radiusGrids; dx++) {
        const key = (gy + dy) + '_' + (gx + dx);
        const ids = this.grid[key];
        if (!ids) continue;
        
        for (let i = 0; i < ids.length; i++) {
          const id = ids[i];
          if (seen[id]) continue;
          seen[id] = 1;
          
          const road = this.decodeRoadAt(id);
          if (!road) continue;
          
          // タイプフィルタ
          if (typeFilter && typeFilter.indexOf(road.typeCode) < 0) continue;
          
          const points = road.points;
          // 各線分を検査
          for (let j = 0; j < points.length - 1; j++) {
            const aLat = points[j][0] / precision;
            const aLng = points[j][1] / precision;
            const bLat = points[j+1][0] / precision;
            const bLng = points[j+1][1] / precision;
            
            // 平面化（lat=0, lng=0 を GPS 座標に置く）
            const ax = (aLng - lng) * mpdLng;
            const ay = (aLat - lat) * mpdLat;
            const bx = (bLng - lng) * mpdLng;
            const by = (bLat - lat) * mpdLat;
            // GPS は (0, 0)
            
            // 線分への投影
            const abx = bx - ax;
            const aby = by - ay;
            const ab2 = abx*abx + aby*aby;
            let t;
            if (ab2 < 1e-9) {
              // 線分が点（aとbが重なる）
              t = 0;
            } else {
              // (P-A)·(B-A) / |B-A|^2  ※ P=(0,0) なので -A·(B-A)/|B-A|^2
              t = (-ax * abx + -ay * aby) / ab2;
              if (t < 0) t = 0;
              else if (t > 1) t = 1;
            }
            // snap 点（平面）
            const sx = ax + t * abx;
            const sy = ay + t * aby;
            const distSq = sx*sx + sy*sy;
            
            if (distSq < bestDistSq) {
              bestDistSq = distSq;
              bestRoadIndex = id;
              bestSegmentIndex = j;
              bestT = t;
              // snap 点 → 緯度経度に逆変換
              bestSnapLat = aLat + t * (bLat - aLat);
              bestSnapLng = aLng + t * (bLng - aLng);
              bestTypeCode = road.typeCode;
              
              // 早期枝刈り
              if (distSq > maxDistSq) {
                // この時点では bestDist が maxDist超えだが、もっと近いのがあれば更新される
                // ただし枝刈りはしない（次でもっと近いかも）
              }
            }
          }
        }
      }
    }
    
    if (bestRoadIndex < 0 || bestDistSq > maxDistSq) {
      return null;
    }
    
    return {
      roadIndex: bestRoadIndex,
      segmentIndex: bestSegmentIndex,
      t: bestT,
      snapLat: bestSnapLat,
      snapLng: bestSnapLng,
      distanceM: Math.sqrt(bestDistSq),
      typeCode: bestTypeCode
    };
  };
  
  // ─── calcRoadDistance ───────────────────────────────────────────
  // 2つの snap 点間の道路上の距離を計算（メートル）
  // snapA, snapB: snapToNearestRoad の戻り値
  // 戻り値: 
  //   { distanceM, onSameRoad: true } - 同じ道路上：道路上の距離
  //   { distanceM, onSameRoad: false } - 別道路：直線距離
  //   null - エラー
  RoadDecoder.prototype.calcRoadDistance = function(snapA, snapB) {
    if (!snapA || !snapB) return null;
    
    // 別の道路 → 直線距離（暫定）
    if (snapA.roadIndex !== snapB.roadIndex) {
      return {
        distanceM: haversineM(snapA.snapLat, snapA.snapLng, snapB.snapLat, snapB.snapLng),
        onSameRoad: false
      };
    }
    
    // 同じ道路 → ポリラインに沿った距離を計算
    const road = this.decodeRoadAt(snapA.roadIndex);
    if (!road) return null;
    const points = road.points;
    const precision = this.precision;
    
    // どちらが前か
    let fromIdx, fromT, toIdx, toT;
    if (snapA.segmentIndex < snapB.segmentIndex ||
        (snapA.segmentIndex === snapB.segmentIndex && snapA.t <= snapB.t)) {
      fromIdx = snapA.segmentIndex; fromT = snapA.t;
      toIdx   = snapB.segmentIndex; toT   = snapB.t;
    } else {
      fromIdx = snapB.segmentIndex; fromT = snapB.t;
      toIdx   = snapA.segmentIndex; toT   = snapA.t;
    }
    
    // ケース1：同じ線分上
    if (fromIdx === toIdx) {
      const aLat = points[fromIdx][0] / precision;
      const aLng = points[fromIdx][1] / precision;
      const bLat = points[fromIdx+1][0] / precision;
      const bLng = points[fromIdx+1][1] / precision;
      const segLen = haversineM(aLat, aLng, bLat, bLng);
      return {
        distanceM: segLen * (toT - fromT),
        onSameRoad: true
      };
    }
    
    // ケース2：複数線分にまたがる
    let total = 0;
    
    // 1) from の線分の残り（fromT から 1.0 まで）
    {
      const aLat = points[fromIdx][0] / precision;
      const aLng = points[fromIdx][1] / precision;
      const bLat = points[fromIdx+1][0] / precision;
      const bLng = points[fromIdx+1][1] / precision;
      const segLen = haversineM(aLat, aLng, bLat, bLng);
      total += segLen * (1 - fromT);
    }
    
    // 2) 中間の線分（フル長さ）
    for (let i = fromIdx + 1; i < toIdx; i++) {
      const aLat = points[i][0] / precision;
      const aLng = points[i][1] / precision;
      const bLat = points[i+1][0] / precision;
      const bLng = points[i+1][1] / precision;
      total += haversineM(aLat, aLng, bLat, bLng);
    }
    
    // 3) to の線分の頭（0 から toT まで）
    {
      const aLat = points[toIdx][0] / precision;
      const aLng = points[toIdx][1] / precision;
      const bLat = points[toIdx+1][0] / precision;
      const bLng = points[toIdx+1][1] / precision;
      const segLen = haversineM(aLat, aLng, bLat, bLng);
      total += segLen * toT;
    }
    
    return {
      distanceM: total,
      onSameRoad: true
    };
  };
  
  // export
  global.RoadDecoder = RoadDecoder;
  
})(typeof window !== 'undefined' ? window : global);
