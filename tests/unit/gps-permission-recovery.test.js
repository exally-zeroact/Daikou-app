// tests/unit/gps-permission-recovery.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step P1-⑥ / 全32件)
//
// 検証対象: gps.js GPS permission denied → retryWatch 動作
//   L24  _MAX_RETRY = 3
//   L25  _RETRY_INTERVAL_MS = 10000
//   L72  retryWatch(): watchId null なら return false・geolocation 未対応も false
//   L710 onError(err): code=1 PERMISSION_DENIED で setStatus('denied') + setTimeout(retryWatch, 10s)
//                      code=2 POSITION_UNAVAILABLE 同様 retry
//                      code=3 TIMEOUT は watchPosition が継続するので retry なし
//
// 絶対ルール準拠:
//   js/gps.js は触らない absolute・本 test は vm sandbox で navigator/setTimeout を mock。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GPS_JS_PATH = path.join(__dirname, '..', '..', 'js', 'gps.js');

function makeCtx() {
  const ctx = {
    console: console,
    Date: Date,
    Math: Math,
    Float32Array: Float32Array,
    Float64Array: Float64Array,
    Int32Array: Int32Array,
    Uint8Array: Uint8Array,
    Uint16Array: Uint16Array,
    Uint32Array: Uint32Array,
    Worker: undefined, // Worker fallback path 強制
    dlog: () => {},
    alert: () => {},
    document: { addEventListener: () => {} },
    DeviceOrientationEvent: undefined, // permission 不要 path
    DeviceMotionEvent: undefined,
    performance: { now: () => Date.now() },
  };
  // window/global/self 自己参照
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  // addEventListener mock (= startCompass/startMotion 用)
  ctx._eventListeners = [];
  ctx.addEventListener = (type, fn) => {
    ctx._eventListeners.push({ type, fn });
  };
  ctx.removeEventListener = () => {};
  // navigator + geolocation mock
  ctx._capturedOnError = null;
  ctx._capturedOnPosition = null;
  ctx._watchPositionCalls = 0;
  ctx._clearWatchCalls = 0;
  ctx.navigator = {
    geolocation: {
      watchPosition(onPos, onErr /* opts */) {
        ctx._capturedOnError = onErr;
        ctx._capturedOnPosition = onPos;
        ctx._watchPositionCalls++;
        return ctx._watchPositionCalls;
      },
      clearWatch() {
        ctx._clearWatchCalls++;
      },
    },
    userAgent: 'test',
  };
  // setTimeout mock (= timer capture)
  ctx._timers = [];
  ctx.setTimeout = (fn, ms) => {
    ctx._timers.push({ fn, ms });
    return ctx._timers.length;
  };
  ctx.clearTimeout = () => {};
  ctx.setInterval = () => 'iv';
  ctx.clearInterval = () => {};
  vm.createContext(ctx);
  return ctx;
}

function loadGps(ctx) {
  const src = fs.readFileSync(GPS_JS_PATH, 'utf8') + '\n;globalThis.GPS = GPS;\n';
  vm.runInContext(src, ctx, { filename: 'js/gps.js' });
  return ctx.GPS;
}

describe('gps.js permission denied → retryWatch (P1-⑥)', () => {
  let ctx, GPS;
  beforeEach(() => {
    ctx = makeCtx();
    GPS = loadGps(ctx);
  });

  it('GPS.start() で navigator.geolocation.watchPosition が呼ばれる', () => {
    GPS.start(() => {});
    expect(ctx._watchPositionCalls).toBe(1);
    expect(typeof ctx._capturedOnError).toBe('function');
  });

  it('retryWatch(): watchId=null (= start 前) は false', () => {
    expect(GPS.retryWatch()).toBe(false);
  });

  it('PERMISSION_DENIED (code=1) → status=denied + setTimeout 1 件追加', () => {
    GPS.start(() => {});
    expect(ctx._timers.length).toBe(0);
    ctx._capturedOnError({ code: 1, message: 'permission denied' });
    const status = GPS.getStatus();
    expect(status.state).toBe('denied');
    expect(status.retryCount).toBe(1);
    expect(ctx._timers.length).toBe(1);
    expect(ctx._timers[0].ms).toBe(10000); // _RETRY_INTERVAL_MS
  });

  it('POSITION_UNAVAILABLE (code=2) → status=unavailable + setTimeout 1 件追加', () => {
    GPS.start(() => {});
    ctx._capturedOnError({ code: 2, message: 'position unavailable' });
    const status = GPS.getStatus();
    expect(status.state).toBe('unavailable');
    expect(status.retryCount).toBe(1);
    expect(ctx._timers.length).toBe(1);
  });

  it('TIMEOUT (code=3) → status=timeout + setTimeout 追加なし (= watchPosition 継続)', () => {
    GPS.start(() => {});
    ctx._capturedOnError({ code: 3, message: 'timeout' });
    const status = GPS.getStatus();
    expect(status.state).toBe('timeout');
    expect(ctx._timers.length).toBe(0); // timeout はリトライ不要
  });

  it('PERMISSION_DENIED 3 回連続 → setTimeout 3 件追加・retryCount=3', () => {
    GPS.start(() => {});
    for (let i = 0; i < 3; i++) {
      ctx._capturedOnError({ code: 1, message: 'denied' });
    }
    expect(GPS.getStatus().retryCount).toBe(3);
    expect(ctx._timers.length).toBe(3);
  });

  it('PERMISSION_DENIED 4 回目 → retryCount は _MAX_RETRY=3 で打ち止め・新 setTimeout なし', () => {
    GPS.start(() => {});
    for (let i = 0; i < 4; i++) {
      ctx._capturedOnError({ code: 1, message: 'denied' });
    }
    // retryCount は 3 で頭打ち
    expect(GPS.getStatus().retryCount).toBe(3);
    // setTimeout は 3 件のみ (= 4 回目は追加されない)
    expect(ctx._timers.length).toBe(3);
  });

  it('retryWatch() 実行で watchPosition が再呼出される (= clearWatch + watchPosition)', () => {
    GPS.start(() => {});
    expect(ctx._watchPositionCalls).toBe(1);
    expect(ctx._clearWatchCalls).toBe(0);

    const ok = GPS.retryWatch();
    expect(ok).toBe(true);
    expect(ctx._clearWatchCalls).toBe(1);
    expect(ctx._watchPositionCalls).toBe(2);
  });

  it('PERMISSION_DENIED → setTimeout 経由で自動 retryWatch シミュレート', () => {
    GPS.start(() => {});
    ctx._capturedOnError({ code: 1, message: 'denied' });
    expect(ctx._timers.length).toBe(1);
    // setTimeout の fn (= retryWatch) を手動実行
    ctx._timers[0].fn();
    // retryWatch 結果として watchPosition 再呼出
    expect(ctx._watchPositionCalls).toBe(2);
  });

  it('onPosition (= GPS 取得成功) で status=granted + retryCount=0 reset', () => {
    GPS.start(() => {});
    // まず PERMISSION_DENIED で retryCount を上げる
    ctx._capturedOnError({ code: 1, message: 'denied' });
    expect(GPS.getStatus().retryCount).toBe(1);
    // 復帰: onPosition 呼出
    ctx._capturedOnPosition({
      coords: {
        latitude: 33.84,
        longitude: 132.7656,
        accuracy: 5,
        speed: 0,
        heading: null,
        altitude: 0,
      },
      timestamp: Date.now(),
    });
    expect(GPS.getStatus().state).toBe('granted');
    expect(GPS.getStatus().retryCount).toBe(0); // reset
  });

  it('onStatusChange listener が状態変化時に通知される', () => {
    GPS.start(() => {});
    const captured = [];
    GPS.onStatusChange((s) => captured.push(s.state));
    // 登録直後に 1 回通知 (= 現在状態)
    expect(captured.length).toBe(1);
    ctx._capturedOnError({ code: 1, message: 'denied' });
    // denied に状態変化 → 通知
    expect(captured.length).toBe(2);
    expect(captured[1]).toBe('denied');
  });

  it('GPS.getStatus() の lastError に code/message が記録される', () => {
    GPS.start(() => {});
    ctx._capturedOnError({ code: 1, message: 'Test denial' });
    const status = GPS.getStatus();
    expect(status.lastError).toBeDefined();
    expect(status.lastError.code).toBe(1);
    expect(status.lastError.message).toBe('Test denial');
    expect(typeof status.lastErrorAt).toBe('number');
  });
});
