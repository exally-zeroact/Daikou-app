// ===========================================
// training-uploader.js (Phase 2.B・2026-05-10)
//
// IndexedDB に蓄積された訓練データを Firebase Cloud Storage へ
// バックグラウンド送信する framework。
//
// 送信条件 (全て満たす場合のみ):
//   ✓ navigator.onLine = true
//   ✓ navigator.connection.type = 'wifi' / 'ethernet'
//      (= API 未対応端末は graceful degrade で許可)
//   ✓ navigator.getBattery().charging = true
//      (= API 未対応端末は graceful degrade で許可)
//   ✓ IndexedDB に UPLOAD_MIN_SAMPLES (500・≒3-4 trip 相当) 以上蓄積
//   ✓ 前回送信から UPLOAD_MIN_INTERVAL_MS (1 日) 以上経過
//   ✓ TrainingUploader._enabled = true (Phase 3 で OFF 切替可)
//
// 送信先:
//   Firebase Cloud Storage:
//   training-data/{deviceId}/{date}-{firstSampleId}.json[.gz]
//
// 送信タイミング (event piggyback):
//   ・ window.online event (LINE 接続復帰等)
//   ・ document.visibilitychange (visible 復帰)
//   ・ 30 分ごと periodic timer
//   ・ Service Worker Background Sync (Android Chrome 限定・iOS は対応 event で代替)
//
// 失敗時:
//   IndexedDB の蓄積は維持・次の eligible event で retry
//   _runningGuard で同時実行を 1 回に制限
//
// プライバシー (絶対遵守):
//   ★ 送信 payload に lat/lng は schema-level に含めない
//      (training-collector が IndexedDB に lat/lng を保存していないため
//       そもそも upload 経路に lat/lng が入り込む余地がない)
//   ★ 各 sample の deviceId / appVersion はそのまま転送
//   ★ 集約レベルでは deviceId のみ・絶対時刻は含めない
// ===========================================

const TrainingUploader = (() => {
  const PATH_PREFIX = 'training-data';
  const UPLOAD_MIN_SAMPLES = 500;             // ≒ 3-4 trip 相当
  const UPLOAD_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;   // 1 day
  const UPLOAD_BATCH_SIZE = 1000;              // 1 回の upload 最大 sample 数
  const UPLOAD_PERIODIC_MS = 30 * 60 * 1000;   // 30 分 periodic
  const LAST_UPLOAD_KEY = 'daikome_training_last_upload';

  // Phase 3 (2026-05-10): localStorage から _enabled を初期化
  //   training-collector と同じロジック (consent 有無で初期判定)
  function _initEnabledState(){
    try {
      const explicit = localStorage.getItem('daikome_training_enabled');
      if (explicit !== null) return explicit === 'true';
      const consent = localStorage.getItem('daikome_training_consent');
      return consent !== null;
    } catch(_) {
      return false;
    }
  }
  let _enabled = _initEnabledState();
  let _runningGuard = false;
  let _periodicTimer = null;
  let _initDone = false;

  let _stats = {
    triggered: 0, uploaded: 0,
    skipped_disabled: 0, skipped_running: 0,
    skipped_offline: 0, skipped_not_wifi: 0, skipped_not_charging: 0,
    skipped_too_soon: 0, skipped_insufficient: 0, skipped_no_collector: 0,
    errors: 0, samples_uploaded: 0, samples_deleted: 0,
  };

  function init() {
    if (_initDone) return;
    _initDone = true;

    // Event-based trigger
    if (typeof window !== 'undefined') {
      window.addEventListener('online', function() {
        _maybeUpload('online_event');
      });
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', function() {
        if (!document.hidden) _maybeUpload('visibility_visible');
      });
    }

    // Periodic timer (30 分ごと)
    if (_periodicTimer) clearInterval(_periodicTimer);
    _periodicTimer = setInterval(function() {
      _maybeUpload('periodic');
    }, UPLOAD_PERIODIC_MS);

    // Initial check after 30s (起動直後の負荷を避けるため少し遅延)
    setTimeout(function() {
      _maybeUpload('init_delayed');
    }, 30000);

    // Service Worker Background Sync (Android Chrome 限定)
    _registerBackgroundSync();

    // Service Worker からの message を listen (sync event 起動時)
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', function(e) {
        if (e.data && e.data.type === 'TRAINING_UPLOAD_TRIGGER') {
          _maybeUpload('sw_sync');
        }
      });
    }

    if (typeof dlog === 'function') {
      dlog('[TrainingUploader] init OK');
    }
  }

  function _registerBackgroundSync() {
    if (typeof navigator === 'undefined') return;
    if (!navigator.serviceWorker) return;
    if (typeof window === 'undefined' || !('SyncManager' in window)) return;
    navigator.serviceWorker.ready.then(function(reg) {
      try {
        if (reg.sync && reg.sync.register) {
          reg.sync.register('training-upload').catch(function() {});
        }
      } catch(_) {}
    }).catch(function() {});
  }

  // 送信条件チェック (all-or-nothing)
  function _checkConditions() {
    if (!_enabled) { _stats.skipped_disabled++; return { ok: false, reason: 'disabled' }; }
    if (_runningGuard) { _stats.skipped_running++; return { ok: false, reason: 'running' }; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      _stats.skipped_offline++; return { ok: false, reason: 'offline' };
    }
    // WiFi check (best-effort・API 未対応は許可)
    if (typeof navigator !== 'undefined' && navigator.connection && navigator.connection.type) {
      const t = navigator.connection.type;
      if (t !== 'wifi' && t !== 'ethernet' && t !== 'unknown') {
        _stats.skipped_not_wifi++;
        return { ok: false, reason: 'not_wifi' };
      }
    }
    // Time gate (1 day since last upload)
    let last = 0;
    try {
      last = parseInt(localStorage.getItem(LAST_UPLOAD_KEY) || '0', 10) || 0;
    } catch(_) {}
    if (Date.now() - last < UPLOAD_MIN_INTERVAL_MS) {
      _stats.skipped_too_soon++;
      return { ok: false, reason: 'too_soon' };
    }
    // Sample count check
    if (typeof TrainingCollector === 'undefined') {
      _stats.skipped_no_collector++;
      return { ok: false, reason: 'no_collector' };
    }
    return { ok: true };
  }

  // Battery check は async・上記 sync チェック後に実行
  function _checkBatteryAsync() {
    if (typeof navigator === 'undefined' || !navigator.getBattery) {
      // API 未対応 → 許可 (graceful degrade)
      return Promise.resolve(true);
    }
    return navigator.getBattery().then(function(battery) {
      if (battery && battery.charging === false) {
        _stats.skipped_not_charging++;
        return false;
      }
      return true;
    }).catch(function() {
      return true;   // 取得失敗は許可
    });
  }

  function _maybeUpload(triggerSource) {
    _stats.triggered++;
    const cond = _checkConditions();
    if (!cond.ok) return;
    _checkBatteryAsync().then(function(charging) {
      if (!charging) return;
      // Sample count
      TrainingCollector.getCount().then(function(count) {
        if (count < UPLOAD_MIN_SAMPLES) {
          _stats.skipped_insufficient++;
          return;
        }
        if (_runningGuard) return;
        _runningGuard = true;
        _runUpload(triggerSource).then(function() {
          _runningGuard = false;
        }).catch(function(err) {
          _stats.errors++;
          _runningGuard = false;
          if (typeof dlog === 'function') {
            dlog('[TrainingUploader] upload err: ' + (err && err.message));
          }
        });
      });
    });
  }

  function _runUpload(triggerSource) {
    return TrainingCollector.readBatch(UPLOAD_BATCH_SIZE).then(function(samples) {
      if (!samples || samples.length === 0) return;
      const firstId = samples[0].id;
      const lastId = samples[samples.length - 1].id;
      // 全 sample の deviceId は同じはず・appVersion も大半同じ
      const deviceId = samples[0].deviceId || 'unknown';
      const appVersion = samples[0].appVersion || 'unknown';
      // Build payload (★ lat/lng は明示的に含めない)
      const payload = {
        deviceId: deviceId,
        appVersion: appVersion,
        uploadedAt: Date.now(),
        sampleCount: samples.length,
        samples: samples.map(function(s) {
          // accel/gyro は Float32Array → 通常 Array (JSON 互換)
          return {
            accel: Array.from(s.accel),
            gyro: s.gyro ? Array.from(s.gyro) : null,
            gpsSpeed: s.gpsSpeed,
            timestampRelative: s.timestampRelative,
            // ★ lat/lng は無し・deviceId/appVersion は payload top に集約済
          };
        }),
      };
      const json = JSON.stringify(payload);
      const dateStr = new Date().toISOString().slice(0, 10);
      const basePath = PATH_PREFIX + '/' + deviceId + '/' + dateStr + '-' + firstId;

      // Compress (CompressionStream・best-effort)
      return _maybeGzip(json).then(function(result) {
        const blob = result.blob;
        const path = basePath + (result.compressed ? '.json.gz' : '.json');
        if (typeof FB === 'undefined' || !FB.uploadTrainingBatch) {
          throw new Error('FB.uploadTrainingBatch not available');
        }
        return FB.uploadTrainingBatch(path, blob).then(function(meta) {
          // 送信成功 → IndexedDB から削除
          return TrainingCollector.deleteUpToId(lastId).then(function(deleted) {
            try { localStorage.setItem(LAST_UPLOAD_KEY, String(Date.now())); } catch(_) {}
            _stats.uploaded++;
            _stats.samples_uploaded += samples.length;
            _stats.samples_deleted += deleted;
            if (typeof dlog === 'function') {
              dlog('[TrainingUploader] upload OK ' + path + ' (' + samples.length + ' samples・' + (meta && meta.size) + 'B・trigger=' + triggerSource + ')');
            }
          });
        });
      });
    });
  }

  function _maybeGzip(text) {
    if (typeof CompressionStream === 'undefined') {
      return Promise.resolve({
        blob: new Blob([text], { type: 'application/json' }),
        compressed: false,
      });
    }
    try {
      const stream = new Blob([text]).stream();
      const compressed = stream.pipeThrough(new CompressionStream('gzip'));
      return new Response(compressed).blob().then(function(blob) {
        return { blob: blob, compressed: true };
      }).catch(function() {
        return { blob: new Blob([text], { type: 'application/json' }), compressed: false };
      });
    } catch(_) {
      return Promise.resolve({
        blob: new Blob([text], { type: 'application/json' }),
        compressed: false,
      });
    }
  }

  // Phase 3 設定 UI 用・localStorage に永続化
  function setEnabled(enabled) {
    _enabled = !!enabled;
    try { localStorage.setItem('daikome_training_enabled', String(_enabled)); } catch(_){}
    if (typeof dlog === 'function') {
      dlog('[TrainingUploader] enabled=' + _enabled);
    }
  }
  function getEnabled() { return _enabled; }

  function refreshEnabledFromStorage() {
    _enabled = _initEnabledState();
    if (typeof dlog === 'function') {
      dlog('[TrainingUploader] refreshed enabled=' + _enabled);
    }
  }

  // 手動トリガ (debug 用・Phase 3 設定 UI からも呼べる)
  function tryUploadNow() {
    _maybeUpload('manual');
  }

  function getStats() {
    return Object.assign({}, _stats, {
      enabled: _enabled,
      running: _runningGuard,
      lastUpload: (function() {
        try { return parseInt(localStorage.getItem(LAST_UPLOAD_KEY) || '0', 10); }
        catch(_) { return 0; }
      })(),
    });
  }

  return {
    init, setEnabled, getEnabled, tryUploadNow, getStats,
    // Phase 3 用
    refreshEnabledFromStorage,
  };
})();

// 自動初期化
if (typeof window !== 'undefined') {
  try { TrainingUploader.init(); } catch(_) {}
}
