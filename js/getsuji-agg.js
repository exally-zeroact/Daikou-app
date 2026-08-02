// ============================================================
// js/getsuji-agg.js
// ★月次集計（司さんの実物『月別』シートと同じ物を作る）2026-08-01★
//
//   実物 代行計算表2026.xlsb の『月別』シートを1列ずつ数式で読んで、何で出来ているか確かめた。
//   1月まるごとの実データで全部の列が一致することを確認済み。
//
//   ┌ 月別の列 ┬ 作り方 ─────────────────────────────────┐
//   │ 売上合計 │ Σ(全車の売上 − 実費)  ★つかさ車も入る★（給料の母数とは違う）      │
//   │ バ1〜10  │ その期(1〜10日)の全員の給料合計                                   │
//   │ バ11〜20 │ その期(11〜20日)の全員の給料合計   ★司さんは月3回払い★           │
//   │ バ21〜末 │ その期(21日〜末日)の全員の給料合計                                │
//   │ バイト合計│ 3期の合計                                                        │
//   │ 経費     │ Σ(高速代・橋代・その他 = 手入力の実費ぜんぶ)                      │
//   │ 積立金   │ Σ(積立 + つかさ積立)                                              │
//   │ 未収     │ 請求書 + PayPay（まだ現金になっていない分）                       │
//   │ 現金     │ 売上合計 − 未収                                                   │
//   │ ZERO合計 │ 売上合計 − バイト合計 − 積立金 （日ごとのZEROの合計と一致する）    │
//   └─────────┴──────────────────────────────────────────┘
//
//   ▼★売上合計は「給料の母数」とは別物★（間違えやすいので注意）
//     給料の母数 = つかさ車を除いた売上（daiko-payroll の poolSales）
//     月次の売上合計 = つかさ車も入れた全部
//     実物もそう作られている（売上表!C = 計算!K + 計算!C − 計算!R）。
//
//   ▼PayPay について
//     メーターは今「現金 / 請求書」しか区別していない。PayPay は手入力で足す。
//
//   ▼絶対に守ること: throw しない・NaN を出さない・お金を丸めない（表示側で丸める）
// ============================================================
(function (global) {
  'use strict';

  function _need(name, path) {
    try {
      if (global && global[name]) return global[name];
    } catch (_) {
      /* ignore */
    }
    try {
      if (typeof require === 'function') {
        // eslint-disable-next-line no-undef, global-require
        return require(path);
      }
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  function n(v) {
    const x = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(x) ? x : 0;
  }
  function arr(v) {
    return Array.isArray(v) ? v : [];
  }

  function emptyMonth(year, month) {
    return {
      year: n(year),
      month: n(month),
      label: n(month) + '月',
      salesTotal: 0,
      expense: 0,
      reserve: 0,
      periods: [],
      payTotal: 0,
      invoice: 0,
      paypay: 0,
      unpaid: 0,
      cash: 0,
      ownerShare: 0,
      ownerShareDaily: 0,
      exTax: 0,
      tax: 0,
      shiftCount: 0,
      tripCount: 0,
    };
  }

  // ★1ヶ月ぶん★
  //   ctx      … PayrollDaily.buildCtx(...) の戻り
  //   payments … [{pay_date, invoice_yen, paypay_yen}]（手入力ぶん）
  function month(year, month_, ctx, payments) {
    const out = emptyMonth(year, month_);
    try {
      const Period = _need('PayrollPeriod', './payroll-period.js');
      const Daily = _need('PayrollDaily', './payroll-daily.js');
      if (!Period || !Daily || !ctx) return out;

      const y = out.year;
      const m = out.month;
      const dates = Period.monthDates(y, m);
      const inMonth = {};
      dates.forEach(function (d) {
        inMonth[d] = true;
      });

      // ── 売上と実費（★つかさ車も入れて全部★）──
      dates.forEach(function (date) {
        const cars = (ctx.byDate && ctx.byDate[date]) || {};
        Object.keys(cars).forEach(function (dev) {
          const c = cars[dev];
          out.salesTotal += n(c.sales) - n(c.expense); // 実費を引いた後
          out.expense += n(c.expense);
        });
      });

      // ── 給料（期ごと）と 積立・ZERO ──
      const periods = Period.periodsOf(y, m, {
        endMode: ctx.settings && ctx.settings.periodEndMode,
        startDay: ctx.settings && ctx.settings.periodStartDay,
        days: ctx.settings && ctx.settings.periodDays,
      });
      periods.forEach(function (p) {
        // ★期が月をまたぐ設定でも、月次集計はその月の日だけ数える★
        const ds = arr(p.dates).filter(function (d) {
          return inMonth[d];
        });
        let pay = 0;
        ds.forEach(function (date) {
          const day = Daily.computeDay(date, ctx);
          pay += n(day.staffTotal);
        });
        out.periods.push({
          index: p.index,
          name: p.name,
          rangeLabel: p.rangeLabel,
          start: p.start,
          end: p.end,
          pay: pay,
        });
        out.payTotal += pay;
      });

      // 積立と、日ごとのZEROの合計（答え合わせ用）
      dates.forEach(function (date) {
        const day = Daily.computeDay(date, ctx);
        out.reserve += n(day.reservePool) + n(day.reserveOwner);
        out.ownerShareDaily += n(day.ownerShare);
        out.shiftCount += arr(day.cars).length + (day.owner && day.owner.sales ? 1 : 0);
      });

      // ── 未収（請求書 / PayPay）──
      arr(payments).forEach(function (p) {
        if (!p || !inMonth[p.pay_date]) return;
        out.invoice += n(p.invoice_yen);
        out.paypay += n(p.paypay_yen);
      });
      out.unpaid = out.invoice + out.paypay;
      out.cash = out.salesTotal - out.unpaid;

      // ── 会社に残る分 ──
      out.ownerShare = out.salesTotal - out.payTotal - out.reserve;

      // ── 税（実物の売上表と同じ 内税10%）──
      out.exTax = out.salesTotal / 1.1;
      out.tax = (out.salesTotal * 0.1) / 1.1;
    } catch (_) {
      /* ignore: 壊れたデータでも0で返す */
    }
    return out;
  }

  // ★1年ぶん（1月〜12月＋合計）★
  function year(y, ctx, payments) {
    const out = { year: n(y), months: [], total: emptyMonth(n(y), 0) };
    try {
      for (let m = 1; m <= 12; m++) out.months.push(month(y, m, ctx, payments));
      const keys = [
        'salesTotal',
        'expense',
        'reserve',
        'payTotal',
        'invoice',
        'paypay',
        'unpaid',
        'cash',
        'ownerShare',
        'ownerShareDaily',
        'exTax',
        'tax',
        'shiftCount',
        'tripCount',
      ];
      out.months.forEach(function (mm) {
        keys.forEach(function (k) {
          out.total[k] += n(mm[k]);
        });
      });
      out.total.label = '合計';
      // 期ごとの年間合計
      const byIdx = {};
      out.months.forEach(function (mm) {
        arr(mm.periods).forEach(function (p) {
          if (!byIdx[p.index]) byIdx[p.index] = { index: p.index, name: p.name, pay: 0 };
          byIdx[p.index].pay += n(p.pay);
        });
      });
      out.total.periods = Object.keys(byIdx)
        .sort()
        .map(function (k) {
          return byIdx[k];
        });
    } catch (_) {
      /* ignore */
    }
    return out;
  }

  const api = { month: month, year: year, emptyMonth: emptyMonth };

  if (global) global.GetsujiAgg = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
