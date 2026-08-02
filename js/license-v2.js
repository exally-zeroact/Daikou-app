// ============================================================
// js/license-v2.js
// ★ライセンスv2 状態機械 (2026-07-02・会社URL/QR+署名トークン方式・STEP2の純ロジック)★
// ★★重要: 本 file は現状 index.html に未ロード=本番未配線(先行実装)★★。最終ライセンス方式
//   (URL/QR+Ed25519署名・project_daikome_license_code_activation_design_2026-06-30)の STEP2 として
//   テスト先行で実装済(tests/unit/license-v2-*.test.js で検証)。STEP1(Supabase署名土台)完了後に
//   index.html へ配線し、暫定の js/license.js(Supabase RPC)を置き換える。当面はテストのみで生きる。
//
//   evaluateLicense(payload, nowMs, {running}) = 純関数。副作用なし・距離/課金に無関係。
//   payload = 署名検証済みトークンの中身 or null。{ exp(ms), status:'on'|'off', company_id, device_id, vin }
//     ※署名検証(crypto Ed25519)は別モジュール。ここは「検証済み中身→状態」だけ。
//   返り: { state, allowed, daysLeft, message }
//     state:  'active' | 'warning'(残り<=WARN_DAYS日) | 'expired'(期限切れ or status off) | 'unlicensed'
//     allowed: 業務開始してよいか。★running=true(業務中/客乗せ中)は常に true=絶対止めない★
//     message: 客前に出る想定なので中立(「未払い/料金/支払」は出さない)
// ============================================================
(function () {
  'use strict';

  const WARN_DAYS = 7; // 残りこの日数以下で「Wi-Fiのある所で開いて」警告
  const DAY = 24 * 60 * 60 * 1000;

  // ★アプリ同梱 公開鍵 (Ed25519 raw base64url = jwk.x・32byte)。秘密鍵はサーバ(Edge Function
  //   secret DK_LICENSE_PRIVKEY)のみ。この鍵に対応する秘密鍵で署名した dk-issue-license トークン
  //   だけが verify を通る。2026-07-27 生成。公開鍵は公開してよい。
  const PUBLIC_KEY = 'Xcnw1PowYwc4FwPTW40jcsEipF3ZlV4IFziBD9uhaiY';

  function evaluateLicense(payload, nowMs, opts) {
    opts = opts || {};
    const running = opts.running === true;

    let state, daysLeft, message;

    if (!payload || typeof payload !== 'object') {
      state = 'unlicensed';
      daysLeft = 0;
      message = 'ライセンスがありません。会社から配布されたURL/QRで有効化してください';
    } else {
      const exp = Number(payload.exp) || 0;
      const off = payload.status === 'off';
      if (off) {
        state = 'expired';
        daysLeft = 0;
        message = 'ご利用が停止されています。事務所にご確認ください'; // 中立(未払い等は出さない)
      } else if (exp <= nowMs) {
        state = 'expired';
        daysLeft = 0;
        message = 'Wi-Fiのある所でダイコメを開いて更新してください';
      } else {
        daysLeft = Math.ceil((exp - nowMs) / DAY);
        if (daysLeft <= WARN_DAYS) {
          state = 'warning';
          message = 'あと' + daysLeft + '日でWi-Fiのある所でダイコメを開いてください';
        } else {
          state = 'active';
          message = '';
        }
      }
    }

    // ★業務中(客乗せ中)は絶対に止めない: state は正しく返すが allowed は true★
    const allowedByState = state === 'active' || state === 'warning';
    const allowed = running ? true : allowedByState;

    return { state: state, allowed: allowed, daysLeft: daysLeft, message: message };
  }

  // ============================================================
  // Ed25519 署名検証 (2026-07-03・STEP2)
  //   トークン契約 (Edge Function `dk-issue-license` と一致):
  //     payloadB64 = base64url(utf8(JSON.stringify(payload)))
  //     署名対象   = utf8bytes(payloadB64)  ← 送信文字列そのもの(JSON再直列化しない=キー順ズレ耐性)
  //     token      = payloadB64 + "." + base64url(sig)
  //   公開鍵はアプリ同梱の base64url raw(32byte・jwk.x)。秘密鍵はサーバのみ。
  // ============================================================

  // crypto.subtle を browser / node(webcrypto) 両対応で解決
  function _getSubtle() {
    try {
      if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
        return globalThis.crypto.subtle;
      }
    } catch (_) {
      /* ignore */
    }
    try {
      if (typeof require === 'function') {
        // eslint-disable-next-line no-undef, global-require
        const nodeCrypto = require('crypto');
        if (nodeCrypto && nodeCrypto.webcrypto && nodeCrypto.webcrypto.subtle) {
          return nodeCrypto.webcrypto.subtle;
        }
      }
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  // tweetnacl(全ブラウザ・iOS Safari含むEd25519純JS実装)を解決。browser=window.nacl(同梱script)/node=require。
  //   ★これがEd25519検証の主経路。WebCryptoのEd25519は古いiOS Safari(<17)非対応で正規ユーザーがunlicensedになるため★。
  function _getNacl() {
    try {
      if (typeof globalThis !== 'undefined' && globalThis.nacl && globalThis.nacl.sign) {
        return globalThis.nacl;
      }
    } catch (_) {
      /* ignore */
    }
    try {
      if (typeof require === 'function') {
        // eslint-disable-next-line no-undef, global-require
        return require('./tweetnacl.min.js');
      }
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  function _b64urlToBytes(s) {
    if (typeof s !== 'string' || s.length === 0) return null;
    let b = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4 !== 0) b += '=';
    try {
      if (typeof atob === 'function') {
        const bin = atob(b);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      }
      if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(b, 'base64'));
      }
    } catch (_) {
      return null;
    }
    return null;
  }

  function _bytesToUtf8(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('utf8');
    return null;
  }

  function _utf8ToBytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(str, 'utf8'));
    return null;
  }

  // token を公開鍵で検証 → { valid, payload }。改ざん/不正/形式異常/未対応環境は {valid:false, payload:null}。
  async function verifyLicenseToken(token, publicKeyB64url) {
    const fail = { valid: false, payload: null };
    try {
      if (typeof token !== 'string' || typeof publicKeyB64url !== 'string') return fail;
      const dot = token.indexOf('.');
      if (dot <= 0 || dot !== token.lastIndexOf('.')) return fail; // 「.」はちょうど1個
      const payloadB64 = token.slice(0, dot);
      const sigB64 = token.slice(dot + 1);
      if (!payloadB64 || !sigB64) return fail;

      const rawPub = _b64urlToBytes(publicKeyB64url);
      const sigBytes = _b64urlToBytes(sigB64);
      if (!rawPub || rawPub.length !== 32 || !sigBytes || sigBytes.length !== 64) return fail;
      const msg = _utf8ToBytes(payloadB64);
      if (!msg) return fail;

      // ★署名検証: tweetnacl(全ブラウザ・iOS Safari<17含む純JS)を優先。無ければ WebCrypto Ed25519。★
      //   古いiOS SafariはWebCrypto Ed25519非対応=importKeyがthrow→正規ユーザーがunlicensedになるため、
      //   純JS実装を主経路にして端末非依存で検証する(オフライン・同梱)。
      let ok = false;
      const nacl = _getNacl();
      if (
        nacl &&
        nacl.sign &&
        nacl.sign.detached &&
        typeof nacl.sign.detached.verify === 'function'
      ) {
        try {
          ok = nacl.sign.detached.verify(msg, sigBytes, rawPub) === true;
        } catch (_) {
          ok = false;
        }
      } else {
        const subtle = _getSubtle();
        if (!subtle) return fail; // どちらの検証手段も無い → 安全側で無効扱い
        let pubKey;
        try {
          pubKey = await subtle.importKey('raw', rawPub, { name: 'Ed25519' }, false, ['verify']);
        } catch (_) {
          return fail; // 公開鍵 import 失敗 = 不正鍵 or Ed25519未対応
        }
        try {
          ok = (await subtle.verify({ name: 'Ed25519' }, pubKey, sigBytes, msg)) === true;
        } catch (_) {
          ok = false;
        }
      }
      if (!ok) return fail;

      // 署名OK → payload を復号
      const payloadBytes = _b64urlToBytes(payloadB64);
      if (!payloadBytes) return fail;
      const json = _bytesToUtf8(payloadBytes);
      const payload = JSON.parse(json);
      if (!payload || typeof payload !== 'object') return fail;
      return { valid: true, payload: payload };
    } catch (_) {
      return fail; // JSON parse 失敗等は全て無効扱い(throw しない)
    }
  }

  // 検証→状態を1本化。署名NG/偽トークンは payload=null → unlicensed。running=true は常に allowed。
  async function evaluateLicenseToken(token, publicKeyB64url, nowMs, opts) {
    const v = await verifyLicenseToken(token, publicKeyB64url);
    return evaluateLicense(v.valid ? v.payload : null, nowMs, opts);
  }

  // 埋め込み公開鍵(PUBLIC_KEY)を使う版。呼出側は鍵を渡さなくてよい=単一の真実源。
  function verifyLicenseTokenEmbedded(token) {
    return verifyLicenseToken(token, PUBLIC_KEY);
  }
  function evaluateLicenseTokenEmbedded(token, nowMs, opts) {
    return evaluateLicenseToken(token, PUBLIC_KEY, nowMs, opts);
  }

  const api = {
    evaluateLicense: evaluateLicense,
    verifyLicenseToken: verifyLicenseToken,
    evaluateLicenseToken: evaluateLicenseToken,
    verifyLicenseTokenEmbedded: verifyLicenseTokenEmbedded,
    evaluateLicenseTokenEmbedded: evaluateLicenseTokenEmbedded,
    PUBLIC_KEY: PUBLIC_KEY,
    WARN_DAYS: WARN_DAYS,
  };

  if (typeof window !== 'undefined') window.LicenseV2 = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})();
