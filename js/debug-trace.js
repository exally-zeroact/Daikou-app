// ============================================================
// js/debug-trace.js
// 較正用 GPS trace 収集ツール (= noise model 較正タスク用・2026-05-21)
//
// ★設計変更宣言 (= prod 同梱・feature flag OFF default):
//   feature flag (= URL ?trace=on で localStorage 有効化) で activate された端末でのみ
//   watchPosition 並行 subscribe で・GPS sample を memory 蓄積。
//   設定画面の「📡 GPS trace 送信」ボタンで・Firebase RTDB の debug_traces に
//   REST 直叩きで upload。
//
//   prod の・距離機構 (= distance_m / calcFare / commit) / 課金経路 / Worker B /
//   map-matcher は・**1 byte も触らない**。本 file は独立・通常時は何もしない (= 早期 return)。
//
//   activation:
//     ★設計変更宣言 (2026-05-23・テストビルド常時 ON 化・noise calibration 30 日収集 加速):
//       テストビルド (= !DEBUG.isProduction) では・既定 ON (= 司さん手動操作 不要)。
//       本番 (= daikou-app.vercel.app 等) では・既存挙動維持 (= 既定 OFF)。
//       ?trace=off で・テストビルドでも・明示 OFF 可能 (= localStorage に '0' 永続)。
//       ?trace=on は・既存互換 (= 本番でも・明示 ON 可能・localStorage '1' 永続)。
//       prod の・privacy/cost/同意 への影響なし (= 本番 既定 OFF 不変)。
//
//   security:
//     Firebase RTDB の `debug_traces` スコープのみに書込・writeKey 必須・samples 5000 上限
//     Firebase rules (= 司さん が Console で 1 回設定) で・他 path 書込は完全に塞ぐ前提
//
//   multi-device 識別:
//     device_id: crypto.randomUUID() で初回自動生成・localStorage 永続 (= 操作ゼロ)
//     device_label: 設定画面でユーザ命名・任意 (= 「親機」「スタッフ A」等)
//     userAgent: 機種情報自動取得
//
//   絶対前提:
//     ・距離機構 / 課金経路 / Worker B / map-matcher / gps.js / gps-worker.js: 一切触らない
//     ・既存 navigator.geolocation 経路への干渉なし (= 独立 watchPosition で並行 subscribe)
//     ・flag OFF (= default) では・本 file は load されても何もせず終了
//     ・他 user / 通常 install では・サイレント (= UI 一切表示しない)
// ============================================================
/* eslint-disable no-console -- 本 file は debug 用・console.error は最終手段の log のみ */

(function () {
  'use strict';

  // ─── 定数 ────────────────────────────────────────────────
  const FLAG_KEY = 'DAIKOME_TRACE_ENABLED';
  const DEVICE_ID_KEY = 'DAIKOME_DEVICE_ID';
  const DEVICE_LABEL_KEY = 'DAIKOME_DEVICE_LABEL';
  const WRITE_KEY = 'DAIKOME_DEBUG_2026'; // Firebase rules validation で要求される共有 key
  const DB_URL = 'https://daikou-app-c821a-default-rtdb.asia-southeast1.firebasedatabase.app';
  const DB_PATH = '/debug_traces.json';
  const MAX_SAMPLES = 5000; // Firebase rules の validate と一致 (= 90 分代行相当の上限)
  const WATCH_OPTIONS = { enableHighAccuracy: true, timeout: 3000, maximumAge: 0 };

  // ─── Feature flag handling (= ?trace=on/off で切替) ────────
  // ★設計変更宣言 (2026-05-23・テストビルド既定 ON):
  //   旧: ?trace=on → '1' set / ?trace=off → removeItem(null) → 既定 OFF
  //   新: ?trace=on → '1' set / ?trace=off → '0' set (= 明示 OFF 印・null と区別)
  //   テストビルド (= !DEBUG.isProduction) で・stored が・null (= 未設定) なら ON 扱い。
  try {
    const params = new URLSearchParams(location.search);
    const t = params.get('trace');
    if (t === 'on') {
      localStorage.setItem(FLAG_KEY, '1');
    } else if (t === 'off') {
      // 明示 OFF 印 (= '0')・null との区別で・テストビルド既定 ON を上書きできる
      localStorage.setItem(FLAG_KEY, '0');
    }
  } catch (_) {
    // URL parse 失敗・localStorage 不可 → 静かに無視
  }

  // ─── enabled 判定 ───
  //   優先度:
  //     1. localStorage = '1' (= 明示 ON) → ON
  //     2. localStorage = '0' (= 明示 OFF) → OFF
  //     3. localStorage = null (= 未設定):
  //        - テストビルド (= DEBUG.isProduction !== true) → ON (= 既定 ON・noise calibration 自動収集)
  //        - 本番 (= DEBUG.isProduction === true) → OFF (= privacy/cost/同意・既定 OFF 不変)
  //   DEBUG global は・debug-config.js (= 先行 load) の top-level const・classic script で共有 scope。
  //   DEBUG 参照不可 (= debug-config 未 load 等) → 安全側で OFF (= 本番扱い)。
  let _enabled = false;
  try {
    const stored = localStorage.getItem(FLAG_KEY);
    if (stored === '1') {
      _enabled = true;
    } else if (stored === '0') {
      _enabled = false;
    } else {
      // 未設定: テストビルド既定 ON / 本番既定 OFF
      const _isProd = typeof DEBUG !== 'undefined' && DEBUG && DEBUG.isProduction === true;
      _enabled = !_isProd;
    }
  } catch (_) {
    _enabled = false; // localStorage 不可 → 安全側 OFF
  }
  if (!_enabled) return;

  // ─── device_id 初回自動生成 (= 永続化・操作ゼロ) ──────────
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

  // ─── samples buffer (= memory only・PWA close で消える設計) ─
  let samples = [];
  let watchId = null;
  let startedAt = null;

  function onPosition(p) {
    if (samples.length >= MAX_SAMPLES) return; // 上限到達後は破棄
    const c = p.coords;
    if (startedAt == null) startedAt = p.timestamp;
    samples.push({
      t: p.timestamp,
      lat: c.latitude,
      lng: c.longitude,
      acc: c.accuracy,
      spd: c.speed,
      hdg: c.heading,
      alt: c.altitude,
    });
    const countEl = document.getElementById('traceSampleCount');
    if (countEl) countEl.textContent = String(samples.length);
  }

  function onError() {
    // GPS error は静かに無視・既存 prod の onError 経路を侵さない
  }

  function startWatch() {
    if (watchId !== null) return;
    if (!('geolocation' in navigator)) return;
    try {
      watchId = navigator.geolocation.watchPosition(onPosition, onError, WATCH_OPTIONS);
    } catch (_) {
      watchId = null;
    }
  }

  // 起動時に・自動 watchPosition 開始 (= 既存 gps.js の watchPosition とは独立・並行 subscribe)
  startWatch();

  // ─── upload function (= 「📡 GPS trace 送信」ボタンから呼出・window 公開) ─
  window.uploadGpsTrace = function () {
    return new Promise(function (resolve) {
      if (samples.length === 0) {
        resolve({ ok: false, error: 'sample 0 件 (= 業務開始前 or 既送信)' });
        return;
      }
      let label = '';
      try {
        label = localStorage.getItem(DEVICE_LABEL_KEY) || '';
      } catch (_) {
        /* ignore */
      }
      const endedAt = samples[samples.length - 1].t;
      const body = {
        meta: {
          device_id: deviceId,
          device_label: label,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
          started_at: startedAt,
          ended_at: endedAt,
          sample_count: samples.length,
          watch_options: 'enableHighAccuracy:true,timeout:3000,maximumAge:0',
        },
        samples: samples.slice(),
        writeKey: WRITE_KEY,
      };
      fetch(DB_URL + DB_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          const traceId = data && data.name ? data.name : 'unknown';
          // 送信成功 → samples reset (= 次代行用に buffer 空)
          samples = [];
          startedAt = null;
          const countEl = document.getElementById('traceSampleCount');
          if (countEl) countEl.textContent = '0';
          resolve({ ok: true, traceId: traceId });
        })
        .catch(function (err) {
          resolve({ ok: false, error: err.message || 'upload failed' });
        });
    });
  };

  // ─── DOM 配線 (= #overlaySettings に挿入された UI element に bind) ─
  function bindUI() {
    const section = document.getElementById('debugTraceSection');
    if (!section) return false; // UI 未挿入 (= 旧 PWA cache 残存) → bind skip
    section.style.display = ''; // hidden → 表示

    const labelInput = document.getElementById('traceDeviceLabel');
    if (labelInput) {
      try {
        labelInput.value = localStorage.getItem(DEVICE_LABEL_KEY) || '';
      } catch (_) {
        /* ignore */
      }
      labelInput.addEventListener('change', function () {
        try {
          localStorage.setItem(DEVICE_LABEL_KEY, labelInput.value.trim());
        } catch (_) {
          /* ignore */
        }
      });
    }

    const deviceIdEl = document.getElementById('traceDeviceId');
    if (deviceIdEl) deviceIdEl.textContent = deviceId;

    const countEl = document.getElementById('traceSampleCount');
    if (countEl) countEl.textContent = String(samples.length);

    const btn = document.getElementById('btnUploadTrace');
    const statusEl = document.getElementById('traceStatus');
    if (btn && statusEl) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        statusEl.textContent = '送信中...';
        window.uploadGpsTrace().then(function (r) {
          btn.disabled = false;
          if (r.ok) {
            statusEl.textContent = '✓ 送信完了: ' + r.traceId;
          } else {
            statusEl.textContent = '✗ 送信失敗: ' + r.error;
          }
        });
      });
    }
    return true;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bindUI);
    } else {
      bindUI();
    }
  }
})();
