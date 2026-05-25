// tests/unit/gps-sensor-permission.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step P2-⑫ / 全32件・P2 完了)
//
// 検証対象: gps.js startCompass / startMotion
//   L140 startCompass: DeviceOrientationEvent 対応 + dedup (_compassListenerAdded) +
//                      iOS 13+ permission (_compassGranted) + Android 即追加
//   L218 startMotion: 同様 DeviceMotionEvent + dedup (_motionListenerAdded)
//
// 絶対ルール準拠:
//   js/gps.js は触らない absolute・vm sandbox で window.addEventListener mock。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GPS_JS_PATH = path.join(__dirname, '..', '..', 'js', 'gps.js');

function makeCtx(opts) {
  opts = opts || {};
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
    Worker: undefined,
    dlog: () => {},
    alert: () => {},
    document: { addEventListener: () => {} },
    performance: { now: () => Date.now() },
  };
  // DeviceOrientationEvent / DeviceMotionEvent mock
  ctx.DeviceOrientationEvent = opts.hasOrientation
    ? opts.hasIosPermission
      ? { requestPermission: () => Promise.resolve('granted') }
      : {}
    : undefined;
  ctx.DeviceMotionEvent = opts.hasMotion
    ? opts.hasIosPermission
      ? { requestPermission: () => Promise.resolve('granted') }
      : {}
    : undefined;
  ctx._compassGranted = opts.compassGranted !== false;
  ctx._motionGranted = opts.motionGranted !== false;
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx._eventListeners = [];
  ctx.addEventListener = (type, fn) => {
    ctx._eventListeners.push({ type, fn });
  };
  ctx.removeEventListener = () => {};
  // navigator + geolocation mock (= start() で必要)
  ctx.navigator = {
    geolocation: {
      watchPosition: () => 1,
      clearWatch: () => {},
    },
    userAgent: 'test',
  };
  ctx.setTimeout = () => 1;
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

describe('gps.js startCompass / startMotion (P2-⑫)', () => {
  // ─── startCompass ────────────────────────────────────────

  it('S1: window.DeviceOrientationEvent 未対応 → リスナー追加なし', () => {
    const ctx = makeCtx({ hasOrientation: false });
    const GPS = loadGps(ctx);
    const before = ctx._eventListeners.length;
    GPS.startCompass();
    const after = ctx._eventListeners.filter((e) => e.type === 'deviceorientation').length;
    expect(after).toBe(0);
    expect(ctx._eventListeners.length).toBe(before); // 変化なし
  });

  it('S2: Android (iOS permission API なし) → deviceorientation listener 即追加', () => {
    const ctx = makeCtx({ hasOrientation: true, hasIosPermission: false });
    const GPS = loadGps(ctx);
    GPS.startCompass();
    const compassListeners = ctx._eventListeners.filter((e) => e.type === 'deviceorientation');
    expect(compassListeners.length).toBe(1);
  });

  it('S3: iOS 13+ permission granted=true → listener 追加', () => {
    const ctx = makeCtx({ hasOrientation: true, hasIosPermission: true, compassGranted: true });
    const GPS = loadGps(ctx);
    GPS.startCompass();
    const compassListeners = ctx._eventListeners.filter((e) => e.type === 'deviceorientation');
    expect(compassListeners.length).toBe(1);
  });

  it('S4: iOS 13+ permission granted=false → listener 追加なし (fallback)', () => {
    const ctx = makeCtx({ hasOrientation: true, hasIosPermission: true, compassGranted: false });
    const GPS = loadGps(ctx);
    GPS.startCompass();
    const compassListeners = ctx._eventListeners.filter((e) => e.type === 'deviceorientation');
    expect(compassListeners.length).toBe(0);
  });

  it('S5: startCompass 重複呼出で deviceorientation listener が 1 件 dedup', () => {
    const ctx = makeCtx({ hasOrientation: true, hasIosPermission: false });
    const GPS = loadGps(ctx);
    GPS.startCompass();
    GPS.startCompass();
    GPS.startCompass();
    const compassListeners = ctx._eventListeners.filter((e) => e.type === 'deviceorientation');
    expect(compassListeners.length).toBe(1); // dedup
  });

  // ─── startMotion ────────────────────────────────────────

  it('M1: window.DeviceMotionEvent 未対応 → リスナー追加なし', () => {
    const ctx = makeCtx({ hasMotion: false });
    const GPS = loadGps(ctx);
    GPS.startMotion();
    const motionListeners = ctx._eventListeners.filter((e) => e.type === 'devicemotion');
    expect(motionListeners.length).toBe(0);
  });

  it('M2: Android → devicemotion listener 即追加', () => {
    const ctx = makeCtx({ hasMotion: true, hasIosPermission: false });
    const GPS = loadGps(ctx);
    GPS.startMotion();
    const motionListeners = ctx._eventListeners.filter((e) => e.type === 'devicemotion');
    expect(motionListeners.length).toBe(1);
  });

  it('M3: iOS 13+ permission granted → listener 追加', () => {
    const ctx = makeCtx({ hasMotion: true, hasIosPermission: true, motionGranted: true });
    const GPS = loadGps(ctx);
    GPS.startMotion();
    const motionListeners = ctx._eventListeners.filter((e) => e.type === 'devicemotion');
    expect(motionListeners.length).toBe(1);
  });

  it('M4: iOS 13+ permission denied → listener 追加なし', () => {
    const ctx = makeCtx({ hasMotion: true, hasIosPermission: true, motionGranted: false });
    const GPS = loadGps(ctx);
    GPS.startMotion();
    const motionListeners = ctx._eventListeners.filter((e) => e.type === 'devicemotion');
    expect(motionListeners.length).toBe(0);
  });

  it('M5: startMotion 重複呼出で devicemotion listener が 1 件 dedup', () => {
    const ctx = makeCtx({ hasMotion: true, hasIosPermission: false });
    const GPS = loadGps(ctx);
    GPS.startMotion();
    GPS.startMotion();
    const motionListeners = ctx._eventListeners.filter((e) => e.type === 'devicemotion');
    expect(motionListeners.length).toBe(1);
  });

  // ─── 統合: GPS.start 経由 ────────────────────────────

  it('I1: GPS.start() で startCompass + startMotion が呼ばれる (Android 環境)', () => {
    const ctx = makeCtx({ hasOrientation: true, hasMotion: true, hasIosPermission: false });
    const GPS = loadGps(ctx);
    GPS.start(() => {});
    const compass = ctx._eventListeners.filter((e) => e.type === 'deviceorientation');
    const motion = ctx._eventListeners.filter((e) => e.type === 'devicemotion');
    expect(compass.length).toBe(1);
    expect(motion.length).toBe(1);
  });

  it('I2: GPS._debug() で compassListenerAdded / motionListenerAdded を取得可能', () => {
    const ctx = makeCtx({ hasOrientation: true, hasMotion: true, hasIosPermission: false });
    const GPS = loadGps(ctx);
    expect(GPS._debug().compassListenerAdded).toBe(false);
    expect(GPS._debug().motionListenerAdded).toBe(false);
    GPS.start(() => {});
    expect(GPS._debug().compassListenerAdded).toBe(true);
    expect(GPS._debug().motionListenerAdded).toBe(true);
  });

  it('I3: GPS.start() を複数回呼んでも listener は 1 件のみ (dedup 動作)', () => {
    const ctx = makeCtx({ hasOrientation: true, hasMotion: true, hasIosPermission: false });
    const GPS = loadGps(ctx);
    GPS.start(() => {});
    GPS.start(() => {});
    GPS.start(() => {});
    const compass = ctx._eventListeners.filter((e) => e.type === 'deviceorientation');
    const motion = ctx._eventListeners.filter((e) => e.type === 'devicemotion');
    expect(compass.length).toBe(1);
    expect(motion.length).toBe(1);
  });
});
