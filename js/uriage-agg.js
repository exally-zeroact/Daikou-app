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
  // ★★会社が 足した 実費も 引く★★ 2026-09-06（司さん
  //   「この項目ってユーザーは自由に決めれるん？追加や削除できる？」→「ウ」）
  //   ★古い 3つ（toll/bridge/other）は 今まで通り 列から・チェックで 引くか 決める★
  //   ★足した 物は edit.expenses（名前つき）から 全部 引く★
  //     ＝足した 物に「引く/引かない」の チェックは 在りません（足した＝引く 物）。
  //   ★★1円も 変わらない事★★
  //     expenses が 無い 行（今まで 全部）は ★足す 物が 0★＝前と 同じ 数字。
  //     2026-09-06 実測 … dk_shift_edits 1行／実費が 入った 行 0行／合計 0円
  // ─── 1回の 業務の 売上（実費を 引く 前）──────────────────────
  //   2026-10-14 司さん「売上の数も任意でユーザーが修正できるようにしとけよ」
  //   事務所が 直した 売上（dk_shift_edits.uriage_yen）が 在れば それ、無ければ メーターの 確定値。
  //   ★給料（payroll-daily）・売上表・月次・本人の 給料は 全部 ここを 通す（1か所）★
  //   請求書の 一覧で 直すと dk-fix-fare が uriage_yen を 空に 戻す＝後から 直した 方が 勝つ。
  //   返り値：円（整数）。直しの 形が 壊れている（負・小数・字）時は null
  //     ＝★メーターの 額に 倒さない★。呼ぶ 側が 止めて 知らせる（お金の 出力は 止めて 警告）
  function uriageOf(shift, edit) {
    const v = edit ? edit.uriage_yen : null;
    if (v === null || v === undefined) return n(shift && shift.fare_total_yen);
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
    return null;
  }

  // 売上の 欄の 字を 読む（給料の 時数を入れる・入力 の 両方が 使う 1か所）2026-10-14
  //   カンマ・空白・円・全角の 数字を 外し、0以上の 整数だけ。空＝null（メーターに 戻す）。
  //   読めない 時は undefined（保存を 止めて 字で 出す）＝parseInt で「9,800」が 9円 に ならない 様に（対立役）
  function yomuUriage(v) {
    const t = String(v === null || v === undefined ? '' : v)
      .replace(/[０-９]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
      })
      .replace(/[,，\s円¥￥]/g, '');
    if (t === '') return null;
    if (!/^\d+$/.test(t)) return undefined;
    const x = Number(t);
    return Number.isSafeInteger(x) ? x : undefined;
  }

  function deductOf(edit, settings) {
    try {
      const st = normSettings(settings);
      const e = edit || {};
      let soto = 0;
      const x = e.expenses;
      if (x && typeof x === 'object') {
        Object.keys(x).forEach((k) => {
          // ★古い 3つは 上で 数えるので ここでは 数えない（二重に しない）★
          if (k === 'toll' || k === 'bridge' || k === 'other') return;
          soto += n(x[k]);
        });
      }
      return (
        (st.deduct_toll ? n(e.toll_yen) : 0) +
        (st.deduct_bridge ? n(e.bridge_yen) : 0) +
        (st.deduct_other ? n(e.other_yen) : 0) +
        soto
      );
    } catch (_) {
      return 0;
    }
  }

  // ─── 売上から 引く 物の「何日から」──────────────────────── 2026-10-18（docs/nannichi-kara-uriage.md）
  //   rows＝dk_uriage_rireki の 行 {key:'toll'|'bridge'|'other', from_date, value:true|false}
  //   ★形が 違えば throw★（呼ぶ 側が 止めて 知らせる＝黙って 列の 値に 倒さない）。undefined＝記録 無し
  const RIREKI_KEYS = { toll: 'deduct_toll', bridge: 'deduct_bridge', other: 'deduct_other' };
  function rirekiKumu(rows) {
    if (rows === undefined) return null;
    if (!Array.isArray(rows)) throw new Error('uriageRireki');
    const out = {};
    rows.forEach(function (x) {
      if (!x || typeof x !== 'object' || !Object.prototype.hasOwnProperty.call(RIREKI_KEYS, x.key))
        throw new Error('uriageRireki');
      const d = String(x.from_date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || typeof x.value !== 'boolean')
        throw new Error('uriageRireki');
      (out[x.key] || (out[x.key] = [])).push({ d: d, v: x.value });
    });
    Object.keys(out).forEach(function (k) {
      out[k].sort(function (a, b) {
        return a.d < b.d ? -1 : a.d > b.d ? 1 : 0;
      });
    });
    return Object.keys(out).length ? out : null;
  }
  // ★その 日の 引き方★＝列（normSettings）に、各 鍵の from_date ≤ 日 で 一番 新しい 記録を 重ねる
  //   kumi が 無い（記録 0）＝normSettings(列) そのもの（今と 1円も 違わない）
  function settingsOnDay(settings, kumi, date) {
    const st = normSettings(settings);
    if (!kumi) return st;
    const d = String(date || '').slice(0, 10);
    Object.keys(RIREKI_KEYS).forEach(function (k) {
      let v;
      arr(kumi[k]).forEach(function (x) {
        if (x.d <= d) v = x.v;
      });
      if (v !== undefined) st[RIREKI_KEYS[k]] = v;
    });
    return st;
  }

  // 車ごとにまとめる
  //   shifts   … dk_shifts の行
  //   edits    … dk_shift_edits の行（手入力: 高速代・橋代・その他）
  //   labels   … dk_device_labels の行（車の呼び名）
  //   settings … 売上から何を引くか（会社ごと）
  //   kumi     … 売上から 引く 物の 記録（rirekiKumu の 返り値・無ければ null）2026-10-18
  //   ★引く 額は 業務ごとに その 日の 引き方で 出して 足す★（足し算は 線形＝記録が 無ければ 今と 同じ 額）
  function byDevice(shifts, edits, labels, settings, kumi) {
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
            uriage_naoshi: 0, // 事務所が 売上を 直した 業務の 数 2026-10-14
            uriage_dame: 0, // 売上の 直しが 読めない 業務の 数（画面が 止めて 知らせる）
            toll_yen: 0,
            bridge_yen: 0,
            other_yen: 0,
            expenses: {}, // ★会社が 足した 実費（名前つき）の 合計★ 2026-10-05
            expense_yen: 0,
            deduct_yen: 0, // 売上から引く分（設定で選ばれた項目だけ）
            deduct_hi: 0, // 記録が 在る 時の 業務ごとの 引く 額の 合計（下で deduct_yen に する）
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
        // 売上＝事務所が 直した 額 か メーターの 確定値（uriageOf）。2026-10-14
        const u = uriageOf(s, e);
        if (u === null)
          r.uriage_dame += 1; // 直しが 読めない 業務（画面が 止めて 知らせる）
        else r.fare_total_yen += u;
        if (u !== null && e.uriage_yen !== null && e.uriage_yen !== undefined) r.uriage_naoshi += 1;
        r.toll_yen += n(e.toll_yen);
        r.bridge_yen += n(e.bridge_yen);
        r.other_yen += n(e.other_yen);
        // ★★足した 実費も 持ち越す★★ 2026-10-05（対立役）
        //   前は 古い 3つだけ 詰め直して 引いていた ⇒ ★足した 実費が 引かれず★
        //   売上表の 売上が 月次集計・給料（payroll-daily buildCtx は edit を 丸ごと 渡す）より 多く 出た。
        //   本番 10-05 実測：足した 実費に 額が 入った 行 0行＝今の 数字は 1円も 変わらない
        const ex = e.expenses;
        if (ex && typeof ex === 'object') {
          Object.keys(ex).forEach(function (k) {
            if (k === 'toll' || k === 'bridge' || k === 'other') return;
            r.expenses[k] = n(r.expenses[k]) + n(ex[k]);
          });
        }
        // ★記録が 在る 時だけ★ 業務の 日（dayOf＝給料と 同じ 日本時間）の 引き方で 引く 額を 足す
        if (kumi) r.deduct_hi += deductOf(e, settingsOnDay(settings, kumi, dayOf(s.started_at)));
        r.shifts.push(s);
      });

      return Object.keys(map).map(function (k) {
        const r = map[k];
        // 空車 = 総走行 − 実車（マイナスにはしない）
        r.empty_distance_m = Math.max(0, r.total_distance_m - r.actual_total_m);
        let soto = 0;
        Object.keys(r.expenses).forEach(function (k) {
          soto += n(r.expenses[k]);
        });
        r.expense_yen = r.toll_yen + r.bridge_yen + r.other_yen + soto; // 手入力した実費ぜんぶ
        // ★売上から引く分＝会社が「引く」と選んだ項目だけ★（給料と同じ関数を通す）
        //   記録が 無い 会社は 今と 同じ（車の 合計に 1回）。在れば 業務ごとに その 日の 引き方で 足した 額
        r.deduct_yen = kumi
          ? r.deduct_hi
          : deductOf(
              {
                toll_yen: r.toll_yen,
                bridge_yen: r.bridge_yen,
                other_yen: r.other_yen,
                expenses: r.expenses,
              },
              st
            );
        delete r.deduct_hi;
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
  function byDay(shifts, edits, labels, settings, kumi) {
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
          const cars = byDevice(bucket[d], edits, labels, settings, kumi);
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
      uriage_naoshi: 0,
      uriage_dame: 0,
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
    rirekiKumu: rirekiKumu, // 売上から 引く 物の 記録（何日から）2026-10-18
    settingsOnDay: settingsOnDay,
    uriageOf: uriageOf,
    yomuUriage: yomuUriage,
    DEFAULT_DEDUCT: DEFAULT_DEDUCT,
  };

  if (global) global.UriageAgg = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
