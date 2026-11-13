// ============================================================
// js/keiyu-kiroku.js  ★経由を押した前後30秒の記録（端末の中だけ）★ 2026-11-13
//
// ▼なぜ在るか
//   司さん 11/11「OBD が繋がらない日（Android・GPS だけ）に、普通の道で経由を押したら距離が増えた」。
//   手元の再現は0（止まり2か所で 押す/押さない/押す＋揺れ が全部同じ距離）。
//   ⇒ 原因を数で決めるために、★次に起きた時の 押した前後30秒★ を端末に残す。
//   取り出し＝shindan.html（端末の中身をみる）の「経由の前後の記録」からコピーして貼る。
//
// ▼絶対に守る事
//   ・距離・料金は ★1バイトも触らない★（gps.js / meter.js / map-matcher.js / pipeline-distance.js /
//     gps-worker.js / business.js / fare-calc.js は読みもしない・呼ばれた値を写すだけ）。
//   ・throw しない（呼び出し側も try/catch で包む）。
//   ・★位置（lat/lng）・住所・snap は入れない★（客の行き先を端末の記録に残さない）。
//   ・網に出さない（送りは0）。Firebase は使わない。
//   ・置き場は IndexedDB 'daikome-keiyu'（localStorage は業務の保存・送っていない勤務と取り合う）。
//     最大10件・14日より古い物は消す・書けない時は黙って捨てる。
//
// ▼何を取るか（設計 C:/Users/zeroa/sekkei_keiyu_kiroku_2026-11-13.md の v1）
//   k:'g' GPS のコールバックごと＝着いた時刻 t（performance.now）・g.timestamp(ts)・速度・速度の出どころ・
//         acc・合成点(syn)・停車(stat)・distance_m・business_distance_m・fare_yen・distanceSource・
//         appState・画面の見え(vis)・OBD の繋がり・加速度の分散(av)と件数(an)と凍る見立て(zupt)
//   k:'m' mmWorker の mmResult ごと＝pipelineDeltaM・pipelineDeltaSrc・isStationary・_reason・mienai・
//         committed/snapped/skipped（★距離の増えが入る所★）
//   k:'e' 画面の出来事＝visibilitychange / pagehide / pageshow
//   marks 経由を押した時刻と、押した処理にかかった長さ（ms）
//   加速度は gps.js の ZUPT と同じ値（窓3000ms・閾値0.1・5点以上・accelerationIncludingGravity・
//   合成でない点が来るたびに箱を空にする）で近似する。★見立てを残すだけ・判定には使わない★。
//   ★gps.js と同じではない★（gps.js は業務中だけ溜め・最大200点・間引きの時は空にしない）＝zupt は見立ての値。
// ============================================================
(function (global) {
  'use strict';

  const PRE_MS = 30000; // 押す前に持つ長さ
  const POST_MS = 30000; // 押した後に集める長さ
  const MAX_PTS = 800; // 1つの箱に持つ最大の点（30秒で GPS 1Hz＋合成 150ms tick＋mmResult でも収まる）
  const MAX_REC = 10; // 端末に残す件数
  const MAX_AGE_MS = 14 * 24 * 3600 * 1000; // 14日より古い件は消す
  const Z_WIN_MS = 3000; // gps.js CONFIG.accel_variance_window_ms と同じ
  const Z_TH = 0.1; // gps.js CONFIG.accel_variance_threshold と同じ
  const Z_MIN = 5; // gps.js CONFIG.accel_variance_min_samples と同じ
  const BACK_MS = 10000; // 表へ戻ってから同じ件に足す長さ
  const MAX_ACCEL = 600; // 加速度の箱の上限（GPS が長く来ない時に膨らませない）

  function _num(v) {
    return typeof v === 'number' && isFinite(v) ? v : null;
  }
  function _r1(v) {
    const n = _num(v);
    return n == null ? null : Math.round(n * 10) / 10;
  }

  // ─── 中身（時計と書き先を差し込める・単体試験の対象） ───
  function createKiroku(opts) {
    opts = opts || {};
    const now =
      typeof opts.now === 'function'
        ? opts.now
        : function () {
            return typeof performance !== 'undefined' && performance.now
              ? performance.now()
              : Date.now();
          };
    const wall = typeof opts.wall === 'function' ? opts.wall : Date.now;
    const save = typeof opts.save === 'function' ? opts.save : function () {};

    const ring = []; // 直近 PRE_MS の出来事
    let accel = []; // 前の実点からの加速度
    let cur = null; // 集めている途中の記録

    function _push(ev) {
      ring.push(ev);
      const lim = ev.t - PRE_MS;
      while (ring.length && (ring[0].t < lim || ring.length > MAX_PTS)) ring.shift();
      if (cur) {
        cur.post.push(ev);
        if (cur.post.length > MAX_PTS) {
          cur.post.shift();
          cur.cut = (cur.cut || 0) + 1;
        }
      }
    }

    function _accelVar(t) {
      const recent = accel.filter(function (s) {
        return t - s.t < Z_WIN_MS;
      });
      if (recent.length < Z_MIN) return { av: null, an: recent.length };
      const mags = recent.map(function (s) {
        return Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
      });
      const mean =
        mags.reduce(function (a, b) {
          return a + b;
        }, 0) / mags.length;
      const v =
        mags.reduce(function (sum, m) {
          return sum + (m - mean) * (m - mean);
        }, 0) / mags.length;
      return { av: v, an: recent.length };
    }

    function _check() {
      if (cur && now() >= cur.until) _close(false);
    }

    function _close(partial) {
      const c = cur;
      cur = null;
      if (!c) return null;
      const rec = build(c, partial);
      try {
        save(rec);
      } catch (_) {
        /* 書けない時は黙って捨てる */
      }
      return rec;
    }

    function onMotion(x, y, z) {
      try {
        if (_num(x) == null || _num(y) == null || _num(z) == null) return;
        accel.push({ t: now(), x: x, y: y, z: z });
        if (accel.length > MAX_ACCEL) accel.splice(0, accel.length - MAX_ACCEL);
      } catch (_) {}
    }

    function feed(g, ms, appState, obd) {
      try {
        if (!g) return;
        const t = now();
        const zv = _accelVar(t);
        const syn = g.isSynthetic ? 1 : 0;
        const st = ms || {};
        _push({
          k: 'g',
          t: t,
          ts: _num(g.timestamp),
          spd: _r1(g.speedKmh != null ? g.speedKmh : g.speed_kmh),
          src: typeof g.speedSrc === 'string' ? g.speedSrc : null,
          acc: _r1(g.accuracy),
          syn: syn,
          hint: g.stopHint ? 1 : 0, // 止まった印（この合成点の距離は 0 にした）
          stat: g.isStationary ? 1 : 0,
          dist: _r1(st.distance_m),
          ddist: _r1(st.display_distance_m), // 客が見るメーターの表示距離（表示の側だけの増えも残す）
          bdist: _r1(st.business_distance_m),
          fare: _num(st.fare_yen),
          dsrc: typeof st.distanceSource === 'string' ? st.distanceSource : null,
          app: typeof appState === 'string' ? appState : null,
          vis:
            typeof document !== 'undefined' && document.visibilityState
              ? document.visibilityState
              : null,
          obd: obd == null ? null : obd ? 1 : 0,
          av: zv.av == null ? null : Math.round(zv.av * 10000) / 10000,
          an: zv.an,
          zupt: zv.av == null ? null : zv.av < Z_TH ? 1 : 0,
        });
        // gps.js は実点（onPosition）が来るたびに加速度の箱を空にする（gps.js 693）＝同じにする
        if (!syn) accel = [];
        _check();
      } catch (_) {}
    }

    function mm(m) {
      try {
        if (!m || m.type !== 'mmResult') return;
        // ★m.snap・lat/lng は入れない★
        _push({
          k: 'm',
          t: now(),
          d: _r1(m.pipelineDeltaM),
          ds: typeof m.pipelineDeltaSrc === 'string' ? m.pipelineDeltaSrc : null,
          st: m.isStationary == null ? null : m.isStationary ? 1 : 0,
          r: typeof m._reason === 'string' ? m._reason.slice(0, 40) : null,
          mi: _r1(m.mienai),
          f: m.committed ? 'C' : m.snapped ? 's' : m.skipped ? 'X' : '-',
        });
        _check();
      } catch (_) {}
    }

    function event(name) {
      try {
        _push({ k: 'e', t: now(), n: String(name).slice(0, 20) });
        if (!cur) return;
        // 閉じられそうな時は、そこまでを一度書く（途中の印つき）。★閉じずに集め続ける★＝
        //   表へ戻った時にまとめて来る mmResult（穴埋めで距離が跳ぶ所）も同じ件に入れて、閉じる時に書き直す。
        if (name === 'pagehide' || name === 'hidden') {
          try {
            save(build(cur, true));
          } catch (_) {}
        }
        // 表へ戻ったら、戻ってから10秒は同じ件に足す
        if (name === 'visible' || name === 'pageshow')
          cur.until = Math.max(cur.until, now() + BACK_MS);
      } catch (_) {}
    }

    // 経由を押した時。押している途中でもう1回押したら、前の記録を閉じずに後ろを延ばす。
    function mark() {
      try {
        const t = now();
        if (cur) {
          cur.marks.push({ t: t, ms: null });
          cur.until = t + POST_MS;
          return;
        }
        cur = {
          at: wall(),
          t0: t,
          marks: [{ t: t, ms: null }],
          pre: ring.filter(function (e) {
            return e.t >= t - PRE_MS;
          }),
          post: [],
          until: t + POST_MS,
        };
      } catch (_) {}
    }

    // 押した処理の尾。最後の印に長さ（ms）を付ける。
    function markEnd() {
      try {
        if (!cur || !cur.marks.length) return;
        const mk = cur.marks[cur.marks.length - 1];
        if (mk.ms == null) mk.ms = Math.round(now() - mk.t);
      } catch (_) {}
    }

    return {
      onMotion: onMotion,
      feed: feed,
      mm: mm,
      event: event,
      mark: mark,
      markEnd: markEnd,
      tick: _check,
      flush: function () {
        return _close(true);
      },
      _peek: function () {
        return { ring: ring.slice(), cur: cur };
      },
    };
  }

  // 記録の形を作る（時刻は 最初に押した時を0とする ms）
  function build(c, partial) {
    const t0 = c.t0;
    function rel(ev) {
      const o = {};
      for (const k in ev) o[k] = ev[k];
      o.t = Math.round(ev.t - t0);
      return o;
    }
    const pre = c.pre.map(rel);
    const post = c.post.map(rel);
    const all = pre.concat(post);
    const gs = all.filter(function (e) {
      return e.k === 'g';
    });
    // 押した時の距離＝押す前の最後の点
    function lastDist(arr) {
      for (let i = arr.length - 1; i >= 0; i--)
        if (arr[i].k === 'g' && arr[i].dist != null) return arr[i].dist;
      return null;
    }
    function firstDist(arr) {
      for (let i = 0; i < arr.length; i++)
        if (arr[i].k === 'g' && arr[i].dist != null) return arr[i].dist;
      return null;
    }
    const dPre0 = firstDist(pre);
    const dAt = lastDist(pre);
    const dEnd = lastDist(post);
    // 実点（合成でない GPS）どうしの最長の空き
    let maxGap = null;
    let prevT = null;
    gs.forEach(function (e) {
      if (e.syn) return;
      if (prevT != null) {
        const gap = e.t - prevT;
        if (maxGap == null || gap > maxGap) maxGap = gap;
      }
      prevT = e.t;
    });
    let mmPost = 0;
    post.forEach(function (e) {
      if (e.k === 'm' && typeof e.d === 'number') mmPost += e.d;
    });
    const ua = typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : '';
    return {
      v: 1,
      at: c.at,
      partial: partial ? 1 : 0,
      cut: c.cut || 0,
      os: /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : 'other',
      marks: c.marks.map(function (m) {
        return { t: Math.round(m.t - t0), ms: m.ms };
      }),
      sum: {
        preIncM: dPre0 != null && dAt != null ? Math.round((dAt - dPre0) * 10) / 10 : null,
        postIncM: dAt != null && dEnd != null ? Math.round((dEnd - dAt) * 10) / 10 : null,
        mmPostM: Math.round(mmPost * 10) / 10,
        synPost: post.filter(function (e) {
          return e.k === 'g' && e.syn;
        }).length,
        maxGapMs: maxGap == null ? null : Math.round(maxGap),
        maxMarkMs: c.marks.reduce(function (a, m) {
          return m.ms != null && (a == null || m.ms > a) ? m.ms : a;
        }, null),
      },
      pre: pre,
      post: post,
    };
  }

  // ─── 置き場（IndexedDB・ブラウザだけ） ───
  const IDB_NAME = 'daikome-keiyu';
  const IDB_STORE = 'kiroku';
  function _openDb() {
    return new Promise(function (resolve, reject) {
      try {
        const req = global.indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = function () {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE, { keyPath: 'at' });
          }
        };
        req.onsuccess = function () {
          resolve(req.result);
        };
        req.onerror = function () {
          reject(req.error);
        };
      } catch (e) {
        reject(e);
      }
    });
  }
  function saveToIdb(rec) {
    if (!global.indexedDB) return;
    _openDb()
      .then(function (db) {
        try {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          const st = tx.objectStore(IDB_STORE);
          st.put(rec); // 同じ件（at）は書き直す
          const all = st.getAll();
          all.onsuccess = function () {
            const list = (all.result || []).slice().sort(function (a, b) {
              return a.at - b.at;
            });
            const lim = Date.now() - MAX_AGE_MS;
            const over = Math.max(0, list.length - MAX_REC);
            list.forEach(function (r, i) {
              if (i < over || (typeof r.at === 'number' && r.at < lim)) st.delete(r.at);
            });
          };
          tx.oncomplete = function () {
            db.close();
          };
          tx.onerror = function () {
            db.close();
          };
        } catch (_) {
          try {
            db.close();
          } catch (__) {}
        }
      })
      .catch(function () {
        /* 黙って捨てる */
      });
  }

  // ─── 画面に付ける ───
  const api = {
    createKiroku: createKiroku,
    build: build,
    IDB_NAME: IDB_NAME,
    IDB_STORE: IDB_STORE,
  };
  if (typeof window !== 'undefined' && global === window) {
    const k = createKiroku({ save: saveToIdb });
    const attached = typeof WeakSet === 'function' ? new WeakSet() : null;
    api.feed = k.feed;
    api.mm = k.mm;
    api.mark = k.mark;
    api.markEnd = k.markEnd;
    api.flush = k.flush;
    // mmWorker が作り直されるたびに呼ばれる（同じ worker に2回付けない）
    api.attachMm = function (w) {
      try {
        if (!w || typeof w.addEventListener !== 'function') return;
        if (attached) {
          if (attached.has(w)) return;
          attached.add(w);
        }
        w.addEventListener('message', function (ev) {
          k.mm(ev && ev.data);
        });
      } catch (_) {}
    };
    try {
      window.addEventListener(
        'devicemotion',
        function (e) {
          const a = e && e.accelerationIncludingGravity;
          if (a) k.onMotion(a.x, a.y, a.z);
        },
        { passive: true }
      );
      document.addEventListener('visibilitychange', function () {
        k.event(document.visibilityState);
      });
      window.addEventListener('pagehide', function () {
        k.event('pagehide');
      });
      window.addEventListener('pageshow', function () {
        k.event('pageshow');
      });
      setInterval(k.tick, 1000);
    } catch (_) {}
  }
  global.KeiyuKiroku = api;
  // eslint-disable-next-line no-undef
  if (typeof module !== 'undefined' && module.exports) {
    // eslint-disable-next-line no-undef
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
