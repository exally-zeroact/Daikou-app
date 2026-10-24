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
//   │ 未収     │ 請求書 + 電子決済（まだ現金になっていない分）                       │
//   │ 現金     │ 売上合計 − 未収                                                   │
//   │ ZERO合計 │ 売上合計 − バイト合計 − 積立金 （バイトは 明細の 差引支給の 合計）    │
//   └─────────┴──────────────────────────────────────────┘
//
//   ▼★売上合計は「給料の母数」とは別物★（間違えやすいので注意）
//     給料の母数 = つかさ車を除いた売上（daiko-payroll の poolSales）
//     月次の売上合計 = つかさ車も入れた全部
//     実物もそう作られている（売上表!C = 計算!K + 計算!C − 計算!R）。
//
//   ▼電子決済 について
//     メーターは今「現金 / 請求書」しか区別していない。電子決済 は手入力で足す。
//
//   ▼絶対に守ること: throw しない・NaN を出さない・お金を丸めない（表示側で丸める）
//     ★給料だけは 例外★ 2026-10-23 件G：払う 額＝明細の 差引支給（人ごとに 丸めた 額）を 足す
//     （js/payroll-daily.js haraiGoukei）。日ごとの ZERO を 足した 物（ownerShareDaily）とは
//     丸めの 端数と 名簿外の 手当・控除の 分 ずれる（ownerShareDaily は 答え合わせ用に 残す）
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
      denshi: 0,
      unpaid: 0,
      cash: 0,
      ownerShare: 0,
      ownerShareDaily: 0,
      meisaiGai: 0, // 明細に 載らない 手当・控除の 件数（名簿に いない 人）2026-10-23 件G
      exTax: 0,
      tax: 0,
      shiftCount: 0,
      tripCount: 0,
    };
  }

  // ★1ヶ月ぶん★
  //   ctx      … PayrollDaily.buildCtx(...) の戻り
  //   payments … [{pay_date, invoice_yen, denshi_yen}]（手入力ぶん）
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
      // ★★締めの 形は 設定の 1か所（normSettings の periodKata）から★★ 2026-10-07
      //   読めない ⇒ ★止める★（out.dame・給料と 会社に残る分を 出さない）＝前は 0円で 黙って 進んだ
      //   ★形が 無い 時も 止める★（月3回に 倒さない・対立役 10-07 C）
      // 売上の 直しが 読めない 業務が 在れば 止める 2026-10-14（その 業務の 売上が 抜けた 額で 税・現金を 出さない）
      if (ctx.uriageDame && ctx.uriageDame.length) {
        out.dame = true;
        out.uriage = true; // 払い方の 設定とは 別の 止め（画面の 字を 分ける 印・字で 分けない）
        out.riyuu =
          '売上の 直しが 読めない 業務が ' +
          ctx.uriageDame.length +
          '件 あります。下の 帯の「入力」で その 日の 車を 開いて 直してください';
        return out;
      }
      // 役割の 決まりが 無くて 計算できない 人が 居れば 止める 2026-10-17（歩合0・保証0の 額で 出さない）
      if (ctx.yakuDame && ctx.yakuDame.length) {
        out.dame = true;
        // 売上から 引く 物の 記録（何日から）の 止めは 2026-10-24 件J で 無くした（もう 読まない）
        out.yaku = true; // 払い方の 設定とは 別の 止め（画面の 字を 分ける 印・字で 分けない）
        out.riyuu = ctx.yakuDameRiyuu || '役割の 決まりが 無くて 給料を 計算できない 人が 居ます';
        return out;
      }
      const kata = (ctx.settings && ctx.settings.periodKata) || {
        dame: true,
        riyuu: '払い方の 設定が ありません',
      };
      if (kata.dame) {
        out.dame = true;
        out.riyuu = kata.riyuu || '払い方の 設定が 読めません';
        out.tsushin = kata.tsushin === true;
        out.kiroku = kata.kiroku === true; // 締めの 変えた 記録を 読めなかった（画面の 字を 分ける 印）
        return out;
      }
      // ★締めの 形の 何日から★ 2026-10-19＝その月の 形（記録で 形が 混ざる 月は 'rireki'）
      const tsukiKata = Period.tsukiNoKata(kata, y, m);
      out.kind = tsukiKata ? tsukiKata.kind : 'rireki';
      out.kataKagi = tsukiKata ? JSON.stringify(tsukiKata) : '';
      const periods = Period.periodsOf(y, m, { kata: kata });
      // ★区切れない（記録の 道で 転んだ）＝止める★（0円で 黙って 進まない・対立役 止3）
      if (
        periods.some(function (p) {
          return p && p.dame;
        })
      ) {
        out.dame = true;
        // ★締めの 変え方で 空いた 月（期が 0）★＝0円で 黙って 進まない・訳を 分ける（2026-10-19・対立役 直5）
        if (periods.length === 1 && periods[0].aki) {
          out.aki = true;
          out.riyuu =
            y +
            '年' +
            m +
            '月分の 給料が 締めの 変え方で 無くなっています（給料は 毎月 払う 決まり）';
        } else out.riyuu = '締めの 変えた 記録から 期を 区切れません';
        return out;
      }
      periods.forEach(function (p) {
        // ★★給料は その月に 締めた 期の 全部の 日★★（司さん 10-07「イ」＝月を またぐ 期も 期の 全部）
        //   足し順は 今まで 通り（期の 中の 日 → 期の 小計 → 月）＝月3回の 数は ビットで 変わらない
        // ★★給料は 明細の 差引支給（人ごとに 丸めた 額）を 払う回ごとに 足す★★ 2026-10-23 件G
        //   前は 全員・全日を 丸めずに 足した＝明細を 全員分 足した 額と 数円 ずれた。
        //   決まりは js/payroll-daily.js の haraiGoukei 1つ（給料タブ・給料表の 紙も 同じ 物を 呼ぶ）
        //   名簿に いない 人の 手当・控除は 明細に 載らない＝合計に 入れず 数だけ 返す（帯を 出す）
        const ds = arr(p.dates);
        const rep = Daily.report(ds, ctx);
        const pay = Daily.haraiGoukei ? Daily.haraiGoukei(rep) : 0;
        out.meisaiGai += arr(rep.meisaiGai).length;
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

      // ── 未収（請求書 / 電子決済）──
      arr(payments).forEach(function (p) {
        if (!p || !inMonth[p.pay_date]) return;
        out.invoice += n(p.invoice_yen);
        out.denshi += n(p.denshi_yen);
      });
      out.unpaid = out.invoice + out.denshi;
      out.cash = out.salesTotal - out.unpaid;

      // ── 会社に残る分 ──（給料は 丸めた 額＝明細の 差引支給の 合計）
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
        'denshi',
        'unpaid',
        'cash',
        'ownerShare',
        'ownerShareDaily',
        'meisaiGai',
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
      // 期ごとの年間合計（★月の 締め日の 並び（月3回 等）だけ★＝週・毎日は 何番目に 意味が 無い）
      out.months.forEach(function (mm) {
        if (mm.dame) {
          out.total.dame = true;
          out.total.riyuu = mm.riyuu;
          out.total.tsushin = mm.tsushin === true;
          out.total.kiroku = mm.kiroku === true;
          out.total.aki = mm.aki === true;
          if (mm.uriage) out.total.uriage = true;
          if (mm.yaku) out.total.yaku = true;
        }
      });
      const byIdx = {};
      // ★形が 変わった 年は 期ごとの 合計を 出さない★ 2026-10-19（違う 区切りの n回目を 同じ 列に 足さない・対立役 直2）
      const kagi = {};
      out.months.forEach(function (mm) {
        if (!mm.dame) kagi[mm.kataKagi || ''] = 1;
      });
      const hitotsu = Object.keys(kagi).length <= 1 && !kagi[''];
      out.months.forEach(function (mm) {
        if (!hitotsu) return;
        if (mm.kind !== 'thirds' && mm.kind !== 'tsuki') return;
        arr(mm.periods).forEach(function (p) {
          if (!byIdx[p.index])
            byIdx[p.index] = {
              index: p.index,
              // ★月を またぐ 期は 月ごとに 日付が 違う＝年の 列は「n回目」★
              name:
                String(p.start).slice(0, 7) !== String(p.end).slice(0, 7)
                  ? p.index + 1 + '回目'
                  : p.name,
              pay: 0,
            };
          byIdx[p.index].pay += n(p.pay);
        });
      });
      out.total.periods = Object.keys(byIdx)
        .sort(function (a, b) {
          return Number(a) - Number(b);
        })
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
