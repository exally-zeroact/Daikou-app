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

  // ★★代行の 突き合わせは「近い 時刻」★★ 2026-10-22（対立役 止1・机の Chrome で 測った）
  //   画面の 履歴の 鍵（ride.trip_key＝current_trip.start_time・index.html）と 業務の trips の start_time
  //   （daikou_last_start）は 別々の Date.now()。間に GPS・メーター・住所引きが 挟まり 1〜2ms ずれる
  //   （開き直して 最初の 代行は 6回中 6回）。前は === で 見て、ずれた 代行は「この 画面だけ」直り
  //   事務所へ 1円も 届かなかった。★鍵より 前 3秒 以内で 一番 近い 代行★を 同じ 代行と 見る。
  //   ★片側だけ★ 2026-10-22（対立役 直1・手元で 再現）：業務の 代行の 時刻（daikou_last_start）は 行の 鍵
  //   （current_trip.start_time）より 先に 書く＝代行は 鍵と 同じか 前にしか ならない。両側に すると、代行の 無い 行
  //   （確定→走行に 戻る→キャンセル で 残る）を 直した 時に 3秒 後に 始まった 隣の 代行の 額を 書き換えた。
  const TRIP_MADO_MS = 3000;
  //   ★ぴったり 同じ 時刻を 先に 探し、無い 時だけ 近さで 探す★（今まで 当たっていた 物は 今まで 通り）
  function tripIndexOf(trips, tripKey, chikaku) {
    const k = _num(tripKey);
    if (!k) return -1;
    const list = _arr(trips);
    const ex = list.findIndex((t) => _num(t && t.start_time) === k);
    if (ex >= 0 || chikaku === false) return ex;
    let best = -1;
    let bestD = TRIP_MADO_MS + 1;
    list.forEach((t, i) => {
      const st = _num(t && t.start_time);
      const d = k - st; // ★鍵より 前の 代行だけ★
      if (st && d >= 0 && d <= TRIP_MADO_MS && d < bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  }

  // その代行がどの業務のものか（trip_key = 代行の開始時刻 で突き合わせる）
  function findShiftOf(tripKey, currentState, bizHistory) {
    const k = _num(tripKey);
    if (!k) return null;
    // ぴったり（今の 業務→履歴）を 先に、無ければ 近さ（今の 業務→履歴）
    const list = _arr(bizHistory);
    for (const chikaku of [false, true]) {
      const inTrips = (s) => tripIndexOf(s && s.trips, k, chikaku) >= 0;
      if (currentState && currentState.start_time && inTrips(currentState)) {
        return { where: 'current', shift: currentState, shiftStart: currentState.start_time };
      }
      for (let i = 0; i < list.length; i++) {
        if (inTrips(list[i])) {
          return { where: 'history', shift: list[i], index: i, shiftStart: list[i].start_time };
        }
      }
    }
    return null; // 昔の履歴で trip が残っていない（画面だけ直す）
  }

  // ─────────────────────────────────────────
  // ★★運転手が 直せるのは「その日の 営業」だけ★★ 2026-10-22 司さん
  //   「やっぱり運転手の修正はその日の営業だけにしろ キャンセルや履歴での金額の編集や後から請求書など全て」
  //   「その日の営業」＝「業務終了を押すまで」／「再開してもその日の分しか修正さすな」／切れ目＝「正午」
  //   ＝直せるのは ①今の 業務の 中の 代行 ②業務中（active・ended で ない）③代行の 営業日が 今の 営業日
  //   （営業日＝日本時間で 時刻−12時間 の 日付＝正午より 前の 代行は 前の 日の 分）。終わった 分は 事務所が 直す。
  //   ★判じは ここ 1か所★（履歴の 押せる 印・開く 時・保存の 時・apply が 同じ 物を 呼ぶ）
  // ─────────────────────────────────────────
  const SHOGO_MS = 12 * 60 * 60 * 1000;
  function eigyoubi(ms) {
    const n = _num(ms);
    if (!n) return '';
    const d = new Date(n + 9 * 60 * 60 * 1000 - SHOGO_MS);
    const p = (x) => String(x).padStart(2, '0');
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  }
  // o = { tripKey, state（Business の 控え）, history（daikou_business_history）, now, readOnly }
  //   返り＝{ ok, reason }（reason＝yomidake／eigyou_owari／betsu_no_gyoumu／mae_no_hi）
  function naoseru(o) {
    const x = o || {};
    if (x.readOnly) return { ok: false, reason: 'yomidake' };
    const st = x.state;
    if (!st || st.active !== true || st.ended === true)
      return { ok: false, reason: 'eigyou_owari' };
    const found = findShiftOf(x.tripKey, st, x.history);
    if (!found || found.where !== 'current') return { ok: false, reason: 'betsu_no_gyoumu' };
    const ima = eigyoubi(x.now === undefined ? Date.now() : x.now);
    if (!ima || eigyoubi(x.tripKey) !== ima) return { ok: false, reason: 'mae_no_hi' };
    return { ok: true, reason: null };
  }
  // 運転手に 出す 字（reason ごと）
  function naosenaiBun(reason) {
    if (reason === 'yomidake') return 'この 画面は 見るだけです（別の 画面で 業務中）。';
    if (reason === 'mae_no_hi')
      return '前の 日の 分は 直せません。事務所に 直して もらってください。';
    if (reason === 'betsu_no_gyoumu')
      return '今の 業務の 代行では ないので 直せません。事務所に 直して もらってください。';
    return '業務終了の 後は 直せません。事務所に 直して もらってください。';
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

    // ★その日の 営業 だけ★（何も 書く 前に 見る）2026-10-22
    //   読むのは Business の 控え（倉庫の 字は 保存が 転ぶと 業務終了の 前の 古い 状態の まま＝対立役 直3）
    const biz0 =
      o.business !== undefined ? o.business : typeof Business !== 'undefined' ? Business : null;
    let histNow = [];
    try {
      const raw = store.getItem(K_BIZ_HISTORY);
      histNow = raw ? JSON.parse(raw) : [];
    } catch (_) {
      histNow = [];
    }
    let st0 = null;
    try {
      st0 =
        biz0 && typeof biz0.getState === 'function'
          ? biz0.getState()
          : JSON.parse(store.getItem(o.stateKey || 'daikou_business_state') || 'null');
    } catch (_) {
      st0 = null;
    }
    const nao = naoseru({
      tripKey: tripKey,
      state: st0,
      history: histNow,
      now: o.edit && o.edit.now,
      readOnly: !!o.readOnly,
    });
    if (!nao.ok) return { ok: false, reason: nao.reason };

    // ★Business は自分の控えを持っている (2026-08-05・実機で踏んだ)★
    //   倉庫(localStorage)だけ直しても、Business が次に保存した瞬間に
    //   ★控えで上書きされて直しが消える★。業務中は1秒ごとに保存しているので必ず消える。
    //   実測: 直して 1,700円 → GPSが1回来た瞬間に 2,500円 に戻った。
    //   ⇒ ★書く前に控えを流し込み(save)、書いた後に読み直させる(load)★
    //     呼ぶ側に任せると忘れる（同じ配線漏れを何度もやっている）ので、ここで面倒を見る。
    const biz =
      o.business !== undefined ? o.business : typeof Business !== 'undefined' ? Business : null;
    let reloaded = false;
    // ★控えを 倉庫に 書けない 時は 直さない★ 2026-10-22（対立役 直3：書けずに 直すと 古い 倉庫を 読み直し
    //   業務終了した 控えが 業務中に 戻る）
    try {
      if (biz && typeof biz.save === 'function' && biz.save() === false)
        return { ok: false, reason: 'hozon_dekinai' };
    } catch (_) {
      return { ok: false, reason: 'hozon_dekinai' };
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
      const ti = tripIndexOf(trips, tripKey);
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
          // ★★2026-09-29 追加＝履歴にも 同じ勤務が 居たら そっちも 直す★★
          //   ★対立役に 叩かれて 見つかった（お金が そのまま ずれる）★
          //     [業務終了] を 押すと business.js:end が ★履歴にも 積む★。
          //     でも state.start_time は 残る（limbo）ので findShiftOf は ★current を 先に 返す★。
          //     ⇒ 直るのは 画面と state だけ。★job-sync が 読むのは 履歴★
          //       （grep: js/job-sync.js に daikou_business_state の字は 0個）
          //     ⇒ 値引きが 届かないどころか ★印を 外して 古い額を わざわざ 送り直す★。
          //     実測: 画面 4,000／state 4,000／★履歴 5,000／送る額 5,000★
          //       ＝値引き 1,000円 を 余計に 請求する。請求先の 付け直しなら ★その代行の 全額★。
          //   ★どちらが 使われるかを 当てるのでなく「居る方を 全部 揃える」★
          try {
            const hi = _arr(bizHist).findIndex(
              (x) => x && _num(x.start_time) === _num(found.shiftStart)
            );
            if (hi >= 0) {
              const hTrips = _arr(bizHist[hi].trips).slice();
              const hti = tripIndexOf(hTrips, tripKey);
              if (hti >= 0) {
                hTrips[hti] = applyToTrip(hTrips[hti], newRide);
                bizHist[hi] = recountShift(Object.assign({}, bizHist[hi], { trips: hTrips }));
                store.setItem(K_BIZ_HISTORY, JSON.stringify(bizHist));
              }
            }
          } catch (_) {
            /* 履歴を 直せなくても 画面の 直しは 通す */
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
    tripIndexOf: tripIndexOf,
    eigyoubi: eigyoubi,
    naoseru: naoseru,
    naosenaiBun: naosenaiBun,
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
