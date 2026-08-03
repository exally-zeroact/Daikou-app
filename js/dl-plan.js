// ============================================================
// js/dl-plan.js
// ★オフライン地図を「どこまで落とすか」を決める★ 2026-08-03
//
//   ★司さんの報告から★
//     「初回ダウンロードもちゃんと出来んから設定の最新データを確認するおさな46県で止まる」
//     「完了するまでもくそ遅い」
//
//   ★実測で分かったこと★
//     設定の「最新データを確認」は ★47都道府県ぶん・合計204MB★ を落としていた。
//       roads-*.js 47件 = 204MB（1件平均4.3MB・最大は北海道の11.2MB）
//     パソコンの回線でも1件2〜2.5秒。携帯のWi-Fiなら1件10〜30秒。
//     ＝★10〜25分かかる★。
//     そして司さんが走るのは愛媛（roads-ehime.js = 4.4MB・1件）。
//     ★今治で代行しとる限り、残り46県・約200MBは一生使わない。★
//
//   ★だから「今いる県＋隣の県」だけにする★
//     隣を入れるのは、県境をまたいだ瞬間に地図が無い、を避けるため。
//     全国ぶんは今までどおり「全国」を選べば落とせる（長距離を走る時だけ）。
//
//   ▼このファイルは通信しない・距離も料金も触らない。★どれを落とすかを決めるだけ★。
// ============================================================
(function (global) {
  'use strict';

  // 隣り合う県（陸続き＋橋・フェリーで実際に代行が走る先）
  //   ★愛媛は「しまなみ海道で広島」「フェリーで大分」まで入れる★（実際に走るため）
  const NEIGHBORS = {
    hokkaido: ['aomori'],
    aomori: ['hokkaido', 'iwate', 'akita'],
    iwate: ['aomori', 'akita', 'miyagi'],
    miyagi: ['iwate', 'akita', 'yamagata', 'fukushima'],
    akita: ['aomori', 'iwate', 'miyagi', 'yamagata'],
    yamagata: ['akita', 'miyagi', 'fukushima', 'niigata'],
    fukushima: ['miyagi', 'yamagata', 'niigata', 'gunma', 'tochigi', 'ibaraki'],
    ibaraki: ['fukushima', 'tochigi', 'saitama', 'chiba'],
    tochigi: ['fukushima', 'gunma', 'saitama', 'ibaraki'],
    gunma: ['fukushima', 'niigata', 'nagano', 'saitama', 'tochigi'],
    saitama: ['gunma', 'tochigi', 'ibaraki', 'chiba', 'tokyo', 'yamanashi', 'nagano'],
    chiba: ['ibaraki', 'saitama', 'tokyo'],
    tokyo: ['saitama', 'chiba', 'kanagawa', 'yamanashi'],
    kanagawa: ['tokyo', 'yamanashi', 'shizuoka'],
    niigata: ['yamagata', 'fukushima', 'gunma', 'nagano', 'toyama'],
    toyama: ['niigata', 'nagano', 'gifu', 'ishikawa'],
    ishikawa: ['toyama', 'gifu', 'fukui'],
    fukui: ['ishikawa', 'gifu', 'shiga', 'kyoto'],
    yamanashi: ['saitama', 'tokyo', 'kanagawa', 'shizuoka', 'nagano'],
    nagano: ['niigata', 'gunma', 'saitama', 'yamanashi', 'shizuoka', 'aichi', 'gifu', 'toyama'],
    gifu: ['toyama', 'ishikawa', 'fukui', 'nagano', 'aichi', 'mie', 'shiga'],
    shizuoka: ['kanagawa', 'yamanashi', 'nagano', 'aichi'],
    aichi: ['nagano', 'shizuoka', 'gifu', 'mie'],
    mie: ['gifu', 'aichi', 'shiga', 'kyoto', 'nara', 'wakayama'],
    shiga: ['fukui', 'gifu', 'mie', 'kyoto'],
    kyoto: ['fukui', 'shiga', 'mie', 'nara', 'osaka', 'hyogo'],
    osaka: ['kyoto', 'nara', 'wakayama', 'hyogo'],
    hyogo: ['kyoto', 'osaka', 'tottori', 'okayama'],
    nara: ['kyoto', 'mie', 'osaka', 'wakayama'],
    wakayama: ['mie', 'nara', 'osaka'],
    tottori: ['hyogo', 'okayama', 'shimane', 'hiroshima'],
    shimane: ['tottori', 'hiroshima', 'yamaguchi'],
    okayama: ['hyogo', 'tottori', 'hiroshima', 'kagawa'],
    hiroshima: ['tottori', 'shimane', 'okayama', 'yamaguchi', 'ehime'],
    yamaguchi: ['shimane', 'hiroshima', 'fukuoka'],
    tokushima: ['kagawa', 'ehime', 'kochi'],
    kagawa: ['tokushima', 'ehime', 'kochi', 'okayama'],
    ehime: ['kagawa', 'tokushima', 'kochi', 'hiroshima', 'oita'],
    kochi: ['tokushima', 'kagawa', 'ehime'],
    fukuoka: ['yamaguchi', 'saga', 'kumamoto', 'oita'],
    saga: ['fukuoka', 'nagasaki'],
    nagasaki: ['saga'],
    kumamoto: ['fukuoka', 'oita', 'miyazaki', 'kagoshima'],
    oita: ['fukuoka', 'kumamoto', 'miyazaki', 'ehime'],
    miyazaki: ['kumamoto', 'oita', 'kagoshima'],
    kagoshima: ['kumamoto', 'miyazaki'],
    okinawa: [],
  };

  // 今いる県＋隣。県が分からない時は null を返す（呼び出し側が全国に落とす判断をする）
  function planFor(pref) {
    if (!pref || !NEIGHBORS[pref]) return null;
    const out = [pref];
    NEIGHBORS[pref].forEach(function (p) {
      if (out.indexOf(p) < 0) out.push(p);
    });
    return out;
  }

  // 落とす順番。★今いる県を必ず1番目★（先にこれが揃えば仕事は始められる）
  function orderFor(pref, all) {
    const near = planFor(pref);
    const list = Array.isArray(all) ? all.slice() : [];
    if (!near) return list;
    const rest = list.filter(function (p) {
      return near.indexOf(p) < 0;
    });
    return near
      .filter(function (p) {
        return list.indexOf(p) >= 0;
      })
      .concat(rest);
  }

  const api = {
    NEIGHBORS: NEIGHBORS,
    planFor: planFor,
    orderFor: orderFor,
  };

  if (global) global.DLPlan = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
