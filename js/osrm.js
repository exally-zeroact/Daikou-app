// OSRM マップマッチング モジュール
// パブリックAPI: router.project-osrm.org（無料・商用可）
// 1秒1リクエスト・100点までの制限あり
const OSRM = (() => {
  const CONFIG = {
    base_url: 'https://router.project-osrm.org/match/v1/driving',
    max_points: 100,           // OSRM API制限
    timeout_ms: 10000,         // 10秒タイムアウト
    min_distance_m: 500,       // 500m未満の走行はスキップ
    max_correction_ratio: 1.5, // 補正後が元の1.5倍を超えたら異常とみなして却下
    min_correction_ratio: 0.5, // 補正後が元の0.5倍未満なら異常とみなして却下
  };

  // トレースを間引く（最大100点に）
  function thinTrace(trace, maxPoints) {
    if (trace.length <= maxPoints) return trace;
    const step = trace.length / maxPoints;
    const thinned = [];
    for (let i = 0; i < maxPoints; i++) {
      thinned.push(trace[Math.floor(i * step)]);
    }
    // 必ず最後の点を含める
    if (thinned[thinned.length - 1] !== trace[trace.length - 1]) {
      thinned[thinned.length - 1] = trace[trace.length - 1];
    }
    return thinned;
  }

  // メインAPI: トレースを送信して補正後の距離を取得
  // trace: [{lat, lng, timestamp, accuracy}, ...]
  // 返り値: Promise<number | null>  補正後の距離(m)、失敗時はnull
  async function matchTrace(trace, originalDistanceM) {
    // バリデーション
    if (!trace || trace.length < 2) {
      console.log('[OSRM] トレース点が少ない・スキップ');
      return null;
    }
    if (originalDistanceM != null && originalDistanceM < CONFIG.min_distance_m) {
      console.log('[OSRM] 走行距離が短い(' + originalDistanceM + 'm)・スキップ');
      return null;
    }
    if (!navigator.onLine) {
      console.log('[OSRM] オフライン・スキップ');
      return null;
    }

    // 100点に間引く
    const thinned = thinTrace(trace, CONFIG.max_points);

    // 座標とタイムスタンプを構築
    const coords = thinned.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const timestamps = thinned.map(p => Math.floor(p.timestamp / 1000)).join(';');
    const radiuses = thinned.map(p => Math.min(Math.round(p.accuracy || 10), 50)).join(';');

    const url = `${CONFIG.base_url}/${coords}?timestamps=${timestamps}&radiuses=${radiuses}&overview=false&annotations=distance`;

    try {
      // タイムアウト付きfetch
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout_ms);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        console.log('[OSRM] HTTPエラー:', res.status);
        return null;
      }

      const data = await res.json();

      if (data.code !== 'Ok' || !data.matchings || data.matchings.length === 0) {
        console.log('[OSRM] マッチング失敗:', data.code);
        return null;
      }

      // 全matchingの距離を合計
      let totalDistance = 0;
      for (const m of data.matchings) {
        totalDistance += m.distance || 0;
      }

      // 異常値チェック: 元の距離と大きくかけ離れている場合は却下
      if (originalDistanceM != null && originalDistanceM > 0) {
        const ratio = totalDistance / originalDistanceM;
        if (ratio > CONFIG.max_correction_ratio || ratio < CONFIG.min_correction_ratio) {
          console.log('[OSRM] 補正値が異常(比率' + ratio.toFixed(2) + ')・却下');
          return null;
        }
      }

      console.log('[OSRM] 補正成功: ' + Math.round(totalDistance) + 'm (元:' + Math.round(originalDistanceM) + 'm)');
      return totalDistance;

    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('[OSRM] タイムアウト');
      } else {
        console.log('[OSRM] エラー:', err.message);
      }
      return null;
    }
  }

  return { matchTrace };
})();
