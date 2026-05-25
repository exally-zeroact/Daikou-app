// ============================================================
// data-loader.js (2026-05-13 新規)
// ★設計変更宣言: 旧 script タグ inject + window グローバル方式の置換
//   旧: <script src="data/foo.js"> → window.FOO_JP に値が代入される
//       script.onload で window.FOO_JP を読む (汚染あり・silent failure あり)
//   新: cache から fetch → text 取得 → sandbox eval で sandbox オブジェクトに代入
//       window グローバルを汚染せず・失敗を顕在化
//
// ★設計変更宣言 (2026-05-23・X4 方式E・IDB parse cache 導入):
//   旧: 毎起動 fetch + Function eval (= ~30-200ms/url × 60+ url = 律速)
//   新: 初回 parse 結果を IndexedDB (= 'daikome_parsed_cache') に structured clone で保存
//       2 回目以降 IDB から sandbox 即返却・eval / parse skip
//   既存 map-matcher.js MM-7 (= pheromone IDB 保存) と同方式。
//   絶対ルール準拠:
//     ✓ window.XXX 互換 完全維持 (= sandbox 出力 1 bit 不変)
//     ✓ distance_m / Worker B 本体 logic 完全無関係
//     ✓ IDB 壊れ/quota 超過/clone 不可型 → 既存 fetch+eval 経路 graceful fallback
//     ✓ iOS Safari 15.2+ / Android Chrome 全対応 (= native IDB API のみ・依存追加なし)
//
// API:
//   DataLoader.loadFromCache(url) → Promise<sandbox>
//     sandbox = { COARSE_JP: {...}, ROADS_TOKYO: {...}, ... } 等
//
// 仕様 (フロー):
//   1. IDB lookup (= daikome_parsed_cache・url + version 一致) → hit なら sandbox 即返却
//   2. miss / version mismatch → 既存経路:
//        caches.open('daikome-roads-v1') → match → fallback fetch
//        text 取得 → Function eval で sandbox 生成
//   3. fire-and-forget で IDB put (= 次回用)
//   4. sandbox 返却
// ============================================================

(function (global) {
  'use strict';

  // ★ daikome-roads-v1 + アプリコード cache を順に検索する fallback chain
  async function _matchInCaches(url) {
    if (typeof caches === 'undefined') return null;
    try {
      const names = await caches.keys();
      // 1. roads cache を優先
      if (names.indexOf('daikome-roads-v1') !== -1) {
        const c = await caches.open('daikome-roads-v1');
        const r = await c.match(url);
        if (r) return r;
      }
      // 2. アプリコード cache (daikome-{hash}) も試す
      for (const n of names) {
        if (n === 'daikome-roads-v1') continue;
        if (n.indexOf('daikome-') !== 0) continue;
        const c = await caches.open(n);
        const r = await c.match(url);
        if (r) return r;
      }
    } catch (_) {
      // caches API 利用不可 (= SW 未活性 等) → network fallback に・委ねる
    }
    return null;
  }

  async function _fetchAsText(url) {
    // cache 検索 → fallback で network
    let res = await _matchInCaches(url);
    if (!res) {
      // SW 経由で取得 (network・cache:'reload' で HTTP cache bypass)
      try {
        res = await fetch(url, { cache: 'reload' });
      } catch (e) {
        throw new Error('fetch failed: ' + url + ' (' + (e && e.message) + ')');
      }
    }
    if (!res || !res.ok) {
      throw new Error('not ok: ' + url + ' status=' + (res && res.status));
    }
    return await res.text();
  }

  // sandbox eval: 旧 script タグ inject の代替
  //   旧: <script src> で評価 → 副作用で window.X に代入
  //   新: text を Function 化 → sandbox 引数 (window 名) に代入 → 取得
  //   注意: CSP 'unsafe-eval' が必要 (vercel.json 等で許可済前提)
  function _evalText(text, url) {
    const sandbox = {};
    try {
      // 'window' 引数で受けて sandbox に代入される (旧 code は window.X = ... と書いてる)
      const fn = new Function('window', text);
      fn(sandbox);
    } catch (e) {
      throw new Error('eval failed: ' + url + ' (' + (e && e.message) + ')');
    }
    return sandbox;
  }

  // ─────────────────────────────────────────────────────────────
  // ★ IDB parse cache (= X4 方式E・2026-05-23)
  // ─────────────────────────────────────────────────────────────
  // DB: 'daikome_parsed_cache' (= 既存 daikome_mm7 / daikome-training と・独立)
  // store: 'parsed' (keyPath='url')
  // entry: { url, version, sandbox, parsedAt }
  // version source: global.DataRegistry.VERSION (= mismatch で全 invalidate)
  // 全 例外 → graceful fallback (= 既存 fetch+eval 経路)・起動不能 リスク ゼロ
  // ─────────────────────────────────────────────────────────────
  const _IDB_NAME = 'daikome_parsed_cache';
  const _IDB_VERSION = 1;
  const _IDB_STORE = 'parsed';
  let _dbPromise = null;
  let _idbDisabled = false; // 一度 open fail したら以降 IDB skip (= performance 配慮)

  function _currentVersion() {
    try {
      if (global.DataRegistry && typeof global.DataRegistry.VERSION === 'string') {
        return global.DataRegistry.VERSION;
      }
    } catch (_) {
      // DataRegistry 未 load 等 → 'unknown' fallback
    }
    return 'unknown';
  }

  function _openCacheDb() {
    if (_idbDisabled) return Promise.resolve(null);
    if (_dbPromise) return _dbPromise;
    if (typeof indexedDB === 'undefined') {
      _idbDisabled = true;
      return Promise.resolve(null);
    }
    _dbPromise = new Promise(function (resolve) {
      try {
        const req = indexedDB.open(_IDB_NAME, _IDB_VERSION);
        req.onupgradeneeded = function (e) {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(_IDB_STORE)) {
            db.createObjectStore(_IDB_STORE, { keyPath: 'url' });
          }
        };
        req.onsuccess = function (e) {
          resolve(e.target.result);
        };
        req.onerror = function () {
          _idbDisabled = true;
          resolve(null);
        };
        req.onblocked = function () {
          _idbDisabled = true;
          resolve(null);
        };
      } catch (_) {
        _idbDisabled = true;
        resolve(null);
      }
    });
    return _dbPromise;
  }

  function _idbGet(url) {
    return _openCacheDb()
      .then(function (db) {
        if (!db) return null;
        return new Promise(function (resolve) {
          try {
            const tx = db.transaction(_IDB_STORE, 'readonly');
            const req = tx.objectStore(_IDB_STORE).get(url);
            req.onsuccess = function () {
              resolve(req.result || null);
            };
            req.onerror = function () {
              resolve(null);
            };
          } catch (_) {
            resolve(null);
          }
        });
      })
      .catch(function () {
        return null;
      });
  }

  function _idbPut(url, version, sandbox) {
    // fire-and-forget: 失敗しても起動継続 (= silent skip)
    return _openCacheDb()
      .then(function (db) {
        if (!db) return;
        return new Promise(function (resolve) {
          try {
            const tx = db.transaction(_IDB_STORE, 'readwrite');
            const store = tx.objectStore(_IDB_STORE);
            // structured clone 不可型 (= Function / DOM 等) は put が・例外
            // → catch で・silent skip・既存 fetch+eval は・既に成功してる
            const entry = { url: url, version: version, sandbox: sandbox, parsedAt: Date.now() };
            const req = store.put(entry);
            req.onsuccess = function () {
              resolve();
            };
            req.onerror = function () {
              // quota 超過 / clone 不可 → silent skip
              resolve();
            };
            tx.onerror = function () {
              resolve();
            };
            tx.onabort = function () {
              resolve();
            };
          } catch (_) {
            // synchronous DOMException (= structured clone fail 等)
            resolve();
          }
        });
      })
      .catch(function () {});
  }

  // version mismatch 検出時の全削除 (= store clear・rare path)
  function _idbClear() {
    return _openCacheDb()
      .then(function (db) {
        if (!db) return;
        return new Promise(function (resolve) {
          try {
            const tx = db.transaction(_IDB_STORE, 'readwrite');
            const req = tx.objectStore(_IDB_STORE).clear();
            req.onsuccess = function () {
              resolve();
            };
            req.onerror = function () {
              resolve();
            };
          } catch (_) {
            resolve();
          }
        });
      })
      .catch(function () {});
  }

  let _versionMismatchHandled = false;

  // ★設計変更宣言 (2026-05-23・X4 方式E・loadFromCache に IDB cache + 計測 hook 統合):
  //   1. IDB lookup → hit なら sandbox 即返却 (= eval skip・~30-200ms 削減/url)
  //   2. miss / version mismatch / IDB fail → 既存 fetch+eval 経路 (= graceful fallback)
  //   3. fire-and-forget で IDB put (= 次回用)
  //   絶対ルール:
  //     ✓ window.XXX 互換 完全維持 (= sandbox 出力 1 bit 不変)
  //     ✓ distance_m / Worker B 本体・完全無関係
  //     ✓ IDB 壊れ → 既存経路 fallback (= 起動不能 リスク ゼロ)
  async function loadFromCache(url) {
    const _hasPerf = typeof performance !== 'undefined' && typeof performance.now === 'function';
    const t0 = _hasPerf ? performance.now() : 0;
    const version = _currentVersion();

    // ─── ① IDB lookup ───
    let cached = null;
    try {
      cached = await _idbGet(url);
    } catch (_) {
      cached = null;
    }
    if (cached && cached.version === version && cached.sandbox) {
      const t1 = _hasPerf ? performance.now() : 0;
      if (typeof dlog === 'function' && _hasPerf) {
        dlog('[Loader] ' + url + ' idb=hit ' + (t1 - t0).toFixed(0) + 'ms');
      }
      return cached.sandbox;
    }
    // version mismatch 検出時: 1 回だけ・store 全 clear (= invalidate)
    if (cached && cached.version !== version && !_versionMismatchHandled) {
      _versionMismatchHandled = true;
      _idbClear().catch(function () {});
      if (typeof dlog === 'function') {
        dlog(
          '[Loader] IDB version mismatch ' + cached.version + ' != ' + version + ' → store cleared'
        );
      }
    }

    // ─── ② miss / mismatch → 既存 fetch+eval 経路 ───
    const tFetch0 = _hasPerf ? performance.now() : 0;
    const text = await _fetchAsText(url);
    const tFetch1 = _hasPerf ? performance.now() : 0;
    const sandbox = _evalText(text, url);
    const tEval = _hasPerf ? performance.now() : 0;
    if (typeof dlog === 'function' && _hasPerf) {
      dlog(
        '[Loader] ' +
          url +
          ' idb=miss fetch=' +
          (tFetch1 - tFetch0).toFixed(0) +
          'ms parse=' +
          (tEval - tFetch1).toFixed(0) +
          'ms size=' +
          text.length
      );
    }

    // ─── ③ fire-and-forget で IDB put (= 次回用・失敗しても起動継続) ───
    _idbPut(url, version, sandbox).catch(function () {});

    return sandbox;
  }

  const api = {
    loadFromCache,
    // 内部 helper (= test 用 export・本番動作には影響なし)
    _openCacheDb,
    _idbGet,
    _idbPut,
    _idbClear,
    _currentVersion,
  };
  global.DataLoader = api;
})(
  typeof window !== 'undefined'
    ? window
    : typeof self !== 'undefined'
      ? self
      : typeof globalThis !== 'undefined'
        ? globalThis
        : this
);
