// scripts/zeroact-test-commons/playwright-helpers/platform-mock.js
// ZEROact 共通テスト基盤 Stage 4 (2026-05-18 新規)
//
// iOS / Android 差異を Playwright BrowserContext で再現する helper。
// UserAgent / GPS Hz / 加速度センサー有無を切替えて
// 両 OS の挙動差を E2E で網羅検証する。
//
// ★ 既存 playwright.config.js は無変更 (= context option を test 内で動的設定)。
//
// ★ 加速度センサーについて:
//    Playwright は DeviceMotionEvent dispatch を公式サポートしない。
//    本 helper は加速度を mock しない = gps-worker.js L596-598 救済 path
//    (= 加速度 null 時 GPS 単独で finalStationary 確定) を通す前提。

const USER_AGENT_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1';

const USER_AGENT_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

/**
 * iOS context option (= UserAgent + 1Hz GPS interval).
 * 注意: Playwright BrowserContext 自体の "interval" 設定はない。
 *       本 helper は context option を返すのみ・GPS Hz は呼出側が
 *       setGeolocation の間隔で制御 (= geolocation-mock.simulateDriving 等)。
 *
 * @returns {{userAgent: string, isIOS: boolean, gpsIntervalMs: number, accelMocked: boolean}}
 */
function iosOptions() {
  return {
    userAgent: USER_AGENT_IOS,
    isIOS: true,
    gpsIntervalMs: 1000, // 1Hz (= iOS の典型 fix rate)
    accelMocked: false, // Playwright 加速度未対応・救済 path 確認用
  };
}

/**
 * Android context option (= UserAgent + 5Hz GPS interval).
 *
 * @returns {{userAgent: string, isIOS: boolean, gpsIntervalMs: number, accelMocked: boolean}}
 */
function androidOptions() {
  return {
    userAgent: USER_AGENT_ANDROID,
    isIOS: false,
    gpsIntervalMs: 200, // 5Hz (= Android の典型 fix rate)
    accelMocked: false,
  };
}

/**
 * iOS BrowserContext を生成する。
 * @param {import('@playwright/test').Browser} browser
 * @param {object} [extra] 追加 context option (例: permissions / geolocation)
 * @returns {Promise<import('@playwright/test').BrowserContext>}
 */
async function mockIOS(browser, extra) {
  const opts = iosOptions();
  const ctx = await browser.newContext({
    userAgent: opts.userAgent,
    ...extra,
  });
  // platform metadata を context に attach (= テスト内で参照可能に)
  ctx.__platformProfile = opts;
  return ctx;
}

/**
 * Android BrowserContext を生成する。
 * @param {import('@playwright/test').Browser} browser
 * @param {object} [extra] 追加 context option
 * @returns {Promise<import('@playwright/test').BrowserContext>}
 */
async function mockAndroid(browser, extra) {
  const opts = androidOptions();
  const ctx = await browser.newContext({
    userAgent: opts.userAgent,
    ...extra,
  });
  ctx.__platformProfile = opts;
  return ctx;
}

/**
 * context option から GPS interval (ms) を返す。
 * geolocation-mock.simulateDriving 等の intervalMs 引数に渡す用途。
 * @param {import('@playwright/test').BrowserContext} context
 * @returns {number} interval in milliseconds (default 1000)
 */
function gpsIntervalMs(context) {
  return context.__platformProfile?.gpsIntervalMs || 1000;
}

/**
 * iOS context か判定。
 * @param {import('@playwright/test').BrowserContext} context
 * @returns {boolean}
 */
function isIOSContext(context) {
  return !!context.__platformProfile?.isIOS;
}

module.exports = {
  USER_AGENT_IOS,
  USER_AGENT_ANDROID,
  iosOptions,
  androidOptions,
  mockIOS,
  mockAndroid,
  gpsIntervalMs,
  isIOSContext,
};
