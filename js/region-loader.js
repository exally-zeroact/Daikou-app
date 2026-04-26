// 地方判定・トンネル＋橋データ動的読み込み
const RegionLoader = (() => {
  // 地方ごとのトンネル/橋データ
  const tunnelsData = {};
  const bridgesData = {};

  // 読み込み済みの地方
  const loaded = { tunnels: new Set(), bridges: new Set() };
  const loading = { tunnels: new Map(), bridges: new Map() };

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
          console.log(`[Region] ${kind}/${region}: ${data.length}件`);
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
    return {
      loadedTunnelRegions: Array.from(loaded.tunnels),
      loadedBridgeRegions: Array.from(loaded.bridges),
      totalTunnels: totalT,
      totalBridges: totalB,
    };
  }

  return { getRegion, ensureLoaded, findNearestTunnel, findNearestBridge, getStats };
})();
