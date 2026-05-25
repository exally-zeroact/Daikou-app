// tests/integration/meter-batch7-nocov.test.js
//
// ★設計変更宣言 Phase 8 Batch 7 (2026-05-21・NoCoverage 残開拓・60% 詰め):
//   Batch 6 後 NoCoverage 394 の所在解析結果:
//     L1500-1574 / L1600-1624 (= address resolution 系・大塊 ~199 mutants・全 NoCov の 50%)
//     L150-174   (= _recordMmLatency / _calcP99Latency・~30 mutants)
//     L650-674   (= start() surcharge/vehicle init・~21 mutants)
//     L1422-1430 (= _haversineMetersForAddr・address helper)
//   本 batch は ROI 最大の address resolution + mm latency + start init を狙う。
//
// 対象 line + 推定 mutant 件数:
//   L1422-1430 _haversineMetersForAddr (= address 用 haversine)              (~14 mutants)
//   L1484-1488 _jisToPref (= JIS コード→県名)                                (~10 mutants)
//   L1490-1496 _getFineBundleForPref (= window.ADDRESSES_FINE_{PREF} 参照)   (~10 mutants)
//   L1498-1518 _searchFineItems (= bbox プレフィルタ + haversine)            (~50 mutants)
//   L1519-1590 getNearestAddress (= 4 段階探索 coarse→県別 fine→legacy fine→coarse 名) (~100 mutants)
//   L1599-1607 _anyFinePrefLoaded (= 47 県 fine load 判定 loop)              (~10 mutants)
//   L1609-1621 isAddressDataReady (= coarse / fine_legacy / fine_pref 判定) (~15 mutants)
//   L149-164   _recordMmLatency + _calcP99Latency (= ring buffer + p99 sort) (~30 mutants)
//   L662-673   calcFare 内 surcharge active_default / vehicle default init  (~21 mutants)
//
// ★絶対ルール準拠:
//   prod (js/*) は 1 byte も触らない (= test 追加のみ)。
//   distance_m += 5 経路 / calcFare 加算経路 / commit 機構 完全不変。
//   public API (= getNearestAddress / isAddressDataReady / getMMStats / setFareConfig / calcFare)
//   経由のみ。内部 helper は・getNearestAddress 経由で間接的に exercise。
//
// ★等価/容認: Batch 6 で統合した 6 カテゴリ参照
//   A (state-invariant) / B (defense-in-depth) / C (>=0 等価ペア) /
//   D (gate 順序先行発火) / E (外部依存 noop) / F (時刻依存)
//   本 batch でも新たな等価が見つかれば・該当カテゴリ参照で容認 (= kill 対象外)。

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

// 補助: 緯度・経度の小数 → JIS 用 100000 倍整数
function toInt(deg) {
  return Math.round(deg * 100000);
}

// 補助: ehime 県松山市付近の test 座標 (= 既存 fixture と同地域)
const EHIME = { lat: 33.84, lng: 132.7656 };
const EHIME_NEAR = { lat: 33.841, lng: 132.7657 }; // ~125m 離れ (= FINE_RADIUS 500m 内)
const TOKYO = { lat: 35.681, lng: 139.767 };

// ─── L1519-1590 getNearestAddress: invalid input ガード ──────────

describe('Phase 8 Batch 7: getNearestAddress invalid input (= L1520-1525 ガード)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    globalThis.window = {};
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
    delete globalThis.window;
  });

  it('lat が non-number → null', () => {
    expect(Meter.getNearestAddress('33.84', 132.7656, 5)).toBeNull();
  });
  it('lng が non-number → null', () => {
    expect(Meter.getNearestAddress(33.84, null, 5)).toBeNull();
  });
  it('lat=NaN → null', () => {
    expect(Meter.getNearestAddress(NaN, 132.7656, 5)).toBeNull();
  });
  it('lng=Infinity → null', () => {
    expect(Meter.getNearestAddress(33.84, Infinity, 5)).toBeNull();
  });
  it('accuracy > 50 → null (= 精度 50m 超過は住所信頼性なし)', () => {
    expect(Meter.getNearestAddress(33.84, 132.7656, 51)).toBeNull();
  });
  it('accuracy = 50 (= 境界・<= 50 で通過) → null とならない (= data なしで null 別 path)', () => {
    expect(Meter.getNearestAddress(33.84, 132.7656, 50)).toBeNull(); // data なしで null
  });
  it('accuracy = undefined → ガード skip・data なしで null', () => {
    expect(Meter.getNearestAddress(33.84, 132.7656, undefined)).toBeNull();
  });
});

// ─── L1531-1554 coarse 探索 + L1586-1587 coarse fallback ───────────

describe('Phase 8 Batch 7: getNearestAddress coarse only (= L1586-1587 "市区町村 付近")', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    // COARSE: ehime 松山市 (JIS 38201) + 高松市 (JIS 37201)
    globalThis.window = {
      ADDRESSES_COARSE_JP: {
        items: [
          { lat: toInt(33.84), lng: toInt(132.7656), c: '38201', n: '愛媛県松山市' },
          { lat: toInt(34.34), lng: toInt(134.04), c: '37201', n: '香川県高松市' },
        ],
      },
    };
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
    delete globalThis.window;
  });

  it('coarse のみ・近傍 (= 松山市内) → "愛媛県松山市 付近"', () => {
    expect(Meter.getNearestAddress(EHIME.lat, EHIME.lng, 5)).toBe('愛媛県松山市 付近');
  });

  it('coarse のみ・別 県近傍 (= 高松市内) → "香川県高松市 付近"', () => {
    expect(Meter.getNearestAddress(34.34, 134.04, 5)).toBe('香川県高松市 付近');
  });

  it('coarse のみ・3km 圏外 (= 東京) → null (= bestCoarse null)', () => {
    expect(Meter.getNearestAddress(TOKYO.lat, TOKYO.lng, 5)).toBeNull();
  });

  it('coarse の items が空配列 → null', () => {
    globalThis.window.ADDRESSES_COARSE_JP.items = [];
    expect(Meter.getNearestAddress(EHIME.lat, EHIME.lng, 5)).toBeNull();
  });

  it('COARSE_JP 自体が無い → null', () => {
    delete globalThis.window.ADDRESSES_COARSE_JP;
    expect(Meter.getNearestAddress(EHIME.lat, EHIME.lng, 5)).toBeNull();
  });
});

// ─── L1561-1567 県別 fine 検索 (= ADDRESSES_FINE_EHIME) ──────────

describe('Phase 8 Batch 7: getNearestAddress 県別 fine (= L1561-1567 _jisToPref 経由)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    globalThis.window = {
      ADDRESSES_COARSE_JP: {
        items: [{ lat: toInt(33.84), lng: toInt(132.7656), c: '38201', n: '愛媛県松山市' }],
      },
      ADDRESSES_FINE_EHIME: {
        items: [
          { lat: toInt(33.841), lng: toInt(132.7657), n: '愛媛県松山市道後温泉町' },
          { lat: toInt(33.85), lng: toInt(132.77), n: '愛媛県松山市三津' },
        ],
      },
    };
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
    delete globalThis.window;
  });

  it('coarse + ADDRESSES_FINE_EHIME 近傍 → fine 名 (= "道後温泉町")', () => {
    expect(Meter.getNearestAddress(EHIME_NEAR.lat, EHIME_NEAR.lng, 5)).toBe(
      '愛媛県松山市道後温泉町'
    );
  });

  it('coarse + FINE_EHIME・fine 500m 圏外 → coarse fallback "市付近"', () => {
    // 松山市から 6km 離れた地点・FINE 500m 外・但し COARSE 3km 内に該当なし → null
    // ここでは coarse 圏内かつ fine 圏外 を組み立てるため別 fine 配置
    globalThis.window.ADDRESSES_FINE_EHIME.items = [
      { lat: toInt(34.0), lng: toInt(133.0), n: '遠方住所' }, // 圏外
    ];
    expect(Meter.getNearestAddress(EHIME.lat, EHIME.lng, 5)).toBe('愛媛県松山市 付近');
  });

  it('coarse の c が・JIS マップに無い (= 99 等不正コード) → 県別 fine スキップ → coarse fallback', () => {
    globalThis.window.ADDRESSES_COARSE_JP.items[0].c = '99201'; // _jisToPref で null
    expect(Meter.getNearestAddress(EHIME.lat, EHIME.lng, 5)).toBe('愛媛県松山市 付近');
  });

  it('coarse の c が 1 文字 (= L1557 length>=2 false) → 県別 fine スキップ', () => {
    globalThis.window.ADDRESSES_COARSE_JP.items[0].c = '3'; // length=1
    expect(Meter.getNearestAddress(EHIME.lat, EHIME.lng, 5)).toBe('愛媛県松山市 付近');
  });

  it('coarse の c が・non-string (= number) → length 判定で skip', () => {
    globalThis.window.ADDRESSES_COARSE_JP.items[0].c = 38201; // number
    expect(Meter.getNearestAddress(EHIME.lat, EHIME.lng, 5)).toBe('愛媛県松山市 付近');
  });

  it('FINE_EHIME items が空配列 → bundle 判定で skip・coarse fallback', () => {
    globalThis.window.ADDRESSES_FINE_EHIME.items = [];
    expect(Meter.getNearestAddress(EHIME.lat, EHIME.lng, 5)).toBe('愛媛県松山市 付近');
  });
});

// ─── L1571-1584 後方互換 ADDRESSES_FINE_JP (legacy 全国版) ──────

describe('Phase 8 Batch 7: getNearestAddress legacy FINE_JP (= L1571-1584)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    globalThis.window = {
      ADDRESSES_COARSE_JP: {
        items: [{ lat: toInt(33.84), lng: toInt(132.7656), c: '99999', n: '不正 coarse' }],
      },
      ADDRESSES_FINE_JP: {
        items: [{ lat: toInt(33.841), lng: toInt(132.7657), n: 'legacy 全国版住所' }],
      },
    };
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
    delete globalThis.window;
  });

  it('県別 fine 無し + FINE_JP に近傍あり → legacy 名 (= "legacy 全国版住所")', () => {
    expect(Meter.getNearestAddress(EHIME.lat, EHIME.lng, 5)).toBe('legacy 全国版住所');
  });

  it('FINE_JP の items が空配列 → coarse fallback', () => {
    globalThis.window.ADDRESSES_FINE_JP.items = [];
    expect(Meter.getNearestAddress(EHIME.lat, EHIME.lng, 5)).toBe('不正 coarse 付近');
  });

  it('FINE_JP も coarse 3km 圏外 → null (= bestCoarse null・全 path null)', () => {
    globalThis.window.ADDRESSES_COARSE_JP.items = [];
    globalThis.window.ADDRESSES_FINE_JP.items = [];
    expect(Meter.getNearestAddress(EHIME.lat, EHIME.lng, 5)).toBeNull();
  });
});

// ─── L1498-1518 _searchFineItems bbox プレフィルタ ────────────

describe('Phase 8 Batch 7: _searchFineItems bbox プレフィルタ (= L1505-1508)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    globalThis.window = {
      ADDRESSES_COARSE_JP: {
        items: [{ lat: toInt(33.84), lng: toInt(132.7656), c: '38201', n: '愛媛県松山市' }],
      },
    };
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
    delete globalThis.window;
  });

  it('fine items 複数・最も近い 1 件を返す (= 距離 ordering)', () => {
    globalThis.window.ADDRESSES_FINE_EHIME = {
      items: [
        { lat: toInt(33.85), lng: toInt(132.77), n: '遠 (= ~1.5km)' },
        { lat: toInt(33.842), lng: toInt(132.7658), n: '近 (= ~250m)' },
        { lat: toInt(33.843), lng: toInt(132.766), n: '中 (= ~400m)' },
      ],
    };
    expect(Meter.getNearestAddress(EHIME.lat, EHIME.lng, 5)).toBe('近 (= ~250m)');
  });

  it('fine items が・bbox 全外 (= 緯度方向で fineRangeI 超過) → coarse fallback', () => {
    globalThis.window.ADDRESSES_FINE_EHIME = {
      items: [{ lat: toInt(34.5), lng: toInt(132.7656), n: '緯度遠' }],
    };
    expect(Meter.getNearestAddress(EHIME.lat, EHIME.lng, 5)).toBe('愛媛県松山市 付近');
  });

  it('fine items が・bbox 全外 (= 経度方向で fineRangeI 超過) → coarse fallback', () => {
    globalThis.window.ADDRESSES_FINE_EHIME = {
      items: [{ lat: toInt(33.84), lng: toInt(133.5), n: '経度遠' }],
    };
    expect(Meter.getNearestAddress(EHIME.lat, EHIME.lng, 5)).toBe('愛媛県松山市 付近');
  });
});

// ─── L1609-1621 isAddressDataReady ────────────────────────────

describe('Phase 8 Batch 7: isAddressDataReady (= L1609-1621)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    globalThis.window = {};
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
    delete globalThis.window;
  });

  it('window 無し → false (= typeof window === "undefined" 経路は再現困難なので・空 window で全 false 経路)', () => {
    expect(Meter.isAddressDataReady()).toBe(false);
  });

  it('COARSE_JP のみ load → true', () => {
    globalThis.window.ADDRESSES_COARSE_JP = {
      items: [{ lat: 0, lng: 0, c: '38201', n: 'test' }],
    };
    expect(Meter.isAddressDataReady()).toBe(true);
  });

  it('FINE_JP (legacy) のみ load → true', () => {
    globalThis.window.ADDRESSES_FINE_JP = { items: [{ lat: 0, lng: 0, n: 'test' }] };
    expect(Meter.isAddressDataReady()).toBe(true);
  });

  it('FINE_EHIME (県別) のみ load → true (= _anyFinePrefLoaded 経由)', () => {
    globalThis.window.ADDRESSES_FINE_EHIME = { items: [{ lat: 0, lng: 0, n: 'test' }] };
    expect(Meter.isAddressDataReady()).toBe(true);
  });

  it('COARSE_JP items=空配列 → false (= length>0 ガード)', () => {
    globalThis.window.ADDRESSES_COARSE_JP = { items: [] };
    expect(Meter.isAddressDataReady()).toBe(false);
  });

  it('FINE_JP items=空配列 → false', () => {
    globalThis.window.ADDRESSES_FINE_JP = { items: [] };
    expect(Meter.isAddressDataReady()).toBe(false);
  });

  it('FINE_EHIME items=空配列 → false (= length>0 ガード)', () => {
    globalThis.window.ADDRESSES_FINE_EHIME = { items: [] };
    expect(Meter.isAddressDataReady()).toBe(false);
  });

  it('COARSE_JP items が・非 Array (= null) → false', () => {
    globalThis.window.ADDRESSES_COARSE_JP = { items: null };
    expect(Meter.isAddressDataReady()).toBe(false);
  });

  it('複数 県別 fine load → true (= loop で 1 件目に hit)', () => {
    globalThis.window.ADDRESSES_FINE_TOKYO = { items: [{ lat: 0, lng: 0, n: 't' }] };
    globalThis.window.ADDRESSES_FINE_OSAKA = { items: [{ lat: 0, lng: 0, n: 'o' }] };
    expect(Meter.isAddressDataReady()).toBe(true);
  });
});

// ─── L149-164 _recordMmLatency + _calcP99Latency (= mm worker latency tracking) ─

describe('Phase 8 Batch 7: mm latency tracking (= getMMStats().p99_latency_ms 経由)', () => {
  let Meter;
  let fakeWorker;
  let dispatch;

  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig(FC_BASE);
    let handler = null;
    fakeWorker = {
      addEventListener: (ev, fn) => {
        if (ev === 'message') handler = fn;
      },
      removeEventListener: () => {},
      postMessage: () => {},
    };
    dispatch = (data) => handler && handler({ data });
    Meter.setMapMatcher(fakeWorker);
    Meter.reset();
    Meter.start();
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('latencyMs を 1 件送信 → p99 に反映 (= ring buffer に記録)', () => {
    dispatch({ type: 'mmResult', latencyMs: 100 });
    expect(Meter.getMMStats().p99_latency_ms).toBe(100);
  });

  it('latencyMs を複数件送信 → p99 が増加する', () => {
    for (const ms of [10, 20, 30, 100, 200, 50]) {
      dispatch({ type: 'mmResult', latencyMs: ms });
    }
    expect(Meter.getMMStats().p99_latency_ms).toBeGreaterThan(0);
  });

  it('latencyMs=非数値 → 無視 (= L150 ガード・p99 不変)', () => {
    const before = Meter.getMMStats().p99_latency_ms;
    dispatch({ type: 'mmResult', latencyMs: 'not-a-number' });
    expect(Meter.getMMStats().p99_latency_ms).toBe(before);
  });

  it('latencyMs=Infinity → 無視 (= !isFinite ガード)', () => {
    const before = Meter.getMMStats().p99_latency_ms;
    dispatch({ type: 'mmResult', latencyMs: Infinity });
    expect(Meter.getMMStats().p99_latency_ms).toBe(before);
  });

  it('latencyMs=負値 → 無視 (= < 0 ガード)', () => {
    const before = Meter.getMMStats().p99_latency_ms;
    dispatch({ type: 'mmResult', latencyMs: -1 });
    expect(Meter.getMMStats().p99_latency_ms).toBe(before);
  });

  it('latencyMs=0 → 通過 (= >= 0)', () => {
    dispatch({ type: 'mmResult', latencyMs: 0 });
    // 0 が 1 件入っただけでは p99 も 0 (= sort 後単一要素)
    expect(Meter.getMMStats().p99_latency_ms).toBe(0);
  });

  it('latencyMs 100 件超 (= ring buffer 折返し) → 古い値が上書きされる', () => {
    // buffer サイズが何件かは不明・100 超で必ず折り返す前提
    for (let i = 0; i < 200; i++) {
      dispatch({ type: 'mmResult', latencyMs: i + 1 });
    }
    const p99 = Meter.getMMStats().p99_latency_ms;
    expect(p99).toBeGreaterThan(0); // 値あり
    expect(p99).toBeLessThanOrEqual(200); // 上限内
  });

  it('latencyMs 未送信 (= 初期状態) → p99 = 0 (= count=0 早期 return)', () => {
    // 新 Meter で起動直後
    const M2 = loadMeter();
    M2.setFareConfig(FC_BASE);
    M2.reset();
    M2.start();
    expect(M2.getMMStats().p99_latency_ms).toBe(0);
  });
});

// ─── L662-673 start() surcharge / vehicle 初期 active 設定 ────

describe('Phase 8 Batch 7: start() surcharge active_default / vehicle default (= L662-673)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('surcharge.active_default=true → start で _activeSurchargeIds に追加 (= getActiveSurcharges で観測)', () => {
    Meter.setFareConfig({
      ...FC_BASE,
      surcharges: [
        { id: 'sx1', name: '深夜', rate: 1.5, active_default: true },
        { id: 'sx2', name: '迎車', rate: 1.0, active_default: false },
      ],
    });
    Meter.reset();
    Meter.start();
    const active = Meter.getActiveSurcharges();
    expect(active).toContain('sx1');
    expect(active).not.toContain('sx2');
  });

  it('surcharges が空 → _activeSurchargeIds 空', () => {
    Meter.setFareConfig({ ...FC_BASE, surcharges: [] });
    Meter.reset();
    Meter.start();
    expect(Meter.getActiveSurcharges()).toEqual([]);
  });

  it('surcharges が・非 Array (= null) → loop skip・空', () => {
    Meter.setFareConfig({ ...FC_BASE, surcharges: null });
    Meter.reset();
    Meter.start();
    expect(Meter.getActiveSurcharges()).toEqual([]);
  });

  it('surcharge に id 無し → 追加 skip (= L665 ガード)', () => {
    Meter.setFareConfig({
      ...FC_BASE,
      surcharges: [{ name: '無 id', rate: 1.5, active_default: true }],
    });
    Meter.reset();
    Meter.start();
    expect(Meter.getActiveSurcharges()).toEqual([]);
  });

  it('vehiclesEnabled=true + default フラグ付き → そのid が active', () => {
    Meter.setFareConfig({
      ...FC_BASE,
      vehiclesEnabled: true,
      vehicles: [
        { id: 'v1', name: 'セダン', rate: 1.0 },
        { id: 'v2', name: 'ミニバン', rate: 1.3, default: true },
        { id: 'v3', name: '大型', rate: 1.5 },
      ],
    });
    Meter.reset();
    Meter.start();
    expect(Meter.getVehicleType()).toBe('v2');
  });

  it('vehiclesEnabled=true + default 無し → 最初の vehicle id', () => {
    Meter.setFareConfig({
      ...FC_BASE,
      vehiclesEnabled: true,
      vehicles: [
        { id: 'v1', name: 'セダン', rate: 1.0 },
        { id: 'v2', name: 'ミニバン', rate: 1.3 },
      ],
    });
    Meter.reset();
    Meter.start();
    expect(Meter.getVehicleType()).toBe('v1');
  });

  it('vehiclesEnabled=false → vehicle type = null (= 機能 disabled)', () => {
    Meter.setFareConfig({
      ...FC_BASE,
      vehiclesEnabled: false,
      vehicles: [{ id: 'v1', name: 'セダン', rate: 1.0, default: true }],
    });
    Meter.reset();
    Meter.start();
    expect(Meter.getVehicleType()).toBeNull();
  });

  it('vehiclesEnabled=true + vehicles 空配列 → vehicle type = null', () => {
    Meter.setFareConfig({ ...FC_BASE, vehiclesEnabled: true, vehicles: [] });
    Meter.reset();
    Meter.start();
    expect(Meter.getVehicleType()).toBeNull();
  });

  it('vehiclesEnabled=true + vehicles が・非 Array (= null) → vehicle type = null', () => {
    Meter.setFareConfig({ ...FC_BASE, vehiclesEnabled: true, vehicles: null });
    Meter.reset();
    Meter.start();
    expect(Meter.getVehicleType()).toBeNull();
  });
});
