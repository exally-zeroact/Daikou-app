// ============================================================
// js/dk-session.js
// ★ダイコメ 会社向け画面の共通土台（ログインの持ち回り）2026-08-01★
//
//   管理画面 / 売上表 / 給料明細 / 月次集計 を **同じログイン・同じ扱い**で作るための部品。
//   これを共通にしておくと、最後に管理画面へまとめる時に「繋ぐだけ」で済む。
//   （バラバラに書くと、まとめる時に全部書き直しになる）
//
//   ▼ダイコメのログインは「メールのマジックリンク」
//     メール+パスワードの exally-login.js とは別物。混ぜると同じ人が別扱いになるので寄せない。
//     保存キーは管理画面と同じ `dk_dash_sess`＝一度ログインすれば全画面で使える。
//
//   ▼絶対に守ること
//     ・throw しない（画面が真っ白にならない）
//     ・壊れた保存値でログイン状態を偽らない（勝手に「ログイン済み」にしない）
//     ・期限切れ/期限間近は必ず更新してから使う
// ============================================================
(function (global) {
  'use strict';

  const KEY = 'dk_dash_sess'; // ★管理画面と同じキー＝ログインを共有する★
  const SKEW_SEC = 60; // 期限の何秒前から更新するか（開いた直後に切れるのを防ぐ）

  let _storeOverride = null; // テスト用

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
    if (_storeOverride) return _storeOverride;
    try {
      return typeof localStorage !== 'undefined' ? localStorage : global && global.localStorage;
    } catch (_) {
      return null;
    }
  }

  // ─── 純ロジック（テスト対象） ──────────────────────────

  // マジックリンクの戻り（URLの # 部分）から session を取り出す
  function parseHash(hash) {
    try {
      const h = String(hash == null ? '' : hash).replace(/^#/, '');
      if (!h) return null;
      const p = new URLSearchParams(h);
      const at = p.get('access_token');
      if (!at) return null; // トークンが無ければログインしたことにしない
      const now = Math.floor(Date.now() / 1000);
      let exp = parseInt(p.get('expires_at') || '0', 10);
      if (!exp) exp = now + (parseInt(p.get('expires_in') || '3600', 10) || 3600);
      return {
        access_token: at,
        refresh_token: p.get('refresh_token') || '',
        expires_at: exp,
      };
    } catch (_) {
      return null;
    }
  }

  // 更新が要るか。★分からない/壊れている時は「要更新」に倒す（使えると偽らない）★
  function needsRefresh(sess, nowSec) {
    try {
      if (!sess || typeof sess !== 'object') return true;
      if (!sess.access_token) return true;
      const exp = Number(sess.expires_at);
      if (!isFinite(exp) || exp <= 0) return true;
      const now = isFinite(Number(nowSec)) ? Number(nowSec) : Math.floor(Date.now() / 1000);
      return exp - SKEW_SEC <= now;
    } catch (_) {
      return true;
    }
  }

  // ─── 保存 ───────────────────────────────────────────

  function save(s) {
    try {
      const ls = _ls();
      if (ls) ls.setItem(KEY, JSON.stringify(s));
    } catch (_) {
      /* ignore */
    }
  }
  function load() {
    try {
      const ls = _ls();
      if (!ls) return null;
      const raw = ls.getItem(KEY);
      if (!raw) return null;
      const v = JSON.parse(raw);
      if (!v || typeof v !== 'object' || !v.access_token) return null;
      return v;
    } catch (_) {
      return null; // 壊れていたらログインしていない扱い
    }
  }
  function clear() {
    try {
      const ls = _ls();
      if (ls) ls.removeItem(KEY);
    } catch (_) {
      /* ignore */
    }
  }

  // ─── 通信 ───────────────────────────────────────────

  // ★更新は一度に1つだけ★（司さん「毎回ログインはどうにかならんのかね？」2026-08-01）
  //   管理画面とタブの中の画面が同時に更新しに行くと、片方が使った refresh_token が
  //   無効になって もう片方が弾かれる＝ログイン画面に飛ばされる。
  //   ・同じページの中 … 走っている約束を使い回す
  //   ・別のフレーム/タブ … 鍵(localStorage)を置いて、終わるのを待って保存済みを読む
  let _inflight = null;
  const LOCK = 'dk_dash_refresh';
  const LOCK_MS = 8000;

  function _lockHeld() {
    try {
      const ls = _ls();
      if (!ls) return false;
      const t = parseInt(ls.getItem(LOCK) || '0', 10);
      return isFinite(t) && Date.now() - t < LOCK_MS;
    } catch (_) {
      return false;
    }
  }
  function _lockTake() {
    try {
      const ls = _ls();
      if (ls) ls.setItem(LOCK, String(Date.now()));
    } catch (_) {
      /* ignore */
    }
  }
  function _lockFree() {
    try {
      const ls = _ls();
      if (ls) ls.removeItem(LOCK);
    } catch (_) {
      /* ignore */
    }
  }
  function _wait(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  // 更新する。返り値:
  //   session … 成功
  //   null    … ★本当にログインが切れた★（サーバーが「その鍵は無効」と言った）
  //   'net'   … 通信できなかっただけ（★ログアウトさせない★）
  function refresh(sess) {
    const cfg = _cfg();
    if (!cfg || !sess || !sess.refresh_token) return Promise.resolve(null);
    if (_inflight) return _inflight;
    _lockTake();
    _inflight = fetch(cfg.SB_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: cfg.ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: sess.refresh_token }),
    })
      .then(function (r) {
        if (r.ok) return r.json();
        // 400/401 = 鍵が無効（本当に切れた）。それ以外(5xx)は通信不調あつかい。
        if (r.status === 400 || r.status === 401 || r.status === 403) return null;
        return 'net';
      })
      .then(function (j) {
        if (j === 'net') return 'net';
        if (!j || !j.access_token) return null;
        const now = Math.floor(Date.now() / 1000);
        const ns = {
          access_token: j.access_token,
          refresh_token: j.refresh_token || sess.refresh_token,
          expires_at: j.expires_at || now + (j.expires_in || 3600),
        };
        save(ns);
        return ns;
      })
      .catch(function () {
        return 'net'; // ★繋がらなかっただけ。ログアウトさせない★
      })
      .then(function (out) {
        _inflight = null;
        _lockFree();
        return out;
      });
    return _inflight;
  }

  // 使える session を用意する。
  //   返り値: session … 使える / null … ログインが要る
  //   ★通信できなかっただけの時は、保存してある session をそのまま返す★
  //     （ここで null を返すとログイン画面に飛ばされてしまう）
  function ensure() {
    try {
      // マジックリンクで戻ってきた直後なら # から拾って保存し、URLを綺麗にする
      let fromHash = null;
      try {
        fromHash = parseHash(global && global.location ? global.location.hash : '');
      } catch (_) {
        fromHash = null;
      }
      if (fromHash) {
        save(fromHash);
        try {
          global.history.replaceState(null, '', global.location.pathname + global.location.search);
        } catch (_) {
          /* ignore */
        }
      }
      const s = load();
      if (!s) return Promise.resolve(null);
      if (!needsRefresh(s)) return Promise.resolve(s);

      // 別のフレーム/タブが更新中なら、それを待って保存済みを読む（取り合いを避ける）
      if (!_inflight && _lockHeld()) {
        return _wait(600).then(function () {
          const again = load();
          if (again && !needsRefresh(again)) return again;
          return refresh(again || s).then(function (out) {
            return out === 'net' ? again || s : out;
          });
        });
      }

      return refresh(s).then(function (out) {
        if (out === 'net') return s; // 繋がらないだけ。ログインは切らない
        return out;
      });
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  // ログイン画面へ送る
  function goLogin() {
    try {
      global.location.replace('login.html');
    } catch (_) {
      /* ignore */
    }
  }

  // ログイン中の人として REST を叩く（RLSが効く＝自分の会社の分だけ返る）
  function rest(sess, pathAndQuery, opts) {
    const cfg = _cfg();
    if (!cfg) return Promise.reject(new Error('no_config'));
    opts = opts || {};
    const h = {
      apikey: cfg.ANON_KEY,
      Authorization: 'Bearer ' + (sess && sess.access_token ? sess.access_token : cfg.ANON_KEY),
      'Content-Type': 'application/json',
    };
    if (opts.headers) for (const k in opts.headers) h[k] = opts.headers[k];
    opts.headers = h;
    return fetch(cfg.rest(pathAndQuery), opts);
  }

  function logout() {
    clear();
    goLogin();
  }

  const api = {
    KEY: KEY,
    SKEW_SEC: SKEW_SEC,
    // 純ロジック
    parseHash: parseHash,
    needsRefresh: needsRefresh,
    // 保存
    save: save,
    load: load,
    clear: clear,
    // 実行
    refresh: refresh,
    ensure: ensure,
    rest: rest,
    goLogin: goLogin,
    logout: logout,
    // ★通信の失敗でログアウトさせないための判定★
    //   本当にログインが切れたのは、サーバーが 401/403 と言った時だけ。
    //   通信できなかった・500だった、では絶対にログアウトさせない。
    isAuthError: function (res) {
      try {
        if (!res) return false; // 通信できなかった = 切れていない
        return res.status === 401 || res.status === 403;
      } catch (_) {
        return false;
      }
    },
    // テスト用
    _setStore: function (s) {
      _storeOverride = s;
    },
    _resetLock: function () {
      _inflight = null;
      _lockFree();
    },
  };

  if (global) global.DKSession = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
