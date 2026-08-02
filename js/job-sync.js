// ============================================================
// js/job-sync.js
// ★メーターの実績(勤務・代行)をクラウドへ上げる層 (2026-07-31)★
//
//   事務所機能(売上 / 請求 / 給料 / 集計)の土台。これが無いと何も始まらない。
//
//   ▼設計の要点：メーター本体には一切触らない
//     業務の履歴は既に localStorage(`daikou_business_history`)に30日ぶん貯まっている。
//     このモジュールは★その貯まった物を後から読んで送るだけ★。
//     business.js も、業務の流れも、距離の計算も、1バイトも変えない。
//     → だから「送信のせいで業務が止まる」ことが原理的に起こらない。
//
//   ▼絶対に守ること
//     ・throw しない。何が起きても呼び出し元に例外を返さない。
//     ・距離と料金はメーターが確定した値をそのまま運ぶ。丸めない・補正しない・作らない。
//     ・同じ勤務を二度送らない(送れた start_time を記録)。
//     ・会社URLで活性化していない端末(自社運用・ゲートOFF)は何も送らない。
//
//   ▼限界(正直に)
//     履歴は30日で消えるので、30日以上ずっと圏外だった端末の古い勤務は上がらない。
//     (ライセンス同期が2ヶ月なので、実運用でここに当たる端末はまず無い)
// ============================================================
(function (global) {
  'use strict';

  const HISTORY_KEY = 'daikou_business_history'; // business.js が書く履歴(読むだけ)
  const K_SYNCED = 'dk_synced_shifts'; // 送信済みの勤務(start_time)の記録
  const K_COMPANY = 'dk_license_company'; // license-activate が持つ会社url_token
  const DEVICE_ID_KEY = 'DAIKOME_DEVICE_ID';

  const MAX_BATCH = 20; // 1回に送る勤務の上限
  const MAX_WAYPOINTS = 50; // 代行1件あたりの経由地の上限
  const MAX_SYNCED_KEYS = 200; // 送信済み記録の保持数(これを超えたら古い順に間引く)

  // ─── 小道具 ────────────────────────────────────────────
  function _isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }
  function _str(v) {
    return typeof v === 'string' ? v : '';
  }
  function _arr(v) {
    return Array.isArray(v) ? v : [];
  }

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
  function _getJson(k, fallback) {
    try {
      const raw = _get(k);
      if (!raw) return fallback;
      const v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (_) {
      return fallback;
    }
  }

  // ─── 純ロジック(テスト対象) ────────────────────────────

  // 勤務を識別する鍵 = 開始時刻。端末ごとの localStorage なので端末内で一意。
  function shiftKey(shift) {
    try {
      if (!shift || !_isNum(shift.start_time) || shift.start_time <= 0) return null;
      return String(shift.start_time);
    } catch (_) {
      return null;
    }
  }

  // まだ送っていない勤務を、古い順に、上限まで選ぶ。壊れた行は黙って捨てる。
  function selectUnsynced(history, syncedKeys) {
    try {
      const done = {};
      _arr(syncedKeys).forEach(function (k) {
        done[String(k)] = true;
      });
      const out = [];
      _arr(history).forEach(function (s) {
        const key = shiftKey(s);
        if (!key) return; // 識別できない = 送れない
        if (done[key]) return; // 送信済み
        out.push(s);
      });
      out.sort(function (a, b) {
        return a.start_time - b.start_time;
      });
      return out.slice(0, MAX_BATCH);
    } catch (_) {
      return [];
    }
  }

  // 送信する形に整える。★値は作らない・変えない★。派生値(比率/平均)は載せない。
  function toPayload(shift) {
    try {
      if (!shift || !_isNum(shift.start_time)) return null;

      const trips = _arr(shift.trips)
        .filter(function (t) {
          return t && _isNum(t.distance_m) && _isNum(t.fare_yen);
        })
        .slice()
        .sort(function (a, b) {
          const at = _isNum(a.start_time) ? a.start_time : 0;
          const bt = _isNum(b.start_time) ? b.start_time : 0;
          return at - bt;
        })
        .map(function (t, i) {
          // 掛け先(請求書払い)。会社が選ばれていなければ現金。
          // 変な支払区分が来たら現金に倒す(倉庫に変な値を入れない)。
          const custId = typeof t.customer_id === 'string' && t.customer_id ? t.customer_id : null;
          const payType = custId && t.payment_type === 'invoice' ? 'invoice' : 'cash';
          return {
            seq: i + 1, // 何件目か = 請求書の明細順を毎回同じにする
            distance_m: t.distance_m, // ★メーター確定値をそのまま★
            fare_yen: t.fare_yen, // ★メーター確定値をそのまま★
            customer_id: custId,
            customer_name: custId ? _str(t.customer_name) : '',
            payment_type: payType,
            start_time: _isNum(t.start_time) ? t.start_time : null,
            end_time: _isNum(t.end_time) ? t.end_time : null,
            start_address: _str(t.start_address),
            end_address: _str(t.end_address),
            waypoints: _arr(t.waypoints)
              .slice(0, MAX_WAYPOINTS)
              .map(function (w) {
                return {
                  address: _str(w && w.address),
                  timestamp: _isNum(w && w.timestamp) ? w.timestamp : null,
                };
              }),
          };
        });

      return {
        start_time: shift.start_time,
        end_time: _isNum(shift.end_time) ? shift.end_time : null,
        elapsed_sec: _isNum(shift.elapsed_sec) ? shift.elapsed_sec : null,
        total_distance_m: _isNum(shift.total_distance_m) ? shift.total_distance_m : null,
        actual_total_m: _isNum(shift.actual_total_m) ? shift.actual_total_m : null,
        empty_distance_m: _isNum(shift.empty_distance_m) ? shift.empty_distance_m : null,
        fare_total_yen: _isNum(shift.fare_total_yen) ? shift.fare_total_yen : null,
        trip_count: _isNum(shift.trip_count) ? shift.trip_count : trips.length,
        trips: trips,
      };
    } catch (_) {
      return null;
    }
  }

  // 送信済み記録に足す(重複なし・増えすぎたら古い順に間引く)
  function mergeSynced(existing, added) {
    try {
      const seen = {};
      const all = [];
      _arr(existing)
        .concat(_arr(added))
        .forEach(function (k) {
          const s = String(k);
          if (seen[s]) return;
          seen[s] = true;
          all.push(s);
        });
      if (all.length <= MAX_SYNCED_KEYS) return all;
      // 新しい方(start_time が大きい方)を残す
      all.sort(function (a, b) {
        return Number(a) - Number(b);
      });
      return all.slice(all.length - MAX_SYNCED_KEYS);
    } catch (_) {
      return [];
    }
  }

  // ─── 実行部(薄い) ──────────────────────────────────────

  function _deviceId() {
    return _get(DEVICE_ID_KEY) || '';
  }

  function _online() {
    try {
      return typeof navigator === 'undefined' || navigator.onLine !== false;
    } catch (_) {
      return true;
    }
  }

  // 送る。返り値は必ずオブジェクト(throw しない)。
  async function sync() {
    try {
      const companyToken = _get(K_COMPANY);
      const deviceId = _deviceId();
      // 会社URLで活性化していない端末(自社運用/ゲートOFF)は送らない = 送り先の会社が無い
      if (!companyToken || !deviceId) return { ok: false, sent: 0, reason: 'not_activated' };
      if (!_online()) return { ok: false, sent: 0, reason: 'offline' };

      const cfg = _cfg();
      if (!cfg) return { ok: false, sent: 0, reason: 'no_config' };

      const history = _getJson(HISTORY_KEY, []);
      const synced = _getJson(K_SYNCED, []);
      const targets = selectUnsynced(history, synced);
      if (!targets.length) return { ok: true, sent: 0, reason: 'nothing_to_send' };

      const shifts = targets.map(toPayload).filter(Boolean);
      if (!shifts.length) return { ok: true, sent: 0, reason: 'nothing_valid' };

      let res, j;
      try {
        res = await fetch(cfg.fn('dk-sync-jobs'), {
          method: 'POST',
          headers: cfg.headers(),
          body: JSON.stringify({
            url_token: companyToken,
            device_id: deviceId,
            shifts: shifts,
          }),
        });
        j = await res.json();
      } catch (_) {
        return { ok: false, sent: 0, reason: 'offline' }; // 通信できなかった = 次回また送る
      }

      if (!j || !j.ok) return { ok: false, sent: 0, reason: (j && j.reason) || 'error' };

      // サーバが受け取った勤務だけを「送信済み」にする(取りこぼしを次回に残す)
      const acceptedKeys = _arr(j.accepted).length
        ? _arr(j.accepted)
        : shifts.map(function (s) {
            return s.start_time;
          });
      _set(K_SYNCED, JSON.stringify(mergeSynced(synced, acceptedKeys)));
      return { ok: true, sent: acceptedKeys.length, reason: '' };
    } catch (_) {
      return { ok: false, sent: 0, reason: 'error' }; // ★絶対に throw しない★
    }
  }

  // 起動時 + オンライン復帰時に自動で送る。業務の邪魔は一切しない(裏で走るだけ)。
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
    // 純ロジック(テスト対象)
    shiftKey: shiftKey,
    selectUnsynced: selectUnsynced,
    toPayload: toPayload,
    mergeSynced: mergeSynced,
    // 実行
    sync: sync,
    init: init,
    // 定数
    MAX_BATCH: MAX_BATCH,
    MAX_WAYPOINTS: MAX_WAYPOINTS,
    MAX_SYNCED_KEYS: MAX_SYNCED_KEYS,
  };

  if (global) global.JobSync = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
