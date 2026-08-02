// ============================================================
// js/payroll-period.js
// ★給与期間の区切り（司さんの実物と同じ）2026-08-01★
//
//   司さんの「代行計算表2026.xlsb」の給料1〜8 を全部読んで確かめた作り:
//     給料1 = 1月分 1/21 ~ 1/31 (11日)
//     給料2 = 2月分 2/21 ~ 2/28 ( 8日)  ← ★3月に食い込まない★
//     給料3 = 3月分 3/21 ~ 3/31 (11日)
//     給料4 = 4月分 4/21 ~ 4/30 (10日)
//     給料8 = 8月分 8/1  ~ 8/10 (10日)  ← 開始日も長さも変えられる必要がある
//
//   ★つまり「毎回11日分」ではない。「21日から その月の末日まで」＝月末締め★
//     長さは月によって 8日〜11日 と変わる。
//     （日数を11で固定すると、2月分の明細に3月1日〜3日が混ざって金額が合わなくなる）
//
//   ★2026-08-01 追記: 実物の『月別』シートを読んで、もう1つ分かった★
//     月別シートの列が「バ1～10 / バ11～20 / バ21～31」だった。
//     そして **バ21～31 = 279,332 は 給料1(21日〜末日)の8人の合計とぴったり一致する**。
//     ＝★司さんは給料を月3回に分けて払っている（1〜10日 / 11〜20日 / 21〜末日）★
//     給料1〜8 に「21日〜末日」しか無かったのは、それが3期のうちの1つだったから。
//     → endMode='thirds'（既定）で 1ヶ月＝3期を返す。
//
//   ▼設定で変えられる（他のユーザー用）
//     endMode … 'thirds'(既定・月3回払い) / 'month_end'(起算日〜末日で1回) / 'days'(日数で切る)
//     startDay … 起算日（'month_end'/'days' のとき。既定21日）
//     days     … endMode='days' のときの日数
//   ▼throw しない・うるう年でも落ちない
// ============================================================
(function (global) {
  'use strict';

  const DEFAULT_START_DAY = 21; // 'month_end'/'days' のときの既定
  const DEFAULT_END_MODE = 'thirds'; // ★司さん = 月3回払い★
  const DEFAULT_DAYS = 11; // endMode='days' のときの既定
  // ★月3回払いの区切り（実物の月別シート「バ1～10 / バ11～20 / バ21～31」）★
  const THIRDS = [
    { from: 1, to: 10, name: '1〜10日' },
    { from: 11, to: 20, name: '11〜20日' },
    { from: 21, to: 0, name: '21日〜末日' }, // to=0 は月末まで
  ];

  function n(v, d) {
    const x = typeof v === 'number' ? v : parseInt(v, 10);
    return isFinite(x) ? x : d;
  }

  function pad(x) {
    return x < 10 ? '0' + x : String(x);
  }
  function ymd(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function md(d) {
    return d.getMonth() + 1 + '/' + d.getDate();
  }

  // その月の日数（うるう年もこれで正しく出る）
  function daysInMonth(year, month1) {
    return new Date(year, month1, 0).getDate();
  }

  function emptyPeriod() {
    return {
      year: 0,
      month: 0,
      index: 0,
      name: '',
      startDay: DEFAULT_START_DAY,
      endMode: DEFAULT_END_MODE,
      days: 0,
      label: '',
      rangeLabel: '',
      start: '',
      end: '',
      dates: [],
    };
  }

  // 起算日と日数から1つぶんを組み立てる
  function build(y, m, startDay, days, index, name, endMode) {
    const start = new Date(y, m - 1, startDay);
    const dates = [];
    for (let i = 0; i < days; i++) {
      // 月をまたいでも Date が繰り上げる（endMode='days' のとき）
      dates.push(ymd(new Date(y, m - 1, startDay + i)));
    }
    const last = new Date(y, m - 1, startDay + days - 1);
    return {
      year: y,
      month: m,
      index: index,
      name: name,
      startDay: startDay,
      endMode: endMode,
      days: days,
      label: m + '月分',
      rangeLabel: md(start) + ' ~ ' + md(last),
      start: ymd(start),
      end: ymd(last),
      dates: dates,
    };
  }

  // ★その月の期間を全部返す（月3回払いなら3つ、それ以外は1つ）★
  function periodsOf(year, month, opts) {
    try {
      const now = new Date();
      const y = n(year, now.getFullYear());
      const m = n(month, now.getMonth() + 1);
      const raw = opts && opts.endMode;
      const endMode = raw === 'days' || raw === 'month_end' ? raw : DEFAULT_END_MODE;

      if (endMode === 'thirds') {
        const last = daysInMonth(y, m);
        return THIRDS.map(function (t, i) {
          const to = t.to > 0 ? Math.min(t.to, last) : last;
          const days = Math.max(1, to - t.from + 1);
          return build(y, m, t.from, days, i, t.name, endMode);
        });
      }

      let startDay = n(opts && opts.startDay, DEFAULT_START_DAY);
      if (!(startDay >= 1 && startDay <= 28)) startDay = DEFAULT_START_DAY;

      let days;
      if (endMode === 'days') {
        days = n(opts && opts.days, DEFAULT_DAYS);
        if (!(days >= 1 && days <= 62)) days = DEFAULT_DAYS;
      } else {
        // 月末締め: 起算日からその月の末日まで
        days = daysInMonth(y, m) - startDay + 1;
        if (!(days >= 1)) days = 1;
      }
      return [build(y, m, startDay, days, 0, startDay + '日〜', endMode)];
    } catch (_) {
      return [emptyPeriod()];
    }
  }

  // その月の期間を1つ取り出す（index を省いたら最初の期）
  function periodOf(year, month, opts, index) {
    try {
      const list = periodsOf(year, month, opts);
      const i = n(index, 0);
      return list[i >= 0 && i < list.length ? i : 0] || emptyPeriod();
    } catch (_) {
      return emptyPeriod();
    }
  }

  // その月ぜんぶの日付（月次集計はこれを使う。期の切り方に左右されない）
  function monthDates(year, month) {
    try {
      const now = new Date();
      const y = n(year, now.getFullYear());
      const m = n(month, now.getMonth() + 1);
      const last = daysInMonth(y, m);
      const out = [];
      for (let d = 1; d <= last; d++) out.push(ymd(new Date(y, m - 1, d)));
      return out;
    } catch (_) {
      return [];
    }
  }

  // 月を前後に送る
  function shift(ym, delta) {
    try {
      const y = n(ym && ym.year, new Date().getFullYear());
      const m = n(ym && ym.month, new Date().getMonth() + 1);
      const d = n(delta, 0);
      const t = new Date(y, m - 1 + d, 1);
      return { year: t.getFullYear(), month: t.getMonth() + 1 };
    } catch (_) {
      return { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
    }
  }

  const api = {
    DEFAULT_START_DAY: DEFAULT_START_DAY,
    DEFAULT_END_MODE: DEFAULT_END_MODE,
    DEFAULT_DAYS: DEFAULT_DAYS,
    THIRDS: THIRDS,
    daysInMonth: daysInMonth,
    periodsOf: periodsOf,
    periodOf: periodOf,
    monthDates: monthDates,
    shift: shift,
  };

  if (global) global.PayrollPeriod = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
