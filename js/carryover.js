// ============================================================
// js/carryover.js
// ★前の日の業務が終わっていないことに気づかせる★ 2026-08-05
//
//   ★何が起きるか（司さんの指摘）★
//     業務終了を押し忘れたまま次の日を迎えると、
//     ★業務開始が効かない★（business.js: state.active なら return false）。
//     画面も「業務中」のままなので、★前の日の業務がそのまま続く★。
//     結果:
//       ・2晩ぶんの距離が1つの勤務にまとまる
//       ・売上も代行も全部 ★前の日の日付★ になる
//       ・その日の売上表は空になる
//     ＝記録は消えないが、★日付がずれて数が合わなくなる★。
//
//   ★直し方（勝手に締めない）★
//     アプリを開いた時に「昨日の業務がまだ終わっていません」と出して、
//     ★運転手に選ばせる★。勝手に締めると、締めた時刻までの距離しか残らず、
//     そのあと走った分が飛ぶ恐れがある。
//
//   ▼このファイルは判断するだけ。距離も料金も業務の状態も1文字も変えない。
// ============================================================
(function (global) {
  'use strict';

  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

  // 日本時間の「日」を出す（YYYY-MM-DD）
  function businessDay(ms) {
    try {
      if (typeof ms !== 'number' || !isFinite(ms)) return '';
      const d = new Date(ms + JST_OFFSET_MS);
      const p = function (n) {
        return String(n).padStart(2, '0');
      };
      return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
    } catch (_) {
      return '';
    }
  }

  // ★前の日の業務が開きっぱなしか★
  //   state … Business.getState()
  //   nowMs … 今の時刻
  //   返り値: { carryOver, startedDay, today, hours }
  function check(state, nowMs) {
    const out = { carryOver: false, startedDay: '', today: '', hours: 0 };
    try {
      const now = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
      out.today = businessDay(now);
      if (!state || typeof state !== 'object') return out;

      // 終わっている業務は対象外（終了済み・未開始）
      if (!state.active) return out;
      const start = state.start_time;
      if (typeof start !== 'number' || !isFinite(start) || start <= 0) return out;

      out.startedDay = businessDay(start);
      out.hours = Math.max(0, (now - start) / 3600000);

      // ★同じ日の業務は当然そのまま★（夜勤は日をまたぐが「開始の日」で見る）
      if (out.startedDay === out.today) return out;

      // ★日をまたいだだけでは出さない★
      //   18時開始→翌9時終了は普通にある。ここで出すと毎晩じゃまになる。
      //   「もう1日ぶん経っている」＝押し忘れ、と見なす。
      if (out.hours < 20) return out;

      out.carryOver = true;
      return out;
    } catch (_) {
      return out;
    }
  }

  // 画面に出す文（運転手が読む）
  function message(info) {
    try {
      if (!info || !info.carryOver) return '';
      const h = Math.floor(info.hours);
      return (
        info.startedDay.replace(/^\d{4}-/, '').replace('-', '月') +
        '日からの業務が、まだ終わっていません（' +
        h +
        '時間）。終わらせますか？'
      );
    } catch (_) {
      return '';
    }
  }

  const api = { businessDay: businessDay, check: check, message: message };

  if (global) global.CarryOver = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
