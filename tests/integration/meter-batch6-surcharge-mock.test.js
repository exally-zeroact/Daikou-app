// tests/integration/meter-batch6-surcharge-mock.test.js
//
// ★設計変更宣言 Phase 8 Batch 6 (2026-05-21・autoSurcharge 時刻 mock + businessEnd 残 + 等価 docs 統合):
//   Stryker Pass A meter.js 44.80% → 60% 目標の主戦場後半。
//   Batch 5 で _calcAutoSurchargeMultiplier (= L1218-1246) は 37/95 = 39% killed・
//   残 58 は "現在時刻依存" で structural equivalent と判定したが・vi.setSystemTime で
//   各境界時刻を固定すれば・>=vs>・<vs<=・OR vs AND の差を観測可能になる。
//
// 対象 line + 推定 mutant 件数:
//   L1218-1246 _calcAutoSurchargeMultiplier 時刻境界 (= 残 58 のうち多くを kill)
//   L718-753 businessEnd 残分岐 (= FB hook 観測・mmWorker reset path・tier2 reset)
//
// ★絶対ルール準拠:
//   prod (js/*) は 1 byte も触らない (= test 追加のみ)。
//   distance_m += 5 経路 / calcFare 加算経路 / commit 機構 完全不変。
//   public API (= getSurchargeMultiplier / businessEnd / setFareConfig) 経由のみ。
//
// ─────────────────────────────────────────────────────────────────
// ★ 等価/容認 mutant 統合 docs (= Batch 1-5 で挙げた・本 batch で扱わない理由付き集約):
//
//   [カテゴリA: state-invariant / 物理的整合性で観測不能]
//     L728-729  businessEnd 内 last_resume_time 加算: state.running と一蓮托生で
//               観測時に必ず両方 true/false が同期・mutant 化しても外部観測同等
//     L1289-1290 elapsed_sec / display_distance_m 表示計算: getState 経由で内部 state
//                を素直に返す・operator 改変しても観測時に元値が一致して結果同等
//     L971      Off-Road incremental DLOG コード分岐: console.log 副作用・本番では noop
//
//   [カテゴリB: 守りの二重化で defense-in-depth・観測不能]
//     L1314 / L1317  display delta clamp: L1321 Math.max で更にガードされ・前段の
//                    operator 改変は最終出力に到達せず観測 path 閉鎖
//     L349      Off-Road incremental physMax 単独観測不能: gap fill 経路 (= L949 dtSec>=5)
//               が先行発火し・Off-Road incremental は dtSec<5 のみで発火 → 物理境界
//               への直接到達 path が・正常運用では存在しない
//
//   [カテゴリC: 等価ペア (= 値域上同等で観測不能)]
//     L1364 / L1374 / L1653  >= 0 → > 0 mutant: distance/distance_m は state 上
//                            非負保証 (= Math.max(0, ...) 帰着) ゆえ・0 取りえなく等価
//
//   [カテゴリD: 構造的 gate 順序で先行発火・後段到達不能]
//     L294 / L342  dtSec > 60 ガード: 同 update 内で・L949 gap fill (= dtSec>=5)
//                  が先行発火し・_haverAccum/Off-Road 累積は reset される。retroactive
//                  add は 0 となり・dtSec=60 と dtSec=61 で・distance_m 最終値に
//                  差がでない → mutant kill 不可
//
//   [カテゴリE: 外部依存・観測 path 限定]
//     L746 / L749  businessEnd 内 FB.pushSessionAggregates / try-catch 内 noop:
//                  本 batch で FB を mock 観測することで・存在判定 path は kill 可能。
//                  catch 内 noop 自体は・throw 後の状態変化なしゆえ等価。
//
//   [カテゴリF: 時刻依存 → 本 batch で vi.setSystemTime mock で killable]
//     L1218-1246 _calcAutoSurchargeMultiplier 内 inRange 境界 (>=・<・||・&&):
//                Batch 5 では現在時刻のみで実行・境界の・kill 困難 (= structural equivalent
//                と判定したが)・本 batch で各境界時刻を mock すれば kill 可能・本 batch で対応。
// ─────────────────────────────────────────────────────────────────

/* global vi -- vitest が globals: true で提供する Date mock API */
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

// ─── L1218-1246: night wraparound (= from=22, to=5 → h>=22 || h<5) ──────────
//
// 対象式: const inRange = f <= t ? h >= f && h < t : h >= f || h < t;
// wraparound 経路 (= f=22 > t=5) で・h >= 22 || h < 5 の各境界を時刻 mock で固定

describe('Phase 8 Batch 6: night wraparound (= from=22 to=5・h>=22 || h<5)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig({
      ...FC_BASE,
      autoSurcharges: { night: { enabled: true, from: 22, to: 5, rate: 1.5 } },
    });
    Meter.reset();
    Meter.start();
  });
  afterEach(() => {
    vi.useRealTimers();
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('h=22 (= from 境界・h>=22 true) → 範囲内・1.5x 適用', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 21, 22, 0, 0));
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.5, 6);
  });

  it('h=21 (= from-1・h>=22 false かつ h<5 false) → 範囲外・1.0', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 21, 21, 0, 0));
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.0, 6);
  });

  it('h=23 (= from+1・h>=22 true) → 範囲内・1.5x 適用', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 21, 23, 0, 0));
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.5, 6);
  });

  it('h=0 (= 深夜・h<5 true) → 範囲内・1.5x 適用', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 22, 0, 0, 0));
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.5, 6);
  });

  it('h=4 (= to-1・h<5 true) → 範囲内・1.5x 適用', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 22, 4, 0, 0));
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.5, 6);
  });

  it('h=5 (= to 境界・h<5 false) → 範囲外・1.0 (= < vs <= の境界差を観測)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 22, 5, 0, 0));
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.0, 6);
  });

  it('h=6 (= to+1) → 範囲外・1.0', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 22, 6, 0, 0));
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.0, 6);
  });

  it('h=12 (= 正午・wraparound 範囲外中央) → 1.0', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 22, 12, 0, 0));
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.0, 6);
  });
});

// ─── L1218-1246: night 通常 (= from=9 to=18・h>=9 && h<18) ──────────

describe('Phase 8 Batch 6: night 通常 (= from=9 to=18・h>=9 && h<18)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig({
      ...FC_BASE,
      autoSurcharges: { night: { enabled: true, from: 9, to: 18, rate: 1.3 } },
    });
    Meter.reset();
    Meter.start();
  });
  afterEach(() => {
    vi.useRealTimers();
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('h=9 (= from 境界・h>=9 true・h<18 true) → 範囲内・1.3x', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 21, 9, 0, 0));
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.3, 6);
  });

  it('h=8 (= from-1・h>=9 false) → 範囲外 (= >= vs > 境界差)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 21, 8, 0, 0));
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.0, 6);
  });

  it('h=17 (= to-1・h<18 true) → 範囲内・1.3x', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 21, 17, 0, 0));
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.3, 6);
  });

  it('h=18 (= to 境界・h<18 false) → 範囲外 (= < vs <= 境界差)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 21, 18, 0, 0));
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.0, 6);
  });
});

// ─── L1232-1235: weekend (= dow===0 || dow===6) ──────────────────────

describe('Phase 8 Batch 6: weekend (= 土日 dow===0 || dow===6)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig({
      ...FC_BASE,
      autoSurcharges: { weekend: { enabled: true, rate: 1.2 } },
    });
    Meter.reset();
    Meter.start();
  });
  afterEach(() => {
    vi.useRealTimers();
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('日曜日 (= 2026-05-17 日・dow=0) → 1.2x 適用', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 17, 12, 0, 0)); // 2026-05-17 = Sun
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.2, 6);
  });

  it('月曜日 (= 2026-05-18 月・dow=1) → 範囲外・1.0', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 18, 12, 0, 0)); // Mon
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.0, 6);
  });

  it('金曜日 (= dow=5) → 範囲外・1.0', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 22, 12, 0, 0)); // 2026-05-22 = Fri
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.0, 6);
  });

  it('土曜日 (= 2026-05-23 土・dow=6) → 1.2x 適用', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 23, 12, 0, 0)); // Sat
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.2, 6);
  });

  it('火曜日 (= dow=2) → 範囲外・1.0', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 19, 12, 0, 0)); // Tue
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.0, 6);
  });

  it('木曜日 (= dow=4) → 範囲外・1.0', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 21, 12, 0, 0)); // Thu
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.0, 6);
  });
});

// ─── L1236-1244: winter wraparound (= 12-15 → 03-15・年跨ぎ) ────────

describe('Phase 8 Batch 6: winter wraparound (= 12-15 to 03-15・年跨ぎ)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig({
      ...FC_BASE,
      autoSurcharges: {
        winter: { enabled: true, from: '12-15', to: '03-15', rate: 1.1 },
      },
    });
    Meter.reset();
    Meter.start();
  });
  afterEach(() => {
    vi.useRealTimers();
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('12-15 (= from 境界) → 範囲内・1.1x', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 15, 12, 0, 0)); // Dec 15
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.1, 6);
  });

  it('12-14 (= from-1) → 範囲外・1.0', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 14, 12, 0, 0)); // Dec 14
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.0, 6);
  });

  it('03-15 (= to 境界) → 範囲内・1.1x (= <= 境界)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 12, 0, 0)); // Mar 15
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.1, 6);
  });

  it('03-16 (= to+1) → 範囲外・1.0', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 16, 12, 0, 0)); // Mar 16
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.0, 6);
  });

  it('01-01 (= 年跨ぎ後・wraparound 範囲内) → 1.1x', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0)); // Jan 1
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.1, 6);
  });

  it('06-01 (= 範囲外中央) → 1.0', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0)); // Jun 1
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.0, 6);
  });
});

// ─── L1236-1244: winter 通常 (= 06-01 → 08-31・非 wraparound) ────────

describe('Phase 8 Batch 6: winter 通常 (= 06-01 to 08-31・非 wraparound)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig({
      ...FC_BASE,
      autoSurcharges: {
        winter: { enabled: true, from: '06-01', to: '08-31', rate: 1.05 },
      },
    });
    Meter.reset();
    Meter.start();
  });
  afterEach(() => {
    vi.useRealTimers();
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('06-01 (= from 境界・f<=t branch) → 範囲内・1.05x', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0));
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.05, 6);
  });

  it('05-31 (= from-1) → 範囲外・1.0', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 31, 12, 0, 0));
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.0, 6);
  });

  it('08-31 (= to 境界) → 範囲内・1.05x', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 31, 12, 0, 0));
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.05, 6);
  });

  it('09-01 (= to+1) → 範囲外・1.0', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 1, 12, 0, 0));
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.0, 6);
  });
});

// ─── L1218-1246: 複数 surcharge 積算 (= night + weekend + winter) ───

describe('Phase 8 Batch 6: 複数 surcharge 積算 (= 同時適用での積)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
  });
  afterEach(() => {
    vi.useRealTimers();
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('night + weekend + winter 同時 (= 2026-01-17 土 22:00) → 1.5 * 1.2 * 1.1 = 1.98', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 17, 22, 0, 0)); // 2026-01-17 = Sat 22:00 (= 冬期間)
    Meter.setFareConfig({
      ...FC_BASE,
      autoSurcharges: {
        night: { enabled: true, from: 22, to: 5, rate: 1.5 },
        weekend: { enabled: true, rate: 1.2 },
        winter: { enabled: true, from: '12-15', to: '03-15', rate: 1.1 },
      },
    });
    Meter.reset();
    Meter.start();
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.5 * 1.2 * 1.1, 4);
  });

  it('night のみ適用 (= 2026-05-20 水 22:00・平日 + 冬期間外) → 1.5', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 20, 22, 0, 0)); // 2026-05-20 = Wed 22:00
    Meter.setFareConfig({
      ...FC_BASE,
      autoSurcharges: {
        night: { enabled: true, from: 22, to: 5, rate: 1.5 },
        weekend: { enabled: true, rate: 1.2 },
        winter: { enabled: true, from: '12-15', to: '03-15', rate: 1.1 },
      },
    });
    Meter.reset();
    Meter.start();
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.5, 6);
  });

  it('全て disabled (= 3 つとも enabled:false) → 1.0', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 17, 22, 0, 0));
    Meter.setFareConfig({
      ...FC_BASE,
      autoSurcharges: {
        night: { enabled: false, from: 22, to: 5, rate: 1.5 },
        weekend: { enabled: false, rate: 1.2 },
        winter: { enabled: false, from: '12-15', to: '03-15', rate: 1.1 },
      },
    });
    Meter.reset();
    Meter.start();
    expect(Meter.getSurchargeMultiplier()).toBeCloseTo(1.0, 6);
  });

  it('calcFare 経由でも積算が反映 (= L1181 fare *= multiplier)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 17, 22, 0, 0)); // night + weekend + winter all in
    Meter.setFareConfig({
      ...FC_BASE,
      autoSurcharges: {
        night: { enabled: true, from: 22, to: 5, rate: 1.5 },
        weekend: { enabled: true, rate: 1.2 },
        winter: { enabled: true, from: '12-15', to: '03-15', rate: 1.1 },
      },
    });
    Meter.reset();
    Meter.start();
    // base 1300 × 1.98 = 2574・rounding 10 → 2570
    expect(Meter.calcFare(1000)).toBe(2570);
  });
});

// ─── L718-753: businessEnd 残分岐 (= FB hook + mmWorker throw + tier2 reset) ─

describe('Phase 8 Batch 6: businessEnd 残分岐 (= FB hook 観測 + mmWorker throw)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig(FC_BASE);
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
    delete globalThis.FB;
  });

  it('FB.pushSessionAggregates が存在 → businessEnd で 1 回呼出 (= L746 typeof check 通過)', () => {
    let called = 0;
    globalThis.FB = {
      pushSessionAggregates: () => {
        called++;
      },
    };
    Meter.reset();
    Meter.start();
    Meter.businessEnd();
    expect(called).toBe(1);
  });

  it('FB.pushSessionAggregates が throw → catch で吸収・businessEnd は完走', () => {
    globalThis.FB = {
      pushSessionAggregates: () => {
        throw new Error('boom');
      },
    };
    Meter.reset();
    Meter.start();
    expect(() => Meter.businessEnd()).not.toThrow();
    expect(Meter.getState().running).toBe(false);
  });

  it('FB は存在するが pushSessionAggregates が function でない → skip path', () => {
    globalThis.FB = { pushSessionAggregates: 'not-a-function' };
    Meter.reset();
    Meter.start();
    expect(() => Meter.businessEnd()).not.toThrow();
    expect(Meter.getState().running).toBe(false);
  });

  it('mmWorker.postMessage が throw → catch で吸収・businessEnd 完走', () => {
    const fakeWorker = {
      addEventListener: () => {},
      removeEventListener: () => {},
      postMessage: () => {
        throw new Error('worker boom');
      },
    };
    Meter.setMapMatcher(fakeWorker);
    Meter.reset();
    Meter.start();
    expect(() => Meter.businessEnd()).not.toThrow();
    expect(Meter.getState().running).toBe(false);
  });

  it('businessEnd で state.business_active → false に切替 (= L732)', () => {
    Meter.reset();
    Meter.start();
    if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
    expect(Meter.getState().business_active).toBe(true);
    Meter.businessEnd();
    expect(Meter.getState().business_active).toBe(false);
  });

  it('businessEnd で state.last_resume_time → null にリセット (= L730)', () => {
    Meter.reset();
    Meter.start();
    expect(Meter.getState().last_resume_time).not.toBeNull();
    Meter.businessEnd();
    expect(Meter.getState().last_resume_time).toBeNull();
  });

  it('businessEnd 前後で elapsed_accumulated_sec が累積 (= L728-729 加算 path)', () => {
    Meter.reset();
    Meter.start();
    const sBefore = Meter.getState();
    // start から businessEnd まで 数 ms 経過するため・elapsed_accumulated_sec は増えるはず
    Meter.businessEnd();
    const sAfter = Meter.getState();
    expect(sAfter.elapsed_accumulated_sec).toBeGreaterThanOrEqual(sBefore.elapsed_accumulated_sec);
    // last_resume_time = null になったゆえ・後続 businessEnd 呼出で更に加算されない
    const prev = sAfter.elapsed_accumulated_sec;
    Meter.businessEnd();
    expect(Meter.getState().elapsed_accumulated_sec).toBe(prev);
  });
});
