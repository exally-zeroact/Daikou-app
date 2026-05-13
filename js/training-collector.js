// ===========================================
// training-collector.js (Phase 2.A・2026-05-10)
//
// 将来の AI 推論統合 (Phase 4・CarSpeedNet 系統 ONNX) のための
// 訓練データ収集 framework。
//
// 収集データ (1 サンプル):
//   accel: 80 sample × 3 軸 (4 秒分・20Hz・Float32Array 240 値)
//   gyro:  80 sample × 3 軸 (任意・取得できない端末は null)
//   gpsSpeed: km/h (= ML 訓練の正解値)
//   timestampRelative: ms (TrainingCollector init からの経過時間・絶対時刻なし)
//   deviceId: localStorage 匿名 UUID (個人特定不可)
//   appVersion: アプリバージョン
//
// 収集条件 (全て満たす場合のみ):
//   ✓ GPS accuracy <= 20m
//   ✓ 速度 > 5 km/h
//   ✓ isStationary = false
//   ✓ 加速度バッファに 80 サンプル蓄積済 (= 4 秒以上 motion 受信)
//   ✓ _enabled = true (default ON・将来 Phase 3 設定 UI で OFF 可能)
//
// 保存先:
//   IndexedDB 'daikome-training' / store 'samples'
//   上限 50,000 サンプル (≒ 100 MB at 2KB/サンプル) で FIFO eviction
//
// プライバシー (絶対遵守):
//   ★ 位置情報 (lat/lng) は一切保存しない
//   ★ 出発地・目的地・住所は一切保存しない
//   ★ 個人特定情報は一切保存しない
//   ★ 時刻は init からの relative (絶対時刻=日時は推定不可)
// ===========================================

const TrainingCollector = (() => {
  const DB_NAME = 'daikome-training';
  const STORE_NAME = 'samples';
  const DB_VERSION = 1;

  // 収集ウィンドウ仕様 (CarSpeedNet 互換)
  const WINDOW_SAMPLES = 80;        // 1 サンプル = 80 個の (x,y,z)
  const TARGET_HZ = 20;              // 20Hz downsample
  const SAMPLE_INTERVAL_MS = 1000 / TARGET_HZ;  // 50ms ごとに 1 sample

  // 収集条件 (絶対遵守)
  const MIN_ACCURACY_M = 20;
  const MIN_SPEED_KMH = 5;

  // FIFO eviction 上限 (≒ 100 MB)
  const SAMPLE_COUNT_LIMIT = 50000;

  // 状態
  let _db = null;
  let _ready = false;
  let _deviceId = null;
  let _initTime = Date.now();

  // Phase 3 (2026-05-10): localStorage から _enabled を初期化
  //   'daikome_training_enabled' 明示値があれば優先
  //   なければ 'daikome_training_consent' 有無で判定 (consent あり = ON / なし = OFF)
  //   未consent (banner pending) は OFF・consent 後に default ON
  function _initEnabledState(){
    try {
      const explicit = localStorage.getItem('daikome_training_enabled');
      if (explicit !== null) return explicit === 'true';
      const consent = localStorage.getItem('daikome_training_consent');
      return consent !== null;   // consent あり = ON / なし = OFF (banner pending)
    } catch(_) {
      return false;
    }
  }
  let _enabled = _initEnabledState();
  let _accelBuffer = [];   // [{x, y, z}] (sliding window・最大 WINDOW_SAMPLES)
  let _gyroBuffer = [];    // [{a, b, g}] (任意・最大 WINDOW_SAMPLES)
  let _lastSampleT = 0;
  let _motionListenerAdded = false;
  let _stats = {
    sampled: 0, saved: 0,
    skipped_disabled: 0, skipped_not_ready: 0,
    skipped_accuracy: 0, skipped_speed: 0,
    skipped_stationary: 0, skipped_no_window: 0,
    evicted: 0, errors: 0,
  };

  // 匿名 deviceId (localStorage 永続)
  function _getDeviceId() {
    if (_deviceId) return _deviceId;
    try {
      let id = localStorage.getItem('daikome_anonymous_id');
      if (!id) {
        id = _generateUuid();
        localStorage.setItem('daikome_anonymous_id', id);
      }
      _deviceId = id;
      return id;
    } catch(e) {
      _deviceId = _generateUuid();
      return _deviceId;
    }
  }

  function _generateUuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // IndexedDB 初期化
  function _openDb() {
    return new Promise(function(resolve, reject) {
      if (typeof indexedDB === 'undefined') {
        return reject(new Error('IndexedDB not supported'));
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function(e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = function(e) { resolve(e.target.result); };
      req.onerror = function() { reject(new Error('IndexedDB open err')); };
    });
  }

  function init() {
    if (_ready) return Promise.resolve(true);
    _initTime = Date.now();
    return _openDb()
      .then(function(db) {
        _db = db;
        _ready = true;
        _addMotionListener();
        if (typeof dlog === 'function') {
          dlog('[TrainingCollector] init OK・enabled=' + _enabled);
        }
        return true;
      })
      .catch(function(err) {
        _stats.errors++;
        if (typeof dlog === 'function') {
          dlog('[TrainingCollector] init err: ' + err.message);
        }
        return false;
      });
  }

  // DeviceMotion subscription (gps.js とは独立の listener)
  //   gps.js が permission を取得済の前提・iOS は permission gate あり
  //   独立 listener なので gps.js のバッファ操作 (clear) と干渉しない
  function _addMotionListener() {
    if (_motionListenerAdded) return;
    if (typeof window === 'undefined' || !window.DeviceMotionEvent) return;
    window.addEventListener('devicemotion', _onMotionEvent, true);
    _motionListenerAdded = true;
  }

  function _onMotionEvent(e) {
    if (!_enabled) return;
    const acc = e.accelerationIncludingGravity;
    const rot = e.rotationRate;
    if (!acc) return;
    const t = Date.now();
    // 20Hz downsample (50ms 経過チェック)
    if (t - _lastSampleT < SAMPLE_INTERVAL_MS) return;
    _lastSampleT = t;
    _accelBuffer.push({ x: acc.x || 0, y: acc.y || 0, z: acc.z || 0 });
    if (_accelBuffer.length > WINDOW_SAMPLES) _accelBuffer.shift();
    if (rot && (rot.alpha != null || rot.beta != null || rot.gamma != null)) {
      _gyroBuffer.push({ a: rot.alpha || 0, b: rot.beta || 0, g: rot.gamma || 0 });
      if (_gyroBuffer.length > WINDOW_SAMPLES) _gyroBuffer.shift();
    }
  }

  // meter.js update() から GPS 更新ごとに呼ばれる
  // 条件を満たせば 1 サンプル保存
  function collectIfEligible(gpsResult) {
    if (!_enabled) { _stats.skipped_disabled++; return; }
    if (!_ready || !_db) { _stats.skipped_not_ready++; return; }
    if (!gpsResult || typeof gpsResult.speedKmh !== 'number') return;
    if (gpsResult.accuracy != null && gpsResult.accuracy > MIN_ACCURACY_M) {
      _stats.skipped_accuracy++;
      return;
    }
    if (gpsResult.speedKmh < MIN_SPEED_KMH) {
      _stats.skipped_speed++;
      return;
    }
    if (gpsResult.isStationary) {
      _stats.skipped_stationary++;
      return;
    }
    if (_accelBuffer.length < WINDOW_SAMPLES) {
      _stats.skipped_no_window++;
      return;
    }
    // accel snapshot (Float32Array 240 値・80 sample × 3 軸)
    const accel = new Float32Array(WINDOW_SAMPLES * 3);
    for (let i = 0; i < WINDOW_SAMPLES; i++) {
      const s = _accelBuffer[i];
      accel[i * 3]     = s.x;
      accel[i * 3 + 1] = s.y;
      accel[i * 3 + 2] = s.z;
    }
    // gyro snapshot (任意・取得できる端末のみ)
    let gyro = null;
    if (_gyroBuffer.length >= WINDOW_SAMPLES) {
      gyro = new Float32Array(WINDOW_SAMPLES * 3);
      for (let i = 0; i < WINDOW_SAMPLES; i++) {
        const s = _gyroBuffer[i];
        gyro[i * 3]     = s.a;
        gyro[i * 3 + 1] = s.b;
        gyro[i * 3 + 2] = s.g;
      }
    }
    const sample = {
      // ★ 位置情報 (lat/lng) は意図的に含めない
      // ★ 個人特定情報は一切含めない
      accel: accel,
      gyro: gyro,
      gpsSpeed: gpsResult.speedKmh,
      timestampRelative: Date.now() - _initTime,
      deviceId: _getDeviceId(),
      appVersion: _getAppVersion(),
    };
    _stats.sampled++;
    _saveSample(sample);
  }

  function _saveSample(sample) {
    if (!_db) return;
    try {
      const tx = _db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.add(sample);
      tx.oncomplete = function() {
        _stats.saved++;
        // 100 件保存ごとに FIFO eviction チェック
        if (_stats.saved % 100 === 0) _evictOld();
      };
      tx.onerror = function() {
        _stats.errors++;
      };
    } catch(e) {
      _stats.errors++;
      if (typeof dlog === 'function') {
        dlog('[TrainingCollector] save err: ' + e.message);
      }
    }
  }

  // FIFO eviction: SAMPLE_COUNT_LIMIT を超えたら古い順に削除
  function _evictOld() {
    if (!_db) return;
    try {
      const tx = _db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const countReq = store.count();
      countReq.onsuccess = function() {
        const total = countReq.result;
        if (total <= SAMPLE_COUNT_LIMIT) return;
        const toDelete = total - SAMPLE_COUNT_LIMIT;
        const cur = store.openCursor();
        let deleted = 0;
        cur.onsuccess = function(e) {
          const c = e.target.result;
          if (!c || deleted >= toDelete) return;
          c.delete();
          deleted++;
          _stats.evicted++;
          c.continue();
        };
      };
    } catch(e) {
      _stats.errors++;
    }
  }

  function _getAppVersion() {
    if (typeof window !== 'undefined' && window.DAIKOME_APP_VERSION) {
      return window.DAIKOME_APP_VERSION;
    }
    return 'unknown';
  }

  // Phase 3 で設定画面トグルから呼ばれる・localStorage に永続化
  function setEnabled(enabled) {
    _enabled = !!enabled;
    try { localStorage.setItem('daikome_training_enabled', String(_enabled)); } catch(_){}
    if (typeof dlog === 'function') {
      dlog('[TrainingCollector] enabled=' + _enabled);
    }
  }

  function getEnabled() { return _enabled; }

  // Phase 3 (2026-05-10): バナー OK / 設定画面トグル後に呼ばれる
  //   localStorage の最新値で _enabled を再初期化
  function refreshEnabledFromStorage() {
    _enabled = _initEnabledState();
    if (typeof dlog === 'function') {
      dlog('[TrainingCollector] refreshed enabled=' + _enabled);
    }
  }

  // 設定画面の「過去データを削除」ボタンから呼ばれる
  function deleteAll() {
    return new Promise(function(resolve) {
      if (!_db) return resolve();
      try {
        const tx = _db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        tx.oncomplete = function() {
          _stats.evicted += _stats.saved;
          if (typeof dlog === 'function') {
            dlog('[TrainingCollector] deleteAll OK');
          }
          resolve();
        };
        tx.onerror = function() { resolve(); };
      } catch(e) {
        resolve();
      }
    });
  }

  function getStats() {
    return Object.assign({}, _stats, {
      ready: _ready,
      enabled: _enabled,
      accelBufferLen: _accelBuffer.length,
      gyroBufferLen: _gyroBuffer.length,
      deviceId: _deviceId,
    });
  }

  // 蓄積件数を取得 (Promise)
  function getCount() {
    return new Promise(function(resolve) {
      if (!_db) return resolve(0);
      try {
        const tx = _db.transaction([STORE_NAME], 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.count();
        req.onsuccess = function() { resolve(req.result || 0); };
        req.onerror = function() { resolve(0); };
      } catch(e) {
        resolve(0);
      }
    });
  }

  // Phase 2.B (2026-05-10): training-uploader 用 batch 読み出し
  //   maxCount 件まで古い順 (id ascending) に読み出す
  //   id を含めて返す (deleteUpToId で再利用)
  function readBatch(maxCount) {
    return new Promise(function(resolve) {
      if (!_db) return resolve([]);
      try {
        const tx = _db.transaction([STORE_NAME], 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const samples = [];
        const cur = store.openCursor();
        cur.onsuccess = function(e) {
          const c = e.target.result;
          if (!c || samples.length >= maxCount) {
            resolve(samples);
            return;
          }
          samples.push(c.value);
          c.continue();
        };
        cur.onerror = function() { resolve(samples); };
      } catch(e) {
        resolve([]);
      }
    });
  }

  // Phase 2.B (2026-05-10): 送信完了後の削除
  //   id <= maxId のレコードを全削除
  function deleteUpToId(maxId) {
    return new Promise(function(resolve) {
      if (!_db) return resolve(0);
      try {
        const tx = _db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const range = IDBKeyRange.upperBound(maxId);
        const cur = store.openCursor(range);
        let deleted = 0;
        cur.onsuccess = function(e) {
          const c = e.target.result;
          if (!c) return;
          c.delete();
          deleted++;
          c.continue();
        };
        tx.oncomplete = function() { resolve(deleted); };
        tx.onerror = function() { resolve(deleted); };
      } catch(e) {
        resolve(0);
      }
    });
  }

  return {
    init, collectIfEligible, setEnabled, getEnabled, deleteAll,
    getStats, getCount,
    // Phase 2.B 用
    readBatch, deleteUpToId,
    // Phase 3 用
    refreshEnabledFromStorage,
  };
})();

// 自動初期化 (script load 時)
//   IndexedDB open は async なので _ready=false のまま collect 呼び出しは silently skip
//   ロード時の副作用を最小化するため try-catch で完全防御
if (typeof window !== 'undefined') {
  try { TrainingCollector.init(); } catch(_) {}
}
