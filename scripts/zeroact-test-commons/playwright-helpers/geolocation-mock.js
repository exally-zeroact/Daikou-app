// scripts/zeroact-test-commons/playwright-helpers/geolocation-mock.js
// ZEROact 共通テスト基盤 (2026-05-17 新規・Stage 1 Step D)
//
// Playwright BrowserContext に対する GPS シミュレーション helper。
// context.setGeolocation() を順次呼んで、実走行 / 停車 / GPS 消失を再現する。
//
// 用途:
//   ・ダイコメ: tests/e2e/driving-1km.spec.js 等で実走 GPS chain を再現
//   ・Exally: 不要
//   ・今治AI: 将来の位置情報サービス検証
//
// ★ isStationary 強制条件 (重要):
//   gps-worker.js L596-598 救済で「加速度サンプル null なら GPS 判定のみで final 確定」。
//   Playwright で DeviceMotionEvent を dispatch しない限り加速度は null になる。
//   そのため同座標を 1Hz で 6 秒以上 (6+ 点) 流せば isStationary=true 確定。
//
// ★ 注意: ダイコメ E2E では Worker B (map-matcher.js) が 47 県 roads データ load
//          後に Viterbi を回す必要があるため、現実的な走行シミュレーションには
//          PWA full warmup が必要。本 helper は GPS 配送のみ提供し、
//          Worker chain は別途 page.evaluate() で起動させる必要がある。

/**
 * 走行シミュレーション (= 直線移動・GPS 1Hz 更新)
 * @param {import('@playwright/test').BrowserContext} context Playwright context
 * @param {object} opts
 * @param {number} opts.startLat 出発緯度 (例: 33.840)
 * @param {number} opts.startLng 出発経度 (例: 132.7656)
 * @param {number} opts.speedKmh 速度 km/h (例: 60)
 * @param {number} opts.durationSec 走行時間秒 (例: 60)
 * @param {number} [opts.intervalMs] GPS 更新間隔 (default 1000 = 1Hz)
 * @param {number} [opts.bearing] 進行方向度 (default 90 = 東)
 * @param {function} [opts.afterStep] 各 step 後に呼ぶ async callback
 */
async function simulateDriving(context, opts) {
  const intervalMs = opts.intervalMs || 1000;
  const bearing = opts.bearing != null ? opts.bearing : 90;
  const steps = Math.floor((opts.durationSec * 1000) / intervalMs);
  const speedMs = opts.speedKmh / 3.6;
  const stepDistanceM = speedMs * (intervalMs / 1000);

  // 1m あたりの緯度経度変化量 (近似)
  const dLatPerM = 1 / 111111;
  const dLngPerM = 1 / (111111 * Math.cos((opts.startLat * Math.PI) / 180));
  const bearingRad = (bearing * Math.PI) / 180;
  const dLatDir = Math.cos(bearingRad);
  const dLngDir = Math.sin(bearingRad);

  for (let i = 0; i < steps; i++) {
    const cumDistM = stepDistanceM * i;
    const lat = opts.startLat + dLatDir * cumDistM * dLatPerM;
    const lng = opts.startLng + dLngDir * cumDistM * dLngPerM;
    await context.setGeolocation({ latitude: lat, longitude: lng, accuracy: 5 });
    if (typeof opts.afterStep === 'function') {
      await opts.afterStep(i, { lat, lng, cumDistM });
    }
    if (i < steps - 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

/**
 * 停車シミュレーション (= 同座標を 1Hz で N 秒流す)
 * gps-worker isStationary 判定 (= 速度<3 + elapsedSec>=5 + movedM<3) を満たす。
 * 加速度未模擬で gps-worker.js L596-598 救済を経由して GPS 単独で確定。
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {object} opts
 * @param {number} opts.lat 緯度
 * @param {number} opts.lng 経度
 * @param {number} opts.durationSec 停車時間秒 (= 6 秒以上推奨・5 秒未満は判定確定しない)
 * @param {number} [opts.intervalMs] (default 1000)
 */
async function simulateStationary(context, opts) {
  const intervalMs = opts.intervalMs || 1000;
  const steps = Math.floor((opts.durationSec * 1000) / intervalMs);
  for (let i = 0; i < steps; i++) {
    await context.setGeolocation({ latitude: opts.lat, longitude: opts.lng, accuracy: 5 });
    if (i < steps - 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

/**
 * GPS 消失シミュレーション (= dtSec >= 5 秒の空白)
 * meter.js L812 GAP_THRESHOLD_SEC=5 以上で L824 distance_m += filled (gap fill) が発火。
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {object} opts
 * @param {number} opts.startLat 空白前最終緯度
 * @param {number} opts.startLng 空白前最終経度
 * @param {number} opts.gapSec 空白秒数 (>=5 で gap fill 発火)
 */
async function simulateGap(context, opts) {
  // 空白前最終座標を 1 回 set
  await context.setGeolocation({
    latitude: opts.startLat,
    longitude: opts.startLng,
    accuracy: 5,
  });
  // gapSec 秒待機 (setGeolocation を呼ばない = GPS 更新停止)
  await new Promise((r) => setTimeout(r, opts.gapSec * 1000));
}

module.exports = {
  simulateDriving,
  simulateStationary,
  simulateGap,
};
