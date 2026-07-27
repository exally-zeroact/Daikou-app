// ============================================================
// js/debug-log-uploader.js
// Eruda console log を Firebase RTDB に自動 upload するツール (= 2026-05-29)
//
// ★2026-07-03 自動trace廃止で既定OFFに変更★: 本 file は ★既定OFF★(?debuglog=on を明示した時のみ有効・
//   下記「テストビルド既定ON」は旧記述=無効)。有効時のみ console override→30秒/500件でPOST。通常運用では
//   何もしない(早期return)。
// ★(旧)設計変更宣言 (= prod 同梱・テストビルド既定 ON):
//   console.log / console.warn / console.error / dlog を override し・リングバッファに蓄積。
//   30 秒間隔 or 500 件溜まる毎に Firebase RTDB の debug_traces (= 既存・public read 可)
//   へ POST。司さんが Eruda Console で見るログを・Claude (= 解析側) も REST で並行参照可能にする。
//
// ★設計変更宣言 (2026-05-29 PM rev4・送信先を /debug_traces に統合):
//   司さん指示「console log 直接取得できるようにしろや」 で・
//   /debug_logs (= public read 不可) を放棄し /debug_traces (= 既存 public read OK・
//   debug-trace.js / training-uploader が既に同 path に書込み済・rules 変更不要) に統合。
//   既存 debug-trace.js の startup_metrics と同 path 同 schema pattern。
//   payload は { meta: { kind:'console_log', ... }, samples: [{t, lvl, m}, ...] } で
//   既存 schema validation (= writeKey + sample_count 上限) を素直に通る。
//
//   prod の・距離機構 (= distance_m / calcFare / commit) / 課金経路 / Worker B /
//   map-matcher は・**1 byte も触らない**。本 file は独立・通常時は何もしない (= 早期 return)。
//
//   activation (★2026-07-03 更新★):
//     ★既定 OFF (テスト/本番とも)★。?debuglog=on を明示した時のみ有効(診断セッション限定)。
//     (旧: テストビルド既定ONで自動push → 自動trace廃止で既定OFFに変更)。
//
//   security:
//     Firebase RTDB の `debug_traces` スコープのみに書込・writeKey 必須・samples 5000 上限
//     既存 debug-trace.js と同 rules で・他 path 書込は完全に塞ぐ前提
//
//   取得方法 (= Claude が REST で):
//     1. curl https://daikou-app-c821a-default-rtdb.../debug_traces.json?shallow=true
//        → 全 push key list (= GPS trace + startup_metrics + console_log 混在)
//     2. 各 key の /meta.json で kind 確認・kind='console_log' の key を抽出
//     3. /samples.json で・該当 batch の log lines 取得
//
//   絶対前提:
//     ・距離機構 / 課金経路 / Worker B / map-matcher / gps.js / gps-worker.js: 一切触らない
//     ・既存 console / Eruda 経路への干渉なし (= override は in-memory wrapper・元の関数を必ず呼ぶ)
//     ・flag OFF では・本 file は load されても何もせず終了
// ============================================================
/* eslint-disable no-console -- 本 file は debug 用・console.error は最終手段の log のみ */

(function () {
  'use strict';

  // ─── 定数 ────────────────────────────────────────────────
  const FLAG_KEY = 'DAIKOME_DEBUGLOG_ENABLED';
  const DEVICE_ID_KEY = 'DAIKOME_DEVICE_ID'; // debug-trace.js と共有
  const DEVICE_LABEL_KEY = 'DAIKOME_DEVICE_LABEL'; // debug-trace.js と共有
  const WRITE_KEY = 'DAIKOME_DEBUG_2026'; // Firebase rules validation 共有 key
  const DB_URL = 'https://daikou-app-c821a-default-rtdb.asia-southeast1.firebasedatabase.app';
  const DB_PATH = '/debug_traces.json'; // ★rev4: 既存 public read 可・rules 変更不要
  const FLUSH_INTERVAL_MS = 30000; // 30 秒間隔 flush
  const FLUSH_THRESHOLD = 500; // 500 件溜まったら flush
  const MAX_BUFFER = 5000; // overflow guard

  // ─── Feature flag handling (= ?debuglog=on/off で切替) ────
  try {
    const params = new URLSearchParams(location.search);
    const t = params.get('debuglog');
    if (t === 'on') {
      localStorage.setItem(FLAG_KEY, '1');
    } else if (t === 'off') {
      localStorage.setItem(FLAG_KEY, '0');
    }
  } catch (_) {
    /* ignore */
  }

  // ─── enabled 判定 ───
  let _enabled = false;
  try {
    const stored = localStorage.getItem(FLAG_KEY);
    if (stored === '1') {
      _enabled = true;
    } else if (stored === '0') {
      _enabled = false;
    } else {
      // ★2026-07-03 司さん指示「自動trace廃止」★: console log の自動アップロードは
      //   テストビルドでも既定 OFF。有効化は ?debuglog=on を明示した時のみ (= 診断セッション限定)。
      //   旧はテストビルドで非本番なら既定 ON (30秒毎に自動 push) にしていたが撤去。
      _enabled = false;
    }
  } catch (_) {
    _enabled = false;
  }
  if (!_enabled) return;

  // ─── device_id / session_id 取得 ───
  let deviceId;
  try {
    deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : 'fallback-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
  } catch (_) {
    deviceId = 'no-storage';
  }
  const sessionId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'sess-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  const startedAt = Date.now();

  // ─── リングバッファ ───
  const buffer = [];
  let droppedCount = 0;
  let batchSeq = 0;
  let uploadInflight = false;

  function _push(level, args) {
    if (buffer.length >= MAX_BUFFER) {
      droppedCount++;
      return;
    }
    let text = '';
    try {
      text = Array.from(args)
        .map(function (a) {
          if (a == null) return String(a);
          if (typeof a === 'string') return a;
          if (typeof a === 'number' || typeof a === 'boolean') return String(a);
          try {
            return JSON.stringify(a);
          } catch (_) {
            return '[unserializable]';
          }
        })
        .join(' ');
    } catch (_) {
      text = '[stringify-failed]';
    }
    // ★Firebase rules schema 互換 (= 2026-05-29 PM rev5・401 拒否 fix):
    //   既存 startup_metrics と同 schema (= lat/lng/acc/spd/hdg/alt 必須・dummy 0 で pass)
    //   lvl/m は phase と同じ追加 field・rules validate を素直に通す。
    buffer.push({
      t: Date.now() - startedAt,
      lat: 0,
      lng: 0,
      acc: 0,
      spd: 0,
      hdg: 0,
      alt: 0,
      lvl: level,
      m: text,
    });
    if (buffer.length >= FLUSH_THRESHOLD) {
      _maybeFlush('threshold');
    }
  }

  // ─── console / dlog の override (= 元関数は必ず呼ぶ・透過) ─
  const _origConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info ? console.info.bind(console) : console.log.bind(console),
  };
  console.log = function () {
    _push('log', arguments);
    _origConsole.log.apply(null, arguments);
  };
  console.warn = function () {
    _push('warn', arguments);
    _origConsole.warn.apply(null, arguments);
  };
  console.error = function () {
    _push('error', arguments);
    _origConsole.error.apply(null, arguments);
  };
  console.info = function () {
    _push('info', arguments);
    _origConsole.info.apply(null, arguments);
  };
  // dlog (= debug-config.js が提供する global) も hook
  if (typeof window !== 'undefined' && typeof window.dlog === 'function') {
    const _origDlog = window.dlog;
    window.dlog = function () {
      _push('dlog', arguments);
      _origDlog.apply(null, arguments);
    };
  }

  // ─── flush (= /debug_traces に POST で 1 batch = 1 record 新規) ───
  function _maybeFlush(triggerSource) {
    if (buffer.length === 0) return;
    const lines = buffer.splice(0, buffer.length);
    let label = '';
    try {
      label = localStorage.getItem(DEVICE_LABEL_KEY) || '';
    } catch (_) {
      /* ignore */
    }
    const now = Date.now();
    batchSeq++;
    const body = {
      meta: {
        kind: 'console_log', // ★既存 startup_metrics と区別する識別子
        device_id: deviceId,
        device_label: label,
        session_id: sessionId,
        batch_seq: batchSeq,
        started_at: lines[0] ? startedAt + lines[0].t : startedAt,
        ended_at: lines[lines.length - 1] ? startedAt + lines[lines.length - 1].t : now,
        sample_count: lines.length,
        flush_trigger: triggerSource,
        dropped_count: droppedCount,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      },
      samples: lines,
      writeKey: WRITE_KEY,
    };
    // ★永続キュー経由(2026-06-16): オフラインでも IndexedDB に残り・オンライン/次回起動で自動送信★。
    //   outbox 未ロード時のみ従来の直POST(オンライン時)にフォールバック。
    if (
      typeof window !== 'undefined' &&
      window.DaikomeTraceOutbox &&
      window.DaikomeTraceOutbox.submit
    ) {
      window.DaikomeTraceOutbox.submit(body); // 永続化→trim→(online)送信。失敗してもアプリは止めない。
      // ★S1: hidden/unload は IDB commit 前に kill される窓があるので best-effort sendBeacon も併送
      //   (online限定・消失より二重がマシ=解析側は session_id+batch_seq で dedup 可能)★
      if (
        (triggerSource === 'hidden' || triggerSource === 'beforeunload') &&
        typeof navigator !== 'undefined' &&
        typeof navigator.sendBeacon === 'function'
      ) {
        try {
          navigator.sendBeacon(
            DB_URL + DB_PATH,
            new Blob([JSON.stringify(body)], { type: 'application/json' })
          );
        } catch (_) {
          /* best-effort */
        }
      }
      return;
    }
    if (uploadInflight) {
      for (let i = lines.length - 1; i >= 0; i--)
        if (buffer.length < MAX_BUFFER) buffer.unshift(lines[i]);
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      for (let i = lines.length - 1; i >= 0; i--)
        if (buffer.length < MAX_BUFFER) buffer.unshift(lines[i]);
      return;
    }
    uploadInflight = true;
    fetch(DB_URL + DB_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        uploadInflight = false;
      })
      .catch(function () {
        for (let i = lines.length - 1; i >= 0; i--) {
          if (buffer.length < MAX_BUFFER) buffer.unshift(lines[i]);
        }
        uploadInflight = false;
      });
  }

  // ─── 30 秒間隔 flush + visibilitychange + beforeunload ───
  setInterval(function () {
    _maybeFlush('periodic');
  }, FLUSH_INTERVAL_MS);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) _maybeFlush('hidden');
    });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', function () {
      // beforeunload では fetch が間に合わない可能性 → sendBeacon で best-effort
      if (buffer.length === 0) return;
      try {
        const lines = buffer.splice(0, buffer.length);
        const now = Date.now();
        batchSeq++;
        const body = {
          meta: {
            kind: 'console_log',
            device_id: deviceId,
            session_id: sessionId,
            batch_seq: batchSeq,
            started_at: lines[0] ? startedAt + lines[0].t : startedAt,
            ended_at: lines[lines.length - 1] ? startedAt + lines[lines.length - 1].t : now,
            sample_count: lines.length,
            flush_trigger: 'beforeunload',
            dropped_count: droppedCount,
          },
          samples: lines,
          writeKey: WRITE_KEY,
        };
        const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
        if (navigator.sendBeacon) {
          navigator.sendBeacon(DB_URL + DB_PATH, blob);
        }
      } catch (_) {
        /* best-effort */
      }
    });
  }

  // ─── window 公開 (= 手動 flush / 状態確認用) ───
  if (typeof window !== 'undefined') {
    window.debugLogUploader = {
      flushNow: function () {
        _maybeFlush('manual');
      },
      getStatus: function () {
        return {
          enabled: _enabled,
          buffered: buffer.length,
          dropped: droppedCount,
          session_id: sessionId,
          device_id: deviceId,
          started_at: startedAt,
          batch_seq: batchSeq,
        };
      },
    };
  }

  // 初期化完了ログ (= override 後の console.log なので自身もバッファに入る)
  console.log(
    '[debug-log-uploader] init OK session=' +
      sessionId.slice(0, 8) +
      ' device=' +
      deviceId.slice(0, 8)
  );
})();
