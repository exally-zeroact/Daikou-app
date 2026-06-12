// tests/integration/deadcode-and-accelbuffer-drain.test.js
//
// ★STEP0 テストツール先行 (2026-05-30・clean-rebuild-pipeline 白紙プラン残項目用)★
//
// 本 test は「死コード一掃 (plan §4)」「accelBuffer drain bug (plan §1-A)」
// 「mm-data-pipeline 47県 ready gate (plan §3-1)」の回帰を捕捉する invariant 群。
// 実装役がこれらを変更したとき、既存資産 (9677 bit / creep0 / 互換契約) を
// 壊していないかを機械的に検出する。
//
// 既存ゲートとの棲み分け (= 穴の補填):
//   ・worker/gps-worker-unit.test.js は accelSamples を worker へ「直接」注入するため、
//     gps.js main-thread の throttle 早期 return 時に accelBuffer が drain されず
//     古いサンプルが次回送信に混入する bug (plan §1-A) を捕捉できない。→ B 群で補填。
//   ・stationary-real-pipeline.spec.js は accel を「注入しない」位置半径 fallback 経路のみ
//     なので accel-variance branch の汚染も捕捉できない。→ B 群で補填。
//   ・isMmReady() / resume() は REWRITE-SHAPE-REPORT で「死コード候補」と記載されるが、
//     実際は meter-batch8-cleanup / meter-batch5-nocov が CALL している (= 削除すると
//     vitest が赤)。削除前 grep 義務の機械化 → A 群で「契約として残すべき API」を固定。
//
// 絶対ルール準拠: js/*.js 本体は本 test では 1 byte も変更しない (= 検査のみ)。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const GPS_JS_PATH = path.join(ROOT, 'js', 'gps.js');
const METER_JS_PATH = path.join(ROOT, 'js', 'meter.js');

// ─────────────────────────────────────────────────────────────
// A 群: 死コード削除の安全性 — 「呼ばれている API は残す」契約を固定
// ─────────────────────────────────────────────────────────────
describe('A: 死コード削除の安全網 (= 呼出 0 件実証してから消す・呼ばれてるなら残す)', () => {
  // tests/ 配下の参照を静的に走査 (= 削除可否の grep 自動化)
  function readAllTestSources() {
    const dirs = [path.join(ROOT, 'tests'), path.join(ROOT, 'js')];
    const files = [];
    function walk(d) {
      for (const name of fs.readdirSync(d)) {
        const p = path.join(d, name);
        const st = fs.statSync(p);
        if (st.isDirectory()) {
          if (name === 'node_modules' || name === 'baselines' || name === 'fixtures') continue;
          walk(p);
        } else if (/\.(js|test\.js|spec\.js)$/.test(name)) {
          files.push(p);
        }
      }
    }
    dirs.forEach(walk);
    return files.map((f) => ({ f, src: fs.readFileSync(f, 'utf8') }));
  }

  const sources = readAllTestSources();

  function refCount(token) {
    // token を「.token(」「.token =」「token(」呼出として数える (= export 経由含む)
    let n = 0;
    const re = new RegExp('[.\\b]' + token + '\\s*(\\(|=[^=])', 'g');
    for (const { f, src } of sources) {
      // 定義元 (meter.js / gps.js) 内の宣言行は数えない: 呼出のみ数える
      const isDefFile = f.endsWith('meter.js') || f.endsWith('gps.js');
      const lines = src.split('\n');
      for (const line of lines) {
        if (isDefFile && /^\s*function\s+/.test(line)) continue;
        const m = line.match(re);
        if (m) n += m.length;
      }
    }
    return n;
  }

  it('Meter.isMmReady は外部 (tests) から呼ばれている → 削除不可・残す契約', () => {
    // meter-batch8-cleanup.test.js が Meter.isMmReady() を assert している
    expect(refCount('isMmReady')).toBeGreaterThan(0);
  });

  it('Meter.resume は外部 (tests) から呼ばれている → 削除不可・残す契約', () => {
    // meter-batch5-nocov.test.js が Meter.resume() を呼ぶ
    // (Business.resume() とは別物・混同して両方消さないこと)
    expect(refCount('resume')).toBeGreaterThan(0);
  });

  it('setVehicleType / getVehicleType は車種UI契約 → 残す', () => {
    const meterSrc = fs.readFileSync(METER_JS_PATH, 'utf8');
    expect(/setVehicleType/.test(meterSrc)).toBe(true);
    expect(/getVehicleType/.test(meterSrc)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// C 群: getState 互換 stub field は 0 固定で残す (= 消費者契約)
// ─────────────────────────────────────────────────────────────
describe('C: getState 互換 stub field (gps_predictive_distance_m / mm_distance_m) は残す', () => {
  const meterSrc = fs.readFileSync(METER_JS_PATH, 'utf8');
  it('gps_predictive_distance_m field が state / getState に存在', () => {
    expect(/gps_predictive_distance_m/.test(meterSrc)).toBe(true);
  });
  it('mm_distance_m field が getState に存在', () => {
    expect(/mm_distance_m/.test(meterSrc)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// B 群: gps.js accelBuffer / gyroBuffer drain — throttle 早期 return 時の汚染遮断
// ─────────────────────────────────────────────────────────────
describe('B: accelBuffer drain bug (plan §1-A) — throttle 早期 return で古い accel を持ち越さない', () => {
  // GPS_MIN_SEND_INTERVAL_MS = 700 を前提に時刻を制御する (= 各 case で t0+offset を直接指定)

  function makeCtx() {
    let nowMs = 1_700_000_000_000;
    const ctx = {
      console,
      Math,
      JSON,
      Float32Array,
      Float64Array,
      Int32Array,
      Uint8Array,
      Uint16Array,
      Uint32Array,
      // Date.now を制御可能に (= throttle 判定の now を固定)
      Date: class extends Date {
        static now() {
          return nowMs;
        }
      },
      performance: { now: () => nowMs },
      dlog: () => {},
      alert: () => {},
      DEBUG: { enabled: false },
      DeviceMotionEvent: function () {},
      DeviceOrientationEvent: undefined,
      document: { addEventListener: () => {} },
      setTimeout: () => 0,
      clearTimeout: () => {},
      setInterval: () => 'iv',
      clearInterval: () => {},
    };
    ctx.window = ctx;
    ctx.globalThis = ctx;
    ctx.self = ctx;

    // devicemotion listener 捕捉
    ctx._motionFn = null;
    ctx.addEventListener = (type, fn) => {
      if (type === 'devicemotion') ctx._motionFn = fn;
    };
    ctx.removeEventListener = () => {};

    // Worker mock (= useWorker=true 経路を有効化・postMessage payload 捕捉)
    ctx._sent = [];
    ctx.Worker = class {
      constructor() {}
      postMessage(msg) {
        ctx._sent.push(msg);
      }
      addEventListener() {}
      terminate() {}
      set onmessage(_) {}
      set onerror(_) {}
    };

    // geolocation mock
    ctx._capturedOnPosition = null;
    ctx.navigator = {
      userAgent: 'test',
      geolocation: {
        watchPosition(onPos) {
          ctx._capturedOnPosition = onPos;
          return 1;
        },
        clearWatch() {},
      },
    };

    ctx._setNow = (t) => {
      nowMs = t;
    };
    ctx._getNow = () => nowMs;
    vm.createContext(ctx);
    return ctx;
  }

  function loadGps(ctx) {
    const src = fs.readFileSync(GPS_JS_PATH, 'utf8') + '\n;globalThis.GPS = GPS;\n';
    vm.runInContext(src, ctx, { filename: 'js/gps.js' });
    return ctx.GPS;
  }

  function fireMotion(ctx, n, tagBase) {
    // n 個の accel サンプルを devicemotion で push (= 各々一意な x で識別)
    for (let i = 0; i < n; i++) {
      ctx._motionFn({
        accelerationIncludingGravity: { x: tagBase + i, y: 0, z: 9.8 },
        rotationRate: { alpha: tagBase + i, beta: 0, gamma: 0 },
      });
    }
  }

  function firePosition(ctx, lat, lng) {
    ctx._capturedOnPosition({
      coords: {
        latitude: lat,
        longitude: lng,
        accuracy: 5,
        speed: 5,
        heading: 90,
        altitude: 0,
      },
      timestamp: ctx._getNow(),
    });
  }

  function positionSends(ctx) {
    return ctx._sent.filter((m) => m && m.type === 'position');
  }

  it('前提: useWorker=true + devicemotion listener が配線される', () => {
    const ctx = makeCtx();
    const GPS = loadGps(ctx);
    GPS.start(() => {});
    expect(typeof ctx._capturedOnPosition).toBe('function');
    expect(typeof ctx._motionFn).toBe('function');
  });

  it('★中核: throttle で間引いた区間の古い accel が次回送信に混入しない (drain 不変)', () => {
    const ctx = makeCtx();
    const GPS = loadGps(ctx);
    const t0 = ctx._getNow();
    GPS.start(() => {});

    // (1) t0: 100..199 (tagBase=100) を push → 送信 #1 (_lastWorkerSendT=t0)
    fireMotion(ctx, 3, 100);
    firePosition(ctx, 33.84, 132.7656);

    // (2) t0+100ms (< 700): 200..299 (tagBase=200) を push → onPosition は早期 return (間引き)
    ctx._setNow(t0 + 100);
    fireMotion(ctx, 3, 200);
    firePosition(ctx, 33.8401, 132.7656); // throttled

    // (3) t0+300ms (< 700): 300.. を push → 早期 return
    ctx._setNow(t0 + 300);
    fireMotion(ctx, 3, 300);
    firePosition(ctx, 33.8402, 132.7656); // throttled

    // (4) t0+800ms (>= 700): 400.. を push → 送信 #2
    ctx._setNow(t0 + 800);
    fireMotion(ctx, 3, 400);
    firePosition(ctx, 33.8403, 132.7656); // sent

    const sends = positionSends(ctx);
    expect(sends.length).toBe(2); // #1 と #4 のみ送信・#2/#3 は throttle

    const second = sends[1].data;
    const xs = (second.accelSamples || []).map((s) => s.x);
    // ★不変条件: 送信 #2 の accelSamples は #4 で push した 400 系のみ。
    //   200/300 系 (= 間引き区間で蓄積) が混入していたら drain bug = false-negative 汚染。
    const polluted = xs.filter((x) => x >= 200 && x < 400);
    expect(polluted).toEqual([]); // 間引き区間の古い accel は持ち越されない
    // 400 系は正しく届く (= drain が「全部捨てる」過剰実装でない事も担保)
    expect(xs.filter((x) => x >= 400 && x < 500).length).toBe(3);
  });

  it('gyroBuffer も同様に throttle 区間で持ち越されない', () => {
    const ctx = makeCtx();
    const GPS = loadGps(ctx);
    const t0 = ctx._getNow();
    GPS.start(() => {});

    fireMotion(ctx, 2, 100);
    firePosition(ctx, 33.84, 132.7656); // send #1

    ctx._setNow(t0 + 200);
    fireMotion(ctx, 2, 200);
    firePosition(ctx, 33.8401, 132.7656); // throttled

    ctx._setNow(t0 + 800);
    fireMotion(ctx, 2, 400);
    firePosition(ctx, 33.8402, 132.7656); // send #2

    const sends = positionSends(ctx);
    const second = sends[1].data;
    const gxs = (second.gyroSamples || []).map((s) => s.alpha);
    expect(gxs.filter((a) => a >= 200 && a < 400)).toEqual([]);
  });

  it('回帰: 間引きが無い通常レート送信では accel が正常に届く (drain 過剰でない)', () => {
    const ctx = makeCtx();
    const GPS = loadGps(ctx);
    const t0 = ctx._getNow();
    GPS.start(() => {});

    fireMotion(ctx, 4, 100);
    firePosition(ctx, 33.84, 132.7656); // send #1

    ctx._setNow(t0 + 800); // > 700ms 間隔・throttle なし
    fireMotion(ctx, 4, 200);
    firePosition(ctx, 33.8401, 132.7656); // send #2

    const sends = positionSends(ctx);
    expect(sends.length).toBe(2);
    expect(sends[0].data.accelSamples.map((s) => s.x)).toEqual([100, 101, 102, 103]);
    expect(sends[1].data.accelSamples.map((s) => s.x)).toEqual([200, 201, 202, 203]);
  });
});
