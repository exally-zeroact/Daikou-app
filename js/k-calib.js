'use strict';
// js/k-calib.js — ★1km自動較正K (確定方式 2026-06-26)★
//   [[project_daikome_distance_method_DECIDED_2026-06-26]] の較正エンジン(純関数/状態のみ)。
//   役割: 良GPS区間で K = (GPS距離) ÷ (OBD∫v) を「窓×複数→中央値」で学習する。
//     ・先頭1km単発はカーブ/坂/渋滞で代表性ノイズ(実データ+0.7%上振れ)が乗る → ★窓中央値★で外れ値を弾く。
//     ・OBD∫v は 010D の 1km/h floor で系統-2.7%過少 + タイヤ器差 → K がまとめてGPSスケールへ持ち上げる。
//     ・GPSは車非依存 → 較正後の OBD∫v×K は ★どの車でも同経路同距離★。
//   ★これは「速度源の較正係数K」を作るだけ。distance_m/課金には触らない(配線は別レイヤ・OFFでbyte不変)★。
//   ブラウザ(index.html script)/Node(test) 両対応・依存ゼロ。
(function (root, factory) {
  // eslint-disable-next-line no-undef
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.KCalib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function median(arr) {
    if (!arr || !arr.length) return null;
    const b = arr.slice().sort(function (x, y) {
      return x - y;
    });
    const n = b.length;
    return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2;
  }
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  // createKCalibrator(opts):
  //   opts.calibKm  較正窓長(km・既定1.0)  / opts.accMax  良GPS判定 accuracy上限(m・既定20)
  //   opts.maxJumpM GPS飛び除外閾値(m・既定200) / opts.coldStartK タイヤ入力等の初期K(未較正時に返す・任意)
  //   opts.maxSpeedMps 物理上限(既定 60m/s=216km/h・異常値除外)
  function createKCalibrator(opts) {
    opts = opts || {};
    const calibM = (opts.calibKm != null ? opts.calibKm : 1.0) * 1000;
    const accMax = opts.accMax != null ? opts.accMax : 20;
    const maxJumpM = opts.maxJumpM != null ? opts.maxJumpM : 200;
    const maxSpd = opts.maxSpeedMps != null ? opts.maxSpeedMps : 60;
    // ★対立監査P0是正(2026-06-26)★:
    //   minWin=3: 2窓median=算術平均で外れ値を弾けない → ★3窓未満は学習Kを距離に焼かない★(getKはcoldStartKのみ返す)。
    //   健全域[hLo,hHi]: 外れ窓(悪GPS区間の K=1.127等)はそもそもプールに入れない。
    //   最終クランプ[cLo,cHi]: 適用Kの絶対上限(NaN/暴走を距離に乗せない)。
    const minWin = opts.minWindows != null ? opts.minWindows : 3;
    const hLo = opts.kHealthLo != null ? opts.kHealthLo : 0.95;
    const hHi = opts.kHealthHi != null ? opts.kHealthHi : 1.11;
    const cLo = opts.kClampLo != null ? opts.kClampLo : 0.85;
    const cHi = opts.kClampHi != null ? opts.kClampHi : 1.08;
    const coldK =
      typeof opts.coldStartK === 'number' && isFinite(opts.coldStartK) && opts.coldStartK > 0
        ? clamp(opts.coldStartK, cLo, cHi)
        : null;

    const ksCap = opts.ksCap != null ? opts.ksCap : 40; // 永続Ksの上限(直近N窓・無制限肥大防止)
    // ★永続復元(serialize往復)用サニタイズ★: 健全域[hLo,hHi]の有限値のみ・直近ksCapに丸める。不正は捨てる。
    function _sanitizeKs(arr) {
      if (!Array.isArray(arr)) return [];
      const out = [];
      for (let i = 0; i < arr.length; i++) {
        const k = arr[i];
        if (typeof k === 'number' && isFinite(k) && k >= hLo && k <= hHi) out.push(k);
      }
      return out.slice(-ksCap);
    }
    let Ks = _sanitizeKs(opts.restoreKs); // ★車別K永続から復元(無ければ[])=接続即confident可★
    let rejected = 0; // 健全域外で捨てた窓数(診断)
    let winG = 0,
      winIv = 0;
    let accG = 0,
      accIv = 0;

    // ★良GPS かつ OBD有効 な1ステップを与える★ (上位が判定済みの生値・gpsStepM=GPS弦m / obdSpeedMps=OBD車速m/s / dtS秒 / accM=acc m)
    function addPair(gpsStepM, obdSpeedMps, dtS, accM) {
      if (!(dtS > 0 && dtS < 5)) return;
      if (!(typeof accM === 'number' && accM >= 0 && accM <= accMax)) return;
      if (!(typeof obdSpeedMps === 'number' && obdSpeedMps >= 0 && obdSpeedMps <= maxSpd)) return;
      if (!(typeof gpsStepM === 'number' && gpsStepM >= 0 && gpsStepM < maxJumpM)) return;
      const iv = obdSpeedMps * dtS;
      winG += gpsStepM;
      winIv += iv;
      accG += gpsStepM;
      accIv += iv;
      if (winG >= calibM && winIv > 0) {
        const k = winG / winIv;
        if (isFinite(k) && k >= hLo && k <= hHi) {
          Ks.push(k); // ★健全窓のみ採用(外れ窓は除外)
          if (Ks.length > ksCap) Ks.shift(); // 直近ksCap窓に丸める(永続/メモリ肥大防止)
        } else rejected++;
        winG = 0;
        winIv = 0;
      }
    }

    // ★距離に焼いてよい確定K★: 健全窓が minWin 以上あれば窓中央値(絶対クランプ)。
    //   未達は学習Kを返さず coldStartK(クランプ)のみ。無ければ null=★未較正(距離に焼かない契約)★。
    function getK() {
      if (Ks.length >= minWin) return clamp(median(Ks), cLo, cHi);
      return coldK;
    }
    // 参考用の暫定K(★距離には焼かない★・診断/UI表示専用): 窓中央値 or 累積比 or coldStartK。
    function provisionalK() {
      if (Ks.length >= 1) return clamp(median(Ks), cLo, cHi);
      if (accIv > 0 && accG > 0) return clamp(accG / accIv, cLo, cHi);
      return coldK;
    }

    return {
      addPair: addPair,
      // ★車別K永続化(2026-06-26)★: serialize()→localStorage保存 / restoreKs(arr)で再注入。
      //   健全窓Ksのみ持ち運ぶ=接続時に restore すれば即 confident(再較正不要)。距離/課金に無関係。
      serialize: function () {
        return { v: 1, ks: Ks.slice(-ksCap) };
      },
      restoreKs: function (arr) {
        Ks = _sanitizeKs(arr);
      },
      getK: getK, // ★距離適用用(confident gate内蔵=3窓未満は学習K不採用)★
      provisionalK: provisionalK, // 診断/表示用(距離に焼かない)
      windows: function () {
        return Ks.length;
      },
      rejectedWindows: function () {
        return rejected;
      },
      confident: function () {
        return Ks.length >= minWin;
      },
      snapshot: function () {
        return {
          K: getK(),
          provisional: provisionalK(),
          windows: Ks.length,
          rejected: rejected,
          accKm: accG / 1000,
          confident: Ks.length >= minWin,
          Ks: Ks.slice(),
        };
      },
      reset: function () {
        Ks = [];
        rejected = 0;
        winG = 0;
        winIv = 0;
        accG = 0;
        accIv = 0;
      },
    };
  }

  // ★較正トースト判定 純関数 (見える化・対立監査P0/P1是正 2026-06-26)★:
  //   毎tick の calibStatus と前回state から「今出すトースト」を決める。表示層のみ・距離/課金に無関係。
  //   監査是正: ①完了は『未収束→収束』で1回だけ(windows増で連発しない・Kを何度も確定と嘘で名乗らない)
  //            ②新tracker(業務/県跨ぎ=windows減)を検知しカウンタ/完了フラグ巻き戻し→再表示する
  //            ③文言は『この区間のK』(per-業務/県リセットの実態・VIN永続未実装ゆえ『以降この車』と断定しない)
  //   cs: {windows,confident,K} or null(autoCalibK OFF=何も出さない) / state: {lastN,done}(初期 {lastN:-1,done:false})
  //   返り: { toast, long, state } — toast=2秒(進捗) / long=5秒(完了) / どちらかnull。
  function decideCalibToast(cs, state) {
    const s = {
      lastN: state && typeof state.lastN === 'number' ? state.lastN : -1,
      done: !!(state && state.done),
    };
    const out = { toast: null, long: null, state: s };
    if (!cs || typeof cs.windows !== 'number') return out;
    if (cs.windows < s.lastN) {
      s.lastN = -1;
      s.done = false;
    } // ★新tracker(windows減)=業務/県跨ぎ→巻き戻し
    if (cs.confident && typeof cs.K === 'number') {
      if (!s.done) {
        s.done = true;
        s.lastN = cs.windows;
        out.long = 'OBD較正 完了\nこの区間の K = ' + cs.K.toFixed(3);
      }
    } else if (cs.windows >= 1 && cs.windows > s.lastN) {
      s.lastN = cs.windows;
      out.toast = 'OBD較正中 ' + cs.windows + '/3';
    }
    return out;
  }

  return {
    createKCalibrator: createKCalibrator,
    median: median,
    decideCalibToast: decideCalibToast,
  };
});
