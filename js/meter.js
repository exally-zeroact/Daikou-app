// 距離累積・料金計算
const Meter = (() => {
  let state = {
    running: false,
    distance_m: 0,
    fare_yen: 0,
    elapsed_sec: 0,
    start_time: null,
    last_gps: null,
    last_timestamp: null,
    last_speed_kmh: 0,    // GPS消失時の補完用
  };

  let fareConfig = {
    base_fare: 1300,
    base_distance_m: 1000,
    add_fare: 100,
    add_distance_m: 420,
  };

  // ハイブリッド計測の閾値
  const HYBRID_SPEED_KMH = 30;
  const HYBRID_DISCREPANCY = 0.5;

  // GPS消失補完の閾値
  const GAP_THRESHOLD_SEC = 5;        // 5秒以上の空白＝GPS消失
  const GAP_MAX_SEC = 600;            // 最大10分（それ以上は異常）
  const NEAR_INFRA_RADIUS_M = 200;    // 200m以内のトンネル/橋を「該当」と判定

  let timer = null;

  function setFareConfig(config){ fareConfig = { ...fareConfig, ...config }; }
  function getFareConfig(){ return { ...fareConfig }; }

  function start(){
    state = {
      running: true,
      distance_m: 0,
      fare_yen: fareConfig.base_fare,
      elapsed_sec: 0,
      start_time: Date.now(),
      last_gps: null,
      last_timestamp: null,
      last_speed_kmh: 0,
    };
    if(timer) clearInterval(timer);
    timer = setInterval(() => { if(state.running) state.elapsed_sec++; }, 1000);
  }

  function stop(){
    state.running = false;
    if(timer){ clearInterval(timer); timer = null; }
  }

  function reset(){
    stop();
    state = {
      running: false,
      distance_m: 0,
      fare_yen: 0,
      elapsed_sec: 0,
      start_time: null,
      last_gps: null,
      last_timestamp: null,
      last_speed_kmh: 0,
    };
  }

  // GPS消失時の補完（トンネル・橋データ活用）
  // returns: 補完すべき距離(m) | null（補完しない）
  function calculateGapFill(prevLat, prevLng, currLat, currLng, gapSec, lastSpeedKmh){
    // 速度がない or 異常な空白時間なら補完しない
    if(lastSpeedKmh <= 0) return null;
    if(gapSec > GAP_MAX_SEC) return null;

    // 速度×時間で素直な補完値を計算
    const speedMs = lastSpeedKmh / 3.6;
    const naiveDistance = speedMs * gapSec;

    // RegionLoaderが使えない（データ未読込）→素直な補完を返す
    if(typeof RegionLoader === 'undefined') return naiveDistance;

    // 直前の位置にトンネルor橋があるか確認
    let infra = RegionLoader.findNearestTunnel(prevLat, prevLng, NEAR_INFRA_RADIUS_M);
    if(!infra) infra = RegionLoader.findNearestBridge(prevLat, prevLng, NEAR_INFRA_RADIUS_M);

    if(infra){
      // トンネル/橋データあり → 構造物の長さを上限に補完
      const infraLength = infra.item[1]; // distance_m
      // 速度×時間 と 構造物長 の小さい方を採用（暴走防止）
      const filled = Math.min(naiveDistance, infraLength);
      dlog(`[Meter] GPS消失補完: ${gapSec.toFixed(1)}秒 → ${Math.round(filled)}m (${infra.item[0]} ${infraLength}m)`);
      return filled;
    }

    // データなし → 素直な補完
    dlog(`[Meter] GPS消失補完: ${gapSec.toFixed(1)}秒 → ${Math.round(naiveDistance)}m (データなし)`);
    return naiveDistance;
  }

  function update(gpsResult){
    if(!state.running) return;
    if(gpsResult.isStationary) return;

    if(state.last_gps && state.last_timestamp){
      const dtSec = (gpsResult.timestamp - state.last_timestamp) / 1000;

      // GPS消失検出：5秒以上の空白
      if(dtSec >= GAP_THRESHOLD_SEC){
        // 補完計算（トンネル/橋データ活用）
        const filled = calculateGapFill(
          state.last_gps.lat, state.last_gps.lng,
          gpsResult.lat, gpsResult.lng,
          dtSec, state.last_speed_kmh
        );

        if(filled !== null){
          // GPS座標差分も計算（瞬間ジャンプ可能性）
          // 案AA：3D距離計算（高度差を加味・2026/04/26）
          const gpsDistance = GPS.calcDistance3D(
            state.last_gps.lat, state.last_gps.lng, state.last_gps.altitude,
            gpsResult.lat, gpsResult.lng, gpsResult.altitude
          );
          // 補完値とGPS距離の小さい方を採用（保守的）
          // GPS距離が大きい場合は復帰時の瞬間ジャンプの可能性が高い
          const d = Math.min(filled, gpsDistance);
          state.distance_m += d;
          state.fare_yen = calcFare(state.distance_m);
        }
        state.last_gps = { lat: gpsResult.lat, lng: gpsResult.lng, altitude: gpsResult.altitude };
        state.last_timestamp = gpsResult.timestamp;
        state.last_speed_kmh = gpsResult.speedKmh || 0;
        return;
      }

      // 通常処理：GPS距離計算
      // 案AA：3D距離計算（高度差を加味・2026/04/26）
      const gpsDistance = GPS.calcDistance3D(
        state.last_gps.lat, state.last_gps.lng, state.last_gps.altitude,
        gpsResult.lat, gpsResult.lng, gpsResult.altitude
      );

      let d = gpsDistance;

      // ハイブリッド計測：30km/h以上は速度×時間で積分
      if(gpsResult.speedKmh >= HYBRID_SPEED_KMH){
        if(dtSec > 0 && dtSec < 10){
          const speedMs = gpsResult.speedKmh / 3.6;
          const speedDistance = speedMs * dtSec;
          const maxV = Math.max(speedDistance, gpsDistance);
          if(maxV > 0 && Math.abs(speedDistance - gpsDistance) / maxV <= HYBRID_DISCREPANCY){
            d = speedDistance;
          }
        }
      }

      state.distance_m += d;
      state.fare_yen = calcFare(state.distance_m);
    }
    state.last_gps = { lat: gpsResult.lat, lng: gpsResult.lng, altitude: gpsResult.altitude };
    state.last_timestamp = gpsResult.timestamp;
    state.last_speed_kmh = gpsResult.speedKmh || 0;
  }

  function calcFare(distanceM){
    if(distanceM < fareConfig.base_distance_m) return fareConfig.base_fare;
    const extra = distanceM - fareConfig.base_distance_m;
    const steps = Math.floor(extra / fareConfig.add_distance_m) + 1;
    return fareConfig.base_fare + (steps * fareConfig.add_fare);
  }

  function getState(){ return { ...state }; }

  function setDistance(distanceM){
    state.distance_m = distanceM;
    state.fare_yen = calcFare(distanceM);
  }

  // リロード復元用：最終GPS状態をセット（層3・GPS消失補完を復元後に発火させる）
  function setLastGps(lat, lng, altitude, speedKmh, timestamp){
    state.last_gps = { lat, lng, altitude };
    state.last_timestamp = timestamp;
    state.last_speed_kmh = speedKmh || 0;
  }

  function resume(){
    if(state.running) return;
    state.running = true;
    if(timer) clearInterval(timer);
    timer = setInterval(() => { if(state.running) state.elapsed_sec++; }, 1000);
  }

  return { start, stop, reset, resume, update, getState, setFareConfig, getFareConfig, calcFare, setDistance, setLastGps };
})();
