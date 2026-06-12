// ============================================================
// js/debug-trace.js
// 較正用 GPS trace 収集ツール (= noise model 較正タスク用・2026-05-21)
//
// ★設計変更宣言 (= prod 同梱・feature flag OFF default):
//   feature flag (= URL ?trace=on で localStorage 有効化) で activate された端末でのみ
//   watchPosition 並行 subscribe で・GPS sample を memory 蓄積。
//   設定画面の「📡 GPS trace 送信」ボタンで・Firebase RTDB の debug_traces に
//   REST 直叩きで upload。
//
//   prod の・距離機構 (= distance_m / calcFare / commit) / 課金経路 / Worker B /
//   map-matcher は・**1 byte も触らない**。本 file は独立・通常時は何もしない (= 早期 return)。
//
//   activation:
//     ★設計変更宣言 (2026-05-23・テストビルド常時 ON 化・noise calibration 30 日収集 加速):
//       テストビルド (= !DEBUG.isProduction) では・既定 ON (= 司さん手動操作 不要)。
//       本番 (= daikou-app.vercel.app 等) では・既存挙動維持 (= 既定 OFF)。
//       ?trace=off で・テストビルドでも・明示 OFF 可能 (= localStorage に '0' 永続)。
//       ?trace=on は・既存互換 (= 本番でも・明示 ON 可能・localStorage '1' 永続)。
//       prod の・privacy/cost/同意 への影響なし (= 本番 既定 OFF 不変)。
//
//   security:
//     Firebase RTDB の `debug_traces` スコープのみに書込・writeKey 必須・samples 5000 上限
//     Firebase rules (= 司さん が Console で 1 回設定) で・他 path 書込は完全に塞ぐ前提
//
//   multi-device 識別:
//     device_id: crypto.randomUUID() で初回自動生成・localStorage 永続 (= 操作ゼロ)
//     device_label: 設定画面でユーザ命名・任意 (= 「親機」「スタッフ A」等)
//     userAgent: 機種情報自動取得
//
//   絶対前提:
//     ・距離機構 / 課金経路 / Worker B / map-matcher / gps.js / gps-worker.js: 一切触らない
//     ・既存 navigator.geolocation 経路への干渉なし (= 独立 watchPosition で並行 subscribe)
//     ・flag OFF (= default) では・本 file は load されても何もせず終了
//     ・他 user / 通常 install では・サイレント (= UI 一切表示しない)
// ============================================================
/* eslint-disable no-console -- 本 file は debug 用・console.error は最終手段の log のみ */

(function () {
  'use strict';

  // ─── 定数 ────────────────────────────────────────────────
  const FLAG_KEY = 'DAIKOME_TRACE_ENABLED';
  const DEVICE_ID_KEY = 'DAIKOME_DEVICE_ID';
  const DEVICE_LABEL_KEY = 'DAIKOME_DEVICE_LABEL';
  const WRITE_KEY = 'DAIKOME_DEBUG_2026'; // Firebase rules validation で要求される共有 key
  const DB_URL = 'https://daikou-app-c821a-default-rtdb.asia-southeast1.firebasedatabase.app';
  const DB_PATH = '/debug_traces.json';
  const MAX_SAMPLES = 5000; // Firebase rules の validate と一致 (= 1 record の上限)
  // ★設計変更宣言 (2026-06-04・auto-flush 分割アップロード):
  //   旧: buffer をメモリに溜め MAX_SAMPLES(5000) で破棄・手動送信1回のみ → 長時間で 5000 cap 到達で
  //       後半が切れる(And/SE 6回目消失) / アプリ離脱・リロードで未送信 buffer 消失(iP13 1-4回目消失)。
  //   新: AUTO_FLUSH_SAMPLES 点ごとに ★1 chunk として自動アップロード+buffer swap★。
  //       = 各 record は AUTO_FLUSH 点 (≤5000 rule 内) / 長時間でも chunk 連番で全区間記録 /
  //         リロードしても直前 chunk までは上がってる(損失は未flush の末尾 ≤AUTO_FLUSH 点のみ)。
  //   解析側は device_id + biz.td(累積) + 時刻順で chunk を連結 → 業務別解析が chunk 跨ぎで成立。
  const AUTO_FLUSH_SAMPLES = 4500; // Firebase rule の 5000 上限直下。これ毎に自動 chunk upload (= 取りこぼし0で最大限ためる)。
  // ★時間ベース auto-flush (2026-06-10・196 真距離走行の取りこぼし根治)★:
  //   旧は点数(4500)到達のみで flush → 通常走行(<4500点)は走行中ノー flush で末尾送信/beacon 頼み。
  //   タスクキル/バックグラウンド回収/送信忘れで ★全区間消失★(今日の And 464/SE 336 がこれ)。
  //   → 一定時間ごとにも chunk upload し、最大損失を TIME_FLUSH_MS 内に抑える(全区間確実記録)。
  //   診断専用・距離/課金は 1 byte も非関与。chunk は device_id+chunk_seq+時刻順で解析側が連結。
  const TIME_FLUSH_MS = 90000; // 90 秒ごとに未送信 buffer を chunk upload (最大損失 ≤90 秒)
  const WATCH_OPTIONS = { enableHighAccuracy: true, timeout: 3000, maximumAge: 0 };

  // ─── Feature flag handling (= ?trace=on/off で切替) ────────
  // ★設計変更宣言 (2026-05-23・テストビルド既定 ON):
  //   旧: ?trace=on → '1' set / ?trace=off → removeItem(null) → 既定 OFF
  //   新: ?trace=on → '1' set / ?trace=off → '0' set (= 明示 OFF 印・null と区別)
  //   テストビルド (= !DEBUG.isProduction) で・stored が・null (= 未設定) なら ON 扱い。
  try {
    const params = new URLSearchParams(location.search);
    const t = params.get('trace');
    if (t === 'on') {
      localStorage.setItem(FLAG_KEY, '1');
    } else if (t === 'off') {
      // 明示 OFF 印 (= '0')・null との区別で・テストビルド既定 ON を上書きできる
      localStorage.setItem(FLAG_KEY, '0');
    }
  } catch (_) {
    // URL parse 失敗・localStorage 不可 → 静かに無視
  }

  // ─── enabled 判定 ───
  //   優先度:
  //     1. localStorage = '1' (= 明示 ON) → ON
  //     2. localStorage = '0' (= 明示 OFF) → OFF
  //     3. localStorage = null (= 未設定):
  //        - テストビルド (= DEBUG.isProduction !== true) → ON (= 既定 ON・noise calibration 自動収集)
  //        - 本番 (= DEBUG.isProduction === true) → OFF (= privacy/cost/同意・既定 OFF 不変)
  //   DEBUG global は・debug-config.js (= 先行 load) の top-level const・classic script で共有 scope。
  //   DEBUG 参照不可 (= debug-config 未 load 等) → 安全側で OFF (= 本番扱い)。
  let _enabled = false;
  try {
    const stored = localStorage.getItem(FLAG_KEY);
    if (stored === '1') {
      _enabled = true;
    } else if (stored === '0') {
      _enabled = false;
    } else {
      // 未設定: テストビルド既定 ON / 本番既定 OFF
      const _isProd = typeof DEBUG !== 'undefined' && DEBUG && DEBUG.isProduction === true;
      _enabled = !_isProd;
    }
  } catch (_) {
    _enabled = false; // localStorage 不可 → 安全側 OFF
  }
  if (!_enabled) return;

  // ─── device_id 初回自動生成 (= 永続化・操作ゼロ) ──────────
  let deviceId;
  try {
    deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : 'fallback-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
  } catch (_) {
    deviceId = 'no-storage';
  }

  // ─── samples buffer (= memory only・PWA close で消える設計) ─
  let samples = [];
  let watchId = null;
  let startedAt = null;
  let _chunkSeq = 0; // ★auto-flush: chunk 連番 (解析側の連結順序用)
  let _lastAutoFlushAt = null; // ★時間ベース auto-flush: 直近 flush の GPS 時刻 (2026-06-10)

  // ─── ★センサー記録 (2026-06-03 後半④・設計変更宣言): gps-worker.js のオフライン再現用 ─
  //   既存 fixture は GPS のみ (lat/lng/acc/spd/hdg/alt) で・加速度/ジャイロ/コンパスが欠落 →
  //   gps-worker (Doppler fix / 加速度静止判定 / 慣性補間) を replay 不能だった (= 実機 screen 値を
  //   PC で再現できず収束作業が非接続層に留まった)。ここで DeviceMotion/Orientation を独立 subscribe し
  //   (training-collector.js と同流儀・gps.js の既存 permission に相乗り・独自 prompt 無し)、各 GPS
  //   sample に「その区間の accel[] + 直近 gyro/compass」を添える。
  //   ★診断専用・距離機構 / 課金 / running gate / Worker B / gps.js / gps-worker.js は 1 byte も触らない★。
  const SENSOR_DOWNSAMPLE_MS = 50; // 20Hz 上限 (= training-collector と同値・payload 肥大防止)
  const ACCEL_PER_SAMPLE_MAX = 40; // 1 GPS sample あたり accel 上限
  let _accelSinceGps = []; // 直前 GPS 以降の accel [{x,y,z,t}] (gps-worker の accelSamples 相当)
  let _lastGyro = null; // 直近 {a,b,g} (rotationRate alpha/beta/gamma)
  let _lastCompass = -1; // 直近 compass 度 (-1=未取得 sentinel)
  let _lastMotionT = 0;
  let _sensorListenersAdded = false;

  function _onMotion(e) {
    const acc = e.accelerationIncludingGravity;
    const rot = e.rotationRate;
    const t = Date.now();
    if (t - _lastMotionT < SENSOR_DOWNSAMPLE_MS) return;
    _lastMotionT = t;
    if (acc) {
      _accelSinceGps.push({ x: acc.x || 0, y: acc.y || 0, z: acc.z || 0, t: t });
      if (_accelSinceGps.length > ACCEL_PER_SAMPLE_MAX) _accelSinceGps.shift();
    }
    if (rot && (rot.alpha != null || rot.beta != null || rot.gamma != null)) {
      _lastGyro = { a: rot.alpha || 0, b: rot.beta || 0, g: rot.gamma || 0 };
    }
  }

  function _onOrientation(e) {
    // iOS: webkitCompassHeading (真北) / Android: alpha (磁北)。gps.js と同じ優先順。
    const h = e.webkitCompassHeading != null ? e.webkitCompassHeading : e.alpha;
    if (typeof h === 'number') _lastCompass = h;
  }

  function _addSensorListeners() {
    if (_sensorListenersAdded) return;
    if (typeof window === 'undefined') return;
    try {
      if (window.DeviceMotionEvent) window.addEventListener('devicemotion', _onMotion, true);
      if (window.DeviceOrientationEvent)
        window.addEventListener('deviceorientation', _onOrientation, true);
      _sensorListenersAdded = true;
    } catch (_) {
      /* sensor 不可 → 従来通り GPS のみ記録 (graceful degrade) */
    }
  }

  // ★後半④ rev3: 業務状態スナップショット (1 trace を業務別に自動分割するため) ─
  //   「1業務=1 trace」の手動送信は面倒 (司さん) → 普通に走って最後に1回送信するだけで、業務
  //   (代行開始→精算終了) の切れ目が GPS と同じ時間軸で trace に埋め込まれるようにする
  //   (= console_log との別クロック対応づけ問題を解消)。
  //   ★passive 厳守: prod の Meter/Business/gps を一切参照しない。business.js が localStorage
  //     'daikou_business_state' に保存する state を ★読むだけ★ で疎結合を保つ (= index.html と同経路)。★
  function _bizSnapshot() {
    try {
      const raw = localStorage.getItem('daikou_business_state');
      if (!raw) return null;
      const s = JSON.parse(raw);
      return {
        tc: s.trip_count, // 業務(代行)完了回数 = 業務番号の手掛り (onTripEnd で +1)
        it: s.current_trip ? 1 : 0, // 代行中フラグ (current_trip!=null = 代行開始〜精算終了の窓)
        act: s.active ? 1 : 0, // 業務 active
        end: s.ended ? 1 : 0, // 終了(精算前 limbo)
        td: Math.round(s.total_distance_m || 0), // 業務開始からの総走行距離(m)
      };
    } catch (_) {
      return null; // localStorage 不可 / 未保存 → 業務情報なしで GPS のみ記録
    }
  }

  // ★OBD 車速スナップショット (2026-06-05・obd ブランチ)★:
  //   window.OBDClient (obd-client.js) が接続済なら直近の車速 km/h を返す。未接続/鮮度切れ/未 load は -1。
  //   passive 厳守: OBDClient を ★読むだけ★・Meter/Business/距離コアには無参照。
  //   解析側で ∫v(OBD) を計算し GPS 距離・タイヤ値と比較する用 (OBD 精度の実機検証)。
  function _obdSpeedSnapshot() {
    try {
      if (typeof window === 'undefined' || !window.OBDClient || !window.OBDClient.getSpeed) {
        return -1;
      }
      const s = window.OBDClient.getSpeed();
      return s && s.valid && s.kmh >= 0 ? s.kmh : -1;
    } catch (_) {
      return -1;
    }
  }
  // ★OBDオドメーター(01A6・km)スナップショット (2026-06-09)★: 走行中の値を trace に記録 →
  //   業務開始/終了の差＝この車のタイヤ回転距離(メーター級)を トリップ値/GPS と照合(OBD距離源の実機検証)。
  //   passive: OBDClient を読むだけ。未対応/未取得は -1。
  function _obdOdoSnapshot() {
    try {
      if (typeof window === 'undefined' || !window.OBDClient || !window.OBDClient.getOdometer) {
        return -1;
      }
      const o = window.OBDClient.getOdometer();
      return o && o.km >= 0 ? o.km : -1;
    } catch (_) {
      return -1;
    }
  }

  // ★エンジンRPM スナップショット (2026-06-11・RPMギア比学習データ収集)★: passive=OBDClient.getRpm()読むだけ。
  //   RPM(010C・高解像度)+ギア比でOBD車速1km/h floor過小をde-quantする将来法の ★実データ★ を次走行traceに残す。
  //   -1=未取得/非対応。距離計算には未配線(記録専用)。
  function _obdRpmSnapshot() {
    try {
      if (typeof window === 'undefined' || !window.OBDClient || !window.OBDClient.getRpm) {
        return -1;
      }
      const r = window.OBDClient.getRpm();
      return r && r.rpm >= 0 ? r.rpm : -1;
    } catch (_) {
      return -1;
    }
  }

  // ★speedSrc スナップショット (2026-06-10・OBD-main 発火診断)★:
  //   現状 trace は obd 速度しか記録せず「prod の距離計算がどの速度源(obd/dop/hav/coast)で
  //   駆動したか」を後から判定不能だった (= 実走で OBD valid 100% でも distance が GPS になった
  //   真因を静的に追えなかった)。ここで ★gps.js L629 と同じ条件★ を passive に評価し、
  //   実際に prod が OBD-main を発火させる状態だったかを trace に焼く。
  //   passive 厳守: window.OBD_DRIVE_DISTANCE と window.OBDClient を ★読むだけ★。
  //     距離コア / Meter / 課金 / running gate は 1 byte も非参照・無代入。
  //   返り値 (gps.js の _speedSrc 決定ロジックと同義):
  //     'obd'   = OBD_DRIVE_DISTANCE 有効 かつ OBD 車速が鮮度OK(valid) → prod は speedSrc='obd'
  //     'dop'   = 上記不成立 かつ coords.speed が有効(>=0) → prod は Doppler 速度
  //     'hav'   = coords.speed 無効(null/-1) → prod は haversine 代用
  //   ※ 'coast'(穴埋め減衰ホールド) は実点が来ない瞬間の prod 内部状態で、本 passive watch は
  //     実点ごとにしか発火しないため observable でない → ここでは判定対象外(実点の速度源のみ記録)。
  function _speedSrcSnapshot(coords) {
    try {
      const obdOn =
        typeof window !== 'undefined' && window.OBD_DRIVE_DISTANCE === true && !!window.OBDClient;
      if (obdOn && window.OBDClient.getSpeed) {
        const s = window.OBDClient.getSpeed();
        if (s && s.valid && s.kmh >= 0) return 'obd';
      }
      const spd = coords && coords.speed;
      return spd != null && spd >= 0 ? 'dop' : 'hav';
    } catch (_) {
      return null; // 評価不能 → null (記録漏れと区別)
    }
  }

  // ★OBD-main ゲート状態スナップショット (2026-06-10)★: window.OBD_DRIVE_DISTANCE の生値。
  //   speedSrc が 'obd' にならなかった時、ゲート自体が落ちていたのか(=起動バグ) /
  //   ゲートは立ったが OBD 速度が valid でなかったのかを切り分ける診断軸。
  //   passive: フラグを読むだけ。1=有効 / 0=無効 / -1=未設定(未 load) sentinel。
  function _obdGateSnapshot() {
    try {
      if (typeof window === 'undefined' || typeof window.OBD_DRIVE_DISTANCE === 'undefined') {
        return -1;
      }
      return window.OBD_DRIVE_DISTANCE === true ? 1 : 0;
    } catch (_) {
      return -1;
    }
  }

  // ★distanceSource スナップショット (2026-06-10)★: prod が直近で distance_m を更新したソース。
  //   Meter.getMMStats().distance_source = 'pipeline'(MM本線) / 'gap'(穴埋め) / 'loadfill'(道路ロード中) /
  //   'inline'。OBD-main 発火時も距離は pipeline(∫v は map-matcher 経由)ゆえ、speedSrc('obd') と
  //   distanceSource を併記して「OBD 速度で pipeline が動いたか / gap に落ちたか」を解析側で判定する。
  //   passive 厳守: Meter.getMMStats() を ★呼んで読むだけ★ (副作用なし getter)・Meter へ無代入。
  //   未 load / 非 browser / getter 不在は null (記録漏れと区別)。
  function _distSrcSnapshot() {
    try {
      if (typeof Meter === 'undefined' || !Meter || typeof Meter.getMMStats !== 'function') {
        return null;
      }
      const st = Meter.getMMStats();
      return st && typeof st.distance_source === 'string' ? st.distance_source : null;
    } catch (_) {
      return null;
    }
  }

  function onPosition(p) {
    if (samples.length >= MAX_SAMPLES) return; // 上限到達後は破棄
    const c = p.coords;
    if (startedAt == null) startedAt = p.timestamp;
    // ★計器 (2026-05-29): Firebase RTDB は null を field ごと削除するため、
    //   coords.speed/heading が null の瞬間 (iOS で頻発) は spd/hdg が trace から消え、
    //   「速度 null」 と 「記録漏れ」 が区別不能になる。null→-1 sentinel で永続化し、
    //   Doppler ゲート (gps-worker.js) のオフライン再現を可能にする。診断専用・課金非関与。
    samples.push({
      t: p.timestamp,
      lat: c.latitude,
      lng: c.longitude,
      acc: c.accuracy,
      spd: c.speed == null ? -1 : c.speed,
      hdg: c.heading == null ? -1 : c.heading,
      alt: c.altitude == null ? -9999 : c.altitude,
      // ★後半④: gps-worker 再現用センサー (既存 GPS field は不変・追加のみ)
      accel: _accelSinceGps.slice(), // この GPS 区間の加速度 [{x,y,z,t}] (= gps.js が worker へ送る batch 相当)
      gyro: _lastGyro, // 直近ジャイロ {a,b,g} or null
      compass: _lastCompass, // 直近コンパス度 (-1=未取得)
      biz: _bizSnapshot(), // ★後半④rev3: 業務状態{bd:業務距離,dm:総距離,run:代行中,tc:業務回数,act:業務active}=業務別自動分割用
      obd: _obdSpeedSnapshot(), // ★OBD車速(km/h・-1=未接続/鮮度切れ)。passive: OBDClient を読むだけ・∫v(OBD)オフライン検証用
      obd_odo: _obdOdoSnapshot(), // ★OBDオドメーター(01A6・km・-1=未対応/未取得)。業務開始/終了の差=タイヤ回転距離(メーター級)照合用
      rpm: _obdRpmSnapshot(), // ★エンジンRPM(010C・-1=未取得)。RPM+ギア比でfloor過小de-quantする法の実データ収集(記録専用・距離未配線)
      // ★OBD-main 発火診断 (2026-06-10・追加のみ・既存 field 不変・passive)★:
      spdsrc: _speedSrcSnapshot(c), // 速度源 'obd'/'dop'/'hav' (gps.js L629 と同条件で評価・null=評価不能)。OBD-main が実際に発火したか
      obd_gate: _obdGateSnapshot(), // window.OBD_DRIVE_DISTANCE 生値 1/0/-1。ゲート落ち(起動バグ) vs OBD速度未valid の切り分け
      dsrc: _distSrcSnapshot(), // distanceSource 'pipeline'/'gap'/'loadfill'/'inline' (Meter.getMMStats読むだけ・null=未load)。距離が GPS/穴埋めに落ちたか
    });
    _accelSinceGps = []; // 次 GPS 区間用に clear (= gps.js の worker 送信毎 batch と同じ区切り)
    const countEl = document.getElementById('traceSampleCount');
    if (countEl) countEl.textContent = String(samples.length);
    // ★auto-flush: 一定点数 ★または★ 一定時間で自動 chunk upload (5000cap回避・損失最小化)。fire-and-forget。
    //   時間ベース(2026-06-10)を追加: <4500点の通常走行でも90秒ごとに上げ、タスクキル/送信忘れの全損を断つ。
    if (_lastAutoFlushAt == null) _lastAutoFlushAt = p.timestamp;
    const _dueByCount = samples.length >= AUTO_FLUSH_SAMPLES;
    const _dueByTime = samples.length > 0 && p.timestamp - _lastAutoFlushAt >= TIME_FLUSH_MS;
    if (_dueByCount || _dueByTime) {
      _lastAutoFlushAt = p.timestamp;
      _flushTrace(true);
    }
  }

  function onError() {
    // GPS error は静かに無視・既存 prod の onError 経路を侵さない
  }

  function startWatch() {
    if (watchId !== null) return;
    if (!('geolocation' in navigator)) return;
    try {
      watchId = navigator.geolocation.watchPosition(onPosition, onError, WATCH_OPTIONS);
    } catch (_) {
      watchId = null;
    }
  }

  // 起動時に・自動 watchPosition 開始 (= 既存 gps.js の watchPosition とは独立・並行 subscribe)
  startWatch();
  _addSensorListeners(); // ★後半④: 加速度/ジャイロ/コンパスも並行 subscribe (gps.js permission に相乗り)

  // ─── upload 内部実装 (= 1 chunk batch を POST・auto-flush と手動送信の共通経路) ─
  //   ★設計変更宣言 (2026-06-04・auto-flush): 旧 window.uploadGpsTrace のインライン POST を
  //     _postBatch(batch) + _flushTrace(isAuto) に分解。診断専用・距離/課金は 1 byte も非関与。
  function _postBatch(batch, batchStartedAt, isAuto) {
    return new Promise(function (resolve) {
      if (!batch || batch.length === 0) {
        resolve({ ok: false, error: 'sample 0 件 (= 業務開始前 or 既送信)' });
        return;
      }
      let label = '';
      try {
        label = localStorage.getItem(DEVICE_LABEL_KEY) || '';
      } catch (_) {
        /* ignore */
      }
      const endedAt = batch[batch.length - 1].t;
      const seq = _chunkSeq++; // この chunk の連番 (解析側の連結順序用・swap 前に確定)
      const body = {
        meta: {
          device_id: deviceId,
          device_label: label,
          // ★車両プロファイル(VIN/メーカー/車種/型式/タイヤ)を焼く=型式別解析用 (2026-06-09)。
          //   UI(設定)が window.DK_VEHICLE_PROFILE を保存/読込時に設定。未設定なら null。
          vehicle: (typeof window !== 'undefined' && window.DK_VEHICLE_PROFILE) || null,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
          started_at: batchStartedAt,
          ended_at: endedAt,
          sample_count: batch.length,
          watch_options: 'enableHighAccuracy:true,timeout:3000,maximumAge:0',
          sensor_capture: _sensorListenersAdded, // ★後半④: accel/gyro/compass 記録の有無
          sensor_downsample_ms: SENSOR_DOWNSAMPLE_MS,
          // ★auto-flush: chunk 連番 + 自動/手動 区別 (= 解析側が device_id でまとめ chunk_seq 順に連結)
          chunk_seq: seq,
          auto_flush: !!isAuto,
        },
        samples: batch,
        writeKey: WRITE_KEY,
      };
      fetch(DB_URL + DB_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          const traceId = data && data.name ? data.name : 'unknown';
          resolve({ ok: true, traceId: traceId, chunk_seq: seq, sample_count: batch.length });
        })
        .catch(function (err) {
          resolve({
            ok: false,
            error: err.message || 'upload failed',
            _batch: batch,
            _startedAt: batchStartedAt,
          });
        });
    });
  }

  // ─── flush (= 現 buffer を 1 chunk として切り出し POST・即 swap で取りこぼし防止) ─
  //   isAuto=true: AUTO_FLUSH_SAMPLES 到達の自動分割 (fire-and-forget)。
  //   isAuto=false: 手動「📡 GPS trace 送信」ボタン (= 残り全部を flush)。
  function _flushTrace(isAuto) {
    // ★swap を最優先: POST の await 前に buffer を新配列へ差し替え、POST 中に来る点を別 buffer に蓄積。
    //   = async POST 中の onPosition push が「送信済み扱いで消える」事故を防ぐ。
    if (samples.length === 0) {
      return Promise.resolve({ ok: false, error: 'sample 0 件 (= 業務開始前 or 既送信)' });
    }
    const batch = samples;
    const batchStartedAt = startedAt;
    samples = [];
    startedAt = null;
    const countEl = document.getElementById('traceSampleCount');
    if (countEl) countEl.textContent = '0';
    return _postBatch(batch, batchStartedAt, isAuto).then(function (r) {
      if (!r.ok && r._batch) {
        // ★失敗時は再キュー: 切り出した batch を現 buffer の先頭に戻す (時刻順保持)。
        //   POST 中に新点が来ていれば batch + 新点 で連続。次 flush / 手動送信で再送。
        samples = r._batch.concat(samples);
        if (startedAt == null) startedAt = r._startedAt;
        if (countEl) countEl.textContent = String(samples.length);
      }
      return r;
    });
  }

  // ─── upload function (= 「📡 GPS trace 送信」ボタンから呼出・window 公開) ─
  window.uploadGpsTrace = function () {
    return _flushTrace(false);
  };

  // ─── unload flush (= アプリ離脱/リロード/タスクキル直前に末尾 buffer を救出) ─
  //   ★設計変更宣言 (2026-06-04): fetch は pagehide で kill されるため navigator.sendBeacon で送る
  //     (= bfcache 退避前に keepalive 送信を保証)。iP13 1-4回目消失 (リロードで未送信 buffer 消失) の根治。
  //     診断専用・距離/課金は非関与。sendBeacon 不可環境は静かに諦め (= 従来挙動)。
  function _beaconFlush() {
    if (samples.length === 0) return;
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return;
    let label = '';
    try {
      label = localStorage.getItem(DEVICE_LABEL_KEY) || '';
    } catch (_) {
      /* ignore */
    }
    const batch = samples;
    const batchStartedAt = startedAt;
    const seq = _chunkSeq++;
    const body = {
      meta: {
        device_id: deviceId,
        device_label: label,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        started_at: batchStartedAt,
        ended_at: batch[batch.length - 1].t,
        sample_count: batch.length,
        watch_options: 'enableHighAccuracy:true,timeout:3000,maximumAge:0',
        sensor_capture: _sensorListenersAdded,
        sensor_downsample_ms: SENSOR_DOWNSAMPLE_MS,
        chunk_seq: seq,
        auto_flush: true,
        beacon: true,
        // ★随伴車別 k 含む車両profile (アプリ離脱trace でも過大ゼロ事後監査可能に・_postBatch と対等)
        vehicle: (typeof window !== 'undefined' && window.DK_VEHICLE_PROFILE) || null,
      },
      samples: batch,
      writeKey: WRITE_KEY,
    };
    try {
      const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
      const sent = navigator.sendBeacon(DB_URL + DB_PATH, blob);
      if (sent) {
        // 退避成功扱い → buffer 空け (戻ってきても二重送信しない)
        samples = [];
        startedAt = null;
      }
    } catch (_) {
      /* sendBeacon 失敗 → buffer 保持 (= 復帰後の手動送信で救出) */
    }
  }
  // pagehide (= bfcache/離脱の最終 hook) と visibilitychange(hidden) で beacon flush。
  try {
    window.addEventListener('pagehide', _beaconFlush);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') _beaconFlush();
    });
  } catch (_) {
    /* listener 登録不可 → 静かに無視 (= auto-flush/手動送信のみで運用) */
  }

  // ─── DOM 配線 (= #overlaySettings に挿入された UI element に bind) ─
  function bindUI() {
    const section = document.getElementById('debugTraceSection');
    if (!section) return false; // UI 未挿入 (= 旧 PWA cache 残存) → bind skip
    section.style.display = ''; // hidden → 表示

    const labelInput = document.getElementById('traceDeviceLabel');
    if (labelInput) {
      try {
        labelInput.value = localStorage.getItem(DEVICE_LABEL_KEY) || '';
      } catch (_) {
        /* ignore */
      }
      labelInput.addEventListener('change', function () {
        try {
          localStorage.setItem(DEVICE_LABEL_KEY, labelInput.value.trim());
        } catch (_) {
          /* ignore */
        }
      });
    }

    const deviceIdEl = document.getElementById('traceDeviceId');
    if (deviceIdEl) deviceIdEl.textContent = deviceId;

    const countEl = document.getElementById('traceSampleCount');
    if (countEl) countEl.textContent = String(samples.length);

    const btn = document.getElementById('btnUploadTrace');
    const statusEl = document.getElementById('traceStatus');
    if (btn && statusEl) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        statusEl.textContent = '送信中...';
        window.uploadGpsTrace().then(function (r) {
          btn.disabled = false;
          if (r.ok) {
            statusEl.textContent = '✓ 送信完了: ' + r.traceId;
          } else {
            statusEl.textContent = '✗ 送信失敗: ' + r.error;
          }
        });
      });
    }
    return true;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bindUI);
    } else {
      bindUI();
    }
  }
})();
