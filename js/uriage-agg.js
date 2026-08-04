// ============================================================
// js/uriage-agg.js
// ★売上表の集計（純ロジック・画面から切り離してある）2026-08-01★
//
//   司さんの要件:
//     「売上表には車ごとに 件数、実車距離、総走行距離」
//     「高速や橋代などは手で入力」
//
//   ▼なぜ画面から切り離すか
//     数字が合っているかを機械で確かめるため。UIの中に計算があるとテストできない。
//     （Kyually が payroll-monthly.js を切り出したのと同じ考え方）
//
//   ▼絶対に守ること
//     ・throw しない（画面が真っ白にならない）
//     ・メーターが確定した数字はそのまま足すだけ。丸めない・補正しない・作らない
//     ・手入力（高速代など）は★売上に混ぜない★。別の数字として持つ
//     ・NaN を画面に出さない（数値でない物は 0 に倒す）
//
//   ▼距離の扱いについて（社内ルール）
//     精度を語るときは必ず「代行1件ごと」。ここで出す合計距離は★実績の表示★であって、
//     精度や運賃の根拠には使わない。
// ============================================================
(function (global) {
  'use strict';

  function n(v) {
    const x = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(x) ? x : 0;
  }
  function arr(v) {
    return Array.isArray(v) ? v : [];
  }

  // メートル → km（小数1桁）
  function km(m) {
    try {
      return (n(m) / 1000).toFixed(1);
    } catch (_) {
      return '0.0';
    }
  }

  // 端末IDしか無いときの見せ方（人が見て区別できる程度に）
  function shortId(deviceId) {
    const s = String(deviceId || '');
    return s.length > 8 ? s.slice(0, 8) + '…' : s;
  }

  // ★売上から何を引くかの設定（会社ごと）★
  //   司さん指示(2026-08-01)「売上は橋代と高速代引いた分」「ユーザー毎に引くものを選べるように」
  //   既定 = 高速代と橋代を引く（その他は引かない）
  const DEFAULT_DEDUCT = { deduct_toll: true, deduct_bridge: true, deduct_other: false };

  function normSettings(s) {
    try {
      if (!s || typeof s !== 'object') return Object.assign({}, DEFAULT_DEDUCT);
      return {
        deduct_toll: s.deduct_toll === undefined ? DEFAULT_DEDUCT.deduct_toll : !!s.deduct_toll,
        deduct_bridge:
          s.deduct_bridge === undefined ? DEFAULT_DEDUCT.deduct_bridge : !!s.deduct_bridge,
        deduct_other: s.deduct_other === undefined ? DEFAULT_DEDUCT.deduct_other : !!s.deduct_other,
      };
    } catch (_) {
      return Object.assign({}, DEFAULT_DEDUCT);
    }
  }

  // ★売上から引く額（1件ぶん）★
  //   売上表も給料も★必ずこれを通す★。別々に書くと片方だけ直して金額が食い違う。
  function deductOf(edit, settings) {
    try {
      const st = normSettings(settings);
      const e = edit || {};
      return (
        (st.deduct_toll ? n(e.toll_yen) : 0) +
        (st.deduct_bridge ? n(e.bridge_yen) : 0) +
        (st.deduct_other ? n(e.other_yen) : 0)
      );
    } catch (_) {
      return 0;
    }
  }

  // 車ごとにまとめる
  //   shifts   … dk_shifts の行
  //   edits    … dk_shift_edits の行（手入力: 高速代・橋代・その他）
  //   labels   … dk_device_labels の行（車の呼び名）
  //   settings … 売上から何を引くか（会社ごと）
  function byDevice(shifts, edits, labels, settings) {
    try {
      const st = normSettings(settings);
      // 手入力を勤務IDで引けるようにする
      const editById = {};
      arr(edits).forEach(function (e) {
        if (e && e.shift_id) editById[e.shift_id] = e;
      });
      // ★画面に出す名前は js/car-name.js が1箇所で決める (2026-08-04)★
      //   司さん「売上1の横の英語のやつ邪魔でしょうがない」
      //   名前が無い時に端末ID(UUID)を出していた。名前が無ければ「車1」「車2」にする。
      const _ids = [];
      arr(shifts).forEach(function (s) {
        if (s && typeof s.device_id === 'string' && s.device_id) _ids.push(s.device_id);
      });
      const labelById =
        global && global.CarName
          ? global.CarName.nameMap(_ids, labels)
          : (function () {
              // CarName が無い時も ★UUIDは出さない★（並べて番号を振る）
              const m = {};
              const named = {};
              arr(labels).forEach(function (l) {
                if (l && l.device_id && l.label) named[l.device_id] = l.label;
              });
              _ids
                .filter(function (v, i, a) {
                  return a.indexOf(v) === i;
                })
                .sort()
                .forEach(function (id, i) {
                  m[id] = named[id] || '車' + (i + 1);
                });
              return m;
            })();

      const map = {};
      arr(shifts).forEach(function (s) {
        if (!s || typeof s !== 'object') return;
        const dev = s.device_id;
        if (!dev || typeof dev !== 'string') return; // どの車か分からない数字は出さない

        if (!map[dev]) {
          map[dev] = {
            device_id: dev,
            label: labelById[dev] || '車', // ★UUIDは出さない★
            shift_count: 0,
            trip_count: 0,
            total_distance_m: 0,
            actual_total_m: 0,
            empty_distance_m: 0,
            fare_total_yen: 0,
            toll_yen: 0,
            bridge_yen: 0,
            other_yen: 0,
            expense_yen: 0,
            deduct_yen: 0, // 売上から引く分（設定で選ばれた項目だけ）
            net_fare_yen: 0, // ★これが「売上」★（実費を引いた分）
            shifts: [],
          };
        }
        const r = map[dev];
        const e = editById[s.shift_id] || {};

        r.shift_count += 1;
        r.trip_count += n(s.trip_count);
        r.total_distance_m += n(s.total_distance_m);
        r.actual_total_m += n(s.actual_total_m);
        r.fare_total_yen += n(s.fare_total_yen); // ★売上はメーター確定値のまま★
        r.toll_yen += n(e.toll_yen);
        r.bridge_yen += n(e.bridge_yen);
        r.other_yen += n(e.other_yen);
        r.shifts.push(s);
      });

      return Object.keys(map).map(function (k) {
        const r = map[k];
        // 空車 = 総走行 − 実車（マイナスにはしない）
        r.empty_distance_m = Math.max(0, r.total_distance_m - r.actual_total_m);
        r.expense_yen = r.toll_yen + r.bridge_yen + r.other_yen; // 手入力した実費ぜんぶ
        // ★売上から引く分＝会社が「引く」と選んだ項目だけ★（給料と同じ関数を通す）
        r.deduct_yen = deductOf(
          { toll_yen: r.toll_yen, bridge_yen: r.bridge_yen, other_yen: r.other_yen },
          st
        );
        r.net_fare_yen = r.fare_total_yen - r.deduct_yen; // ★これが売上★
        return r;
      });
    } catch (_) {
      return [];
    }
  }

  // 合計行
  function total(rows) {
    const t = {
      shift_count: 0,
      trip_count: 0,
      total_distance_m: 0,
      actual_total_m: 0,
      empty_distance_m: 0,
      fare_total_yen: 0,
      toll_yen: 0,
      bridge_yen: 0,
      other_yen: 0,
      expense_yen: 0,
      deduct_yen: 0,
      net_fare_yen: 0,
    };
    try {
      arr(rows).forEach(function (r) {
        if (!r) return;
        Object.keys(t).forEach(function (k) {
          t[k] += n(r[k]);
        });
      });
    } catch (_) {
      /* ignore */
    }
    return t;
  }

  const api = {
    km: km,
    shortId: shortId,
    byDevice: byDevice,
    total: total,
    normSettings: normSettings,
    deductOf: deductOf,
    DEFAULT_DEDUCT: DEFAULT_DEDUCT,
  };

  if (global) global.UriageAgg = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
