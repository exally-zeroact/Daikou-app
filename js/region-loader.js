// 地方判定・トンネル＋橋データ動的読み込み
// 2026/04/30：roads-*.js（都道府県別道路データ）対応追加
const RegionLoader = (() => {
  // 地方ごとのトンネル/橋データ
  const tunnelsData = {};
  const bridgesData = {};

  // 読み込み済みの地方
  const loaded = { tunnels: new Set(), bridges: new Set() };
  const loading = { tunnels: new Map(), bridges: new Map() };

  // ─── roads 用（2026/04/30 追加・既存機能とは独立） ─────────────
  // 都道府県別の RoadDecoder インスタンス
  const roadDecoders = new Map();          // prefecture(string) → RoadDecoder
  const loadedRoads = new Set();           // ロード済み都道府県
  const loadingRoads = new Map();          // ロード中の Promise

  // 地方判定
  function getRegion(lat, lng) {
    if (lat > 41.5) return 'hokkaido';
    if (lat < 28) return 'kyushu-okinawa';
    if (lat < 34 && lng < 132) return 'kyushu-okinawa';
    if (32.5 <= lat && lat <= 34.5 && 132 <= lng && lng <= 134.7) return 'shikoku';
    if (33 <= lat && lat <= 35.7 && 131 <= lng && lng <= 134.5) return 'chugoku';
    if (33 <= lat && lat <= 35.8 && 134.5 <= lng && lng <= 136.5) return 'kinki';
    if (33.5 <= lat && lat <= 35.5 && 136 <= lng && lng <= 137) return 'kinki';
    if (34.5 <= lat && lat <= 37.5 && 136 <= lng && lng <= 139) return 'chubu';
    if (36.5 <= lat && lat <= 38.5 && 137 <= lng && lng <= 139.8) return 'chubu';
    if (34.5 <= lat && lat <= 37 && 138.5 <= lng && lng <= 141) return 'kanto';
    if (lat >= 36.5) return 'tohoku';
    return null;
  }

  // 隣接地方
  const ADJACENT = {
    'hokkaido': ['tohoku'],
    'tohoku': ['hokkaido', 'kanto'],
    'kanto': ['tohoku', 'chubu'],
    'chubu': ['kanto', 'kinki'],
    'kinki': ['chubu', 'chugoku', 'shikoku'],
    'chugoku': ['kinki', 'shikoku', 'kyushu-okinawa'],
    'shikoku': ['kinki', 'chugoku', 'kyushu-okinawa'],
    'kyushu-okinawa': ['chugoku', 'shikoku'],
  };

  const REGION_TO_VAR = {
    'hokkaido': 'HOKKAIDO',
    'tohoku': 'TOHOKU',
    'kanto': 'KANTO',
    'chubu': 'CHUBU',
    'kinki': 'KINKI',
    'chugoku': 'CHUGOKU',
    'shikoku': 'SHIKOKU',
    'kyushu-okinawa': 'KYUSHU_OKINAWA',
  };

  // 動的JSファイル読み込み（共通）
  function loadFile(region, kind) {
    if (!region) return Promise.resolve(null);
    const dataMap = (kind === 'tunnels') ? tunnelsData : bridgesData;
    const loadedSet = loaded[kind];
    const loadingMap = loading[kind];
    const varPrefix = (kind === 'tunnels') ? 'TUNNELS_' : 'BRIDGES_';

    if (loadedSet.has(region)) return Promise.resolve(dataMap[region]);
    if (loadingMap.has(region)) return loadingMap.get(region);

    const promise = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = `data/${kind}-${region}.js`;
      script.async = true;
      script.onload = () => {
        const varName = varPrefix + REGION_TO_VAR[region];
        const data = window[varName];
        if (data) {
          dataMap[region] = data;
          loadedSet.add(region);
          dlog(`[Region] ${kind}/${region}: ${data.length}件`);
          resolve(data);
        } else {
          console.warn(`[Region] ${kind}/${region} 変数なし`);
          resolve(null);
        }
        loadingMap.delete(region);
      };
      script.onerror = () => {
        console.warn(`[Region] ${kind}/${region} 読み込み失敗`);
        loadingMap.delete(region);
        resolve(null);
      };
      document.head.appendChild(script);
    });

    loadingMap.set(region, promise);
    return promise;
  }

  // 現在地に基づき必要な地方を読み込む（トンネル＋橋両方）
  function ensureLoaded(lat, lng) {
    const region = getRegion(lat, lng);
    if (!region) return;
    loadFile(region, 'tunnels');
    loadFile(region, 'bridges');
    const adjacents = ADJACENT[region] || [];
    for (const adj of adjacents) {
      loadFile(adj, 'tunnels');
      loadFile(adj, 'bridges');
    }
  }

  // 最寄りトンネル検索
  function findNearestTunnel(lat, lng, maxDistanceM = 500) {
    return findNearest(lat, lng, maxDistanceM, tunnelsData, loaded.tunnels);
  }

  // 最寄り橋検索
  function findNearestBridge(lat, lng, maxDistanceM = 500) {
    return findNearest(lat, lng, maxDistanceM, bridgesData, loaded.bridges);
  }

  // 共通検索
  function findNearest(lat, lng, maxDistanceM, dataMap, loadedSet) {
    let best = null;
    let bestDist = maxDistanceM;
    for (const region of loadedSet) {
      const list = dataMap[region];
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

  function getStats() {
    let totalT = 0, totalB = 0;
    for (const region of loaded.tunnels) totalT += (tunnelsData[region] || []).length;
    for (const region of loaded.bridges) totalB += (bridgesData[region] || []).length;
    // roads 統計（2026/04/30追加）
    let totalRoads = 0;
    for (const pref of loadedRoads) {
      const decoder = roadDecoders.get(pref);
      if (decoder) totalRoads += decoder.numRoads;
    }
    return {
      loadedTunnelRegions: Array.from(loaded.tunnels),
      loadedBridgeRegions: Array.from(loaded.bridges),
      totalTunnels: totalT,
      totalBridges: totalB,
      // roads（2026/04/30追加）
      loadedRoadPrefectures: Array.from(loadedRoads),
      totalRoads: totalRoads,
    };
  }

  // ════════════════════════════════════════════════════════════
  // roads-*.js（都道府県別道路データ）対応・2026/04/30 追加
  // 既存機能（tunnels/bridges）とは独立して動作
  // ════════════════════════════════════════════════════════════

  // 47都道府県の重心座標（build-roads.js と同じ・getPrefecture用）
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

  // 緯度経度から最寄り都道府県を判定（重心からの近傍）
  function getPrefecture(lat, lng) {
    let best = null, bestDist = Infinity;
    for (const pref in PREFECTURES) {
      const [pLat, pLng] = PREFECTURES[pref];
      const dLat = lat - pLat;
      const dLng = lng - pLng;
      const d = dLat * dLat + dLng * dLng;
      if (d < bestDist) { bestDist = d; best = pref; }
    }
    return best;
  }

  // 1つの都道府県の roads データをロードして RoadDecoder を構築
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
        if (data && data.v === 4) {
          try {
            const decoder = new window.RoadDecoder(data);
            const result = decoder.buildOffsetTable();
            roadDecoders.set(prefecture, decoder);
            loadedRoads.add(prefecture);
            if (typeof dlog === 'function') {
              dlog(`[Region] roads/${prefecture}: ${data.numRoads}本 (build ${result.ms.toFixed(0)}ms)`);
            }
            resolve(decoder);
          } catch (e) {
            console.warn(`[Region] roads/${prefecture} デコーダー構築失敗:`, e.message);
            resolve(null);
          }
        } else {
          console.warn(`[Region] roads/${prefecture} 変数なし or 未対応バージョン`);
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

  // 指定された複数の都道府県の roads をロード
  // prefectures: 文字列の配列（例：['osaka', 'hyogo', 'kyoto']）
  // 戻り値：Promise（全部ロード完了で resolve）
  function ensureRoadsLoaded(prefectures) {
    if (!prefectures || prefectures.length === 0) return Promise.resolve([]);
    return Promise.all(prefectures.map(loadRoadFile));
  }

  // 指定都道府県の RoadDecoder を取得（ロード済みのみ）
  function getRoadDecoder(prefecture) {
    return roadDecoders.get(prefecture) || null;
  }

  // ロード済みの全 RoadDecoder から最寄り道路を探索
  // lat, lng: 実緯度経度
  // options: { maxDistM, typeFilter, radiusGrids }
  // 戻り値：snap オブジェクト（prefecture プロパティ付き）または null
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

  // 2つの snap 点間の道路距離を計算
  // snapA, snapB: snapToNearestRoad の戻り値
  function calcRoadDistance(snapA, snapB) {
    if (!snapA || !snapB) return null;
    // 同じ都道府県でなければ別道路扱い
    if (snapA.prefecture !== snapB.prefecture) {
      // Haversine 直線距離
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
    getRegion, ensureLoaded, findNearestTunnel, findNearestBridge, getStats,
    // roads 機能（2026/04/30 追加）
    getPrefecture, ensureRoadsLoaded, getRoadDecoder, 
    snapToNearestRoad, calcRoadDistance,
  };
})();
