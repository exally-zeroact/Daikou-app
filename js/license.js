// ============================================================
// js/license.js
// 端末ライセンス台数ロック (= 暫定MVP・2026-06-28 Supabase移行・旧Firebase RTDB案から更新)
//
// ★2026-07 現状の注記(重要)★:
//   ・backend は ★Supabase RPC★(dk_check_device_license 等・L30-35)。旧「Firebase RTDB」記述は無効。
//   ・★業務開始ゲートは index.html で if(false) 固定=恒久無効(自社運用のため意図的に殺してある)★。
//     よって本 file の _evaluateState/grace/expired 一式は現状ゲートとして機能していない。
//   ・★最終方式は URL/QR + Ed25519署名 (js/license-v2.js・STEP1待ちの先行実装)★。本 file(RPC/コード活性化)
//     はそれまでの暫定。最終方式が配線されたら本 file の去就を決める。
//
// ★設計変更宣言(旧・Firebase時代の記述=Supabase移行済ゆえ参考):
//   ダイコメ ¥1,980/月/台 サブスクの・台数ロックを・端末側で実装。
//   ・device_id は・既存 DAIKOME_DEVICE_ID (= debug-trace.js L44/L99-105) を・流用
//     (= 新規生成しない・既存値が・あれば・即利用)
//   ・(旧)Firebase RTDB /licensed_devices/{device_id} を・問い合わせ → 現Supabase RPC
//     hit + expires_at > now → 有効
//   ・localStorage cache: { licensed, expires_at, last_check }
//   ・★ オフライン稼働: cache 期限内なら・オンライン確認なしで業務開始可 ★
//   ・期限超過 7 日 grace 内・稼働可・以降 業務開始 block
//   ・未登録 (= hit しない) → ゲート画面 (= showLicenseGate 経由・index.html 側で表示)
//
// 絶対前提:
//   ・distance_m / running gate / Worker B / isStationary / 課金距離ロジック: 完全無関係
//   ・debug-trace.js の・device_id 生成ロジック・1 byte 不変 (= localStorage 同 key 流用のみ)
//   ・Firebase 既存基盤 (= firebase-config.js URL) 再利用・新規 backend なし
//   ・お節介バナーなし (= 未登録ゲートは・機能制御・簡潔)
// ============================================================
/* eslint-disable no-console -- 本 file は license gate・console.error は最終手段の log のみ */

(function () {
  'use strict';

  // ─── 定数 ────────────────────────────────────────────────
  const DEVICE_ID_KEY = 'DAIKOME_DEVICE_ID'; // = debug-trace.js と同 key・流用
  const CACHE_KEY = 'DAIKOME_LICENSE_CACHE';
  // ★2026-06-28: Firebase RTDB → Supabase(Exally倉庫・ダイコメ専用 dk_棚)へ移行(司さん決定)。
  //   連携先の代行請求アプリが同じExally倉庫に居るため同倉庫・別棚(dk_)。anonキーは公開用
  //   (RLS + SECURITY DEFINER RPC dk_check_device_license でデータ保護=列挙/改ざん不可)。
  //   ★接続先は js/dk-config.js(単一の真実源)から取る。ここには書かない(移設漏れ防止・2026-07-31)。★
  function _cfg() {
    try {
      if (typeof window !== 'undefined' && window.DKConfig) return window.DKConfig;
    } catch (_) {
      /* ignore */
    }
    try {
      if (typeof require === 'function') {
        // eslint-disable-next-line no-undef, global-require
        return require('./dk-config.js');
      }
    } catch (_) {
      /* ignore */
    }
    return null;
  }
  const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 日 grace
  // (削除2026-07: _ONLINE_CHECK_INTERVAL_MS は未参照デッド定数だったため撤去。24h再確認は最終方式license-v2で実装)

  // ─── device_id 取得 (= 既存 DAIKOME_DEVICE_ID 流用) ────────
  //   debug-trace.js が・先に load されている場合・既に・初回生成済 (= 同 key 流用)
  //   debug-trace 未 load (= 本番 OFF 等) でも・本 file で・初回生成可能 (= crypto.randomUUID)
  function _getDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_ID_KEY);
      if (id) return id;
      // 既存なし → 初回生成 (= debug-trace と同ロジック・同 key 永続)
      id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : 'fallback-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(DEVICE_ID_KEY, id);
      return id;
    } catch (_) {
      return 'no-storage';
    }
  }

  // ─── cache 読込 ────────────────────────────────────────
  function _readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (typeof obj !== 'object' || obj === null) return null;
      return obj;
    } catch (_) {
      return null;
    }
  }

  function _writeCache(cache) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (_) {
      /* ignore */
    }
  }

  // ─── オンライン認証 (= Supabase RPC 問い合わせ) ────────────────
  //   POST /rest/v1/rpc/dk_check_device_license { p_device_id }
  //   返り: [] (未登録) または [{ licensed, expires_at, label, tenant_id }]
  function _checkOnline(deviceId) {
    const cfg = _cfg();
    if (!cfg) return Promise.reject(new Error('no_config')); // 通信不可扱い(既存のofflineパスへ)
    return fetch(cfg.rest('rpc/dk_check_device_license'), {
      method: 'POST',
      headers: cfg.headers(),
      body: JSON.stringify({ p_device_id: deviceId }),
    })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (rows) {
        // 未登録 = 空配列
        if (!Array.isArray(rows) || rows.length === 0) return { licensed: false };
        const row = rows[0] || {};
        const expiresAt = Number(row.expires_at) || 0;
        const now = Date.now();
        // RPC側でもlicensed判定済だが、cache整合のためexpires_atでも再確認
        if (row.licensed === true && expiresAt > now) {
          return {
            licensed: true,
            expires_at: expiresAt,
            tenant_id: row.tenant_id || '',
            label: row.label || '',
          };
        }
        return { licensed: false, expires_at: expiresAt };
      })
      .catch(function () {
        // network 失敗 → cache 判定に委任
        return null;
      });
  }

  // ─── 状態判定 (= cache + 期限 + grace) ────────────────
  //   返り値:
  //     { state: 'licensed', expires_at }    = 完全有効・業務開始可
  //     { state: 'grace',    expires_at, grace_ends_at } = 期限超過 7 日以内・稼働可
  //     { state: 'expired',  expires_at }    = grace 超過・業務開始 block
  //     { state: 'unregistered' }            = cache なし・未登録 (= ゲート画面)
  //     { state: 'unknown' }                 = 初期・まだ online check 未実行
  function _evaluateState(cache, now) {
    if (!cache) return { state: 'unknown' };
    if (cache.licensed === false) return { state: 'unregistered' };
    if (typeof cache.expires_at !== 'number') return { state: 'unknown' };
    if (cache.expires_at > now) {
      return { state: 'licensed', expires_at: cache.expires_at };
    }
    // 期限超過 → grace 判定
    const graceEndsAt = cache.expires_at + GRACE_PERIOD_MS;
    if (graceEndsAt > now) {
      return { state: 'grace', expires_at: cache.expires_at, grace_ends_at: graceEndsAt };
    }
    return { state: 'expired', expires_at: cache.expires_at };
  }

  // ─── 起動時 online 認証 (= WiFi/connectivity 時のみ) ──────
  function _maybeRefresh(deviceId) {
    // navigator.onLine ガード (= オフライン時は・cache 利用)
    if (typeof navigator !== 'undefined' && navigator.onLine === false)
      return Promise.resolve(null);
    return _checkOnline(deviceId).then(function (result) {
      if (result === null) return null; // network 失敗
      const cache = {
        licensed: !!result.licensed,
        expires_at: result.expires_at || 0,
        last_check: Date.now(),
        tenant_id: result.tenant_id || '',
        label: result.label || '',
      };
      _writeCache(cache);
      return cache;
    });
  }

  // ─── public API ──────────────────────────────────────
  const Public = {};

  Public.getDeviceId = function () {
    return _getDeviceId();
  };

  Public.getState = function () {
    const cache = _readCache();
    return _evaluateState(cache, Date.now());
  };

  Public.getCache = function () {
    return _readCache();
  };

  // 業務開始前の・ゲート判定
  //   返り値: { allowed: bool, state: '...', message: '...' }
  Public.checkBeforeBusinessStart = function () {
    const state = Public.getState();
    if (state.state === 'licensed') {
      return { allowed: true, state: state.state };
    }
    if (state.state === 'grace') {
      return {
        allowed: true,
        state: state.state,
        message: 'ライセンス期限切れ・grace 期間中 (WiFi 接続で再認証してください)',
        grace_ends_at: state.grace_ends_at,
      };
    }
    if (state.state === 'expired') {
      return {
        allowed: false,
        state: state.state,
        message: 'ライセンス期限切れ (= grace 超過)・WiFi 接続で再認証してください',
      };
    }
    if (state.state === 'unregistered') {
      return {
        allowed: false,
        state: state.state,
        message: 'この端末は未登録です',
      };
    }
    // unknown (= 初回起動・cache なし・online check 未完了)
    return {
      allowed: false,
      state: state.state,
      message: '初回認証中 (WiFi 接続を確認してください)',
    };
  };

  // 起動時自動 refresh (= async・promise を返す)
  Public.init = function () {
    const deviceId = _getDeviceId();
    return _maybeRefresh(deviceId).then(function () {
      return Public.getState();
    });
  };

  // 手動 refresh (= 「再認証」 ボタンから呼出)
  Public.refresh = function () {
    return Public.init();
  };

  // ★コード活性化 (2026-06-30・ドライバー端末・ログイン不要)★:
  //   dk_activate_device(code, device_id) を呼び、成功なら cache を licensed に更新。
  //   返り: { ok:true, expires_at } / { ok:false, reason:'invalid'|'expired'|'full'|'network' }。
  //   端末IDは内部で取得(ユーザーは触らない)。台数縛り/失効はサーバ側判定。
  Public.activate = function (code, label) {
    const deviceId = _getDeviceId();
    const cfg = _cfg();
    if (!cfg) return Promise.resolve({ ok: false, reason: 'network' });
    return fetch(cfg.rest('rpc/dk_activate_device'), {
      method: 'POST',
      headers: cfg.headers(),
      body: JSON.stringify({
        p_code: String(code || '').trim(),
        p_device_id: deviceId,
        p_label: label || '',
      }),
    })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (r) {
        if (r && r.ok === true) {
          _writeCache({
            licensed: true,
            expires_at: Number(r.expires_at) || 0,
            last_check: Date.now(),
            tenant_id: '',
            label: r.label || '',
          });
          return { ok: true, expires_at: Number(r.expires_at) || 0 };
        }
        return { ok: false, reason: (r && r.reason) || 'error', seat_limit: r && r.seat_limit };
      })
      .catch(function () {
        return { ok: false, reason: 'network' };
      });
  };

  if (typeof window !== 'undefined') {
    window.License = Public;
  }
  /* eslint-disable no-undef -- Node test 環境で・module.exports 経由 require 可能化 */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = Public;
  }
  /* eslint-enable no-undef */
})();
