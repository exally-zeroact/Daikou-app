// scripts/zeroact-test-commons/playwright-helpers/gps-noise.js
// ZEROact 共通テスト基盤 Stage 4 (2026-05-18 新規)
//
// GPS 精度劣化・ジャンプ・ドリフトを Playwright BrowserContext に注入する helper。
// bug-patterns/gps-accuracy.yml (GPS-ACC-001) に対応する E2E test 用。
//
// 注入対象:
//   ・accuracy degradation (= 精度値を意図的に上げる・>50m で加算停止確認)
//   ・GPS jump (= 物理速度上限を超える瞬間移動・160km/h + 5m clamp 確認)
//   ・GPS drift (= 停車中の微小座標変動・isStationary 判定耐性確認)

/**
 * accuracy 値を劣化させた GPS を順次注入する。
 * meter.js L254-255 (accuracy>50m で _trackHaversineBetweenGps return) と
 * L302-303 (_calculateOffRoadIncrement return 0) の保護機構を確認する用途。
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {object} opts
 * @param {number} opts.lat   緯度
 * @param {number} opts.lng   経度
 * @param {number} opts.accuracyM 注入する accuracy (m) (例: 60 = 50m 超で保護発火)
 * @param {number} [opts.steps] step 数 (default 6 = isStationary 確定相当)
 * @param {number} [opts.intervalMs] (default 1000)
 */
async function injectAccuracyDegradation(context, opts) {
  const steps = opts.steps || 6;
  const intervalMs = opts.intervalMs || 1000;
  for (let i = 0; i < steps; i++) {
    await context.setGeolocation({
      latitude: opts.lat,
      longitude: opts.lng,
      accuracy: opts.accuracyM,
    });
    if (i < steps - 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

/**
 * GPS ジャンプを注入する (= 直前座標から jumpDistanceM 離れた位置に瞬間移動)。
 * meter.js L264 / L311 (= 物理上限 OFFROAD_ABS_MAX_KMH (160km/h) × dtSec + 5m 超で skip)
 * の保護機構を確認する用途。
 *
 * 経路:
 *   ・初期座標を setGeolocation
 *   ・短い intervalMs (= dtSec 短い) で大距離移動
 *   ・physMaxM 計算: (160/3.6) * intervalMs/1000 + 5 を超える距離なら加算停止が期待値
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {object} opts
 * @param {number} opts.startLat
 * @param {number} opts.startLng
 * @param {number} opts.jumpDistanceM 瞬間移動距離 (m)
 * @param {number} [opts.intervalMs] (default 1000)
 * @param {number} [opts.bearing] 進行方向度 (default 90 = 東)
 */
async function injectGpsJump(context, opts) {
  const intervalMs = opts.intervalMs || 1000;
  const bearing = opts.bearing != null ? opts.bearing : 90;
  // 初期座標
  await context.setGeolocation({
    latitude: opts.startLat,
    longitude: opts.startLng,
    accuracy: 5,
  });
  await new Promise((r) => setTimeout(r, intervalMs));
  // jumpDistanceM 移動先座標を計算 (= 簡易近似)
  const dLatPerM = 1 / 111111;
  const dLngPerM = 1 / (111111 * Math.cos((opts.startLat * Math.PI) / 180));
  const bearingRad = (bearing * Math.PI) / 180;
  const jumpedLat = opts.startLat + Math.cos(bearingRad) * opts.jumpDistanceM * dLatPerM;
  const jumpedLng = opts.startLng + Math.sin(bearingRad) * opts.jumpDistanceM * dLngPerM;
  await context.setGeolocation({
    latitude: jumpedLat,
    longitude: jumpedLng,
    accuracy: 5,
  });
}

/**
 * GPS ドリフト (停車中の微小座標変動) を注入する。
 * 停車相当の低速ドリフトを連続注入し isStationary=true 判定が
 * gps-worker.js L411 stationary_radius_m=3 の範囲内なら維持されることを確認。
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {object} opts
 * @param {number} opts.lat 基準緯度
 * @param {number} opts.lng 基準経度
 * @param {number} opts.driftM 1 step あたりの drift 量 (m) (= 0.5-2m 推奨)
 * @param {number} [opts.steps] (default 10)
 * @param {number} [opts.intervalMs] (default 1000)
 */
async function injectGpsDrift(context, opts) {
  const steps = opts.steps || 10;
  const intervalMs = opts.intervalMs || 1000;
  const dLatPerM = 1 / 111111;
  const dLngPerM = 1 / (111111 * Math.cos((opts.lat * Math.PI) / 180));
  for (let i = 0; i < steps; i++) {
    // ランダム方向 + driftM 距離で drift (= seed 固定なし・テストで margin で吸収)
    const angle = (i / steps) * 2 * Math.PI;
    const driftLat = opts.lat + Math.cos(angle) * opts.driftM * dLatPerM;
    const driftLng = opts.lng + Math.sin(angle) * opts.driftM * dLngPerM;
    await context.setGeolocation({
      latitude: driftLat,
      longitude: driftLng,
      accuracy: 5,
    });
    if (i < steps - 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

/**
 * GPS 空白を注入する (= 一定時間 setGeolocation 呼出を停止)。
 * meter.js L812 GAP_THRESHOLD_SEC=5 以上で gap fill 発火 (= L824 distance_m += filled)。
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {object} opts
 * @param {number} opts.gapSec 空白秒数 (>=5 で gap fill 発火)
 */
async function injectGpsSilence(_context, opts) {
  await new Promise((r) => setTimeout(r, opts.gapSec * 1000));
  // 空白後の追加は呼出側で setGeolocation する
}

module.exports = {
  injectAccuracyDegradation,
  injectGpsJump,
  injectGpsDrift,
  injectGpsSilence,
};
