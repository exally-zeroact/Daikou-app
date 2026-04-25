// 距離累積・料金計算
const Meter = (() => {
  let state = {
    running: false,
    distance_m: 0,
    fare_yen: 0,
    elapsed_sec: 0,
    start_time: null,
    last_gps: null,
  };

  let fareConfig = {
    base_fare: 1300,
    base_distance_m: 1000,
    add_fare: 100,
    add_distance_m: 420,
  };

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
    };
  }

  function update(gpsResult){
    if(!state.running) return;
    if(gpsResult.isStationary) return;
    if(state.last_gps){
      const d = GPS.calcDistance(
        state.last_gps.lat, state.last_gps.lng,
        gpsResult.lat, gpsResult.lng
      );
      state.distance_m += d;
      state.fare_yen = calcFare(state.distance_m);
    }
    state.last_gps = { lat: gpsResult.lat, lng: gpsResult.lng };
  }

  function calcFare(distanceM){
    if(distanceM <= fareConfig.base_distance_m) return fareConfig.base_fare;
    const extra = distanceM - fareConfig.base_distance_m;
    const steps = Math.floor(extra / fareConfig.add_distance_m);
    return fareConfig.base_fare + (steps * fareConfig.add_fare);
  }

  function getState(){ return { ...state }; }

  return { start, stop, reset, update, getState, setFareConfig, getFareConfig, calcFare };
})();
