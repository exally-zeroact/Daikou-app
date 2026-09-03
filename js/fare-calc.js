// ============================================================
// js/fare-calc.js
// ★★料金の 計算 だけ★★ 2026-08-31
//
//   ★なぜ 分けたか（司さん「②やれ」）★
//     事務所の 料金表画面に ★「1km いくら・10km いくら」の 見本★を 付けたい。
//     でも
//       ・お金の 計算を 画面に ★書き写すのは 禁止★
//         （2か所に なると ★片方だけ 直って 金額が ずれます★）
//       ・メーターの js/meter.js を ★事務所に 出すのも 禁止★
//         （2026-08-02 の 事故＝事務所から メーターの 中身が 丸見えだった。
//           tests/unit/office-allow-list.test.js が 機械で 止めています）
//     ⇒ ★料金の 計算だけを ここへ 出しました★。メーターも 事務所も ★ここ 1か所★を 呼びます。
//
//   ★★式も 定数も 1文字も 変えていません★★
//     js/meter.js の calcFare / _calcAutoSurchargeMultiplier を
//     ★そのまま 持ってきて、外から 渡す物の 名前だけ 変えました★:
//       fareConfig          → config
//       _activeVehicleId    → vehicleId
//       _activeSurchargeIds → surchargeIds
//       state.wait_sec      → waitSec
//       new Date()          → now（呼ぶ側が 渡す）
//     ★段の 順番（距離→車種→手動割増→自動割増→待ち→下限上限→丸め）も そのまま★
//
//   ★★距離(distance_m)には 1mmも 触っていません★★
//     ここは ★距離を 受け取って 円を 返すだけ★です。
//
//   ★確かめ方★ tests/unit/fare-calc-onaji.test.js
//     ★変える前の meter.js を 先に 複製★し（scratchpad/moto/meter-MOTO-2026-08-31.js）、
//     ★同じ入力で 1円でも ずれたら 赤★に します。
// ============================================================
const FareCalc = (() => {
  'use strict';

  // autoSurcharges 自動判定: 現在時刻に該当する全 auto rule の rate 積
  function _autoMul(config, now) {
    if (!config.autoSurcharges) return 1.0;
    let mul = 1.0;
    const a = config.autoSurcharges;
    // night: 時刻範囲 (wraparound 対応)
    if (a.night && a.night.enabled) {
      const h = now.getHours();
      const f = a.night.from,
        t = a.night.to;
      const inRange = f <= t ? h >= f && h < t : h >= f || h < t;
      if (inRange && typeof a.night.rate === 'number') mul *= a.night.rate;
    }
    // weekend: 土日固定
    if (a.weekend && a.weekend.enabled) {
      const dow = now.getDay();
      if ((dow === 0 || dow === 6) && typeof a.weekend.rate === 'number') mul *= a.weekend.rate;
    }
    // winter: 月日範囲 (年跨ぎ対応・MM-DD 文字列)
    if (a.winter && a.winter.enabled) {
      const mmdd =
        String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      const f = a.winter.from || '12-15';
      const t = a.winter.to || '03-15';
      const inRange = f <= t ? mmdd >= f && mmdd <= t : mmdd >= f || mmdd <= t;
      if (inRange && typeof a.winter.rate === 'number') mul *= a.winter.rate;
    }
    return mul;
  }

  function keisan(distanceM, config, vehicleId, surchargeIds, waitSec, now) {
    let fare = 0;

    // Step 1: 距離料金
    if (Array.isArray(config.tiers) && config.tiers.length > 0) {
      // 新形式: tiers 配列 走査
      if (distanceM <= config.base_distance_m) {
        fare = config.base_fare;
      } else {
        fare = config.base_fare;
        for (const tier of config.tiers) {
          if (!tier || typeof tier.from_m !== 'number') continue;
          if (distanceM <= tier.from_m) continue;
          const tierEnd =
            tier.to_m === null || tier.to_m === undefined
              ? distanceM
              : Math.min(distanceM, tier.to_m);
          const tierDist = tierEnd - tier.from_m;
          if (tierDist <= 0) continue;
          const ad = tier.add_distance_m > 0 ? tier.add_distance_m : 1;
          const af = tier.add_fare || 0;
          const steps = Math.floor(tierDist / ad) + 1;
          fare += steps * af;
          if (tier.to_m === null || tier.to_m === undefined) break;
          if (distanceM <= tier.to_m) break;
        }
      }
    } else {
      // 旧形式 fallback: base + add 単純計算
      if (distanceM <= config.base_distance_m) {
        fare = config.base_fare;
      } else {
        const extra = distanceM - config.base_distance_m;
        const steps = Math.ceil(extra / config.add_distance_m);
        fare = config.base_fare + steps * config.add_fare;
      }
    }

    // Step 2: vehicle 倍率 + addon
    if (config.vehiclesEnabled && vehicleId && Array.isArray(config.vehicles)) {
      const v = config.vehicles.find((x) => x && x.id === vehicleId);
      if (v) {
        const mul = typeof v.multiplier === 'number' && v.multiplier > 0 ? v.multiplier : 1.0;
        const addon = typeof v.addon === 'number' ? v.addon : 0;
        fare = fare * mul + addon;
      }
    }

    // Step 3: 手動 surcharges 乗算
    let manualMul = 1.0;
    if (Array.isArray(config.surcharges)) {
      for (const id of surchargeIds) {
        const s = config.surcharges.find((x) => x && x.id === id);
        if (s && typeof s.rate === 'number' && s.rate >= 1.0) manualMul *= s.rate;
      }
    }
    fare *= manualMul;

    // Step 4: autoSurcharges 自動判定 (現在時刻ベース)
    fare *= _autoMul(config, now);

    // Step 5: wait 料金加算
    if (config.wait && config.wait.enabled) {
      const waitMin = (waitSec || 0) / 60;
      const free = typeof config.wait.freeMins === 'number' ? config.wait.freeMins : 5;
      const rate = typeof config.wait.ratePerMin === 'number' ? config.wait.ratePerMin : 100;
      const billable = Math.max(0, waitMin - free);
      fare += billable * rate;
    }

    // Step 6: min/max clamp
    if (typeof config.minFare === 'number' && config.minFare > 0 && fare < config.minFare) {
      fare = config.minFare;
    }
    if (typeof config.maxFare === 'number' && config.maxFare > 0 && fare > config.maxFare) {
      fare = config.maxFare;
    }

    // Step 7: 丸め
    const unit = typeof config.rounding === 'number' && config.rounding > 0 ? config.rounding : 1;
    if (unit > 1) fare = Math.round(fare / unit) * unit;
    else fare = Math.round(fare);

    return fare;
  }

  // ★★料金表の 説明文を「入れた数字」で 組み立てる★★ 2026-09-03（司さん）
  //   ★司さんの言葉★「説明の1000mまでの解釈が違うやろが メーターのコード確認しろ」
  //
  //   ★何が 嘘だったか★
  //     事務所の 画面に 「例）最初 1,300円 で 1,000m まで…」と ★決め打ちで 書いてあった★。
  //     999 と 入れても 「1,000m まで」と 出る＝★入れた数字と 違う事を 言っていた★。
  //
  //   ★ここで 書く 理由★
  //     ★お金の 決まりは 上の keisan が 正★。説明も ★同じファイルで 作る★＝
  //     ★2か所に 書かない★（片方だけ 直って 食い違う のを 防ぐ）。
  //
  //   ★「ちょうど」の 事★
  //     keisan は `distanceM <= base_distance_m` ＝ ★入れた距離 ちょうども 基本料金★。
  //     ここが 司さんの 言う「解釈」。★説明にも そう 書く★。
  function _kuv(n) {
    return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function setsumeiBun(config) {
    const c = config || {};
    const kyori = Number(c.base_distance_m) || 0;
    const kingaku = Number(c.base_fare) || 0;
    const kizami = Number(c.add_distance_m) || 0;
    const agaru = Number(c.add_fare) || 0;
    const maru = Number(c.rounding) || 1;
    let s =
      '最初 ' +
      _kuv(kingaku) +
      '円 で ' +
      _kuv(kyori) +
      'm まで（' +
      _kuv(kyori) +
      'm ちょうども ' +
      _kuv(kingaku) +
      '円）。';
    if (kizami > 0 && agaru > 0) {
      s += 'その先 ' + _kuv(kizami) + 'm ごとに ' + _kuv(agaru) + '円 ずつ 上がります。';
    }
    if (maru > 1) s += '端数は ' + _kuv(maru) + '円ごとに 丸めます。';
    else s += '端数は 丸めません。';
    return s;
  }

  return {
    keisan,
    setsumeiBun,
    _autoMul,
  };
})();

// Node（試験）から 使う時。browser / Worker では module が 無いので 何も しません。
/* eslint-disable no-undef */
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = FareCalc;
}
/* eslint-enable no-undef */
