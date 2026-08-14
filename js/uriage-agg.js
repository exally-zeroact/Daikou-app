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
        // ★印を付けた勤務は出さない (2026-08-06)★
        //   司さん「0mの3件は消さない」＝記録は残すが、売上表・給料・月次には出さない。
        //   （8/3 の較正の日の試し打ち。中身の無い日が並ぶと数字が読みにくい）
        if (s.excluded === true) return;
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

  // ─── 日ごとにまとめる ───────────────────────────────────
  //   ★司さん「4 売上を１日おきと車おきで見れないかんやろ」(2026-08-09)★
  //     今までは「車おき」だけで、日ごとは1台を開いた時しか出なかった。
  //     ＝「8/1 は全部の車で いくらだったか」が どこにも出なかった。
  //
  //   ★日の切り方は 業務開始の日を日本時間で切る★
  //     給料(js/payroll-daily.js dateOf)・請求書(meisai-row.js businessDate)と同じ。
  //     代行は夜の仕事なので、ここを間違えると
  //     ★同じ晩の仕事が2日に分かれる★（請求書で実際に起きた）。
  const JST_OFFSET_MIN = 540;
  function dayOf(iso) {
    // 給料の部品があればそれを使う（切り方が1箇所に集まる）
    if (global && global.PayrollDaily && typeof global.PayrollDaily.dateOf === 'function') {
      return global.PayrollDaily.dateOf(iso, JST_OFFSET_MIN);
    }
    try {
      const t = Date.parse(String(iso));
      if (!isFinite(t)) return '';
      const d = new Date(t + JST_OFFSET_MIN * 60000);
      const p = function (v) {
        return String(v).padStart(2, '0');
      };
      return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
    } catch (_) {
      return '';
    }
  }

  //   返す形: [{ date, …車ごとと同じ合計…, cars:[車ごとの行], shifts:[その日の勤務] }]
  //   ★数字は1円も変えない★ 日ごとの合計 ＝ 車ごとの合計（試験で毎回突き合わせる）
  function byDay(shifts, edits, labels, settings) {
    try {
      // 日ごとに勤務を仕分けてから、★車ごとと同じ関数(byDevice)に通す★
      //   別々に足すと、引く物の設定や「印を付けた勤務」の扱いがズレる。
      const bucket = {};
      arr(shifts).forEach(function (s) {
        if (!s || typeof s !== 'object') return;
        const d = dayOf(s.started_at);
        if (!d) return; // 日付が読めない行は出さない（0として混ぜない）
        if (!bucket[d]) bucket[d] = [];
        bucket[d].push(s);
      });

      return Object.keys(bucket)
        .sort()
        .map(function (d) {
          const cars = byDevice(bucket[d], edits, labels, settings);
          const t = total(cars);
          t.date = d;
          // ★車の並びは js/car-name.js が1箇所で決める★（売上・給料・請求書と揃える）
          if (global && global.CarName) {
            const order = global.CarName.sortIds(
              cars.map(function (c) {
                return c.device_id;
              }),
              labels
            );
            cars.sort(function (a, b) {
              return order.indexOf(a.device_id) - order.indexOf(b.device_id);
            });
          }
          t.cars = cars;
          t.shifts = bucket[d];
          return t;
        })
        .filter(function (r) {
          return r.cars.length > 0; // どの車か分からない数字だけの日は出さない
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
    byDay: byDay, // ★日ごと（2026-08-09 司さん「1日おきと車おきで見れないかん」）★
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
