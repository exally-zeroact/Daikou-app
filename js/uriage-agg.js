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

  // ★売上から引く額（1件ぶん）★
  //   売上表も給料も★必ずこれを通す★。別々に書くと片方だけ直して金額が食い違う。
  // ★★入れた 実費は 全部 引く★★ 2026-10-24（件J・司さん「実費は足したもの全て引く形やないと経費の意味ないやないか」）
  //   前（08-01〜）は 高速代・橋代・その他 の 3つを 会社の 設定（dk_sales_settings の deduct_*）と
  //   「何日から」の 記録（dk_uriage_rireki）で 引く／引かないを 選べた ⇒ ★選ぶ 形は やめた★（設定は もう 読まない）
  //   本番 10-24 実測：設定 1社（その他を 引かない）・その他の 実費は 0円・記録 0行＝今の 数は 1円も 動かない
  // ★★会社が 足した 実費も 引く★★ 2026-09-06（司さん
  //   「この項目ってユーザーは自由に決めれるん？追加や削除できる？」→「ウ」）
  //   ★古い 3つ（toll/bridge/other）は 列から 数える（10-24 からは いつも 引く）★
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

  // ─── 1回の 業務の 回数・実車距離・総走行距離 ──────────────────────
  //   2026-10-25 司さん「全部の車に自動反映できるもので（修正できるように）つけろよ」（入力の 画面）
  //   事務所が 直した 数（dk_shift_edits の *_naoshi）が 在れば それ、無ければ メーターの 数（dk_shifts）。
  //   ★給料（回数・距離歩合）・売上表・月次・本人の 給料は 全部 ここを 通す（1か所）★
  //   メーターの 元データ（dk_shifts・課金の distance_m）は 書かない。距離は m（整数）。
  //   直しの 形が 壊れている（負・小数・字）列は メーターの 数（保存の 口で 止めるので 入らない 筈の 物）
  const KAZU = [
    ['trip_count', 'trip_count_naoshi'],
    ['actual_total_m', 'actual_total_m_naoshi'],
    ['total_distance_m', 'total_distance_m_naoshi'],
  ];
  function kazuNaoshiOf(edit, col) {
    const v = edit ? edit[col] : null;
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
  }
  function kazuOf(shift, edit) {
    const o = { naoshi: false };
    KAZU.forEach(function (k) {
      const v = kazuNaoshiOf(edit, k[1]);
      if (v === null) o[k[0]] = n(shift && shift[k[0]]);
      else {
        o[k[0]] = v;
        o.naoshi = true;
      }
    });
    return o;
  }

  // 売上の 欄の 字を 読む（給料の 時数を入れる・入力 の 両方が 使う 1か所）2026-10-14
  //   カンマ・空白・円・全角の 数字を 外し、0以上の 整数だけ。空＝null（メーターに 戻す）。
  //   読めない 時は undefined（保存を 止めて 字で 出す）＝parseInt で「9,800」が 9円 に ならない 様に（対立役）
  //   ★空白は 前後だけ 落とす★ 2026-10-30（途中の 空白「7 5」は 崩れた 字＝75円に しない・他の 欄の JippiHozon.seiri と 同じ・対立役 止1）
  function yomuUriage(v) {
    const t = String(v === null || v === undefined ? '' : v)
      .replace(/[０-９]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
      })
      .replace(/[,，円¥￥]/g, '')
      .trim();
    if (t === '') return null;
    if (!/^\d+$/.test(t)) return undefined;
    const x = Number(t);
    return Number.isSafeInteger(x) ? x : undefined;
  }

  function deductOf(edit) {
    try {
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
      return n(e.toll_yen) + n(e.bridge_yen) + n(e.other_yen) + soto;
    } catch (_) {
      return 0;
    }
  }

  // 車ごとにまとめる
  //   shifts   … dk_shifts の行
  //   edits    … dk_shift_edits の行（手入力: 高速代・橋代・その他）
  //   labels   … dk_device_labels の行（車の呼び名）
  //   ★引く 額＝入れた 実費 全部（deductOf）★ 2026-10-24 件J（設定・記録は もう 受け取らない）
  function byDevice(shifts, edits, labels) {
    try {
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
            deduct_yen: 0, // 売上から引く分（入れた 実費 全部＝expense_yen と 同じ 数）
            net_fare_yen: 0, // ★これが「売上」★（実費を引いた分）
            shifts: [],
          };
        }
        const r = map[dev];
        const e = editById[s.shift_id] || {};

        r.shift_count += 1;
        // 回数・距離＝事務所が 直した 数 か メーター（kazuOf の 1か所）2026-10-25
        const kz = kazuOf(s, e);
        r.trip_count += kz.trip_count;
        r.total_distance_m += kz.total_distance_m;
        r.actual_total_m += kz.actual_total_m;
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
        // ★売上から引く分＝入れた 実費 全部★（給料と同じ関数を通す）2026-10-24 件J
        r.deduct_yen = deductOf({
          toll_yen: r.toll_yen,
          bridge_yen: r.bridge_yen,
          other_yen: r.other_yen,
          expenses: r.expenses,
        });
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
  function byDay(shifts, edits, labels) {
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
          const cars = byDevice(bucket[d], edits, labels);
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
    deductOf: deductOf,
    uriageOf: uriageOf,
    kazuOf: kazuOf,
    KAZU: KAZU,
    yomuUriage: yomuUriage,
  };

  if (global) global.UriageAgg = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
