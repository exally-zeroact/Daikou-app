// ===========================================
// gps.js（Web Worker対応版・2026/04/27更新）
// GPS取得はメインスレッド・計算処理はWorkerで実行
// Worker非対応ブラウザは自動でフォールバック
// ===========================================
const GPS = (() => {
  let watchId = null;
  let onUpdateCallback = null;
  let worker = null;
  let useWorker = false;

  // フォールバック用状態変数（Worker非対応時）
  let lastPosition = null;
  let lowSpeedStart = null;
  let isStationary = false;
  let trafficJamSince = null;
  let isTrafficJam = false;
  let kalman = null;

  const CONFIG = {
    speed_limit_kmh: 3,
    stationary_sec: 5,
    stationary_radius_m: 3,
    stationary_radius_jam_m: 1,
    resume_speed_kmh: 5,
    jump_limit_m_per_s: 50,
    max_acceleration_ms2: 8,
    heading_diff_threshold_deg: 90,
    heading_check_min_distance_m: 5,
    heading_check_min_speed_kmh: 5,
    kalman_Q: 3,
    jam_speed_max_kmh: 10,
    jam_duration_sec: 60,
  };

  function initWorker() {
    if (typeof Worker === 'undefined') {
      dlog('[GPS] Web Worker非対応 → フォールバック');
      useWorker = false;
      return;
    }
    try {
      worker = new Worker('js/gps-worker.js');
      worker.postMessage({ type: 'init', data: {
        config: CONFIG,
        debug: (typeof DEBUG !== 'undefined') ? DEBUG.enabled : false
      }});
      worker.onmessage = function(e) {
        if (e.data.type === 'result') {
          if (onUpdateCallback) onUpdateCallback(e.data.data);
        }
      };
      worker.onerror = function(err) {
        console.error('[GPS] Worker エラー → フォールバック:', err.message);
        useWorker = false;
        kalman = new KalmanGPS();
      };
      useWorker = true;
      dlog('[GPS] Web Worker起動完了');
    } catch(e) {
      console.error('[GPS] Worker起動失敗 → フォールバック:', e.message);
      useWorker = false;
    }
  }

  function start(callback) {
    onUpdateCallback = callback;
    if (!worker) initWorker();
    if (!useWorker) {
      kalman = new KalmanGPS();
      lastPosition = null; lowSpeedStart = null; isStationary = false;
      trafficJamSince = null; isTrafficJam = false;
    } else {
      worker.postMessage({ type: 'init', data: {
        config: CONFIG,
        debug: (typeof DEBUG !== 'undefined') ? DEBUG.enabled : false
      }});
    }
    if (!navigator.geolocation) { alert('GPSに対応していません'); return; }
    watchId = navigator.geolocation.watchPosition(onPosition, onError,
      { enableHighAccuracy: true, timeout: 3000, maximumAge: 0 });
  }

  function stop() {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if (useWorker && worker) {
      worker.postMessage({ type: 'reset', data: {} });
    } else {
      if (kalman) kalman.reset();
      lastPosition = null; lowSpeedStart = null; isStationary = false;
      trafficJamSince = null; isTrafficJam = false;
    }
  }

  function onPosition(pos) {
    const now = Date.now();
    const { latitude: lat, longitude: lng, accuracy, speed, heading, altitude } = pos.coords;
    const speedKmh = (speed != null && speed >= 0) ? speed * 3.6 : 0;
    if (useWorker) {
      worker.postMessage({ type: 'position',
        data: { lat, lng, accuracy, speedKmh, heading, altitude, now }
      });
    } else {
      const result = processPositionFallback(lat, lng, accuracy, speedKmh, heading, altitude, now);
      if (result && onUpdateCallback) onUpdateCallback(result);
    }
  }

  // フォールバック用Kalman
  class KalmanGPS {
    constructor() { this._lat=null; this._lng=null; this._accuracy=0; this._timestamp=null; }
    reset() { this._lat=null; this._lng=null; this._accuracy=0; this._timestamp=null; }
    update(lat, lng, accuracy, timestamp) {
      if (this._lat===null) { this._lat=lat; this._lng=lng; this._accuracy=accuracy; this._timestamp=timestamp; return {lat,lng}; }
      const dt = (timestamp-this._timestamp)/1000;
      if (dt<=0||dt>30) { this._lat=lat; this._lng=lng; this._accuracy=accuracy; this._timestamp=timestamp; return {lat,lng}; }
      const Q=CONFIG.kalman_Q;
      const decayed=Math.sqrt(this._accuracy*this._accuracy+Q*Q*dt*dt);
      const K=decayed*decayed/(decayed*decayed+accuracy*accuracy);
      this._lat=this._lat+K*(lat-this._lat);
      this._lng=this._lng+K*(lng-this._lng);
      this._accuracy=Math.sqrt((1-K)*decayed*decayed);
      this._timestamp=timestamp;
      if (!isFinite(this._lat)||!isFinite(this._lng)) { this._lat=lat; this._lng=lng; this._accuracy=accuracy; return {lat,lng}; }
      return {lat:this._lat, lng:this._lng};
    }
  }

  function processPositionFallback(lat, lng, accuracy, speedKmh, heading, altitude, now) {
    const accLimit = getDynamicAccuracyLimit(speedKmh, now);
    if (accuracy > accLimit) return null;
    if (lastPosition) {
      const jump = calcDistance(lastPosition.lat, lastPosition.lng, lat, lng);
      const timeDiff = (now-lastPosition.timestamp)/1000;
      if (timeDiff>0 && jump/timeDiff > CONFIG.jump_limit_m_per_s) return null;
    }
    if (lastPosition && lastPosition.speedKmh!=null && lastPosition.speedKmh>1 && speedKmh>1) {
      const dt=(now-lastPosition.timestamp)/1000;
      if (dt>0&&dt<5) {
        const acc=((speedKmh-lastPosition.speedKmh)/3.6)/dt;
        if (Math.abs(acc)>CONFIG.max_acceleration_ms2) { dlog('[GPS] 加速度異常スキップ'); return null; }
      }
    }
    if (lastPosition && heading!=null && heading>=0 && speedKmh>=CONFIG.heading_check_min_speed_kmh) {
      const d=calcDistance(lastPosition.lat,lastPosition.lng,lat,lng);
      if (d>=CONFIG.heading_check_min_distance_m) {
        const mb=calcBearing(lastPosition.lat,lastPosition.lng,lat,lng);
        if (angleDiff(heading,mb)>CONFIG.heading_diff_threshold_deg) { dlog('[GPS] 方向不整合スキップ'); return null; }
      }
    }
    checkTrafficJamFallback(speedKmh, now);
    const filtered = kalman.update(lat, lng, accuracy, now);
    isStationary = checkStationaryFallback(speedKmh, filtered.lat, filtered.lng, now);
    lastPosition = { lat:filtered.lat, lng:filtered.lng, timestamp:now, speedKmh, altitude };
    return { lat:filtered.lat, lng:filtered.lng, altitude, accuracy, speedKmh, isStationary, timestamp:now };
  }

  function getDynamicAccuracyLimit(speedKmh, now) {
    let limit = speedKmh<30?10:speedKmh<60?15:speedKmh<100?25:35;
    const hour=new Date(now).getHours();
    if (hour>=22||hour<5) limit*=1.2;
    return limit;
  }
  function checkTrafficJamFallback(speedKmh, now) {
    if (speedKmh>0&&speedKmh<CONFIG.jam_speed_max_kmh) {
      if (!trafficJamSince) trafficJamSince=now;
      if ((now-trafficJamSince)/1000>=CONFIG.jam_duration_sec) isTrafficJam=true;
    } else if (speedKmh>=CONFIG.jam_speed_max_kmh) { trafficJamSince=null; isTrafficJam=false; }
  }
  function calcBearing(lat1,lng1,lat2,lng2) {
    const φ1=lat1*Math.PI/180,φ2=lat2*Math.PI/180,Δλ=(lng2-lng1)*Math.PI/180;
    return((Math.atan2(Math.sin(Δλ)*Math.cos(φ2),Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ))*180/Math.PI)+360)%360;
  }
  function angleDiff(a,b){let d=Math.abs(a-b)%360;return d>180?360-d:d;}
  function checkStationaryFallback(speedKmh,lat,lng,now){
    if(isStationary&&speedKmh>=CONFIG.resume_speed_kmh){lowSpeedStart=null;return false;}
    if(speedKmh<CONFIG.speed_limit_kmh){
      if(!lowSpeedStart){lowSpeedStart={time:now,lat,lng};return isStationary;}
      const e=(now-lowSpeedStart.time)/1000;
      const m=calcDistance(lowSpeedStart.lat,lowSpeedStart.lng,lat,lng);
      const r=isTrafficJam?CONFIG.stationary_radius_jam_m:CONFIG.stationary_radius_m;
      if(e>=CONFIG.stationary_sec&&m<r)return true;
      return isStationary;
    }
    lowSpeedStart=null;return false;
  }

  // Vincenty（meter.jsから呼ばれる）
  function calcDistance(lat1,lng1,lat2,lng2){
    if(lat1===lat2&&lng1===lng2)return 0;
    const a=6378137,b=6356752.314245,f=1/298.257223563;
    const L=(lng2-lng1)*Math.PI/180;
    const U1=Math.atan((1-f)*Math.tan(lat1*Math.PI/180));
    const U2=Math.atan((1-f)*Math.tan(lat2*Math.PI/180));
    const sinU1=Math.sin(U1),cosU1=Math.cos(U1),sinU2=Math.sin(U2),cosU2=Math.cos(U2);
    let lambda=L,lambdaP,iterLimit=100;
    let sinSigma,cosSigma,sigma,sinAlpha,cosSqAlpha,cos2SigmaM;
    do{
      const sl=Math.sin(lambda),cl=Math.cos(lambda);
      sinSigma=Math.sqrt((cosU2*sl)**2+(cosU1*sinU2-sinU1*cosU2*cl)**2);
      if(sinSigma===0)return 0;
      cosSigma=sinU1*sinU2+cosU1*cosU2*cl;
      sigma=Math.atan2(sinSigma,cosSigma);
      sinAlpha=cosU1*cosU2*sl/sinSigma;
      cosSqAlpha=1-sinAlpha*sinAlpha;
      cos2SigmaM=cosSqAlpha===0?0:cosSigma-2*sinU1*sinU2/cosSqAlpha;
      const C=f/16*cosSqAlpha*(4+f*(4-3*cosSqAlpha));
      lambdaP=lambda;
      lambda=L+(1-C)*f*sinAlpha*(sigma+C*sinSigma*(cos2SigmaM+C*cosSigma*(-1+2*cos2SigmaM**2)));
    }while(Math.abs(lambda-lambdaP)>1e-12&&--iterLimit>0);
    if(iterLimit===0)return haversineDistance(lat1,lng1,lat2,lng2);
    const uSq=cosSqAlpha*(a*a-b*b)/(b*b);
    const A=1+uSq/16384*(4096+uSq*(-768+uSq*(320-175*uSq)));
    const B=uSq/1024*(256+uSq*(-128+uSq*(74-47*uSq)));
    const ds=B*sinSigma*(cos2SigmaM+B/4*(cosSigma*(-1+2*cos2SigmaM**2)-B/6*cos2SigmaM*(-3+4*sinSigma**2)*(-3+4*cos2SigmaM**2)));
    return b*A*(sigma-ds);
  }
  function haversineDistance(lat1,lng1,lat2,lng2){
    const R=6371000,dLat=(lat2-lat1)*Math.PI/180,dLng=(lng2-lng1)*Math.PI/180;
    const aa=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R*2*Math.atan2(Math.sqrt(aa),Math.sqrt(1-aa));
  }
  function calcDistance3D(lat1,lng1,alt1,lat2,lng2,alt2){
    const flat=calcDistance(lat1,lng1,lat2,lng2);
    if(alt1==null||alt2==null)return flat;
    const altDiff=alt2-alt1;
    if(Math.abs(altDiff)>100)return flat;
    return Math.sqrt(flat*flat+altDiff*altDiff);
  }

  function onError(err){console.error('[GPS]',err.code,err.message);}

  return { start, stop, calcDistance, calcDistance3D };
})();
