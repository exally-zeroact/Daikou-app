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
  function kaisha(name, year, month, payrollSettings, salesSettings, kinds, denshiAri) {
    let ks = [];
    const s = salesSettings || {};
    // ★古い 3つは 売上設定の チェックで 引く／引かない が 決まる★
    (kinds || []).forEach(function (k) {
      if (!k || k.deleted_at) return;
      const id = k.kind_id;
      const hiku =
        id === 'toll'
          ? s.deduct_toll !== false
          : id === 'bridge'
            ? s.deduct_bridge !== false
            : id === 'other'
              ? s.deduct_other === true
              : true; // ★会社が 足した 物は いつも 引く★（apply-jippi-jiyuu.sql の 決まり）
      ks.push({ label: k.label, hiku: !!hiku });
    });
    if (!ks.length) {
      ks = [
        { label: '高速代', hiku: s.deduct_toll !== false },
        { label: '橋代', hiku: s.deduct_bridge !== false },
        { label: s.other_label || 'その他', hiku: s.deduct_other === true },
      ];
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
      kyuryoNamae: (m.periods || []).map(function (p) {
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
