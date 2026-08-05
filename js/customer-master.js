// ============================================================
// js/customer-master.js
// ★請求先マスタ(会社一覧)を端末に持ってくる (2026-08-01)★
//
//   実車中の「請求書」ボタンで選ぶ会社の一覧。
//   ★マスタの唯一の正は「代行請求書アプリの companies」★
//     ダイコメ側に別マスタは作らない = 会社を2箇所に登録させない(司さん指摘)。
//
//   ▼やること
//     オンラインの時に dk-customers から一覧を取り、localStorage(dk_customers_cache)に置く。
//     実車中はそのキャッシュを読むだけ = ★オフラインでも会社を選べる★。
//
//   ▼絶対に守ること
//     ・throw しない(業務を止めない)
//     ・通信に失敗してもキャッシュを消さない(現場の一覧が消えたら仕事にならない)
//     ・空の応答でキャッシュを消さない(一瞬の不調で消えるのを防ぐ)
//     ・会社URLで活性化していない端末(自社運用)は何もしない
// ============================================================
(function (global) {
  'use strict';

  const K_CACHE = 'dk_customers_cache'; // 実車中の請求書モーダルが読む一覧
  const K_COMPANY = 'dk_license_company'; // license-activate が持つ会社url_token
  const DEVICE_ID_KEY = 'DAIKOME_DEVICE_ID';
  const MAX_CUSTOMERS = 500;

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

  // ─── 純ロジック(テスト対象) ────────────────────────────

  // サーバの応答を、実車中のモーダルが読む形に整える。壊れた行は捨てる。
  function normalize(rows) {
    try {
      if (!Array.isArray(rows)) return [];
      const out = [];
      for (let i = 0; i < rows.length && out.length < MAX_CUSTOMERS; i++) {
        const r = rows[i];
        if (!r || typeof r !== 'object') continue;
        const id = r.id === 0 || r.id ? String(r.id) : '';
        const name = typeof r.name === 'string' ? r.name.trim() : '';
        if (!id || !name) continue;
        const row = { customer_id: id, name: name, active: true };
        // ★誰が乗ったかを選ばせる会社 (2026-08-05)★
        //   藤原建設のように請求書を「会長／社長／専務」で分けて小計を出す会社は、
        //   請求先を選んだ後に★名前も選ばせないと、その行だけ仕分けから外れる★。
        //   使わない会社には付けない(付いていない=聞かない、で判断できる)。
        const g = Array.isArray(r.note_groups) ? r.note_groups : null;
        if (g) {
          const clean = g
            .map((x) => (typeof x === 'string' ? x.trim() : ''))
            .filter((x) => x)
            .slice(0, 20);
          if (clean.length) row.note_groups = clean;
        }
        out.push(row);
      }
      return out;
    } catch (_) {
      return [];
    }
  }

  // 新しい一覧をキャッシュに反映する。★空なら今のキャッシュを守る★。
  function mergeCache(current, next) {
    try {
      const cur = Array.isArray(current) ? current : [];
      if (!Array.isArray(next) || next.length === 0) return cur;
      return next;
    } catch (_) {
      return [];
    }
  }

  // ─── 実行部(薄い) ──────────────────────────────────────

  function list() {
    try {
      const raw = _get(K_CACHE);
      const v = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v : [];
    } catch (_) {
      return [];
    }
  }

  async function sync() {
    try {
      const companyToken = _get(K_COMPANY);
      const deviceId = _get(DEVICE_ID_KEY);
      if (!companyToken || !deviceId) return { ok: false, reason: 'not_activated' };
      try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false)
          return { ok: false, reason: 'offline' };
      } catch (_) {
        /* ignore */
      }
      const cfg = _cfg();
      if (!cfg) return { ok: false, reason: 'no_config' };

      let j;
      try {
        const res = await fetch(cfg.fn('dk-customers'), {
          method: 'POST',
          headers: cfg.headers(),
          body: JSON.stringify({ url_token: companyToken, device_id: deviceId }),
        });
        j = await res.json();
      } catch (_) {
        return { ok: false, reason: 'offline' }; // ★キャッシュはそのまま★
      }
      if (!j || !j.ok) return { ok: false, reason: (j && j.reason) || 'error' };

      const next = normalize(j.customers);
      const merged = mergeCache(list(), next);
      _set(K_CACHE, JSON.stringify(merged));
      return { ok: true, count: merged.length };
    } catch (_) {
      return { ok: false, reason: 'error' }; // ★絶対に throw しない★
    }
  }

  function init() {
    try {
      const run = function () {
        try {
          sync();
        } catch (_) {
          /* ignore */
        }
      };
      run();
      if (global && typeof global.addEventListener === 'function') {
        global.addEventListener('online', run);
      }
    } catch (_) {
      /* ignore */
    }
  }

  const api = {
    normalize: normalize,
    mergeCache: mergeCache,
    list: list,
    sync: sync,
    init: init,
    MAX_CUSTOMERS: MAX_CUSTOMERS,
  };

  if (global) global.CustomerMaster = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
