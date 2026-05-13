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

  // ─── GPS 状態管理（BUG-6・2026/05/01追加） ───
  // PERMISSION_DENIED 等で onError が呼ばれた時、状態を公式に保持し
  // meter.js / business.js / navigation.js / UI 等が参照できるようにする
  // 「許可押したのに動かない」現象（onError が console.error だけで放置）対策
  const _status = {
    state: 'unknown',     // unknown / granted / denied / unavailable / timeout
    lastError: null,
    lastErrorAt: null,
    retryCount: 0,
    listeners: [],
  };
  const _MAX_RETRY = 3;
  const _RETRY_INTERVAL_MS = 10000;
  let _retryTimer = null;

  // watchPosition の共通オプション（リトライ時も同じ条件で要求）
  const _WATCH_OPTIONS = { enableHighAccuracy: true, timeout: 3000, maximumAge: 0 };

  function _setStatus(newState, err){
    const changed = (_status.state !== newState);
    _status.state = newState;
    if(err){
      _status.lastError = { code: err.code, message: err.message };
      _status.lastErrorAt = Date.now();
    }
    if(newState === 'granted') _status.retryCount = 0;
    if(changed){
      _status.listeners.forEach(fn => {
        try { fn(getStatus()); } catch(e){ console.error('[GPS] listener error:', e); }
      });
      if(typeof dlog === 'function') dlog('[GPS] status: ' + newState);
    }
  }

  function getStatus(){
    return {
      state: _status.state,
      lastError: _status.lastError ? { ..._status.lastError } : null,
      lastErrorAt: _status.lastErrorAt,
      retryCount: _status.retryCount,
    };
  }

  // 状態変化リスナー登録（外部公開）
  // 使用例：GPS.onStatusChange(s => { if(s.state==='denied') ... });
  function onStatusChange(fn){
    if(typeof fn !== 'function') return;
    _status.listeners.push(fn);
    // 登録直後に現在状態を通知
    try { fn(getStatus()); } catch(e){}
  }

  // 手動再試行（UIの[再試行]ボタンから呼ぶ）
  function retryWatch(){
    if(_retryTimer){ clearTimeout(_retryTimer); _retryTimer = null; }
    if(watchId === null) return false;  // stop()済 → 再試行しない
    if(!navigator.geolocation) return false;
    try {
      navigator.geolocation.clearWatch(watchId);
    } catch(e){}
    try {
      watchId = navigator.geolocation.watchPosition(onPosition, onError, _WATCH_OPTIONS);
      if(typeof dlog === 'function') dlog('[GPS] retry watchPosition (count=' + _status.retryCount + ')');
      return true;
    } catch(e){
      if(typeof dlog === 'function') dlog('[GPS] retry error: ' + e.message);
      return false;
    }
  }

  // コンパス（DeviceOrientation・許可不要）
  let compassHeading = null;

  // G3 (2026-05-09): 地磁気偏差テーブル (簡易・主要都市バウンディングボックス)
  //   iOS の webkitCompassHeading は真北・Android の alpha は磁北
  //   日本の地磁気偏差は -7° 〜 -8° (西偏) で都市別に細部差
  //   端末位置から偏差を引くと真北 heading に統一
  //   Android の alpha (磁北) → 真北補正後 heading で MM heading scoring に渡す
  function _magneticDeclination(lat, lng){
    if(typeof lat !== 'number' || typeof lng !== 'number') return -7.5;
    // 北海道
    if(lat >= 41.0) return -9.5;
    // 東北
    if(lat >= 37.0) return -8.5;
    // 関東・甲信越
    if(lat >= 35.0 && lng >= 138.0) return -7.5;
    // 東海・近畿
    if(lat >= 33.5 && lng >= 135.0) return -7.0;
    // 中国・四国
    if(lat >= 33.0 && lng >= 132.0) return -6.5;
    // 九州・沖縄
    if(lat >= 30.0) return -6.0;
    // 沖縄離島
    return -4.5;
  }
  let _lastKnownLat = null;
  let _lastKnownLng = null;

  // 加速度センサー（DeviceMotion・案A・2026/04/29）
  let accelData = null;       // 直近値: {x,y,z,t}
  let accelBuffer = [];       // GPS更新までのサンプル蓄積（C段階で詳細解析に使う）

  // ジャイロセンサー（DeviceMotion・案A・2026/04/29）
  let gyroData = null;        // 直近値: {alpha,beta,gamma,t}
  let gyroBuffer = [];        // GPS更新までのサンプル蓄積

  // リスナー重複登録防止フラグ（B段階修正・2026/04/30追加）
  // iOS PWAで2回目以降の代行開始時にセンサーが動かなくなる現象の対策
  // 1度登録したリスナーは PWA 起動中ずっと生かす
  let _compassListenerAdded = false;
  let _motionListenerAdded = false;

  // 業務中フラグ（D案・2026/05/06追加）
  // リスナーは PWA 起動中ずっと生かしたまま（iOS PWA 対策・上記）、
  // 業務終了中はリスナー内でデータ蓄積・コンパス更新をスキップする。
  // start() で true、stop() で false。
  let _isBizActive = false;
  function startCompass(){
    if(!window.DeviceOrientationEvent) {
      dlog('[GPS] コンパス非対応');
      return;
    }
    // リスナー重複登録防止（B段階修正・2026/04/30）
    if(_compassListenerAdded){
      dlog('[GPS] コンパスリスナー登録済・スキップ');
      return;
    }

    function addCompassListener(){
      let compassCount = 0;
      window.addEventListener('deviceorientation', function(e){
        // 業務中のみコンパス更新（D案・2026/05/06）
        // リスナーは生かしたまま、業務終了中は値を更新しない
        if(!_isBizActive) return;
        compassCount++;
        if(compassCount === 1){
          dlog('[GPS] DeviceOrientation発火 webkitCompassHeading=' + e.webkitCompassHeading + ' alpha=' + e.alpha);
        }
        if(e.webkitCompassHeading != null){
          // iOS は真北 (no correction needed)
          if(compassHeading === null) dlog('[GPS] コンパス初回取得(iOS 真北): ' + e.webkitCompassHeading.toFixed(0) + '°');
          compassHeading = e.webkitCompassHeading;
        } else if(e.alpha != null){
          // Android は磁北・地磁気偏差で真北補正 (G3 2026-05-09)
          const magHeading = (360 - e.alpha + (e.beta || 0) * 0.1) % 360;
          const decl = _magneticDeclination(_lastKnownLat, _lastKnownLng);
          // 真北 = 磁北 + 偏差 (西偏は負・引くと真北になる→西偏を加算)
          const trueHeading = (magHeading + decl + 360) % 360;
          if(compassHeading === null) dlog('[GPS] コンパス初回取得(Android 磁北→真北補正): ' +
            magHeading.toFixed(0) + '° decl=' + decl.toFixed(1) + '° → ' + trueHeading.toFixed(0) + '°');
          compassHeading = trueHeading;
        }
      }, true);
      _compassListenerAdded = true;  // 登録完了フラグ（B段階修正・2026/04/30）
      setTimeout(()=>{
        if(compassHeading === null) dlog('[GPS] コンパス3秒後もnull');
        else dlog('[GPS] コンパス取得済: ' + compassHeading.toFixed(0) + '°');
      }, 3000);
    }

    // iOS 13+：requestPermissionはonMainBtn()で直接呼び済み
    // _compassGrantedフラグを確認してリスナー追加
    if(typeof DeviceOrientationEvent.requestPermission === 'function'){
      if(window._compassGranted){
        dlog('[GPS] コンパス許可済・リスナー追加');
        addCompassListener();
      } else {
        dlog('[GPS] コンパス未許可・リスナーなし');
      }
    } else {
      // Android・iOS 12以前：許可不要
      addCompassListener();
    }
    dlog('[GPS] コンパス起動完了');
  }

  // 加速度センサー（DeviceMotion・案A・2026/04/29）
  function startMotion(){
    if(!window.DeviceMotionEvent){
      dlog('[GPS] 加速度センサー非対応');
      return;
    }
    // リスナー重複登録防止（B段階修正・2026/04/30）
    if(_motionListenerAdded){
      dlog('[GPS] 加速度・ジャイロリスナー登録済・スキップ');
      return;
    }

    function addMotionListener(){
      let motionCount = 0;
      window.addEventListener('devicemotion', function(e){
        // 業務中のみデータ蓄積（D案・2026/05/06）
        // リスナーは生かしたまま、業務終了中は加速度・ジャイロを蓄積しない
        if(!_isBizActive) return;
        const acc = e.accelerationIncludingGravity;
        const rot = e.rotationRate;
        if(!acc) return;
        motionCount++;

        const t = Date.now();

        // 加速度（A段階・既存）
        const accSample = {
          x: acc.x || 0,
          y: acc.y || 0,
          z: acc.z || 0,
          t: t,
        };
        accelData = accSample;       // 直近値
        accelBuffer.push(accSample); // バッファ蓄積（GPS更新時にWorkerへ）
        if(accelBuffer.length > 200) accelBuffer.shift();

        // ジャイロ（B段階・新規）
        // null安全：rot自体null/プロパティ全てnull/非オブジェクトを完全防御
        if(rot && typeof rot === 'object' &&
           (rot.alpha != null || rot.beta != null || rot.gamma != null)){
          const gyroSample = {
            alpha: rot.alpha || 0,  // ヨー（左右回転・ハンドル操作）
            beta:  rot.beta  || 0,  // ピッチ（前後傾き・坂道）
            gamma: rot.gamma || 0,  // ロール（左右傾き・カーブ）
            t: t,
          };
          gyroData = gyroSample;
          gyroBuffer.push(gyroSample);
          if(gyroBuffer.length > 200) gyroBuffer.shift();
        }

        // 初回ログ（加速度＋ジャイロ状態を一括表示）
        if(motionCount === 1){
          let gyroStatus;
          if(!rot) gyroStatus = 'rot自体null';
          else if(typeof rot !== 'object') gyroStatus = '非object';
          else if(rot.alpha == null && rot.beta == null && rot.gamma == null) gyroStatus = '全プロパティnull';
          else gyroStatus = 'α=' + (rot.alpha || 0).toFixed(2) + ' β=' + (rot.beta || 0).toFixed(2) + ' γ=' + (rot.gamma || 0).toFixed(2);
          dlog('[GPS] DeviceMotion発火 加速度x=' + accSample.x.toFixed(2) + ' ジャイロ=' + gyroStatus);
        }
      }, true);
      _motionListenerAdded = true;  // 登録完了フラグ（B段階修正・2026/04/30）

      setTimeout(()=>{
        if(accelData === null) dlog('[GPS] 加速度3秒後もnull');
        else dlog('[GPS] 加速度取得済 サンプル数=' + accelBuffer.length);
        if(gyroData === null) dlog('[GPS] ジャイロ3秒後もnull');
        else dlog('[GPS] ジャイロ取得済 サンプル数=' + gyroBuffer.length);
      }, 3000);
    }

    // iOS 13+: requestPermissionは index.html の requestSensorPermission() で済み
    // _motionGrantedフラグを確認してリスナー追加
    if(typeof DeviceMotionEvent.requestPermission === 'function'){
      if(window._motionGranted){
        dlog('[GPS] 加速度許可済・リスナー追加');
        addMotionListener();
      } else {
        dlog('[GPS] 加速度未許可・リスナーなし');
      }
    } else {
      // Android・iOS 12以前：許可不要
      addMotionListener();
    }
    dlog('[GPS] 加速度センサー起動完了');
  }

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
          const d = e.data.data;
          if (d._debugCompass) dlog('[GPS]', d._debugCompass);
          // コンパス値がWorkerに届いているか定期確認（10回に1回）
          if (d.compassHeading != null && Math.random() < 0.1){
            dlog('[GPS] compass届いてる:', d.compassHeading.toFixed(0) + '°');
          }
          if (onUpdateCallback) onUpdateCallback(d);
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
    // 業務中フラグON（D案・2026/05/06）
    // 既に登録済みのリスナー内で蓄積を再開させるため、startCompass/startMotion より先に立てる
    _isBizActive = true;
    startCompass(); // コンパス起動（許可不要）
    startMotion();  // 加速度センサー起動（案A・2026/04/29）
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
    // BUG-6（2026/05/01）：リトライ可能なように共通オプション使用
    watchId = navigator.geolocation.watchPosition(onPosition, onError, _WATCH_OPTIONS);
  }

  function stop() {
    // 業務中フラグOFF（D案・2026/05/06）
    // 以降 devicemotion / deviceorientation 発火してもリスナー内で early return する。
    // リスナー登録自体は維持（iOS PWAでremoveすると2回目以降動かないため）。
    _isBizActive = false;
    // リトライタイマーをクリア（stop後のゾンビリトライ防止）
    if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    // 加速度バッファクリア（案A・2026/04/29）
    accelBuffer = [];
    accelData = null;
    // ジャイロバッファクリア（B段階・2026/04/29）
    gyroBuffer = [];
    gyroData = null;
    if (useWorker && worker) {
      worker.postMessage({ type: 'reset', data: {} });
    } else {
      if (kalman) kalman.reset();
      lastPosition = null; lowSpeedStart = null; isStationary = false;
      trafficJamSince = null; isTrafficJam = false;
    }
  }

  function onPosition(pos) {
    // BUG-6（2026/05/01）：GPS 取得成功 → 状態を granted に更新
    if (_status.state !== 'granted') _setStatus('granted', null);
    const now = Date.now();
    const { latitude: lat, longitude: lng, accuracy, speed, heading, altitude } = pos.coords;
    // G3 (2026-05-09): 最新位置を地磁気偏差ルックアップ用に記録
    _lastKnownLat = lat;
    _lastKnownLng = lng;
    const speedKmh = (speed != null && speed >= 0) ? speed * 3.6 : 0;
    // 加速度サンプル取り出し（案A・2026/04/29）
    const accelSamples = accelBuffer.slice();
    accelBuffer = [];
    // ジャイロサンプル取り出し（B段階・2026/04/29）
    const gyroSamples = gyroBuffer.slice();
    gyroBuffer = [];
    if (useWorker) {
      worker.postMessage({ type: 'position',
        data: { lat, lng, accuracy, speedKmh, heading, altitude, now, compassHeading,
                accelData, accelSamples, gyroData, gyroSamples }
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

  // BUG-6（2026/05/01）：onError を拡張
  // 旧：console.error するだけで放置 → 「許可押したのに動かない」現象の原因
  // 新：状態管理・リトライ・リスナー通知の3点セット
  function onError(err){
    console.error('[GPS]', err.code, err.message);
    if(typeof dlog === 'function') dlog('[GPS] error code=' + err.code + ' msg=' + err.message);

    if(err.code === 1){
      // PERMISSION_DENIED：拒否（許可ダイアログでキャンセル or システム拒否）
      _setStatus('denied', err);
      // リトライ（最大3回・10秒間隔）
      // 司さんが iOS 設定で「許可」に変更した場合、自動で復活する
      if(_status.retryCount < _MAX_RETRY && watchId !== null){
        _status.retryCount++;
        if(_retryTimer) clearTimeout(_retryTimer);
        _retryTimer = setTimeout(retryWatch, _RETRY_INTERVAL_MS);
      }
    } else if(err.code === 2){
      // POSITION_UNAVAILABLE：位置情報サービス不利用 or 信号取得不能
      _setStatus('unavailable', err);
      // 信号取得不能は時間で復活する可能性あり → 同じくリトライ
      if(_status.retryCount < _MAX_RETRY && watchId !== null){
        _status.retryCount++;
        if(_retryTimer) clearTimeout(_retryTimer);
        _retryTimer = setTimeout(retryWatch, _RETRY_INTERVAL_MS);
      }
    } else if(err.code === 3){
      // TIMEOUT：タイムアウト（次の position を待てば良い）
      // watchPosition は内部で継続するのでリトライ不要
      // 状態は「timeout」として記録するが granted の方が新しければ反映しない
      if(_status.state !== 'granted') _setStatus('timeout', err);
    }
  }

  // ─── デバッグ関数（B段階・2026/04/30追加） ───
  // Eruda コンソールから GPS._debug() で呼び出して、
  // 各センサーの現在値・バッファ蓄積数・リスナー登録状態を確認できる
  function _debug(){
    return {
      compassHeading: compassHeading,
      accelData: accelData,
      gyroData: gyroData,
      accelBufferLen: accelBuffer.length,
      gyroBufferLen: gyroBuffer.length,
      compassListenerAdded: _compassListenerAdded,
      motionListenerAdded: _motionListenerAdded,
      isBizActive: _isBizActive,
      watchId: watchId,
      useWorker: useWorker,
    };
  }

  // T5 (2026-05-09): map-matcher.js が commit した snap の typeCode を Worker に伝達
  //   meter.js の mmResult ハンドラから呼ばれる
  //   Worker 側で typeCode → Q の動的マッピングを行う
  function setRoadType(typeCode){
    if (useWorker && worker){
      worker.postMessage({ type: 'setRoadType', data: { typeCode: typeCode } });
    }
  }

  return {
    start, stop,
    calcDistance, calcDistance3D,
    _debug,
    // BUG-6（2026/05/01）：GPS 状態管理 API
    onStatusChange, getStatus, retryWatch,
    // 2026/05/02：タスクキル復元時のセンサーリスナー再登録用
    //   業務開始 / 復元時に明示的に呼ぶ
    //   重複防止フラグ（_compassListenerAdded/_motionListenerAdded）で
    //   既に登録済みなら何もしない
    startCompass, startMotion,
    // T5 (2026-05-09): Adaptive Kalman Q (道路種別連動) 用 API
    setRoadType,
  };
})();
