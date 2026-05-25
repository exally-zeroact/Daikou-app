// Firebase読み書き・オフライン対応
// eslint-disable-next-line no-unused-vars -- 他ファイルから FB をグローバル参照 (cross-file global pattern)
const FB = (() => {
  let vehicleId = 'v1';
  let sessionId = null;
  let offlineQueue = [];
  let isOnline = true;
  let _db = null;

  // db取得（遅延初期化）
  function getDb() {
    if (!_db) {
      try {
        _db = firebase.database();
      } catch (e) {
        console.error('DB init error:', e);
      }
    }
    return _db;
  }

  // ★設計変更宣言 (2026-05-12): Firebase 送信失敗 retry queue 実装 (P0 Step 2)
  //   目的: 業務終了 → 圏外 → 送信失敗 → データ消失 の防止
  //   設計判断: 既存 DakomeDL の 'daikome' DB は DB_VERSION=3 で固定されており
  //             IndexedDB 仕様上、同一 DB を異なる version で並行管理できない
  //             (firebase.js が version=4 で開くと DakomeDL の version=3 open が
  //              VersionError でクラッシュする)。
  //             spec で指定された「DB 'daikome'」を厳守すると既存機能を壊す。
  //             ※ 仕様逸脱として独立 DB 'daikome_retry' を採用。永続性は同等保証。
  //   再試行: exponential backoff (1s, 2s, 4s, 8s, 16s) ・5 回超で諦め
  //   トリガ: window 'online' イベント + ファイル末尾の初回 flush
  const RETRY_DB_NAME = 'daikome_retry';
  const RETRY_DB_VERSION = 1;
  const RETRY_STORE = 'firebase_retry_queue';
  const RETRY_MAX_COUNT = 5;
  const RETRY_BACKOFF_MS = [0, 1000, 2000, 4000, 8000, 16000]; // index = retryCount
  let _retryDb = null;
  let _flushInProgress = false;

  function _openRetryDb() {
    return new Promise((resolve, reject) => {
      if (_retryDb) {
        resolve(_retryDb);
        return;
      }
      try {
        const req = indexedDB.open(RETRY_DB_NAME, RETRY_DB_VERSION);
        req.onupgradeneeded = function () {
          const db = req.result;
          if (!db.objectStoreNames.contains(RETRY_STORE)) {
            db.createObjectStore(RETRY_STORE, { keyPath: 'id', autoIncrement: true });
          }
        };
        req.onsuccess = function () {
          _retryDb = req.result;
          resolve(_retryDb);
        };
        req.onerror = function () {
          reject(req.error);
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  function _enqueueRetry(type, payload) {
    _openRetryDb()
      .then((db) => {
        try {
          const tx = db.transaction(RETRY_STORE, 'readwrite');
          tx.objectStore(RETRY_STORE).add({
            type: type,
            payload: payload,
            retryCount: 0,
            nextRetryAt: Date.now() + RETRY_BACKOFF_MS[1], // 1 秒後から再試行可
          });
        } catch (e) {
          console.error('[FB.retry] enqueue error:', e);
        }
      })
      .catch((e) => console.error('[FB.retry] db open error:', e));
  }

  function _retryGetAll() {
    return _openRetryDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(RETRY_STORE, 'readonly');
          const req = tx.objectStore(RETRY_STORE).getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        })
    );
  }
  function _retryDelete(id) {
    return _openRetryDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(RETRY_STORE, 'readwrite');
          const req = tx.objectStore(RETRY_STORE).delete(id);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        })
    );
  }
  function _retryUpdate(record) {
    return _openRetryDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(RETRY_STORE, 'readwrite');
          const req = tx.objectStore(RETRY_STORE).put(record);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        })
    );
  }

  // 1 件再試行: type に応じて Firebase の対応 ref に書込・成功で resolve・失敗で reject
  function _executeRetry(record) {
    return new Promise((resolve, reject) => {
      const db = getDb();
      if (!db) {
        reject(new Error('db not ready'));
        return;
      }
      try {
        if (record.type === 'startSession') {
          db.ref('sessions_log/' + record.payload.sessionId)
            .set(record.payload.data)
            .then(() => resolve())
            .catch(reject);
        } else if (record.type === 'endSession') {
          db.ref('sessions_log/' + record.payload.sessionId)
            .update(record.payload.data)
            .then(() => resolve())
            .catch(reject);
        } else if (record.type === 'saveFareConfig') {
          db.ref('fare_config/default')
            .set(record.payload)
            .then(() => resolve())
            .catch(reject);
        } else {
          reject(new Error('unknown retry type: ' + record.type));
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  async function _flushRetryQueue() {
    if (_flushInProgress) return;
    _flushInProgress = true;
    try {
      const all = await _retryGetAll();
      const now = Date.now();
      const due = all.filter((r) => (r.nextRetryAt || 0) <= now);
      for (const record of due) {
        try {
          await _executeRetry(record);
          await _retryDelete(record.id); // 成功 → 削除
        } catch (e) {
          record.retryCount = (record.retryCount || 0) + 1;
          if (record.retryCount > RETRY_MAX_COUNT) {
            await _retryDelete(record.id); // 5 回超 → 諦めて削除
          } else {
            record.nextRetryAt = Date.now() + (RETRY_BACKOFF_MS[record.retryCount] || 16000);
            await _retryUpdate(record);
          }
        }
      }
    } catch (e) {
      console.error('[FB.retry] flush error:', e);
    } finally {
      _flushInProgress = false;
    }
  }

  window.addEventListener('online', () => {
    isOnline = true;
    flushQueue();
    _flushRetryQueue();
  });
  window.addEventListener('offline', () => {
    isOnline = false;
  });

  function setVehicleId(id) {
    vehicleId = id;
  }

  function generateSessionId() {
    sessionId = 'session_' + Date.now() + '_' + vehicleId;
    return sessionId;
  }

  function updateVehicle(data) {
    const db = getDb();
    if (!db) return;
    if (!vehicleId) return;
    const payload = { ...data, updated_at: Date.now() };
    if (isOnline) {
      db.ref('vehicles/' + vehicleId)
        .update(payload)
        .catch((e) => {
          console.error('[FB] 書き込みエラー:', e);
          offlineQueue.push(payload);
        });
    } else {
      offlineQueue.push(payload);
    }
  }

  function flushQueue() {
    const db = getDb();
    if (!db) return;
    if (offlineQueue.length === 0) return;
    const q = [...offlineQueue];
    offlineQueue = [];
    q.forEach((data) => {
      db.ref('vehicles/' + vehicleId)
        .update(data)
        .catch((_e) => {
          offlineQueue.push(data);
        });
    });
  }

  function startSession(fareConfigSnapshot) {
    const db = getDb();
    if (!db || !vehicleId) return;
    sessionId = generateSessionId();
    // ★設計変更宣言 (2026-05-12): 送信失敗時 retry queue 登録 (成功パス無変更)
    const sessionData = {
      vehicle_id: vehicleId,
      start_time: Date.now(),
      end_time: null,
      trip_distance_m: 0,
      total_fare_yen: 0,
      fare_config_snapshot: fareConfigSnapshot,
      status: 'driving',
    };
    db.ref('sessions_log/' + sessionId)
      .set(sessionData)
      .catch((e) => {
        console.error('[FB] startSession failed, enqueuing retry:', e && e.message);
        _enqueueRetry('startSession', { sessionId: sessionId, data: sessionData });
      });
    db.ref('vehicles/' + vehicleId).update({ status: 'driving' });
  }

  function endSession(finalState) {
    const db = getDb();
    if (!db || !vehicleId || !sessionId) return;
    // ★設計変更宣言 (2026-05-12): 送信失敗時 retry queue 登録 (成功パス無変更)
    const sessionUpdate = {
      end_time: Date.now(),
      trip_distance_m: Math.round(finalState.distance_m),
      total_fare_yen: finalState.fare_yen,
      status: 'finished',
    };
    const _sid = sessionId; // sessionId は次回 startSession で上書きされる可能性があるので close-over
    db.ref('sessions_log/' + _sid)
      .update(sessionUpdate)
      .catch((e) => {
        console.error('[FB] endSession failed, enqueuing retry:', e && e.message);
        _enqueueRetry('endSession', { sessionId: _sid, data: sessionUpdate });
      });
    db.ref('vehicles/' + vehicleId).update({
      status: 'finished',
      'session/distance_m': Math.round(finalState.distance_m),
      'session/fare_yen': finalState.fare_yen,
    });
  }

  function setIdle() {
    const db = getDb();
    if (!db || !vehicleId) return;
    db.ref('vehicles/' + vehicleId).update({
      status: 'idle',
      session: { distance_m: 0, fare_yen: 0, elapsed_sec: 0 },
    });
  }

  // ★設計変更宣言 (2026-05-10): fareConfig v2 migration
  //   旧形式 (version 不在) を v2 化して callback に渡す
  //   surchargeRate (旧単一倍率) は surcharges[0] として保持
  //   破壊的変更なし・旧キーは維持
  function _migrateFareConfig(cfg) {
    if (!cfg || cfg.version === 2) return cfg;
    const out = Object.assign({}, cfg);
    out.version = 2;
    if (!Array.isArray(out.tiers)) out.tiers = [];
    if (!Array.isArray(out.surcharges)) {
      out.surcharges = [];
      const r = parseFloat(cfg.surchargeRate);
      if (!isNaN(r) && r > 1.0) {
        out.surcharges.push({
          id: 'legacy',
          name: '割増',
          rate: r,
          color: '#FF9500',
          active_default: false,
        });
      }
    }
    if (typeof out.minFare === 'undefined') out.minFare = null;
    if (typeof out.maxFare === 'undefined') out.maxFare = null;
    if (typeof out.rounding !== 'number') out.rounding = 10;
    if (!out.autoSurcharges) {
      out.autoSurcharges = {
        night: { enabled: false, from: 22, to: 5, rate: 1.2 },
        weekend: { enabled: false, rate: 1.1 },
        winter: { enabled: false, from: '12-15', to: '03-15', rate: 1.1 },
      };
    }
    if (!Array.isArray(out.vehicles)) out.vehicles = [];
    if (typeof out.vehiclesEnabled !== 'boolean') out.vehiclesEnabled = false;
    if (!out.wait) out.wait = { enabled: false, freeMins: 5, ratePerMin: 100 };
    return out;
  }

  function loadFareConfig(callback) {
    const db = getDb();
    if (!db) {
      return;
    }
    db.ref('fare_config/default')
      .once('value')
      .then((snap) => {
        const raw = snap.val();
        if (!raw) return;
        const config = _migrateFareConfig(raw);
        callback(config);
        // migration が走った場合は書き戻す (raw === config なら no-op)
        if (raw.version !== 2) {
          try {
            db.ref('fare_config/default').set(config);
          } catch (e) {}
        }
      })
      .catch((e) => console.error('[FB] loadFareConfig error:', e));
  }

  function saveFareConfig(config) {
    const db = getDb();
    if (!db) return;
    // ★設計変更宣言 (2026-05-12): 送信失敗時 retry queue 登録 (成功パス無変更)
    db.ref('fare_config/default')
      .set(config)
      .catch((e) => {
        console.error('[FB] saveFareConfig failed, enqueuing retry:', e && e.message);
        _enqueueRetry('saveFareConfig', config);
      });
  }

  function watchVehicle(vid, callback) {
    const db = getDb();
    if (!db) return;
    db.ref('vehicles/' + vid).on('value', (snap) => {
      callback(snap.val());
    });
  }

  // T8 (2026-05-09): Cross-user Pheromone via Firebase RDB
  //   pref ごとに「全ドライバ走行頻度」を集約・読み出し
  //   path: pheromone/{pref}/{roadIndex} = count (number)
  //   ・ markVisited(pref, roadIndex): セッション中に snap した road を 1 回だけ集約 (重複防止)
  //   ・ pushSessionAggregates(): セッション内で集計したカウントを transaction で +1 加算
  //   ・ subscribeCrossUserPheromone(pref, callback): 全ドライバの走行頻度を購読 → callback で渡す
  //   オフライン / 未接続時は localQueue に積まれ flushQueue で再送
  const _sessionVisited = new Map(); // pref → Set(roadIndex) - 当 session で +1 済の road
  function markVisited(pref, roadIndex) {
    if (!pref || roadIndex == null) return;
    let set = _sessionVisited.get(pref);
    if (!set) {
      set = new Set();
      _sessionVisited.set(pref, set);
    }
    set.add(roadIndex);
  }
  function pushSessionAggregates() {
    const db = getDb();
    if (!db) return;
    if (!isOnline) return; // オフライン時は次回オンラインで flush
    for (const [pref, set] of _sessionVisited) {
      for (const roadIndex of set) {
        // RTDB transaction でアトミック +1
        db.ref('pheromone/' + pref + '/' + roadIndex)
          .transaction((curr) => (curr || 0) + 1)
          .catch((e) => console.error('[FB] pheromone+1 error:', e));
      }
    }
    _sessionVisited.clear();
  }
  function subscribeCrossUserPheromone(pref, callback) {
    const db = getDb();
    if (!db) return null;
    const ref = db.ref('pheromone/' + pref);
    const handler = ref.on('value', (snap) => {
      const obj = snap.val() || {};
      const list = [];
      for (const k in obj) {
        const idx = parseInt(k, 10);
        if (!isNaN(idx)) list.push({ roadIndex: idx, count: obj[k] | 0 });
      }
      callback(list);
    });
    return function unsubscribe() {
      ref.off('value', handler);
    };
  }

  // Phase 3 (2026-05-10): 設定画面「過去データを削除」ボタン用
  //   training-data/{deviceId}/* の全ファイルを Firebase Storage から削除
  //   listAll() で全 ref 取得 → 各 ref delete を Promise.all で並列実行
  function deleteAllTrainingData(deviceId) {
    return new Promise(function (resolve, reject) {
      if (typeof firebase === 'undefined' || !firebase.storage) {
        return reject(new Error('Firebase Storage not initialized'));
      }
      if (!deviceId) {
        return reject(new Error('deviceId required'));
      }
      try {
        const folder = firebase.storage().ref('training-data/' + deviceId);
        folder
          .listAll()
          .then(function (result) {
            const promises = (result.items || []).map(function (item) {
              return item.delete().catch(function () {});
            });
            Promise.all(promises)
              .then(function () {
                resolve({ deleted: promises.length });
              })
              .catch(reject);
          })
          .catch(function (err) {
            // 該当 folder が空 (= 過去送信なし) は成功扱い
            if (err && err.code === 'storage/object-not-found') {
              return resolve({ deleted: 0 });
            }
            reject(err);
          });
      } catch (e) {
        reject(e);
      }
    });
  }

  // Phase 2.B (2026-05-10): training-uploader 用 Cloud Storage upload
  //   path: training-data/{deviceId}/{date}-{firstId}.json[.gz]
  //   blob: gzip 済 (CompressionStream) または raw JSON
  //   失敗時は reject・上位 (training-uploader) で retry queue 管理
  function uploadTrainingBatch(path, blob) {
    return new Promise(function (resolve, reject) {
      if (typeof firebase === 'undefined' || !firebase.storage) {
        return reject(new Error('Firebase Storage not initialized'));
      }
      if (!isOnline) {
        return reject(new Error('offline'));
      }
      try {
        const ref = firebase.storage().ref(path);
        const metadata = { contentType: blob.type || 'application/octet-stream' };
        const task = ref.put(blob, metadata);
        task.on(
          'state_changed',
          null,
          function (err) {
            reject(err);
          },
          function () {
            resolve({ path: path, size: blob.size });
          }
        );
      } catch (e) {
        reject(e);
      }
    });
  }

  // ★設計変更宣言 (2026-05-12): 初回 flush フック
  //   オフライン中にアプリを閉じて再起動した場合の取りこぼし防止
  //   DOMContentLoaded 後に一度実行 (firebase 初期化済を期待)
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => _flushRetryQueue(), 500);
      });
    } else {
      setTimeout(() => _flushRetryQueue(), 500);
    }
  }

  return {
    setVehicleId,
    updateVehicle,
    startSession,
    endSession,
    setIdle,
    loadFareConfig,
    saveFareConfig,
    watchVehicle,
    // T8 (2026-05-09)
    markVisited,
    pushSessionAggregates,
    subscribeCrossUserPheromone,
    // Phase 2.B (2026-05-10)
    uploadTrainingBatch,
    // Phase 3 (2026-05-10)
    deleteAllTrainingData,
    // P0 Step 2 (2026-05-12) - retry queue (debug / 手動 flush 用 export)
    _flushRetryQueue,
  };
})();
