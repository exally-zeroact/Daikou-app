// ============================================================
// js/trace-outbox.js  (ダイコメ trace/log オフライン永続送信キュー・2026-06-16)
//
// ★目的★: console_log(debug-log-uploader=ABS輪速データ) と GPS trace(debug-trace) の送信を、
//   ★RAMでなく IndexedDB に永続化★する送信待ち箱(outbox)。オフライン走行→アプリ閉じても消えず、
//   次にオンラインになった時 or 次回起動時に自動で全部送る(取りこぼしゼロ)。完全オフライン前提に対応。
//
// ★限界(正直)★: Web は完全に閉じてる間は送信不可(背景送信は Background Sync API が要る=将来)。
//   本モジュールは「閉じても消えない+開いた時/オンライン時に自動排出」までを保証する。
//
// ★絶対ルール準拠★: 距離コア(distance_m/calcFare/pipeline-distance/gps.js/map-matcher/Worker B)に
//   一切依存しない・触らない。trace/log の送信経路だけを永続化する独立部品。
//
// 設計:
//   ・両uploaderは body({meta,samples,writeKey}) を submit(body) で渡すだけ。
//   ・submit = outbox.enqueue(IndexedDB永続) → trim(容量/期間ガード) → online なら drain(POST)。
//   ・drain = 古い順に POST、成功した分だけ削除、失敗(オフライン)で停止して残す(=次回再送)。
//   ・起動時 + 'online' イベントで drainNow()。
//
// テスト容易性: createOutbox(store, opts) は store/now を注入可能。本体ロジック(drain順/成功削除/
//   失敗停止/trim)は ★in-memory store で決定論テスト★。IndexedDB glue はブラウザ専用(実機検証)。
// ============================================================
(function (global) {
  'use strict';

  const DB_URL = 'https://daikou-app-c821a-default-rtdb.asia-southeast1.firebasedatabase.app';
  const DB_PATH = '/debug_traces.json';
  const IDB_NAME = 'daikome_trace_outbox';
  const IDB_STORE = 'pending';
  const MAX_RECORDS = 400; // 永続バッチの最大保持数(超過は古い順に間引き=端末を埋めない)
  const MAX_AGE_MS = 7 * 24 * 3600 * 1000; // 7日より古い未送信は破棄

  // ─── 純粋ロジック: キュー管理(store/now 注入・単体テスト対象) ───
  function createOutbox(store, opts) {
    opts = opts || {};
    const now = typeof opts.now === 'function' ? opts.now : Date.now;
    return {
      enqueue: function (body) {
        return store.add({ body: body, ts: now(), tries: 0 });
      },
      // postFn(body) -> Promise<bool>(成功=true)。古い順に送る。
      //   ・成功 → 削除。
      //   ・失敗 かつ オフライン → 停止(全部残して次回再送)。
      //   ・失敗 かつ オンライン(=拒否/poison) → ★skipして次へ(head-of-line blocking回避)★・tries++・maxTries超で破棄。
      drain: function (postFn, opts) {
        opts = opts || {};
        const isOnline =
          typeof opts.isOnline === 'function'
            ? opts.isOnline
            : function () {
                return !(typeof navigator !== 'undefined' && navigator.onLine === false);
              };
        const maxTries = opts.maxTries != null ? opts.maxTries : 5;
        return store.getAllSorted().then(function (recs) {
          let i = 0;
          let sent = 0;
          function step() {
            if (i >= recs.length) return Promise.resolve(sent);
            const r = recs[i++];
            return Promise.resolve()
              .then(function () {
                return postFn(r.body);
              })
              .catch(function () {
                return false;
              })
              .then(function (ok) {
                if (ok) {
                  sent++;
                  return store.delete(r.id).then(step);
                }
                if (!isOnline()) return sent; // オフライン→停止・全部残す
                // オンラインなのに失敗 = 拒否/poison → tries++・上限超で破棄・skipして次へ
                return store.bump(r.id).then(function (tries) {
                  if (tries >= maxTries) return store.delete(r.id).then(step);
                  return step();
                });
              });
          }
          return step();
        });
      },
      // 容量/期間ガード: maxAgeMs より古い & maxRecords を超える古いバッチを削除。
      trim: function (maxRecords, maxAgeMs, nowMs) {
        const t = typeof nowMs === 'number' ? nowMs : now();
        return store.getAllSorted().then(function (recs) {
          const del = {};
          for (let k = 0; k < recs.length; k++) {
            if (maxAgeMs && t - recs[k].ts > maxAgeMs) del[recs[k].id] = 1;
          }
          const keep = recs.filter(function (r) {
            return !del[r.id];
          });
          if (maxRecords && keep.length > maxRecords) {
            const over = keep.slice(0, keep.length - maxRecords); // 古い側を間引き
            for (let k = 0; k < over.length; k++) del[over[k].id] = 1;
          }
          const ids = Object.keys(del);
          let i = 0;
          function step() {
            if (i >= ids.length) return Promise.resolve(ids.length);
            return store.delete(Number(ids[i++])).then(step);
          }
          return step();
        });
      },
      count: function () {
        return store.count();
      },
    };
  }

  // ─── テスト用 in-memory store(IndexedDB と同 interface) ───
  function createMemStore() {
    let seq = 0;
    const map = new Map();
    return {
      add: function (rec) {
        const id = ++seq;
        map.set(id, Object.assign({ id: id }, rec));
        return Promise.resolve(id);
      },
      getAllSorted: function () {
        return Promise.resolve(
          Array.from(map.values()).sort(function (a, b) {
            return a.id - b.id;
          })
        );
      },
      delete: function (id) {
        map.delete(id);
        return Promise.resolve();
      },
      bump: function (id) {
        const r = map.get(id);
        if (!r) return Promise.resolve(0);
        r.tries = (r.tries || 0) + 1;
        return Promise.resolve(r.tries);
      },
      count: function () {
        return Promise.resolve(map.size);
      },
    };
  }

  // ─── IndexedDB store(ブラウザ専用) ───
  function createIdbStore(dbName, storeName) {
    function openDb() {
      return new Promise(function (res, rej) {
        const req = global.indexedDB.open(dbName, 1);
        req.onupgradeneeded = function () {
          const db = req.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
          }
        };
        req.onsuccess = function () {
          res(req.result);
        };
        req.onerror = function () {
          rej(req.error);
        };
      });
    }
    function tx(mode, fn) {
      return openDb().then(function (db) {
        return new Promise(function (res, rej) {
          const t = db.transaction(storeName, mode);
          const st = t.objectStore(storeName);
          let out;
          Promise.resolve(fn(st)).then(function (v) {
            out = v;
          });
          t.oncomplete = function () {
            db.close();
            res(out);
          };
          t.onerror = function () {
            db.close();
            rej(t.error);
          };
          t.onabort = function () {
            db.close();
            rej(t.error);
          };
        });
      });
    }
    function reqP(r) {
      return new Promise(function (res, rej) {
        r.onsuccess = function () {
          res(r.result);
        };
        r.onerror = function () {
          rej(r.error);
        };
      });
    }
    return {
      add: function (rec) {
        return tx('readwrite', function (st) {
          return reqP(st.add(rec));
        });
      },
      getAllSorted: function () {
        return tx('readonly', function (st) {
          return reqP(st.getAll()).then(function (arr) {
            return (arr || []).sort(function (a, b) {
              return a.id - b.id;
            });
          });
        });
      },
      delete: function (id) {
        return tx('readwrite', function (st) {
          return reqP(st.delete(id));
        });
      },
      bump: function (id) {
        return tx('readwrite', function (st) {
          return reqP(st.get(id)).then(function (r) {
            if (!r) return 0;
            r.tries = (r.tries || 0) + 1;
            return reqP(st.put(r)).then(function () {
              return r.tries;
            });
          });
        });
      },
      count: function () {
        return tx('readonly', function (st) {
          return reqP(st.count());
        });
      },
    };
  }

  // ─── 既定 POST(両uploader共通・Firebase /debug_traces) ───
  function _post(body) {
    if (typeof fetch !== 'function') return Promise.resolve(false);
    return fetch(DB_URL + DB_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        return !!(res && res.ok);
      })
      .catch(function () {
        return false;
      });
  }

  // ─── ブラウザ singleton(IndexedDB 利用可なら永続・不可ならメモリへ退避) ───
  let _outbox = null;
  let _draining = false;
  let _persistent = true; // ★S2: 永続できてるか(false=mem退避=閉じると消える)。実機診断で気づけるよう公開★
  let _warned = false;
  function _online() {
    return !(typeof navigator !== 'undefined' && navigator.onLine === false);
  }
  function _warnNotPersistent(reason) {
    _persistent = false;
    if (_warned) return;
    _warned = true;
    try {
      // eslint-disable-next-line no-console
      console.warn(
        '[trace-outbox] NOT persistent (' + reason + ') — ログは閉じると消える(オフライン不可)'
      );
    } catch (_) {
      /* ignore */
    }
  }
  function _switchToMem(reason) {
    if (!_persistent) return;
    _outbox = createOutbox(createMemStore());
    _warnNotPersistent(reason);
  }
  function _ensure() {
    if (_outbox) return _outbox;
    const hasIdb = typeof global.indexedDB !== 'undefined' && !!global.indexedDB;
    let store;
    try {
      store = hasIdb ? createIdbStore(IDB_NAME, IDB_STORE) : createMemStore();
    } catch (_) {
      store = createMemStore();
    }
    if (!hasIdb) _warnNotPersistent('indexedDB unavailable');
    _outbox = createOutbox(store);
    return _outbox;
  }
  // uploader はこれを呼ぶだけ: 永続化→間引き→(online なら)送信
  function submit(body) {
    const ob = _ensure();
    return ob
      .enqueue(body)
      .then(function () {
        return ob.trim(MAX_RECORDS, MAX_AGE_MS);
      })
      .then(function () {
        if (_online()) return drainNow();
      })
      .catch(function () {
        /* 永続化失敗でもアプリは止めない */
      });
  }
  function drainNow() {
    if (_draining || !_online()) return Promise.resolve(0);
    _draining = true;
    return _ensure()
      .drain(_post)
      .then(
        function (n) {
          _draining = false;
          return n;
        },
        function () {
          _draining = false;
          return 0;
        }
      );
  }

  // 起動時 + オンライン復帰で自動排出
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('online', function () {
      drainNow();
    });
  }
  // 起動直後にも溜まってた未送信を排出(オンラインなら)
  try {
    if (_online()) setTimeout(drainNow, 1500);
  } catch (_) {
    /* ignore */
  }
  // ★S2: IDBが「存在しても実際に書けるか」を起動時に検証→失敗ならmem退避+警告(=「永続したつもり」黙消を防ぐ)★
  try {
    _ensure()
      .count()
      .catch(function () {
        _switchToMem('indexedDB runtime error');
      });
  } catch (_) {
    _switchToMem('indexedDB threw');
  }

  const api = {
    submit: submit,
    drainNow: drainNow,
    count: function () {
      return _ensure().count();
    },
    // ★永続できてるか(false=閉じると消える)。実機/UIで状態確認用★
    getStatus: function () {
      return { persistent: _persistent };
    },
    isPersistent: function () {
      return _persistent;
    },
    // テスト/デバッグ用
    createOutbox: createOutbox,
    createMemStore: createMemStore,
  };
  // eslint-disable-next-line no-undef
  if (typeof module !== 'undefined' && module.exports) {
    // eslint-disable-next-line no-undef
    module.exports = api;
  }
  global.DaikomeTraceOutbox = api;
})(
  typeof window !== 'undefined'
    ? window
    : typeof self !== 'undefined'
      ? self
      : typeof globalThis !== 'undefined'
        ? globalThis
        : this
);
