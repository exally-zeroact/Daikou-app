// ===========================================
// gps-worker.js
// GPS計算処理（Web Worker・2026/04/27追加）
// GPS取得はメインスレッド・計算処理のみWorkerで実行
// メインスレッドをブロックしないことでUI描画が安定する
// ===========================================

// デバッグフラグ（メインから初期化メッセージで受け取る）
let debug = false;
function wlog() {
  if (debug) console.log.apply(console, arguments);
}

// ─── CONFIG（メインと同じ値・初期化メッセージで上書き可能） ───
let CONFIG = {
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

// ─── 状態変数（Worker内で保持） ───
let lastPosition = null;
let lowSpeedStart = null;
let isStationary = false;
let trafficJamSince = null;
let isTrafficJam = false;
let kalman = null;

// ─── Kalmanフィルター（案D・2026/04/27） ───
class KalmanGPS {
  constructor() {
    this._lat      = null;
    this._lng      = null;
    this._accuracy = 0;
    this._timestamp = null;
  }
  reset() {
    this._lat = null; this._lng = null;
    this._accuracy = 0; this._timestamp = null;
  }
  update(lat, lng, accuracy, timestamp, qOverride) {
    if (this._lat === null) {
      this._lat = lat; this._lng = lng;
      this._accuracy = accuracy; this._timestamp = timestamp;
      return { lat, lng };
    }
    const dt = (timestamp - this._timestamp) / 1000;
    if (dt <= 0 || dt > 30) {
      this._lat = lat; this._lng = lng;
      this._accuracy = accuracy; this._timestamp = timestamp;
      return { lat, lng };
    }
    const Q = (qOverride != null) ? qOverride : CONFIG.kalman_Q;
    const decayed = Math.sqrt(
      this._accuracy * this._accuracy + Q * Q * dt * dt
    );
    const K = decayed * decayed / (decayed * decayed + accuracy * accuracy);
    this._lat      = this._lat + K * (lat - this._lat);
    this._lng      = this._lng + K * (lng - this._lng);
    this._accuracy = Math.sqrt((1 - K) * decayed * decayed);
    this._timestamp = timestamp;
    if (!isFinite(this._lat) || !isFinite(this._lng)) {
      wlog('[GPS] Kalman異常値 → フォールバック');
      this._lat = lat; this._lng = lng;
      this._accuracy = accuracy;
      return { lat, lng };
    }
    return { lat: this._lat, lng: this._lng };
  }
}

// ─── 動的accuracy閾値 ───
function getDynamicAccuracyLimit(speedKmh, now) {
  let limit;
  if (speedKmh < 30)       limit = 10;
  else if (speedKmh < 60)  limit = 15;
  else if (speedKmh < 100) limit = 25;
  else                     limit = 35;
  const hour = new Date(now).getHours();
  if (hour >= 22 || hour < 5) limit *= 1.2;
  return limit;
}

// ─── 渋滞モード判定 ───
function checkTrafficJam(speedKmh, now) {
  if (speedKmh > 0 && speedKmh < CONFIG.jam_speed_max_kmh) {
    if (!trafficJamSince) trafficJamSince = now;
    const durationSec = (now - trafficJamSince) / 1000;
    if (durationSec >= CONFIG.jam_duration_sec) {
      if (!isTrafficJam) wlog('[GPS] 渋滞モード開始');
      isTrafficJam = true;
      return true;
    }
  } else if (speedKmh >= CONFIG.jam_speed_max_kmh) {
    if (isTrafficJam) wlog('[GPS] 渋滞モード解除');
    trafficJamSince = null;
    isTrafficJam = false;
  }
  return isTrafficJam;
}

// ─── 方位角計算（案U用） ───
function calcBearing(lat1, lng1, lat2, lng2) {
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function angleDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// ─── 静止判定 ───
function checkStationary(speedKmh, lat, lng, now) {
  if (isStationary && speedKmh >= CONFIG.resume_speed_kmh) {
    lowSpeedStart = null; return false;
  }
  if (speedKmh < CONFIG.speed_limit_kmh) {
    if (!lowSpeedStart) { lowSpeedStart = { time: now, lat, lng }; return isStationary; }
    const elapsedSec = (now - lowSpeedStart.time) / 1000;
    const movedM = calcDistance(lowSpeedStart.lat, lowSpeedStart.lng, lat, lng);
    const radius = isTrafficJam ? CONFIG.stationary_radius_jam_m : CONFIG.stationary_radius_m;
    if (elapsedSec >= CONFIG.stationary_sec && movedM < radius) return true;
    return isStationary;
  }
  lowSpeedStart = null; return false;
}

// ─── Vincenty公式（WGS84楕円体） ───
function calcDistance(lat1, lng1, lat2, lng2) {
  if (lat1 === lat2 && lng1 === lng2) return 0;
  const a = 6378137, b = 6356752.314245, f = 1 / 298.257223563;
  const L = (lng2 - lng1) * Math.PI / 180;
  const U1 = Math.atan((1 - f) * Math.tan(lat1 * Math.PI / 180));
  const U2 = Math.atan((1 - f) * Math.tan(lat2 * Math.PI / 180));
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
  let lambda = L, lambdaP, iterLimit = 100;
  let sinSigma, cosSigma, sigma, sinAlpha, cosSqAlpha, cos2SigmaM;
  do {
    const sinLambda = Math.sin(lambda), cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt(
      (cosU2*sinLambda)*(cosU2*sinLambda) +
      (cosU1*sinU2-sinU1*cosU2*cosLambda)*(cosU1*sinU2-sinU1*cosU2*cosLambda)
    );
    if (sinSigma === 0) return 0;
    cosSigma = sinU1*sinU2 + cosU1*cosU2*cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    sinAlpha = cosU1*cosU2*sinLambda/sinSigma;
    cosSqAlpha = 1 - sinAlpha*sinAlpha;
    cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - 2*sinU1*sinU2/cosSqAlpha;
    const C = f/16*cosSqAlpha*(4+f*(4-3*cosSqAlpha));
    lambdaP = lambda;
    lambda = L+(1-C)*f*sinAlpha*(sigma+C*sinSigma*(cos2SigmaM+C*cosSigma*(-1+2*cos2SigmaM*cos2SigmaM)));
  } while (Math.abs(lambda-lambdaP) > 1e-12 && --iterLimit > 0);
  if (iterLimit === 0) return haversineDistance(lat1, lng1, lat2, lng2);
  const uSq = cosSqAlpha*(a*a-b*b)/(b*b);
  const A = 1+uSq/16384*(4096+uSq*(-768+uSq*(320-175*uSq)));
  const B = uSq/1024*(256+uSq*(-128+uSq*(74-47*uSq)));
  const deltaSigma = B*sinSigma*(cos2SigmaM+B/4*(cosSigma*(-1+2*cos2SigmaM*cos2SigmaM)-
    B/6*cos2SigmaM*(-3+4*sinSigma*sinSigma)*(-3+4*cos2SigmaM*cos2SigmaM)));
  return b*A*(sigma-deltaSigma);
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLng = (lng2-lng1)*Math.PI/180;
  const aa = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(aa),Math.sqrt(1-aa));
}

function calcDistance3D(lat1, lng1, alt1, lat2, lng2, alt2) {
  const flat = calcDistance(lat1, lng1, lat2, lng2);
  if (alt1 == null || alt2 == null) return flat;
  const altDiff = alt2 - alt1;
  if (Math.abs(altDiff) > 100) return flat;
  return Math.sqrt(flat*flat + altDiff*altDiff);
}

// ─── メイン処理（GPS座標を受け取って計算） ───
function processPosition(data) {
  const { lat, lng, accuracy, speedKmh, heading, altitude, now, compassHeading } = data;

  // ① 動的accuracy閾値
  const accLimit = getDynamicAccuracyLimit(speedKmh, now);
  if (accuracy > accLimit) return null;

  // ② ジャンプ判定
  if (lastPosition) {
    const jump = calcDistance(lastPosition.lat, lastPosition.lng, lat, lng);
    const timeDiff = (now - lastPosition.timestamp) / 1000;
    if (timeDiff > 0 && jump / timeDiff > CONFIG.jump_limit_m_per_s) return null;
  }

  // ②-2 加速度異常判定（案Z）
  if (lastPosition && lastPosition.speedKmh != null && lastPosition.speedKmh > 1 && speedKmh > 1) {
    const dt = (now - lastPosition.timestamp) / 1000;
    if (dt > 0 && dt < 5) {
      const dvMs = (speedKmh - lastPosition.speedKmh) / 3.6;
      const acceleration = dvMs / dt;
      if (Math.abs(acceleration) > CONFIG.max_acceleration_ms2) {
        wlog('[GPS] 加速度異常: ' + acceleration.toFixed(1) + 'm/s²・スキップ');
        return null;
      }
    }
  }

  // ②-3 進行方向整合性（案U + コンパス融合）
  // GPS headingより精度の高いコンパスheadingを優先使用
  const effectiveHeading = (compassHeading != null) ? compassHeading : heading;
  if (lastPosition && effectiveHeading != null && effectiveHeading >= 0 &&
      speedKmh >= CONFIG.heading_check_min_speed_kmh) {
    const movedDistance = calcDistance(lastPosition.lat, lastPosition.lng, lat, lng);
    if (movedDistance >= CONFIG.heading_check_min_distance_m) {
      const movementBearing = calcBearing(lastPosition.lat, lastPosition.lng, lat, lng);
      const diff = angleDiff(effectiveHeading, movementBearing);
      if (diff > CONFIG.heading_diff_threshold_deg) {
        wlog('[GPS] 方向不整合: ' + diff.toFixed(0) + '°・スキップ' + (compassHeading != null ? '（コンパス）' : '（GPS）'));
        return null;
      }
      // コンパスとGPS移動方向の一致度でKalman_Qを動的調整
      // 一致（diff小）→ Q小さく（より強くフィルター・ノイズ除去）
      // 不一致（diff大）→ Q大きく（GPS座標をより信頼）
      if (compassHeading != null) {
        const matchRatio = 1 - (diff / CONFIG.heading_diff_threshold_deg); // 0〜1
        CONFIG._kalman_Q_override = CONFIG.kalman_Q * (0.5 + 0.5 * (1 - matchRatio));
        wlog('[GPS] コンパス融合: 方向差' + diff.toFixed(0) + '° Q=' + CONFIG._kalman_Q_override.toFixed(1));
      }
    }
  }

  // ③ 渋滞モード
  checkTrafficJam(speedKmh, now);

  // ④ Kalmanフィルター（コンパス融合Q値で更新）
  const filtered = kalman.update(lat, lng, accuracy, now, CONFIG._kalman_Q_override);
  CONFIG._kalman_Q_override = null; // 使い捨て

  // ⑤ 静止判定
  isStationary = checkStationary(speedKmh, filtered.lat, filtered.lng, now);

  lastPosition = { lat: filtered.lat, lng: filtered.lng, timestamp: now, speedKmh, altitude };

  return {
    lat: filtered.lat,
    lng: filtered.lng,
    altitude,
    accuracy,
    speedKmh,
    isStationary,
    timestamp: now
  };
}

// ─── メッセージ受信 ───
self.onmessage = function(e) {
  const { type, data } = e.data;

  if (type === 'init') {
    // 初期化：CONFIGとdebugフラグを受け取る
    if (data.config) CONFIG = Object.assign(CONFIG, data.config);
    if (data.debug !== undefined) debug = data.debug;
    kalman = new KalmanGPS();
    lastPosition = null;
    lowSpeedStart = null;
    isStationary = false;
    trafficJamSince = null;
    isTrafficJam = false;
    wlog('[Worker] 初期化完了');
    return;
  }

  if (type === 'reset') {
    // stop()時にリセット
    if (kalman) kalman.reset();
    lastPosition = null;
    lowSpeedStart = null;
    isStationary = false;
    trafficJamSince = null;
    isTrafficJam = false;
    return;
  }

  if (type === 'position') {
    // GPS座標を受け取って計算
    const result = processPosition(data);
    if (result === null) return; // スキップ
    self.postMessage({ type: 'result', data: result });
  }
};
