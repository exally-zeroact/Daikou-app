// ============================================================
// roads-decoder.js v2
//
// roads-{prefecture}.js の道路データを部分デコードする軽量デコーダー
// メモリ消費を抑えるため、オフセットテーブルだけ事前構築し、
// 必要な道路だけオンデマンドデコードする。
//
// 対応フォーマット：v4 / v5 / v6 / v7 (build-roads.js)
//
// エンコード仕様 (v4/v5):
//   各道路 = [typeCode 1byte][numPoints varint][lat0 svarint][lng0 svarint]
//            [(dLat svarint)(dLng svarint) × (numPoints-1)]
// エンコード仕様 (v6):
//   各道路 = [bitmap 2byte LE][numPoints varint][lat0 svarint][lng0 svarint]
//            [(dLat svarint)(dLng svarint) × (numPoints-1)]
// エンコード仕様 (v7・T6 2026-05-09):
//   各道路 = [bitmap 3byte LE][numPoints varint][lat0 svarint][lng0 svarint]
//            [(dLat svarint)(dLng svarint) × (numPoints-1)]
//   bitmap (24bit, little-endian):
//     bit 0-3   typeCode (motorway-track, 0-12)
//     bit 4     oneway   (1=一方通行)
//     bit 5-6   incline  (00=なし, 01=登り急, 10=下り急, 11=方向不明・急)
//     bit 7-9   lanes    (0=不明, 1-6=本数, 7=7+)
//     bit 10-11 width    (00=不明, 01=≤2m, 10=2-5m, 11=>5m)
//     bit 12-13 layer    (00=平面, 01=高架, 10=地下, 11=その他)
//     bit 14-15 access   (00=public, 01=private, 10=no_motor)
//     bit 16-18 maxspeed (T6: 0=unk/1=≤30/2=40/3=50/4=60/5=70/6=80/7=≥100 km/h)
//     bit 19-23 reserved
//
// roadsData.restrictions[] (T4 2026-05-09):
//   [[fromRoadIdx, toRoadIdx], ...]  禁止 transition 対 (右折禁止等)
//
//   varint：LSB7bit + 継続フラグ（0x80）
//   signed varint = zigzag varint
// ============================================================

(function (global) {
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

  // bitmap (v6=16bit / v7=24bit) → 属性オブジェクト
  // D1 (2026-05-09): bit 14-15 を access (00=public/01=private/10=no_motor) として追加
  // T6 (2026-05-09): bit 16-18 を maxspeed (0=unk/1=≤30/.../7=≥100 km/h) として追加
  //   既存 v6 build データは v6 path で読まれ maxspeed フィールドは未付与
  //   新 v7 build データは bit 16-18 から maxspeed を取得
  function unpackAttrBitmap(bits) {
    const a = {
      typeCode: bits & 0x0f,
      oneway: (bits >> 4) & 0x01,
      incline: (bits >> 5) & 0x03,
      lanes: (bits >> 7) & 0x07,
      width: (bits >> 10) & 0x03,
      layer: (bits >> 12) & 0x03,
      access: (bits >> 14) & 0x03,
      maxspeed: (bits >> 16) & 0x07, // v6 (16bit) は常に 0=不明・v7 で実値
    };
    return a;
  }

  // 1道路のバイト長を計算（デコードせず）
  // 戻り値：次の道路の開始オフセット
  // headerSize: v4/v5=1, v6=2, v7=3
  function skipRoad(bytes, offset, headerSize) {
    offset += headerSize; // typeCode (1byte) or bitmap (2/3byte)
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
  // version 7: 24bit bitmap (3 byte) + maxspeed (T6)
  // version 6: 16bit bitmap (2 byte) + access (D1)
  // version 4/5: 1 byte typeCode のみ
  function decodeRoadAtOffset(bytes, offset, version) {
    let attrs;
    if (version >= 7) {
      const bits = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
      offset += 3;
      attrs = unpackAttrBitmap(bits);
    } else if (version >= 6) {
      const bits = bytes[offset] | (bytes[offset + 1] << 8);
      offset += 2;
      attrs = unpackAttrBitmap(bits);
      // v6 では maxspeed フィールドは存在しないが unpack で 0 が入っているため neutral
    } else {
      attrs = { typeCode: bytes[offset++] };
    }
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
    attrs.points = points;
    return attrs;
  }

  // ─── RoadDecoder クラス ────────────────────────────────────────
  function RoadDecoder(roadsData) {
    if (!roadsData || roadsData.v < 4 || roadsData.v > 7) {
      throw new Error('[RoadDecoder] 未対応フォーマット v=' + (roadsData && roadsData.v));
    }
    this.data = roadsData;
    this.version = roadsData.v;
    // headerSize: v4/v5=1, v6=2, v7=3
    this.headerSize = this.version >= 7 ? 3 : this.version >= 6 ? 2 : 1;
    this.bytes = base64ToBytes(roadsData.roadsB64);
    this.offsetTable = null; // buildOffsetTable() で構築
    this.gridSize = roadsData.gridSize || 1000;
    this.precision = roadsData.precision || 1e5;
    this.types = roadsData.types || {};
    this.grid = roadsData.grid || {};
    this.numRoads = roadsData.numRoads || 0;
    this.prefecture = roadsData.prefecture || '';
    // T4 (2026-05-09): turn:restriction Set ("from|to" string キー)
    //   data.restrictions = [[fromIdx, toIdx], ...]・無ければ空 Set
    this._restrictionSet = new Set();
    if (Array.isArray(roadsData.restrictions)) {
      for (const r of roadsData.restrictions) {
        if (Array.isArray(r) && r.length >= 2) {
          this._restrictionSet.add(r[0] + '|' + r[1]);
        }
      }
    }
  }
  // T4: 指定 from→to の transition が禁止されているか
  RoadDecoder.prototype.isRestrictedTransition = function (fromRoadIdx, toRoadIdx) {
    if (this._restrictionSet.size === 0) return false;
    return this._restrictionSet.has(fromRoadIdx + '|' + toRoadIdx);
  };

  // オフセットテーブル構築（起動時1回・線形スキャン）
  RoadDecoder.prototype.buildOffsetTable = function () {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const offsets = new Uint32Array(this.numRoads);
    const headerSize = this.headerSize;
    let offset = 0;
    let i = 0;
    while (offset < this.bytes.length && i < this.numRoads) {
      offsets[i++] = offset;
      offset = skipRoad(this.bytes, offset, headerSize);
    }
    if (i !== this.numRoads) {
      throw new Error('[RoadDecoder] オフセット数不一致 expected=' + this.numRoads + ' got=' + i);
    }
    this.offsetTable = offsets;
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return { ms: t1 - t0, count: i };
  };

  // 1道路をインデックスでデコード
  RoadDecoder.prototype.decodeRoadAt = function (index) {
    if (!this.offsetTable) {
      throw new Error('[RoadDecoder] buildOffsetTable() を先に呼んでください');
    }
    if (index < 0 || index >= this.numRoads) {
      return null;
    }
    return decodeRoadAtOffset(this.bytes, this.offsetTable[index], this.version);
  };

  // グリッドキー内の全道路を取得
  RoadDecoder.prototype.getRoadsInGrid = function (gridKey) {
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
  RoadDecoder.prototype.getRoadsNear = function (lat, lng, radiusGrids) {
    if (radiusGrids == null) radiusGrids = 1;
    const latInt = Math.round(lat * this.precision);
    const lngInt = Math.round(lng * this.precision);
    const gy = Math.floor(latInt / this.gridSize);
    const gx = Math.floor(lngInt / this.gridSize);
    const result = [];
    const seen = {}; // 重複防止
    for (let dy = -radiusGrids; dy <= radiusGrids; dy++) {
      for (let dx = -radiusGrids; dx <= radiusGrids; dx++) {
        const key = gy + dy + '_' + (gx + dx);
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
  RoadDecoder.prototype.typeName = function (typeCode) {
    return this.types[typeCode] || 'unknown_' + typeCode;
  };

  // ─── Map Matching 用ヘルパー関数 ────────────────────────────────

  // Haversine 球面距離（メートル）
  function haversineM(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLng = (lng2 - lng1) * toRad;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // 緯度経度差をメートル換算する係数（平面近似用）
  // refLat における 1度あたりのメートル数を返す
  function metersPerDegree(refLat) {
    const toRad = Math.PI / 180;
    return {
      lat:
        111132.954 - 559.822 * Math.cos(2 * refLat * toRad) + 1.175 * Math.cos(4 * refLat * toRad),
      lng: 111319.488 * Math.cos(refLat * toRad),
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
  RoadDecoder.prototype.snapToNearestRoad = function (lat, lng, options) {
    options = options || {};
    // radiusGrids 明示指定がある場合は1回だけ検索（既存挙動）
    if (options.radiusGrids != null) {
      return this._searchSnap(lat, lng, options, options.radiusGrids);
    }
    // 未指定の場合はフォールバック検索（軽い→重いの順）
    // 1回目: radiusGrids=5（121グリッド）通常時はこれで成功
    const result = this._searchSnap(lat, lng, options, 5);
    if (result) return result;
    // 2回目: radiusGrids=9（361グリッド）長い道路の始点が遠い場合のフォールバック
    return this._searchSnap(lat, lng, options, 9);
  };

  // 内部関数：実際の snap 検索（radiusGrids 固定で1回だけ実行）
  // 公開 API は snapToNearestRoad を使うこと（フォールバック付き）
  RoadDecoder.prototype._searchSnap = function (lat, lng, options, radiusGrids) {
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
        const key = gy + dy + '_' + (gx + dx);
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
            const bLat = points[j + 1][0] / precision;
            const bLng = points[j + 1][1] / precision;

            // 平面化（lat=0, lng=0 を GPS 座標に置く）
            const ax = (aLng - lng) * mpdLng;
            const ay = (aLat - lat) * mpdLat;
            const bx = (bLng - lng) * mpdLng;
            const by = (bLat - lat) * mpdLat;
            // GPS は (0, 0)

            // 線分への投影
            const abx = bx - ax;
            const aby = by - ay;
            const ab2 = abx * abx + aby * aby;
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
            const distSq = sx * sx + sy * sy;

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
      typeCode: bestTypeCode,
    };
  };

  // ─── snapAllWithin (MM-2 多候補化) ───────────────────────────────
  // GPS 周辺の上位 K 個（既定 8）の snap 候補を距離昇順で返す。
  // emission スコアリング（距離 × heading × Mahalanobis × 道路種別）の入力
  // となる。snapToNearestRoad は内部で snapAllWithin の先頭 1 件を返す形と等価。
  // options:
  //   maxDistM     : 最大許容距離（既定 50m）
  //   K            : 返却候補上限（既定 8）
  //   typeFilter   : 道路タイプ配列（既定なし）
  //   radiusGrids  : 周辺グリッド検索範囲（既定: 5 → 9 でフォールバック）
  RoadDecoder.prototype.snapAllWithin = function (lat, lng, options) {
    options = options || {};
    const K = options.K != null ? options.K : 8;
    if (options.radiusGrids != null) {
      return this._searchAllSnaps(lat, lng, options, options.radiusGrids, K);
    }
    const result = this._searchAllSnaps(lat, lng, options, 5, K);
    if (result.length >= K) return result;
    // フォールバック: より広い範囲で再検索（長い道路の始点が遠い場合）
    return this._searchAllSnaps(lat, lng, options, 9, K);
  };

  // 内部: 多候補列挙（snapAllWithin から呼ばれる）
  // 各道路につき最近接 segment を 1 つ算出し、distanceM 昇順 K 個を返す。
  RoadDecoder.prototype._searchAllSnaps = function (lat, lng, options, radiusGrids, K) {
    const maxDistM = options.maxDistM != null ? options.maxDistM : 50;
    const typeFilter = options.typeFilter || null;
    const mpd = metersPerDegree(lat);
    const mpdLat = mpd.lat,
      mpdLng = mpd.lng;
    const precision = this.precision;
    const latInt = Math.round(lat * precision);
    const lngInt = Math.round(lng * precision);
    const gy = Math.floor(latInt / this.gridSize);
    const gx = Math.floor(lngInt / this.gridSize);
    const maxDistSq = maxDistM * maxDistM;
    const candidates = [];
    const seen = {};

    for (let dy = -radiusGrids; dy <= radiusGrids; dy++) {
      for (let dx = -radiusGrids; dx <= radiusGrids; dx++) {
        const key = gy + dy + '_' + (gx + dx);
        const ids = this.grid[key];
        if (!ids) continue;
        for (let i = 0; i < ids.length; i++) {
          const id = ids[i];
          if (seen[id]) continue;
          seen[id] = 1;
          const road = this.decodeRoadAt(id);
          if (!road) continue;
          if (typeFilter && typeFilter.indexOf(road.typeCode) < 0) continue;
          const points = road.points;
          let bestSegIdx = -1,
            bestT = 0;
          let bestSnapLat = 0,
            bestSnapLng = 0;
          let bestDistSq = Infinity;
          for (let j = 0; j < points.length - 1; j++) {
            const aLat = points[j][0] / precision;
            const aLng = points[j][1] / precision;
            const bLat = points[j + 1][0] / precision;
            const bLng = points[j + 1][1] / precision;
            const ax = (aLng - lng) * mpdLng;
            const ay = (aLat - lat) * mpdLat;
            const bx = (bLng - lng) * mpdLng;
            const by = (bLat - lat) * mpdLat;
            const abx = bx - ax,
              aby = by - ay;
            const ab2 = abx * abx + aby * aby;
            let t;
            if (ab2 < 1e-9) t = 0;
            else {
              t = (-ax * abx + -ay * aby) / ab2;
              if (t < 0) t = 0;
              else if (t > 1) t = 1;
            }
            const sx = ax + t * abx,
              sy = ay + t * aby;
            const distSq = sx * sx + sy * sy;
            if (distSq < bestDistSq) {
              bestDistSq = distSq;
              bestSegIdx = j;
              bestT = t;
              bestSnapLat = aLat + t * (bLat - aLat);
              bestSnapLng = aLng + t * (bLng - aLng);
            }
          }
          if (bestSegIdx >= 0 && bestDistSq <= maxDistSq) {
            // segment 端点を保持（heading score の bearing 計算に使用）
            const segLatA = points[bestSegIdx][0] / precision;
            const segLngA = points[bestSegIdx][1] / precision;
            const segLatB = points[bestSegIdx + 1][0] / precision;
            const segLngB = points[bestSegIdx + 1][1] / precision;
            candidates.push({
              roadIndex: id,
              segmentIndex: bestSegIdx,
              t: bestT,
              snapLat: bestSnapLat,
              snapLng: bestSnapLng,
              distanceM: Math.sqrt(bestDistSq),
              typeCode: road.typeCode,
              // v6/v7 attribute info（emission scoring 用）
              oneway: road.oneway != null ? road.oneway : 0,
              layer: road.layer != null ? road.layer : 0,
              lanes: road.lanes != null ? road.lanes : 0,
              width: road.width != null ? road.width : 0,
              incline: road.incline != null ? road.incline : 0,
              access: road.access != null ? road.access : 0,
              maxspeed: road.maxspeed != null ? road.maxspeed : 0, // T6 v7
              // segment bearing 計算用
              segLatA: segLatA,
              segLngA: segLngA,
              segLatB: segLatB,
              segLngB: segLngB,
            });
          }
        }
      }
    }
    candidates.sort(function (a, b) {
      return a.distanceM - b.distanceM;
    });
    return candidates.slice(0, K);
  };

  // ─── calcRoadDistance ───────────────────────────────────────────
  // 2つの snap 点間の道路上の距離を計算（メートル）
  // snapA, snapB: snapToNearestRoad の戻り値
  // 戻り値:
  //   { distanceM, onSameRoad: true } - 同じ道路上：道路上の距離
  //   { distanceM, onSameRoad: false } - 別道路：直線距離
  //   null - エラー
  RoadDecoder.prototype.calcRoadDistance = function (snapA, snapB) {
    if (!snapA || !snapB) return null;

    // 別の道路 → 直線距離（暫定）
    if (snapA.roadIndex !== snapB.roadIndex) {
      return {
        distanceM: haversineM(snapA.snapLat, snapA.snapLng, snapB.snapLat, snapB.snapLng),
        onSameRoad: false,
      };
    }

    // 同じ道路 → ポリラインに沿った距離を計算
    const road = this.decodeRoadAt(snapA.roadIndex);
    if (!road) return null;
    const points = road.points;
    const precision = this.precision;

    // どちらが前か
    let fromIdx, fromT, toIdx, toT;
    if (
      snapA.segmentIndex < snapB.segmentIndex ||
      (snapA.segmentIndex === snapB.segmentIndex && snapA.t <= snapB.t)
    ) {
      fromIdx = snapA.segmentIndex;
      fromT = snapA.t;
      toIdx = snapB.segmentIndex;
      toT = snapB.t;
    } else {
      fromIdx = snapB.segmentIndex;
      fromT = snapB.t;
      toIdx = snapA.segmentIndex;
      toT = snapA.t;
    }

    // ケース1：同じ線分上
    if (fromIdx === toIdx) {
      const aLat = points[fromIdx][0] / precision;
      const aLng = points[fromIdx][1] / precision;
      const bLat = points[fromIdx + 1][0] / precision;
      const bLng = points[fromIdx + 1][1] / precision;
      const segLen = haversineM(aLat, aLng, bLat, bLng);
      return {
        distanceM: segLen * (toT - fromT),
        onSameRoad: true,
      };
    }

    // ケース2：複数線分にまたがる
    let total = 0;

    // 1) from の線分の残り（fromT から 1.0 まで）
    {
      const aLat = points[fromIdx][0] / precision;
      const aLng = points[fromIdx][1] / precision;
      const bLat = points[fromIdx + 1][0] / precision;
      const bLng = points[fromIdx + 1][1] / precision;
      const segLen = haversineM(aLat, aLng, bLat, bLng);
      total += segLen * (1 - fromT);
    }

    // 2) 中間の線分（フル長さ）
    for (let i = fromIdx + 1; i < toIdx; i++) {
      const aLat = points[i][0] / precision;
      const aLng = points[i][1] / precision;
      const bLat = points[i + 1][0] / precision;
      const bLng = points[i + 1][1] / precision;
      total += haversineM(aLat, aLng, bLat, bLng);
    }

    // 3) to の線分の頭（0 から toT まで）
    {
      const aLat = points[toIdx][0] / precision;
      const aLng = points[toIdx][1] / precision;
      const bLat = points[toIdx + 1][0] / precision;
      const bLng = points[toIdx + 1][1] / precision;
      const segLen = haversineM(aLat, aLng, bLat, bLng);
      total += segLen * toT;
    }

    return {
      distanceM: total,
      onSameRoad: true,
    };
  };

  // export
  global.RoadDecoder = RoadDecoder;
})(
  typeof window !== 'undefined'
    ? window
    : typeof self !== 'undefined'
      ? self
      : typeof globalThis !== 'undefined'
        ? globalThis
        : this
);
