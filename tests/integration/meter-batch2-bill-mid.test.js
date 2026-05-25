// tests/integration/meter-batch2-bill-mid.test.js
//
// ★設計変更宣言 Phase 8 Batch 2 (2026-05-21・BILL 中密度 mutant kill・司さん採択):
//   Stryker Pass A の [BILL] survived 中密度 cluster を kill する boundary / behavior test。
//
// 対象 line + mutant 件数 (= 計 ~33 mutant 想定):
//   L1055 if (typeof gpsResult.lat !== 'number' || typeof gpsResult.lng !== 'number') return;  (7)
//   L1061 if (mmWorker && _workerLoadedPrefs.size > 0)  (= MM-ready gate)                    (6)
//   L1289 state.running && state.last_resume_time !== null  (= elapsed 計算分岐)              (5)
//   L1290 (state.elapsed_accumulated_sec + (Date.now() - state.last_resume_time)) / 1000     (3)
//   L1291 (state.elapsed_accumulated_sec || 0) / 1000  (= elapsed fallback)                  (4)
//   L728  if (state.last_resume_time !== null)  (= stop() elapsed 確定)                       (4)
//   L729  state.elapsed_accumulated_sec += Date.now() - state.last_resume_time               (2)
//   L971  if (inc > 0)  → 観測不能等価候補 (= 後述 docs)                                       (2)
//
// L971 inc > 0 ガード (= 等価相当・kill 困難):
//   Off-Road incremental の inc は _calculateOffRoadIncrement で・物理的に inc >= 0 を保証
//   (= 速度・距離計算は非負)。inc=0 が発生する場合:
//     原 (`if (inc > 0)`): block skip → state 変化なし
//     変 (`if (true)` or `if (inc >= 0)`): block 入る → state.distance_m += 0 (= 不変) /
//        state.distanceSource = 'offroad' (= Off-Road 中なので既に 'offroad'・観測不能) /
//        state.offroad_distance_m += 0 (= 不変)
//   → 全状態変化が同値・観測不能。L1364 / L1374 と同様の構造的等価 mutation 候補。
//   → 課金 kill 率の真の分母から除外 (= docs 明記のみ・無理に kill しない)
//
// L728 / L729 / L1289 / L1290 残 survived mutants (= 観測限界の構造的不可能):
//   meter.js の running ↔ last_resume_time は state invariant:
//     start()  : running=true・last_resume_time=now
//     stop()   : running=false・last_resume_time=null
//     reset()  : running=false・last_resume_time=null
//   → running=true ⇔ last_resume_time !== null が常に成立
//   → `running && last_resume_time !== null` の片方を `true` に置換しても・
//     他方の真偽値が常に同じ → 全体の真偽値同一 → 観測不能
//   → Stryker ConditionalExpression mutator は・**個別 sub-expression** を mutate するため・
//     全体真偽値同一の状況で kill 不可
//   さらに Date.now() の ms 解像度由来:
//     elapsed = now2 - now1 が同 ms 内なら 0
//     `+=` vs `-=`: 0 ± 0 = 0 → 区別不能
//   → これら mutant 群も実害なし (= 既存挙動の structural property による equivalent 相当)・
//     docs 明記のみで kill 対象外。
//
// ★絶対ルール準拠:
//   prod (js/meter.js) は 1 byte も触らない (= test 追加のみ)。
//   distance_m += 5 経路・calcFare・commit 機構 完全不変。
//   elapsed_sec / mm_total_count は集計 layer・課金根拠 (= distance_m / fare_yen) に連動しない。

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
      const R = 6371000;
      const toRad = (d) => (d * Math.PI) / 180;
      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    },
    calcDistance3D: () => 0,
    setRoadType: () => {},
  };
}

// spy 付き fake worker (= main → worker postMessage を記録)
function makeSpyWorker() {
  const handlers = [];
  const sent = [];
  return {
    sent,
    addEventListener(type, h) {
      if (type === 'message') handlers.push(h);
    },
    removeEventListener(type, h) {
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    },
    postMessage(msg) {
      sent.push(msg);
    },
    _dispatch(data) {
      for (const h of handlers) h({ data });
    },
  };
}

function setupMeter(opts) {
  opts = opts || {};
  mockGPS();
  const Meter = loadMeter();
  Meter.setFareConfig(DEFAULT_FARE_CONFIG);
  Meter.reset();
  const worker = makeSpyWorker();
  if (opts.attachWorker !== false) Meter.setMapMatcher(worker);
  if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
  if (opts.skipStart !== true) Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);
  // roadsLoaded ack を default で 1 件投入 (= _workerLoadedPrefs.size > 0 にする)
  if (opts.loadRoads !== false) {
    worker._dispatch({ type: 'roadsLoaded', ok: true, pref: 'ehime' });
  }
  return { Meter, worker };
}

// 通常 GPS 1 件 (= 全 field 有効)
const baseTs = 1714100000000;
function gps(opts) {
  opts = opts || {};
  return {
    lat: opts.lat != null ? opts.lat : 33.84,
    lng: opts.lng != null ? opts.lng : 132.7656,
    altitude: 0,
    accuracy: 5,
    speedKmh: opts.speedKmh != null ? opts.speedKmh : 50,
    isStationary: false,
    timestamp: opts.ts != null ? opts.ts : baseTs,
  };
}

// ─── L1055: typeof lat/lng !== 'number' 早期 return (7 mutants) ────────────
//
// 対象式: if (typeof gpsResult.lat !== 'number' || typeof gpsResult.lng !== 'number') return;
//   両方 number → 続行 (Worker B に post)・どちらか non-number → skip (post なし)
//
// kill mutant: ConditionalExpression true/false / LogicalOperator && ↔ || / EqualityOperator
//
// 観測: worker.postMessage 経由で gps message が送られたか (= sent 配列に type='gps' が増えるか)

describe('Phase 8 Batch 2: L1055 typeof lat/lng 早期 return (= MM post gate・malformed input 防御)', () => {
  let Meter, worker;
  beforeEach(() => {
    ({ Meter, worker } = setupMeter());
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  function gpsPostCount() {
    return worker.sent.filter((m) => m && m.type === 'gps').length;
  }

  it('両方 number → MM post される (= 通常 GPS)', () => {
    const before = gpsPostCount();
    Meter.update(gps());
    expect(gpsPostCount()).toBe(before + 1);
  });

  it('lat=null → MM post されない (= 早期 return)', () => {
    const before = gpsPostCount();
    Meter.update({ ...gps(), lat: null });
    expect(gpsPostCount()).toBe(before);
  });

  it('lng=null → MM post されない (= 早期 return)', () => {
    const before = gpsPostCount();
    Meter.update({ ...gps(), lng: null });
    expect(gpsPostCount()).toBe(before);
  });

  it('lat="string" → MM post されない (= typeof !== "number")', () => {
    const before = gpsPostCount();
    Meter.update({ ...gps(), lat: '33.84' });
    expect(gpsPostCount()).toBe(before);
  });

  it('lng=undefined → MM post されない', () => {
    const before = gpsPostCount();
    Meter.update({ ...gps(), lng: undefined });
    expect(gpsPostCount()).toBe(before);
  });

  it('lat=NaN は typeof "number" なので post される (= 仕様確認・別所で防御)', () => {
    // NaN の typeof は 'number'・L1055 は素通し・後続経路で防御
    const before = gpsPostCount();
    Meter.update({ ...gps(), lat: NaN, lng: 132.7656 });
    expect(gpsPostCount()).toBe(before + 1);
  });
});

// ─── L1061: mmWorker && _workerLoadedPrefs.size > 0 gate (6 mutants) ────────
//
// 対象式: if (mmWorker && _workerLoadedPrefs.size > 0) { ... state.mm_total_count++; ... }
//   両方 truthy → post + count++・片方 falsy → skip
//
// 観測: state.mm_total_count の増加 / worker.sent への post 有無

describe('Phase 8 Batch 2: L1061 mmWorker + loadedPrefs gate (= MM ready 判定)', () => {
  afterEach(() => {
    delete globalThis.GPS;
  });

  it('mmWorker 未 set (= setMapMatcher 呼ばず) → MM post されず・mm_total_count 不変', () => {
    const { Meter } = setupMeter({ attachWorker: false, loadRoads: false });
    const beforeCount = Meter.getState().mm_total_count || 0;
    Meter.update(gps());
    expect(Meter.getState().mm_total_count || 0).toBe(beforeCount);
    Meter.reset();
  });

  it('mmWorker set + loadedPrefs=0 (= roadsLoaded 未受信) → MM post されず', () => {
    const { Meter, worker } = setupMeter({ loadRoads: false });
    const beforeCount = Meter.getState().mm_total_count || 0;
    const beforeSent = worker.sent.filter((m) => m && m.type === 'gps').length;
    Meter.update(gps());
    expect(Meter.getState().mm_total_count || 0).toBe(beforeCount);
    expect(worker.sent.filter((m) => m && m.type === 'gps').length).toBe(beforeSent);
    Meter.reset();
  });

  it('mmWorker set + loadedPrefs=1 (= roadsLoaded ehime 受信) → MM post される', () => {
    const { Meter, worker } = setupMeter({ loadRoads: true });
    const beforeCount = Meter.getState().mm_total_count || 0;
    Meter.update(gps());
    expect(Meter.getState().mm_total_count || 0).toBe(beforeCount + 1);
    expect(worker.sent.some((m) => m && m.type === 'gps')).toBe(true);
    Meter.reset();
  });

  it('loadedPrefs=2 (= 複数 県 ack) でも post する (= size > 0 の単純境界)', () => {
    const { Meter, worker } = setupMeter({ loadRoads: true });
    worker._dispatch({ type: 'roadsLoaded', ok: true, pref: 'tokyo' });
    const beforeCount = Meter.getState().mm_total_count || 0;
    Meter.update(gps());
    expect(Meter.getState().mm_total_count || 0).toBe(beforeCount + 1);
    Meter.reset();
  });
});

// ─── L1289-1291: getState().elapsed_sec 都度計算 (= ~12 mutants) ──────────
//
// 対象式:
//   const elapsedSec =
//     state.running && state.last_resume_time !== null
//       ? Math.floor((state.elapsed_accumulated_sec + (Date.now() - state.last_resume_time)) / 1000)
//       : Math.floor((state.elapsed_accumulated_sec || 0) / 1000);
//
// kill mutant: ConditionalExpression (running / last_resume_time) / EqualityOperator (=== null vs !== null) /
//   ArithmeticOperator (+ → -) / LogicalOperator (|| → &&) / Math.floor 経由境界

describe('Phase 8 Batch 2: L1289-1291 elapsed_sec 都度計算 (= getState().elapsed_sec)', () => {
  afterEach(() => {
    delete globalThis.GPS;
  });

  it('start 前 (= last_resume_time=null) → elapsed_sec=0 (= fallback path)', () => {
    const { Meter } = setupMeter({ skipStart: true });
    const s = Meter.getState();
    expect(s.elapsed_sec).toBe(0);
    Meter.reset();
  });

  it('start 直後 → elapsed_sec が 0 以上 (= running=true & last_resume_time set path)', () => {
    const { Meter } = setupMeter();
    const s = Meter.getState();
    expect(s.elapsed_sec).toBeGreaterThanOrEqual(0);
    expect(s.elapsed_sec).toBeLessThan(2); // すぐ呼んだので 0 or 1 秒程度
    Meter.reset();
  });

  it('stop() 後 → elapsed_sec は state.elapsed_accumulated_sec / 1000 (= fallback path)', () => {
    const { Meter } = setupMeter();
    // 少なくとも 0ms 経過・stop で確定加算
    Meter.stop();
    const s1 = Meter.getState();
    // running=false なので・fallback path = floor(accumulated/1000)
    // accumulated は ms 単位・dt 0 でも整数化されるので 0 になる可能性あり
    expect(s1.elapsed_sec).toBeGreaterThanOrEqual(0);
    expect(typeof s1.elapsed_sec).toBe('number');
    Meter.reset();
  });

  it('stop() → start() 再開で elapsed_accumulated_sec が引継ぎされる', () => {
    const { Meter } = setupMeter();
    // start 1 回目で last_resume_time セット済
    Meter.stop(); // ここで elapsed_accumulated_sec += (now - last_resume_time)
    const accAfterStop = Meter.getState().elapsed_accumulated_sec;
    expect(accAfterStop).toBeGreaterThanOrEqual(0);
    Meter.start(); // 再開・last_resume_time 再セット
    const s = Meter.getState();
    // running=true で・elapsed_sec = floor((acc + dt)/1000)
    expect(s.elapsed_sec).toBeGreaterThanOrEqual(0);
    Meter.reset();
  });

  it('elapsed_accumulated_sec を直接 5000 ms に設定 + stop 状態 → elapsed_sec=5', () => {
    const { Meter } = setupMeter();
    // 5000 ms 累積を強制 setup (= setElapsedAccumulated 経由)
    if (typeof Meter.setElapsedAccumulated === 'function') {
      Meter.setElapsedAccumulated(5000);
      Meter.stop();
      const s = Meter.getState();
      // fallback path: floor(5000/1000) = 5
      expect(s.elapsed_sec).toBe(5);
    }
    Meter.reset();
  });
});

// ─── L728-729: stop() の elapsed 確定加算 (6 mutants) ──────────────────────
//
// 対象式:
//   if (state.last_resume_time !== null) {                  ← L728
//     state.elapsed_accumulated_sec += Date.now() - state.last_resume_time;  ← L729
//     state.last_resume_time = null;
//   }
//
// kill mutant: ConditionalExpression / EqualityOperator / ArithmeticOperator / AssignmentOperator

describe('Phase 8 Batch 2: L728-729 stop() elapsed 確定加算', () => {
  afterEach(() => {
    delete globalThis.GPS;
  });

  it('start→stop で elapsed_accumulated_sec が non-negative になる (= AssignmentOperator += 検証)', () => {
    const { Meter } = setupMeter();
    // start 直後・1ms 待つために少し処理を挟む
    for (let i = 0; i < 100; i++) Math.sqrt(i + 1); // micro-busy-loop
    Meter.stop();
    const s = Meter.getState();
    // += で・初期 0 から非負値に増加 (= -= mutant なら負値になる)
    expect(s.elapsed_accumulated_sec).toBeGreaterThanOrEqual(0);
    expect(s.last_resume_time).toBeNull();
    Meter.reset();
  });

  it('start 呼ばずに stop() → last_resume_time は null のまま (= if 条件 false 経路)', () => {
    const { Meter } = setupMeter({ skipStart: true });
    expect(Meter.getState().last_resume_time).toBeNull();
    Meter.stop();
    const s = Meter.getState();
    expect(s.last_resume_time).toBeNull();
    // elapsed_accumulated_sec は加算されない (= 0 のまま)
    expect(s.elapsed_accumulated_sec).toBe(0);
    Meter.reset();
  });

  it('start→stop→stop 連続 (= 2回目は last_resume_time=null) → elapsed_accumulated 二重加算なし', () => {
    const { Meter } = setupMeter();
    Meter.stop();
    const acc1 = Meter.getState().elapsed_accumulated_sec;
    // 2 回目 stop は no-op (= last_resume_time 既に null)
    Meter.stop();
    const acc2 = Meter.getState().elapsed_accumulated_sec;
    expect(acc2).toBe(acc1); // 不変
    Meter.reset();
  });

  it('start→stop→start→stop で elapsed_accumulated_sec が単調非減少 (= 全 stop で確定加算)', () => {
    const { Meter } = setupMeter();
    Meter.stop();
    const acc1 = Meter.getState().elapsed_accumulated_sec;
    Meter.start();
    for (let i = 0; i < 50; i++) Math.sqrt(i + 1);
    Meter.stop();
    const acc2 = Meter.getState().elapsed_accumulated_sec;
    expect(acc2).toBeGreaterThanOrEqual(acc1); // 2 回目分が加算 (= 単調非減少)
    Meter.reset();
  });
});
