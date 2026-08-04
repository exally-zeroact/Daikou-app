// ============================================================
// js/meter-persist.js
// ★メーターが自分の走った距離を端末に覚える★ 2026-08-04
//
//   ★なぜ要るのか（司さんの実際の操作で分かった）★
//     3台ともオフラインで較正してテスト走行 → ★いったん画面を閉じた★
//     → 家に持ち帰ってWi-Fiに繋いで → 業務終了を押した
//     ＝上がった3件は全部 0m。★「画面を閉じる」で消えていた★
//
//   ★測って確定した欠陥★
//     js/meter.js の localStorage 参照は3件だけ、全部 dk_veh_active（車両プロファイル）。
//     ★distance_m / fare_yen / business_distance_m を保存している行は1件も無い★
//     電波の有無に関係なく ★電池切れ・iOSのバックグラウンド破棄・killでも同じ★。
//     business.js 側のミラーで繋いでいたが、その保険は★3回穴が開いて3回塞いでいる★
//     （2026-05-14 / 2026-05-25 / 2026-06-20）。継ぎ足しでは止まらないので根っこを直す。
//
//   ▼このファイルは ★覚えることだけ★ をやる。
//     距離の計算・料金の計算・地図合わせには一切触らない。
//     読み書きに失敗しても ★業務は絶対に止めない★（try/catch で握りつぶす）。
//
//   ▼★過大ゼロは不可侵★
//     戻すことは「増やす」方向に働きうるので、下の決まりを機械で縛る:
//       ・戻すのは起動直後の1回だけ／必ず上書き（足し算にしない）
//       ・今の値より小さければ戻さない（戻す＝過小方向＝安全側）
//       ・保存が未来の時刻なら戻さない（時計が狂った端末）
//       ・戻す時に料金を計算し直さない（保存時の確定値をそのまま）
// ============================================================
(function (global) {
  'use strict';

  const KEY = 'dk_meter_snapshot';
  const VERSION = 1;

  function _num(v) {
    return typeof v === 'number' && isFinite(v) ? v : null;
  }
  function _ls(store) {
    if (store) return store;
    try {
      return typeof localStorage !== 'undefined' ? localStorage : global && global.localStorage;
    } catch (_) {
      return null;
    }
  }

  // 「1,850円」の形にする（運転手が読む文なので）
  function _yen(n) {
    try {
      return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '円';
    } catch (_) {
      return String(n) + '円';
    }
  }
  function _km(m) {
    return (m / 1000).toFixed(1) + 'km';
  }

  // ─── 書く ─────────────────────────────────────────────
  //   ★1秒ごとに呼ばれる★（business.js の保存と同じ間隔に揃えてある。
  //   5秒だと落ちた時に最大5秒＝時速50kmで約70m消える。それは金額）
  //   実測: 1回287バイト・JSON化 0.0008ミリ秒。business.js の444バイトより軽い。
  function save(store, meterState, opts) {
    try {
      const ls = _ls(store);
      if (!ls || !meterState) return false;
      const o = opts || {};

      // 走っていない = 増えていない = 書く必要がない
      if (!meterState.running && !meterState.business_active) return false;

      const snap = {
        v: VERSION,
        saved_at: _num(o.now) != null ? o.now : Date.now(),
        // ★この2つが一致した時だけ戻す★
        business_start_time: _num(o.businessStart),
        trip_start_time: _num(o.tripStart),

        distance_m: _num(meterState.distance_m) || 0,
        business_distance_m: _num(meterState.business_distance_m) || 0,
        elapsed_accumulated_sec: _num(meterState.elapsed_accumulated_sec) || 0,

        fare_yen: _num(meterState.fare_yen) || 0,
        wait_sec: _num(meterState.wait_sec) || 0,

        running: !!meterState.running,
        business_active: !!meterState.business_active,
        billing_frozen: !!meterState.billing_frozen,
      };
      // ★表示用(display_*)は書かない★ 実距離から作り直せるため
      ls.setItem(KEY, JSON.stringify(snap));
      return true;
    } catch (_) {
      return false; // ★書けなくても業務は止めない★
    }
  }

  // ─── 読む ─────────────────────────────────────────────
  //   ★起動直後の1回だけ★呼ぶこと。
  //   返り値 restored=false なら「何も戻さない」＝0から始まる（今までどおり）。
  function restore(store, opts) {
    const none = {
      restored: false,
      fare_restored: false,
      distance_m: null,
      business_distance_m: null,
      elapsed_accumulated_sec: null,
      fare_yen: null,
      wait_sec: null,
      notice: '',
    };
    try {
      const ls = _ls(store);
      if (!ls) return none;
      const o = opts || {};
      const cur = o.cur || {};

      let j = null;
      try {
        const raw = ls.getItem(KEY);
        if (!raw) return none;
        j = JSON.parse(raw);
      } catch (_) {
        return none; // 壊れていたら戻さない
      }
      if (!j || j.v !== VERSION) return none;

      // ★保存が未来なら戻さない★（時計が狂った端末での事故防止）
      const now = _num(o.now) != null ? o.now : Date.now();
      if (_num(j.saved_at) == null || j.saved_at > now) return none;

      // ★時間の長さでは判断しない★（18時→翌9時=15時間の夜勤でも消えないように）
      //   代わりに「同じ業務か」で見る。何時間でも安全で、前日の残骸も拾わない。
      const biz = _num(o.businessStart);
      if (biz == null || _num(j.business_start_time) == null) return none;
      if (j.business_start_time !== biz) return none;

      const savedDist = _num(j.distance_m) || 0;
      const savedBiz = _num(j.business_distance_m) || 0;
      const curDist = _num(cur.distance_m) || 0;
      const curBiz = _num(cur.business_distance_m) || 0;

      // ★今の値より小さければ戻さない★（戻す＝過小方向。安全側だが距離が減るので拒否）
      if (savedDist < curDist || savedBiz < curBiz) return none;

      const out = {
        restored: true,
        fare_restored: false,
        // ★必ず上書き（足し算にしない）★ 2回呼んでも2倍にならない
        distance_m: savedDist,
        business_distance_m: savedBiz,
        elapsed_accumulated_sec: _num(j.elapsed_accumulated_sec) || 0,
        fare_yen: null,
        wait_sec: null,
        notice: '',
      };

      // ─── 料金は「同じ代行」の時だけ戻す ───────────────
      //   ★別の代行の料金を戻すのが一番危ない★のでここで縛る。
      //   戻さない場合は距離だけ戻す（運転手が損をしないよう距離は守る）。
      const trip = _num(o.tripStart);
      if (trip != null && _num(j.trip_start_time) != null && j.trip_start_time === trip) {
        out.fare_yen = _num(j.fare_yen) || 0; // ★計算し直さない。保存時の確定値そのまま★
        out.wait_sec = _num(j.wait_sec) || 0;
        out.fare_restored = true;
        // ★黙って金額を戻さない★ 運転手が目で見て、違えば止められるようにする
        out.notice = '前回の続きから　' + _yen(out.fare_yen) + ' / ' + _km(savedDist);
      }

      return out;
    } catch (_) {
      return none; // ★読めなくても業務は止めない★
    }
  }

  // 業務が終わったら控えは要らない（次の業務に持ち越さない）
  function clear(store) {
    try {
      const ls = _ls(store);
      if (ls) ls.removeItem(KEY);
      return true;
    } catch (_) {
      return false;
    }
  }

  const api = { KEY: KEY, VERSION: VERSION, save: save, restore: restore, clear: clear };

  if (global) global.MeterPersist = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
