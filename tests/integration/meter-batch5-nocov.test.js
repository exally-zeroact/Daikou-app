// tests/integration/meter-batch5-nocov.test.js
//
// ★設計変更宣言 Phase 8 Batch 5 (2026-05-21・NoCoverage 開拓・60% 主戦場):
//   Stryker Pass A meter.js の NoCoverage cluster を・既存挙動 verify で coverage 拡張。
//   未到達 path を test で踏ませて・大量 mutant を一気に killed / survived 化させる。
//
// 対象 line + 推定 mutant 件数:
//   L1184-1190 calcFare wait 経路 (= wait.enabled / freeMins / ratePerMin / billable)  (~14 mutants)
//   L1181 calcFare 内 fare *= _calcAutoSurchargeMultiplier 乗算                          (~1 mutant)
//   L1273 getSurchargeMultiplier 内 mul *= _calcAutoSurchargeMultiplier 乗算            (~1 mutant)
//   L1218-1246 _calcAutoSurchargeMultiplier 内部 (= night / weekend / winter 適用)     (~25 mutants)
//   L1669-1684 primeFromWarmup (= warmup 復元経路)                                       (~10 mutants)
//   L1630-1641 updateGpsOnly (= lastWarmupGps セッター)                                  (~5 mutants)
//   L1393-1398 resume (= running=false → true 切替・last_resume_time 再セット)         (~3 mutants)
//   L1387-1391 setLastGps (= 復元用 state setter)                                        (~3 mutants)
//
// 範囲外 (= 司さん指示「getReport」は本 batch スコープ外):
//   getReport は js/business.js (= business.js mutation 範囲)・meter.js Pass A 関与なし
//   別 task (= 司さん判断で・business.js Stryker run 立てる場合に扱う)
//
// ★絶対ルール準拠:
//   prod (js/*) は 1 byte も触らない (= test 追加のみ)。
//   distance_m += 5 経路・calcFare 加算経路・commit 機構 完全不変。
//   wait 料金加算は・calcFare の Step 5 (= 既存仕様) に既存設計でガードされている経路を verify。

'use strict';

const path = require('path');
const METER_JS_PATH = path.join(__dirname, '..', '..', 'js', 'meter.js');

function loadMeter() {
  delete require.cache[require.resolve(METER_JS_PATH)];
  return require(METER_JS_PATH);
}

function mockGPS() {
  globalThis.GPS = {
    calcDistance: () => 0,
    calcDistance3D: () => 0,
    setRoadType: () => {},
  };
}

const FC_BASE = {
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

// ─── L1184-1190: calcFare wait 経路 ──────────────────────────
//
// 対象式:
//   if (fareConfig.wait && fareConfig.wait.enabled) {
//     const waitMin = (state.wait_sec || 0) / 60;
//     const free = typeof fareConfig.wait.freeMins === 'number' ? fareConfig.wait.freeMins : 5;
//     const rate = typeof fareConfig.wait.ratePerMin === 'number' ? fareConfig.wait.ratePerMin : 100;
//     const billable = Math.max(0, waitMin - free);
//     fare += billable * rate;
//   }
//
// wait_sec は・state.wait_sec (= update() で累積)・本 test は setDistance + 直接 state 設定不可なので・
// 既存 update() 経由で wait_sec を貯めるか・calcFare の挙動を直接 verify するか:
//   - Meter.calcFare(distanceM) は・公開 API・state.wait_sec を参照する純粋関数
//   - state.wait_sec を貯めるには・update() で speedKmh<3 の GPS を流す必要あり (= 既存仕様)

describe('Phase 8 Batch 5: L1184-1190 calcFare wait 経路 (= 待機料金加算)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  // 補助: wait_sec を貯めるための GPS update 連続流し
  // ★ 注: update() L1002 の `dtSec2 < 60` ガードのため・dt=30 秒 step で累積
  function accumulateWaitSec(meterRef, seconds) {
    const baseTs = 1714100000000;
    const STEP = 30; // 30 秒 intervals (= < 60 で wait_sec 累積条件成立)
    for (let t = 0; t <= seconds; t += STEP) {
      meterRef.update({
        lat: 33.84,
        lng: 132.7656,
        altitude: 0,
        accuracy: 5,
        speedKmh: 2, // < 3 = wait 累積条件
        isStationary: false,
        timestamp: baseTs + t * 1000,
      });
    }
  }

  it('wait.enabled=false → wait 加算なし (= L1184 gate)', () => {
    Meter.setFareConfig({ ...FC_BASE, wait: { enabled: false, freeMins: 5, ratePerMin: 100 } });
    Meter.reset();
    Meter.start();
    accumulateWaitSec(Meter, 600); // 10 分 wait
    const fare = Meter.calcFare(0); // base + wait 加算なし
    expect(fare).toBe(1300); // wait 加算なし・base のみ
  });

  it('wait.enabled=true + wait_sec=0 → billable=0 → wait 加算なし', () => {
    Meter.setFareConfig({ ...FC_BASE, wait: { enabled: true, freeMins: 5, ratePerMin: 100 } });
    Meter.reset();
    Meter.start();
    // wait_sec=0 (= update 流さない)
    const fare = Meter.calcFare(0);
    expect(fare).toBe(1300); // 加算なし
  });

  it('wait.enabled=true + wait_sec=300秒 (= 5分) → free=5 → billable=0', () => {
    Meter.setFareConfig({ ...FC_BASE, wait: { enabled: true, freeMins: 5, ratePerMin: 100 } });
    Meter.reset();
    Meter.start();
    accumulateWaitSec(Meter, 300); // 5 分 wait = freeMins と同じ
    const fare = Meter.calcFare(0);
    expect(fare).toBe(1300); // free 範囲内・加算なし
  });

  it('wait.enabled=true + wait_sec=600秒 (= 10分) → free=5 → billable=5分 → 500円加算', () => {
    Meter.setFareConfig({ ...FC_BASE, wait: { enabled: true, freeMins: 5, ratePerMin: 100 } });
    Meter.reset();
    Meter.start();
    accumulateWaitSec(Meter, 600); // 10 分 wait
    const fare = Meter.calcFare(0);
    // free=5・billable=10-5=5・rate=100 → +500
    // rounding=10 で・1800 ピッタリ
    expect(fare).toBe(1800);
  });

  it('wait.enabled=true + freeMins=undefined → default 5 適用', () => {
    Meter.setFareConfig({ ...FC_BASE, wait: { enabled: true, ratePerMin: 100 } });
    Meter.reset();
    Meter.start();
    accumulateWaitSec(Meter, 600);
    // freeMins default=5・billable=5・rate=100 → +500
    expect(Meter.calcFare(0)).toBe(1800);
  });

  it('wait.enabled=true + ratePerMin=undefined → default 100 適用', () => {
    Meter.setFareConfig({ ...FC_BASE, wait: { enabled: true, freeMins: 5 } });
    Meter.reset();
    Meter.start();
    accumulateWaitSec(Meter, 600);
    // ratePerMin default=100・billable=5・rate=100 → +500
    expect(Meter.calcFare(0)).toBe(1800);
  });

  it('wait.enabled=true + 大きい wait_sec → fare 単調増加', () => {
    Meter.setFareConfig({ ...FC_BASE, wait: { enabled: true, freeMins: 5, ratePerMin: 100 } });
    Meter.reset();
    Meter.start();
    accumulateWaitSec(Meter, 300); // 5 分
    const fare5min = Meter.calcFare(0);
    Meter.reset();
    Meter.start();
    accumulateWaitSec(Meter, 1200); // 20 分
    const fare20min = Meter.calcFare(0);
    expect(fare20min).toBeGreaterThan(fare5min); // 20 分 > 5 分
  });
});

// ─── L1218-1246: _calcAutoSurchargeMultiplier (= night / weekend / winter) ──────
//
// 内部 helper を直接 test できないため・calcFare 経由で挙動 verify (= autoSurcharges 自動付与で
// fare 変動を観測)。Date は・vi.useFakeTimers / Mock せず・current time を許容する設計だが・
// night は時刻範囲依存・weekend は曜日依存・winter は月日依存 → これらを比較する形 (= relative test)

describe('Phase 8 Batch 5: L1218-1246 _calcAutoSurchargeMultiplier (= night / weekend / winter)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('autoSurcharges = undefined → multiplier = 1.0 (= 早期 return)', () => {
    Meter.setFareConfig({ ...FC_BASE, autoSurcharges: undefined });
    Meter.reset();
    Meter.start();
    expect(Meter.calcFare(1000)).toBe(1300); // base のみ・乗算なし
  });

  it('autoSurcharges = {} (= 全 disabled) → multiplier = 1.0', () => {
    Meter.setFareConfig({ ...FC_BASE, autoSurcharges: {} });
    Meter.reset();
    Meter.start();
    expect(Meter.calcFare(1000)).toBe(1300);
  });

  it('autoSurcharges.night enabled=false → 適用なし', () => {
    Meter.setFareConfig({
      ...FC_BASE,
      autoSurcharges: { night: { enabled: false, from: 22, to: 5, rate: 1.5 } },
    });
    Meter.reset();
    Meter.start();
    expect(Meter.calcFare(1000)).toBe(1300); // disabled・適用なし
  });

  it('autoSurcharges.night rate=undefined → 適用なし (= typeof check)', () => {
    Meter.setFareConfig({
      ...FC_BASE,
      autoSurcharges: { night: { enabled: true, from: 0, to: 24 } }, // rate 無し・常時 enabled
    });
    Meter.reset();
    Meter.start();
    expect(Meter.calcFare(1000)).toBe(1300); // rate=undefined・適用なし
  });

  it('autoSurcharges.weekend rate=undefined → 適用なし', () => {
    Meter.setFareConfig({
      ...FC_BASE,
      autoSurcharges: { weekend: { enabled: true } }, // rate 無し
    });
    Meter.reset();
    Meter.start();
    expect(Meter.calcFare(1000)).toBe(1300);
  });

  it('autoSurcharges.winter rate=undefined → 適用なし', () => {
    Meter.setFareConfig({
      ...FC_BASE,
      autoSurcharges: { winter: { enabled: true, from: '01-01', to: '12-31' } }, // rate 無し
    });
    Meter.reset();
    Meter.start();
    expect(Meter.calcFare(1000)).toBe(1300);
  });

  it('autoSurcharges.night enabled + 24時間範囲 + rate=1.5 → 1.5x 適用 (= 必ず inRange)', () => {
    Meter.setFareConfig({
      ...FC_BASE,
      autoSurcharges: { night: { enabled: true, from: 0, to: 24, rate: 1.5 } }, // 0-24 = 終日
    });
    Meter.reset();
    Meter.start();
    // base 1300 × 1.5 = 1950・rounding 10 → 1950
    expect(Meter.calcFare(1000)).toBe(1950);
  });

  it('autoSurcharges.night wraparound (= from=22 to=5) で・現在時刻が範囲外でも・rate 適用 path 存在', () => {
    // 現在時刻次第・常に skip / 適用のどちらか・但し coverage は通る (= path に踏み入る)
    Meter.setFareConfig({
      ...FC_BASE,
      autoSurcharges: { night: { enabled: true, from: 22, to: 5, rate: 1.5 } },
    });
    Meter.reset();
    Meter.start();
    const fare = Meter.calcFare(1000);
    // 結果は時刻次第・但し 1300 or 1950 のどちらか・両方 valid
    expect(fare === 1300 || fare === 1950).toBe(true);
  });

  it('autoSurcharges.weekend enabled + rate=1.2 → 土日のみ適用 path', () => {
    Meter.setFareConfig({
      ...FC_BASE,
      autoSurcharges: { weekend: { enabled: true, rate: 1.2 } },
    });
    Meter.reset();
    Meter.start();
    const fare = Meter.calcFare(1000);
    // 平日: 1300・土日: 1300×1.2=1560 → どちらか
    expect(fare === 1300 || fare === 1560).toBe(true);
  });

  it('autoSurcharges.winter MM-DD 範囲 (= 12-15 to 03-15) → 範囲内なら適用 path', () => {
    Meter.setFareConfig({
      ...FC_BASE,
      autoSurcharges: { winter: { enabled: true, from: '12-15', to: '03-15', rate: 1.1 } },
    });
    Meter.reset();
    Meter.start();
    const fare = Meter.calcFare(1000);
    // 範囲内: 1430 / 範囲外: 1300
    expect(fare === 1300 || fare === 1430).toBe(true);
  });

  it('autoSurcharges.winter default (= from/to 未指定 → default "12-15"/"03-15" 適用 path)', () => {
    Meter.setFareConfig({
      ...FC_BASE,
      autoSurcharges: { winter: { enabled: true, rate: 1.1 } }, // from/to 無し → default
    });
    Meter.reset();
    Meter.start();
    const fare = Meter.calcFare(1000);
    // default 12-15 to 03-15 適用 (= 冬期間内なら 1430・期間外なら 1300)
    expect(fare === 1300 || fare === 1430).toBe(true);
  });

  it('autoSurcharges 複数 (= night + weekend + winter) → 全 rate 積算 path', () => {
    Meter.setFareConfig({
      ...FC_BASE,
      autoSurcharges: {
        night: { enabled: true, from: 0, to: 24, rate: 1.5 }, // 必ず適用
        weekend: { enabled: true, rate: 1.2 }, // 土日のみ
        winter: { enabled: true, from: '01-01', to: '12-31', rate: 1.1 }, // 必ず適用
      },
    });
    Meter.reset();
    Meter.start();
    const fare = Meter.calcFare(1000);
    // 平日: 1300 × 1.5 × 1.1 = 2145・土日: × 1.2 を更に乗算 = 2574
    // rounding 10 で・どちらか
    expect(fare === 2150 || fare === 2570).toBe(true); // rounding 10
  });

  it('getSurchargeMultiplier も autoSurcharge 乗算経路を通る (= L1273 *= 適用)', () => {
    Meter.setFareConfig({
      ...FC_BASE,
      autoSurcharges: { night: { enabled: true, from: 0, to: 24, rate: 2.0 } }, // 終日 2x
    });
    Meter.reset();
    Meter.start();
    const mul = Meter.getSurchargeMultiplier();
    // active surcharges 0 件・auto night 2x → 1.0 × 2.0 = 2.0
    expect(mul).toBeCloseTo(2.0, 6);
  });
});

// ─── L1669-1684: primeFromWarmup ────────────────────────────
//
// 対象式:
//   const warmupValid = lastWarmupGps && lastWarmupGps.timestamp && now - lastWarmupGps.timestamp < WARMUP_MAX_AGE_MS;
//   if (!warmupValid) return false;
//   state.last_gps = { ... }・state.last_timestamp = ...・state.last_speed_kmh = ...
//   return true;

describe('Phase 8 Batch 5: L1669-1684 primeFromWarmup (= 業務開始時 warmup 復元)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig(FC_BASE);
    Meter.reset();
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('updateGpsOnly 未呼出 (= lastWarmupGps=null) → primeFromWarmup() returns false', () => {
    expect(Meter.primeFromWarmup()).toBe(false);
  });

  it('updateGpsOnly 直後 (= warmup valid 5秒以内) → primeFromWarmup() returns true', () => {
    Meter.updateGpsOnly({
      lat: 33.84,
      lng: 132.7656,
      altitude: 0,
      speedKmh: 0,
      compassHeading: null,
      timestamp: Date.now(), // 現在 → 5秒以内
    });
    expect(Meter.primeFromWarmup()).toBe(true);
    const s = Meter.getState();
    expect(s.last_gps).not.toBeNull();
    expect(s.last_gps.lat).toBe(33.84);
    expect(s.last_gps.lng).toBe(132.7656);
  });

  it('updateGpsOnly 5秒超過 (= warmup 期限切れ) → primeFromWarmup() returns false', () => {
    Meter.updateGpsOnly({
      lat: 33.84,
      lng: 132.7656,
      altitude: 0,
      speedKmh: 0,
      compassHeading: null,
      timestamp: Date.now() - 10000, // 10 秒前 → 5秒超過
    });
    expect(Meter.primeFromWarmup()).toBe(false);
  });

  it('primeFromWarmup 成功で state.last_speed_kmh も復元 (= warmup の speedKmh 値)', () => {
    Meter.updateGpsOnly({
      lat: 33.84,
      lng: 132.7656,
      altitude: 0,
      speedKmh: 35,
      compassHeading: null,
      timestamp: Date.now(),
    });
    Meter.primeFromWarmup();
    expect(Meter.getState().last_speed_kmh).toBe(35);
  });
});

// ─── L1630-1641: updateGpsOnly (= lastWarmupGps setter) ────────
//
// 対象式: invalid lat/lng → return / valid → lastWarmupGps = {...}

describe('Phase 8 Batch 5: L1630-1641 updateGpsOnly (= warmup setter)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig(FC_BASE);
    Meter.reset();
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('valid GPS → 後続 primeFromWarmup() で true', () => {
    Meter.updateGpsOnly({
      lat: 33.84,
      lng: 132.7656,
      altitude: 0,
      speedKmh: 0,
      compassHeading: null,
      timestamp: Date.now(),
    });
    expect(Meter.primeFromWarmup()).toBe(true);
  });

  it('lat=null (= invalid) → 早期 return → primeFromWarmup() false', () => {
    Meter.updateGpsOnly({
      lat: null,
      lng: 132.7656,
      altitude: 0,
      speedKmh: 0,
      compassHeading: null,
      timestamp: Date.now(),
    });
    expect(Meter.primeFromWarmup()).toBe(false);
  });

  it('lng="文字列" (= invalid typeof) → 早期 return', () => {
    Meter.updateGpsOnly({
      lat: 33.84,
      lng: '132.7656',
      altitude: 0,
      speedKmh: 0,
      compassHeading: null,
      timestamp: Date.now(),
    });
    expect(Meter.primeFromWarmup()).toBe(false);
  });

  it('引数 null → 早期 return (= !gpsResult)', () => {
    Meter.updateGpsOnly(null);
    expect(Meter.primeFromWarmup()).toBe(false);
  });
});

// ─── L1393-1398: resume (= running=false → true 切替) ────────

describe('Phase 8 Batch 5: L1393-1398 resume (= running 再開)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig(FC_BASE);
    Meter.reset();
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('running=false 状態で resume() → running=true・last_resume_time セット', () => {
    expect(Meter.getState().running).toBe(false);
    expect(Meter.getState().last_resume_time).toBeNull();
    Meter.resume();
    const s = Meter.getState();
    expect(s.running).toBe(true);
    expect(s.last_resume_time).not.toBeNull();
    expect(typeof s.last_resume_time).toBe('number');
  });

  it('running=true 状態で resume() → no-op (= 早期 return)', () => {
    Meter.start();
    const t1 = Meter.getState().last_resume_time;
    Meter.resume(); // no-op
    const t2 = Meter.getState().last_resume_time;
    expect(t2).toBe(t1); // last_resume_time 不変
    expect(Meter.getState().running).toBe(true);
  });
});

// ─── L1387-1391: setLastGps (= 復元用 state setter) ────────

describe('Phase 8 Batch 5: L1387-1391 setLastGps (= 復元用)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig(FC_BASE);
    Meter.reset();
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('setLastGps(lat, lng, altitude, speedKmh, timestamp) で state.last_gps 復元', () => {
    Meter.setLastGps(33.84, 132.7656, 10, 25, 1714100000000);
    const s = Meter.getState();
    expect(s.last_gps).toEqual({ lat: 33.84, lng: 132.7656, altitude: 10 });
    expect(s.last_timestamp).toBe(1714100000000);
    expect(s.last_speed_kmh).toBe(25);
  });

  it('setLastGps(speedKmh=null) → state.last_speed_kmh=0 (= ||0 fallback)', () => {
    Meter.setLastGps(33.84, 132.7656, 0, null, 1714100000000);
    expect(Meter.getState().last_speed_kmh).toBe(0);
  });
});

// ─── businessEnd 未カバー分岐 (= L734 mmWorker null branch) ────────

describe('Phase 8 Batch 5: businessEnd 未カバー分岐', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig(FC_BASE);
    Meter.reset();
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('mmWorker 未 set で businessEnd → エラー無し・state.running=false に切替', () => {
    // setMapMatcher 未呼出
    Meter.start();
    expect(Meter.getState().running).toBe(true);
    Meter.businessEnd();
    expect(Meter.getState().running).toBe(false);
    expect(Meter.getState().business_active).toBe(false);
  });

  it('mmWorker set 済で businessEnd → reset message 送信 path', () => {
    const sent = [];
    const fakeWorker = {
      addEventListener: () => {},
      removeEventListener: () => {},
      postMessage: (m) => sent.push(m),
    };
    Meter.setMapMatcher(fakeWorker);
    Meter.start();
    Meter.businessEnd();
    // reset message が送信されている (= L736)
    expect(sent.some((m) => m && m.type === 'reset')).toBe(true);
  });
});
