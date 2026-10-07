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
      // ★★締めの 形（kata）が 来たら そちらだけ★★ 2026-10-07（画面・集計は 全部 これ）
      if (opts && opts.kata) return kataPeriods(y, m, opts.kata);
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

  // ============================================================
  // ★★締めの 形（period_shime）★★ 2026-10-07
  //   司さん「この払い方がまだ対応できてないやろが」（月3回／月1回／日数 の 3つ だけ だった）
  //   司さんの 決め（10-07）: 何月分と 呼ぶかは ★会社が 選ぶ★（nazuke）・月次の 給料は 締めた 分
  //   形:
  //     {kind:'tsuki', hi:[10,20,0], nazuke}  締め日の 並び（0＝末日・その月に 無い 日は 末日）
  //     {kind:'shuu', youbi:0..6(0=日), nazuke} 週1回
  //     {kind:'hi'}                              毎日
  //     nazuke: 'shime'＝締めた 日の 月の 分 ／ 'hajime'＝始まった 日の 月の 分
  //   ★期が 月を またぐ 形で nazuke が 無い ⇒ 止める★（既定で 決め打ちしない）
  //   読み方は yomu だけ（壊れた・知らない・昔の month_end/days ⇒ dame＝止めて 警告）
  // ============================================================
  const NAZUKE = { shime: 1, hajime: 1 };
  function dame(riyuu) {
    return { dame: true, riyuu: riyuu };
  }
  function seisu(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  }
  // 締めの 形を 確かめて 整える（壊れて いれば dame）
  function seiki(sh) {
    if (!sh || typeof sh !== 'object') return dame('締めの 形が 読めません');
    if (sh.kind === 'hi') return { ok: true, kata: { kind: 'hi' } };
    if (sh.kind === 'tsuki') {
      if (!Array.isArray(sh.hi) || !sh.hi.length || sh.hi.length > 31)
        return dame('締め日が 入っていません');
      const seen = {};
      const hi = [];
      for (let i = 0; i < sh.hi.length; i++) {
        const h = sh.hi[i];
        if (!seisu(h) || h < 0 || h > 31) return dame('締め日が おかしい: ' + h);
        const k = h === 31 ? 0 : h; // 31日締め ＝ 末日締め
        if (!seen[k]) {
          seen[k] = 1;
          hi.push(k);
        }
      }
      hi.sort(function (a, b) {
        return (a || 99) - (b || 99);
      });
      // ★今の 月3回（1〜10／11〜20／21〜末日）と 同じ 形は 今の 道を そのまま 通す★
      if (hi.length === 3 && hi[0] === 10 && hi[1] === 20 && hi[2] === 0)
        return { ok: true, kata: { kind: 'thirds' } };
      const kosu = hi[hi.length - 1] !== 0; // 最後が 末日で ない ＝ 月を またぐ 期が ある
      if (kosu && !NAZUKE[sh.nazuke]) return dame('何月分と 呼ぶかが 決まっていません');
      return { ok: true, kata: { kind: 'tsuki', hi: hi, nazuke: kosu ? sh.nazuke : 'shime' } };
    }
    if (sh.kind === 'shuu') {
      if (!seisu(sh.youbi) || sh.youbi < 0 || sh.youbi > 6) return dame('締めの 曜日が おかしい');
      if (!NAZUKE[sh.nazuke]) return dame('何月分と 呼ぶかが 決まっていません');
      return { ok: true, kata: { kind: 'shuu', youbi: sh.youbi, nazuke: sh.nazuke } };
    }
    return dame('知らない 締めの 形: ' + String(sh.kind));
  }
  // ★会社の 設定の 行から 締めの 形を 読む（ここ 1か所）★
  function yomu(row) {
    try {
      if (!row || typeof row !== 'object') return { ok: true, kata: { kind: 'thirds' } };
      // ★設定の 行を 読めなかった（通信）＝行が 無い（新しい 会社＝月3回）とは 別★（対立役 10-07 D）
      if (row.yomenai === true) return dame('給料の 設定を 読めませんでした（通信）');
      const sh = row.period_shime;
      if (sh !== null && sh !== undefined) return seiki(sh); // ★壊れて いても 昔の 列へ 戻らない★
      const m = row.period_end_mode;
      if (m === 'thirds' || m === '' || m === null || m === undefined)
        return { ok: true, kata: { kind: 'thirds' } };
      // ★昔の month_end／days・知らない 値 は 区切りを 黙って 変えない＝止める★（本番 0社・10-07）
      return dame('払い方の 設定（' + String(m) + '）が 今の 作りでは 読めません');
    } catch (_) {
      return dame('払い方の 設定が 読めません');
    }
  }

  function addDays(d, k) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + k);
  }
  function ymKey(d) {
    return d.getFullYear() * 12 + d.getMonth();
  }
  // 締め日（Date）の 並び → 期（start〜end）
  function kugiru(shimebi) {
    const out = [];
    for (let i = 1; i < shimebi.length; i++) {
      out.push({ start: addDays(shimebi[i - 1], 1), end: shimebi[i] });
    }
    return out;
  }
  function kataPeriods(y, m, kata) {
    try {
      if (!kata || kata.dame) return [];
      if (kata.kind === 'thirds') return periodsOf(y, m, { endMode: 'thirds' });
      const last = daysInMonth(y, m);
      const me = y * 12 + (m - 1);
      let kikan = [];
      if (kata.kind === 'hi') {
        for (let d = 1; d <= last; d++) {
          const t = new Date(y, m - 1, d);
          kikan.push({ start: t, end: t });
        }
      } else {
        const shimebi = [];
        if (kata.kind === 'tsuki') {
          for (let k = -3; k <= 3; k++) {
            const t = new Date(y, m - 1 + k, 1);
            const ty = t.getFullYear();
            const tm = t.getMonth() + 1;
            const tl = daysInMonth(ty, tm);
            const seen = {};
            kata.hi.forEach(function (h) {
              const d = h === 0 ? tl : Math.min(h, tl);
              if (!seen[d]) {
                seen[d] = 1;
                shimebi.push(new Date(ty, tm - 1, d));
              }
            });
          }
        } else if (kata.kind === 'shuu') {
          let t = new Date(y, m - 1 - 3, 1);
          while (t.getDay() !== kata.youbi) t = addDays(t, 1);
          const owari = new Date(y, m + 3, 1);
          for (; t < owari; t = addDays(t, 7)) shimebi.push(t);
        } else {
          return [];
        }
        shimebi.sort(function (a, b) {
          return a - b;
        });
        kikan = kugiru(shimebi).filter(function (p) {
          const doko = kata.nazuke === 'hajime' ? p.start : p.end;
          return ymKey(doko) === me;
        });
      }
      return kikan.map(function (p, i) {
        const days = Math.round((p.end - p.start) / 86400000) + 1;
        const dates = [];
        for (let k = 0; k < days; k++) dates.push(ymd(addDays(p.start, k)));
        const naka = ymKey(p.start) === me && ymKey(p.end) === me;
        const rangeLabel = md(p.start) + ' ~ ' + md(p.end);
        let name;
        if (kata.kind === 'hi') name = p.start.getDate() + '日';
        else if (!naka) name = rangeLabel;
        else if (p.end.getDate() === last) name = p.start.getDate() + '日〜末日';
        else name = p.start.getDate() + '〜' + p.end.getDate() + '日';
        return {
          year: y,
          month: m,
          index: i,
          name: name,
          startDay: p.start.getDate(),
          endMode: 'shime',
          kind: kata.kind,
          days: days,
          label: m + '月分',
          rangeLabel: rangeLabel,
          start: ymd(p.start),
          end: ymd(p.end),
          dates: dates,
        };
      });
    } catch (_) {
      return [];
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
    yomu: yomu,
    seiki: seiki,
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
