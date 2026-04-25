const FB = (() => {
  let vehicleId = 'v1';
  let sessionId = null;
  let offlineQueue = [];
  let isOnline = true;

  window.addEventListener('online', () => { isOnline = true; flushQueue(); });
  window.addEventListener('offline', () => { isOnline = false; });

  function setVehicleId(id) { vehicleId = id; }

  function write(path, data) {
    if (isOnline) {
      db.ref(path).update(data).catch(() => offlineQueue.push({ path, data }));
    } else {
      offlineQueue.push({ path, data });
    }
  }

  function flushQueue() {
    const q = [...offlineQueue]; offlineQueue = [];
    q.forEach(item => db.ref(item.path).update(item.data).catch(() => offlineQueue.push(item)));
  }

  function startSession(fareConfigSnapshot) {
    sessionId = 'session_' + Date.now() + '_' + vehicleId;
    db.ref('sessions_log/' + sessionId).set({
      vehicle_id: vehicleId, start_time: Date.now(),
      end_time: null, total_distance_m: 0, total_fare_yen: 0,
      fare_config_snapshot: fareConfigSnapshot, status: 'driving'
    });
    write('vehicles/' + vehicleId, { status: 'driving', sub_visible: false });
  }

  function updateMeter(meterState) {
    write('vehicles/' + vehicleId + '/session', {
      distance_m: Math.round(meterState.distance_m),
      fare_yen: meterState.fare_yen,
      elapsed_sec: meterState.elapsed_sec,
      updated_at: Date.now()
    });
  }

  function sendToSub(meterState) {
    write('vehicles/' + vehicleId, {
      sub_visible: true,
      'session/fare_yen': meterState.fare_yen,
      'session/distance_m': Math.round(meterState.distance_m),
      'session/elapsed_sec': meterState.elapsed_sec,
    });
  }

  function endSession(finalState) {
    if (sessionId) {
      db.ref('sessions_log/' + sessionId).update({
        end_time: Date.now(),
        total_distance_m: Math.round(finalState.distance_m),
        total_fare_yen: finalState.fare_yen,
        status: 'finished'
      });
    }
    write('vehicles/' + vehicleId, {
      status: 'finished',
      sub_visible: true,
      'session/fare_yen': finalState.fare_yen,
      'session/distance_m': Math.round(finalState.distance_m),
      'session/elapsed_sec': finalState.elapsed_sec,
    });
  }

  function setIdle() {
    write('vehicles/' + vehicleId, {
      status: 'idle', sub_visible: false,
      session: { distance_m: 0, fare_yen: 0, elapsed_sec: 0 }
    });
  }

  function loadFareConfig(cb) {
    db.ref('fare_config/default').once('value').then(snap => { if (snap.val()) cb(snap.val()); });
  }

  function saveFareConfig(config) { db.ref('fare_config/default').set(config); }

  function loadTodayStats(cb) {
    const today = new Date().toISOString().split('T')[0];
    db.ref('sessions_log').orderByChild('vehicle_id').equalTo(vehicleId).once('value').then(snap => {
      let totalDist = 0; let count = 0;
      snap.forEach(child => {
        const s = child.val();
        if (s.start_time) {
          const d = new Date(s.start_time).toISOString().split('T')[0];
          if (d === today && s.status === 'finished') {
            totalDist += s.total_distance_m || 0; count++;
          }
        }
      });
      cb({ totalDist, count });
    });
  }

  function watchVehicle(vid, cb) { db.ref('vehicles/' + vid).on('value', snap => cb(snap.val())); }

  return { setVehicleId, startSession, updateMeter, sendToSub, endSession, setIdle, loadFareConfig, saveFareConfig, loadTodayStats, watchVehicle };
})();
