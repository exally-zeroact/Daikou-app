// ============================================================
// js/license-activate.js
// ★ライセンス STEP3: 会社URL活性化 + 署名トークン検証 + 同期(2026-07-27)★
//   最終方式(会社URL/QR+Ed25519署名・project_daikome_license_code_activation_design_2026-06-30)の
//   クライアント配線。license-v2(検証の純ロジック)+ dk-issue-license(発行Edge Function)を繋ぐ。
//
//   フロー:
//     ・会社URL(?c=<url_token>)で開く → activate(url_token) → Edge Functionが署名トークン発行 → cache。
//     ・業務開始ゲート checkBeforeBusinessStart(running) = ★sync★。running(業務中)は常に allowed=絶対止めない。
//     ・開いた時オンライン → sync() で +2ヶ月自動更新。手動🔄更新も sync()。
//   ★距離/課金には一切触れない。allow/denyを返すだけ。★
//   ★署名検証は license-v2(tweetnacl主経路)=iOS Safari含む全ブラウザで動く。★
// ============================================================
(function (global) {
  'use strict';

  // ★接続先は js/dk-config.js(単一の真実源)から取る。ここには書かない(移設漏れ防止)。★
  const DEVICE_ID_KEY = 'DAIKOME_DEVICE_ID'; // license.js / debug-trace と同 key 流用
  const K_TOKEN = 'dk_license_token'; // 署名トークン(本体)
  const K_COMPANY = 'dk_license_company'; // 会社url_token(再同期用)

  function _lv2() {
    try {
      if (global && global.LicenseV2) return global.LicenseV2;
    } catch (_) {
      /* ignore */
    }
    try {
      if (typeof require === 'function') {
        // eslint-disable-next-line no-undef, global-require
        return require('./license-v2.js');
      }
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  // 接続先(dk-config)。無ければ null = 通信できない扱い(業務は止めない)。
  function _cfg() {
    try {
      if (global && global.DKConfig) return global.DKConfig;
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

  function _ls() {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : global && global.localStorage;
    } catch (_) {
      return null;
    }
  }
  function _get(k) {
    try {
      const ls = _ls();
      return ls ? ls.getItem(k) : null;
    } catch (_) {
      return null;
    }
  }
  function _set(k, v) {
    try {
      const ls = _ls();
      if (ls) ls.setItem(k, v);
    } catch (_) {
      /* ignore */
    }
  }

  function _deviceId() {
    let id = _get(DEVICE_ID_KEY);
    if (id) return id;
    try {
      id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : 'fallback-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    } catch (_) {
      id = 'fallback-' + Date.now();
    }
    _set(DEVICE_ID_KEY, id);
    return id;
  }

  function _vin() {
    try {
      return (global && global.DK_VEHICLE_PROFILE && global.DK_VEHICLE_PROFILE.vin) || '';
    } catch (_) {
      return '';
    }
  }

  // ★verify は非同期(1回)・evaluate は sync(毎回・期限は Date.now で新鮮)★
  let _verifiedPayload = null;

  async function _refresh() {
    const token = _get(K_TOKEN);
    const lv2 = _lv2();
    if (!token || !lv2 || typeof lv2.verifyLicenseTokenEmbedded !== 'function') {
      _verifiedPayload = null;
      return null;
    }
    try {
      const v = await lv2.verifyLicenseTokenEmbedded(token);
      _verifiedPayload = v && v.valid ? v.payload : null;
    } catch (_) {
      _verifiedPayload = null;
    }
    return _verifiedPayload;
  }

  // 現在のライセンス状態(sync)。running=業務中は常に allowed(絶対止めない)。
  function evaluate(running) {
    const lv2 = _lv2();
    if (!lv2 || typeof lv2.evaluateLicense !== 'function') {
      return {
        state: _verifiedPayload ? 'active' : 'unlicensed',
        allowed: running === true ? true : !!_verifiedPayload,
        daysLeft: 0,
        message: '',
      };
    }
    return lv2.evaluateLicense(_verifiedPayload, Date.now(), { running: running === true });
  }

  function checkBeforeBusinessStart(running) {
    return evaluate(running === true);
  }

  // 会社url_tokenで署名トークンを取得しcache。台数上限は Edge Function が seat_limit で返す。
  async function activate(urlToken) {
    urlToken = (urlToken || '').trim();
    if (!urlToken) return { ok: false, reason: 'no_token' };
    const cfg = _cfg();
    if (!cfg) return { ok: false, reason: 'offline' }; // 接続先が読めない=通信不可扱い
    let j;
    try {
      const res = await fetch(cfg.fn('dk-issue-license'), {
        method: 'POST',
        headers: cfg.headers(),
        body: JSON.stringify({ url_token: urlToken, device_id: _deviceId(), vin: _vin() }),
      });
      j = await res.json();
    } catch (_) {
      return { ok: false, reason: 'offline' };
    }
    if (j && j.ok && j.token) {
      _set(K_TOKEN, j.token);
      _set(K_COMPANY, urlToken);
      await _refresh();
      return { ok: true };
    }
    return { ok: false, reason: (j && j.reason) || 'error', seat_limit: j && j.seat_limit };
  }

  // cache済み会社url_tokenで再同期(+2ヶ月更新)。
  async function sync() {
    const c = _get(K_COMPANY);
    if (!c) return { ok: false, reason: 'no_company' };
    return activate(c);
  }

  // 起動時: 保存トークン検証 + オンラインなら自動同期(開いた時+2ヶ月)。
  async function init() {
    await _refresh();
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine && _get(K_COMPANY)) {
        await sync();
      }
    } catch (_) {
      /* ignore */
    }
    return evaluate(false);
  }

  function hasCompany() {
    return !!_get(K_COMPANY);
  }
  function getState() {
    return evaluate(false);
  }
  function deviceId() {
    return _deviceId();
  }

  const api = {
    init: init,
    activate: activate,
    sync: sync,
    evaluate: evaluate,
    checkBeforeBusinessStart: checkBeforeBusinessStart,
    getState: getState,
    hasCompany: hasCompany,
    deviceId: deviceId,
    _refresh: _refresh,
  };
  if (typeof global !== 'undefined') global.LicenseActivate = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
