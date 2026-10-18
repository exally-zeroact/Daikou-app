'use strict';
// ============================================================
// ★★月次集計の 画面 → 紙（A4のPDF）へ 渡す★★ 2026-09-25
//
//   ★司さん★「集計全部を…月で選んだら 項目別で その場で A4サイズPDFで 見せれるようにしろ」
//
//   ★★数え直さない★★
//     紙は ★画面が 既に 出した 数（GetsujiAgg / CTX）を そのまま★ 使う。
//     自分で SQL や 足し算を やり直すと ★紙と 画面で 数が 食い違う★。
//     （2026-09-25 実測：私が SQL で 数え直したら 9月の 請求書が
//       128,300 に なった。画面は 133,500。訳＝倉庫は UTC・アプリは 日本時間）
//
//   ★出す 紙（この 画面から）★
//     ①月次集計（月）②売上表（月・年）③回数・距離（月・年）
//
//   ★見張り★ tests/unit/kami-shukei.test.js
// ============================================================

(function (global) {
  function n(v) {
    const x = Number(v);
    return isFinite(x) ? x : 0;
  }

  // ★会社の 設定を 1つの 形に まとめる★（紙は これだけ 見る＝焼き付け 0）
  //   kumi … 売上から 引く 物の 記録（UriageAgg.rirekiKumu の 返り値・ctx.uriageKumi）2026-10-18
  //     ★月の 中で 引く／引かないが 変わる 物は 引いた 日の 幅を 名前に 付ける★（「高速代（1〜14日）」）
  function kaisha(name, year, month, payrollSettings, salesSettings, kinds, denshiAri, kumi) {
    const ks = [];
    const s = salesSettings || {};
    const retsu = {
      toll: s.deduct_toll !== false,
      bridge: s.deduct_bridge !== false,
      other: s.deduct_other === true,
    };
    // 古い 3つの その 月の 引き方（月の 全部の 日で 同じ なら 真偽・変わる なら 引いた 日の 幅の 字）
    function tsukiNo(id) {
      const l = kumi && Array.isArray(kumi[id]) ? kumi[id] : [];
      if (!l.length) return retsu[id];
      const y = n(year);
      const m = n(month);
      const sue = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const pre = y + '-' + ('0' + m).slice(-2) + '-';
      // ★その 日の 引き方は 計算と 同じ 1か所（UriageAgg.settingsOnDay）★（対立役 直4）
      const U =
        (global && global.UriageAgg) ||
        (typeof require === 'function' ? require('./uriage-agg.js') : null); // eslint-disable-line no-undef
      const hi = [];
      for (let d = 1; d <= sue; d++) {
        const ymd = pre + ('0' + d).slice(-2);
        hi.push(!!U.settingsOnDay(salesSettings, kumi, ymd)['deduct_' + id]);
      }
      if (hi.every(Boolean)) return true;
      if (!hi.some(Boolean)) return false;
      const haba = [];
      let kara = 0;
      for (let d = 1; d <= sue + 1; d++) {
        const v = d <= sue && hi[d - 1];
        if (v && !kara) kara = d;
        if (!v && kara) {
          haba.push(kara === d - 1 ? kara + '日' : kara + '〜' + (d - 1) + '日');
          kara = 0;
        }
      }
      return '（' + haba.join('・') + '）';
    }
    function oshi(label, h) {
      ks.push(
        typeof h === 'string' ? { label: label + h, hiku: true } : { label: label, hiku: !!h }
      );
    }
    // ★古い 3つは 売上設定の チェックで 引く／引かない が 決まる★
    (kinds || []).forEach(function (k) {
      if (!k || k.deleted_at) return;
      const id = k.kind_id;
      if (id === 'toll' || id === 'bridge' || id === 'other') oshi(k.label, tsukiNo(id));
      else ks.push({ label: k.label, hiku: true }); // ★会社が 足した 物は いつも 引く★（apply-jippi-jiyuu.sql の 決まり）
    });
    if (!ks.length) {
      oshi('高速代', tsukiNo('toll'));
      oshi('橋代', tsukiNo('bridge'));
      oshi(s.other_label || 'その他', tsukiNo('other'));
    }
    return {
      name: name || '',
      year: n(year),
      month: n(month),
      settings: payrollSettings || null,
      kinds: ks,
      denshi: !!denshiAri,
    };
  }

  // ★月次集計（GetsujiAgg.month の 出した 物を そのまま）★
  function getsujiData(m, cars) {
    m = m || {};
    // ★払い方（締め）が 読めない 月は 紙を 作らない★ 2026-10-07（給料 0・残る分 0 を 印字しない）
    if (m.dame) throw new Error(m.riyuu || '払い方の 設定が 読めません');
    return {
      uriage: n(m.salesTotal),
      keihi: n(m.expense),
      seikyu: n(m.invoice),
      denshi: n(m.denshi),
      genkin: n(m.cash),
      kyuryo: n(m.payTotal),
      // ★期間の 金額と 名前は 画面が 既に 持っている★（GetsujiAgg の out.periods）
      //   ＝自分で 区切り直さない（payByPeriod という 名前は 無かった・実物は periods）
      kyuryoKikan: (m.periods || []).map(function (p) {
        return n(p.pay);
      }),
      // ★毎日 払いは 期の 行を 並べない★ 2026-10-07（31行は 紙に 入らない＝合計 1行）
      kyuryoNamae: (m.kind === 'hi' ? [] : m.periods || []).map(function (p) {
        return p.rangeLabel || p.name || '';
      }),
      tsumitate: n(m.reserve),
      nokori: n(m.ownerShare),
      cars: cars || [],
    };
  }

  // ★売上表（月）★
  function uriageTsukiData(m, cars, hi) {
    m = m || {};
    return {
      uriage: n(m.salesTotal),
      keihi: n(m.expense),
      seikyu: n(m.invoice),
      denshi: n(m.denshi),
      genkin: n(m.cash),
      cars: cars || [],
      hi: hi || {},
    };
  }

  // ★売上表（年）＝12か月ぶん★
  function uriageNenData(yr) {
    const tsuki = {};
    ((yr && yr.months) || []).forEach(function (m) {
      if (!m || !m.month) return;
      // ★その月に 何も 無ければ 行を 作らない★（横棒で 出る）
      if (!n(m.salesTotal) && !n(m.invoice) && !n(m.denshi) && !n(m.expense)) return;
      tsuki[m.month] = {
        uriage: n(m.salesTotal),
        genkin: n(m.cash),
        seikyu: n(m.invoice),
        denshi: n(m.denshi),
        keihi: n(m.expense),
      };
    });
    const t = (yr && yr.total) || {};
    return {
      tsuki: tsuki,
      total: {
        uriage: n(t.salesTotal),
        genkin: n(t.cash),
        seikyu: n(t.invoice),
        denshi: n(t.denshi),
        keihi: n(t.expense),
      },
    };
  }

  const api = {
    kaisha: kaisha,
    getsujiData: getsujiData,
    uriageTsukiData: uriageTsukiData,
    uriageNenData: uriageNenData,
  };
  if (typeof global !== 'undefined') global.KamiShukei = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
