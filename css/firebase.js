// ========================================
// ★ここにFirebaseの設定値を貼り付ける★
// Firebaseコンソール → プロジェクト設定 → マイアプリ → CDN
// ========================================
const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.database();
const firestore = firebase.firestore();

const FirebaseManager = (() => {
  let isConnected = false;
  let offlineQueue = [];

  // 接続状態を監視
  db.ref('.info/connected').on('value', snap => {
    isConnected = snap.val() === true;
    if (isConnected) _flushQueue();
  });

  // 車両のセッションデータを更新（Realtime DB）
  function updateSession(vehicleId, data) {
    const payload = {
      ...data,
      updated_at: firebase.database.ServerValue.TIMESTAMP
    };
    if (!isConnected) {
      // オフライン時はキューに積む
      offlineQueue.push({ type: 'session', vehicleId, data: payload });
      return Promise.resolve();
    }
    return db.ref(`vehicles/${vehicleId}/session`).update(payload)
      .catch(e => console.error('[FB] updateSession:', e));
  }

  // 車両ステータスを更新（idle / driving / finished）
  function updateStatus(vehicleId, status) {
    if (!isConnected) {
      offlineQueue.push({ type: 'status', vehicleId, status });
      return Promise.resolve();
    }
    return db.ref(`vehicles/${vehicleId}/status`).set(status)
      .catch(e => console.error('[FB] updateStatus:', e));
  }

  // 位置情報を更新
  function updateLocation(vehicleId, lat, lng) {
    if (!isConnected) return Promise.resolve();
    return db.ref(`vehicles/${vehicleId}/location`).set({ lat, lng })
      .catch(e => console.error('[FB] updateLocation:', e));
  }

  // 車両データをリッスン（sub.html用）
  function listenVehicle(vehicleId, callback) {
    db.ref(`vehicles/${vehicleId}`).on('value', snap => {
      callback(snap.val());
    });
  }

  // Firestoreから料金設定を取得
  async function getFareConfig() {
    try {
      const doc = await firestore.collection('fare_config').doc('default').get();
      if (doc.exists) return doc.data();
    } catch(e) {
      console.warn('[FB] getFareConfig failed, using local default');
    }
    return null;
  }

  // Firestoreに料金設定を保存（settings.htmlから呼ぶ）
  async function saveFareConfig(config) {
    try {
      await firestore.collection('fare_config').doc('default').set(config);
      return true;
    } catch(e) {
      console.error('[FB] saveFareConfig:', e);
      return false;
    }
  }

  // 走行セッションログをFirestoreに保存
  async function saveSessionLog(vehicleId, meterState, fareConfig) {
    const log = {
      vehicle_id: vehicleId,
      start_time: meterState.start_time,
      end_time: Date.now(),
      total_distance_m: Math.round(meterState.distance_m),
      total_fare_yen: meterState.fare_yen,
      elapsed_sec: meterState.elapsed_sec,
      fare_config_snapshot: { ...fareConfig }, // 料金改定後も当時の料金を再現できる
      filter_log: GPS.getFilterLog(),
    };
    try {
      await firestore.collection('sessions_log').add(log);
    } catch(e) {
      console.error('[FB] saveSessionLog:', e);
    }
  }

  // オフラインキューを送信
  function _flushQueue() {
    while (offlineQueue.length > 0) {
      const item = offlineQueue.shift();
      if (item.type === 'session') updateSession(item.vehicleId, item.data);
      if (item.type === 'status') updateStatus(item.vehicleId, item.status);
    }
  }

  function getConnectionStatus() { return isConnected; }

  return {
    updateSession,
    updateStatus,
    updateLocation,
    listenVehicle,
    getFareConfig,
    saveFareConfig,
    saveSessionLog,
    getConnectionStatus,
  };
})();
