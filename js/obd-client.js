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
  // ★RPM 記録 (2026-06-11)★: Mode01 PID 0C = Engine RPM(0.25rpm刻み=速度の1km/h floorより遥かに高解像度)。
  //   OBD車速は1km/h整数floorで∫vが系統過小(-2.9%)。RPM(高解像度)+ギア比学習で細かい速度を復元すれば
  //   floor過小を ★根から★ 消せる(US9679422 等の公知手法)。本コミットでは ★記録のみ★(距離計算には未配線)。
  //   次走行traceに rpm を残し、オフラインでギア比学習法を実データ検証可能にする。010C は1996年以降ほぼ全車対応の標準PID。
  const RPM_PID = '010C'; // Mode 01 PID 0C = Engine RPM ((256A+B)/4 rpm・2 byte)
  const RPM_POLL_EVERY = 10; // 速度ポーリング10回に1回 010C を混ぜる(速度主ポーリングをほぼ邪魔しない)
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
  let _latestRpm = { rpm: -1, ts: 0 }; // ★最新エンジンRPM(010C・-1=未取得)。記録専用・距離計算には未配線★
  let _pollCount = 0;
  let _consecFail = 0; // 速度ポーリングの連続失敗数(mid-drive 回復トリガー)
  let _recovering = false; // _warmup 再確立中フラグ(多重起動防止)
  let _rxBuffer = '';
  let _pendingResolve = null; // 現コマンドの応答待ち resolver
  let _pendingTimer = null;
  let _polling = false;
  let _stopRequested = false;
  const _listeners = { status: [], speed: [], error: [], probe: [] };

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
        _device = device;
        device.addEventListener('gattserverdisconnected', _onDisconnected);
        return device.gatt.connect();
      })
      .then(function (server) {
        _server = server;
        return _findProfile(server);
      })
      .then(function () {
        return _initElm();
      })
      .then(function () {
        _setStatus('connected');
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
        _startPolling();
        return true;
      })
      .catch(function (e) {
        _setStatus('error');
        _emit('error', (e && e.message) || String(e));
        _cleanup();
        throw e;
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
      } catch (_) {
        /* decode 失敗は無視 (raw があれば解析可能) */
      }
      global.OBD_PROBE_RESULT = results;
      try {
        // eslint-disable-next-line no-console
        console.log('[OBD-PROBE] ' + JSON.stringify(results));
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
      if (h && h.length >= 4 && /^[0-9A-F]{4}/.test(h))
        out.dist_since_clear_km = parseInt(h.substr(0, 4), 16);
    }
    return out;
  }

  // ─── 速度ポーリングループ (010D を連続 query) ───
  function _startPolling() {
    if (_polling) return;
    _polling = true;
    function loop() {
      if (_stopRequested || !isConnected()) {
        _polling = false;
        return;
      }
      const t0 = _now();
      // ★速度を主・odo/rpmは定期混入★: odo対応かつ ODO_POLL_EVERY ごとに 01A6、RPM_POLL_EVERY ごとに 010C を1回叩く。
      _pollCount++;
      const _isOdoPoll = _odoSupported && _pollCount % ODO_POLL_EVERY === 0;
      const _isRpmPoll = !_isOdoPoll && _pollCount % RPM_POLL_EVERY === 0; // odoと衝突時はodo優先
      const _cmd = _isOdoPoll ? ODO_PID : _isRpmPoll ? RPM_PID : SPEED_PID;
      _send(_cmd)
        .then(function (resp) {
          if (_isOdoPoll) {
            const km = _parseOdometerKm(resp);
            if (km != null) {
              _latestOdo = { km: km, ts: _now() };
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
              _latest = { kmh: kmh, mps: kmh / 3.6, ts: _now() };
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
        .then(function () {
          if (_stopRequested || !isConnected()) {
            _polling = false;
            return;
          }
          // ★mid-drive 回復 (監査指摘)★: 走行中にプロトコルが落ちて STOPPED 連発したら、
          //   1.5s 010D を撃ち続けて検出を毎回中断する thrash を止め、_warmup(長timeout)で確立し直す。
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
        });
    }
    loop();
  }

  function _onDisconnected() {
    _setStatus('disconnected');
    _polling = false;
    _latest = { kmh: -1, mps: -1, ts: 0 };
    _latestOdo = { km: -1, ts: 0 };
    _odoSupported = false;
    _latestRpm = { rpm: -1, ts: 0 };
    _pollCount = 0;
    _consecFail = 0;
    _recovering = false;
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
    // 自動再接続は呼び出し側(UI)の判断に委ねる (勝手に再接続して電池/混乱を招かない)
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
  }

  function on(event, cb) {
    if (_listeners[event] && typeof cb === 'function') _listeners[event].push(cb);
  }

  global.OBDClient = {
    isSupported: isSupported,
    connect: connect,
    disconnect: disconnect,
    isConnected: isConnected,
    getSpeed: getSpeed,
    getOdometer: getOdometer,
    getRpm: getRpm,
    speedProvider: speedProvider,
    getStatus: getStatus,
    on: on,
    // 単体テスト/デバッグ用 (純関数)
    _parseSpeedKmh: _parseSpeedKmh,
    _parseOdometerKm: _parseOdometerKm,
    _parseRpm: _parseRpm,
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
