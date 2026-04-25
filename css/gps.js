const GPS = (() => {
  let watchId = null;
  let lastPosition = null;
  let lowSpeedStart = null;
  let isStationary = false;
  let onUpdateCallback = null;

  const CONFIG = {
    accuracy_limit_m: 15,    // Layer1: 精度15m超は破棄
    speed_limit_kmh: 3,      // Layer3: 低速判定閾値
    stationary_sec: 5,       // Layer3: 静止確定までの秒数
    stationary_radius_m: 3,  // Layer3: 静止確定の移動範囲
    jump_limit_m_per_s: 50,  // Layer4: 50m/秒超はジャンプとして破棄
    resume_speed_kmh: 5,     // 発進判定（ヒステリシス）
  };

  let filterLog = {
    l1_accuracy: 0,
    l4_jump: 0,
    stationary_count: 0,
  };

  function start(callback) {
    onUpdateCallback = callback;
    if (!navigator.geolocation) {
      console.error('[GPS] geolocation not supported');
      return;
    }
    watchId = navigator.geolocation.watchPosition(
      onPosition,
      onError,
      { enableHighAccuracy: true, timeout: 3000, maximumAge: 0 }
    );
  }

  function stop() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    lastPosition = null;
    lowSpeedStart = null;
    isStationary = false;
  }

  function onPosition(pos) {
    const now = Date.now();
    const { latitude: lat, longitude: lng, accuracy, speed } = pos.coords;

    // Layer1: GPS精度チェック
    if (accuracy > CONFIG.accuracy_limit_m) {
      filterLog.l1_accuracy++;
      return;
    }

    // Layer2: デバイス報告速度を使用（自前計算禁止）
    const speedKmh = (speed != null ? speed : 0) * 3.6;

    // Layer4: 座標ジャンプチェック
    if (lastPosition) {
      const jump = calcDistance(lastPosition.lat, lastPosition.lng, lat, lng);
      const timeDiff = (now - lastPosition.timestamp) / 1000;
      if (timeDiff > 0 && jump / timeDiff > CONFIG.jump_limit_m_per_s) {
        filterLog.l4_jump++;
        return;
      }
    }

    // Layer3: 静止判定（速度＋時間＋座標の3条件AND）
    isStationary = checkStationary(speedKmh, lat, lng, now);
    if (isStationary) filterLog.stationary_count++;

    const result = {
      lat, lng, accuracy, speedKmh,
      isStationary,
      timestamp: now,
      filterLog: { ...filterLog },
    };

    lastPosition = { lat, lng, timestamp: now };
    if (onUpdateCallback) onUpdateCallback(result);
  }

  function checkStationary(speedKmh, lat, lng, now) {
    // 静止中→発進の判定（ヒステリシス）
    if (isStationary && speedKmh >= CONFIG.resume_speed_kmh) {
      lowSpeedStart = null;
      return false;
    }

    if (speedKmh < CONFIG.speed_limit_kmh) {
      if (!lowSpeedStart) {
        lowSpeedStart = { time: now, lat, lng };
        return isStationary;
      }
      const elapsedSec = (now - lowSpeedStart.time) / 1000;
      const movedM = calcDistance(lowSpeedStart.lat, lowSpeedStart.lng, lat, lng);

      // 3条件AND: 低速 かつ 5秒以上 かつ 半径3m以内
      if (elapsedSec >= CONFIG.stationary_sec && movedM < CONFIG.stationary_radius_m) {
        return true;
      }
      return isStationary;
    }

    lowSpeedStart = null;
    return false;
  }

  function calcDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function onError(err) {
    console.error('[GPS_ERROR]', err.code, err.message);
  }

  function getFilterLog() { return { ...filterLog }; }

  return { start, stop, calcDistance, CONFIG, getFilterLog };
})();
