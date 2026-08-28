// ★物差し★ 2026-08-28 … ★画面の見え方の線（display ≤ distance_m）で 判定しています★
//   ・見ているのは ★画面の数字が 課金距離を 先取りしないか★（この file 自身に そう書いてある）
//   ・★距離そのもの（いくら取るか）の採点では ありません★。
//   ・タクシー認定モード（過大不可）／代行モード（天井 +0.5〜6%）の どちらの線でも ありません。
// tests/integration/meter-catchup-latch-invariant.test.js
//
// ★STEP0 テストツール先行 (= 永久ルール・実装前に必ず)★
//   司さん確定方針 (= ダイコメ メーター最高精度化・訂正版):
//     ・課金はメーター(表示 display)に合わせる (= fare = calcFare(display))。
//     ・メーターは最終的に実距離に追いつく (latch)。支払時点で メーター=実距離=料金 が一致。
//     ・過大請求は「課金を変える」のでなく「メーターが実距離を絶対に超えない (catch-up)」で消す。
//
//   本 fixture が強制する invariant (= 過大請求根絶の契約):
//     (a) 全更新フレームで display ≤ distance_m / business_display ≤ business_distance_m
//         (= overshoot ゼロ・先取り禁止)。  ← 中核 invariant
//     (b) latch 経路 (= 業務終了 businessEnd / 一時停止 stop) 後に display == distance_m
//         (= 支払時点で メーター=実距離=料金 一致)。
//     (c) 停車 trace で display が単調かつ target(distance_m) に収束する。
//     (d) fare = calcFare(display) の配線で・(a) により fare ≤ calcFare(distance_m) を常に満たす
//         (= 過大請求が数学的に不能)。
//
//   ★現状の overshoot 型 _smoothDisplay (= display = max(prev, target + predict)) では
//     (a)/(d) が FAIL する★ (= rАF が新 GPS フレーム到着後に実時間経過して 1 回読むと
//     predict が velocity*sinceTarget だけ target を先取りし display > distance_m になる)。
//   Step 2 実装 (= catch-up + latch・display ≤ target を数学保証 + 末尾 clamp) で緑化する想定。
//
//   絶対不可侵 (= 本 fixture は read-only):
//     distance_m / business_distance_m の実値・加算経路・calcFare 料金式・課金配線。
//     本 fixture は display 専用 layer の挙動のみ assert する。

'use strict';

const path = require('path');
const METER_JS_PATH = path.join(__dirname, '..', '..', 'js', 'meter.js');

function loadMeter() {
  delete require.cache[require.resolve(METER_JS_PATH)];
  return require(METER_JS_PATH);
}

const DEFAULT_FARE_CONFIG = {
  version: 2,
  base_fare: 1300,
  base_distance_m: 1000,
  add_fare: 100,
  add_distance_m: 420,
  tiers: [],
  surcharges: [],
  minFare: null,
  maxFare: null,
  rounding: 10,
  autoSurcharges: {},
  vehicles: [],
  vehiclesEnabled: false,
  wait: { enabled: false, freeMins: 5, ratePerMin: 100 },
};

function mockGPS() {
  globalThis.GPS = {
    calcDistance: (lat1, lng1, lat2, lng2) => {
      if (lat1 === lat2 && lng1 === lng2) return 0;
      const R = 6371000;
      const tr = Math.PI / 180;
      const dLat = (lat2 - lat1) * tr;
      const dLng = (lng2 - lng1) * tr;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * tr) * Math.cos(lat2 * tr) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },
    calcDistance3D: () => 0,
  };
}

// ─── 決定論クロック (= getState 内 Date.now() / GPS timestamp を制御し flaky 化を防ぐ) ───
// 実機の rAF は「新 GPS フレーム到着後・実時間が経過してから display を読む」。この実時間経過
// (= sinceTarget) が現状の predict 先取りを発火させる。決定論的に再現するため Date.now を stub。
let _clock = 0;
const _realDateNow = Date.now;
function installClock(startMs) {
  _clock = startMs;
  Date.now = () => _clock;
}
function advance(ms) {
  _clock += ms;
}
// ★rAF 相当の 60Hz ポーリング★ (= 実機の描画ループ): display は rAF が毎フレーム読む。
//   ms の間を ~60Hz の sub-frame で進めつつ毎フレーム getState() を呼ぶ。
//   (旧 harness は GPS tick 後 1 回しか読まず inter-tick の数千 ms を無描画にしていたが、
//    実機 rAF は連続描画なので、表示層の dtFrame 上限 (タブ復帰飛び防止) と整合しない。
//    実機挙動に合わせて連続ポーリングへ正直化。各 sub-frame で onFrame コールバックも回す。)
function pollRAF(getState, ms, onFrame) {
  const FRAME_MS = 1000 / 60;
  let remaining = ms;
  let last = null;
  while (remaining > 1e-6) {
    const step = remaining > FRAME_MS ? FRAME_MS : remaining;
    _clock += step;
    last = getState();
    if (onFrame) onFrame(last);
    remaining -= step;
  }
  if (last === null) {
    _clock += ms;
    last = getState();
    if (onFrame) onFrame(last);
  }
  return last;
}
function restoreClock() {
  Date.now = _realDateNow;
}

const BASE_TS = 1714100000000;

// GPS 点 (= 北向き直進・speedKmh 一定)。timestamp は決定論クロックと同期させる。
function gps(t, opts) {
  opts = opts || {};
  const speedKmh = opts.speedKmh != null ? opts.speedKmh : 36;
  const moveM = (speedKmh / 3.6) * t;
  const dLat = moveM / 111132;
  return {
    lat: 33.84 + dLat,
    lng: 132.7656,
    altitude: 0,
    accuracy: opts.accuracy != null ? opts.accuracy : 5,
    speedKmh,
    isStationary: opts.isStationary || false,
    timestamp: BASE_TS + t * 1000,
  };
}

describe('★STEP0: メーター catch-up + latch invariant (= 過大請求根絶契約)', () => {
  let Meter;

  beforeEach(() => {
    mockGPS();
    installClock(BASE_TS);
    Meter = loadMeter();
    Meter.setFareConfig(DEFAULT_FARE_CONFIG);
    Meter.reset();
    Meter.start();
    if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
    if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    restoreClock();
    delete globalThis.GPS;
  });

  // ★2026-07-03 司さん実機(しまなみ・モコ 90-105km/h)報告「高速で画面が遅れ→停車後に追いつく」の根治テスト。
  //   trace解析で内部距離(distance_m)は正確・高速でも遅れ無しと実証。遅れの正体は"表示層の追従上限"
  //   (旧 DISP_CATCHUP_MAX_MPS=24m/s=86km/h)が高速で頭打ちになり画面が置いていかれる事。
  //   可変上限(直近速度×倍率・floor)化で根治。★150km/h持続でも display が target に食らいつく(遅れが発散しない)★を強制。
  it('高速150km/h持続でも display が target に食らいつく(遅れが溜まって発散しない)', () => {
    const V = 150 / 3.6; // 41.667 m/s
    const stepMs = 100;
    const totalMs = 8000;
    let target = 0;
    let maxLagAfterWarmup = 0;
    for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
      target += V * (stepMs / 1000);
      Meter.setDistance(target);
      const st = pollRAF(() => Meter.getState(), stepMs);
      const disp = st.display_distance_m || 0;
      const lag = target - disp;
      // 助走(rate EMA確立)後の遅れだけ見る
      if (elapsed > 3000) maxLagAfterWarmup = Math.max(maxLagAfterWarmup, lag);
    }
    // 旧実装(cap 24m/s=86km/h)では 150km/h(41.7m/s)で毎秒約17m遅れ→数十mに発散する。
    // 追従上限を速度追随にすれば、遅れは数フレーム分に収束(<60m)。
    expect(maxLagAfterWarmup).toBeLessThan(60);
  });

  // 実機 rАF 相当の駆動: GPS は 5s 間隔 (= gap-fill で distance_m 累積)・各 GPS フレーム到着後に
  // 実時間 200ms 経過させてから 1 回 display を読む (= rАF が新フレームを描画するタイミング)。
  // この 1 回読みで・現状 predict が velocity*sinceTarget の先取りを display に乗せる。
  function driveAndCollect(steps, opts) {
    opts = opts || {};
    const readDelayMs = opts.readDelayMs != null ? opts.readDelayMs : 200;
    const speedKmh = opts.speedKmh != null ? opts.speedKmh : 36;
    const frames = [];
    // 初期 GPS (= last_gps seed)
    _clock = gps(0, { speedKmh }).timestamp;
    Meter.update(gps(0, { speedKmh }));
    for (let i = 1; i <= steps; i++) {
      const t = i * 5;
      _clock = gps(t, { speedKmh }).timestamp; // GPS 到着時刻 = trace timestamp
      Meter.update(gps(t, { speedKmh }));
      // ★実機 rAF 相当★: GPS tick から次 tick まで (= 5s) を 60Hz で連続ポーリングし、
      //   各 sub-frame で display を読む。readDelayMs 経過時点の値を当該 tick の代表 frame とする。
      let rep = null;
      let elapsed = 0;
      pollRAF(
        () => Meter.getState(),
        5000,
        (s) => {
          elapsed += 1000 / 60;
          if (rep === null && elapsed >= readDelayMs) {
            rep = {
              t,
              display: s.display_distance_m || 0,
              distance_m: s.distance_m || 0,
              business_display: s.business_display_distance_m || 0,
              business_distance_m: s.business_distance_m || 0,
            };
          }
        }
      );
      if (rep === null) {
        const s = Meter.getState();
        rep = {
          t,
          display: s.display_distance_m || 0,
          distance_m: s.distance_m || 0,
          business_display: s.business_display_distance_m || 0,
          business_distance_m: s.business_distance_m || 0,
        };
      }
      frames.push(rep);
    }
    return frames;
  }

  // ─── (a) 全更新フレームで display ≤ distance_m (= overshoot ゼロ)・中核 invariant ───
  it('(a) display ≤ distance_m を全更新フレームで満たす (= overshoot 先取り ゼロ)', () => {
    Meter.setBusinessActive(true);
    const frames = driveAndCollect(30, { speedKmh: 36, readDelayMs: 200 });
    // 距離が実際に累積していること (= harness が距離駆動できている証明・trivial-green 防止)
    const finalDist = frames[frames.length - 1].distance_m;
    expect(finalDist).toBeGreaterThan(100);

    let maxOver = -Infinity;
    let worst = null;
    for (const f of frames) {
      const over = f.display - f.distance_m;
      if (over > maxOver) {
        maxOver = over;
        worst = f;
      }
    }
    if (maxOver > 1e-6) {
      throw new Error(
        `(a) FAIL: display が distance_m を超えた (= overshoot ${maxOver.toFixed(4)}m) ` +
          `at t=${worst.t}s display=${worst.display.toFixed(3)} distance_m=${worst.distance_m.toFixed(3)}`
      );
    }
  });

  // ─── (a-biz) business_display ≤ business_distance_m を全フレームで満たす ───
  it('(a) business_display ≤ business_distance_m を全更新フレームで満たす', () => {
    Meter.setBusinessActive(true);
    const frames = driveAndCollect(30, { speedKmh: 36, readDelayMs: 200 });
    const finalBiz = frames[frames.length - 1].business_distance_m;
    expect(finalBiz).toBeGreaterThan(100);

    let maxOver = -Infinity;
    let worst = null;
    for (const f of frames) {
      const over = f.business_display - f.business_distance_m;
      if (over > maxOver) {
        maxOver = over;
        worst = f;
      }
    }
    if (maxOver > 1e-6) {
      throw new Error(
        `(a-biz) FAIL: business_display が business_distance_m を超えた (= ${maxOver.toFixed(4)}m) ` +
          `at t=${worst.t}s biz_disp=${worst.business_display.toFixed(3)} biz_dist=${worst.business_distance_m.toFixed(3)}`
      );
    }
  });

  // ─── (b) latch 経路 (= 業務終了) 後に display == distance_m ───
  it('(b) businessEnd (= latch) 後に display == distance_m / business_display == business_distance_m', () => {
    Meter.setBusinessActive(true);
    driveAndCollect(20, { speedKmh: 36, readDelayMs: 200 });
    Meter.businessEnd(); // 業務終了 = latch 遷移
    advance(200);
    const s = Meter.getState();
    const diff = Math.abs((s.display_distance_m || 0) - (s.distance_m || 0));
    if (diff > 1e-6) {
      throw new Error(
        `(b) FAIL: businessEnd 後 display=${(s.display_distance_m || 0).toFixed(3)} ≠ ` +
          `distance_m=${(s.distance_m || 0).toFixed(3)} (diff=${diff.toFixed(4)})`
      );
    }
    const bdiff = Math.abs((s.business_display_distance_m || 0) - (s.business_distance_m || 0));
    if (bdiff > 1e-6) {
      throw new Error(
        `(b) FAIL: businessEnd 後 business_display=${(s.business_display_distance_m || 0).toFixed(3)} ≠ ` +
          `business_distance_m=${(s.business_distance_m || 0).toFixed(3)} (diff=${bdiff.toFixed(4)})`
      );
    }
  });

  // ─── (b-stop) latch 経路 (= 一時停止 stop) 後に display == distance_m ───
  it('(b) stop (= 一時停止 latch) 後に display == distance_m', () => {
    Meter.setBusinessActive(true);
    driveAndCollect(20, { speedKmh: 36, readDelayMs: 200 });
    Meter.stop();
    advance(200);
    const s = Meter.getState();
    const diff = Math.abs((s.display_distance_m || 0) - (s.distance_m || 0));
    if (diff > 1e-6) {
      throw new Error(
        `(b-stop) FAIL: stop 後 display=${(s.display_distance_m || 0).toFixed(3)} ≠ ` +
          `distance_m=${(s.distance_m || 0).toFixed(3)} (diff=${diff.toFixed(4)})`
      );
    }
  });

  // ─── (c) 停車 trace で display が単調かつ target に収束 ───
  it('(c) 停車中 display は単調非減少かつ target(distance_m) に収束する', () => {
    Meter.setBusinessActive(true);
    // まず走行で距離を稼ぐ
    const frames = driveAndCollect(15, { speedKmh: 36, readDelayMs: 200 });
    const distAtStop = frames[frames.length - 1].distance_m;
    expect(distAtStop).toBeGreaterThan(100);

    // 停車: 同一座標で isStationary=true を流し続ける (= distance_m 不動・gap→0)
    let prevDisp = frames[frames.length - 1].display;
    let lastDisp = prevDisp;
    let lastDist = distAtStop;
    const stopGps = gps(80, { speedKmh: 0, isStationary: true });
    for (let k = 0; k < 30; k++) {
      _clock = stopGps.timestamp + k * 1000;
      Meter.update({ ...stopGps, timestamp: stopGps.timestamp + k * 1000 });
      // ★実機 rAF 相当★: 1 GPS tick の間 (1s) を 60Hz で連続ポーリング (単調性も全 sub-frame で確認)。
      pollRAF(
        () => Meter.getState(),
        1000,
        (s) => {
          const d = s.display_distance_m || 0;
          if (d < prevDisp - 1e-6) {
            throw new Error(
              `(c) FAIL: 停車中 display が後退 k=${k} ${d.toFixed(3)} < ${prevDisp.toFixed(3)}`
            );
          }
          prevDisp = Math.max(prevDisp, d);
          lastDisp = d;
          lastDist = s.distance_m || 0;
        }
      );
    }
    // 収束: 停車後 display は distance_m に着地している (= 乖離放置なし)
    const gap = Math.abs(lastDist - lastDisp);
    if (gap > 1.0) {
      throw new Error(
        `(c) FAIL: 停車収束せず display=${lastDisp.toFixed(3)} distance_m=${lastDist.toFixed(3)} (gap=${gap.toFixed(3)})`
      );
    }
  });

  // ─── (d) 課金配線 fare = calcFare(display)・(a) により fare ≤ calcFare(distance_m) ───
  it('(d) fare = calcFare(display) かつ fare ≤ calcFare(distance_m) を全フレームで満たす (= 過大請求不能)', () => {
    Meter.setBusinessActive(true);
    const frames = driveAndCollect(40, { speedKmh: 50, readDelayMs: 200 });
    const finalDist = frames[frames.length - 1].distance_m;
    expect(finalDist).toBeGreaterThan(1000); // tier 境界 (= 1000m) を跨ぐことを保証 (= 過大請求が顕在化する帯)

    let worst = null;
    for (const f of frames) {
      const fareDisplay = Meter.calcFare(f.display); // 実 index.html L8263 と同一配線
      const fareDist = Meter.calcFare(f.distance_m);
      if (fareDisplay > fareDist) {
        if (!worst || fareDisplay - fareDist > worst.fareDisplay - worst.fareDist) {
          worst = { ...f, fareDisplay, fareDist };
        }
      }
    }
    if (worst) {
      throw new Error(
        `(d) FAIL: fare=calcFare(display)=${worst.fareDisplay} > calcFare(distance_m)=${worst.fareDist} ` +
          `at t=${worst.t}s display=${worst.display.toFixed(3)} distance_m=${worst.distance_m.toFixed(3)} ` +
          `(= 表示 overshoot が料金段境界で過大請求を生む)`
      );
    }
  });
});
