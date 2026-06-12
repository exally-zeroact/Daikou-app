// tests/integration/meter-batch8-cleanup.test.js
//
// ★設計変更宣言 Phase 8 Batch 8 (2026-05-21・残 NoCov + 観測可能 Survived 狙撃):
//   Batch 7 後の状態解析:
//     残 NoCoverage 97 / 残 Survived 487 (= 多くは容認カテゴリ A-F)
//   本 batch は・容認カテゴリ外で観測可能な路を中心に狙撃 (= 労力配分・ROI 重視)。
//
// 対象 line + 推定 mutant 件数:
//   L549-560  _onMmWorkerMessage typeCode 変化 + GPS.setRoadType   (~14 mutants)
//   L562-572  _onMmWorkerMessage committed → FB.markVisited        (~10 mutants)
//   L249-258  setFareConfig _fareConfigFrozen ガード + getFareConfig (~14 mutants)
//   L264-280  setMapMatcher + isMmReady                              (~10 mutants)
//   L836-861  calculateGapFill (= GAP_MAX_SEC / speed<=0 / 160km clamp) (~13 mutants)
//   L224-228  _maxSpeedFor (= calculateGapFill 経由で間接 exercise)   (~10 mutants)
//
// 容認カテゴリ A-F (= Batch 6 統合 docs 参照・本 batch でも kill 対象外):
//   A: state-invariant / B: defense-in-depth / C: 等価ペア (>=0・浮動小数) /
//   D: gate 順序先行発火 / E: 外部依存 noop / F: 時刻依存 (= Batch 6 で kill 済)
//
// ★絶対ルール準拠:
//   prod (js/*) は 1 byte も触らない (= test 追加のみ)。
//   distance_m += 5 経路 / calcFare 加算経路 / commit 機構 完全不変。
//   public API 経由のみ。内部 helper は・public API 経由で間接的に exercise。

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

function makeFakeWorker() {
  let handler = null;
  const sent = [];
  return {
    sent,
    addEventListener: (ev, fn) => {
      if (ev === 'message') handler = fn;
    },
    removeEventListener: () => {
      handler = null;
    },
    postMessage: (m) => sent.push(m),
    _dispatch: (data) => handler && handler({ data }),
    _hasHandler: () => handler !== null,
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

// ─── L549-560 _onMmWorkerMessage typeCode + GPS.setRoadType ─────

describe('Phase 8 Batch 8: _onMmWorkerMessage typeCode → GPS.setRoadType 連携 (= L549-560)', () => {
  let Meter, fakeWorker, gpsCalls;
  beforeEach(() => {
    gpsCalls = [];
    globalThis.GPS = {
      calcDistance: () => 0,
      calcDistance3D: () => 0,
      setRoadType: (code) => gpsCalls.push(code),
    };
    Meter = loadMeter();
    Meter.setFareConfig(FC_BASE);
    fakeWorker = makeFakeWorker();
    Meter.setMapMatcher(fakeWorker);
    Meter.reset();
    Meter.start();
    if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
    fakeWorker._dispatch({ type: 'roadsLoaded', ok: true, pref: 'ehime' });
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('typeCode が初回 → GPS.setRoadType 1 回呼出', () => {
    fakeWorker._dispatch({ type: 'mmResult', snap: { typeCode: 3 } });
    expect(gpsCalls).toEqual([3]);
  });

  it('typeCode 同値で連続 dispatch → 過剰防止で 1 回のみ (= L551 newTypeCode !== _last)', () => {
    fakeWorker._dispatch({ type: 'mmResult', snap: { typeCode: 3 } });
    fakeWorker._dispatch({ type: 'mmResult', snap: { typeCode: 3 } });
    fakeWorker._dispatch({ type: 'mmResult', snap: { typeCode: 3 } });
    expect(gpsCalls).toEqual([3]); // 1 回のみ
  });

  it('typeCode 異値で連続 dispatch → 都度呼出', () => {
    fakeWorker._dispatch({ type: 'mmResult', snap: { typeCode: 3 } });
    fakeWorker._dispatch({ type: 'mmResult', snap: { typeCode: 5 } });
    fakeWorker._dispatch({ type: 'mmResult', snap: { typeCode: 7 } });
    expect(gpsCalls).toEqual([3, 5, 7]);
  });

  it('snap.typeCode = null → GPS.setRoadType 呼ばれない (= L549 typeCode != null ガード)', () => {
    fakeWorker._dispatch({ type: 'mmResult', snap: { typeCode: null } });
    expect(gpsCalls).toEqual([]);
  });

  it('snap.typeCode = undefined → GPS.setRoadType 呼ばれない', () => {
    fakeWorker._dispatch({ type: 'mmResult', snap: {} });
    expect(gpsCalls).toEqual([]);
  });

  it('snap = undefined → GPS.setRoadType 呼ばれない (= L549 m.snap ガード)', () => {
    fakeWorker._dispatch({ type: 'mmResult' });
    expect(gpsCalls).toEqual([]);
  });

  it('typeCode 0 (= falsy だが != null) → 呼出される', () => {
    fakeWorker._dispatch({ type: 'mmResult', snap: { typeCode: 0 } });
    expect(gpsCalls).toEqual([0]);
  });

  it('GPS.setRoadType が throw → catch で吸収・後続 dispatch も継続', () => {
    globalThis.GPS.setRoadType = () => {
      throw new Error('boom');
    };
    expect(() => {
      fakeWorker._dispatch({ type: 'mmResult', snap: { typeCode: 3 } });
    }).not.toThrow();
  });

  it('GPS = undefined → typeof check で skip path', () => {
    delete globalThis.GPS;
    expect(() => {
      fakeWorker._dispatch({ type: 'mmResult', snap: { typeCode: 3 } });
    }).not.toThrow();
  });

  it('GPS.setRoadType = non-function → typeof check で skip path', () => {
    globalThis.GPS.setRoadType = 'not-a-function';
    expect(() => {
      fakeWorker._dispatch({ type: 'mmResult', snap: { typeCode: 3 } });
    }).not.toThrow();
  });
});

// ─── L562-572 _onMmWorkerMessage committed → FB.markVisited ─────

describe('Phase 8 Batch 8: _onMmWorkerMessage committed → FB.markVisited 連携 (= L562-572)', () => {
  let Meter, fakeWorker, fbCalls;
  beforeEach(() => {
    mockGPS();
    fbCalls = [];
    globalThis.FB = {
      markVisited: (pref, ri) => fbCalls.push({ pref, ri }),
    };
    Meter = loadMeter();
    Meter.setFareConfig(FC_BASE);
    fakeWorker = makeFakeWorker();
    Meter.setMapMatcher(fakeWorker);
    Meter.reset();
    Meter.start();
    if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
    fakeWorker._dispatch({ type: 'roadsLoaded', ok: true, pref: 'ehime' });
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
    delete globalThis.FB;
  });

  it('committed=true + prefecture + roadIndex → FB.markVisited 呼出', () => {
    fakeWorker._dispatch({
      type: 'mmResult',
      committed: true,
      snap: { prefecture: 'ehime', roadIndex: 42 },
    });
    expect(fbCalls).toEqual([{ pref: 'ehime', ri: 42 }]);
  });

  it('committed=false → 呼ばれない (= L564 ガード)', () => {
    fakeWorker._dispatch({
      type: 'mmResult',
      committed: false,
      snap: { prefecture: 'ehime', roadIndex: 42 },
    });
    expect(fbCalls).toEqual([]);
  });

  it('snap.prefecture = undefined → 呼ばれない', () => {
    fakeWorker._dispatch({
      type: 'mmResult',
      committed: true,
      snap: { roadIndex: 42 },
    });
    expect(fbCalls).toEqual([]);
  });

  it('snap.roadIndex = null → 呼ばれない (= != null ガード)', () => {
    fakeWorker._dispatch({
      type: 'mmResult',
      committed: true,
      snap: { prefecture: 'ehime', roadIndex: null },
    });
    expect(fbCalls).toEqual([]);
  });

  it('snap = undefined → 呼ばれない', () => {
    fakeWorker._dispatch({ type: 'mmResult', committed: true });
    expect(fbCalls).toEqual([]);
  });

  it('FB.markVisited が throw → catch で吸収', () => {
    globalThis.FB.markVisited = () => {
      throw new Error('fb boom');
    };
    expect(() => {
      fakeWorker._dispatch({
        type: 'mmResult',
        committed: true,
        snap: { prefecture: 'ehime', roadIndex: 42 },
      });
    }).not.toThrow();
  });

  it('FB = undefined → typeof check で skip', () => {
    delete globalThis.FB;
    expect(() => {
      fakeWorker._dispatch({
        type: 'mmResult',
        committed: true,
        snap: { prefecture: 'ehime', roadIndex: 42 },
      });
    }).not.toThrow();
  });

  it('FB.markVisited = non-function → typeof check で skip', () => {
    globalThis.FB.markVisited = 'not-a-function';
    expect(() => {
      fakeWorker._dispatch({
        type: 'mmResult',
        committed: true,
        snap: { prefecture: 'ehime', roadIndex: 42 },
      });
    }).not.toThrow();
  });

  it('roadIndex = 0 (= falsy だが != null) → 呼出される', () => {
    fakeWorker._dispatch({
      type: 'mmResult',
      committed: true,
      snap: { prefecture: 'ehime', roadIndex: 0 },
    });
    expect(fbCalls).toEqual([{ pref: 'ehime', ri: 0 }]);
  });
});

// ─── L249-258 setFareConfig _fareConfigFrozen ガード ─────────────

describe('Phase 8 Batch 8: setFareConfig 業務凍結 + getFareConfig (= L249-258)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('業務外 setFareConfig → 反映される', () => {
    Meter.setFareConfig({ ...FC_BASE, base_fare: 1500 });
    expect(Meter.getFareConfig().base_fare).toBe(1500);
  });

  it('業務中 (= start() で frozen) setFareConfig → 無視される (= L250-253 早期 return)', () => {
    Meter.setFareConfig({ ...FC_BASE, base_fare: 1300 });
    Meter.reset();
    Meter.start();
    Meter.setFareConfig({ ...FC_BASE, base_fare: 9999 });
    expect(Meter.getFareConfig().base_fare).toBe(1300); // frozen のため不変
  });

  it('businessEnd 後 setFareConfig → 解凍されて反映 (= L733 _fareConfigFrozen=false)', () => {
    Meter.setFareConfig({ ...FC_BASE, base_fare: 1300 });
    Meter.reset();
    Meter.start();
    Meter.businessEnd();
    Meter.setFareConfig({ ...FC_BASE, base_fare: 2000 });
    expect(Meter.getFareConfig().base_fare).toBe(2000); // 解凍後反映
  });

  it('setFareConfig は spread でマージ (= 既存 key 維持 + 新 key 上書き)', () => {
    Meter.setFareConfig({ ...FC_BASE, base_fare: 1300, add_fare: 100 });
    Meter.setFareConfig({ add_fare: 200 });
    const cfg = Meter.getFareConfig();
    expect(cfg.base_fare).toBe(1300); // 既存維持
    expect(cfg.add_fare).toBe(200); // 上書き
  });

  it('getFareConfig は clone を返す (= 呼出側の改変で内部 state 不変)', () => {
    Meter.setFareConfig({ ...FC_BASE, base_fare: 1300 });
    const c1 = Meter.getFareConfig();
    c1.base_fare = 9999; // 外部改変
    const c2 = Meter.getFareConfig();
    expect(c2.base_fare).toBe(1300); // 不変
  });
});

// ─── L264-280 setMapMatcher + isMmReady ────────────────────────

describe('Phase 8 Batch 8: setMapMatcher + isMmReady (= L264-280)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig(FC_BASE);
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('setMapMatcher(null) → mmWorker = null・isMmReady() falsy', () => {
    Meter.setMapMatcher(null);
    expect(Meter.isMmReady()).toBeFalsy();
  });

  it('setMapMatcher(worker) → addEventListener "message" 呼出', () => {
    const fakeWorker = makeFakeWorker();
    Meter.setMapMatcher(fakeWorker);
    expect(fakeWorker._hasHandler()).toBe(true);
  });

  it('旧 worker → 新 worker 切替: 旧 removeEventListener 呼出', () => {
    const w1 = makeFakeWorker();
    Meter.setMapMatcher(w1);
    expect(w1._hasHandler()).toBe(true);
    const w2 = makeFakeWorker();
    Meter.setMapMatcher(w2);
    expect(w1._hasHandler()).toBe(false); // 旧 removeEventListener で剥がれた
    expect(w2._hasHandler()).toBe(true);
  });

  it('isMmReady: worker 有 + roadsLoaded 無 → falsy (= _workerLoadedPrefs.size=0)', () => {
    Meter.setMapMatcher(makeFakeWorker());
    expect(Meter.isMmReady()).toBeFalsy();
  });

  it('isMmReady: worker 有 + roadsLoaded 1 件 → true', () => {
    const w = makeFakeWorker();
    Meter.setMapMatcher(w);
    Meter.reset();
    Meter.start();
    w._dispatch({ type: 'roadsLoaded', ok: true, pref: 'ehime' });
    expect(Meter.isMmReady()).toBe(true);
  });

  it('新 worker 起動で・_workerLoadedPrefs リセット (= L273)', () => {
    const w1 = makeFakeWorker();
    Meter.setMapMatcher(w1);
    Meter.reset();
    Meter.start();
    w1._dispatch({ type: 'roadsLoaded', ok: true, pref: 'ehime' });
    expect(Meter.isMmReady()).toBe(true);
    Meter.setMapMatcher(makeFakeWorker());
    expect(Meter.isMmReady()).toBe(false); // 新 worker は roadsLoaded 未受信
  });

  it('旧 worker.removeEventListener throw → setMapMatcher 完走', () => {
    const w1 = {
      addEventListener: () => {},
      removeEventListener: () => {
        throw new Error('rm boom');
      },
      postMessage: () => {},
    };
    Meter.setMapMatcher(w1);
    expect(() => Meter.setMapMatcher(makeFakeWorker())).not.toThrow();
  });
});

// ★白紙書き直し (2026-05-30・clean-rebuild-pipeline): calculateGapFill via update() の describe ブロックは
//   gap fill helper が新メーターで廃止 (= pipeline-distance が gap を道路 routing で内部処理) のため削除。
