// Firebase読み書き・オフライン対応
const FB = (() => {
  let vehicleId = 'v1';
  let sessionId = null;
  let offlineQueue = [];
  let isOnline = true;
  let _db = null;

  // db取得（遅延初期化）
  function getDb(){
    if(!_db){
      try { _db = firebase.database(); } catch(e){ console.error('DB init error:', e); }
    }
    return _db;
  }

  window.addEventListener('online',  () => { isOnline = true; flushQueue(); });
  window.addEventListener('offline', () => { isOnline = false; });

  function setVehicleId(id){ vehicleId = id; }

  function generateSessionId(){
    sessionId = 'session_' + Date.now() + '_' + vehicleId;
    return sessionId;
  }

  function updateVehicle(data){
    const db = getDb(); if(!db) return;
    if(!vehicleId) return;
    const payload = { ...data, updated_at: Date.now() };
    if(isOnline){
      db.ref('vehicles/' + vehicleId).update(payload).catch(e => {
        console.error('[FB] 書き込みエラー:', e);
        offlineQueue.push(payload);
      });
    } else {
      offlineQueue.push(payload);
    }
  }

  function flushQueue(){
    const db = getDb(); if(!db) return;
    if(offlineQueue.length === 0) return;
    const q = [...offlineQueue];
    offlineQueue = [];
    q.forEach(data => {
      db.ref('vehicles/' + vehicleId).update(data).catch(e => { offlineQueue.push(data); });
    });
  }

  function startSession(fareConfigSnapshot){
    const db = getDb(); if(!db || !vehicleId) return;
    sessionId = generateSessionId();
    db.ref('sessions_log/' + sessionId).set({
      vehicle_id: vehicleId,
      start_time: Date.now(),
      end_time: null,
      trip_distance_m: 0,
      total_fare_yen: 0,
      fare_config_snapshot: fareConfigSnapshot,
      status: 'driving'
    });
    db.ref('vehicles/' + vehicleId).update({ status: 'driving' });
  }

  function endSession(finalState){
    const db = getDb(); if(!db || !vehicleId || !sessionId) return;
    db.ref('sessions_log/' + sessionId).update({
      end_time: Date.now(),
      trip_distance_m: Math.round(finalState.distance_m),
      total_fare_yen: finalState.fare_yen,
      status: 'finished'
    });
    db.ref('vehicles/' + vehicleId).update({
      status: 'finished',
      'session/distance_m': Math.round(finalState.distance_m),
      'session/fare_yen': finalState.fare_yen,
    });
  }

  function setIdle(){
    const db = getDb(); if(!db || !vehicleId) return;
    db.ref('vehicles/' + vehicleId).update({
      status: 'idle',
      session: { distance_m: 0, fare_yen: 0, elapsed_sec: 0 }
    });
  }

  function loadFareConfig(callback){
    const db = getDb(); if(!db){ return; }
    db.ref('fare_config/default').once('value').then(snap => {
      const config = snap.val();
      if(config) callback(config);
    }).catch(e => console.error('[FB] loadFareConfig error:', e));
  }

  function saveFareConfig(config){
    const db = getDb(); if(!db) return;
    db.ref('fare_config/default').set(config);
  }

  function watchVehicle(vid, callback){
    const db = getDb(); if(!db) return;
    db.ref('vehicles/' + vid).on('value', snap => { callback(snap.val()); });
  }

  function watchAllVehicles(callback){
    const db = getDb(); if(!db) return;
    db.ref('vehicles').on('value', snap => { callback(snap.val()); });
  }

  function saveTestLog(log){
    const db = getDb(); if(!db) return;
    db.ref('test_logs/' + log.id).set(log).catch(e => console.error('[FB] testLog保存エラー:', e));
  }

  function loadAllTestLogs(callback){
    const db = getDb(); if(!db) return;
    db.ref('test_logs').once('value').then(snap => {
      const data = snap.val();
      if(!data){ callback([]); return; }
      const logs = Object.values(data).sort((a,b) => a.id - b.id);
      callback(logs);
    }).catch(e => { console.error('[FB] testLog取得エラー:', e); callback([]); });
  }

  return {
    setVehicleId, updateVehicle, startSession, endSession,
    setIdle, loadFareConfig, saveFareConfig, watchVehicle, watchAllVehicles,
    saveTestLog, loadAllTestLogs
  };
})();
