const GPS = (() => {
  let watchId = null;
  let lastPosition = null;
  let lowSpeedStart = null;
  let isStationary = false;
  let onUpdateCallback = null;

  // Kalmanフィルターインスタンス（案D・2026/04/27追加）
  let kalman = null;

  // OSRM削除済（2026/04/26）：traceBuffer 不要

  // 渋滞モード判定用
  let trafficJamSince = null;
  let isTrafficJam = false;

  const CONFIG = {
    // 静止判定
    speed_limit_kmh: 3,
    stationary_sec: 5,
    stationary_radius_m: 3,
    stationary_radius_jam_m: 1,   // 渋滞時の半径（厳しく）
    resume_speed_kmh: 5,

    // ジャンプ判定（180km/h相当）
    jump_limit_m_per_s: 50,

    // 案Z：加速度異常判定（2026/04/26追加）
    // 普通の車の急加速・急ブレーキの限界 ≈ 8m/s²（=29km/h増減/秒）
    // それを超える瞬間変化はGPSノイズと判定して除外
    max_acceleration_ms2: 8,

    // 案U：進行方向整合性チェック（2026/04/26追加）
    // GPSのheading（進行方向）と実際の座標移動方向の差を判定
    // 90度以上ずれていたらノイズと判定
    heading_diff_threshold_deg: 90,
    heading_check_min_distance_m: 5,  // 5m以上動いた時だけ判定（ブレ除外）
    heading_check_min_speed_kmh: 5,   // 5km/h以下は判定しない（停車時のノイズ）

    // 案D：Kalmanフィルター（2026/04/27追加）
    // Q = 車が1秒あたり動く不確実性（m）。市街地代行 ≈ 3m/sが適切
    // テスト後に誤差が大きければ増やす・小さければ減らす
    kalman_Q: 3,

    // 渋滞モード
    jam_speed_max_kmh: 10,        // 0〜10km/hで
    jam_duration_sec: 60,         // 1分以上継続したら渋滞
  };

  function start(callback) {
    onUpdateCallback = callback;
    kalman = new KalmanGPS();
    trafficJamSince = null;
    isTrafficJam = false;
    if (!navigator.geolocation) { alert('GPSに対応していません'); return; }
    // 案G：timeout 3000ms（取得成功率向上・2026/04/27追加）
    watchId = navigator.geolocation.watchPosition(onPosition, onError,
      { enableHighAccuracy: true, timeout: 3000, maximumAge: 0 });
  }

  function stop() {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    lastPosition = null; lowSpeedStart = null; isStationary = false;
    if (kalman) kalman.reset();
    trafficJamSince = null;
    isTrafficJam = false;
  }

  // OSRM用 getTrace/clearTrace は削除（2026/04/26）

  // 動的accuracy閾値（速度・時間帯で可変）
  function getDynamicAccuracyLimit(speedKmh, now) {
    let limit;
    if (speedKmh < 30)       limit = 10;  // 低速・市街地：厳しい
    else if (speedKmh < 60)  limit = 15;  // 中速：標準
    else if (speedKmh < 100) limit = 25;  // 高速：緩め
    else                     limit = 35;  // 超高速：さらに緩め

    // 深夜（22時〜5時）は1.2倍に緩める
    const hour = new Date(now).getHours();
    if (hour >= 22 || hour < 5) limit *= 1.2;

    return limit;
  }

  // 渋滞モード判定
  function checkTrafficJam(speedKmh, now) {
    if (speedKmh > 0 && speedKmh < CONFIG.jam_speed_max_kmh) {
      if (!trafficJamSince) trafficJamSince = now;
      const durationSec = (now - trafficJamSince) / 1000;
      if (durationSec >= CONFIG.jam_duration_sec) {
        if (!isTrafficJam) dlog('[GPS] 渋滞モード開始');
        isTrafficJam = true;
        return true;
      }
    } else if (speedKmh >= CONFIG.jam_speed_max_kmh) {
      if (isTrafficJam) dlog('[GPS] 渋滞モード解除');
      trafficJamSince = null;
      isTrafficJam = false;
    }
    return isTrafficJam;
  }

  // ─── 案D：Kalmanフィルター（2026/04/27追加）───
  // accuracy-weighted 方式
  // 仕組み：前回精度が悪いほど新しいGPS値を信頼する
  //         前回精度が良いほど予測値を信頼する
  // ローパスフィルターより優れる点：
  //   ①時間経過を考慮（速く動くほど不確実性が増える）
  //   ②GPSのaccuracyを動的に活用
  //   ③過去5点の平均ではなく最適推定
  class KalmanGPS {
    constructor() {
      this._lat      = null;
      this._lng      = null;
      this._accuracy = 0;
      this._timestamp = null;
    }

    reset() {
      this._lat      = null;
      this._lng      = null;
      this._accuracy = 0;
      this._timestamp = null;
    }

    update(lat, lng, accuracy, timestamp) {
      // 初回 → そのまま採用
      if (this._lat === null) {
        this._lat      = lat;
        this._lng      = lng;
        this._accuracy = accuracy;
        this._timestamp = timestamp;
        return { lat, lng };
      }

      const dt = (timestamp - this._timestamp) / 1000;

      // 時間差が異常（0以下 or 30秒超）→ 再初期化
      if (dt <= 0 || dt > 30) {
        this._lat = lat; this._lng = lng;
        this._accuracy = accuracy;
        this._timestamp = timestamp;
        return { lat, lng };
      }

      // 時間経過で精度を劣化（車が動くほど不確実性増加）
      const Q = CONFIG.kalman_Q;
      const decayed = Math.sqrt(
        this._accuracy * this._accuracy + Q * Q * dt * dt
      );

      // カルマンゲイン（0〜1）
      // 前回精度が悪い(decayed大) → K大 → 新しい測定値を信頼
      // 前回精度が良い(decayed小) → K小 → 前回推定値を信頼
      const K = decayed * decayed / (decayed * decayed + accuracy * accuracy);

      // 状態更新
      this._lat      = this._lat + K * (lat - this._lat);
      this._lng      = this._lng + K * (lng - this._lng);
      this._accuracy = Math.sqrt((1 - K) * decayed * decayed);
      this._timestamp = timestamp;

      // 安全弁：NaN/Inf が出たら生GPS座標にフォールバック
      if (!isFinite(this._lat) || !isFinite(this._lng)) {
        dlog('[GPS] Kalman異常値 → フォールバック');
        this._lat = lat; this._lng = lng;
        this._accuracy = accuracy;
        return { lat, lng };
      }

      return { lat: this._lat, lng: this._lng };
    }
  }

  // 2点間の方位角を計算（北=0度・時計回り）
  // 案U（進行方向整合性チェック）用
  function calcBearing(lat1, lng1, lat2, lng2) {
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const θ = Math.atan2(y, x);
    return ((θ * 180 / Math.PI) + 360) % 360;
  }

  // 2つの方位角の差（最短角度・0-180度）
  function angleDiff(a, b) {
    let d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function onPosition(pos) {
    const now = Date.now();
    const { latitude: lat, longitude: lng, accuracy, speed, heading, altitude } = pos.coords;
    const speedKmh = (speed != null && speed >= 0) ? speed * 3.6 : 0;

    // ① 動的accuracy閾値で精度チェック
    const accLimit = getDynamicAccuracyLimit(speedKmh, now);
    if (accuracy > accLimit) return;

    // ② ジャンプ判定（生座標で判定）
    if (lastPosition) {
      const jump = calcDistance(lastPosition.lat, lastPosition.lng, lat, lng);
      const timeDiff = (now - lastPosition.timestamp) / 1000;
      if (timeDiff > 0 && jump / timeDiff > CONFIG.jump_limit_m_per_s) return;
    }

    // ②-2 加速度異常判定（案Z・2026/04/26追加）
    // 1秒で40km/h以上の急変はGPSノイズと判定して除外
    // 但し、停止中(0km/h)からの発進は除外しない
    if (lastPosition && lastPosition.speedKmh != null && lastPosition.speedKmh > 1 && speedKmh > 1) {
      const dt = (now - lastPosition.timestamp) / 1000;
      if (dt > 0 && dt < 5) {
        const dvMs = (speedKmh - lastPosition.speedKmh) / 3.6;
        const acceleration = dvMs / dt;
        if (Math.abs(acceleration) > CONFIG.max_acceleration_ms2) {
          dlog('[GPS] 加速度異常: ' + acceleration.toFixed(1) + 'm/s² (' +
            lastPosition.speedKmh.toFixed(0) + '→' + speedKmh.toFixed(0) + 'km/h)・スキップ');
          return;
        }
      }
    }

    // ②-3 進行方向整合性チェック（案U・2026/04/26追加）
    // GPSのheading と 実際の座標移動方向 の差が大きい場合はノイズと判定
    if (lastPosition && heading != null && heading >= 0 &&
        speedKmh >= CONFIG.heading_check_min_speed_kmh) {
      const movedDistance = calcDistance(lastPosition.lat, lastPosition.lng, lat, lng);
      if (movedDistance >= CONFIG.heading_check_min_distance_m) {
        const movementBearing = calcBearing(lastPosition.lat, lastPosition.lng, lat, lng);
        const diff = angleDiff(heading, movementBearing);
        if (diff > CONFIG.heading_diff_threshold_deg) {
          dlog('[GPS] 方向不整合: heading=' + heading.toFixed(0) + '° vs 移動=' +
            movementBearing.toFixed(0) + '° (差=' + diff.toFixed(0) + '°)・スキップ');
          return;
        }
      }
    }

    // ③ 渋滞モード判定
    checkTrafficJam(speedKmh, now);

    // ④ Kalmanフィルター適用（案D・2026/04/27追加）
    const filtered = kalman.update(lat, lng, accuracy, now);

    // ⑤ 静止判定（補正後座標・渋滞時は厳しく）
    isStationary = checkStationary(speedKmh, filtered.lat, filtered.lng, now);

    // ⑥ OSRMトレース追加処理は削除（2026/04/26）

    const result = {
      lat: filtered.lat,
      lng: filtered.lng,
      altitude,                          // 案AA：高度を結果に含める（2026/04/26）
      accuracy, speedKmh, isStationary,
      timestamp: now
    };
    lastPosition = { lat: filtered.lat, lng: filtered.lng, timestamp: now, speedKmh, altitude };
    if (onUpdateCallback) onUpdateCallback(result);
  }

  function checkStationary(speedKmh, lat, lng, now) {
    if (isStationary && speedKmh >= CONFIG.resume_speed_kmh) { lowSpeedStart = null; return false; }
    if (speedKmh < CONFIG.speed_limit_kmh) {
      if (!lowSpeedStart) { lowSpeedStart = { time: now, lat, lng }; return isStationary; }
      const elapsedSec = (now - lowSpeedStart.time) / 1000;
      const movedM = calcDistance(lowSpeedStart.lat, lowSpeedStart.lng, lat, lng);
      // 渋滞中は静止判定半径を厳しく（3m → 1m）
      const radius = isTrafficJam ? CONFIG.stationary_radius_jam_m : CONFIG.stationary_radius_m;
      if (elapsedSec >= CONFIG.stationary_sec && movedM < radius) return true;
      return isStationary;
    }
    lowSpeedStart = null; return false;
  }

  // Vincenty公式（WGS84楕円体・高精度3D距離計算）
  // 失敗時はHaversineにフォールバック
  function calcDistance(lat1, lng1, lat2, lng2) {
    // 同一点チェック
    if (lat1 === lat2 && lng1 === lng2) return 0;

    const a = 6378137;              // WGS84長半径
    const b = 6356752.314245;       // WGS84短半径
    const f = 1 / 298.257223563;    // WGS84扁平率

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
        (cosU2 * sinLambda) * (cosU2 * sinLambda) +
        (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) * (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda)
      );
      if (sinSigma === 0) return 0;
      cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
      sigma = Math.atan2(sinSigma, cosSigma);
      sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma;
      cosSqAlpha = 1 - sinAlpha * sinAlpha;
      cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha;
      const C = f / 16 * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
      lambdaP = lambda;
      lambda = L + (1 - C) * f * sinAlpha *
        (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    } while (Math.abs(lambda - lambdaP) > 1e-12 && --iterLimit > 0);

    if (iterLimit === 0) {
      // 収束しなかった→Haversineにフォールバック
      return haversineDistance(lat1, lng1, lat2, lng2);
    }

    const uSq = cosSqAlpha * (a * a - b * b) / (b * b);
    const A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
    const B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
    const deltaSigma = B * sinSigma * (cos2SigmaM + B / 4 * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
      B / 6 * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));

    return b * A * (sigma - deltaSigma);
  }

  // フォールバック用Haversine
  function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const aa = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1-aa));
  }

  // 案AA：3D距離計算（高度差を加味・2026/04/26追加）
  // 平面距離 + 高度差 をピタゴラスで合算
  // 高度がnullなら平面距離をそのまま返す（既存と同じ動作）
  function calcDistance3D(lat1, lng1, alt1, lat2, lng2, alt2) {
    const flat = calcDistance(lat1, lng1, lat2, lng2);
    if (alt1 == null || alt2 == null) return flat;
    const altDiff = alt2 - alt1;
    // 高度差が異常値（100m超）の場合はGPSノイズと判定し平面距離のみ採用
    if (Math.abs(altDiff) > 100) return flat;
    return Math.sqrt(flat * flat + altDiff * altDiff);
  }

  function onError(err) { console.error('[GPS]', err.code, err.message); }

  return { start, stop, calcDistance, calcDistance3D };
})();
