// ===========================================
// gps-worker.js
// GPS計算処理（Web Worker・2026/04/27追加）
// GPS取得はメインスレッド・計算処理のみWorkerで実行
// メインスレッドをブロックしないことでUI描画が安定する
// ===========================================
/* eslint-disable no-console -- ★設計変更宣言 (2026-05-15・lint Phase 6):
   本ファイルは Web Worker 内で動作・window.dlog が未定義のため代替手段なし。
   内部 wlog() ラッパーが console.log を呼ぶ箇所のみで使用 (= Class C)。 */

// デバッグフラグ（メインから初期化メッセージで受け取る）
let debug = false;
function wlog() {
  if (debug) console.log.apply(console, arguments);
}

// ─── CONFIG（メインと同じ値・初期化メッセージで上書き可能） ───
let CONFIG = {
  speed_limit_kmh: 3,
  stationary_sec: 5,
  stationary_radius_m: 3,
  stationary_radius_jam_m: 1,
  resume_speed_kmh: 5,
  jump_limit_m_per_s: 50,
  max_acceleration_ms2: 8,
  heading_diff_threshold_deg: 90,
  heading_check_min_distance_m: 5,
  heading_check_min_speed_kmh: 5,
  kalman_Q: 3, // T5 既定値 (typeCode 不明時 / setRoadType 未受信時)
  jam_speed_max_kmh: 10,
  jam_duration_sec: 60,
  _kalman_Q_override: null, // コンパス融合で動的に変更
  // C-1：加速度variance静止判定（2026/04/30追加）
  accel_variance_threshold: 0.1, // m²/s⁴・経験的・実機テストで調整
  accel_variance_window_ms: 5000, // 直近5秒のサンプルで計算
  accel_variance_min_samples: 5, // この件数未満なら判定不能（null返す）
  // C-2：加速度合算ベクトル動き判定（2026/04/30追加）
  accel_motion_threshold: 0.5, // m/s²・|平均|a|-9.8| の閾値・実機調整
  accel_motion_window_ms: 5000, // 直近5秒のサンプルで計算
  accel_motion_min_samples: 5, // この件数未満なら判定不能（null返す）
};

// ─── 状態変数（Worker内で保持） ───
let lastPosition = null;
let lowSpeedStart = null;
let isStationary = false;
let trafficJamSince = null;
let isTrafficJam = false;
let kalman = null;

// T5 (2026-05-09): Adaptive Kalman Q (道路種別連動)
//   map-matcher.js で commit された snap の typeCode を main 経由で受信し、
//   typeCode に応じて Q を動的化する。
//   motorway/trunk: 直線・信頼度高 → Q 小 (1.5)
//   residential/track: カーブ多・信頼度低 → Q 大 (4.0)
//   typeCode 不明時は CONFIG.kalman_Q (=3) を使う。
let _currentTypeCode = null;
function _typeCodeToQ(typeCode) {
  if (typeCode == null) return CONFIG.kalman_Q;
  switch (typeCode) {
    case 0:
    case 1:
      return 1.5; // motorway / trunk
    case 7:
    case 8:
      return 1.5; // motorway_link / trunk_link
    case 2:
    case 3:
      return 2.5; // primary / secondary
    case 9:
    case 10:
      return 2.5; // primary_link / secondary_link
    case 4:
    case 5:
      return 3.0; // tertiary / unclassified
    case 11:
      return 3.0; // tertiary_link
    case 6:
    case 12:
      return 4.0; // residential / track
    default:
      return CONFIG.kalman_Q;
  }
}
function _getDynamicBaseQ() {
  return _typeCodeToQ(_currentTypeCode);
}

// 2026-05-09 (P4 廃止): cellular tunnel hint 完全削除
//   理由: layer (v6 attribute) + tunnels-{pref}.js データで道路属性ベースに代替
//   利点: iOS Safari/PWA でも同等動作・接続不安定時の偽陽性なし
//   詳細: map-matcher.js の _computeLayerScore で prevLayer 連続性 boost に置換

let _prevAccuracy = null;

// ─── Kalmanフィルター（案D・2026/04/27） ───
// ★設計変更宣言 Phase 1.ZUPT (2026-05-10): Zero Velocity Update
//   現 Kalman は position-only (vx/vy 状態を持たない) のため、
//   ユーザー指示「vx/vy を 0 に強制リセット」は process noise Q の override で実現する。
//   ZUPT active 中: Q = 0.01 (≒ 速度ドリフト 0)
//     → decayed accuracy ≒ 既存 _accuracy (= 位置共分散維持)
//     → K ≒ 0 (新 GPS 値による位置移動は小・GPS noise 由来 drift を抑制)
//   ZUPT inactive: 既存通り T5 動的 Q (typeCode 連動) または qOverride
//   起動条件: 直前 frame の isStationary 判定 (3 点 AND: GPS+C-1+C-2)
//   停車終了で自動的に通常 Q に復帰 (Off-Road Mode 中の慣性誤差累積も抑える効果)
const ZUPT_Q = 0.01;
class KalmanGPS {
  constructor() {
    this._lat = null;
    this._lng = null;
    this._accuracy = 0;
    this._timestamp = null;
    this._zuptActive = false; // Phase 1.ZUPT: 停車中フラグ
  }
  reset() {
    this._lat = null;
    this._lng = null;
    this._accuracy = 0;
    this._timestamp = null;
    this._zuptActive = false;
  }
  // Phase 1.ZUPT: 停車検出に応じて ZUPT モードを切替
  setZuptActive(active) {
    this._zuptActive = !!active;
  }
  update(lat, lng, accuracy, timestamp, qOverride) {
    if (this._lat === null) {
      this._lat = lat;
      this._lng = lng;
      this._accuracy = accuracy;
      this._timestamp = timestamp;
      return { lat, lng };
    }
    const dt = (timestamp - this._timestamp) / 1000;
    if (dt <= 0 || dt > 30) {
      this._lat = lat;
      this._lng = lng;
      this._accuracy = accuracy;
      this._timestamp = timestamp;
      return { lat, lng };
    }
    // Phase 1.ZUPT: ZUPT active 中は速度成分 (Q) を 0 ≒ ZUPT_Q に強制
    //   通常時: T5 typeCode 連動の動的 Q または qOverride (コンパス融合)
    //   ZUPT active 時: ZUPT_Q (0.01) に強制し速度ドリフトを抑制
    let Q;
    if (this._zuptActive) {
      Q = ZUPT_Q;
    } else if (qOverride != null) {
      Q = qOverride;
    } else {
      Q = _getDynamicBaseQ();
    }
    const decayed = Math.sqrt(this._accuracy * this._accuracy + Q * Q * dt * dt);
    const K = (decayed * decayed) / (decayed * decayed + accuracy * accuracy);
    this._lat = this._lat + K * (lat - this._lat);
    this._lng = this._lng + K * (lng - this._lng);
    this._accuracy = Math.sqrt((1 - K) * decayed * decayed);
    this._timestamp = timestamp;
    if (!isFinite(this._lat) || !isFinite(this._lng)) {
      wlog('[GPS] Kalman異常値 → フォールバック');
      this._lat = lat;
      this._lng = lng;
      this._accuracy = accuracy;
      return { lat, lng };
    }
    return { lat: this._lat, lng: this._lng };
  }
}

// Phase 1.ZUPT: 直前 frame の停車判定を carry
//   processPosition 内で stationary 検出は Kalman 後に走るため、
//   今 frame の Kalman に ZUPT を適用するには「前 frame の判定」を使う必要あり (1 frame lag)
let _isStationaryLast = false;

// ─── 動的accuracy閾値 ───
function getDynamicAccuracyLimit(speedKmh, now) {
  let limit;
  if (speedKmh < 30) limit = 10;
  else if (speedKmh < 60) limit = 15;
  else if (speedKmh < 100) limit = 25;
  else limit = 35;
  const hour = new Date(now).getHours();
  if (hour >= 22 || hour < 5) limit *= 1.2;
  return limit;
}

// ─── 渋滞モード判定 ───
function checkTrafficJam(speedKmh, now) {
  if (speedKmh > 0 && speedKmh < CONFIG.jam_speed_max_kmh) {
    if (!trafficJamSince) trafficJamSince = now;
    const durationSec = (now - trafficJamSince) / 1000;
    if (durationSec >= CONFIG.jam_duration_sec) {
      if (!isTrafficJam) wlog('[GPS] 渋滞モード開始');
      isTrafficJam = true;
      return true;
    }
  } else if (speedKmh >= CONFIG.jam_speed_max_kmh) {
    if (isTrafficJam) wlog('[GPS] 渋滞モード解除');
    trafficJamSince = null;
    isTrafficJam = false;
  }
  return isTrafficJam;
}

// ─── 方位角計算（案U用） ───
function calcBearing(lat1, lng1, lat2, lng2) {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// ─── 静止判定 ───
// ─── C-1：加速度variance計算（2026/04/30追加） ───
// 直近のサンプルから加速度合算ベクトル|a|=√(x²+y²+z²)の分散を計算
// 静止時：variance ほぼ0（重力のみ）
// 走行中：variance > 0.5（振動・加速・減速）
// 戻り値：variance (m²/s⁴) | null（サンプル不足／加速度なし端末）
function calcAccelVariance(accelSamples, now) {
  if (!accelSamples || !Array.isArray(accelSamples)) return null;
  if (accelSamples.length < CONFIG.accel_variance_min_samples) return null;

  // 時間ウィンドウ内のサンプルのみ抽出（学術論文5秒推奨）
  const windowMs = CONFIG.accel_variance_window_ms;
  const recent = accelSamples.filter((s) => s && typeof s.t === 'number' && now - s.t < windowMs);
  if (recent.length < CONFIG.accel_variance_min_samples) return null;

  // 合算ベクトルの大きさ |a| = √(x² + y² + z²)
  // この方法はスマホの向きに依存しない（重力含むが大きさは同じ）
  const magnitudes = recent.map((s) => Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z));

  // 平均
  const mean = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;

  // 分散
  const variance =
    magnitudes.reduce((sum, m) => sum + (m - mean) * (m - mean), 0) / magnitudes.length;

  return variance;
}

// ─── MM-5 (2026-05-08): 加速度路面セマンティクス検出 ─────────
// vibration_index = std(|a|) を 1Hz で算出し、橋進入時の急上下 G impulse を検出
// accelLayerHint: 'bridge' | 'normal'
//   - 'bridge': 直近 5 秒で max(|a|) - min(|a|) > 4 m/s² の impulse を観測
//   - 'normal': デフォルト・上記閾値未満
// トンネルは accel から検出困難なため normal のまま（cellular hint で補完）
//
// 戻り値: { hint, vibrationIndex, magRange, sampleCount } | null
const ACCEL_LAYER_WINDOW_MS = 5000;
const ACCEL_LAYER_MIN_SAMPLES = 8;
const ACCEL_BRIDGE_RANGE_THRESHOLD = 4.0; // m/s² 急上下 G の検出閾値
const ACCEL_BRIDGE_VARIANCE_THRESHOLD = 0.8; // 高 vibration の検出閾値

function _calcAccelLayerHint(accelSamples, now) {
  if (!accelSamples || !Array.isArray(accelSamples)) return null;
  if (accelSamples.length < ACCEL_LAYER_MIN_SAMPLES) return null;

  const recent = accelSamples.filter(
    (s) => s && typeof s.t === 'number' && now - s.t < ACCEL_LAYER_WINDOW_MS
  );
  if (recent.length < ACCEL_LAYER_MIN_SAMPLES) return null;

  // 各サンプルの |a| = √(x² + y² + z²) を算出
  let maxMag = -Infinity,
    minMag = Infinity,
    sumMag = 0;
  const mags = new Array(recent.length);
  for (let i = 0; i < recent.length; i++) {
    const s = recent[i];
    const m = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
    mags[i] = m;
    if (m > maxMag) maxMag = m;
    if (m < minMag) minMag = m;
    sumMag += m;
  }
  const mean = sumMag / recent.length;

  // 標準偏差 (vibration_index)
  let variance = 0;
  for (let i = 0; i < mags.length; i++) {
    const d = mags[i] - mean;
    variance += d * d;
  }
  variance /= mags.length;
  const vibrationIndex = Math.sqrt(variance);

  // 急上下 G の range（最大 - 最小）
  const magRange = maxMag - minMag;

  let hint = 'normal';
  // 橋進入: range が大きい（伸縮継ぎ目を踏んだ瞬間の vertical G impulse）
  // または vibration_index が高い（橋面の不整・段差）
  if (magRange > ACCEL_BRIDGE_RANGE_THRESHOLD || vibrationIndex > ACCEL_BRIDGE_VARIANCE_THRESHOLD) {
    hint = 'bridge';
  }

  return {
    hint: hint,
    vibrationIndex: vibrationIndex,
    magRange: magRange,
    sampleCount: recent.length,
  };
}

// ─── C-2：加速度合算ベクトル動き判定（2026/04/30追加） ───
// 直近のサンプルから |a|=√(x²+y²+z²) の平均を計算し、9.8（重力）からの偏差を返す
// 静止時：|平均|a|| ≈ 9.8 → 偏差 ≈ 0
// 動いてる時：加減速・振動で平均|a| が 9.8 から離れる → 偏差大
// 平均値を使うのは体勢変化（一瞬の値）に対する頑健性のため
// 戻り値：偏差 (m/s²) | null（サンプル不足／加速度なし端末）
function calcAccelMagnitudeDeviation(accelSamples, now) {
  if (!accelSamples || !Array.isArray(accelSamples)) return null;
  if (accelSamples.length < CONFIG.accel_motion_min_samples) return null;

  // 時間ウィンドウ内のサンプルのみ抽出
  const windowMs = CONFIG.accel_motion_window_ms;
  const recent = accelSamples.filter((s) => s && typeof s.t === 'number' && now - s.t < windowMs);
  if (recent.length < CONFIG.accel_motion_min_samples) return null;

  // 合算ベクトルの大きさ |a| = √(x² + y² + z²)
  const magnitudes = recent.map((s) => Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z));

  // 平均（瞬間値ではなく平均で体勢変化に頑健化）
  const meanMag = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;

  // 9.8（地球の重力加速度）からの絶対偏差
  return Math.abs(meanMag - 9.8);
}

// T12 (2026-05-09): DeviceMotion 拡大活用
//   ① 急ブレーキ検出: 加速度の長軸 (進行方向) 方向で連続して負の値が出たら急ブレーキ
//      速度クランプを GPS 速度ではなく加速度ベース速度推定で抑える
//   ② GPS gap 区間の慣性航法補間: GPS 圏外時に加速度を時間積分して位置を推定
//      過信防止のため積分時間 5 秒上限・dead reckoning 30m 上限
//   accelSamples: [{ x, y, z, t }, ...] (t=epoch ms)・x: east, y: north, z: up は端末座標系で
//      正確には端末姿勢に依存するが、ここでは |a| ベース近似のみ
const T12_HARD_BRAKE_THRESHOLD = 4.0; // m/s² | a |の正味偏差 (含む水平+垂直成分)
const T12_HARD_BRAKE_MIN_SAMPLES = 3;
const T12_INERTIAL_MAX_GAP_SEC = 5; // 5 秒以内の GPS gap のみ慣性で補間
const T12_INERTIAL_MAX_DRIFT_M = 30; // 慣性推定 30m 超なら信用しない (lat/lng 維持)

// 急ブレーキ検出: 直近 N サンプルの |a|-9.8 が一貫して大きい (= 強い動き)
//   かつ GPS 速度が下降中なら急ブレーキ確度高
function _detectHardBrake(accelSamples, prevSpeedKmh, currSpeedKmh, _now) {
  if (!accelSamples || accelSamples.length < T12_HARD_BRAKE_MIN_SAMPLES) return false;
  const recent = accelSamples.slice(-T12_HARD_BRAKE_MIN_SAMPLES);
  let count = 0;
  for (const s of recent) {
    if (!s) continue;
    const mag = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
    if (Math.abs(mag - 9.8) > T12_HARD_BRAKE_THRESHOLD) count++;
  }
  // 全 sample が threshold 超 + GPS 速度 -10 km/h 以上の減速 = 急ブレーキ
  if (count >= T12_HARD_BRAKE_MIN_SAMPLES && prevSpeedKmh - currSpeedKmh > 10) {
    return true;
  }
  return false;
}

// 慣性航法による gap 補間: 直前位置 + dt + 加速度積分 → 推定位置
//   limited fallback として位置の微小補正のみ (主体は GPS の Kalman 後座標)
function _inertialGapCorrection(prevPos, accelSamples, currLat, currLng, dt) {
  if (!prevPos || !accelSamples || accelSamples.length === 0) return null;
  if (dt <= 0 || dt > T12_INERTIAL_MAX_GAP_SEC) return null;
  // 直近サンプルの平均水平加速度 (端末座標系の x/y を概略で水平に流用)
  let sx = 0,
    sy = 0,
    n = 0;
  for (const s of accelSamples) {
    if (!s) continue;
    sx += s.x;
    sy += s.y;
    n++;
  }
  if (n === 0) return null;
  const ax = sx / n,
    ay = sy / n;
  // 速度初期値 (前 GPS から求める) + 積分
  const v0 = (prevPos.speedKmh || 0) / 3.6;
  // 進行方向は heading 不明なので簡易に「水平速度方向 = 0」と仮定し
  // ax/ay の二乗平均を水平速度変動として扱う (= drift estimate)
  const aMag = Math.sqrt(ax * ax + ay * ay);
  const driftDist = v0 * dt + 0.5 * aMag * dt * dt;
  if (driftDist > T12_INERTIAL_MAX_DRIFT_M) return null;
  // この関数は「GPS が来ない区間の補間」用だが、本実装では
  // GPS が届いている前提なので driftDist を quality-check として使用するのみ
  return { driftDist: driftDist };
}

function checkStationary(speedKmh, lat, lng, now) {
  if (isStationary && speedKmh >= CONFIG.resume_speed_kmh) {
    lowSpeedStart = null;
    return false;
  }
  if (speedKmh < CONFIG.speed_limit_kmh) {
    if (!lowSpeedStart) {
      lowSpeedStart = { time: now, lat, lng };
      return isStationary;
    }
    const elapsedSec = (now - lowSpeedStart.time) / 1000;
    const movedM = calcDistance(lowSpeedStart.lat, lowSpeedStart.lng, lat, lng);
    const radius = isTrafficJam ? CONFIG.stationary_radius_jam_m : CONFIG.stationary_radius_m;
    if (elapsedSec >= CONFIG.stationary_sec && movedM < radius) return true;
    return isStationary;
  }
  lowSpeedStart = null;
  return false;
}

// ─── Vincenty公式（WGS84楕円体） ───
function calcDistance(lat1, lng1, lat2, lng2) {
  if (lat1 === lat2 && lng1 === lng2) return 0;
  const a = 6378137,
    b = 6356752.314245,
    f = 1 / 298.257223563;
  const L = ((lng2 - lng1) * Math.PI) / 180;
  const U1 = Math.atan((1 - f) * Math.tan((lat1 * Math.PI) / 180));
  const U2 = Math.atan((1 - f) * Math.tan((lat2 * Math.PI) / 180));
  const sinU1 = Math.sin(U1),
    cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2),
    cosU2 = Math.cos(U2);
  let lambda = L,
    lambdaP,
    iterLimit = 100;
  let sinSigma, cosSigma, sigma, sinAlpha, cosSqAlpha, cos2SigmaM;
  do {
    const sinLambda = Math.sin(lambda),
      cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt(
      cosU2 * sinLambda * (cosU2 * sinLambda) +
        (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) * (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda)
    );
    if (sinSigma === 0) return 0;
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha;
    const C = (f / 16) * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
    lambdaP = lambda;
    lambda =
      L +
      (1 - C) *
        f *
        sinAlpha *
        (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
  } while (Math.abs(lambda - lambdaP) > 1e-12 && --iterLimit > 0);
  if (iterLimit === 0) return haversineDistance(lat1, lng1, lat2, lng2);
  const uSq = (cosSqAlpha * (a * a - b * b)) / (b * b);
  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    B *
    sinSigma *
    (cos2SigmaM +
      (B / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (B / 6) *
            cos2SigmaM *
            (-3 + 4 * sinSigma * sinSigma) *
            (-3 + 4 * cos2SigmaM * cos2SigmaM)));
  return b * A * (sigma - deltaSigma);
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
}

function _calcDistance3D(lat1, lng1, alt1, lat2, lng2, alt2) {
  const flat = calcDistance(lat1, lng1, lat2, lng2);
  if (alt1 == null || alt2 == null) return flat;
  const altDiff = alt2 - alt1;
  if (Math.abs(altDiff) > 100) return flat;
  return Math.sqrt(flat * flat + altDiff * altDiff);
}

// ─── メイン処理（GPS座標を受け取って計算） ───
function processPosition(data) {
  const {
    lat,
    lng,
    accuracy,
    speedKmh,
    heading,
    altitude,
    now,
    compassHeading,
    accelData,
    accelSamples,
    gyroData,
    gyroSamples,
  } = data;

  // ① 動的accuracy閾値
  const accLimit = getDynamicAccuracyLimit(speedKmh, now);
  if (accuracy > accLimit) return null;

  // ② ジャンプ判定
  if (lastPosition) {
    const jump = calcDistance(lastPosition.lat, lastPosition.lng, lat, lng);
    const timeDiff = (now - lastPosition.timestamp) / 1000;
    if (timeDiff > 0 && jump / timeDiff > CONFIG.jump_limit_m_per_s) return null;
  }

  // ②-2 加速度異常判定（案Z）
  if (lastPosition && lastPosition.speedKmh != null && lastPosition.speedKmh > 1 && speedKmh > 1) {
    const dt = (now - lastPosition.timestamp) / 1000;
    if (dt > 0 && dt < 5) {
      const dvMs = (speedKmh - lastPosition.speedKmh) / 3.6;
      const acceleration = dvMs / dt;
      if (Math.abs(acceleration) > CONFIG.max_acceleration_ms2) {
        wlog('[GPS] 加速度異常: ' + acceleration.toFixed(1) + 'm/s²・スキップ');
        return null;
      }
    }
  }

  // ②-3 進行方向整合性（案U + コンパス融合）
  // GPS headingより精度の高いコンパスheadingを優先使用
  const effectiveHeading = compassHeading != null ? compassHeading : heading;
  if (
    lastPosition &&
    effectiveHeading != null &&
    effectiveHeading >= 0 &&
    speedKmh >= CONFIG.heading_check_min_speed_kmh
  ) {
    const movedDistance = calcDistance(lastPosition.lat, lastPosition.lng, lat, lng);
    if (movedDistance >= CONFIG.heading_check_min_distance_m) {
      const movementBearing = calcBearing(lastPosition.lat, lastPosition.lng, lat, lng);
      const diff = angleDiff(effectiveHeading, movementBearing);
      if (diff > CONFIG.heading_diff_threshold_deg) {
        wlog(
          '[GPS] 方向不整合: ' +
            diff.toFixed(0) +
            '°・スキップ' +
            (compassHeading != null ? '（コンパス）' : '（GPS）')
        );
        return null;
      }
      // コンパスとGPS移動方向の一致度でKalman_Qを動的調整
      // 一致（diff小）→ Q小さく（より強くフィルター・ノイズ除去）
      // 不一致（diff大）→ Q大きく（GPS座標をより信頼）
      if (compassHeading != null) {
        const matchRatio = 1 - diff / CONFIG.heading_diff_threshold_deg; // 0〜1
        // T5: ベース Q を typeCode 連動の動的値にし、コンパス融合は乗算で適用
        const baseQ = _getDynamicBaseQ();
        CONFIG._kalman_Q_override = baseQ * (0.5 + 0.5 * (1 - matchRatio));
        CONFIG._compassDebug =
          'コンパス融合: 方向差' +
          diff.toFixed(0) +
          '° baseQ=' +
          baseQ.toFixed(1) +
          ' Q=' +
          CONFIG._kalman_Q_override.toFixed(1) +
          ' typeCode=' +
          (_currentTypeCode != null ? _currentTypeCode : '?');
        wlog('[GPS] ' + CONFIG._compassDebug);
      }
    }
  }

  // ③ 渋滞モード
  checkTrafficJam(speedKmh, now);

  // ④ Kalmanフィルター（コンパス融合Q値で更新）
  // Phase 1.ZUPT (2026-05-10): 直前 frame の isStationary 判定を carry
  //   今 frame の Kalman に ZUPT (Q ≈ 0) を適用して GPS noise 由来 drift を抑制
  //   停車終了で自動的に通常 Q に復帰
  kalman.setZuptActive(_isStationaryLast);
  const filtered = kalman.update(lat, lng, accuracy, now, CONFIG._kalman_Q_override);
  CONFIG._kalman_Q_override = null; // 使い捨て

  // ⑤ 静止判定（C-1+C-2：加速度variance + 動き判定強化・2026/04/30）
  // 既存GPS判定 AND C-1（分散小） AND NOT C-2（|a|-9.8 大） で「確実に静止」
  // 加速度なし時は GPS判定のみ（後方互換）
  const gpsStationary = checkStationary(speedKmh, filtered.lat, filtered.lng, now);
  const accelVariance = calcAccelVariance(accelSamples, now);
  const accelDeviation = calcAccelMagnitudeDeviation(accelSamples, now);

  let finalStationary;
  if (accelVariance === null && accelDeviation === null) {
    // 加速度判定不能（センサーなし／サンプル不足）→ GPS判定のみ（後方互換）
    finalStationary = gpsStationary;
  } else {
    // C-1：分散による静止判定（小さいほど静止）
    const c1Stationary = accelVariance === null || accelVariance < CONFIG.accel_variance_threshold;
    // C-2：合算ベクトルによる動き判定（大きいほど動き）
    const c2Moving = accelDeviation !== null && accelDeviation > CONFIG.accel_motion_threshold;

    // チューニング用ログ：3つの判定が一致しない時のみ出力
    const allAgree = gpsStationary === c1Stationary && gpsStationary === !c2Moving;
    if (!allAgree) {
      wlog(
        '[C-1+C-2] 判定不一致 GPS=' +
          gpsStationary +
          ' C1=' +
          c1Stationary +
          ' C2_moving=' +
          c2Moving +
          ' var=' +
          (accelVariance != null ? accelVariance.toFixed(3) : 'null') +
          ' dev=' +
          (accelDeviation != null ? accelDeviation.toFixed(3) : 'null') +
          ' speed=' +
          speedKmh.toFixed(1) +
          'km/h'
      );
    }

    // 3点AND：GPS静止 AND C-1静止 AND C-2動きなし → 確実に静止
    // 1つでも動きを示す → 距離計測続行（保守的・代行業務向き）
    finalStationary = gpsStationary && c1Stationary && !c2Moving;
  }
  isStationary = finalStationary;
  // Phase 1.ZUPT (2026-05-10): 次 frame の Kalman 用に判定を carry
  _isStationaryLast = finalStationary;

  // T12 (2026-05-09): 急ブレーキ検出 → 速度クランプを強化
  //   速度誤検出 (GPS spike) を抑え、急ブレーキ後の異常な高速度報告をフィルタ
  let hardBrake = false;
  let clampedSpeedKmh = speedKmh;
  if (lastPosition) {
    hardBrake = _detectHardBrake(accelSamples, lastPosition.speedKmh, speedKmh, now);
    if (hardBrake) {
      // 急ブレーキ時は GPS 速度の上振れをクランプ (前 GPS 速度 ÷ 1.2 を上限)
      const cap = Math.max(5, lastPosition.speedKmh / 1.2);
      if (speedKmh > cap) {
        clampedSpeedKmh = cap;
        wlog('[T12] hardBrake clamp: ' + speedKmh.toFixed(1) + ' → ' + cap.toFixed(1) + ' km/h');
      }
    }
  }
  // T12: GPS gap 区間の慣性航法 quality check (大きな drift 推定なら GPS 信用度を下げる)
  let inertialDriftHint = null;
  if (lastPosition) {
    const dt = (now - lastPosition.timestamp) / 1000;
    if (dt > 1 && dt <= T12_INERTIAL_MAX_GAP_SEC) {
      const inertial = _inertialGapCorrection(
        lastPosition,
        accelSamples,
        filtered.lat,
        filtered.lng,
        dt
      );
      if (inertial) inertialDriftHint = inertial.driftDist;
    }
  }

  lastPosition = {
    lat: filtered.lat,
    lng: filtered.lng,
    timestamp: now,
    speedKmh: clampedSpeedKmh,
    altitude,
  };

  _prevAccuracy = accuracy;
  // 2026-05-09 (P4/P5): cellularLayerHint / accelLayerHint 廃止
  //   layer (v6 attribute) + tunnels-/bridges-{pref}.js データで完全代替
  return {
    lat: filtered.lat,
    lng: filtered.lng,
    altitude,
    accuracy,
    speedKmh: clampedSpeedKmh,
    isStationary,
    timestamp: now,
    compassHeading: compassHeading != null ? compassHeading : null,
    _debugCompass: compassHeading != null && CONFIG._compassDebug ? CONFIG._compassDebug : null,
    accelData: accelData || null,
    accelSampleCount: accelSamples ? accelSamples.length : 0,
    gyroData: gyroData || null,
    gyroSampleCount: gyroSamples ? gyroSamples.length : 0,
    // T12 (2026-05-09): diagnostic - 急ブレーキ / 慣性 drift
    hardBrake: hardBrake,
    inertialDriftHint: inertialDriftHint,
  };
}

// ─── メッセージ受信 ───
self.onmessage = function (e) {
  const { type, data } = e.data;

  if (type === 'init') {
    // 初期化：CONFIGとdebugフラグを受け取る
    if (data.config) CONFIG = Object.assign(CONFIG, data.config);
    if (data.debug !== undefined) debug = data.debug;
    kalman = new KalmanGPS();
    lastPosition = null;
    lowSpeedStart = null;
    isStationary = false;
    trafficJamSince = null;
    isTrafficJam = false;
    _isStationaryLast = false; // Phase 1.ZUPT: ZUPT carry リセット
    // 2026-05-09 (P4): cellular polling 廃止
    wlog('[Worker] 初期化完了');
    return;
  }

  if (type === 'reset') {
    // stop()時にリセット
    if (kalman) kalman.reset();
    lastPosition = null;
    lowSpeedStart = null;
    isStationary = false;
    trafficJamSince = null;
    isTrafficJam = false;
    _currentTypeCode = null; // T5: typeCode もリセット
    _isStationaryLast = false; // Phase 1.ZUPT: ZUPT carry リセット
    return;
  }

  // T5 (2026-05-09): main 経由で map-matcher の commit typeCode を受信
  //   _currentTypeCode に保持し、次回以降の Kalman 更新で動的 Q を選択
  if (type === 'setRoadType') {
    if (data && typeof data.typeCode === 'number') {
      _currentTypeCode = data.typeCode;
    } else if (data && data.typeCode == null) {
      _currentTypeCode = null;
    }
    return;
  }

  if (type === 'position') {
    // GPS座標を受け取って計算
    const result = processPosition(data);
    if (result === null) return; // スキップ
    self.postMessage({ type: 'result', data: result });
  }
};
