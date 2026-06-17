// ============================================================
// js/obd-wheelspeed-identify.js  (ダイコメ ABS輪速 端末内識別 ②③・2026-06-15)
//
// ★目的★: 端末の中だけで(サーバー不要・オフライン)、自動discoveryが集めた捕捉から
//   「どのCAN ID×どのバイト×どの係数が車輪速か」を線形回帰で特定し(②)、
//   高R²・速度帯十分・高分解能 を満たした時だけ "確定" を返す確信ゲート(③)。
//   確定すれば {id,key,slope,intercept} を返し、これで生フレームから km/h を復元できる。
//
// ★過大ゼロ/安全★: ここは「識別と判定」だけ。確定マッピングを距離に流すか(④)は呼び出し側の責務で、
//   実車で過大ゼロ実証＋司さんOK後に配線する。本モジュールは距離コアに一切触れない。
//
// captures 形式: [{ obd010d: <km/h>, means: { '<ID>': [meanByte0, meanByte1, ...], ... } }]
//   means = 1捕捉ぶんの ID別 バイト平均(obd-client が _frameMeans で作る / オフラインも同形)。
// ============================================================
(function (global) {
  'use strict';

  const R2_MIN = 0.985; // これ以上の当てはまりで確定(010Dと強く線形)
  const MIN_BINS = 3; // 異なる速度帯(20km/h刻み)がこれだけ要る(直線を1点で引かない)
  const MAX_KMH_PER_LSB = 0.2; // 分解能上限(これより粗いとfloor量子化を消せない=候補外)
  const MIN_VALUE_RANGE = 1; // 捕捉間で値が動かない候補(固定バイト)は除外
  const SEED_R2_MIN = 0.95; // 既知シードID一致時は少し緩い当てはまりでも確定可

  // 最小二乗: ys = slope*xs + intercept, r2。分散ゼロは null。
  function _linfit(xs, ys) {
    const n = xs.length;
    if (n < 2) return null;
    let mx = 0,
      my = 0;
    for (let i = 0; i < n; i++) {
      mx += xs[i];
      my += ys[i];
    }
    mx /= n;
    my /= n;
    let sxy = 0,
      sxx = 0,
      syy = 0;
    for (let i = 0; i < n; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
      syy += (ys[i] - my) ** 2;
    }
    if (sxx === 0 || syy === 0) return null;
    const slope = sxy / sxx;
    return { slope: slope, intercept: my - slope * mx, r2: (sxy * sxy) / (sxx * syy) };
  }

  function _bin(kmh) {
    return Math.floor(kmh / 20);
  }

  // ★②③ 端末内識別 + 確信ゲート★
  function identifyWheelSpeed(captures, opts) {
    opts = opts || {};
    const seed = opts.seed || global.OBDWheelSpeedMap || null;
    const r2min = opts.r2min != null ? opts.r2min : R2_MIN;
    const minBins = opts.minBins != null ? opts.minBins : MIN_BINS;
    const maxLsb = opts.maxKmhPerLsb != null ? opts.maxKmhPerLsb : MAX_KMH_PER_LSB;

    const valid = (captures || []).filter(
      (c) => c && typeof c.obd010d === 'number' && c.obd010d >= 0 && c.means
    );
    const bins = {};
    valid.forEach((c) => {
      bins[_bin(c.obd010d)] = 1;
    });
    const nBins = Object.keys(bins).length;
    if (valid.length < 2 || nBins < minBins) {
      return {
        confirmed: false,
        reason: 'insufficient_captures',
        captures: valid.length,
        bins: nBins,
      };
    }

    // 全捕捉に共通して現れる ID
    let common = Object.keys(valid[0].means);
    valid.forEach((c) => {
      common = common.filter((id) => id in c.means);
    });

    const xs = valid.map((c) => c.obd010d); // 独立変数 = 010D速度
    const results = [];
    function addCand(id, key, ys) {
      // ★N2: NaN/非有限を含む候補は棄却(ID長差で undefined→NaN を誤確定させない)★
      for (let i = 0; i < ys.length; i++) {
        if (!Number.isFinite(ys[i])) return;
      }
      let vmin = Infinity,
        vmax = -Infinity;
      for (let i = 0; i < ys.length; i++) {
        if (ys[i] < vmin) vmin = ys[i];
        if (ys[i] > vmax) vmax = ys[i];
      }
      if (vmax - vmin < MIN_VALUE_RANGE) return; // 動かない=速度でない
      const fit = _linfit(ys, xs);
      if (!fit) return;
      results.push({ id: id, key: key, slope: fit.slope, intercept: fit.intercept, r2: fit.r2 });
    }
    // 捕捉間でそのバイトが実際に動いたか(平均レンジ)。欠損は -1。
    function byteRange(id, b) {
      let mn = Infinity,
        mx = -Infinity;
      for (let i = 0; i < valid.length; i++) {
        const v = valid[i].means[id][b];
        if (typeof v !== 'number' || !Number.isFinite(v)) return -1;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      return mx - mn;
    }
    common.forEach((id) => {
      const len = valid[0].means[id].length;
      for (let o = 0; o + 1 < len; o++) {
        // ★S4: 16bit候補は「下位(LSB)バイトが実際に動く」時だけ採用★。
        //   隣バイトが定数(例 速度U8 + 隣0)だと BE16 が 1/256 の"偽fine"に見える誤確定を棄却。
        //   BE16 の LSB=byte(o+1) / LE16 の LSB=byte(o)。
        if (byteRange(id, o + 1) >= 1) {
          addCand(
            id,
            o + ':BE16',
            valid.map((c) => c.means[id][o] * 256 + c.means[id][o + 1])
          );
        }
        if (byteRange(id, o) >= 1) {
          addCand(
            id,
            o + ':LE16',
            valid.map((c) => c.means[id][o + 1] * 256 + c.means[id][o])
          );
        }
      }
      for (let o = 0; o < len; o++) {
        addCand(
          id,
          o + ':U8',
          valid.map((c) => c.means[id][o])
        );
      }
    });
    results.sort((a, b) => b.r2 - a.r2 || Math.abs(a.slope) - Math.abs(b.slope));

    function mapOf(r, seedMatch, viaSeed) {
      return {
        confirmed: true,
        id: r.id,
        key: r.key,
        slope: r.slope, // km/h per LSB
        intercept: r.intercept,
        r2: r.r2,
        kmhPerLSB: r.slope,
        bins: nBins,
        seedMatch: seedMatch || null,
        viaSeed: !!viaSeed,
      };
    }

    // 高R² × 正の傾き × 高分解能 を満たす最良候補 = 確定
    const best = results.find(
      (r) => r.r2 >= r2min && r.slope > 1e-5 && Math.abs(r.slope) <= maxLsb
    );
    if (best) {
      const sm = seed && seed.lookupById ? seed.lookupById(best.id) : null;
      return mapOf(best, sm ? sm.makers : null, false);
    }
    // 既知シードID一致なら少し緩い当てはまりでも確定(出典ありの裏付け)
    if (seed && seed.lookupById) {
      const seedHit = results.find(
        (r) =>
          seed.lookupById(r.id) &&
          r.r2 >= SEED_R2_MIN &&
          r.slope > 1e-5 &&
          Math.abs(r.slope) <= maxLsb
      );
      if (seedHit) {
        const sm = seed.lookupById(seedHit.id);
        return mapOf(seedHit, sm ? sm.makers : null, true);
      }
    }
    return {
      confirmed: false,
      reason: 'no_confident_channel',
      bins: nBins,
      top: results.slice(0, 3),
    };
  }

  // 確定マッピングで生フレーム {id,bytes} → km/h を復元(該当しなければ -1)
  function decodeWheelSpeedKmh(frame, m) {
    if (!frame || !m || !m.confirmed || frame.id !== m.id || !frame.bytes) return -1;
    const parts = String(m.key).split(':');
    const o = parseInt(parts[0], 10);
    const enc = parts[1];
    const b = frame.bytes;
    let val;
    if (enc === 'BE16') {
      if (o + 1 >= b.length) return -1;
      val = b[o] * 256 + b[o + 1];
    } else if (enc === 'LE16') {
      if (o + 1 >= b.length) return -1;
      val = b[o + 1] * 256 + b[o];
    } else {
      if (o >= b.length) return -1;
      val = b[o];
    }
    const kmh = m.slope * val + m.intercept;
    return kmh >= 0 ? kmh : 0; // 負(切片で僅かに下振れ)は0クランプ
  }

  const api = {
    identifyWheelSpeed: identifyWheelSpeed,
    decodeWheelSpeedKmh: decodeWheelSpeedKmh,
    _linfit: _linfit,
    R2_MIN: R2_MIN,
    MIN_BINS: MIN_BINS,
    MAX_KMH_PER_LSB: MAX_KMH_PER_LSB,
  };
  // eslint-disable-next-line no-undef
  if (typeof module !== 'undefined' && module.exports) {
    // eslint-disable-next-line no-undef
    module.exports = api;
  }
  global.OBDWheelSpeedIdentify = api;
})(
  typeof window !== 'undefined'
    ? window
    : typeof self !== 'undefined'
      ? self
      : typeof globalThis !== 'undefined'
        ? globalThis
        : this
);
