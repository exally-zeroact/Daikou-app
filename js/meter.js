// 距離累積・料金計算
const Meter = (() => {
  let state = {
    running: false,
    distance_m: 0,
    fare_yen: 0,
    elapsed_sec: 0,
    start_time: null,
    last_gps: null,
    last_timestamp: null,  // ハイブリッド計測用
  };

  let fareConfig = {
    base_fare: 1300,
    base_distance_m: 1000,
    add_fare: 100,
    add_distance_m: 420,
  };

  // ハイブリッド計測の閾値
  const HYBRID_SPEED_KMH = 30;        // 30km/h以上は速度積分
  const HYBRID_DISCREPANCY = 0.5;     // GPS距離と速度積分が50%以上違ったらGPSを採用

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
    };
  }

  function update(gpsResult){
    if(!state.running) return;
    if(gpsResult.isStationary) return;

    if(state.last_gps){
      // GPS座標差分での距離（基本）
      const gpsDistance = GPS.calcDistance(
        state.last_gps.lat, state.last_gps.lng,
        gpsResult.lat, gpsResult.lng
      );

      let d = gpsDistance;

      // ハイブリッド計測：30km/h以上は速度×時間で積分
      if(gpsResult.speedKmh >= HYBRID_SPEED_KMH && state.last_timestamp){
        const dtSec = (gpsResult.timestamp - state.last_timestamp) / 1000;
        if(dtSec > 0 && dtSec < 10){ // 異常な間隔は除外
          const speedMs = gpsResult.speedKmh / 3.6;
          const speedDistance = speedMs * dtSec;

          // 速度積分とGPS距離が大きく違ったらGPS距離を採用（保守）
          // 通常は両方近い値になるはず
          const maxV = Math.max(speedDistance, gpsDistance);
          if(maxV > 0 && Math.abs(speedDistance - gpsDistance) / maxV <= HYBRID_DISCREPANCY){
            d = speedDistance; // 速度積分を採用（高速時の安定性UP）
          }
        }
      }

      state.distance_m += d;
      state.fare_yen = calcFare(state.distance_m);
    }
    state.last_gps = { lat: gpsResult.lat, lng: gpsResult.lng };
    state.last_timestamp = gpsResult.timestamp;
  }

  function calcFare(distanceM){
    if(distanceM < fareConfig.base_distance_m) return fareConfig.base_fare;
    const extra = distanceM - fareConfig.base_distance_m;
    const steps = Math.floor(extra / fareConfig.add_distance_m) + 1;
    return fareConfig.base_fare + (steps * fareConfig.add_fare);
  }

  function getState(){ return { ...state }; }

  // OSRM補正用：距離を直接書き換えて料金再計算
  function setDistance(distanceM){
    state.distance_m = distanceM;
    state.fare_yen = calcFare(distanceM);
  }

  // 確定キャンセル時に状態を保持したまま再開
  function resume(){
    if(state.running) return;
    state.running = true;
    if(timer) clearInterval(timer);
    timer = setInterval(() => { if(state.running) state.elapsed_sec++; }, 1000);
  }

  return { start, stop, reset, resume, update, getState, setFareConfig, getFareConfig, calcFare, setDistance };
})();
