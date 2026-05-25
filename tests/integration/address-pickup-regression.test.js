// tests/integration/address-pickup-regression.test.js
//
// ★設計変更宣言 住所拾い 実機 bug 修正後の・回帰テスト (= 2026-05-22):
//
//   司さん実機観測 (= iPhone・愛媛今治・accuracy 5-11m・全 GPS valid):
//     - 出発地住所「⚠位置不明」/ 別機会で「📍出発地取得中…」永久ハング
//     - 経由地点も「⚠位置不明」
//     - 「出発地取得中…」中・経由地点ボタンが・記録可能状態にならない
//     - 確定後 end_address=null・routeCard 非表示
//     - eruda 確証: last_gps valid + COARSE 1919 件 load + isAddressDataReady=true で
//                  Meter.getNearestAddress=null
//
//   真因 (= 修正前・実 data で trace 確認):
//     - addresses-coarse-jp.js は・items が integer × 1e5 形式 (= 司さん仮説どおり)
//     - 但し getNearestAddress も・targetLatI = Math.round(lat × 1e5) で・スケール統一済
//       (= bbox 差分 dLatI/dLngI は・integer 同士で正しく動作)
//     - ★真の原因: COARSE_RADIUS_M=3000m + coarseRangeI=2800 (= 0.028°≈3.1km) が・
//                  市域 sweep に対して狭すぎ・市の centroid は・市の中心 (= 北部) で・
//                  user (= 市の南部) と 8-30km 離れることが多い。
//                  愛媛今治 user (34.0647, 133.0015) と 今治市 centroid (34.1322, 133.0480) は・
//                  実距離 8.6km → 全 1919 件 bbox SKIP → bestCoarse=null → null 返却
//
//   修正 (= meter.js getNearestAddress + _searchFineItems):
//     - COORD_SCALE=100000 を定数化 (= 4 段階探索全経路で・スケール変換を明示)
//     - COARSE_RADIUS_M: 3000 → 25000 (= 日本最大規模市の・centroid から最遠端 30km を概カバー)
//     - coarseRangeI: 2800 → 25000 (= 0.25°≈28km bbox)
//     - data file は・触らない (= コード側でのみ COORD_SCALE で割る)
//
//   絶対ルール準拠:
//     ✓ 距離 / 課金 / Worker B / map-matcher は・1 byte も触らない
//     ✓ distance_m += 5 経路 (L440/L514/L961/L979/L1365) は・無変更
//     ✓ 住所は・表示専用 (= getNearestAddress は・display path のみ)

'use strict';

const path = require('path');
const METER_JS_PATH = path.join(__dirname, '..', '..', 'js', 'meter.js');
const BUSINESS_JS_PATH = path.join(__dirname, '..', '..', 'js', 'business.js');

function loadMeter() {
  delete require.cache[require.resolve(METER_JS_PATH)];
  return require(METER_JS_PATH);
}

function loadBusiness() {
  delete require.cache[require.resolve(BUSINESS_JS_PATH)];
  return require(BUSINESS_JS_PATH);
}

function mockGPS() {
  globalThis.GPS = {
    calcDistance: () => 0,
    calcDistance3D: () => 0,
    setRoadType: () => {},
  };
}

// ─── 実 data 形式 (= integer × 1e5) fixture ────────────────────
// 司さん実機シナリオを忠実に再現する・今治市 + 近隣の COARSE items
const COARSE_ITEMS_REAL_SCALE = [
  // 愛媛県・今治市 (= 司さん eruda で再現対象・centroid 34.13215・133.04801)
  { lat: 3413215, lng: 13304801, n: '今治市', p: '愛媛県', c: '38202' },
  // 愛媛県・松山市 (= 県庁所在地・遠方 ~30km)
  { lat: 3393613, lng: 13264075, n: '松山市', p: '愛媛県', c: '38201' },
  // 愛媛県・西条市 (= 今治の東隣・~16km)
  { lat: 3394621, lng: 13311180, n: '西条市', p: '愛媛県', c: '38206' },
  // 北海道・札幌市 (= 検出されてはいけない遠方)
  { lat: 4303504, lng: 14128845, n: '札幌市', p: '北海道', c: '01101' },
];

// 司さん実機 GPS (= 愛媛今治・eruda 観測 2026-05-22)
const IMABARI_USER = { lat: 34.06467, lng: 133.0015, accuracy: 6 };

// ─── A. ★ 司さん実機 bug の・真因再現 + 修正後の・期待挙動 ──────

describe('住所拾い 実機 bug: 今治 user で・修正前 null → 修正後「今治市 付近」', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    globalThis.window = {
      ADDRESSES_COARSE_JP: {
        precision: 100000,
        items: COARSE_ITEMS_REAL_SCALE,
      },
    };
  });
  afterEach(() => {
    delete globalThis.GPS;
    delete globalThis.window;
  });

  it('★ 司さん実機 GPS (= 今治市南部・centroid から 8.6km) で・「愛媛県今治市 付近」を返却', () => {
    // 修正前 (= COARSE_RADIUS=3000・coarseRange=2800) では・bbox 全 SKIP → null
    // 修正後 (= COARSE_RADIUS=25000・coarseRange=25000) では・今治市 (8640m) が・最近傍
    const addr = Meter.getNearestAddress(IMABARI_USER.lat, IMABARI_USER.lng, IMABARI_USER.accuracy);
    expect(addr).toBe('今治市 付近');
  });

  it('複数 candidates 内・最近傍 (= 今治市 8.6km) が選ばれる・西条市 16.6km は・bestCoarseDistM で・後位', () => {
    const addr = Meter.getNearestAddress(IMABARI_USER.lat, IMABARI_USER.lng, 6);
    expect(addr).toBe('今治市 付近');
    expect(addr).not.toBe('西条市 付近');
    expect(addr).not.toBe('松山市 付近');
  });

  it('遠方の北海道 札幌市 (= 1300km) は・bbox prefilter で・確実 SKIP', () => {
    const addr = Meter.getNearestAddress(IMABARI_USER.lat, IMABARI_USER.lng, 6);
    expect(addr).not.toBe('札幌市 付近');
  });

  it('isAddressDataReady() = true (= 司さん実機 eruda 観測と一致)', () => {
    expect(Meter.isAddressDataReady()).toBe(true);
  });
});

// ─── B. 各 trigger (= start / waypoint / end) で住所取得 verify ──

describe('住所拾い 3 trigger 全経路・修正後 動作 verify', () => {
  let Meter, Business;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    globalThis.Meter = Meter;
    Business = loadBusiness();
    globalThis.window = {
      ADDRESSES_COARSE_JP: {
        precision: 100000,
        items: COARSE_ITEMS_REAL_SCALE,
      },
    };
  });
  afterEach(() => {
    delete globalThis.GPS;
    delete globalThis.window;
    delete globalThis.Meter;
  });

  it('★ start trigger: onTripStart(今治 lat/lng) → start_address に「愛媛県今治市 付近」', () => {
    Business.onTripStart(IMABARI_USER.lat, IMABARI_USER.lng, IMABARI_USER.accuracy);
    const trip = Business.getCurrentTrip();
    expect(trip).not.toBeNull();
    expect(trip.start_address).toBe('今治市 付近');
  });

  it('★ waypoint trigger: onWaypoint(今治 lat/lng) → waypoints[0].address に「愛媛県今治市 付近」', () => {
    Business.onTripStart(IMABARI_USER.lat, IMABARI_USER.lng, IMABARI_USER.accuracy);
    Business.onWaypoint(IMABARI_USER.lat, IMABARI_USER.lng + 0.001, IMABARI_USER.accuracy);
    const trip = Business.getCurrentTrip();
    expect(trip.waypoints).toHaveLength(1);
    expect(trip.waypoints[0].address).toBe('今治市 付近');
  });

  it('★ end trigger: setEndAddress(今治 lat/lng) → end_address に「愛媛県今治市 付近」', () => {
    Business.onTripStart(IMABARI_USER.lat, IMABARI_USER.lng, IMABARI_USER.accuracy);
    Business.setEndAddress(
      IMABARI_USER.lat + 0.001,
      IMABARI_USER.lng + 0.002,
      IMABARI_USER.accuracy
    );
    const trip = Business.getCurrentTrip();
    expect(trip.end_address).toBe('今治市 付近');
  });

  it('3 trigger 全実行後: trip = { start, waypoints[1], end } 全て住所あり (= routeCard 表示条件満足)', () => {
    Business.onTripStart(IMABARI_USER.lat, IMABARI_USER.lng, 6);
    Business.onWaypoint(IMABARI_USER.lat + 0.005, IMABARI_USER.lng + 0.005, 6);
    Business.setEndAddress(IMABARI_USER.lat + 0.01, IMABARI_USER.lng + 0.01, 6);
    const trip = Business.getCurrentTrip();
    expect(trip.start_address).toBeTruthy();
    expect(trip.waypoints[0].address).toBeTruthy();
    expect(trip.end_address).toBeTruthy();
    // routeCard 表示条件: start_address && end_address のいずれかが・truthy ならば描画
    expect(trip.start_address || trip.end_address).toBeTruthy();
  });
});

// ─── C. 修正前 bug の・回帰防止 (= decimal mock で素通りした旧 test の置換) ──

describe('住所拾い 修正前 bug 回帰防止: data scale が・integer×1e5 なら正しく動作', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
  });
  afterEach(() => {
    delete globalThis.GPS;
    delete globalThis.window;
  });

  it('decimal mock (= 古いテスト形式) は・現在の data 形式と異なるため・必ず実 data 形式で fixture を組む', () => {
    // ★ 旧テスト (= Batch 7) は・items を decimal degree で mock 注入していた:
    //   { lat: 33.84, lng: 132.7656, c: '38201', n: '愛媛県松山市' }
    //   → getNearestAddress 内で・targetLatI=3384000 vs it.lat=33 で・差分が・数百万 → 即 SKIP
    //   → 旧テストでは・bbox 通過しないため・「coarse fallback null」path しかカバーしていない
    //   → 「実 data 形式 (= integer×1e5) で・bbox を通過する」path は・旧テスト未カバー
    //   本テストは・実 data 形式で・統合的にカバーする
    globalThis.window = {
      ADDRESSES_COARSE_JP: {
        precision: 100000,
        items: [
          // 実 data 形式 (= integer × 1e5)
          { lat: 3413215, lng: 13304801, n: '今治市', p: '愛媛県', c: '38202' },
        ],
      },
    };
    // 今治市 centroid から ~8.6km の・user 位置
    const addr = Meter.getNearestAddress(34.06467, 133.0015, 6);
    expect(addr).toBe('今治市 付近');
  });

  it('decimal mock 形式は・実 data と一致しない (= 旧テストの bbox 通過 path は・偽装 path だった)', () => {
    // 旧 mock 形式 (= decimal lat/lng) を・敢えて注入 → 現実装で・どう動くか
    globalThis.window = {
      ADDRESSES_COARSE_JP: {
        precision: 100000,
        items: [
          // ★ NG 形式: lat=33.84 (decimal) ・it.lat × 1e5 化された前提が崩れる
          { lat: 33.84, lng: 132.7656, n: '松山市', p: '愛媛県', c: '38201' },
        ],
      },
    };
    // targetLatI = Math.round(33.85 × 100000) = 3385000
    // it.lat - targetLatI = 33.84 - 3385000 = -3384966 → bbox SKIP (= 25000 超過)
    // → 旧 decimal mock では・全件 SKIP → null
    // → これが「旧テスト = 緑 / 実機 = bug」の・原因 (= テストが・実 data 形式で書かれていなかった)
    const addr = Meter.getNearestAddress(33.85, 132.766, 6);
    expect(addr).toBeNull(); // 旧 mock 形式は・bug の・偽装に過ぎなかった
  });
});

// ─── D. accuracy ガード + invalid input は・修正前と同等動作 (= 回帰確認) ───

describe('住所拾い 既存挙動 回帰確認 (= accuracy / invalid input)', () => {
  let Meter;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    globalThis.window = {
      ADDRESSES_COARSE_JP: {
        precision: 100000,
        items: COARSE_ITEMS_REAL_SCALE,
      },
    };
  });
  afterEach(() => {
    delete globalThis.GPS;
    delete globalThis.window;
  });

  it('accuracy > 50m → null (= 既存 ガード維持)', () => {
    expect(Meter.getNearestAddress(IMABARI_USER.lat, IMABARI_USER.lng, 51)).toBeNull();
  });

  it('accuracy = 50m (= 境界・>50 で null・=50 は通過) → 「今治市 付近」', () => {
    // L1523: `accuracy > 50 → null` (= 50 自体は通過)
    expect(Meter.getNearestAddress(IMABARI_USER.lat, IMABARI_USER.lng, 50)).toBe('今治市 付近');
  });

  it('lat=NaN → null', () => {
    expect(Meter.getNearestAddress(NaN, IMABARI_USER.lng, 6)).toBeNull();
  });

  it('lng=Infinity → null', () => {
    expect(Meter.getNearestAddress(IMABARI_USER.lat, Infinity, 6)).toBeNull();
  });

  it('COARSE 未 load (= window.ADDRESSES_COARSE_JP undefined) → null (= 既存)', () => {
    globalThis.window = {};
    expect(Meter.getNearestAddress(IMABARI_USER.lat, IMABARI_USER.lng, 6)).toBeNull();
  });

  it('遠方 (= 東京) で・COARSE items が今治のみ → coarse 範囲外 → null', () => {
    expect(Meter.getNearestAddress(35.681, 139.767, 6)).toBeNull();
  });
});
