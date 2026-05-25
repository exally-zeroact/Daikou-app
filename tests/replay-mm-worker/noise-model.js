// tests/replay-mm-worker/noise-model.js (Phase 1 基盤・2026-05-21)
// ★設計変更宣言 Phase 1 (2026-05-21): パラメータ化された GPS noise model
//   目的: ground_truth segment 上の点に・現実的な GPS noise を載せる generator。
//         seed 固定で deterministic・パラメータ差し替えで実機計測値に較正可能。
//   実機 trace で計測したノイズ分布を別途取得して config を差し替えれば・
//   合成 GPS を実機相当に近づけられる (= 較正口を最初から開けておく)。
//
// ★絶対前提:
//   ・ground_truth は実 OSM ジオメトリ (= roads-decoder.js が decode する points)
//   ・合成 noise は accuracy_m / heading_deg / outlier rate の 3 軸でパラメータ化
//   ・「自作の正解に自作 trace を当てる自明」回避は・noise + 競合道路の併用で担保
//     (本 module は noise 側担当)
'use strict';

// Mulberry32 PRNG (seed 32bit → uniform [0,1)・deterministic)
function createPrng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller で gaussian (μ, σ) を生成 (= uniform PRNG → normal)
function gaussian(prng, mean, stddev) {
  const u1 = Math.max(prng(), 1e-12);
  const u2 = prng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stddev * z;
}

// 緯度経度を meter 単位で offset (= local flat-earth・短距離なら十分)
function offsetByMeters(lat, lng, dxMeters, dyMeters) {
  const tr = Math.PI / 180;
  const mPerDegLat = 111132.954;
  const mPerDegLng = 111319.488 * Math.cos(lat * tr);
  return {
    lat: lat + dyMeters / mPerDegLat,
    lng: lng + dxMeters / (mPerDegLng || 1),
  };
}

// ★ noise config 形式 (= fixture 側で指定・実機計測で差し替え可)
//   {
//     seed: number,
//     accuracy_mean_m: number,         GPS accuracy の中央値 (= 5-30m が現実的)
//     accuracy_stddev_m: number,       accuracy 分布の σ
//     position_noise_stddev_m: number, 実位置からの 2D offset の σ (= accuracy より小 or 同程度)
//     heading_noise_deg: number,       GPS heading の σ (= COG ノイズ)
//     outlier_rate: number,            外れ値発生率 (0-1)
//     outlier_offset_m: number,        外れ値の追加位置 offset
//   }
function defaultConfig() {
  // ★ 実機相当 default 確定 (2026-05-21): iOS Safari 1Hz Geolocation 典型値
  //   accuracy 10m (= Apple 公開 spec + 各種実測中央値) / position σ 3m (= accuracy ≈ 2-3σ の物理関係)
  //   outlier 2% (= 都市部 NLOS の典型発生率) / outlier offset 30m (= multipath ジャンプ典型値)
  //   heading σ 5度 (= COG ノイズ実測平均)。本 default は・実機 trace 較正完了後に再固定する。
  return {
    seed: 42,
    accuracy_mean_m: 10,
    accuracy_stddev_m: 3,
    position_noise_stddev_m: 3,
    heading_noise_deg: 5,
    outlier_rate: 0.02,
    outlier_offset_m: 30,
  };
}

// noise を加えた GPS sample を生成
//   inputs: { trueLat, trueLng, trueHeadingDeg, trueSpeedKmh, prng, config }
//   returns: { lat, lng, accuracy, headingDeg, speedKmh, _isOutlier }
function applyNoise(input, prng, config) {
  config = Object.assign(defaultConfig(), config || {});
  const isOutlier = prng() < config.outlier_rate;

  // 2D position noise (= gaussian σ・実位置からの ずれ)
  const noiseStddev = isOutlier
    ? config.position_noise_stddev_m + config.outlier_offset_m
    : config.position_noise_stddev_m;
  const dx = gaussian(prng, 0, noiseStddev);
  const dy = gaussian(prng, 0, noiseStddev);
  const pos = offsetByMeters(input.trueLat, input.trueLng, dx, dy);

  // accuracy (= 報告 GPS accuracy・正値 clamp)
  let accuracy = gaussian(prng, config.accuracy_mean_m, config.accuracy_stddev_m);
  if (accuracy < 3) accuracy = 3; // 物理下限
  if (accuracy > 100) accuracy = 100; // 物理上限

  // heading noise (= true heading + gaussian σ・0-360 wrap)
  let headingDeg = input.trueHeadingDeg + gaussian(prng, 0, config.heading_noise_deg);
  headingDeg = ((headingDeg % 360) + 360) % 360;

  // speed は static で渡す (= heading noise と独立・将来 speed_noise_kmh も追加可能)
  const speedKmh = input.trueSpeedKmh;

  return {
    lat: pos.lat,
    lng: pos.lng,
    accuracy,
    headingDeg,
    speedKmh,
    _isOutlier: isOutlier,
  };
}

// ★ Phase 4 fidelity 拡張 (2026-05-21・realism check 司さん指示):
//   gps-worker.js の 3-AND gate (= C-1 variance + C-2 deviation・閾値 0.1 / 0.5) を・
//   現状の合成 GPS では accelSamples 不足ゆえ・「null 救済 path」 (= L596-598) に退化。
//   gate を実機相当で動かすため・realistic 合成 accel generator を追加。
//
//   ★★ 重要 (= 司さん指摘の「都合よくクリーン値」回避):
//     ・ゼロ分散 / |a|=9.8 完全静止は・null 救済 path と同等結果・gate 差別化なし
//     ・実機: アイドル振動・端末センサノイズ・ホルダー共振で・**停車中も variance > 0**
//     ・設計者意図 (= gps-worker.js L223-224): 静止 ≈ 0・走行 > 0.5
//     ・実機停車中の典型: variance 0.005-0.05 m²/s⁴・|a|平均偏差 0.05-0.2 m/s²
//     ・実機走行中の典型: variance 0.5-5 m²/s⁴・|a|平均偏差 0.5-3 m/s²
//
//   本実装は・**realistic 中央値を deterministic noise + seed 固定** で生成。
//   人工的に gate を発火させる「完全静止 accel」は提供しない。
//
// accel config 形式 (= fixture 側で指定・default は realistic 停車値):
//   {
//     mean_g: 9.8,        // 平均 |a| (= 重力 9.8 + 微小 mount offset)
//     std_xyz_m_s2: 0.05, // 各軸 noise std (= 停車中 ≈0.05・走行中 ≈0.8)
//     sample_rate_hz: 20, // 5 秒で 100 sample (= min 5 samples 余裕)
//   }
function defaultAccelConfigStationary() {
  // 停車中: 軽微なアイドル振動相当 (= variance ~0.005-0.02 / deviation ~0.03-0.1)
  return { mean_g: 9.8, std_xyz_m_s2: 0.05, sample_rate_hz: 20 };
}
function defaultAccelConfigMoving() {
  // 走行中: 路面振動 + 加減速相当 (= variance ~0.5-2 / deviation ~0.5-1.5)
  return { mean_g: 9.8, std_xyz_m_s2: 0.5, sample_rate_hz: 20 };
}

// 1 GPS step (= 1 秒) 分の accelSamples を生成
//   timestampMs: 現 step の終端 timestamp (= GPS now)
//   prng: deterministic PRNG (= seed 固定)
//   config: accel config (stationary / moving 切替)
//   windowSec: ウィンドウ秒数 (= calcAccelVariance の 5 秒に合わせる・default 5)
// 戻り: [{ t, x, y, z }, ...]
function generateAccelSamples(timestampMs, prng, config, windowSec) {
  const w = windowSec != null ? windowSec : 5;
  const n = Math.floor(w * config.sample_rate_hz);
  const samples = new Array(n);
  // 重力 z 軸固定・noise を各軸 gaussian で
  for (let i = 0; i < n; i++) {
    const t = timestampMs - (n - 1 - i) * (1000 / config.sample_rate_hz);
    const nx = gaussian(prng, 0, config.std_xyz_m_s2);
    const ny = gaussian(prng, 0, config.std_xyz_m_s2);
    const nz = gaussian(prng, config.mean_g, config.std_xyz_m_s2);
    samples[i] = { t, x: nx, y: ny, z: nz };
  }
  return samples;
}

module.exports = {
  createPrng,
  gaussian,
  offsetByMeters,
  defaultConfig,
  applyNoise,
  defaultAccelConfigStationary,
  defaultAccelConfigMoving,
  generateAccelSamples,
};
