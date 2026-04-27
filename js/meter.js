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
    gap_fill_count: 0,    // GPS消失補完回数（サマリー表示用）
    gap_fill_total_m: 0,  // GPS消失補完合計距離
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
      gap_fill_count: 0,
      gap_fill_total_m: 0,
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
  // ×1.3倍：直線距離は実際の道路距離より短いため補正係数を掛ける
  const ROAD_FACTOR = 1.3;
  // トンネル/橋方向とコンパス方向の許容差（度）
  const TUNNEL_COMPASS_THRESHOLD_DEG = 45;

  function calcBearingMeter(lat1, lng1, lat2, lng2){
    const φ1=lat1*Math.PI/180, φ2=lat2*Math.PI/180;
    const Δλ=(lng2-lng1)*Math.PI/180;
    return((Math.atan2(Math.sin(Δλ)*Math.cos(φ2),
      Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ))*180/Math.PI)+360)%360;
  }
  function angleDiffMeter(a,b){let d=Math.abs(a-b)%360;return d>180?360-d:d;}

  function calculateGapFill(prevLat, prevLng, currLat, currLng, gapSec, lastSpeedKmh, compassHeading){
    if(gapSec > GAP_MAX_SEC) return null;

    // 停車中（速度=0）の場合は座標差分で判断
    if(lastSpeedKmh <= 0){
      const coordDiff = GPS.calcDistance(prevLat, prevLng, currLat, currLng);
      if(coordDiff >= 20){
        const filled = coordDiff * ROAD_FACTOR;
        dlog(`[Meter] 停車中補完: 座標差分 ${Math.round(coordDiff)}m × ${ROAD_FACTOR} = ${Math.round(filled)}m`);
        return filled;
      }
      return null;
    }

    // 走行中の補完（速度×時間）
    const speedMs = lastSpeedKmh / 3.6;
    const naiveDistance = speedMs * gapSec;

    if(typeof RegionLoader === 'undefined') return naiveDistance * ROAD_FACTOR;

    let infra = RegionLoader.findNearestTunnel(prevLat, prevLng, NEAR_INFRA_RADIUS_M);
    if(!infra) infra = RegionLoader.findNearestBridge(prevLat, prevLng, NEAR_INFRA_RADIUS_M);

    if(infra){
      const infraLength = infra.item[1];
      const infraStart  = infra.item[2]; // [lat, lng]
      const infraEnd    = infra.item[3]; // [lat, lng]

      // コンパス方向と構造物方向の照合
      if(compassHeading != null){
        const infraBearing = calcBearingMeter(infraStart[0], infraStart[1], infraEnd[0], infraEnd[1]);
        // 双方向（順方向・逆方向）の小さい方で判定
        const diffFwd = angleDiffMeter(compassHeading, infraBearing);
        const diffRev = angleDiffMeter(compassHeading, (infraBearing + 180) % 360);
        const diff = Math.min(diffFwd, diffRev);

        if(diff <= TUNNEL_COMPASS_THRESHOLD_DEG){
          // コンパスと一致 → 構造物の実距離を採用（精度高い）
          const filled = Math.min(naiveDistance, infraLength);
          dlog(`[Meter] ${infra.item[0]} コンパス一致(${diff.toFixed(0)}°) → ${Math.round(filled)}m`);
          return filled;
        } else {
          // コンパスと不一致 → 誤検出の可能性・速度×時間×1.3で補完
          dlog(`[Meter] ${infra.item[0]} コンパス不一致(${diff.toFixed(0)}°) → 速度補完`);
          return naiveDistance * ROAD_FACTOR;
        }
      }

      // コンパスなし → 従来通り構造物長で補完
      const filled = Math.min(naiveDistance, infraLength);
      dlog(`[Meter] GPS消失補完: ${gapSec.toFixed(1)}秒 → ${Math.round(filled)}m (${infra.item[0]} ${infraLength}m)`);
      return filled;
    }

    // データなし → 速度×時間 × 1.3（道路係数）
    const filled = naiveDistance * ROAD_FACTOR;
    dlog(`[Meter] GPS消失補完: ${gapSec.toFixed(1)}秒 → ${Math.round(filled)}m (×${ROAD_FACTOR}補正)`);
    return filled;
  }

  function _recordGapFill(filledM){
    state.gap_fill_count++;
    state.gap_fill_total_m += filledM;
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
          dtSec, state.last_speed_kmh,
          state.last_gps.compassHeading
        );

        if(filled !== null){
          const gpsDistance = GPS.calcDistance3D(
            state.last_gps.lat, state.last_gps.lng, state.last_gps.altitude,
            gpsResult.lat, gpsResult.lng, gpsResult.altitude
          );
          const d = Math.min(filled, gpsDistance);
          state.distance_m += d;
          state.fare_yen = calcFare(state.distance_m);
          _recordGapFill(d); // 補完カウント
        }
        state.last_gps = { lat: gpsResult.lat, lng: gpsResult.lng, altitude: gpsResult.altitude, compassHeading: gpsResult.compassHeading || null };
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
    state.last_gps = { lat: gpsResult.lat, lng: gpsResult.lng, altitude: gpsResult.altitude, compassHeading: gpsResult.compassHeading || null };
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
