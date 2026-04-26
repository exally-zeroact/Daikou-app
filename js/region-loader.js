// 地方判定・トンネルデータ動的読み込み
const RegionLoader = (() => {
  // 全地方のトンネルデータ（読み込み後に統合）
  const tunnelsData = {};

  // 既に読み込み済みの地方
  const loaded = new Set();

  // 読み込み中の地方（重複防止）
  const loading = new Map();

  // 地方判定（座標から）
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
    return null; // 範囲外
  }

  // 隣接地方（境界付近対応・先読み用）
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

  // 変数名マッピング
  const VAR_NAME = {
    'hokkaido': 'TUNNELS_HOKKAIDO',
    'tohoku': 'TUNNELS_TOHOKU',
    'kanto': 'TUNNELS_KANTO',
    'chubu': 'TUNNELS_CHUBU',
    'kinki': 'TUNNELS_KINKI',
    'chugoku': 'TUNNELS_CHUGOKU',
    'shikoku': 'TUNNELS_SHIKOKU',
    'kyushu-okinawa': 'TUNNELS_KYUSHU_OKINAWA',
  };

  // 動的にJSファイルを読み込む
  function loadRegion(region) {
    if (!region) return Promise.resolve(null);
    if (loaded.has(region)) return Promise.resolve(tunnelsData[region]);
    if (loading.has(region)) return loading.get(region);

    const promise = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = `data/tunnels-${region}.js`;
      script.async = true;
      script.onload = () => {
        const varName = VAR_NAME[region];
        const data = window[varName];
        if (data) {
          tunnelsData[region] = data;
          loaded.add(region);
          console.log(`[Region] ${region} loaded: ${data.length} tunnels`);
          resolve(data);
        } else {
          console.warn(`[Region] ${region} 変数が見つからない`);
          resolve(null);
        }
        loading.delete(region);
      };
      script.onerror = () => {
        console.warn(`[Region] ${region} 読み込み失敗`);
        loading.delete(region);
        resolve(null);
      };
      document.head.appendChild(script);
    });

    loading.set(region, promise);
    return promise;
  }

  // 現在地に基づいて必要な地方を読み込む
  function ensureLoaded(lat, lng) {
    const region = getRegion(lat, lng);
    if (!region) return;
    // 該当地方を読み込み
    loadRegion(region);
    // 隣接地方も先読み（境界対応）
    const adjacents = ADJACENT[region] || [];
    for (const adj of adjacents) {
      loadRegion(adj);
    }
  }

  // 全地方のトンネルから現在地に最も近いものを探す
  // returns: { tunnel, distanceToMid_m } | null
  function findNearestTunnel(lat, lng, maxDistanceM = 500) {
    let best = null;
    let bestDist = maxDistanceM;
    for (const region of loaded) {
      const list = tunnelsData[region];
      if (!list) continue;
      for (const t of list) {
        // t = [name, distance_m, [start_lat,lng], [end_lat,lng], [mid_lat,lng]]
        const midLat = t[4][0];
        const midLng = t[4][1];
        const d = haversine(lat, lng, midLat, midLng);
        if (d < bestDist) {
          bestDist = d;
          best = { tunnel: t, distanceToMid_m: d };
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

  // 統計情報
  function getStats() {
    let total = 0;
    for (const region of loaded) {
      total += (tunnelsData[region] || []).length;
    }
    return {
      loadedRegions: Array.from(loaded),
      totalTunnels: total,
    };
  }

  return { getRegion, ensureLoaded, loadRegion, findNearestTunnel, getStats };
})();
