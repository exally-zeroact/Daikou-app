// ===========================================
// gps.js（Web Worker対応版・2026/04/27更新）
// GPS取得はメインスレッド・計算処理はWorkerで実行
// Worker非対応ブラウザは自動でフォールバック
// ===========================================
// eslint-disable-next-line no-unused-vars -- 他ファイルから GPS をグローバル参照 (cross-file global pattern)
const GPS = (() => {
  let watchId = null;
  let onUpdateCallback = null;
  let worker = null;
  let useWorker = false;

  // ─── GPS 状態管理（BUG-6・2026/05/01追加） ───
  // PERMISSION_DENIED 等で onError が呼ばれた時、状態を公式に保持し
  // meter.js / business.js / navigation.js / UI 等が参照できるようにする
  // 「許可押したのに動かない」現象（onError が console.error だけで放置）対策
  const _status = {
    state: 'unknown', // unknown / granted / denied / unavailable / timeout
    lastError: null,
    lastErrorAt: null,
    retryCount: 0,
    listeners: [],
  };
  const _MAX_RETRY = 3;
  const _RETRY_INTERVAL_MS = 10000;
  let _retryTimer = null;

  // watchPosition の共通オプション（リトライ時も同じ条件で要求）
  const _WATCH_OPTIONS = { enableHighAccuracy: true, timeout: 3000, maximumAge: 0 };

  function _setStatus(newState, err) {
    const changed = _status.state !== newState;
    _status.state = newState;
    if (err) {
      _status.lastError = { code: err.code, message: err.message };
      _status.lastErrorAt = Date.now();
    }
    if (newState === 'granted') _status.retryCount = 0;
    if (changed) {
      _status.listeners.forEach((fn) => {
        try {
          fn(getStatus());
        } catch (e) {
          console.error('[GPS] listener error:', e);
        }
      });
      if (typeof dlog === 'function') dlog('[GPS] status: ' + newState);
    }
  }

  function getStatus() {
    return {
      state: _status.state,
      lastError: _status.lastError ? { ..._status.lastError } : null,
      lastErrorAt: _status.lastErrorAt,
      retryCount: _status.retryCount,
    };
  }

  // 状態変化リスナー登録（外部公開）
  // 使用例：GPS.onStatusChange(s => { if(s.state==='denied') ... });
  function onStatusChange(fn) {
    if (typeof fn !== 'function') return;
    _status.listeners.push(fn);
    // 登録直後に現在状態を通知
    try {
      fn(getStatus());
    } catch (e) {
      /* noop - intentionally empty */
    }
  }

  // 手動再試行（UIの[再試行]ボタンから呼ぶ）
  function retryWatch() {
    if (_retryTimer) {
      clearTimeout(_retryTimer);
      _retryTimer = null;
    }
    if (watchId === null) return false; // stop()済 → 再試行しない
    if (!navigator.geolocation) return false;
    try {
      navigator.geolocation.clearWatch(watchId);
    } catch (e) {
      /* noop - intentionally empty */
    }
    try {
      watchId = navigator.geolocation.watchPosition(onPosition, onError, _WATCH_OPTIONS);
      if (typeof dlog === 'function')
        dlog('[GPS] retry watchPosition (count=' + _status.retryCount + ')');
      return true;
    } catch (e) {
      if (typeof dlog === 'function') dlog('[GPS] retry error: ' + e.message);
      return false;
    }
  }

  // コンパス（DeviceOrientation・許可不要）
  let compassHeading = null;

  // G3 (2026-05-09): 地磁気偏差テーブル (簡易・主要都市バウンディングボックス)
  //   iOS の webkitCompassHeading は真北・Android の alpha は磁北
  //   日本の地磁気偏差は -7° 〜 -8° (西偏) で都市別に細部差
  //   端末位置から偏差を引くと真北 heading に統一
  //   Android の alpha (磁北) → 真北補正後 heading で MM heading scoring に渡す
  function _magneticDeclination(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number') return -7.5;
    // 北海道
    if (lat >= 41.0) return -9.5;
    // 東北
    if (lat >= 37.0) return -8.5;
    // 関東・甲信越
    if (lat >= 35.0 && lng >= 138.0) return -7.5;
    // 東海・近畿
    if (lat >= 33.5 && lng >= 135.0) return -7.0;
    // 中国・四国
    if (lat >= 33.0 && lng >= 132.0) return -6.5;
    // 九州・沖縄
    if (lat >= 30.0) return -6.0;
    // 沖縄離島
    return -4.5;
  }
  let _lastKnownLat = null;
  let _lastKnownLng = null;

  // 加速度センサー（DeviceMotion・案A・2026/04/29）
  let accelData = null; // 直近値: {x,y,z,t}
  let accelBuffer = []; // GPS更新までのサンプル蓄積（C段階で詳細解析に使う）

  // ジャイロセンサー（DeviceMotion・案A・2026/04/29）
  let gyroData = null; // 直近値: {alpha,beta,gamma,t}
  let gyroBuffer = []; // GPS更新までのサンプル蓄積

  // リスナー重複登録防止フラグ（B段階修正・2026/04/30追加）
  // iOS PWAで2回目以降の代行開始時にセンサーが動かなくなる現象の対策
  // 1度登録したリスナーは PWA 起動中ずっと生かす
  let _compassListenerAdded = false;
  let _motionListenerAdded = false;

  // 業務中フラグ（D案・2026/05/06追加）
  // リスナーは PWA 起動中ずっと生かしたまま（iOS PWA 対策・上記）、
  // 業務終了中はリスナー内でデータ蓄積・コンパス更新をスキップする。
  // start() で true、stop() で false。
  let _isBizActive = false;
  function startCompass() {
    if (!window.DeviceOrientationEvent) {
      dlog('[GPS] コンパス非対応');
      return;
    }
    // リスナー重複登録防止（B段階修正・2026/04/30）
    if (_compassListenerAdded) {
      dlog('[GPS] コンパスリスナー登録済・スキップ');
      return;
    }

    function addCompassListener() {
      let compassCount = 0;
      window.addEventListener(
        'deviceorientation',
        function (e) {
          // 業務中のみコンパス更新（D案・2026/05/06）
          // リスナーは生かしたまま、業務終了中は値を更新しない
          if (!_isBizActive) return;
          compassCount++;
          if (compassCount === 1) {
            dlog(
              '[GPS] DeviceOrientation発火 webkitCompassHeading=' +
                e.webkitCompassHeading +
                ' alpha=' +
                e.alpha
            );
          }
          if (e.webkitCompassHeading != null) {
            // iOS は真北 (no correction needed)
            if (compassHeading === null)
              dlog('[GPS] コンパス初回取得(iOS 真北): ' + e.webkitCompassHeading.toFixed(0) + '°');
            compassHeading = e.webkitCompassHeading;
          } else if (e.alpha != null) {
            // Android は磁北・地磁気偏差で真北補正 (G3 2026-05-09)
            const magHeading = (360 - e.alpha + (e.beta || 0) * 0.1) % 360;
            const decl = _magneticDeclination(_lastKnownLat, _lastKnownLng);
            // 真北 = 磁北 + 偏差 (西偏は負・引くと真北になる→西偏を加算)
            const trueHeading = (magHeading + decl + 360) % 360;
            if (compassHeading === null)
              dlog(
                '[GPS] コンパス初回取得(Android 磁北→真北補正): ' +
                  magHeading.toFixed(0) +
                  '° decl=' +
                  decl.toFixed(1) +
                  '° → ' +
                  trueHeading.toFixed(0) +
                  '°'
              );
            compassHeading = trueHeading;
          }
        },
        true
      );
      _compassListenerAdded = true; // 登録完了フラグ（B段階修正・2026/04/30）
      setTimeout(() => {
        if (compassHeading === null) dlog('[GPS] コンパス3秒後もnull');
        else dlog('[GPS] コンパス取得済: ' + compassHeading.toFixed(0) + '°');
      }, 3000);
    }

    // iOS 13+：requestPermissionはonMainBtn()で直接呼び済み
    // _compassGrantedフラグを確認してリスナー追加
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      if (window._compassGranted) {
        dlog('[GPS] コンパス許可済・リスナー追加');
        addCompassListener();
      } else {
        dlog('[GPS] コンパス未許可・リスナーなし');
      }
    } else {
      // Android・iOS 12以前：許可不要
      addCompassListener();
    }
    dlog('[GPS] コンパス起動完了');
  }

  // 加速度センサー（DeviceMotion・案A・2026/04/29）
  function startMotion() {
    if (!window.DeviceMotionEvent) {
      dlog('[GPS] 加速度センサー非対応');
      return;
    }
    // リスナー重複登録防止（B段階修正・2026/04/30）
    if (_motionListenerAdded) {
      dlog('[GPS] 加速度・ジャイロリスナー登録済・スキップ');
      return;
    }

    function addMotionListener() {
      let motionCount = 0;
      window.addEventListener(
        'devicemotion',
        function (e) {
          // 業務中のみデータ蓄積（D案・2026/05/06）
          // リスナーは生かしたまま、業務終了中は加速度・ジャイロを蓄積しない
          if (!_isBizActive) return;
          const acc = e.accelerationIncludingGravity;
          const rot = e.rotationRate;
          if (!acc) return;
          motionCount++;

          const t = Date.now();

          // 加速度（A段階・既存）
          const accSample = {
            x: acc.x || 0,
            y: acc.y || 0,
            z: acc.z || 0,
            t: t,
          };
          accelData = accSample; // 直近値
          accelBuffer.push(accSample); // バッファ蓄積（GPS更新時にWorkerへ）
          if (accelBuffer.length > 200) accelBuffer.shift();

          // ジャイロ（B段階・新規）
          // null安全：rot自体null/プロパティ全てnull/非オブジェクトを完全防御
          if (
            rot &&
            typeof rot === 'object' &&
            (rot.alpha != null || rot.beta != null || rot.gamma != null)
          ) {
            const gyroSample = {
              alpha: rot.alpha || 0, // ヨー（左右回転・ハンドル操作）
              beta: rot.beta || 0, // ピッチ（前後傾き・坂道）
              gamma: rot.gamma || 0, // ロール（左右傾き・カーブ）
              t: t,
            };
            gyroData = gyroSample;
            gyroBuffer.push(gyroSample);
            if (gyroBuffer.length > 200) gyroBuffer.shift();
          }

          // 初回ログ（加速度＋ジャイロ状態を一括表示）
          if (motionCount === 1) {
            let gyroStatus;
            if (!rot) gyroStatus = 'rot自体null';
            else if (typeof rot !== 'object') gyroStatus = '非object';
            else if (rot.alpha == null && rot.beta == null && rot.gamma == null)
              gyroStatus = '全プロパティnull';
            else
              gyroStatus =
                'α=' +
                (rot.alpha || 0).toFixed(2) +
                ' β=' +
                (rot.beta || 0).toFixed(2) +
                ' γ=' +
                (rot.gamma || 0).toFixed(2);
            dlog(
              '[GPS] DeviceMotion発火 加速度x=' + accSample.x.toFixed(2) + ' ジャイロ=' + gyroStatus
            );
          }
        },
        true
      );
      _motionListenerAdded = true; // 登録完了フラグ（B段階修正・2026/04/30）

      setTimeout(() => {
        if (accelData === null) dlog('[GPS] 加速度3秒後もnull');
        else dlog('[GPS] 加速度取得済 サンプル数=' + accelBuffer.length);
        if (gyroData === null) dlog('[GPS] ジャイロ3秒後もnull');
        else dlog('[GPS] ジャイロ取得済 サンプル数=' + gyroBuffer.length);
      }, 3000);
    }

    // iOS 13+: requestPermissionは index.html の requestSensorPermission() で済み
    // _motionGrantedフラグを確認してリスナー追加
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      if (window._motionGranted) {
        dlog('[GPS] 加速度許可済・リスナー追加');
        addMotionListener();
      } else {
        dlog('[GPS] 加速度未許可・リスナーなし');
      }
    } else {
      // Android・iOS 12以前：許可不要
      addMotionListener();
    }
    dlog('[GPS] 加速度センサー起動完了');
  }

  // フォールバック用状態変数（Worker非対応時）
  let lastPosition = null;
  let lowSpeedStart = null;
  // ★A3 (2026-05-26): main スレッドの raw 連続点 (= worker/fallback の accept/reject に
  //   依存しない) を保持し、coords.speed が null/欠落の時に haversine 速度を代用するための前点。
  let _rawPrevPos = null; // { lat, lng, t }
  const _HAVER_SPEED_MAX_KMH = 180; // A3: 代用速度の物理上限クランプ (spike で accuracy 上限を緩めすぎない)
  // ★Fix③ (2026-05-28): 高レート端末(Android ~5Hz)の worker 送信を最小間隔で間引く。
  //   目的: 5Hz の sub-second 区間を多数 sum する drift over-count(暴走)を net 変位ベースに抑制。
  //   ・1Hz 端末(iOS)は間隔 >= 本値 で素通り(無影響)。
  //   ・間引き時は accelBuffer を drain せず累積 / _rawPrevPos も据え置き(A3 は送信点間で計測)。
  //   ・安全側=過少(過大課金NG): 直線は net≈sum で不変・曲線は弦で過少・drift は相殺で過大が減る。
  //   ★仮説ベース(走行ログ未取得・本ログは静止のみ)・[MMDBG] 走行ログで検証/調整する暫定対策★
  const GPS_MIN_SEND_INTERVAL_MS = 700;
  let _lastWorkerSendT = null;
  // ★タイマー連続前進 (2026-06-10・トンネル一括ドン根治)★:
  //   watchPosition は GPS fix が来ないと onPosition を発火しない=トンネルで距離/センサー/OBD が
  //   丸ごと凍結し、GPS 復帰の1点で「ドン」と一括計上(実機 iPhone13 +1147m)。これを断つため
  //   ★GPS イベントから独立した自走タイマー★ で「GPS stale(穴)中だけ」距離を連続前進させる。
  //   速度源優先順 (司さん裁定・二葉方式):
  //     ① OBD valid (Android接続時) = 車輪速度を speedSrc='obd' で送り pipeline が ∫v(OBD)×dt 積分。
  //     ② OBD無し (iPhone) = 直近確立速度 _coastHoldKmh を減衰ホールド (speedSrc='coast' = pipeline
  //        は spd 既知の coast 経路で速度×dt・never-over クランプ付き)。★加速度二重積分は禁止★。
  //     ③ 速度未確立 (_coastHoldKmh<=0) = 何もしない (過大ゼロ保険)。
  //   ★二重計上の構造的遮断★: 合成送信でも _lastWorkerSendT と「合成点の t」を前進させる。位置
  //   (lat/lng) は前回 raw 点に据え置く (位置は動かさず距離だけ前進)。これにより GPS 復帰 fix の
  //   worker 側 prev.t は ★最後の合成送信時刻★ となり、復帰区間 dt が小さくなって「ドン」が起きない。
  //   穴明け区間は「合成で埋めた分 + 復帰点の残差」= 加法的に正しく一致 (トンネル全長を二度数えない)。
  const GAP_TIMER_INTERVAL_MS = 150; // 自走 tick 周期 (~6.7Hz)
  const GAP_STALE_MS = 1800; // この時間 worker 送信が無い=穴 (watchPosition timeout 3000ms より短く即応)
  const COAST_DECAY_PER_S = 0.92; // 保守速度ホールドの毎秒減衰 (過大ゼロ側=安全)。
  //   ★0.97→0.92 へ強化 (監査 P0)★: 走行中トンネルは accel-ZUPT(下記)と穴明け実 fix の速度再確立で
  //   守られるため、減衰は creep の長い裾を縮める方向に強める。停車中は accel-ZUPT が即凍結し、
  //   仮に ZUPT を取りこぼしても 0.92 + 累積時間 cap(COAST_HOLE_MAX_SEC) で creep は床に落ちる。
  const COAST_MIN_KMH = 0.5; // これ未満は 0 とみなし前進停止 (creep 防止・停車是認)
  // ★stop-in-hole creep ガード (2026-06-10・監査 P0)★: 穴中で物理停車した時、0.97/s 減衰の
  //   長い裾を speed×dt で積分し続けると phantom creep (40km/h進入で+347.5m/144s) が乗る。
  //   ① 累積 coast 時間/距離が cap を超えたら以後その穴は前進停止 (= 停車是認・凍結)。
  //   ② 合成ホールド速度が creep 速度域 (COAST_FREEZE_KMH) まで減衰したら以後その穴は凍結。
  //   pipeline-distance.js 側にも同等の synthetic-coast cap がある (多層防御)。OBD valid 時は
  //   車輪速度が停車で 0 になるためガードはホールド coast (非OBD) のみに作用。
  const COAST_HOLE_MAX_SEC = 25; // 1穴あたり合成 coast を許す累積秒数 (認定 creep<30s 内)
  const COAST_HOLE_MAX_M = 600; // 1穴あたり合成 coast を許す累積距離 m (高速トンネル内包)
  const COAST_FREEZE_KMH = 9.0; // ホールド速度がこれ未満に減衰=減速停車 → 以後その穴は前進停止 (≈2.5m/s)
  let _gapTimer = null; // 自走タイマー id
  let _coastHoldKmh = 0; // 直近確立速度 (km/h)。穴中の保守ホールドの初速。
  let _coastHoldUpdatedT = null; // _coastHoldKmh の減衰計算用の最終更新時刻
  let _lastSyntheticT = null; // 最後の合成送信時刻 (減衰 dt 計算用)
  // ★穴 (synthetic coast) 1回あたりの累積ガード状態★ (実 fix 復帰でリセット)
  let _coastHoleSec = 0; // この穴で合成 coast を積分した累積秒数
  let _coastHoleM = 0; // この穴で合成 coast が前進させた累積距離 m
  let _coastHoleFrozen = false; // この穴は cap/減速停車で前進停止済
  let isStationary = false;
  let trafficJamSince = null;
  let isTrafficJam = false;
  let kalman = null;

  const CONFIG = {
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
    kalman_Q: 3,
    jam_speed_max_kmh: 10,
    jam_duration_sec: 60,
    // ★加速度 variance ZUPT (gps.js 側・stop-in-hole 凍結用)★: gps-worker.js の同名定数と整合。
    accel_variance_threshold: 0.1, // m²/s⁴・これ未満=静止 (停車中の穴 coast を凍結)
    accel_variance_window_ms: 3000, // 直近この時間のサンプルで分散計算 (穴中の即応性のため5s→3s)
    accel_variance_min_samples: 5, // この件数未満なら判定不能 (null=スキップ)
  };

  // ★加速度 variance 計算 (gap tick ZUPT 用・gps-worker.calcAccelVariance と同式)★:
  //   accelBuffer は穴中も蓄積され続ける (drain は onPosition のみ) ため、直近窓の |a| 分散で
  //   「車が物理的に止まっているか」を判定する。静止=分散ほぼ0 (重力のみ)・走行=振動で分散大。
  //   戻り値: variance (m²/s⁴) | null (サンプル不足 or 加速度なし端末)。
  function _coastAccelVariance(now) {
    if (!accelBuffer || accelBuffer.length < CONFIG.accel_variance_min_samples) return null;
    const w = CONFIG.accel_variance_window_ms;
    const recent = accelBuffer.filter((s) => s && typeof s.t === 'number' && now - s.t < w);
    if (recent.length < CONFIG.accel_variance_min_samples) return null;
    const mags = recent.map((s) => Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z));
    const mean = mags.reduce((a, b) => a + b, 0) / mags.length;
    return mags.reduce((sum, m) => sum + (m - mean) * (m - mean), 0) / mags.length;
  }

  function initWorker() {
    if (typeof Worker === 'undefined') {
      dlog('[GPS] Web Worker非対応 → フォールバック');
      useWorker = false;
      return;
    }
    try {
      worker = new Worker('js/gps-worker.js');
      worker.postMessage({
        type: 'init',
        data: {
          config: CONFIG,
          debug: typeof DEBUG !== 'undefined' ? DEBUG.enabled : false,
        },
      });
      worker.onmessage = function (e) {
        // ★STEP0 診断 (2026-05-28): worker から GPS層の値を受けて Eruda に出す (read-only・worker側で throttle 済)
        if (e.data.type === 'gpsDbg') {
          const o = e.data.data || {};
          if (typeof dlog === 'function') {
            if (o.rej) {
              dlog(
                '[GPSREJ] reason=' +
                  o.rej +
                  ' spd=' +
                  (o.spd || 0).toFixed(1) +
                  ' src=' +
                  (o.src || '?') +
                  ' acc=' +
                  (o.acc || 0).toFixed(1) +
                  ' lim=' +
                  (o.lim || 0)
              );
            } else {
              dlog(
                '[GPSDBG] spd=' +
                  (o.spd || 0).toFixed(1) +
                  ' src=' +
                  (o.src || '?') +
                  ' stat=' +
                  (o.stat ? 'T' : 'F') +
                  ' acc=' +
                  (o.acc || 0).toFixed(1) +
                  ' lim=' +
                  (o.lim || 0)
              );
            }
          }
          return;
        }
        if (e.data.type === 'result') {
          const d = e.data.data;
          if (d._debugCompass) dlog('[GPS]', d._debugCompass);
          // コンパス値がWorkerに届いているか定期確認（10回に1回）
          if (d.compassHeading != null && Math.random() < 0.1) {
            dlog('[GPS] compass届いてる:', d.compassHeading.toFixed(0) + '°');
          }
          if (onUpdateCallback) onUpdateCallback(d);
        }
      };
      worker.onerror = function (err) {
        console.error('[GPS] Worker エラー → フォールバック:', err.message);
        useWorker = false;
        kalman = new KalmanGPS();
      };
      useWorker = true;
      dlog('[GPS] Web Worker起動完了');
    } catch (e) {
      console.error('[GPS] Worker起動失敗 → フォールバック:', e.message);
      useWorker = false;
    }
  }

  function start(callback) {
    onUpdateCallback = callback;
    // 業務中フラグON（D案・2026/05/06）
    // 既に登録済みのリスナー内で蓄積を再開させるため、startCompass/startMotion より先に立てる
    _isBizActive = true;
    startCompass(); // コンパス起動（許可不要）
    startMotion(); // 加速度センサー起動（案A・2026/04/29）
    if (!worker) initWorker();
    _rawPrevPos = null; // A3: 業務開始時に代用速度の前点をリセット (worker/非worker 共通)
    _lastWorkerSendT = null; // ★Fix③: 開始時リセット (最初の点を確実に送信)
    if (!useWorker) {
      kalman = new KalmanGPS();
      lastPosition = null;
      lowSpeedStart = null;
      isStationary = false;
      trafficJamSince = null;
      isTrafficJam = false;
    } else {
      worker.postMessage({
        type: 'init',
        data: {
          config: CONFIG,
          debug: typeof DEBUG !== 'undefined' ? DEBUG.enabled : false,
        },
      });
    }
    if (!navigator.geolocation) {
      alert('GPSに対応していません');
      return;
    }
    // BUG-6（2026/05/01）：リトライ可能なように共通オプション使用
    watchId = navigator.geolocation.watchPosition(onPosition, onError, _WATCH_OPTIONS);
    // ★タイマー連続前進を起動 (GPS イベント独立・トンネル穴埋め)★
    _coastHoldKmh = 0;
    _coastHoldUpdatedT = null;
    _lastSyntheticT = null;
    if (_gapTimer) clearInterval(_gapTimer);
    if (useWorker) _gapTimer = setInterval(_gapTick, GAP_TIMER_INTERVAL_MS);
  }

  function stop() {
    // 業務中フラグOFF（D案・2026/05/06）
    // 以降 devicemotion / deviceorientation 発火してもリスナー内で early return する。
    // リスナー登録自体は維持（iOS PWAでremoveすると2回目以降動かないため）。
    _isBizActive = false;
    // リトライタイマーをクリア（stop後のゾンビリトライ防止）
    if (_retryTimer) {
      clearTimeout(_retryTimer);
      _retryTimer = null;
    }
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    // ★タイマー連続前進を停止 (穴埋めのゾンビ前進防止)★
    if (_gapTimer) {
      clearInterval(_gapTimer);
      _gapTimer = null;
    }
    _coastHoldKmh = 0;
    _coastHoldUpdatedT = null;
    _lastSyntheticT = null;
    // 加速度バッファクリア（案A・2026/04/29）
    accelBuffer = [];
    accelData = null;
    // ジャイロバッファクリア（B段階・2026/04/29）
    gyroBuffer = [];
    gyroData = null;
    _rawPrevPos = null; // A3: 停止/リセット時に代用速度の前点をリセット (worker/非worker 共通)
    _lastWorkerSendT = null; // ★Fix③: 停止/リセット時リセット
    if (useWorker && worker) {
      worker.postMessage({ type: 'reset', data: {} });
    } else {
      if (kalman) kalman.reset();
      lastPosition = null;
      lowSpeedStart = null;
      isStationary = false;
      trafficJamSince = null;
      isTrafficJam = false;
    }
  }

  function onPosition(pos) {
    // BUG-6（2026/05/01）：GPS 取得成功 → 状態を granted に更新
    if (_status.state !== 'granted') _setStatus('granted', null);
    const now = Date.now();
    const { latitude: lat, longitude: lng, accuracy, speed, heading, altitude } = pos.coords;
    // G3 (2026-05-09): 最新位置を地磁気偏差ルックアップ用に記録
    _lastKnownLat = lat;
    _lastKnownLng = lng;
    // ★Fix③ (2026-05-28): 高レート端末は最小間隔未満の点を間引く (worker 経路のみ)。
    //   ★§1-A drain bug 修正 (2026-05-30)★: 早期 return 時に accelBuffer/gyroBuffer を
    //   drain せず累積すると、間引き区間に蓄積した古い accel/gyro が次回送信に混入し
    //   worker の accel variance (静止判定の主信号) を汚染する。
    //   → 間引き時は buffer を破棄して持ち越しを断つ。直近値 (accelData/gyroData) は据え置く
    //     (= 次回送信で直近 1 点は accelData として参照可・variance window には混ぜない)。
    //   静止判定の閾値・挙動は不変 (= 汚染除去のみ・creep0 を壊さない安全側)。
    //   _rawPrevPos は据え置き(A3 は送信点間で計測)・_lastWorkerSendT も据え置き。
    if (
      useWorker &&
      _lastWorkerSendT != null &&
      now - _lastWorkerSendT < GPS_MIN_SEND_INTERVAL_MS
    ) {
      accelBuffer = [];
      gyroBuffer = [];
      return;
    }
    // ★A3 (2026-05-26): coords.speed が null/欠落の時 (= iOS Safari 全機で常時・弱GPS Android でも) は、
    //   直前 raw GPS 点からの haversine 速度を代用する。
    //   目的: 低速時 accuracy 上限 10m デッドロック (= 弱GPS端末/条件で speed=0→上限10m固定→
    //         全点 reject→速度上がらず→永久10m) を断ち切る + 速度連動 accuracy 上限の適正化。
    //   方針:
    //     ・raw 連続点ベース (= Kalman/snap を経由しない main スレッドの前点) で算出するため
    //       worker/fallback の accept/reject に依存せず常時更新される (= deadlock を解く核心)。
    //     ・距離計算には一切使わない (= 表示/課金距離は従来経路のまま・絶対ルール準拠)。
    //       本値は accuracy 上限選択 / 停車判定 / Doppler 整合などゲート用の速度推定にのみ供給。
    //     ・物理上限でクランプ (= GPS spike で accuracy 上限を緩めすぎないため)。
    //     ・dt が範囲外 (<=0 or >=10秒) は代用せず 0 (= バックグラウンド復帰等の stale 前点を除外)。
    let speedKmh = speed != null && speed >= 0 ? speed * 3.6 : 0;
    // ★STEP0 (2026-06-13): 生 GNSS Doppler 速度を OBD 上書き前に温存★ (赤チーム指摘=従来は L632 で
    //   OBD に潰され下流に届かず、OBDティアの過大ゼロ天井(pipeline: min(∫v, dopP25·dt))の入力が無かった)。
    //   coords.speed は搬送波 Doppler 由来=タイヤ非経由=過大ゼロの独立基準。haversine 代用(_kmh)は使わない
    //   (位置ジッタ由来で天井に不適)。null/欠落/無効は -1 (= 天井非適用=従来∫v退避)。距離源は不変。
    const _dopMps = speed != null && speed >= 0 ? speed : -1;
    if ((speed == null || speed < 0) && _rawPrevPos) {
      const _dtSpeed = (now - _rawPrevPos.t) / 1000;
      if (_dtSpeed > 0 && _dtSpeed < 10) {
        const _dSpeed = calcDistance(_rawPrevPos.lat, _rawPrevPos.lng, lat, lng);
        const _kmh = (_dSpeed / _dtSpeed) * 3.6;
        if (isFinite(_kmh) && _kmh > 0) speedKmh = Math.min(_kmh, _HAVER_SPEED_MAX_KMH);
      }
    }
    // raw 前点を毎回更新 (= reject の有無に依存しない・次フレームの代用速度の基準)
    //   acc も保持: タイマー穴埋めの合成点が直近実 accuracy を踏襲し pipeline gapGuard と整合させる。
    _rawPrevPos = { lat, lng, t: now, acc: accuracy };
    // ★OBD 速度源 (2026-06-05・obd ブランチ・★既定 OFF★)★:
    //   window.OBD_DRIVE_DISTANCE が true かつ OBD アダプターから鮮度 OK の車速が来ている時のみ、
    //   speedKmh を ★車輪由来の OBD 値★ で上書きし、speedSrc='obd' を立てる。
    //   → worker(map-matcher)→pipeline-distance が ★距離を ∫v(OBD)=車輪速度×dt で駆動★ する
    //   (OBD メインモード・タクシー認定メーター方式・タイヤ値直結)。道路 map-matching は OBD が
    //   無効/未接続/iPhone の時のフォールバックに退く。
    //   ★未接続 / 鮮度切れ / flag OFF (既定) は GPS Doppler のまま = 既存挙動 1byte 不変★。
    //   実機 OBD で検証後に flag を立てる。距離コアの意味論(道路 snap)は不変・速度源を差すだけ。
    let _speedFromObd = false;
    try {
      if (typeof window !== 'undefined' && window.OBD_DRIVE_DISTANCE && window.OBDClient) {
        const _obd = window.OBDClient.getSpeed();
        if (_obd && _obd.valid && _obd.kmh >= 0) {
          speedKmh = _obd.kmh;
          _speedFromObd = true;
        }
      }
    } catch (_) {
      /* OBD 不在/例外は無視し GPS 速度を継続 */
    }
    // ★STEP0 診断: speedKmh の源 (obd / Doppler / A3 haversine代用) を worker に伝える (read-only)
    const _speedSrc = _speedFromObd ? 'obd' : speed != null && speed >= 0 ? 'dop' : 'hav';
    // ★タイマー連続前進の保守ホールド初速を更新★: 本物 fix の妥当な速度 (Doppler or OBD) を
    //   _coastHoldKmh に確立する。'hav' 代用速度は位置ジッタ由来で過大初速になりうるため除外
    //   (穴中は確かな直近速度のみを減衰ホールド)。穴明けの実 fix で常に再確立される。
    if ((_speedSrc === 'dop' || _speedSrc === 'obd') && speedKmh >= 0) {
      _coastHoldKmh = speedKmh;
      _coastHoldUpdatedT = now;
    }
    // 本物の fix が来た = 穴が明けた。合成タイマーの基準時刻を実 fix に同期し、次フレームの
    //   合成 dt がゼロ近傍から始まるようにする (= 復帰直後に合成が二重前進しない)。
    _lastSyntheticT = now;
    // ★穴明け = stop-in-hole 累積ガードをリセット (次の穴に持ち越さない)★
    _coastHoleSec = 0;
    _coastHoleM = 0;
    _coastHoleFrozen = false;
    // 加速度サンプル取り出し（案A・2026/04/29）
    const accelSamples = accelBuffer.slice();
    accelBuffer = [];
    // ジャイロサンプル取り出し（B段階・2026/04/29）
    const gyroSamples = gyroBuffer.slice();
    gyroBuffer = [];
    if (useWorker) {
      _lastWorkerSendT = now; // ★Fix③: 送信時刻を記録 (次点の間引き判定用)
      worker.postMessage({
        type: 'position',
        data: {
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
          speedSrc: _speedSrc, // ★STEP0 診断
          dopMps: _dopMps, // ★STEP0: 生Doppler速度(m/s・-1=無効)= OBDティア過大ゼロ天井の独立基準
        },
      });
    } else {
      const result = processPositionFallback(lat, lng, accuracy, speedKmh, heading, altitude, now);
      if (result && onUpdateCallback) onUpdateCallback(result);
    }
  }

  // ★タイマー連続前進 tick (2026-06-10)★: GPS stale 中だけ合成 position を worker へ送り距離を前進。
  //   GPS が新鮮な間 (now - _lastWorkerSendT < GAP_STALE_MS) は ★何もしない★ = 既存パイプライン
  //   (onPosition→worker) に完全に任せ二重計上しない。穴中のみ前進させ、合成点は位置据え置き+t前進。
  function _gapTick() {
    try {
      if (!_isBizActive || !useWorker || !worker) return;
      const now = Date.now();
      // 穴判定: 直近の worker 送信 (実 fix or 合成) から GAP_STALE_MS 経過したか。
      if (_lastWorkerSendT == null || now - _lastWorkerSendT < GAP_STALE_MS) return;
      // 位置の据え置き基準が無い (= まだ1点も受信していない) なら前進しない。
      if (!_rawPrevPos) return;

      // ── 速度源優先順 (司さん裁定) ──
      let fillKmh = -1;
      let fillSrc = 'coast';
      // ① OBD valid → 車輪速度で連続積分 (トンネルも正確・滑らか)。speedSrc='obd' で pipeline ∫v 駆動。
      let _obdValid = false;
      try {
        if (typeof window !== 'undefined' && window.OBD_DRIVE_DISTANCE && window.OBDClient) {
          const _obd = window.OBDClient.getSpeed();
          if (_obd && _obd.valid && _obd.kmh >= 0) {
            fillKmh = _obd.kmh;
            fillSrc = 'obd';
            _obdValid = true;
            // OBD は車輪源で信頼できる = ホールド初速も OBD 値で更新 (穴中の coast 連続性維持)。
            _coastHoldKmh = _obd.kmh;
            _coastHoldUpdatedT = now;
          }
        }
      } catch (_) {
        /* OBD 不在/例外は無視し ② 保守ホールドへ */
      }
      // ② OBD 無し = 直近確立速度を毎秒 ×0.97 減衰してホールド (保守側=過大ゼロ)。
      if (!_obdValid) {
        if (_coastHoldKmh > 0 && _coastHoldUpdatedT != null) {
          const decayDt = (now - _coastHoldUpdatedT) / 1000;
          if (decayDt > 0) {
            _coastHoldKmh = _coastHoldKmh * Math.pow(COAST_DECAY_PER_S, decayDt);
            _coastHoldUpdatedT = now;
          }
          fillKmh = _coastHoldKmh;
        } else {
          fillKmh = -1; // ③ 速度未確立 = 前進しない (過大ゼロ保険)
        }
      }
      // ③ 停車是認: ホールド速度が閾値未満なら 0 とみなし前進停止 (creep 防止)。
      if (!_obdValid && (fillKmh < COAST_MIN_KMH || fillKmh < 0)) {
        // 速度を進めないが _lastWorkerSendT は更新しない (= 次 tick でも穴判定を維持)。
        // ★last_timestamp 汚染を避けるため worker へは送らない★ = distance 0・凍結是認 (停車)。
        return;
      }
      // ★stop-in-hole creep ガード (監査 P0・非OBD ホールド coast のみ)★:
      //   OBD valid は車輪速度が停車で正しく 0 になるためガード不要。非OBD の保守ホールド coast は、
      //   穴中で物理停車した時に減衰の長い裾を積分し続け phantom creep を生むため多層で凍結する。
      //   (c) ★加速度分散 ZUPT 静止判定★: 穴中も accelBuffer は蓄積され続ける (drain は onPosition のみ)。
      //       直近窓の |a| 分散が静止閾値未満 = 車が物理的に止まっている → 即凍結 (creep の主防御)。
      //       ★二重積分は禁止だが「静止検出」は可★ (司さん裁定)。加速度センサ不在端末は null=スキップ。
      //   ① ホールド速度が creep 速度域 (COAST_FREEZE_KMH) まで減衰 → 以後その穴は凍結。
      //   ② 累積 coast 時間/距離が cap 超過 → 以後その穴は凍結 (ZUPT 取りこぼし時の最終床)。
      //   凍結後は worker へ送らず距離 0 (停車是認)。穴明けの実 fix で _coastHole* はリセット済。
      if (!_obdValid) {
        const _av = _coastAccelVariance(now);
        if (_av != null && _av < CONFIG.accel_variance_threshold) _coastHoleFrozen = true;
        if (fillKmh < COAST_FREEZE_KMH) _coastHoleFrozen = true;
        if (_coastHoleSec >= COAST_HOLE_MAX_SEC || _coastHoleM >= COAST_HOLE_MAX_M)
          _coastHoleFrozen = true;
        if (_coastHoleFrozen) return; // 前進停止 (= 停車是認・creep 防止)
      }

      // ★gps-worker を ★バイパス★ し onUpdateCallback へ直接 合成 result を渡す★:
      //   gps-worker の Kalman/静止判定/accuracy 棄却は ★実 GPS ノイズ用★ で、位置据え置きの合成
      //   coast 点を流すと「変位ゼロ→isStationary=true→meter 早期 return→距離凍結」となり穴埋めが
      //   死ぬ。よって gps-worker を通さず、worker の出力と同形の result を ★自前で組み★ 直接
      //   onUpdateCallback (= index.html → Meter.update) へ渡す。isStationary=false・isSynthetic=true。
      //   distance は Meter._updateMapMatching → mmWorker (map-matcher) で speed×dt 前進する。
      // ★非OBD coast の累積ガード更新★: 実際に前進させた区間の 時間/距離 を 1 穴単位で積算。
      //   (_lastSyntheticT は穴明けの実 fix でも更新されるため、穴の起点からの累積を正しく刻む)
      if (!_obdValid && _lastSyntheticT != null) {
        const _coastDt = (now - _lastSyntheticT) / 1000;
        if (_coastDt > 0 && _coastDt <= 10) {
          _coastHoleSec += _coastDt;
          _coastHoleM += (fillKmh / 3.6) * _coastDt;
        }
      }
      _lastWorkerSendT = now;
      _lastSyntheticT = now;
      if (onUpdateCallback) {
        onUpdateCallback({
          lat: _rawPrevPos.lat, // 位置据え置き (距離は速度×dt のみ・位置は動かさない)
          lng: _rawPrevPos.lng,
          altitude: null,
          accuracy: _rawPrevPos.acc != null ? _rawPrevPos.acc : 30, // 直近実 acc を踏襲 (gapGuard 整合)
          speedKmh: fillKmh,
          speedSrc: fillSrc, // 'obd' = ∫v(OBD) 駆動 / 'coast' = 速度既知の穴埋め
          isStationary: false, // ★穴埋めは停車でない (前進させる)。停車是認は上の COAST_MIN_KMH ゲートで処理済。
          timestamp: now,
          compassHeading: compassHeading != null ? compassHeading : null,
          isSynthetic: true, // ★合成印 (map-matcher が平滑バッファをバイパスし即 _core で前進)
        });
      }
    } catch (_) {
      /* tick の例外は距離パスに影響させない */
    }
  }

  // フォールバック用Kalman
  class KalmanGPS {
    constructor() {
      this._lat = null;
      this._lng = null;
      this._accuracy = 0;
      this._timestamp = null;
    }
    reset() {
      this._lat = null;
      this._lng = null;
      this._accuracy = 0;
      this._timestamp = null;
    }
    update(lat, lng, accuracy, timestamp) {
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
      const Q = CONFIG.kalman_Q;
      const decayed = Math.sqrt(this._accuracy * this._accuracy + Q * Q * dt * dt);
      const K = (decayed * decayed) / (decayed * decayed + accuracy * accuracy);
      this._lat = this._lat + K * (lat - this._lat);
      this._lng = this._lng + K * (lng - this._lng);
      this._accuracy = Math.sqrt((1 - K) * decayed * decayed);
      this._timestamp = timestamp;
      if (!isFinite(this._lat) || !isFinite(this._lng)) {
        this._lat = lat;
        this._lng = lng;
        this._accuracy = accuracy;
        return { lat, lng };
      }
      return { lat: this._lat, lng: this._lng };
    }
  }

  function processPositionFallback(lat, lng, accuracy, speedKmh, heading, altitude, now) {
    const accLimit = getDynamicAccuracyLimit(speedKmh, now);
    if (accuracy > accLimit) return null;
    if (lastPosition) {
      const jump = calcDistance(lastPosition.lat, lastPosition.lng, lat, lng);
      const timeDiff = (now - lastPosition.timestamp) / 1000;
      if (timeDiff > 0 && jump / timeDiff > CONFIG.jump_limit_m_per_s) return null;
    }
    if (
      lastPosition &&
      lastPosition.speedKmh != null &&
      lastPosition.speedKmh > 1 &&
      speedKmh > 1
    ) {
      const dt = (now - lastPosition.timestamp) / 1000;
      if (dt > 0 && dt < 5) {
        const acc = (speedKmh - lastPosition.speedKmh) / 3.6 / dt;
        if (Math.abs(acc) > CONFIG.max_acceleration_ms2) {
          dlog('[GPS] 加速度異常スキップ');
          return null;
        }
      }
    }
    if (
      lastPosition &&
      heading != null &&
      heading >= 0 &&
      speedKmh >= CONFIG.heading_check_min_speed_kmh
    ) {
      const d = calcDistance(lastPosition.lat, lastPosition.lng, lat, lng);
      if (d >= CONFIG.heading_check_min_distance_m) {
        const mb = calcBearing(lastPosition.lat, lastPosition.lng, lat, lng);
        if (angleDiff(heading, mb) > CONFIG.heading_diff_threshold_deg) {
          dlog('[GPS] 方向不整合スキップ');
          return null;
        }
      }
    }
    checkTrafficJamFallback(speedKmh, now);
    const filtered = kalman.update(lat, lng, accuracy, now);
    isStationary = checkStationaryFallback(speedKmh, filtered.lat, filtered.lng, now);
    lastPosition = { lat: filtered.lat, lng: filtered.lng, timestamp: now, speedKmh, altitude };
    return {
      lat: filtered.lat,
      lng: filtered.lng,
      altitude,
      accuracy,
      speedKmh,
      isStationary,
      timestamp: now,
    };
  }

  function getDynamicAccuracyLimit(speedKmh, now) {
    let limit = speedKmh < 30 ? 10 : speedKmh < 60 ? 15 : speedKmh < 100 ? 25 : 35;
    const hour = new Date(now).getHours();
    if (hour >= 22 || hour < 5) limit *= 1.2;
    return limit;
  }
  function checkTrafficJamFallback(speedKmh, now) {
    if (speedKmh > 0 && speedKmh < CONFIG.jam_speed_max_kmh) {
      if (!trafficJamSince) trafficJamSince = now;
      if ((now - trafficJamSince) / 1000 >= CONFIG.jam_duration_sec) isTrafficJam = true;
    } else if (speedKmh >= CONFIG.jam_speed_max_kmh) {
      trafficJamSince = null;
      isTrafficJam = false;
    }
  }
  function calcBearing(lat1, lng1, lat2, lng2) {
    const φ1 = (lat1 * Math.PI) / 180,
      φ2 = (lat2 * Math.PI) / 180,
      Δλ = ((lng2 - lng1) * Math.PI) / 180;
    return (
      ((Math.atan2(
        Math.sin(Δλ) * Math.cos(φ2),
        Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
      ) *
        180) /
        Math.PI +
        360) %
      360
    );
  }
  function angleDiff(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }
  function checkStationaryFallback(speedKmh, lat, lng, now) {
    if (isStationary && speedKmh >= CONFIG.resume_speed_kmh) {
      lowSpeedStart = null;
      return false;
    }
    if (speedKmh < CONFIG.speed_limit_kmh) {
      if (!lowSpeedStart) {
        lowSpeedStart = { time: now, lat, lng };
        return isStationary;
      }
      const e = (now - lowSpeedStart.time) / 1000;
      const m = calcDistance(lowSpeedStart.lat, lowSpeedStart.lng, lat, lng);
      const r = isTrafficJam ? CONFIG.stationary_radius_jam_m : CONFIG.stationary_radius_m;
      if (e >= CONFIG.stationary_sec && m < r) return true;
      return isStationary;
    }
    lowSpeedStart = null;
    return false;
  }

  // Vincenty（meter.jsから呼ばれる）
  function calcDistance(lat1, lng1, lat2, lng2) {
    if (lat1 === lat2 && lng1 === lng2) return 0;
    const a = 6378137,
      b = 6356752.314245,
      f = 1 / 298.257223563;
    const L = ((lng2 - lng1) * Math.PI) / 180;
    const U1 = Math.atan((1 - f) * Math.tan((lat1 * Math.PI) / 180));
    const U2 = Math.atan((1 - f) * Math.tan((lat2 * Math.PI) / 180));
    const sinU1 = Math.sin(U1),
      cosU1 = Math.cos(U1),
      sinU2 = Math.sin(U2),
      cosU2 = Math.cos(U2);
    let lambda = L,
      lambdaP,
      iterLimit = 100;
    let sinSigma, cosSigma, sigma, sinAlpha, cosSqAlpha, cos2SigmaM;
    do {
      const sl = Math.sin(lambda),
        cl = Math.cos(lambda);
      sinSigma = Math.sqrt((cosU2 * sl) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cl) ** 2);
      if (sinSigma === 0) return 0;
      cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cl;
      sigma = Math.atan2(sinSigma, cosSigma);
      sinAlpha = (cosU1 * cosU2 * sl) / sinSigma;
      cosSqAlpha = 1 - sinAlpha * sinAlpha;
      cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha;
      const C = (f / 16) * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
      lambdaP = lambda;
      lambda =
        L +
        (1 - C) *
          f *
          sinAlpha *
          (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
    } while (Math.abs(lambda - lambdaP) > 1e-12 && --iterLimit > 0);
    if (iterLimit === 0) return haversineDistance(lat1, lng1, lat2, lng2);
    const uSq = (cosSqAlpha * (a * a - b * b)) / (b * b);
    const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
    const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
    const ds =
      B *
      sinSigma *
      (cos2SigmaM +
        (B / 4) *
          (cosSigma * (-1 + 2 * cos2SigmaM ** 2) -
            (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)));
    return b * A * (sigma - ds);
  }
  function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000,
      dLat = ((lat2 - lat1) * Math.PI) / 180,
      dLng = ((lng2 - lng1) * Math.PI) / 180;
    const aa =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  }
  function calcDistance3D(lat1, lng1, alt1, lat2, lng2, alt2) {
    const flat = calcDistance(lat1, lng1, lat2, lng2);
    if (alt1 == null || alt2 == null) return flat;
    const altDiff = alt2 - alt1;
    if (Math.abs(altDiff) > 100) return flat;
    return Math.sqrt(flat * flat + altDiff * altDiff);
  }

  // BUG-6（2026/05/01）：onError を拡張
  // 旧：console.error するだけで放置 → 「許可押したのに動かない」現象の原因
  // 新：状態管理・リトライ・リスナー通知の3点セット
  function onError(err) {
    console.error('[GPS]', err.code, err.message);
    if (typeof dlog === 'function') dlog('[GPS] error code=' + err.code + ' msg=' + err.message);

    if (err.code === 1) {
      // PERMISSION_DENIED：拒否（許可ダイアログでキャンセル or システム拒否）
      _setStatus('denied', err);
      // リトライ（最大3回・10秒間隔）
      // 司さんが iOS 設定で「許可」に変更した場合、自動で復活する
      if (_status.retryCount < _MAX_RETRY && watchId !== null) {
        _status.retryCount++;
        if (_retryTimer) clearTimeout(_retryTimer);
        _retryTimer = setTimeout(retryWatch, _RETRY_INTERVAL_MS);
      }
    } else if (err.code === 2) {
      // POSITION_UNAVAILABLE：位置情報サービス不利用 or 信号取得不能
      _setStatus('unavailable', err);
      // 信号取得不能は時間で復活する可能性あり → 同じくリトライ
      if (_status.retryCount < _MAX_RETRY && watchId !== null) {
        _status.retryCount++;
        if (_retryTimer) clearTimeout(_retryTimer);
        _retryTimer = setTimeout(retryWatch, _RETRY_INTERVAL_MS);
      }
    } else if (err.code === 3) {
      // TIMEOUT：タイムアウト（次の position を待てば良い）
      // watchPosition は内部で継続するのでリトライ不要
      // 状態は「timeout」として記録するが granted の方が新しければ反映しない
      if (_status.state !== 'granted') _setStatus('timeout', err);
    }
  }

  // ─── デバッグ関数（B段階・2026/04/30追加） ───
  // Eruda コンソールから GPS._debug() で呼び出して、
  // 各センサーの現在値・バッファ蓄積数・リスナー登録状態を確認できる
  function _debug() {
    return {
      compassHeading: compassHeading,
      accelData: accelData,
      gyroData: gyroData,
      accelBufferLen: accelBuffer.length,
      gyroBufferLen: gyroBuffer.length,
      compassListenerAdded: _compassListenerAdded,
      motionListenerAdded: _motionListenerAdded,
      isBizActive: _isBizActive,
      watchId: watchId,
      useWorker: useWorker,
    };
  }

  // T5 (2026-05-09): map-matcher.js が commit した snap の typeCode を Worker に伝達
  //   meter.js の mmResult ハンドラから呼ばれる
  //   Worker 側で typeCode → Q の動的マッピングを行う
  function setRoadType(typeCode) {
    if (useWorker && worker) {
      worker.postMessage({ type: 'setRoadType', data: { typeCode: typeCode } });
    }
  }

  return {
    start,
    stop,
    calcDistance,
    calcDistance3D,
    _debug,
    // BUG-6（2026/05/01）：GPS 状態管理 API
    onStatusChange,
    getStatus,
    retryWatch,
    // 2026/05/02：タスクキル復元時のセンサーリスナー再登録用
    //   業務開始 / 復元時に明示的に呼ぶ
    //   重複防止フラグ（_compassListenerAdded/_motionListenerAdded）で
    //   既に登録済みなら何もしない
    startCompass,
    startMotion,
    // T5 (2026-05-09): Adaptive Kalman Q (道路種別連動) 用 API
    setRoadType,
  };
})();

// ★設計変更宣言 (2026-05-15・Phase C・Node coverage 計測可能化):
//   既存 `const GPS = (() => {...})()` IIFE は無変更。末尾に Node 環境用 module.exports を追加。
//   browser context: module 未定義のため no-op (旧挙動と等価)。
//   Node test context: require('./gps.js') で GPS API オブジェクトを取得可能。
// eslint-disable-next-line no-undef -- Node test 用 module.exports shim (browser では module 未定義で no-op)
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') module.exports = GPS;
