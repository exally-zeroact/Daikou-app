// ============================================================
// js/fare-history.js
// ★★料金を「変えた記録」と「1つ前に 戻す」★★ 2026-08-29
//
//   ▼なぜ 要るか（2026-08-29 実測）
//     今 料金を 保存する所は ★上書き 1件だけ★（js/firebase.js:346 set(config)）。
//     ＝★前が いくらだったか どこにも 残らず、間違えても 戻せません★。
//     C1 で 社長が 変えられるようにする＝★戻せない物を 触らせる★事なので、
//     ★戻す道を 先に 作りました★（試験は tests/gate-fare-history.js に 先に 書いてあります）。
//
//   ▼絶対に 動かさない物（借りた形＝js/trip-edit.js の 書き方）
//     ★距離★              … distance_m は 1バイトも 触らない
//     ★過去の請求★        … 運行ごとの 料金の写し(fare_config_snapshot)は 1件も 触らない
//                            ＝★今 過去の請求を 守っているのは これ 1つだけ★（締めが 無い）
//     ★走行中の凍結★      … 業務中は 料金を 変えない（この決まりを そのまま 使う）
//     ★代行係数 1.0085★   … 料金の画面から 触らせない
//
//   ▼残すのは 4つだけ
//     ★いつ★（時刻）／★誰が★（事務所のログインの メール）／★前★（丸ごと）／★後★（丸ごと）
//     ・★丸ごと★にする理由 … 差分だと ★戻す時に 組み立て直しが 要り、そこで 間違えます★。
//       料金表は 小さい（数百バイト）ので 丸ごとで 困りません。
//     ・★お客さんの情報・運行の中身は 1件も 入れません★
//
//   ▼決まり
//     ・★戻すのも「変えた事」として 記録に 残す★（誰が 戻したかが 消えない）
//     ・★戻せるのは 1つ前だけ★（何段も 戻れると 事故の元）
//     ・★直近 20件だけ 持つ★。21件目で ★古い物から 落ちる★が、
//       ★落ちた件数を 数える★＝★黙って 消えない★（指示役 2026-08-29）
//       ＝うちの決まり「#ERROR より『空になって 合計が 黙って 小さくなる』を 先に潰せ」
//     ・★書き出す物（客に見える物）には メールを 1件も 出さない★
//
//   ▼この file は ただの 入れ物です
//     ・通信しません／保存しません（呼ぶ側が 保存します）
//     ・★状態を 書き換えず、新しい状態を 返します★（元の物を 壊さない）
// ============================================================
(function (global) {
  'use strict';

  const MAX_KEN = 20; // ★直近 何件 持つか★

  function utsushi(o) {
    return o == null ? o : JSON.parse(JSON.stringify(o));
  }

  // ★はじめの状態を 作る★
  //   { config: 今の料金表, records: 記録の配列, soukouchuu: 走行中か }
  function hajime(moto) {
    const m = moto || {};
    return {
      config: utsushi(m.config) || null,
      records: Array.isArray(m.records) ? utsushi(m.records) : [],
      ochita: typeof m.ochita === 'number' ? m.ochita : 0, // ★落ちた件数★
      soukouchuu: m.soukouchuu === true,
    };
  }

  function ima(s) {
    return utsushi(s && s.config);
  }

  function kiroku(s) {
    return utsushi((s && s.records) || []);
  }

  // ★落ちた件数（黙って 消えていない事を 見せる為）★
  function ochitaKensuu(s) {
    return s && typeof s.ochita === 'number' ? s.ochita : 0;
  }

  // ★20件を 超えたら 古い物から 落とす。落ちた分を 数える★
  function kezuru(s) {
    const koeta = s.records.length - MAX_KEN;
    if (koeta > 0) {
      s.records = s.records.slice(koeta);
      s.ochita += koeta;
    }
    return s;
  }

  // ★料金表を 変える★（記録が 1件 増える）
  //   { config: 新しい料金表, dare: 誰が, itsu: いつ }
  function kaeru(s, hikisuu) {
    const moto = hajime(s);
    const h = hikisuu || {};
    // ★走行中は 変えない★（今ある決まりを そのまま 使う）
    if (moto.soukouchuu) return moto;
    if (h.config == null) return moto;
    moto.records.push({
      itsu: h.itsu != null ? h.itsu : null,
      dare: h.dare != null ? h.dare : null,
      mae: utsushi(moto.config),
      ato: utsushi(h.config),
      modoshi: false, // 戻した物かどうか
    });
    moto.config = utsushi(h.config);
    return kezuru(moto);
  }

  // ★1つ前に 戻す★（戻した事も 記録に 残る）
  function modosu(s, hikisuu) {
    const moto = hajime(s);
    const h = hikisuu || {};
    if (moto.soukouchuu) return moto; // ★走行中は 戻せない★
    if (!moto.records.length) return moto; // 戻る先が 無い
    const saigo = moto.records[moto.records.length - 1];
    if (saigo.mae == null) return moto;
    moto.records.push({
      itsu: h.itsu != null ? h.itsu : null,
      dare: h.dare != null ? h.dare : null,
      mae: utsushi(moto.config),
      ato: utsushi(saigo.mae),
      modoshi: true,
    });
    moto.config = utsushi(saigo.mae);
    return kezuru(moto);
  }

  // ★書き出す物（客に見える物）★
  //   ★メールは 1件も 出しません★（社内の記録には 残っています）
  //   ★お客さんの情報も 元から 入っていません★
  function kakidasu(s) {
    return kiroku(s).map(function (k) {
      return {
        itsu: k.itsu,
        modoshi: k.modoshi === true,
        // ★誰が は 出さない★（メールは 客に見える所へ 出さない・指示役 2026-08-29）
        mae_base_fare: k.mae ? k.mae.base_fare : null,
        ato_base_fare: k.ato ? k.ato.base_fare : null,
      };
    });
  }

  const api = {
    MAX_KEN: MAX_KEN,
    hajime: hajime,
    ima: ima,
    kiroku: kiroku,
    ochitaKensuu: ochitaKensuu,
    kaeru: kaeru,
    modosu: modosu,
    kakidasu: kakidasu,
  };

  if (global) global.FareHistory = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
