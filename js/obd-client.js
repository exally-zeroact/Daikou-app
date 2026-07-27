// ============================================================
// js/obd-client.js  (ダイコメ OBD-II 速度源・2026-06-05 新規・obd ブランチ)
//
// ★目的★: BLE(Bluetooth Low Energy)接続の ELM327 OBD-II アダプターから
//   車輪由来の車速 (OBD PID 010D) を読み取り、距離計算の「速度源」として供給する。
//   GPS Doppler より素直で正確 (タイヤ計に近い) なため、∫v が過大ゼロのまま高精度になりうる。
//
// ★前提・制約 (重要)★:
//   - Web Bluetooth は ★Android Chrome のみ★。iOS Safari / PWA は非対応 →
//     iPhone(13/SE)は現状の PWA では OBD に繋がらない (将来ネイティブ化が必要)。
//   - HTTPS + ユーザー操作(クリック)起点でしか requestDevice できない (settings のボタンから呼ぶ)。
//   - 対応アダプタ = BLE / Bluetooth 4.0+ の ELM327 (WiFi型・classic SPP型は不可)。
//
// ★絶対ルール準拠★:
//   - 距離コア(pipeline-distance.js)/ 課金(calcFare)/ Viterbi 本体には ★依存しない・触らない★。
//   - 本 module は「最新の車速(m/s)を保持して提供するだけ」の独立部品。
//     距離側がそれを使うかどうかは呼び出し側の責務 (= pluggable 速度源・既定 OFF)。
//   - flag/接続が無ければ何もしない (= 既存 GPS 経路は完全不変)。
//
// ★公開 API (window.OBDClient)★:
//   isSupported()  -> bool         Web Bluetooth 利用可否
//   connect()      -> Promise<bool> デバイス選択(要ユーザー操作)→接続→ELM327初期化→ポーリング開始
//   disconnect()                    切断
//   isConnected()  -> bool
//   getSpeed()     -> {kmh, mps, ts, ageMs, valid}  最新車速 (valid=鮮度OK)
//   speedProvider(sample) -> mps|-1  pipeline-distance の speedProvider 互換 (鮮度切れ/未接続は -1)
//   on(event, cb)                   'status' | 'speed' | 'error'
//   getStatus()    -> string        'idle'|'connecting'|'connected'|'error'|'disconnected'
//   _parseSpeedKmh(str) -> number|null  ★純関数(単体テスト対象)★ ELM327応答 → km/h
// ============================================================
/* eslint-disable no-console -- OBD は実機デバッグが要るため console を残す */

(function (global) {
  'use strict';

  // ─── 既知の ELM327 BLE プロファイル (service / notify / write の UUID 組) ──────
  //   アダプタによって UUID が違うため複数を順に試す。最頻出 2 種を既定で持つ。
  //   - fff0 系: Vgate iCar Pro BLE / Veepeak OBDCheck BLE 等で一般的
  //   - Nordic UART (NUS): 一部の ELM327 BLE クローン
  const PROFILES = [
    {
      name: 'fff0',
      service: '0000fff0-0000-1000-8000-00805f9b34fb',
      notify: '0000fff1-0000-1000-8000-00805f9b34fb',
      write: '0000fff2-0000-1000-8000-00805f9b34fb',
    },
    {
      name: 'nordic-uart',
      service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
      notify: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
      write: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
    },
  ];
  const ALL_SERVICES = PROFILES.map(function (p) {
    return p.service;
  });

  // ELM327 初期化コマンド列。★プロトコル(ATSP)は _warmup でpin/フォールバックするので init では設定しない★。
  //   ATZ(リセット)はチップ再起動(~1-2s)を伴うため _initElm で長timeout+settleを与える(下記)。
  const INIT_CMDS = ['ATE0', 'ATL0', 'ATS0', 'ATH0']; // echo/lf/space/headers off
  const SPEED_PID = '010D'; // Mode 01 PID 0D = Vehicle Speed (km/h・1 byte)
  const ODO_PID = '01A6'; // Mode 01 PID A6 = Odometer (0.1km・4 byte・新しめの車)
  const ODO_POLL_EVERY = 30; // この回数の速度ポーリングごとに1回 01A6 を混ぜる(odoは0.1km刻みで遅い)
  // ★ECU距離カウンタ (2026-06-23・診断記録): Mode01 PID 31 = Distance since codes cleared (1km・2 byte)。
  //   ECU自身が車速パルスを積算した距離=メーター機(随伴車)と同じ物=真距離の参照。01A6非対応の
  //   軽/古い車でも 0131 は読めることが多い。走行中ポーリングして trace 記録 → オフラインで
  //   K=ECU距離÷OBD∫v を導出する材料にする。★記録専用・距離計算には未配線(既存OBD経路不変)★。
  const DIST_PID = '0131'; // Mode 01 PID 31 = Distance traveled since codes cleared (km・1km刻み)
  const DIST_POLL_EVERY = 23; // 速度ポーリング23回に1回 0131 を混ぜる(ODO=30/RPM=10 と素な間隔で衝突を最小化)
  // ★RPM 記録 (2026-06-11)★: Mode01 PID 0C = Engine RPM(0.25rpm刻み=速度の1km/h floorより遥かに高解像度)。
  //   OBD車速は1km/h整数floorで∫vが系統過小(-2.9%)。RPM(高解像度)+ギア比学習で細かい速度を復元すれば
  //   floor過小を ★根から★ 消せる(US9679422 等の公知手法)。本コミットでは ★記録のみ★(距離計算には未配線)。
  //   次走行traceに rpm を残し、オフラインでギア比学習法を実データ検証可能にする。010C は1996年以降ほぼ全車対応の標準PID。
  const RPM_PID = '010C'; // Mode 01 PID 0C = Engine RPM ((256A+B)/4 rpm・2 byte)
  const RPM_POLL_EVERY = 10; // 速度ポーリング10回に1回 010C を混ぜる(速度主ポーリングをほぼ邪魔しない)
  // ★ABS各輪速モニタ (2026-06-15・測定前精度の本命レバー)★:
  //   標準010Dは1km/h整数floorで∫vが系統-2〜-2.5%過小。ABSコントローラはECM/メータ向けに
  //   各輪速を専用CANメッセージで常時同報しており、その分解能は010Dの30〜100倍細かい(opendbc実車値:
  //   Toyota 0.01km/h / Hyundai-Kia 0.031 / GM 0.033)。floor量子化を「発生源から」消せる=過大ゼロのまま
  //   -1.3% → -0.2〜-0.4% へ(会議2026-06-15で唯一「画期的」と名指し)。本コミットは ★read-only プローブのみ★:
  //   ATH1(ヘッダON)+ATMA(受動モニタ)で生CANフレームを時間制限つきで傍受→生記録→オフライン解析で
  //   「どのCAN IDに・どの分解能で輪速が流れるか」を車種別に特定する。★距離計算には未配線(=既存OBD経路不変)★。
  const WHEELSPEED_PROBE_MS = 4000; // 手動プローブ(debug API)の捕捉窓
  // ★自動discovery(2026-06-15・ユーザー操作ゼロ)★: 普段の業務走行の裏で、速度ポーリングの合間に
  //   短い輪速捕捉を自動で数回挟む。ドライバーは普通に運転するだけで色々な速度を通る→IDを後で特定できる。
  //   運転中にユーザーにタップさせる旧設計は撤回。捕捉は短く(gap最小化)・間隔を空け・十分集めたら自動終了。
  const WS_AUTO_DUR_MS = 1500; // 自動捕捉1回の長さ(走行中の010D欠落を最小化。gapはpipelineが保守fill)
  const WS_AUTO_MIN_GAP_MS = 45000; // 自動捕捉の最小間隔(45秒に1回まで)
  const WS_AUTO_MAX_CAPS = 8; // これだけ集めたら自動discovery終了
  const WS_AUTO_MIN_SPEED_BINS = 4; // 異なる速度帯(20km/h刻み)をこれだけ集めたら十分=終了
  const WS_AUTO_MIN_CAPTURE_KMH = 8; // ★S5: 停車/極低速では撃たない(信号待ち/客待ちで退化点が積もり回帰汚染+空振りするのを回避)★
  // ★★2026-06-16 実機回帰の根治: auto-discovery 既定OFF★★
  //   ATMA捕捉(~2s)が走行中にOBD 010Dを中断→停止/減速と重なると距離がGPS/coastへフォールバック→
  //   creep(停止中の距離増)+過大(市街地GPS過大)を作る実機回帰が発生(モコ実走 creep59m/過大~+18%)。
  //   距離コア(distance_m)は不変だが「OBD連続供給の中断」が距離を汚す=「read-only」は誤りだった。
  //   ∴ 課金中(業務走行)にATMA捕捉を走らせない。ABS discoveryは将来「非課金の専用較正モード」で行う。
  const WS_AUTO_DISCOVERY_DEFAULT = false; // ★既定OFF(距離整合性を最優先)。再有効化は専用モード設計後★
  const SPEED_STALE_MS = 2000; // これより古い OBD 速度は「鮮度切れ」= 距離に使わない
  const POLL_MIN_INTERVAL_MS = 100; // ポーリング下限間隔 (ELM327 のレイテンシ保護)
  const CMD_TIMEOUT_MS = 1500; // 1 コマンドの応答待ち上限
  const PROTOCOL_TIMEOUT_MS = 7000; // ★初回プロトコル検出(0100)の待ち上限★: ELM327 の自動検出は
  //   1回目クエリで数秒かかる。1.5秒では検出中断→以降 STOPPED で全滅(実機で確認)。長く待つ。
  const WARMUP_RETRIES = 3; // 各プロトコルでの 0100 リトライ回数(3プロトコル×3=最大9試行)
  const WARMUP_RETRY_WAIT_MS = 700; // ★再送前の待機★: 検出進行中に新コマンドを書いて中断するのを防ぐ
  const RECOVER_AFTER = 5; // 速度ポーリングがこの回数連続失敗したら _warmup で再確立(mid-drive STOPPED回復)

  // ─── 内部状態 ───────────────────────────────────────────────
  let _device = null;
  let _server = null;
  let _writeChar = null;
  let _notifyChar = null;
  let _status = 'idle';
  let _latest = { kmh: -1, mps: -1, ts: 0 };
  // ★OBDオドメーター(01A6・0.1km)★: 走行中も定期ポーリングして trace に記録 → 業務開始/終了の
  //   差＝この車のタイヤ回転距離(メーター級)をトリップ値と照合できる。_odoSupported はプローブで確定。
  let _latestOdo = { km: -1, ts: 0 };
  let _odoSupported = false;
  // ★ECU距離カウンタ(0131・1km)★: 走行中ポーリングして trace 記録 → メーター機=真距離の参照。
  //   _dist0131Supported はプローブで確定。記録専用・距離計算には未配線。
  let _latest0131 = { km: -1, ts: 0 };
  // ★生OBD∫v(faithful・ポーリングレート積分)★: Σ speed×dt。記録専用・距離未配線。
  let _obdIntegralM = 0;
  let _obdIntegralLastTs = 0;
  let _dist0131Supported = false;
  let _latestRpm = { rpm: -1, ts: 0 }; // ★最新エンジンRPM(010C・-1=未取得)。記録専用・距離計算には未配線★
  let _pollCount = 0;
  let _consecFail = 0; // 速度ポーリングの連続失敗数(mid-drive 回復トリガー)
  let _recovering = false; // _warmup 再確立中フラグ(多重起動防止)
  let _rxBuffer = '';
  let _capturing = false; // ★ABS輪速モニタ捕捉中(ATMA)★: true の間 notify は _captureBuf へ流す(_send応答経路と分離)
  let _captureBuf = ''; // ATMA 生フレーム蓄積バッファ
  // ★ABS輪速 自動discovery 状態(ユーザー操作ゼロ)★
  let _wsAuto = false; // 自動輪速discovery 有効(接続でON・十分集めたらOFF)
  // ★輪速診断モード(司さん手動ON・診断走行専用・2026-06-23)★: ONで接続時に _wsAuto をONにし ABS輪速CAN捕捉を
  //   走らせ生フレームを [OBD-WHEELSPEED] ログ→traceに残す。既定OFF(走行中ATMA捕捉は010Dを中断し距離を汚すため=
  //   課金走行では使わない)。localStorage 'dk_obd_ws_discovery'='1' で永続。
  let _wsDiscoveryForced = (function () {
    try {
      return (
        typeof localStorage !== 'undefined' && localStorage.getItem('dk_obd_ws_discovery') === '1'
      );
    } catch (_) {
      return false;
    }
  })();
  let _wsCaps = 0; // これまでの自動捕捉回数
  let _wsLastCapTs = 0; // 直近の自動捕捉時刻
  const _wsBins = {}; // 捕捉済み速度帯(20km/h刻み)→1
  let _wsCapturesData = []; // 端末内識別用の捕捉蓄積 [{obd010d, means}]
  let _wsMapping = null; // ★確定した輪速マッピング {id,key,slope,intercept,r2,...}★(距離未配線・診断/将来用)
  // ★CAN輪速メーター ★バースト積分方式★(2026-06-24・方式検証会議で確定)★:
  //   ★連続ATMAは禁止★(クローンZappaはBLE吐き出しが律速で約130秒で内部バッファ飽和→30秒凍結→−38%欠損)。
  //   代わりに「短ATMA(~0.7s撃つ)→停止して吐き切る→次」を実効周期~1.5sで反復し、各バーストの1B8中央値速度を
  //   その区間にHOLD積分(窓平均が既に区間積分=台形は二重平滑で不要)。バーストは毎回バッファを空にするので永遠に詰まらない。
  //   ★目標=DM Light(随伴車メーター)に合わせる(代行は過大ゼロ拘束でない)。停止中に距離を足さないのはDM Lightと揃えるため★。
  //   ★read-only・distance_m/課金/ポーリング骨格に一切非干渉。検証専用の並行距離。★
  //   モコMG33S実測=ID1B8 バイト0-1 BE が車輪速(r=0.997・約40カウント/km/h・1km/h丸め無し)。
  const CW_DEFAULT = { id: '1B8', off: 0, endian: 'BE', scale: 40 }; // モコ既定(他車は将来discovery)
  const CW_BURST_MS = 700; // 1バーストのATMA受信時間(短くして毎回吐き切る=飽和回避)
  const CW_DRAIN_MS = 200; // ATMA停止後のバッファ吐き切り待ち
  const CW_CYCLE_MS = 1500; // 実効サンプリング周期(バースト+ドレイン+ギャップ)
  const CW_MIN_FRAMES = 5; // バースト内の対象フレーム数がこれ未満=ストール扱いで非加算
  const CW_MAX_DT_S = 3.5; // 区間dtの上限(これ超=長断絶/停止gapは積分しない=幻距離防止。周期1.5sの遅延1回は許容)
  const CW_ZUPT_KMH = 1.5; // これ未満は停止扱いで0(DM Lightと同様・creep防止)
  const CW_BRIDGE_MAX_S = 30; // ストール(フレーム欠落)時、直近走行速度でgapを橋渡しする上限秒(トンネル等の欠損回収・代行は過大ゼロ非拘束)
  const CW_LOG_INTERVAL_MS = 10000; // [OBD-CANWHEEL]ログ間隔
  const _cwCfg = (function () {
    try {
      const s = typeof localStorage !== 'undefined' && localStorage.getItem('dk_can_wheel_map');
      const p = s ? JSON.parse(s) : null;
      if (p && p.id)
        return {
          id: p.id,
          off: p.off | 0,
          endian: p.endian || 'BE',
          scale: p.scale > 0 ? p.scale : 40,
        };
    } catch (_) {
      /* ignore */
    }
    return Object.assign({}, CW_DEFAULT);
  })();
  let _cwOn = false; // メーター稼働中(バーストループ実行中)
  let _cwStarting = false; // ★監査M-A: 起動プリアンブル中(同期フラグ・二重start防止)★
  let _cwBurstGen = 0; // ★監査M-B: バースト世代トークン(完了クリアの所有権ガード)★
  let _cwBurstInflight = false; // ★監査M-B: バースト捕捉が in-flight(probe排他を広げる)★
  let _cwDistM = 0; // 積分距離(m)
  let _cwFrames = 0; // 取り込んだ対象フレーム総数
  let _cwLastMidT = 0; // 直近"有効"バーストの中央時刻(ms・区間dtの基準)
  let _cwStartT = 0; // 開始時刻(ms)
  let _cwLastKmh = 0; // 直近窓速度(km/h・表示用)
  let _cwStallN = 0; // 連続ストール数(フレーム不足)
  let _cwBurstTimer = null; // バーストループの次回スケジュール
  let _cwLastLogT = 0; // 直近ログ時刻
  let _cwWasStop = false; // start前の _stopRequested を退避(stopで復元)
  let _pendingResolve = null; // 現コマンドの応答待ち resolver
  let _pendingTimer = null;
  let _polling = false;
  let _stopRequested = false;
  // ★自動再接続/起動時自動接続 (2026-06-18・司さん要望「1回繋いだら自動で繋がる」)★:
  //   ①切断(gattserverdisconnected)で同一デバイスへ自動リトライ(バックオフ)。
  //   ②起動時 navigator.bluetooth.getDevices() で前回許可済みデバイスへ選択ダイアログ無しで自動接続。
  //   Android Chrome のみ(iOSはWeb Bluetooth非対応)。接続管理のみ=距離計算には非干渉。
  let _autoReconnect = true;
  let _reconnecting = false;
  let _reconnectDelayMs = 2000; // テストで短縮可
  const OBD_RECONNECT_MAX = 5;
  const _last = (k, v) => {
    try {
      if (typeof localStorage === 'undefined') return null;
      if (v === undefined) return localStorage.getItem(k);
      localStorage.setItem(k, v);
      return v;
    } catch (_) {
      return null;
    }
  };
  const _listeners = { status: [], speed: [], error: [], probe: [], canwheel: [] };

  function _emit(event, payload) {
    const arr = _listeners[event];
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) {
      try {
        arr[i](payload);
      } catch (_) {
        /* listener 例外は無視 (本体を止めない) */
      }
    }
  }
  function _setStatus(s) {
    _status = s;
    _emit('status', s);
  }

  // ─── 純関数: ELM327 応答文字列 → 車速 km/h (単体テスト対象) ──────────────
  //   応答例: "41 0D 3C" / "410D3C" / "SEARCHING...\r41 0D 00" / 複数行・エコー混在。
  //   "41 0D" (Mode01応答 41 + PID 0D) の直後 1 byte を km/h として返す。見つからなければ null。
  function _parseSpeedKmh(str) {
    if (typeof str !== 'string' || str.length === 0) return null;
    // 空白・改行・プロンプトを除去して 16 進連結列にする
    const cleaned = str.replace(/[\s>\r\n]/g, '').toUpperCase();
    // NO DATA / ERROR / UNABLE 等は速度なし
    if (/NODATA|ERROR|UNABLE|STOPPED|\?|SEARCHING$/.test(cleaned)) {
      // SEARCHING を含むだけなら後続にデータがあるかもしれないので継続判定
      if (!/410D/.test(cleaned)) return null;
    }
    const idx = cleaned.indexOf('410D');
    if (idx < 0 || idx + 6 > cleaned.length) return null;
    const hex = cleaned.substr(idx + 4, 2);
    if (!/^[0-9A-F]{2}$/.test(hex)) return null;
    const kmh = parseInt(hex, 16);
    if (!Number.isFinite(kmh) || kmh < 0 || kmh > 255) return null;
    return kmh;
  }

  // ─── 純関数: ELM327 応答 → オドメーター km (01A6・0.1km×4byte・単体テスト対象) ──────
  function _parseOdometerKm(str) {
    if (typeof str !== 'string' || str.length === 0) return null;
    const cleaned = str.replace(/[\s>\r\n]/g, '').toUpperCase();
    if (/NODATA|ERROR|UNABLE/.test(cleaned) && !/41A6/.test(cleaned)) return null;
    const idx = cleaned.indexOf('41A6');
    if (idx < 0 || idx + 12 > cleaned.length) return null;
    const hex = cleaned.substr(idx + 4, 8);
    if (!/^[0-9A-F]{8}$/.test(hex)) return null;
    const raw = parseInt(hex, 16);
    if (!Number.isFinite(raw) || raw < 0) return null;
    return raw * 0.1; // 0.1 km/bit
  }

  // ─── 純関数: ELM327 応答 → エンジンRPM (010C・(256A+B)/4・2byte・単体テスト対象) ──────
  //   応答例: "41 0C 1A F8" / "410C1AF8"。"41 0C" の直後 2 byte (A,B) を ((256A+B)/4) rpm として返す。
  function _parseRpm(str) {
    if (typeof str !== 'string' || str.length === 0) return null;
    const cleaned = str.replace(/[\s>\r\n]/g, '').toUpperCase();
    if (/NODATA|ERROR|UNABLE/.test(cleaned) && !/410C/.test(cleaned)) return null;
    const idx = cleaned.indexOf('410C');
    if (idx < 0 || idx + 8 > cleaned.length) return null;
    const hex = cleaned.substr(idx + 4, 4);
    if (!/^[0-9A-F]{4}$/.test(hex)) return null;
    const a = parseInt(hex.substr(0, 2), 16);
    const b = parseInt(hex.substr(2, 2), 16);
    const rpm = (256 * a + b) / 4;
    if (!Number.isFinite(rpm) || rpm < 0 || rpm > 16383.75) return null;
    return rpm;
  }

  // ─── 純関数: ELM327 応答 → ECU距離 km (0131・1km×2byte・単体テスト対象) ──────
  //   応答例: "41 31 00 7B" / "4131007B"。"41 31" の直後 2 byte を km (1km/bit) として返す。
  function _parseDistKm(str) {
    if (typeof str !== 'string' || str.length === 0) return null;
    const cleaned = str.replace(/[\s>\r\n]/g, '').toUpperCase();
    if (/NODATA|ERROR|UNABLE/.test(cleaned) && !/4131/.test(cleaned)) return null;
    const idx = cleaned.indexOf('4131');
    if (idx < 0 || idx + 8 > cleaned.length) return null;
    const hex = cleaned.substr(idx + 4, 4);
    if (!/^[0-9A-F]{4}$/.test(hex)) return null;
    const km = parseInt(hex, 16);
    if (!Number.isFinite(km) || km < 0 || km > 65535) return null;
    return km; // 1 km/bit
  }

  // ─── Web Bluetooth サポート判定 ───
  function isSupported() {
    return !!(
      typeof navigator !== 'undefined' &&
      navigator.bluetooth &&
      typeof navigator.bluetooth.requestDevice === 'function'
    );
  }
  function isConnected() {
    return !!(_server && _server.connected);
  }
  function getStatus() {
    return _status;
  }

  function getSpeed() {
    const age = _latest.ts > 0 ? _now() - _latest.ts : Infinity;
    return {
      kmh: _latest.kmh,
      mps: _latest.mps,
      ts: _latest.ts,
      ageMs: age,
      valid: _latest.mps >= 0 && age <= SPEED_STALE_MS,
    };
  }

  // OBDオドメーター(km)。未対応/未取得は km:-1。trace が定期記録 → 業務距離の照合に使う。
  function getOdometer() {
    return {
      km: _latestOdo.km,
      ts: _latestOdo.ts,
      supported: _odoSupported,
      ageMs: _latestOdo.ts > 0 ? _now() - _latestOdo.ts : Infinity,
    };
  }

  // ★ECU距離カウンタ(0131・km)★。未対応/未取得は km:-1。trace が定期記録 → 業務開始/終了の差=
  //   ECUが車速パルスを積算した距離(=メーター機=真距離)を OBD∫v と照合し K を導出する材料。
  //   記録専用: 距離計算には未配線。
  function getDistanceSinceClear() {
    return {
      km: _latest0131.km,
      ts: _latest0131.ts,
      supported: _dist0131Supported,
      ageMs: _latest0131.ts > 0 ? _now() - _latest0131.ts : Infinity,
    };
  }

  // ★生OBD∫v(faithful・ポーリングレート積分)★: Σ speed×dt をポーリング毎に積算。
  //   trace は GPS 1Hz 同期で OBD速度を記録するため、オフライン再積分は速度変動を取りこぼし過小化する
  //   (前回モコ解析で 16.99 vs 実機18.18 にズレた原因)。ポーリングレート(速度更新毎)で積分した本値を
  //   記録し、K較正の分母を忠実にする。★記録専用・距離計算には未配線(distance_m 不可侵)★。
  function getObdIntegral() {
    return { m: _obdIntegralM, ts: _obdIntegralLastTs };
  }

  // ★輪速診断モードの手動ON/OFF(診断走行専用)★: ON=接続時にABS輪速CAN捕捉を走らせ生フレームをtrace記録。
  //   既定OFF。距離コアには触らない(捕捉は[OBD-WHEELSPEED]ログ→trace。距離は従来の010D一本)。
  function setWheelSpeedDiscovery(on) {
    const v = on === true;
    _wsDiscoveryForced = v;
    try {
      if (typeof localStorage !== 'undefined') {
        if (v) localStorage.setItem('dk_obd_ws_discovery', '1');
        else localStorage.removeItem('dk_obd_ws_discovery');
      }
    } catch (_) {
      /* ignore */
    }
    if (v && isConnected()) {
      _wsAuto = true; // 接続中なら即discovery開始(次接続でも _wsDiscoveryForced で復元)
      // ★stale bin/捕捉蓄積をクリア(監査推奨2026-06-23): 古い速度帯が残ると新規捕捉が早期終了し under-capture★
      _wsCaps = 0;
      _wsLastCapTs = 0;
      _wsCapturesData = [];
      Object.keys(_wsBins).forEach(function (k) {
        delete _wsBins[k];
      });
    } else if (!v) {
      _wsAuto = false;
    }
    return v;
  }

  // ★エンジンRPM(010C)★。未取得は rpm:-1。trace が定期記録 → 次走行でギア比学習(floor過小de-quant)の実検証用。
  //   記録専用: 距離計算には未配線(距離源は gps.js の OBD速度上書き一本)。
  function getRpm() {
    return {
      rpm: _latestRpm.rpm,
      ts: _latestRpm.ts,
      ageMs: _latestRpm.ts > 0 ? _now() - _latestRpm.ts : Infinity,
    };
  }

  // 鮮度OKなら m/s、それ以外 -1 (= 速度不明) を返す純ヘルパ。
  //   ★L-1 監査修正(配線の正確化)★: ★現状この関数は距離計算には未配線(=実動経路ではない)★。
  //   OBD 速度が距離に効く実経路は ★main スレッドの gps.js が speedKmh を OBD 値で上書き★ する方式
  //   (gps.js の window.OBD_DRIVE_DISTANCE 分岐)。pipeline-distance の speedProvider 注入は
  //   ★Worker B 内で動き window.OBDClient に到達できないため構造上使えない★(監査で確証)。
  //   本関数は「同一スレッドで速度源を差したい将来用途」向けの予約 API・単体テストの鮮度検証用。
  //   二重設計の誤読を避けるため、実配線は gps.js 一本に統一している。
  function speedProvider(/* sample */) {
    const s = getSpeed();
    return s.valid ? s.mps : -1;
  }

  function _now() {
    // Date.now を使う (本 module は通常実行環境・workflow制約の外)
    return typeof Date !== 'undefined' && Date.now ? Date.now() : 0;
  }
  function _sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  // ─── 接続 (要ユーザー操作起点) ───────────────────────────────
  function connect() {
    if (!isSupported()) {
      _setStatus('error');
      _emit('error', 'Web Bluetooth 非対応 (Android Chrome で開いてください)');
      return Promise.reject(new Error('Web Bluetooth unsupported'));
    }
    _stopRequested = false;
    _setStatus('connecting');
    return navigator.bluetooth
      .requestDevice({
        // ELM327 は名前が "OBDII"/"Vgate"/"Veepeak" 等まちまち → 全デバイス許可 + 必要 service を optional に
        acceptAllDevices: true,
        optionalServices: ALL_SERVICES,
      })
      .then(function (device) {
        return _establishWith(device);
      })
      .catch(function (e) {
        _setStatus('error');
        _emit('error', (e && e.message) || String(e));
        _cleanup();
        throw e;
      });
  }

  // ★接続確立を connect()/起動時自動接続/自動再接続 で共有 (2026-06-18)★:
  //   device(requestDevice or getDevices)に対し gatt接続→profile→ELM初期化→warmup→probe→polling。
  function _establishWith(device) {
    _device = device;
    try {
      device.removeEventListener('gattserverdisconnected', _onDisconnected);
    } catch (_) {
      /* ignore */
    }
    device.addEventListener('gattserverdisconnected', _onDisconnected);
    return device.gatt
      .connect()
      .then(function (server) {
        _server = server;
        return _findProfile(server);
      })
      .then(function () {
        return _initElm();
      })
      .then(function () {
        _setStatus('connected');
        _last('dk_obd_device_id', device && device.id ? device.id : ''); // 次回 getDevices で照合
        // ★プロトコル確立ウォームアップ (probe/速度の前に必ず)★: ECU通信を 0100×長timeout で確立。
        return _warmup();
      })
      .then(function (established) {
        // ★確立できた時だけ probe を撃つ★: 未確立で 1.5s の 0100/01A6 を撃つと検出を再中断し
        //   STOPPED 全滅が再発する(監査指摘)。未確立なら probe を飛ばし、自己回復する速度ポーリングへ。
        if (established) {
          return _probe().catch(function () {
            /* プローブ失敗は致命でない */
          });
        }
        return undefined;
      })
      .then(function () {
        // ★自動輪速discovery: 既定OFF(WS_AUTO_DISCOVERY_DEFAULT=false)★。診断モード(_wsDiscoveryForced)時のみON。
        //   ATMA捕捉が走行中OBDを中断し距離を汚す実機回帰の根治(上記定数コメント)。OBDは中断せず連続供給=距離整合。
        _wsAuto = _wsDiscoveryForced || WS_AUTO_DISCOVERY_DEFAULT;
        _wsCaps = 0;
        _wsLastCapTs = 0;
        _wsCapturesData = [];
        _wsMapping = null;
        Object.keys(_wsBins).forEach(function (k) {
          delete _wsBins[k];
        });
        _startPolling();
        return true;
      });
  }

  // ★起動時 自動接続 (2026-06-18・ユーザー操作なし・選択ダイアログ無し)★:
  //   navigator.bluetooth.getDevices() で前回許可済みデバイスを取得し、保存IDに一致(or 唯一)のものへ自動接続。
  //   getDevices 非対応/許可デバイス無し/既接続 は no-op。失敗は idle に戻すだけ(手動connectは従来通り可能)。
  function tryAutoConnect() {
    if (!isSupported() || typeof navigator.bluetooth.getDevices !== 'function') {
      return Promise.resolve(false);
    }
    if (isConnected()) return Promise.resolve(true);
    _stopRequested = false;
    return navigator.bluetooth
      .getDevices()
      .then(function (devices) {
        if (!devices || !devices.length) return false;
        const wantId = _last('dk_obd_device_id');
        let dev = null;
        if (wantId) {
          dev = devices.filter(function (d) {
            return d && d.id === wantId;
          })[0];
        }
        if (!dev) dev = devices[0];
        if (!dev) return false;
        _setStatus('connecting');
        return _establishWith(dev)
          .then(function () {
            return true;
          })
          .catch(function () {
            _setStatus('idle');
            _cleanup();
            return false;
          });
      })
      .catch(function () {
        return false;
      });
  }

  // service/char を既知プロファイル順に探索
  function _findProfile(server) {
    let i = 0;
    function tryNext() {
      if (i >= PROFILES.length) {
        return Promise.reject(new Error('対応する BLE service が見つからない (ELM327 BLE か確認)'));
      }
      const p = PROFILES[i++];
      return server
        .getPrimaryService(p.service)
        .then(function (svc) {
          return Promise.all([svc.getCharacteristic(p.notify), svc.getCharacteristic(p.write)]);
        })
        .then(function (chars) {
          _notifyChar = chars[0];
          _writeChar = chars[1];
          return _notifyChar.startNotifications();
        })
        .then(function () {
          _notifyChar.addEventListener('characteristicvaluechanged', _onNotify);
        })
        .catch(function () {
          return tryNext(); // このプロファイルは不一致 → 次を試す
        });
    }
    return tryNext();
  }

  // ─── 受信 (BLE は ~20byte 分割で来るため '>' プロンプトまでバッファ) ──────
  function _onNotify(event) {
    // ★CAN輪速メーターのバースト捕捉も下の _capturing 経路を流用する(専用ストリーミング分岐は廃止)。
    // ★ABS輪速モニタ捕捉中(ATMA)★: '>' プロンプトが来ない連続ストリームなので、捕捉窓の間は
    //   通常の _send 応答経路でなく専用バッファに溜める(read-only・距離経路に一切干渉しない)。
    if (_capturing) {
      const v = event.target.value;
      let c = '';
      for (let i = 0; i < v.byteLength; i++) c += String.fromCharCode(v.getUint8(i));
      _captureBuf += c;
      return;
    }
    // ★M-1 監査修正: 待機中の _send が無い時に来た通知 = タイムアウト済みコマンドの ★遅延応答★。
    //   これを溜めると次コマンドの応答に混ざり stale 車速を誤注入する(クロストーク) → 破棄する。
    if (!_pendingResolve) {
      _rxBuffer = '';
      return;
    }
    const value = event.target.value; // DataView
    let chunk = '';
    for (let i = 0; i < value.byteLength; i++) {
      chunk += String.fromCharCode(value.getUint8(i));
    }
    _rxBuffer += chunk;
    if (_rxBuffer.indexOf('>') >= 0) {
      const resp = _rxBuffer;
      _rxBuffer = '';
      _resolvePending(resp);
    }
  }
  function _resolvePending(resp) {
    if (_pendingTimer) {
      clearTimeout(_pendingTimer);
      _pendingTimer = null;
    }
    const r = _pendingResolve;
    _pendingResolve = null;
    if (r) r(resp);
  }

  // 1 コマンド送信 → '>' プロンプトまでの応答を待つ。timeoutMs 省略時は CMD_TIMEOUT_MS。
  //   ★初回プロトコル検出(0100)は ELM327 が数秒かかるため長いタイムアウトを渡す(_warmup)。★
  function _send(cmd, timeoutMs) {
    if (!_writeChar) return Promise.reject(new Error('not connected'));
    // ★M-1 監査修正: 送信前に前コマンド(timeout 等)の残バッファを破棄(クロストーク防止)。
    _rxBuffer = '';
    const data = _str2buf(cmd + '\r');
    const _to = timeoutMs && timeoutMs > 0 ? timeoutMs : CMD_TIMEOUT_MS;
    return new Promise(function (resolve, reject) {
      _pendingResolve = resolve;
      _pendingTimer = setTimeout(function () {
        _pendingResolve = null;
        _pendingTimer = null;
        _rxBuffer = ''; // ★M-1: タイムアウト時も残バッファを破棄
        reject(new Error('OBD timeout: ' + cmd));
      }, _to);
      _writeCharSafe(data).catch(function (e) {
        _resolvePending(''); // 書き込み失敗 → 空応答で解放
        reject(e);
      });
    });
  }
  function _writeCharSafe(data) {
    // 一部の実装は writeValueWithoutResponse のみ対応
    if (typeof _writeChar.writeValueWithoutResponse === 'function') {
      return _writeChar.writeValueWithoutResponse(data);
    }
    return _writeChar.writeValue(data);
  }
  function _str2buf(s) {
    const buf = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i) & 0xff;
    return buf;
  }

  // ─── ★プロトコル確立ウォームアップ (2026-06-09・実車probe全滅の根治・監査硬化)★ ───
  //   真因: ATSP0(自動検出)直後の0100をクローンが数秒かけて検出する間、短timeoutで叩くと検出中断→
  //   STOPPED全滅。さらにタイムアウト即再送も検出を割り込む。監査の硬化:
  //   ①プロトコルを ATSP6(ISO15765-4 CAN 11/500=2008年以降の日本車ほぼ全部)に pin → 0→7 へフォールバック。
  //    auto検出のスキャン遅延を排除(クローン最大の博打を回避)。
  //   ②各0100は長timeout(7s)。タイムアウト/STOPPED/SEARCHING 時は ★再送前に待機(WARMUP_RETRY_WAIT_MS)★
  //    してチップを idle に戻し、検出割り込みを起こさない。
  //   ③4100(ECU応答)が返れば確立成功。全プロトコル失敗で false(connect側で probe をスキップ)。
  const _WARMUP_PROTOS = ['6', '0', '7']; // ATSP6(CAN11/500)→ATSP0(auto)→ATSP7(CAN29/500)
  function _warmup() {
    let pi = 0;
    function tryProto() {
      if (pi >= _WARMUP_PROTOS.length) return Promise.resolve(false);
      const sp = _WARMUP_PROTOS[pi++];
      return _send('ATSP' + sp, 2500)
        .catch(function () {
          return '';
        })
        .then(function () {
          return _sleep(300);
        }) // プロトコル切替後に少し落ち着かせる
        .then(function () {
          return attempt(0);
        });
      function attempt(t) {
        return _send('0100', PROTOCOL_TIMEOUT_MS)
          .then(function (resp) {
            const c = (resp || '').replace(/[\s>]/g, '').toUpperCase();
            if (/4100/.test(c)) return true; // 確立成功(41 00 = supported PIDs)
            if (t + 1 < WARMUP_RETRIES)
              return _sleep(WARMUP_RETRY_WAIT_MS).then(function () {
                return attempt(t + 1);
              });
            return tryProto(); // このプロトコルでは確立できず → 次のプロトコルへ
          })
          .catch(function () {
            // timeout: 検出進行中かもしれない → 待ってから再送(割り込み回避)
            if (t + 1 < WARMUP_RETRIES)
              return _sleep(WARMUP_RETRY_WAIT_MS).then(function () {
                return attempt(t + 1);
              });
            return tryProto();
          });
      }
    }
    return tryProto();
  }

  // ─── ELM327 初期化 ───
  //   ★ATZ(リセット)はチップ再起動(~1-2s)を伴うため長timeout+settleを与える(短timeoutだと再起動中に
  //     次の ATE0 が捨てられ echo off が効かない個体がある・監査指摘)。その後 echo/lf/space/headers off。
  function _initElm() {
    return _send('ATZ', 3000)
      .catch(function () {
        /* ATZ 失敗は致命でない */
      })
      .then(function () {
        return _sleep(1000); // リセット後の settle
      })
      .then(function () {
        let chain = Promise.resolve();
        INIT_CMDS.forEach(function (cmd) {
          chain = chain.then(function () {
            return _send(cmd).catch(function () {
              /* 個別失敗は致命でない */
            });
          });
        });
        return chain;
      });
  }

  // ─── ★OBD距離能力プローブ (2026-06-09・随伴車のTier判定)★ ───
  //   接続時に1回だけ、距離に関わる標準PIDとVINを問い合わせ「この車が何を出すか」を記録する。
  //   ★read-only・車に影響ゼロ★。結果は console.log('[OBD-PROBE] ...') で debug-log-uploader が
  //   Firebase へ上げる + window.OBD_PROBE_RESULT に保持 + 'probe' イベント発火。
  //   目的: Tier判定 — Tier1=高分解能オドメーター(01A6=0.1km) / Tier2=高分解能車輪速 /
  //         Tier3=010D(1km/h)のみ。出るものに応じて距離源を決める。生応答を記録しオフライン解析。
  const PROBE_QUERIES = [
    ['supported_01_20', '0100'], // 対応PIDビットマスク(01-20)
    ['supported_21_40', '0120'],
    ['supported_41_60', '0140'],
    ['supported_61_80', '0160'],
    ['supported_81_A0', '0180'],
    ['supported_A1_C0', '01A0'],
    ['odometer_01A6', '01A6'], // ★標準オドメーター(0.1km・新しめの車)★
    ['dist_since_clear_0131', '0131'], // 距離(1km・粗い)
    ['vin_0902', '0902'], // VIN(メーカー判定)。速度010Dはポーリングで取得済のためプローブから除外
  ];
  function _probe() {
    const results = { v: 1, ts: _now(), queries: {} };
    let chain = Promise.resolve();
    PROBE_QUERIES.forEach(function (q) {
      const label = q[0];
      const cmd = q[1];
      chain = chain.then(function () {
        return _send(cmd)
          .then(function (resp) {
            results.queries[label] = {
              cmd: cmd,
              raw: (resp || '').replace(/[\r\n>]/g, ' ').trim(),
            };
          })
          .catch(function (e) {
            results.queries[label] = { cmd: cmd, raw: 'ERR:' + ((e && e.message) || String(e)) };
          });
      });
    });
    return chain.then(function () {
      // 軽い decode (確認用・生rawも残す。詳細はオフライン解析)
      try {
        results.decoded = _decodeProbe(results.queries);
        // ★odo対応を確定 → 走行中ポーリングに 01A6 を混ぜ trace 記録★
        _odoSupported = !!(results.decoded && results.decoded.odometer_supported);
        if (results.decoded && results.decoded.odometer_km != null) {
          _latestOdo = { km: results.decoded.odometer_km, ts: _now() };
        }
        // ★0131(ECU距離)対応を確定 → 走行中ポーリングに混ぜ trace 記録★
        _dist0131Supported = !!(results.decoded && results.decoded.dist_since_clear_supported);
        if (results.decoded && results.decoded.dist_since_clear_km != null) {
          _latest0131 = { km: results.decoded.dist_since_clear_km, ts: _now() };
        }
      } catch (_) {
        /* decode 失敗は無視 (raw があれば解析可能) */
      }
      global.OBD_PROBE_RESULT = results;
      try {
        if (typeof global !== 'undefined' && typeof global.dlog === 'function')
          global.dlog('[OBD-PROBE] ' + JSON.stringify(results));
      } catch (_) {
        /* ignore */
      }
      _emit('probe', results);
      return results;
    });
  }
  // 生応答 → 距離系の値を軽く decode (Tier の当たりを付ける・解析はオフライン優先)
  function _decodeProbe(q) {
    const out = {};
    function hexAfter(raw, prefix) {
      if (!raw) return null;
      const c = raw.replace(/[\s>]/g, '').toUpperCase();
      const i = c.indexOf(prefix);
      if (i < 0) return null;
      return c.substr(i + prefix.length);
    }
    // 01A6 オドメーター: 41 A6 + 4byte ×0.1km
    if (q.odometer_01A6 && q.odometer_01A6.raw) {
      const h = hexAfter(q.odometer_01A6.raw, '41A6');
      if (h && h.length >= 8 && /^[0-9A-F]{8}/.test(h)) {
        out.odometer_km = parseInt(h.substr(0, 8), 16) * 0.1;
        out.odometer_supported = true;
      } else {
        out.odometer_supported = false;
      }
    }
    // 0131 距離: 41 31 + 2byte km
    if (q.dist_since_clear_0131 && q.dist_since_clear_0131.raw) {
      const h = hexAfter(q.dist_since_clear_0131.raw, '4131');
      if (h && h.length >= 4 && /^[0-9A-F]{4}/.test(h)) {
        out.dist_since_clear_km = parseInt(h.substr(0, 4), 16);
        out.dist_since_clear_supported = true;
      } else {
        out.dist_since_clear_supported = false;
      }
    }
    return out;
  }

  // ─── 純関数: ATMA モニタ出力 → CANフレーム配列 (単体テスト対象) ──────────────
  //   ATH1+ATS1 のモニタ出力は 1行 = "<ID> <byte> <byte> ..."(例 "1C4 00 50 00 50 00 50 00 50")。
  //   ATS0(空白なし)個体向けに「空白なし長hex行」も 11bit(先頭3)/29bit(先頭8) で分解する fallback 付き。
  //   返り値: [{ id:'1C4', bytes:[0,80,...] }, ...]。雑音行(BUFFER FULL/STOPPED/ATMA/>等)は除外。
  function _parseMonitorFrames(str) {
    if (typeof str !== 'string' || str.length === 0) return [];
    const out = [];
    const lines = str.split(/[\r\n]+/);
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li].trim();
      if (!line) continue;
      const compact = line.replace(/\s+/g, '').toUpperCase();
      if (
        compact.length === 0 ||
        /^(>|ATMA|BUFFERFULL|STOPPED|SEARCHING|NODATA|ERROR|UNABLE|CANERROR|\?)/.test(compact)
      )
        continue;
      let id = null;
      let byteToks = null;
      const toks = line.split(/\s+/).filter(Boolean);
      if (toks.length >= 2 && /^[0-9A-Fa-f]{3}$|^[0-9A-Fa-f]{8}$/.test(toks[0])) {
        // 空白あり(ATS1): 先頭=ID, 残り=データバイト
        id = toks[0].toUpperCase();
        byteToks = toks.slice(1);
      } else if (toks.length === 1 && /^[0-9A-Fa-f]+$/.test(compact) && compact.length >= 5) {
        // 空白なし(ATS0) fallback: 先頭3(11bit)を ID、残りを2hexずつ。8桁先頭はオフライン側で判定。
        id = compact.substr(0, 3);
        byteToks = [];
        for (let i = 3; i + 2 <= compact.length; i += 2) byteToks.push(compact.substr(i, 2));
      } else {
        continue;
      }
      const bytes = [];
      let ok = true;
      for (let i = 0; i < byteToks.length; i++) {
        const b = String(byteToks[i]).toUpperCase();
        if (!/^[0-9A-F]{2}$/.test(b)) {
          ok = false;
          break;
        }
        bytes.push(parseInt(b, 16));
      }
      if (!ok || bytes.length === 0) continue;
      out.push({ id: id, bytes: bytes });
    }
    return out;
  }

  // ─── 純関数: フレーム配列 → ID別サマリ (単体テスト対象) ──────────────
  //   各 CAN ID について 出現数 と バイト位置ごとの「変化したか(distinct数)」を要約。
  //   走行中に値が動くバイト位置＝速度/回転系の候補(オフライン解析で 010D と相関を取る前のあたり付け)。
  function _summarizeFrames(frames) {
    const by = {};
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (!by[f.id]) by[f.id] = { id: f.id, count: 0, len: f.bytes.length, distinct: [] };
      const e = by[f.id];
      e.count++;
      for (let b = 0; b < f.bytes.length; b++) {
        if (!e.distinct[b]) e.distinct[b] = {};
        e.distinct[b][f.bytes[b]] = 1;
      }
    }
    return Object.keys(by)
      .map(function (id) {
        const e = by[id];
        return {
          id: id,
          count: e.count,
          len: e.len,
          changingBytes: (e.distinct || []).map(function (d) {
            return d ? Object.keys(d).length : 0;
          }),
        };
      })
      .sort(function (a, b) {
        return b.count - a.count;
      });
  }

  // ─── 純関数: フレーム配列 → ID別バイト平均 (端末内識別の入力) ──────────────
  function _frameMeans(frames) {
    const sum = {};
    const cnt = {};
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (!sum[f.id]) {
        sum[f.id] = [];
        cnt[f.id] = 0;
      }
      cnt[f.id]++;
      for (let b = 0; b < f.bytes.length; b++) sum[f.id][b] = (sum[f.id][b] || 0) + f.bytes[b];
    }
    const out = {};
    Object.keys(sum).forEach(function (id) {
      out[id] = sum[id].map(function (v) {
        return v / cnt[id];
      });
    });
    return out;
  }

  // ─── 純関数: 速度帯(20km/h刻み) ──────────────
  function _speedBin(kmh) {
    return kmh >= 0 ? Math.floor(kmh / 20) : -1; // 0,20,40,60.. を 0,1,2,3 bin に
  }

  // ─── 純関数: いま自動輪速捕捉すべきか (単体テスト対象) ──────────────
  //   s = { enabled, caps, bins, lastTs, now, speedKmh, minGapMs, maxCaps, minBins }
  function _wsCaptureDecision(s) {
    if (!s || !s.enabled) return false;
    if (s.caps >= s.maxCaps) return false; // 十分集めた
    if (s.bins >= s.minBins) return false; // 速度帯が十分散った
    // ★S5: 速度不明(010D未取得)or 停車/極低速 では撃たない(退化点で回帰汚染+捕捉浪費)★
    if (!(s.speedKmh >= (s.minSpeed != null ? s.minSpeed : 0))) return false;
    if (s.lastTs > 0 && s.now - s.lastTs < s.minGapMs) return false; // 間隔を空ける
    return true;
  }
  // モジュール状態から判定用stateを組む
  function _wsState(now) {
    return {
      enabled: _wsAuto,
      caps: _wsCaps,
      bins: Object.keys(_wsBins).length,
      lastTs: _wsLastCapTs,
      now: now,
      speedKmh: _latest.kmh,
      minGapMs: WS_AUTO_MIN_GAP_MS,
      maxCaps: WS_AUTO_MAX_CAPS,
      minBins: WS_AUTO_MIN_SPEED_BINS,
      minSpeed: WS_AUTO_MIN_CAPTURE_KMH,
    };
  }

  // ─── 純関数: ATMA生出力 → CAN可視性の判定 (単体テスト対象) ──────────────
  //   司さんの「CAN見えるかチェック」の核。停車ATMAの生テキストから、ブロードキャストが
  //   流れてるか(=ゲート無し=輪速探索へ進める)を分類する。診断応答ID(7DF/7E0-7EF)は
  //   除外して「自発ブロードキャストID」を数える。BUFFER FULL は「溢れるほど流れてる」=見える側。
  function _classifyCanProbe(raw, protocol, durMs) {
    const text = typeof raw === 'string' ? raw : '';
    const bufferFull = /BUFFER\s*FULL/i.test(text);
    const frames = _parseMonitorFrames(text);
    const idCount = {};
    for (let i = 0; i < frames.length; i++)
      idCount[frames[i].id] = (idCount[frames[i].id] || 0) + 1;
    const distinctIds = Object.keys(idCount);
    const isDiag = function (id) {
      return /^7DF$/.test(id) || /^7E[0-9A-F]$/.test(id); // 診断要求/応答ID(自発でない)
    };
    const broadcastIds = distinctIds.filter(function (id) {
      return !isDiag(id);
    });
    const protoStr = (protocol || '').toUpperCase();
    const isCan = /CAN|15765/.test(protoStr) || frames.length > 0 || bufferFull;
    let verdict, reason, ok;
    if (!isCan && frames.length === 0 && !bufferFull) {
      verdict = 'no_can';
      ok = false;
      reason = 'CAN応答なし(K-Line/非対応の可能性)。OBD経由のこの道は不可→GPS+0.5へ。';
    } else if (broadcastIds.length >= 3) {
      verdict = 'broadcast_visible';
      ok = true;
      reason =
        '自発ブロードキャストID ' +
        broadcastIds.length +
        '種=ゲート無し。走行+左右旋回で4輪連動IDを探せる。';
    } else if (bufferFull) {
      verdict = 'broadcast_likely';
      ok = true;
      reason =
        'BUFFER FULL=大量トラフィック有り(ゲート無し濃厚)。クローンが溢れた=STN系アダプタ/ATCRA絞りで確定可。';
    } else if (broadcastIds.length >= 1) {
      verdict = 'broadcast_weak';
      ok = true;
      reason = '自発ID少数。流れてはいる。捕捉時間を延ばすか旋回して再確認。';
    } else if (distinctIds.length > 0) {
      verdict = 'gated';
      ok = false;
      reason = '診断応答ID(7Ex)のみ=自発ブロードキャスト無し=ゲート済。OBD経由では輪速不可。';
    } else {
      verdict = 'quiet_or_gated';
      ok = false;
      reason = 'フレーム0=ゲート済 or アダプタ取りこぼし。STN系アダプタで再試行推奨。';
    }
    return {
      v: 1,
      ts: _now(),
      durationMs: durMs || 0,
      protocol: protocol || '',
      bufferFull: bufferFull,
      frameCount: frames.length,
      distinctIdCount: distinctIds.length,
      broadcastIdCount: broadcastIds.length,
      distinctIds: distinctIds.slice(0, 40),
      broadcastIds: broadcastIds.slice(0, 40),
      topIds: _summarizeFrames(frames).slice(0, 10),
      verdict: verdict,
      ok: ok,
      reason: reason,
      rawSample: text.slice(0, 4000),
    };
  }

  // ─── ★ABS各輪速 捕捉コア (read-only・距離未配線・ATH0/ATS0必ず復元)★ ───
  //   ATH1+ATS1→ATMA durationMs 受動モニタ→生フレーム捕捉→ATH0/ATS0 復元。捕捉時010D速度を同梱記録し
  //   [OBD-WHEELSPEED] でログ→オフラインで「ID×バイト×係数」を010Dに線形回帰し輪速IDを確定。
  //   ★ポーリング状態(_stopRequested/_startPolling)には触らない★= 呼び出し側(手動API or 自動loop)の責務。
  //   ★読むだけ・車に書き込まない・距離計算に一切影響しない★。
  function _captureWheelSpeed(durMs, obd010d) {
    function _restore(passthru, isErr) {
      _capturing = false;
      return _send('ATS0')
        .catch(function () {})
        .then(function () {
          return _send('ATH0').catch(function () {});
        })
        .then(function () {
          if (isErr) throw passthru;
          return passthru;
        });
    }
    return _send('ATH1')
      .catch(function () {})
      .then(function () {
        return _send('ATS1').catch(function () {});
      })
      .then(function () {
        _captureBuf = '';
        _capturing = true; // この瞬間から notify は _captureBuf へ
        return _writeCharSafe(_str2buf('ATMA\r')).catch(function () {});
      })
      .then(function () {
        return _sleep(durMs);
      })
      .then(function () {
        return _writeCharSafe(_str2buf('\r')).catch(function () {}); // ATMA停止(任意1文字)
      })
      .then(function () {
        return _sleep(350);
      })
      .then(function () {
        _capturing = false;
        const raw = _captureBuf;
        _captureBuf = '';
        const frames = _parseMonitorFrames(raw);
        const result = {
          v: 1,
          ts: _now(),
          durationMs: durMs,
          obd010d_kmh: obd010d, // 捕捉時の010D速度(回帰の独立変数)
          frameCount: frames.length,
          ids: _summarizeFrames(frames),
          means: _frameMeans(frames), // ★端末内識別の入力(ID別バイト平均)★
          rawSample: raw.slice(0, 6000),
        };
        global.OBD_WHEELSPEED_PROBE = result;
        try {
          if (typeof global !== 'undefined' && typeof global.dlog === 'function')
            global.dlog('[OBD-WHEELSPEED] ' + JSON.stringify(result));
        } catch (_) {
          /* ignore */
        }
        _emit('probe', { wheelspeed: result });
        return _restore(result, false);
      })
      .catch(function (e) {
        return _restore(e, true);
      });
  }

  // ─── 手動プローブ API (debug/Eruda用・ポーリングを一時停止して撃つ) ───
  //   ★通常運用は自動discovery(loop内)。これはデバッグで明示的に撃ちたい時用★。
  function probeWheelSpeed(durationMs) {
    const dur = durationMs && durationMs > 0 ? durationMs : WHEELSPEED_PROBE_MS;
    if (!isConnected()) return Promise.reject(new Error('OBD未接続'));
    if (_capturing) return Promise.reject(new Error('既に輪速捕捉中'));
    if (_cwOn || _cwBurstInflight) return Promise.reject(new Error('CAN輪速メーター動作中')); // ★監査M5/M-B: 双方向排他(in-flight中も)★
    const obd010d = getSpeed().kmh;
    const wasStop = _stopRequested;
    _stopRequested = true; // ポーリングを一旦止める(ATMAとBLE帯域競合回避)
    function _resume() {
      _stopRequested = wasStop;
      if (!_stopRequested && isConnected()) _startPolling();
    }
    return _sleep(150)
      .then(function () {
        return _captureWheelSpeed(dur, obd010d);
      })
      .then(
        function (res) {
          _resume();
          return res;
        },
        function (e) {
          _resume();
          throw e;
        }
      );
  }

  // ─── ★CAN見えるかチェック(停車・エンジンON・read-only・距離不可侵)★ ───
  //   司さん「テストできるようにしろ」。ATSP6→ATDP→0100→ATH1→ATS0→ATAL→ATMA を数秒流し、
  //   生フレームを _classifyCanProbe で「見える/ゲート済/詰み」に即判定。[OBD-CANPROBE]でtrace記録。
  //   ★距離計算/課金/ポーリング骨格に一切影響しない。停車中に撃つ前提。ATS1/ATH0で必ず復元。★
  //   クローンELM327(Zappa等)のBUFFER FULLは「溢れるほど流れてる」=見える側として扱う。
  function canBusProbe(durationMs) {
    const dur = durationMs && durationMs > 0 ? durationMs : 4000;
    if (!isConnected()) return Promise.reject(new Error('OBD未接続'));
    if (_capturing) return Promise.reject(new Error('既に捕捉中'));
    if (_cwOn || _cwBurstInflight) return Promise.reject(new Error('CAN輪速メーター動作中')); // ★監査M5/M-B: 双方向排他(in-flight中も)★
    const wasStop = _stopRequested;
    const obd010d = getSpeed().kmh; // 押下時の010D速度(走行中に数回押せば速度別CANで輪速ID特定可)
    _stopRequested = true; // ポーリング停止(ATMAとBLE帯域競合回避)
    let protocol = '';
    function _restore(passthru, isErr) {
      _capturing = false;
      return _send('ATS1')
        .catch(function () {})
        .then(function () {
          return _send('ATH0').catch(function () {});
        })
        .then(function () {
          _stopRequested = wasStop;
          if (!_stopRequested && isConnected()) _startPolling();
          if (isErr) throw passthru;
          return passthru;
        });
    }
    return _sleep(150)
      .then(function () {
        return _send('ATSP6', 2500).catch(function () {
          return '';
        });
      }) // CAN 11bit/500k に pin
      .then(function () {
        return _send('ATDP', 2000).catch(function () {
          return '';
        });
      })
      .then(function (r) {
        protocol = (r || '').replace(/[\s>]/g, '');
      })
      .then(function () {
        return _send('0100', 5000).catch(function () {
          return '';
        });
      }) // バス起こし
      .then(function () {
        return _send('ATH1').catch(function () {});
      }) // ヘッダ(CAN ID)ON
      .then(function () {
        return _send('ATS0').catch(function () {});
      }) // 空白省略(BUFFER FULL緩和)
      .then(function () {
        return _send('ATAL').catch(function () {});
      }) // ロング許可
      .then(function () {
        _captureBuf = '';
        _capturing = true; // この瞬間から notify は _captureBuf へ
        return _writeCharSafe(_str2buf('ATMA\r')).catch(function () {});
      })
      .then(function () {
        return _sleep(dur);
      })
      .then(function () {
        return _writeCharSafe(_str2buf('\r')).catch(function () {}); // ATMA停止
      })
      .then(function () {
        return _sleep(350);
      })
      .then(
        function () {
          _capturing = false;
          const raw = _captureBuf;
          _captureBuf = '';
          const verdict = _classifyCanProbe(raw, protocol, dur);
          verdict.obd010d_kmh = obd010d; // 押下時速度(走行中押下=速度別CANのID特定に使う)
          global.OBD_CANPROBE = verdict;
          try {
            if (typeof global !== 'undefined' && typeof global.dlog === 'function')
              global.dlog('[OBD-CANPROBE] ' + JSON.stringify(verdict));
          } catch (_) {
            /* ignore */
          }
          _emit('canprobe', verdict);
          return _restore(verdict, false);
        },
        function (e) {
          return _restore(e, true);
        }
      );
  }

  // ─── 純関数: CANフレーム bytes → 車輪速 km/h (単体テスト対象) ──────────────
  //   cfg={id,off,endian,scale}。BE: bytes[off]*256+bytes[off+1]、LE: 逆。/scale で km/h。
  function _decodeCanWheelKmh(bytes, cfg) {
    if (!Array.isArray(bytes)) return -1;
    const off = cfg.off | 0;
    if (off + 1 >= bytes.length) return -1;
    const hi = bytes[off],
      lo = bytes[off + 1];
    if (typeof hi !== 'number' || typeof lo !== 'number') return -1;
    const raw = cfg.endian === 'LE' ? lo * 256 + hi : hi * 256 + lo;
    const sc = cfg.scale > 0 ? cfg.scale : 1;
    return raw / sc;
  }
  // ─── 純関数: 積分1ステップ (単体テスト対象) ──────────────
  //   speedKmh と nowMs から、前回フレームとの dt で距離を積む。dt>CW_MAX_DT_S は加算しない(断絶保護)。
  //   返り値: { distM, lastT } の新状態(純粋・副作用なし)。
  function _cwIntegrateStep(state, speedKmh, nowMs, maxDtS) {
    const lastT = state.lastT || 0;
    let distM = state.distM || 0;
    if (lastT > 0 && nowMs > lastT) {
      const dt = (nowMs - lastT) / 1000;
      if (dt > 0 && dt <= (maxDtS || CW_MAX_DT_S) && speedKmh >= 0) {
        distM += (speedKmh / 3.6) * dt; // km/h→m/s × s = m
      }
    }
    return { distM: distM, lastT: nowMs };
  }
  // ─── 純関数: 1バーストの生フレーム群 → 対象IDの窓速度km/h(単体テスト対象)──────────────
  //   対象IDの全フレームをデコードし★中央値★(外れ値に頑健)。先頭2フレームは前バースト残渣の可能性で破棄。
  //   有効値が無ければ -1。窓平均でなく中央値=スパイク耐性。frameCount も返す(ストール判定用)。
  function _cwWindowSpeed(frames, cfg) {
    const tgt = [];
    for (let i = 0; i < frames.length; i++) if (frames[i].id === cfg.id) tgt.push(frames[i]);
    const use = tgt.length > 2 ? tgt.slice(2) : tgt; // 先頭2破棄(残渣)
    const vs = [];
    for (let i = 0; i < use.length; i++) {
      const v = _decodeCanWheelKmh(use[i].bytes, cfg);
      if (v >= 0) vs.push(v);
    }
    if (!vs.length) return { kmh: -1, n: 0 };
    vs.sort(function (a, b) {
      return a - b;
    });
    return { kmh: vs[Math.floor(vs.length / 2)], n: vs.length };
  }
  // 1バースト捕捉: ATMAを CW_BURST_MS だけ撃つ→停止→吐き切り。生バッファを返す(_capturing経路を流用)。
  //   ★監査M-B: 世代トークンで「自分が所有してる間だけ _capturing/_captureBuf を下ろす」=stop後に
  //   probe等が再取得した捕捉窓を踏み潰さない。_cwBurstInflight で probe排他を in-flight中も効かせる。★
  function _cwBurstCapture() {
    const gen = ++_cwBurstGen;
    _cwBurstInflight = true;
    _captureBuf = '';
    _capturing = true;
    function _release(raw) {
      // 自世代かつメーター稼働中の時だけ捕捉所有権を返す(他者が取得済みなら触らない)
      if (gen === _cwBurstGen && _cwOn) {
        _capturing = false;
        _captureBuf = '';
      }
      _cwBurstInflight = false;
      return raw;
    }
    return _writeCharSafe(_str2buf('ATMA\r'))
      .catch(function () {})
      .then(function () {
        return _sleep(CW_BURST_MS);
      })
      .then(function () {
        return _writeCharSafe(_str2buf('\r')).catch(function () {}); // ATMA停止(任意1文字)
      })
      .then(function () {
        return _sleep(CW_DRAIN_MS);
      })
      .then(
        function () {
          return _release(_captureBuf);
        },
        function (e) {
          _release('');
          throw e;
        }
      );
  }
  // バーストループ本体: 1周期 = 捕捉→窓速度→HOLD積分→次周期スケジュール。連続ATMAを張りっぱなしにしない。
  function _cwBurstLoop() {
    if (!_cwOn || !isConnected()) {
      _cwOn = false;
      return;
    }
    const cycleStart = _now();
    _cwBurstCapture().then(
      function (raw) {
        if (!_cwOn) return;
        const frames = _parseMonitorFrames(raw);
        const w = _cwWindowSpeed(frames, _cwCfg);
        const now = _now();
        // ★監査MINOR(位相): 速度サンプルはバースト窓の中央時刻に当てる(積分基準を窓中央同士に揃え加減速の位相遅れを除去)★
        const midT = cycleStart + CW_BURST_MS / 2;
        if (w.n >= CW_MIN_FRAMES && w.kmh >= 0) {
          _cwStallN = 0;
          const v = w.kmh < CW_ZUPT_KMH ? 0 : w.kmh; // 停止はDM Light同様0(creep防止)
          const ns = _cwIntegrateStep(
            { distM: _cwDistM, lastT: _cwLastMidT },
            v,
            midT,
            CW_MAX_DT_S
          );
          _cwDistM = ns.distM;
          _cwLastMidT = ns.lastT;
          _cwLastKmh = v;
          _cwFrames += w.n;
        } else {
          // ★ストール(フレーム欠落=クローンの一時詰まり/トンネル等)★:
          //   直近が★走行中(>ZUPT)★なら、その速度でgapを橋渡し=距離を失わない(トンネルの欠損回収)。
          //   停車中(≤ZUPT)は橋渡しせずcreep防止。橋渡しはCW_BRIDGE_MAX_Sでcap(暴走防止)。
          //   代行は過大ゼロ非拘束=DM Light基準なので、欠損より僅かな上振れの方が許容。
          _cwStallN++;
          const gapS = _cwLastMidT > 0 ? (midT - _cwLastMidT) / 1000 : 0;
          if (_cwLastKmh > CW_ZUPT_KMH && gapS > 0 && gapS <= CW_BRIDGE_MAX_S) {
            _cwDistM += (_cwLastKmh / 3.6) * gapS; // 直近速度でgapを埋める
          }
          _cwLastMidT = midT;
        }
        if (now - _cwLastLogT >= CW_LOG_INTERVAL_MS) {
          _cwLog();
          _cwLastLogT = now;
        }
        if (_cwOn) {
          const wait = Math.max(50, CW_CYCLE_MS - (_now() - cycleStart));
          _cwBurstTimer = setTimeout(_cwBurstLoop, wait);
        }
      },
      function () {
        if (_cwOn) _cwBurstTimer = setTimeout(_cwBurstLoop, CW_CYCLE_MS);
      }
    );
  }
  function _cwLog() {
    const durS = _cwStartT ? (_now() - _cwStartT) / 1000 : 0;
    const rec = {
      v: 1,
      ts: _now(),
      id: _cwCfg.id,
      distM: Math.round(_cwDistM * 10) / 10,
      frames: _cwFrames,
      lastKmh: Math.round(_cwLastKmh * 100) / 100,
      durationS: Math.round(durS),
    };
    try {
      // eslint-disable-next-line no-console
      console.log('[OBD-CANWHEEL] ' + JSON.stringify(rec));
    } catch (_) {
      /* ignore */
    }
    return rec;
  }
  // ─── ★CAN輪速メーター 開始/停止/取得(★バースト方式★・read-only・距離不可侵・検証専用)★ ───
  //   start: ヘッダ/フィルタを一度だけ設定(ATSP6/ATH1/ATS0/ATAL/ATCRA<id>)→バーストループ開始。
  //   ★連続ATMAは張らない★(クローンが詰まる)。各バーストで撃って止めて吐き切る。停止でATAR/ATS1/ATH0復元+ポーリング再開。
  function startCanWheelMeter(opts) {
    if (!isConnected()) return Promise.reject(new Error('OBD未接続'));
    // ★監査M-A: _cwOn は非同期プリアンブル後にしか立たない。同期フラグ _cwStarting で連打/二重発火の
    //   プリアンブル窓を即座に塞ぐ(2本のバーストループ並走を防止)。★
    if (_cwOn || _cwStarting) return Promise.resolve(getCanWheelMeter());
    if (_capturing) return Promise.reject(new Error('輪速捕捉中'));
    // ★監査M6: 業務走行(課金)中は起動禁止★。バーストATMAも010Dポーリングを止めるため、課金距離源
    //   (OBD速度)をGPS級へ劣化させる。検証は非課金走行で。feedback_daikome_running_gate 整合。
    //   ★距離コア非依存★: Meterを直接参照しない(独立性テスト)。index.html が業務開始/終了で
    //   window.OBD_BUSINESS_RUNNING を立てる汎用フラグで判定。
    if (global.OBD_BUSINESS_RUNNING === true)
      return Promise.reject(new Error('業務走行中は使用不可(検証は非課金走行で)'));
    if (opts && opts.id) configCanWheel(opts);
    _cwStarting = true; // ★同期で起動中をマーク(以後の連打は上の _cwStarting ガードで即return)★
    _cwWasStop = _stopRequested;
    _stopRequested = true; // ポーリング停止(ATMAと帯域競合回避)
    _cwDistM = 0;
    _cwFrames = 0;
    _cwLastMidT = 0;
    _cwLastKmh = 0;
    _cwStallN = 0;
    _cwLastLogT = 0;
    return _sleep(120)
      .then(function () {
        return _send('ATSP6', 2500).catch(function () {});
      })
      .then(function () {
        return _send('ATH1').catch(function () {}); // CAN ID表示
      })
      .then(function () {
        return _send('ATS0').catch(function () {}); // 空白省略
      })
      .then(function () {
        return _send('ATAL').catch(function () {}); // ロング許可
      })
      .then(function () {
        return _send('ATCRA ' + _cwCfg.id).catch(function () {}); // 対象IDだけに絞る(BUFFER FULL緩和)
      })
      .then(function () {
        _cwStartT = _now();
        _cwLastLogT = _now();
        _cwOn = true;
        _cwStarting = false;
        _cwBurstLoop(); // バーストループ開始(連続ATMAは張らない)
        _emit('canwheel', getCanWheelMeter());
        return getCanWheelMeter();
      })
      .catch(function (e) {
        _cwStarting = false; // プリアンブル失敗でもフラグを残さない
        throw e;
      });
  }
  function stopCanWheelMeter() {
    if (!_cwOn) return Promise.resolve(getCanWheelMeter());
    _cwOn = false; // ループ停止(次tickで抜ける)
    _cwBurstGen++; // ★監査M-B: in-flight捕捉の完了クリアを無効化(世代不一致)★
    if (_cwBurstTimer) {
      clearTimeout(_cwBurstTimer);
      _cwBurstTimer = null;
    }
    _capturing = false; // 捕捉途中なら解除
    const result = _cwLog(); // 最終ログ
    return _writeCharSafe(_str2buf('\r'))
      .catch(function () {}) // 念のためATMA停止
      .then(function () {
        return _sleep(250);
      })
      .then(function () {
        return _send('ATAR').catch(function () {}); // 受信フィルタ解除
      })
      .then(function () {
        return _send('ATS1').catch(function () {});
      })
      .then(function () {
        return _send('ATH0').catch(function () {});
      })
      .then(function () {
        // ★監査m1: start で ATSP6/ATAL を撃った往復の片道を是正=プロトコル再pin(自己治癒)。
        return isConnected() ? _warmup().catch(function () {}) : null;
      })
      .then(function () {
        _stopRequested = _cwWasStop;
        if (!_stopRequested && isConnected()) _startPolling();
        _emit('canwheel', getCanWheelMeter());
        return result;
      });
  }
  function getCanWheelMeter() {
    return {
      on: _cwOn,
      id: _cwCfg.id,
      distM: Math.round(_cwDistM * 10) / 10,
      frames: _cwFrames,
      lastKmh: Math.round(_cwLastKmh * 100) / 100,
      stalls: _cwStallN,
      durationS: _cwStartT ? Math.round((_now() - _cwStartT) / 1000) : 0,
    };
  }
  function configCanWheel(opts) {
    if (!opts) return _cwCfg;
    if (opts.id) _cwCfg.id = String(opts.id).toUpperCase();
    if (typeof opts.off === 'number') _cwCfg.off = opts.off | 0;
    if (opts.endian) _cwCfg.endian = opts.endian === 'LE' ? 'LE' : 'BE';
    if (opts.scale > 0) _cwCfg.scale = opts.scale;
    try {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem('dk_can_wheel_map', JSON.stringify(_cwCfg));
    } catch (_) {
      /* ignore */
    }
    return _cwCfg;
  }

  // ─── ★端末内識別②③(オフライン・サーバー不要)★: 蓄積した捕捉から輪速IDを特定し確定したら保持+emit ───
  //   js/obd-wheelspeed-identify.js が未ロードでも安全(何もしない)。★距離計算には流さない(④は別途・司さんOK後)★。
  function _tryIdentifyWheelSpeed() {
    if (_wsMapping) return; // 既に確定済
    const ID = global.OBDWheelSpeedIdentify;
    if (!ID || !ID.identifyWheelSpeed) return; // モジュール未ロード=スキップ(既存挙動不変)
    let r;
    try {
      r = ID.identifyWheelSpeed(_wsCapturesData, { seed: global.OBDWheelSpeedMap || null });
    } catch (_) {
      return;
    }
    if (r && r.confirmed) {
      _wsMapping = r;
      try {
        // eslint-disable-next-line no-console
        console.log('[OBD-WHEELSPEED-ID] ' + JSON.stringify(r));
      } catch (_) {
        /* ignore */
      }
      _emit('probe', { wheelspeedIdentified: r });
    }
  }

  // 確定した輪速マッピングを返す(未確定は null)
  function getWheelSpeedMapping() {
    return _wsMapping;
  }
  // ★VIN別に保存済みのマッピングを外部(UI)から流し込む→次回は再discovery不要★(距離未配線)。
  function applyWheelSpeedMapping(m) {
    if (m && m.confirmed && m.id && m.key && typeof m.slope === 'number') {
      _wsMapping = m;
      _wsAuto = false; // 既に判明=discovery不要
      return true;
    }
    return false;
  }

  // ─── 速度ポーリングループ (010D を連続 query・自動輪速discovery を合間に挟む) ───
  function _startPolling() {
    if (_polling) return;
    _polling = true;
    function loop() {
      if (_stopRequested || !isConnected()) {
        _polling = false;
        return;
      }
      const t0 = _now();
      _pollCount++;
      // 1tick分の処理が終わったら次をスケジュール(両経路=通常ポーリング/自動輪速捕捉 で共有)
      function _schedNext() {
        if (_stopRequested || !isConnected()) {
          _polling = false;
          return;
        }
        // ★mid-drive 回復 (監査指摘)★: STOPPED 連発を _warmup(長timeout)で確立し直す。
        if (_consecFail >= RECOVER_AFTER && !_recovering) {
          _recovering = true;
          _consecFail = 0;
          _warmup()
            .catch(function () {
              return false;
            })
            .then(function () {
              _recovering = false;
              if (!_stopRequested && isConnected()) setTimeout(loop, POLL_MIN_INTERVAL_MS);
              else _polling = false;
            });
          return;
        }
        const elapsed = _now() - t0;
        const wait = Math.max(0, POLL_MIN_INTERVAL_MS - elapsed);
        setTimeout(loop, wait);
      }

      // ★自動輪速discovery: 条件を満たせばこのtickは輪速捕捉に充てる(010Dポーリングの代わり・ユーザー操作ゼロ)★
      //   捕捉中(~2s)は010Dが欠落するが、走行中gapはpipelineが保守fill(過大ゼロ維持)。十分集めたら自動終了。
      if (_wsCaptureDecision(_wsState(_now()))) {
        const spd = _latest.kmh;
        _captureWheelSpeed(WS_AUTO_DUR_MS, spd)
          .then(function (res) {
            _wsCaps++;
            _wsLastCapTs = _now();
            const b = _speedBin(spd);
            if (b >= 0) _wsBins[b] = 1;
            if (res && res.means) _wsCapturesData.push({ obd010d: spd, means: res.means });
            _tryIdentifyWheelSpeed(); // ★端末内で識別を試行(確定したら _wsMapping + emit)★
            if (
              _wsMapping ||
              _wsCaps >= WS_AUTO_MAX_CAPS ||
              Object.keys(_wsBins).length >= WS_AUTO_MIN_SPEED_BINS
            ) {
              _wsAuto = false; // 確定 or 十分集めた → 以降は通常ポーリングに専念
            }
          })
          .catch(function () {
            /* 捕捉失敗は致命でない・次tickで通常ポーリングに戻る */
          })
          .then(_schedNext);
        return;
      }

      // ★速度を主・odo/rpmは定期混入★: ODO_POLL_EVERY ごとに 01A6、RPM_POLL_EVERY ごとに 010C を1回。
      const _isOdoPoll = _odoSupported && _pollCount % ODO_POLL_EVERY === 0;
      // ★0131(ECU距離)診断ポーリング★: odoと衝突時はodo優先。記録専用・距離未配線。
      const _isDistPoll = !_isOdoPoll && _dist0131Supported && _pollCount % DIST_POLL_EVERY === 0;
      const _isRpmPoll = !_isOdoPoll && !_isDistPoll && _pollCount % RPM_POLL_EVERY === 0; // odo/distと衝突時は優先
      const _cmd = _isOdoPoll ? ODO_PID : _isDistPoll ? DIST_PID : _isRpmPoll ? RPM_PID : SPEED_PID;
      _send(_cmd)
        .then(function (resp) {
          if (_isOdoPoll) {
            const km = _parseOdometerKm(resp);
            if (km != null) {
              _latestOdo = { km: km, ts: _now() };
              _consecFail = 0;
            }
          } else if (_isDistPoll) {
            const dkm = _parseDistKm(resp);
            if (dkm != null) {
              _latest0131 = { km: dkm, ts: _now() }; // 記録専用(距離計算には未配線)
              _consecFail = 0;
            }
          } else if (_isRpmPoll) {
            const rpm = _parseRpm(resp);
            if (rpm != null) {
              _latestRpm = { rpm: rpm, ts: _now() }; // 記録専用(距離計算には未配線)
              _consecFail = 0;
            }
          } else {
            const kmh = _parseSpeedKmh(resp);
            if (kmh != null) {
              const _spdTs = _now();
              const _mps = kmh / 3.6;
              // ★生OBD∫v(faithful)積算★: Σ speed×dt をポーリングレートで。gap(dt>5s)は除外し過大化を防ぐ。
              //   記録専用・距離計算には未配線。
              if (_obdIntegralLastTs > 0) {
                const _dt = (_spdTs - _obdIntegralLastTs) / 1000;
                if (_dt > 0 && _dt < 5) _obdIntegralM += _mps * _dt;
              }
              _obdIntegralLastTs = _spdTs;
              _latest = { kmh: kmh, mps: _mps, ts: _spdTs };
              _emit('speed', getSpeed());
              _consecFail = 0; // 正常応答 → 失敗カウンタ reset
            } else {
              _consecFail++; // NO DATA / STOPPED / 別PID = 通信不全
            }
          }
        })
        .catch(function () {
          _consecFail++; // timeout = 通信不全
        })
        .then(_schedNext);
    }
    loop();
  }

  function _onDisconnected() {
    _setStatus('disconnected');
    _polling = false;
    _latest = { kmh: -1, mps: -1, ts: 0 };
    _latestOdo = { km: -1, ts: 0 };
    _odoSupported = false;
    _latest0131 = { km: -1, ts: 0 };
    _dist0131Supported = false;
    _obdIntegralM = 0;
    _obdIntegralLastTs = 0;
    _latestRpm = { rpm: -1, ts: 0 };
    _pollCount = 0;
    _consecFail = 0;
    _recovering = false;
    _capturing = false; // 切断時に捕捉中フラグを残さない(次接続のnotify誤ルーティング防止)
    _wsAuto = false; // 自動discovery停止(次接続で再有効化)
    _wsCapturesData = [];
    _wsMapping = null;
    // ★監査M1/M2: CAN輪速メーター(バースト)の畳み込み(_capturingと対称化)★。これが無いと切断後も
    //   バーストtimerが残り、_cwOn=true残存で再接続後のループ/捕捉が本番ポーリング(distance_m速度源)を
    //   横取りする。_stopRequested は ★再接続ガード(下記)評価より前★ に戻す。
    if (_cwBurstTimer) {
      clearTimeout(_cwBurstTimer);
      _cwBurstTimer = null;
    }
    _cwBurstGen++; // in-flight捕捉の完了クリアを無効化
    _cwBurstInflight = false;
    if (_cwStarting) {
      _cwStarting = false; // プリアンブル中の切断でフラグを残さない
      _stopRequested = _cwWasStop;
    }
    if (_cwOn) {
      _cwOn = false;
      _stopRequested = _cwWasStop; // start が立てた抑止を解除=自動再接続を殺さない
    }
    // ★M-2 監査修正: 予期せぬ切断で in-flight の _send が宙吊りになるのを防ぐ。
    //   pending timer/resolver/バッファを明示解放(明示 disconnect() の _cleanup と同等)。
    if (_pendingTimer) {
      clearTimeout(_pendingTimer);
      _pendingTimer = null;
    }
    if (_pendingResolve) {
      const r = _pendingResolve;
      _pendingResolve = null;
      r(''); // 空応答で解放 → 呼び出し側は parse 失敗で無視(次ループは isConnected=false で停止)
    }
    _rxBuffer = '';
    // ★自動再接続 (2026-06-18)★: 明示 disconnect() 以外の切断(走行中の瞬断/圏外/スリープ復帰)は
    //   同一デバイスへバックオフ再接続。明示切断(_stopRequested)は再接続しない(電池/混乱防止)。
    if (!_stopRequested && _autoReconnect && _device) _scheduleReconnect();
  }

  function _scheduleReconnect() {
    if (_reconnecting) return;
    _reconnecting = true;
    let attempt = 0;
    const tryOnce = function () {
      if (_stopRequested || isConnected()) {
        _reconnecting = false;
        return;
      }
      attempt++;
      _establishWith(_device)
        .then(function () {
          _reconnecting = false; // 復帰成功
        })
        .catch(function () {
          if (!_stopRequested && attempt < OBD_RECONNECT_MAX) {
            setTimeout(tryOnce, Math.min(8000, _reconnectDelayMs * attempt));
          } else {
            _reconnecting = false;
          }
        });
    };
    setTimeout(tryOnce, _reconnectDelayMs);
  }

  function disconnect() {
    _stopRequested = true;
    _polling = false;
    try {
      if (_notifyChar) _notifyChar.removeEventListener('characteristicvaluechanged', _onNotify);
    } catch (_) {
      /* ignore */
    }
    try {
      if (_server && _server.connected) _server.disconnect();
    } catch (_) {
      /* ignore */
    }
    _cleanup();
    _setStatus('idle');
  }
  function _cleanup() {
    _server = null;
    _writeChar = null;
    _notifyChar = null;
    _rxBuffer = '';
    if (_pendingTimer) {
      clearTimeout(_pendingTimer);
      _pendingTimer = null;
    }
    _pendingResolve = null;
    // ★監査M1: 明示disconnect経路でもCAN輪速(バースト)を畳む(状態leak/timer leak防止)★
    if (_cwBurstTimer) {
      clearTimeout(_cwBurstTimer);
      _cwBurstTimer = null;
    }
    _cwOn = false;
    _cwStarting = false;
    _cwBurstGen++;
    _cwBurstInflight = false;
    _capturing = false; // ★監査MINOR: _onDisconnected と対称化★
  }

  function on(event, cb) {
    if (_listeners[event] && typeof cb === 'function') _listeners[event].push(cb);
  }

  global.OBDClient = {
    isSupported: isSupported,
    connect: connect,
    tryAutoConnect: tryAutoConnect, // ★起動時 自動接続(前回ペアリング済みデバイス・選択ダイアログ無し)★
    disconnect: disconnect,
    setAutoReconnect: function (v) {
      _autoReconnect = v !== false;
    },
    _setReconnectDelayForTest: function (ms) {
      if (typeof ms === 'number' && ms >= 0) _reconnectDelayMs = ms;
    },
    isConnected: isConnected,
    getSpeed: getSpeed,
    getOdometer: getOdometer,
    getDistanceSinceClear: getDistanceSinceClear, // ★0131 ECU距離(1km粗・記録専用・距離未配線)★
    getObdIntegral: getObdIntegral, // ★生OBD∫v(faithful・ポーリングレート積分・記録専用・距離未配線)★
    getRpm: getRpm,
    speedProvider: speedProvider,
    getStatus: getStatus,
    probeWheelSpeed: probeWheelSpeed, // ★ABS各輪速 read-only プローブ(距離未配線)★
    canBusProbe: canBusProbe, // ★CAN見えるかチェック(停車・read-only・距離不可侵)★
    startCanWheelMeter: startCanWheelMeter, // ★CAN輪速メーター開始(1B8連続積分・read-only・距離不可侵)★
    stopCanWheelMeter: stopCanWheelMeter,
    getCanWheelMeter: getCanWheelMeter,
    configCanWheel: configCanWheel, // 輪速ID/バイト/スケール設定(VIN別localStorage)
    setWheelSpeedDiscovery: setWheelSpeedDiscovery, // ★輪速診断モード手動ON/OFF(診断走行専用・既定OFF)★
    getWheelSpeedMapping: getWheelSpeedMapping, // 端末内で確定した輪速マッピング(未確定null)
    applyWheelSpeedMapping: applyWheelSpeedMapping, // VIN別保存マッピングを流し込む(再discovery不要)
    on: on,
    // 単体テスト/デバッグ用 (純関数)
    _parseSpeedKmh: _parseSpeedKmh,
    _parseOdometerKm: _parseOdometerKm,
    _parseDistKm: _parseDistKm, // ★0131 ECU距離パース(単体テスト用)★
    _parseRpm: _parseRpm,
    _parseMonitorFrames: _parseMonitorFrames,
    _summarizeFrames: _summarizeFrames,
    _classifyCanProbe: _classifyCanProbe, // ★CAN可視性判定(純関数・単体テスト用)★
    _decodeCanWheelKmh: _decodeCanWheelKmh, // ★CAN輪速デコード(純関数・単体テスト用)★
    _cwIntegrateStep: _cwIntegrateStep, // ★CAN輪速積分1ステップ(純関数・単体テスト用)★
    _cwWindowSpeed: _cwWindowSpeed, // ★バースト窓速度=中央値(純関数・単体テスト用)★
    _wsCaptureDecision: _wsCaptureDecision, // ★自動輪速discovery判定(純関数・単体テスト用)★
    _speedBin: _speedBin,
    _decodeProbe: _decodeProbe,
    _PROBE_QUERIES: PROBE_QUERIES,
    _PROFILES: PROFILES,
    _SPEED_STALE_MS: SPEED_STALE_MS,
  };
})(
  typeof window !== 'undefined'
    ? window
    : typeof self !== 'undefined'
      ? self
      : typeof globalThis !== 'undefined'
        ? globalThis
        : this
);
