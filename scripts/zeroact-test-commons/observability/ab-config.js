/* eslint-env browser */

// ============================================================
// scripts/zeroact-test-commons/observability/ab-config.js
// ZEROact 共通テスト基盤 Stage 6 (2026-05-18 新規)
//
// 目的: Firebase Remote Config を活用した A/B 実験設定テンプレート。
//
// 用途:
//   index.html 側で本ファイルを <script> 読込み initABConfig(userId) を呼ぶ前提。
//   ★ 本ファイル自体は既存コード無変更原則のため現状未配線。
//   司さん側で index.html に <script src="..."> + 初期化呼出を追加するタイミングで有効化。
//
// 実験パラメータ例 (key / default):
//   viterbi_n_ios          iOS の Viterbi window N (= 10 default・実験で 8/12 等切替)
//   fare_display_mode      料金表示モード (= classic / animated / minimal)
//   warmup_retry_count     warmup 失敗時の retry 回数 (= 3 default)
//
// A/B グループ分けロジック:
//   userId hash から決定論的に group 割当 (= 同一ユーザーは常に同じ group)
//   userId 未取得時は localStorage で生成・永続化 (= 端末固定)
// ============================================================

(function (global) {
  const STORAGE_KEY = 'daikome_ab_user_id';

  // 実験パラメータ定義 (= Firebase Remote Config の console と同期する想定)
  const EXPERIMENT_DEFAULTS = {
    viterbi_n_ios: 10,
    fare_display_mode: 'classic',
    warmup_retry_count: 3,
  };

  // 実験別 group 数・seed offset
  const EXPERIMENT_DEFINITIONS = {
    viterbi_n_ios: {
      variants: [
        { name: 'control', value: 10 },
        { name: 'shorter', value: 8 },
        { name: 'longer', value: 12 },
      ],
      seedOffset: 'viterbi_n_ios',
    },
    fare_display_mode: {
      variants: [
        { name: 'classic', value: 'classic' },
        { name: 'animated', value: 'animated' },
        { name: 'minimal', value: 'minimal' },
      ],
      seedOffset: 'fare_display_mode',
    },
    warmup_retry_count: {
      variants: [
        { name: 'control', value: 3 },
        { name: 'aggressive', value: 5 },
      ],
      seedOffset: 'warmup_retry_count',
    },
  };

  // 決定論的 hash (FNV-1a 32bit・seed offset 込み)
  function hashStr(input) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash;
  }

  function getOrCreateUserId() {
    try {
      const existing = global.localStorage?.getItem(STORAGE_KEY);
      if (existing) return existing;
    } catch (_e) {
      // localStorage access denied (= プライベート browsing 等)・無視
    }
    const newId = 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    try {
      if (global.localStorage) global.localStorage.setItem(STORAGE_KEY, newId);
    } catch (_e) {
      // 永続化失敗・session 内のみ有効
    }
    return newId;
  }

  // userId + experimentKey から variant index を決定論的に返す
  function pickVariantIndex(userId, experimentKey, variantCount) {
    const def = EXPERIMENT_DEFINITIONS[experimentKey];
    const seedOffset = def?.seedOffset || experimentKey;
    const seed = userId + ':' + seedOffset;
    return hashStr(seed) % variantCount;
  }

  function assignVariant(userId, experimentKey) {
    const def = EXPERIMENT_DEFINITIONS[experimentKey];
    if (!def?.variants || def.variants.length === 0) {
      return { variant: 'control', value: EXPERIMENT_DEFAULTS[experimentKey] };
    }
    const idx = pickVariantIndex(userId, experimentKey, def.variants.length);
    const picked = def.variants[idx];
    return { variant: picked.name, value: picked.value };
  }

  // Firebase Remote Config の値を優先・fallback で hash assign
  async function fetchRemoteValues(rcInstance) {
    if (!rcInstance) return {};
    try {
      await rcInstance.fetchAndActivate();
      const out = {};
      for (const key of Object.keys(EXPERIMENT_DEFAULTS)) {
        const v = rcInstance.getValue(key);
        if (v && typeof v.asString === 'function') {
          const str = v.asString();
          if (str !== '') {
            // 数値なら parse
            const num = Number(str);
            out[key] = Number.isFinite(num) && !Number.isNaN(num) ? num : str;
          }
        }
      }
      return out;
    } catch (e) {
      console.warn('[ab-config] Remote Config fetch failed: ' + e.message);
      return {};
    }
  }

  async function initABConfig(opts) {
    const userId = opts?.userId || getOrCreateUserId();
    const remoteRC = opts?.firebaseRC || null;

    // 1. Firebase Remote Config 値を試行 (= サーバー override)
    const remote = await fetchRemoteValues(remoteRC);

    // 2. 各実験パラメータの解決 (= remote > hash assign > default)
    const resolved = {};
    for (const key of Object.keys(EXPERIMENT_DEFAULTS)) {
      if (remote[key] !== undefined && remote[key] !== null) {
        resolved[key] = { variant: 'remote', value: remote[key], source: 'firebase' };
      } else {
        const assigned = assignVariant(userId, key);
        resolved[key] = Object.assign(assigned, { source: 'hash' });
      }
    }

    // 3. Sentry tag 設定 (= 実験 group ごとのエラー集計用)
    if (global.Sentry && typeof global.Sentry.setTags === 'function') {
      const tags = { 'daikome.user_id': userId };
      for (const key of Object.keys(resolved)) {
        tags['daikome.exp.' + key] = String(resolved[key].variant);
      }
      global.Sentry.setTags(tags);
    }

    console.log('[ab-config] init OK user=' + userId + ' resolved=' + JSON.stringify(resolved));

    return { userId, experiments: resolved };
  }

  global.DaikomeABConfig = {
    initABConfig,
    assignVariant,
    EXPERIMENT_DEFAULTS,
    EXPERIMENT_DEFINITIONS,
    getOrCreateUserId,
  };
})(typeof window !== 'undefined' ? window : globalThis);
