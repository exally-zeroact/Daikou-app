/* eslint-disable no-undef */
// ============================================================
// ★あとから代行を直す（追加料金・値引き・請求書）★ 2026-08-05
//
//   ★司さんの指示★
//     「メーターの方のやけど履歴で修正できるようにして
//       その業務押したら追加料金や値引きや請求書などちゃんと編集できな
//       忘れとる時があると思うから」
//
//   ▼絶対に動かさない物
//     ★距離★             … distance_m は1バイトも触らない
//     ★メーターの料金★   … 走った分の料金は再計算しない。そのまま持ち回る。
//     ＝直せるのは★あとから足し引きする物★だけ:  追加料金 / 値引き / 請求先
//
//   ▼直すと3つの帳面がずれるので、必ず全部そろえる
//     ① daikou_history_<日付>   … 運転手が見る履歴（画面）
//     ② 業務の trips[]          … 事務所へ上げる中身（今の業務 or daikou_business_history）
//     ③ dk_synced_shifts        … 「送信済み」の印。★外さないと直しが事務所に届かない★
//
//   ▼お金の式（ここが唯一の正）
//     メーター料金 = 走った分（割増を掛けたあと）
//     合計 = max(0, メーター料金 + 追加料金の合計 − 値引きの合計)
//
//     古い履歴には「メーター料金」が入っていない（合計しか無い）。
//     その時は  メーター料金 = 合計 − 追加料金 + 値引き  で戻す。
//     ★値引きも古い履歴には入っていない＝0として戻す★。
//     この戻し方だと、何も直さなければ★合計は1円も変わらない★（そこが大事）。
// ============================================================
(function (global) {
  'use strict';

  const K_SYNCED = 'dk_synced_shifts';
  const K_BIZ_HISTORY = 'daikou_business_history';
  const RIDE_PREFIX = 'daikou_history_';

  const _num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const _arr = (v) => (Array.isArray(v) ? v : []);
  const _sum = (list) => _arr(list).reduce((a, b) => a + _num(b && b.amount), 0);

  // ─────────────────────────────────────────
  // お金の式（純粋・ここだけ見れば金額が分かる）
  // ─────────────────────────────────────────

  // 走った分の料金（割増を掛けたあと）。直しても絶対に変わらない値。
  function meterFareOf(ride) {
    if (!ride) return 0;
    // 新しい履歴は明示的に持っている
    if (typeof ride.meter_fare === 'number' && isFinite(ride.meter_fare)) {
      return Math.round(ride.meter_fare);
    }
    // 古い履歴は合計から戻す（値引きは記録が無いので 0）
    return Math.round(_num(ride.fare) - _sum(ride.extras) + _sum(ride.discounts));
  }

  // 合計。★これがお客に出す金額★
  function totalOf(meterFare, extras, discounts) {
    return Math.max(0, Math.round(_num(meterFare) + _sum(extras) - _sum(discounts)));
  }

  // 直したあとの合計（画面のプレビュー用）
  function previewTotal(ride, edit) {
    const e = edit || {};
    return totalOf(
      meterFareOf(ride),
      e.extras !== undefined ? e.extras : ride && ride.extras,
      e.discounts !== undefined ? e.discounts : ride && ride.discounts
    );
  }

  // ─────────────────────────────────────────
  // 帳面①: 運転手が見る履歴の1件
  // ─────────────────────────────────────────
  function applyToRide(ride, edit) {
    if (!ride) return ride;
    const e = edit || {};
    const base = meterFareOf(ride); // ★走った分は動かさない★
    const extras = e.extras !== undefined ? _arr(e.extras).slice() : _arr(ride.extras).slice();
    const discounts =
      e.discounts !== undefined ? _arr(e.discounts).slice() : _arr(ride.discounts).slice();

    const out = Object.assign({}, ride, {
      meter_fare: base, // 次からは戻し計算しなくて済むよう残す
      extras: extras,
      discounts: discounts,
      fare: totalOf(base, extras, discounts),
      edited_at: _num(e.now) || null, // 直した印（画面に「修正済み」と出す）
    });

    // 請求先。空にすると現金に戻る。
    if (e.customer !== undefined) {
      const c = e.customer;
      out.customer_id = c && c.customer_id ? c.customer_id : null;
      out.customer_name = c && c.customer_id ? c.customer_name || null : null;
      // 会社を変えたら「誰が乗ったか」は必ず消す（前の客のが残ったら請求書が狂う）
      out.customer_note = null;
    }
    // ★誰が乗ったか(会長/社長/専務など) 2026-08-05★
    //   請求書の備考に入り、そこで小計が分かれる会社がある。選び忘れをここで直せる。
    if (e.customerNote !== undefined) {
      out.customer_note = out.customer_id && e.customerNote ? String(e.customerNote) : null;
    }
    // ★距離には一切代入しない★（元の値は Object.assign がそのまま運ぶ）
    //   「念のため戻す」も書かない。書けば触れる余地が残る。
    return out;
  }

  // ─────────────────────────────────────────
  // 帳面②: 事務所へ上げる代行の1件
  // ─────────────────────────────────────────
  function applyToTrip(trip, ride) {
    if (!trip) return trip;
    // ★距離には触れない★（Object.assign が元の値をそのまま運ぶ）
    const out = Object.assign({}, trip, {
      fare_yen: _num(ride && ride.fare), // ★値引き反映済みの実請求額★
    });
    if (ride && Object.prototype.hasOwnProperty.call(ride, 'customer_id')) {
      const id = ride.customer_id || null;
      out.customer_id = id;
      out.customer_name = id ? ride.customer_name || null : null;
      out.customer_note = id ? ride.customer_note || null : null; // 誰が乗ったか
      out.payment_type = id ? 'invoice' : 'cash';
    }
    return out;
  }

  // 業務の合計を積み直す（1件だけ足し引きせず、trips から数え直す＝ずれない）
  function recountShift(shift) {
    if (!shift) return shift;
    const trips = _arr(shift.trips);
    return Object.assign({}, shift, {
      trips: trips,
      fare_total_yen: trips.reduce((a, t) => a + _num(t && t.fare_yen), 0),
      trip_count: trips.length,
      actual_total_m: trips.reduce((a, t) => a + _num(t && t.distance_m), 0),
    });
  }

  // ─────────────────────────────────────────
  // 帳面③: 「送信済み」の印を外す
  //   ★これを忘れると、直しても事務所には古いままが残る★
  // ─────────────────────────────────────────
  function unmarkSynced(syncedList, shiftStartTime) {
    const key = String(shiftStartTime);
    return _arr(syncedList).filter((k) => String(k) !== key);
  }

  // その代行がどの業務のものか（trip_key = 代行の開始時刻 で突き合わせる）
  function findShiftOf(tripKey, currentState, bizHistory) {
    const k = _num(tripKey);
    if (!k) return null;
    const inTrips = (s) => _arr(s && s.trips).some((t) => _num(t && t.start_time) === k);
    if (currentState && currentState.start_time && inTrips(currentState)) {
      return { where: 'current', shift: currentState, shiftStart: currentState.start_time };
    }
    const list = _arr(bizHistory);
    for (let i = 0; i < list.length; i++) {
      if (inTrips(list[i])) {
        return { where: 'history', shift: list[i], index: i, shiftStart: list[i].start_time };
      }
    }
    return null; // 昔の履歴で trip が残っていない（画面だけ直す）
  }

  // ─────────────────────────────────────────
  // 実際に書き換える（localStorage を触るのはここだけ）
  // ─────────────────────────────────────────
  function apply(opts) {
    const o = opts || {};
    const store = o.store || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!store) return { ok: false, reason: 'no_store' };
    const rideKey = o.rideKey; // 'daikou_history_Mon Aug 04 2026'
    const tripKey = _num(o.tripKey);
    if (!rideKey || !tripKey) return { ok: false, reason: 'bad_key' };

    // ★Business は自分の控えを持っている (2026-08-05・実機で踏んだ)★
    //   倉庫(localStorage)だけ直しても、Business が次に保存した瞬間に
    //   ★控えで上書きされて直しが消える★。業務中は1秒ごとに保存しているので必ず消える。
    //   実測: 直して 1,700円 → GPSが1回来た瞬間に 2,500円 に戻った。
    //   ⇒ ★書く前に控えを流し込み(save)、書いた後に読み直させる(load)★
    //     呼ぶ側に任せると忘れる（同じ配線漏れを何度もやっている）ので、ここで面倒を見る。
    const biz =
      o.business !== undefined ? o.business : typeof Business !== 'undefined' ? Business : null;
    let reloaded = false;
    try {
      if (biz && typeof biz.save === 'function') biz.save();
    } catch (_) {
      /* 保存できなくても直しは続ける */
    }

    const readJson = (k, d) => {
      try {
        const raw = store.getItem(k);
        return raw ? JSON.parse(raw) : d;
      } catch (_) {
        return d;
      }
    };

    // ① 画面の履歴
    const rides = _arr(readJson(rideKey, []));
    const ri = rides.findIndex((r) => _num(r && r.trip_key) === tripKey);
    if (ri < 0) return { ok: false, reason: 'ride_not_found' };
    const newRide = applyToRide(rides[ri], o.edit);
    rides[ri] = newRide;

    // ② 事務所へ上げる分
    const bizState = readJson(o.stateKey || 'daikou_business_state', null);
    const bizHist = _arr(readJson(K_BIZ_HISTORY, []));
    const found = findShiftOf(tripKey, bizState, bizHist);
    let resend = false;

    if (found) {
      const trips = _arr(found.shift.trips).slice();
      const ti = trips.findIndex((t) => _num(t && t.start_time) === tripKey);
      if (ti >= 0) {
        trips[ti] = applyToTrip(trips[ti], newRide);
        const fixed = recountShift(Object.assign({}, found.shift, { trips: trips }));
        if (found.where === 'current') {
          store.setItem(o.stateKey || 'daikou_business_state', JSON.stringify(fixed));
          // ★控えを倉庫に合わせる（これが無いと次の保存で直しが消える）★
          try {
            if (biz && typeof biz.load === 'function') {
              biz.load();
              reloaded = true;
            }
          } catch (_) {
            /* ignore */
          }
        } else {
          bizHist[found.index] = fixed;
          store.setItem(K_BIZ_HISTORY, JSON.stringify(bizHist));
        }
        // ③ 送信済みの印を外す（★直しを事務所へ届ける★）
        const synced = _arr(readJson(K_SYNCED, []));
        const next = unmarkSynced(synced, found.shiftStart);
        if (next.length !== synced.length) {
          store.setItem(K_SYNCED, JSON.stringify(next));
          resend = true;
        }
      }
    }

    // ①は最後に書く（②が落ちても画面と中身がちぐはぐにならない）
    store.setItem(rideKey, JSON.stringify(rides));

    return {
      ok: true,
      ride: newRide,
      total: newRide.fare,
      linkedToShift: !!found,
      resend: resend,
      reloaded: reloaded, // 今の業務の控えを読み直したか
      shiftStart: found ? found.shiftStart : null,
    };
  }

  const api = {
    // 純ロジック
    meterFareOf: meterFareOf,
    totalOf: totalOf,
    previewTotal: previewTotal,
    applyToRide: applyToRide,
    applyToTrip: applyToTrip,
    recountShift: recountShift,
    unmarkSynced: unmarkSynced,
    findShiftOf: findShiftOf,
    // 実行
    apply: apply,
    // 定数
    RIDE_PREFIX: RIDE_PREFIX,
    K_SYNCED: K_SYNCED,
    K_BIZ_HISTORY: K_BIZ_HISTORY,
  };

  if (global) global.TripEdit = api;
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
