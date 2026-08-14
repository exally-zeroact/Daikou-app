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

  // ★自分の会社だけを、決まった順で取る (2026-08-08)★
  //
  //   ★なぜ要るか（司さんの申告2件の真因）★
  //     「給料が手で入力できない」「台数が使っているのに0」は、事務所の画面が
  //     ★別の会社(検証ゴミ)★ を表示していたため。各画面が /dk_companies を
  //     ★並び順の指定なし★ で取り、★返ってきた最初の1件★ を無条件に採っていた。
  //     2026-08-07 に司さんを dk_admins に入れた結果、RLS の is_dk_admin() で
  //     ★11社 全部が見える★ようになり、一番古い検証ゴミが先頭で返っていた。
  //     書き込みの条件は owner_id = 自分 なので、その会社には保存できない。
  //
  //   ★4つの画面(dashboard / kyuryo / uriage / shukei)が同じ形で間違えていた★ので、
  //   ここに1つだけ置いて、全部そこを通す（また兄弟の食い違いを作らないため）。

  // ログインの証(JWT)から 自分のid(sub)を読む。読めなければ null。
  function uidOf(sess) {
    try {
      const t = sess && sess.access_token;
      if (!t || typeof t !== 'string') return null;
      const p = t.split('.')[1];
      if (!p) return null;
      const b = p.replace(/-/g, '+').replace(/_/g, '/');
      const pad = b + '='.repeat((4 - (b.length % 4)) % 4);
      const raw =
        typeof atob === 'function'
          ? atob(pad)
          : /* eslint-disable-next-line no-undef */ Buffer.from(pad, 'base64').toString('utf8');
      const o = JSON.parse(raw);
      return o && typeof o.sub === 'string' && o.sub ? o.sub : null;
    } catch (_) {
      return null;
    }
  }

  // ★自分が持ち主の会社だけ★ を ★必ず同じ順★ で取る問い合わせ文。
  //   limit=1 は使わない（何件あるか分からなくなり、2件目の存在に気づけないため）。
  //   ★2026-08-08 追記: uid が読めない時は「問い合わせ自体をしない」★
  //     絞りだけ外して取ると、dk_admins に入っている人には ★全社が返る★。
  //     検証ゴミが選択画面に並び、そこで1つ選ぶと覚えてしまい ★元の事故に戻る★。
  //     ＝「取れなかった」を「0件」や「全部」として扱わない。まだ分からない、と言う。
  function myCompaniesQuery(sess, select) {
    const uid = uidOf(sess);
    if (!uid) return null; // ★誰か分からないなら聞きに行かない★
    const cols = select || 'company_id,name,url_token,seat_limit,status';
    return (
      'dk_companies?select=' + cols + '&order=created_at.asc&owner_id=eq.' + encodeURIComponent(uid)
    );
  }

  // 返り値は fetch の結果と同じ形。ただし uid が無い時は
  // ★通信に行かず { ok:false, noUid:true } を返す★（呼ぶ側は「読み込み中」のままにする）。
  function myCompanies(sess, select) {
    const q = myCompaniesQuery(sess, select);
    if (!q) return Promise.resolve({ ok: false, noUid: true, status: 0 });
    return rest(sess, q);
  }

  // ★黙って先頭を選ばない★
  //   0件 → 登録へ / 1件 → そのまま / 2件以上 → 選ばせる
  //   前に選んだ会社(rememberedId)が今の一覧にあれば、それを使う。
  function pickCompany(list, rememberedId) {
    const arr = Array.isArray(list) ? list.filter((x) => x && x.company_id) : [];
    if (arr.length === 0) return { mode: 'none', company: null, list: [] };
    if (arr.length === 1) return { mode: 'one', company: arr[0], list: arr };
    if (rememberedId) {
      const hit = arr.filter((x) => String(x.company_id) === String(rememberedId))[0];
      if (hit) return { mode: 'one', company: hit, list: arr };
    }
    return { mode: 'choose', company: null, list: arr };
  }

  const REMEMBER_KEY = 'dk_office_company';
  function rememberedCompanyId() {
    try {
      return _ls() ? _ls().getItem(REMEMBER_KEY) : null;
    } catch (_) {
      return null;
    }
  }
  function rememberCompany(id) {
    try {
      if (_ls()) _ls().setItem(REMEMBER_KEY, String(id));
    } catch (_) {
      /* 覚えられなくても使えるので止めない */
    }
  }

  // ★「取れなかった」を 0 や 空 として出さない (2026-08-09)★
  //
  //   ★なぜ要るか★ 司さんの「台数が使いよんのに0になっとる」を追う中で、
  //     ★通信が失敗しても 空配列にして、画面には 0 と書く★ 形が 21箇所あった
  //     （dashboard 3 / kyuryo 9 / shukei 9・元は soft() と loadDevices）。
  //     ＝「本当に0台」と「取れなかった」が ★画面で見分けられない★。
  //   ★決めた形★ 取れなかったことを数え、画面には ★0でも空でもなく「—」★ を出し、
  //     ★「もう一度読む」★ を添える。1本でも失敗したら その画面の数字は信じない。
  const UNKNOWN_TEXT = '—';

  // 1回の読み込みで「何本 取れなかったか」を覚える箱
  function newLoadState() {
    return { failed: 0, tried: 0 };
  }
  function loadFailed(st) {
    return !!(st && st.failed > 0);
  }

  // 一覧を取る。★落ちないように空は返すが、失敗は必ず数える★
  function softList(sess, pathAndQuery, st) {
    if (st) st.tried++;
    return rest(sess, pathAndQuery)
      .then(function (r) {
        if (r && r.ok) return r.json();
        if (st) st.failed++;
        return [];
      })
      .catch(function () {
        if (st) st.failed++;
        return [];
      });
  }

  // 数字を画面に出す時の言い方。★取れていなければ「—」★
  function numOrUnknown(v, st) {
    if (loadFailed(st)) return UNKNOWN_TEXT;
    return String(v == null ? UNKNOWN_TEXT : v);
  }

  // ★取れなかったことを 画面の上に出す（0件の時は何も出さない＝お節介にしない）★
  //   「失敗」「エラー」とは書かない。何が起きたかと、次にできる事だけ書く。
  function showUnknownBar(st, onRetry) {
    try {
      if (!global || !global.document) return;
      const id = 'dkUnknownBar';
      let el = global.document.getElementById(id);
      if (!loadFailed(st)) {
        if (el) el.style.display = 'none';
        return;
      }
      if (!el) {
        el = global.document.createElement('div');
        el.id = id;
        el.style.cssText =
          'position:sticky;top:0;z-index:50;margin:0 0 8px;padding:10px 12px;' +
          'background:#fff8e1;border:1px solid #ffd666;border-radius:10px;' +
          'font-size:13px;color:#8a6d00;display:flex;gap:10px;align-items:center';
        const span = global.document.createElement('span');
        span.id = id + 'Msg';
        span.style.cssText = 'flex:1';
        const btn = global.document.createElement('button');
        btn.type = 'button';
        btn.id = id + 'Btn';
        btn.textContent = 'もう一度読む';
        btn.style.cssText =
          'padding:6px 12px;border-radius:8px;border:1px solid #cfe0ff;' +
          'background:#fff;color:#0b57d0;font-weight:700;font-size:13px';
        el.appendChild(span);
        el.appendChild(btn);
        const host = global.document.querySelector('.wrap') || global.document.body;
        host.insertBefore(el, host.firstChild);
      }
      el.style.display = 'flex';
      const msg = global.document.getElementById(id + 'Msg');
      if (msg)
        msg.textContent =
          'いま読めなかった物があります（' +
          st.failed +
          '件）。数字は「' +
          UNKNOWN_TEXT +
          '」で出しています。';
      const b = global.document.getElementById(id + 'Btn');
      if (b && typeof onRetry === 'function') b.onclick = onRetry;
    } catch (_) {
      /* 出せなくても業務は止めない */
    }
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
    // ★「取れなかった」を 0/空 として出さないための道具★
    UNKNOWN_TEXT: UNKNOWN_TEXT,
    newLoadState: newLoadState,
    loadFailed: loadFailed,
    softList: softList,
    numOrUnknown: numOrUnknown,
    showUnknownBar: showUnknownBar,
    // ★会社の選び方（4画面で共有）★
    uidOf: uidOf,
    myCompaniesQuery: myCompaniesQuery,
    myCompanies: myCompanies,
    pickCompany: pickCompany,
    rememberedCompanyId: rememberedCompanyId,
    rememberCompany: rememberCompany,
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
