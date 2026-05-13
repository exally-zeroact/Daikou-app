// 都道府県別データの動的読み込み（橋・トンネル・道路）
// 2026/05: 橋・トンネルを地方別 → 都道府県別に統一
//          公開 API（findNearestBridge / findNearestTunnel / ensureLoaded）は無変更
const RegionLoader = (() => {
  // 都道府県別データ（橋・トンネル）
  const tunnelsData = {};        // pref → 配列
  const bridgesData = {};
  const loaded = { tunnels: new Set(), bridges: new Set() };
  const loading = { tunnels: new Map(), bridges: new Map() };

  // 道路（roads-decoder ベース）
  const roadDecoders = new Map();
  const loadedRoads = new Set();
  const loadingRoads = new Map();

  // 47 都道府県の重心 [lat, lon]
  const PREFECTURES = {
    hokkaido:  [43.3, 142.8],
    aomori:    [40.8, 140.7], iwate:    [39.7, 141.2], miyagi:    [38.3, 140.9],
    akita:     [39.7, 140.4], yamagata: [38.2, 140.0], fukushima: [37.4, 140.2],
    ibaraki:   [36.4, 140.4], tochigi:  [36.7, 139.9], gunma:     [36.4, 139.0],
    saitama:   [35.9, 139.4], chiba:    [35.5, 140.2], tokyo:     [35.7, 139.7],
    kanagawa:  [35.4, 139.4],
    niigata:   [37.5, 138.9], toyama:   [36.6, 137.2], ishikawa:  [36.6, 136.7],
    fukui:     [35.8, 136.2], yamanashi:[35.6, 138.6], nagano:    [36.2, 138.0],
    gifu:      [35.6, 137.0], shizuoka: [34.9, 138.4], aichi:     [35.1, 137.0],
    mie:       [34.6, 136.5], shiga:    [35.1, 136.1], kyoto:     [35.2, 135.7],
    osaka:     [34.6, 135.5], hyogo:    [35.0, 134.9], nara:      [34.4, 135.8],
    wakayama:  [33.8, 135.5],
    tottori:   [35.4, 134.0], shimane:  [35.0, 132.8], okayama:   [34.9, 133.8],
    hiroshima: [34.5, 132.7], yamaguchi:[34.2, 131.6],
    tokushima: [33.9, 134.4], kagawa:   [34.3, 134.0],
    ehime:     [33.7, 132.9], kochi:    [33.5, 133.5],
    fukuoka:   [33.6, 130.7], saga:     [33.3, 130.1], nagasaki:  [32.9, 129.9],
    kumamoto:  [32.7, 130.7], oita:     [33.2, 131.4], miyazaki:  [32.0, 131.4],
    kagoshima: [31.4, 130.6], okinawa:  [26.5, 128.0],
  };

  // 中心の県＋N 県（重心距離順）を返す・ensureLoaded 内部用
  function nearestPrefectures(lat, lng, n = 5) {
    const arr = [];
    for (const pref in PREFECTURES) {
      const [pLat, pLng] = PREFECTURES[pref];
      const dLat = lat - pLat;
      const dLng = lng - pLng;
      arr.push({ pref, d: dLat * dLat + dLng * dLng });
    }
    arr.sort((a, b) => a.d - b.d);
    return arr.slice(0, n).map(x => x.pref);
  }

  // 県別 JS 動的読み込み（共通）
  function loadFile(prefecture, kind) {
    if (!prefecture) return Promise.resolve(null);
    const dataMap = (kind === 'tunnels') ? tunnelsData : bridgesData;
    const loadedSet = loaded[kind];
    const loadingMap = loading[kind];
    const varPrefix = (kind === 'tunnels') ? 'TUNNELS_' : 'BRIDGES_';

    if (loadedSet.has(prefecture)) return Promise.resolve(dataMap[prefecture]);
    if (loadingMap.has(prefecture)) return loadingMap.get(prefecture);

    const promise = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = `data/${kind}-${prefecture}.js`;
      script.async = true;
      script.onload = () => {
        const varName = varPrefix + prefecture.toUpperCase().replace(/-/g, '_');
        const data = window[varName];
        if (data) {
          dataMap[prefecture] = data;
          loadedSet.add(prefecture);
          if (typeof dlog === 'function') {
            dlog(`[Region] ${kind}/${prefecture}: ${data.length}件`);
          }
          resolve(data);
        } else {
          console.warn(`[Region] ${kind}/${prefecture} 変数なし`);
          resolve(null);
        }
        loadingMap.delete(prefecture);
      };
      script.onerror = () => {
        // 県ファイルが存在しない（橋・トンネルが0件の県）は警告レベルを下げる
        if (typeof dlog === 'function') {
          dlog(`[Region] ${kind}/${prefecture} 読み込み失敗（県内データなしの可能性）`);
        }
        loadingMap.delete(prefecture);
        resolve(null);
      };
      document.head.appendChild(script);
    });

    loadingMap.set(prefecture, promise);
    return promise;
  }

  // 公開 API: 現在地に基づき必要な県を読み込む（橋＋トンネル両方）
  // 後方互換: シグネチャ ensureLoaded(lat, lng) は維持
  function ensureLoaded(lat, lng) {
    const prefs = nearestPrefectures(lat, lng, 5);
    for (const pref of prefs) {
      loadFile(pref, 'tunnels');
      loadFile(pref, 'bridges');
    }
  }

  // 公開 API（シグネチャ無変更）
  function findNearestTunnel(lat, lng, maxDistanceM = 500) {
    return findNearest(lat, lng, maxDistanceM, tunnelsData, loaded.tunnels);
  }
  function findNearestBridge(lat, lng, maxDistanceM = 500) {
    return findNearest(lat, lng, maxDistanceM, bridgesData, loaded.bridges);
  }

  function findNearest(lat, lng, maxDistanceM, dataMap, loadedSet) {
    let best = null;
    let bestDist = maxDistanceM;
    for (const pref of loadedSet) {
      const list = dataMap[pref];
      if (!list) continue;
      for (const t of list) {
        const midLat = t[4][0];
        const midLng = t[4][1];
        const d = haversine(lat, lng, midLat, midLng);
        if (d < bestDist) {
          bestDist = d;
          best = { item: t, distanceToMid_m: d };
        }
      }
    }
    return best;
  }

  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // ════════════════════════════════════════════════════════════
  // Phase 1.B (2026-05-10): polyline 投影系 API
  //   findNearestTunnel/Bridge は mid から半径 maxDist で探すため、
  //   長トンネル (1km+) の端点が mid から離れていると見逃す。
  //   polyline 投影距離で「点が tunnel 上にあるか」を判定する API を追加。
  //   tunnels の polyline は [start, mid, end] の 3 点 (= 2 segment)。
  // ════════════════════════════════════════════════════════════

  // 点 (lat, lng) を polyline (= [[lat,lng], ...]) に投影
  // 戻り値: { segmentIndex, t (0-1), projectedLat, projectedLng, distM }
  function _projectOntoPolyline(lat, lng, polyline) {
    let bestSeg = -1, bestT = 0, bestDistM = Infinity;
    let bestLat = lat, bestLng = lng;
    for (let i = 0; i < polyline.length - 1; i++) {
      const aLat = polyline[i][0], aLng = polyline[i][1];
      const bLat = polyline[i+1][0], bLng = polyline[i+1][1];
      const refLat = (aLat + bLat) / 2;
      const tr = Math.PI / 180;
      const mpdLat = 111000;
      const mpdLng = 111000 * Math.cos(refLat * tr);
      const ax = (aLng - lng) * mpdLng;
      const ay = (aLat - lat) * mpdLat;
      const bx = (bLng - lng) * mpdLng;
      const by = (bLat - lat) * mpdLat;
      const abx = bx - ax, aby = by - ay;
      const ab2 = abx*abx + aby*aby;
      let t = 0;
      if (ab2 > 1e-9) {
        t = -(ax * abx + ay * aby) / ab2;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
      }
      const sx = ax + t * abx, sy = ay + t * aby;
      const distM = Math.sqrt(sx*sx + sy*sy);
      if (distM < bestDistM) {
        bestDistM = distM;
        bestSeg = i;
        bestT = t;
        bestLat = aLat + t * (bLat - aLat);
        bestLng = aLng + t * (bLng - aLng);
      }
    }
    return {
      segmentIndex: bestSeg, t: bestT,
      projectedLat: bestLat, projectedLng: bestLng,
      distM: bestDistM,
    };
  }

  // (lat, lng) が tunnel/bridge polyline の maxDistM 以内にあるか探す
  // 長トンネルでも端点近傍を正しく検出できる
  function findTunnelByPosition(lat, lng, maxDistM = 200) {
    return _findInfraByPosition(lat, lng, maxDistM, tunnelsData, loaded.tunnels);
  }
  function findBridgeByPosition(lat, lng, maxDistM = 200) {
    return _findInfraByPosition(lat, lng, maxDistM, bridgesData, loaded.bridges);
  }
  function _findInfraByPosition(lat, lng, maxDistM, dataMap, loadedSet) {
    let best = null;
    let bestDist = maxDistM;
    for (const pref of loadedSet) {
      const list = dataMap[pref];
      if (!list) continue;
      for (const t of list) {
        const polyline = [t[2], t[4], t[3]]; // start, mid, end
        const proj = _projectOntoPolyline(lat, lng, polyline);
        if (proj.distM < bestDist) {
          bestDist = proj.distM;
          best = { item: t, distanceToPolyline_m: proj.distM, projection: proj };
        }
      }
    }
    return best;
  }

  // infra (tunnel/bridge) polyline 上の A→B 実走距離を計算
  // infra: { item: [name, length, start, end, mid] }
  // 戻り値: 距離 (m)・projection 距離が大きすぎる場合 null
  // 計算:
  //   1. polyline (start,mid,end) 上に A・B を射影
  //   2. 各々の projection の polyline 始点からの累積距離を求める
  //   3. |dB - dA| が straight-line 累積・実 length / straight-line 比で curvature 補正
  function calcInfraPolylineDistance(infra, latA, lngA, latB, lngB) {
    if (!infra || !infra.item) return null;
    const start = infra.item[2];
    const mid = infra.item[4];
    const end = infra.item[3];
    const polyline = [start, mid, end];
    const totalLength = infra.item[1];
    const seg1 = haversine(start[0], start[1], mid[0], mid[1]);
    const seg2 = haversine(mid[0], mid[1], end[0], end[1]);
    const polyStraightLen = seg1 + seg2;
    if (polyStraightLen < 1) return null;
    // 実 length / straight 比で curvature 補正
    const curveScale = totalLength / polyStraightLen;
    const projA = _projectOntoPolyline(latA, lngA, polyline);
    const projB = _projectOntoPolyline(latB, lngB, polyline);
    // polyline から離れすぎ → 信頼できない
    if (projA.distM > 200 || projB.distM > 200) return null;
    function cumDist(proj) {
      let d = 0;
      if (proj.segmentIndex >= 1) d += seg1;
      const segLen = (proj.segmentIndex === 0) ? seg1 : seg2;
      d += segLen * proj.t;
      return d;
    }
    const dA = cumDist(projA);
    const dB = cumDist(projB);
    return Math.abs(dB - dA) * curveScale;
  }

  // ════════════════════════════════════════════════════════════
  // roads-*.js（都道府県別道路データ）対応
  // ════════════════════════════════════════════════════════════

  function loadRoadFile(prefecture) {
    if (!prefecture) return Promise.resolve(null);
    if (loadedRoads.has(prefecture)) return Promise.resolve(roadDecoders.get(prefecture));
    if (loadingRoads.has(prefecture)) return loadingRoads.get(prefecture);

    if (typeof window.RoadDecoder !== 'function') {
      console.warn('[Region] RoadDecoder 未定義（roads-decoder.js を先に読み込んでください）');
      return Promise.resolve(null);
    }

    const promise = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = `data/roads-${prefecture}.js`;
      script.async = true;
      script.onload = () => {
        const varName = 'ROADS_' + prefecture.toUpperCase().replace(/-/g, '_');
        const data = window[varName];
        // ★設計変更宣言 (2026-05-10): v6/v7 受入れ追加
        //   旧: v === 4 || v === 5 のみ → 47 県 v7 build 後は全件 warn 出力
        //   新: 4-7 を全て受入・将来 v8 が来ても roads-decoder 互換ならそのまま動く
        //   data.v が無い (= window 変数未設定) ケースのみ silent dlog に降格
        //   (script は load 成功・MM は worker B 側で別 path で稼働中)
        if (data && typeof data.v === 'number' && data.v >= 4 && data.v <= 7) {
          try {
            const decoder = new window.RoadDecoder(data);
            const result = decoder.buildOffsetTable();
            roadDecoders.set(prefecture, decoder);
            loadedRoads.add(prefecture);
            if (typeof dlog === 'function') {
              dlog(`[Region] roads/${prefecture}: ${data.numRoads}本 v${data.v} (build ${result.ms.toFixed(0)}ms)`);
            }
            resolve(decoder);
          } catch (e) {
            console.warn(`[Region] roads/${prefecture} デコーダー構築失敗:`, e.message);
            resolve(null);
          }
        } else if (data && typeof data.v === 'number') {
          // 既知の data あるが version 範囲外 → 真の警告
          console.warn(`[Region] roads/${prefecture} 未対応バージョン v${data.v}`);
          resolve(null);
        } else {
          // window 変数未設定 = 別 path (Worker B forward) で稼働中の可能性
          // dlog (DEBUG 限定) に降格して prod console を汚さない
          if (typeof dlog === 'function') {
            dlog(`[Region] roads/${prefecture} 変数未設定 (Worker B path で稼働の可能性)`);
          }
          resolve(null);
        }
        loadingRoads.delete(prefecture);
      };
      script.onerror = () => {
        console.warn(`[Region] roads/${prefecture} 読み込み失敗`);
        loadingRoads.delete(prefecture);
        resolve(null);
      };
      document.head.appendChild(script);
    });

    loadingRoads.set(prefecture, promise);
    return promise;
  }

  function ensureRoadsLoaded(prefectures) {
    if (!prefectures || prefectures.length === 0) return Promise.resolve([]);
    return Promise.all(prefectures.map(loadRoadFile));
  }

  function snapToNearestRoad(lat, lng, options) {
    if (loadedRoads.size === 0) return null;
    let best = null;
    let bestPref = null;
    for (const pref of loadedRoads) {
      const decoder = roadDecoders.get(pref);
      if (!decoder) continue;
      const snap = decoder.snapToNearestRoad(lat, lng, options);
      if (snap && (!best || snap.distanceM < best.distanceM)) {
        best = snap;
        bestPref = pref;
      }
    }
    if (best) best.prefecture = bestPref;
    return best;
  }

  function calcRoadDistance(snapA, snapB) {
    if (!snapA || !snapB) return null;
    if (snapA.prefecture !== snapB.prefecture) {
      const R = 6371000;
      const tr = Math.PI / 180;
      const dLat = (snapB.snapLat - snapA.snapLat) * tr;
      const dLng = (snapB.snapLng - snapA.snapLng) * tr;
      const a = Math.sin(dLat/2)**2 + Math.cos(snapA.snapLat*tr)*Math.cos(snapB.snapLat*tr)*Math.sin(dLng/2)**2;
      return {
        distanceM: R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)),
        onSameRoad: false
      };
    }
    const decoder = roadDecoders.get(snapA.prefecture);
    if (!decoder) return null;
    return decoder.calcRoadDistance(snapA, snapB);
  }

  return {
    ensureLoaded, findNearestTunnel, findNearestBridge,
    ensureRoadsLoaded,
    snapToNearestRoad, calcRoadDistance,
    nearestPrefectures,
    // Phase 1.B (2026-05-10): polyline 投影 API
    findTunnelByPosition, findBridgeByPosition, calcInfraPolylineDistance,
  };
})();
