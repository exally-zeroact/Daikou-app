const GPS = (() => {
  let watchId = null;
  let lastPosition = null;
  let lowSpeedStart = null;
  let isStationary = false;
  let onUpdateCallback = null;

  const CONFIG = {
    accuracy_limit_m: 15,
    speed_limit_kmh: 3,
    stationary_sec: 5,
    stationary_radius_m: 3,
    jump_limit_m_per_s: 50,
    resume_speed_kmh: 5,
  };

  function start(callback) {
    onUpdateCallback = callback;
    if (!navigator.geolocation) { alert('GPSに対応していません'); return; }
    watchId = navigator.geolocation.watchPosition(onPosition, onError,
      { enableHighAccuracy: true, timeout: 1000, maximumAge: 0 });
  }

  function stop() {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    lastPosition = null; lowSpeedStart = null; isStationary = false;
  }

  function onPosition(pos) {
    const now = Date.now();
    const { latitude: lat, longitude: lng, accuracy, speed } = pos.coords;
    if (accuracy > CONFIG.accuracy_limit_m) return;
    const speedKmh = (speed != null && speed >= 0) ? speed * 3.6 : 0;
    if (lastPosition) {
      const jump = calcDistance(lastPosition.lat, lastPosition.lng, lat, lng);
      const timeDiff = (now - lastPosition.timestamp) / 1000;
      if (timeDiff > 0 && jump / timeDiff > CONFIG.jump_limit_m_per_s) return;
    }
    isStationary = checkStationary(speedKmh, lat, lng, now);
    const result = { lat, lng, accuracy, speedKmh, isStationary, timestamp: now };
    lastPosition = { lat, lng, timestamp: now };
    if (onUpdateCallback) onUpdateCallback(result);
  }

  function checkStationary(speedKmh, lat, lng, now) {
    if (isStationary && speedKmh >= CONFIG.resume_speed_kmh) { lowSpeedStart = null; return false; }
    if (speedKmh < CONFIG.speed_limit_kmh) {
      if (!lowSpeedStart) { lowSpeedStart = { time: now, lat, lng }; return isStationary; }
      const elapsedSec = (now - lowSpeedStart.time) / 1000;
      const movedM = calcDistance(lowSpeedStart.lat, lowSpeedStart.lng, lat, lng);
      if (elapsedSec >= CONFIG.stationary_sec && movedM < CONFIG.stationary_radius_m) return true;
      return isStationary;
    }
    lowSpeedStart = null; return false;
  }

  function calcDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  function onError(err) { console.error('[GPS]', err.code, err.message); }

  return { start, stop, calcDistance };
})();
