// ===========================================
// compat.js
// 端末互換性判定レイヤー（古いスマホ対応・2026/04/29追加）
// 各JSから window.Compat を参照して端末ごとの分岐に使う
// このファイル自体は何も挙動を変えない（判定のみ）
// ===========================================
window.Compat = (() => {
  const ua = navigator.userAgent || '';

  // ─── OS判定 ───
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
                (/Mac/.test(ua) && navigator.maxTouchPoints > 1); // iPad iOS 13+ がMac UA偽装する対策
  const isAndroid = /Android/.test(ua);
  const isPC = !isIOS && !isAndroid;

  // iOSバージョン抽出（例: "iPhone OS 16_5" → 16）
  let iosVersion = null;
  if (isIOS) {
    const m = ua.match(/OS (\d+)_/);
    if (m) iosVersion = parseInt(m[1], 10);
  }

  // Androidバージョン抽出（例: "Android 12" → 12）
  let androidVersion = null;
  if (isAndroid) {
    const m = ua.match(/Android (\d+)/);
    if (m) androidVersion = parseInt(m[1], 10);
  }

  // ─── 機能サポート判定（即座に確定） ───
  const hasDeviceMotion       = (typeof DeviceMotionEvent !== 'undefined');
  const hasDeviceOrientation  = (typeof DeviceOrientationEvent !== 'undefined');
  const hasMotionPermission   = hasDeviceMotion && (typeof DeviceMotionEvent.requestPermission === 'function');
  const hasOrientPermission   = hasDeviceOrientation && (typeof DeviceOrientationEvent.requestPermission === 'function');
  const hasServiceWorker      = ('serviceWorker' in navigator);
  const hasWebWorker          = (typeof Worker !== 'undefined');
  const hasGeolocation        = ('geolocation' in navigator);
  const hasLocalStorage       = (typeof localStorage !== 'undefined');
  const hasWakeLock           = ('wakeLock' in navigator);

  // ─── 性能判定 ───
  const cpuCores = navigator.hardwareConcurrency || 1;
  const isLowEndDevice = cpuCores < 4; // 4コア未満をローエンド扱い

  // ─── 動作対象判定（iPhone 8 / Android 8 以降） ───
  function isSupported() {
    if (isIOS) {
      // iPhone 8 = iOS 16 まで対応・iOS 13 以降をターゲット
      // ServiceWorker = iOS 11.3+ なので両方満たす
      return (iosVersion != null && iosVersion >= 13 && hasServiceWorker);
    }
    if (isAndroid) {
      // Android 8 以降を対象
      return (androidVersion != null && androidVersion >= 8 && hasWebWorker);
    }
    return true; // PC は対象内（テスト用）
  }

  // ─── ログ・CSV用サマリー ───
  function summary() {
    const os = isIOS ? ('iOS ' + (iosVersion || '?'))
             : isAndroid ? ('Android ' + (androidVersion || '?'))
             : 'PC';
    const sensors = [];
    // window.Compat 経由で参照（このオブジェクト自体を読み出すため）
    const c = window.Compat || {};
    if (c.hasAccel)   sensors.push('accel');
    if (c.hasGyro)    sensors.push('gyro');
    if (c.hasCompass) sensors.push('compass');
    return os + ', ' + cpuCores + ' cores, sensors=[' + (sensors.join(',') || 'none') + '], supported=' + isSupported();
  }

  return {
    // OS
    isIOS, isAndroid, isPC,
    iosVersion, androidVersion,
    // 機能（静的）
    hasDeviceMotion, hasDeviceOrientation,
    hasMotionPermission, hasOrientPermission,
    hasServiceWorker, hasWebWorker, hasGeolocation, hasLocalStorage, hasWakeLock,
    // 性能
    cpuCores, isLowEndDevice,
    // センサー実取得（動的・gps.jsから更新される）
    hasGyro: false,
    hasAccel: false,
    hasCompass: false,
    // 関数
    isSupported, summary,
  };
})();

// 起動ログ（テスト環境のみ）
if (typeof dlog === 'function') {
  dlog('[Compat] ' + window.Compat.summary());
}
