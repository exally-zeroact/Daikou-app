// tests/integration/business-distance-carryover.test.js
// ★白紙書き直し (2026-05-30・clean-rebuild-pipeline・新挙動へ更新)★
//
// 検証対象: meter.js business_distance_m の pipeline delta 加算 + trip 跨ぎ carry-over
//
//   旧: business_distance_m は道路 snap 5 経路 (mm commit / Off-Road retro / gap fill /
//       Off-Road incremental / setBusinessDistance) + tier2 preview 別回路で加算していた。
//   新: business_distance_m は ★pipeline delta 単一経路★ (= mmResult.pipelineDeltaM・
//       business_active gate) + setBusinessDistance 復元のみ。tier2 preview 二重回路は廃止。
//       gate: distance_m = running gate / business_distance_m = business_active gate。
//
// 絶対ルール準拠:
//   distance_m 加算は pipeline delta 単一経路・running gate で空車中は加算しない。
//   Worker B (= map-matcher.js) / gps-worker.js / sw.js: untouched。

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

function makeFakeWorker() {
  const handlers = [];
  return {
    addEventListener(type, h) {
      if (type === 'message') handlers.push(h);
    },
    removeEventListener(type, h) {
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    },
    postMessage() {},
    _dispatch(data) {
      for (const h of handlers) h({ data });
    },
  };
}

// ★pipeline delta 駆動の mmResult (= 道路 snap 道なり区間増分)。
function deltaResult(deltaM) {
  return { type: 'mmResult', pipelineDeltaM: deltaM, snapped: true, committed: true };
}

function gpsAt(stepIdx, baseLat = 33.84, baseLng = 132.7656, baseTs = 1714100000000) {
  return {
    lat: baseLat + 0.000225 * stepIdx,
    lng: baseLng,
    altitude: 0,
    accuracy: 5,
    speedKmh: 90,
    isStationary: false,
    timestamp: baseTs + stepIdx * 1000,
  };
}

describe('business-distance-carryover (pipeline 駆動・clean-rebuild-pipeline)', () => {
  let Meter, fakeWorker;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig(DEFAULT_FARE_CONFIG);
    Meter.reset();
    fakeWorker = makeFakeWorker();
    Meter.setMapMatcher(fakeWorker);
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  // ─── setBusinessDistance 外部 API (= タスクキル復帰時の業務単位累積復元) ────

  it('setBusinessDistance(1500) で state.business_distance_m=1500 に復元される', () => {
    Meter.setBusinessDistance(1500);
    expect(Meter.getState().business_distance_m).toBe(1500);
  });

  it('setBusinessDistance(0) で state.business_distance_m=0 に', () => {
    Meter.setBusinessDistance(0);
    expect(Meter.getState().business_distance_m).toBe(0);
  });

  it('setBusinessDistance(負値) で state.business_distance_m=0 (fallback)', () => {
    Meter.setBusinessDistance(-100);
    expect(Meter.getState().business_distance_m).toBe(0);
  });

  it('setBusinessDistance(NaN) で state.business_distance_m=0 (fallback)', () => {
    Meter.setBusinessDistance(NaN);
    expect(Meter.getState().business_distance_m).toBe(0);
  });

  it('setBusinessDistance(string) で state.business_distance_m=0 (fallback)', () => {
    Meter.setBusinessDistance('1500');
    expect(Meter.getState().business_distance_m).toBe(0);
  });

  it('setBusinessDistance(undefined) で state.business_distance_m=0 (fallback)', () => {
    Meter.setBusinessDistance(undefined);
    expect(Meter.getState().business_distance_m).toBe(0);
  });

  // ─── per-trip reset / businessEnd で carryover 維持 ──────────────────

  it('Meter.reset() (= per-trip reset) で business_distance_m は維持される', () => {
    Meter.setBusinessDistance(2000);
    expect(Meter.getState().business_distance_m).toBe(2000);
    Meter.reset();
    expect(Meter.getState().business_distance_m).toBe(2000);
    expect(Meter.getState().distance_m).toBe(0);
    expect(Meter.getState().fare_yen).toBe(0);
  });

  it('Meter.businessEnd() では business_distance_m を維持 (= getReport で読まれる)', () => {
    Meter.setBusinessDistance(3000);
    Meter.start();
    expect(Meter.getState().business_distance_m).toBe(3000);
    Meter.businessEnd();
    expect(Meter.getState().business_distance_m).toBe(3000);
    expect(Meter.getState().business_active).toBe(false);
  });

  // ─── ★ pipeline delta で business_distance_m も加算 (= business_active 時) ─

  it('★ pipeline delta (pipelineDeltaM>0) で business_distance_m に加算 (= business_active 時)', () => {
    Meter.setBusinessDistance(1000);
    Meter.setBusinessActive(true);
    Meter.start();
    Meter._setDrainMmUntil(0);
    fakeWorker._dispatch(deltaResult(200));
    // business も distance と同じく pipeline delta 加算
    expect(Meter.getState().distance_m).toBe(200);
    expect(Meter.getState().business_distance_m).toBe(1200); // 1000 + 200
  });

  // ─── gate 検証: business_active=false ─────────────────────────────

  it('★ business_active=false なら pipeline delta でも business_distance_m 加算しない', () => {
    Meter.setBusinessDistance(1000);
    Meter.setBusinessActive(false);
    Meter.start();
    Meter._setDrainMmUntil(0);
    fakeWorker._dispatch(deltaResult(200));
    expect(Meter.getState().business_distance_m).toBe(1000); // 不変
    expect(Meter.getState().distance_m).toBe(200); // distance は加算 (= running=true)
  });

  // ─── gate 検証: 空車中 (= running=false) でも業務単位は加算 ──────────

  it('★ business_active=true・running=false (= 空車中) で pipeline delta でも business に加算', () => {
    Meter.setBusinessDistance(500);
    Meter.setBusinessActive(true);
    // Meter.start() を呼ばない (= running=false・空車中)
    Meter._setDrainMmUntil(0);
    fakeWorker._dispatch(deltaResult(300));
    // business は business_active gate で加算 (= 空車中も)
    expect(Meter.getState().business_distance_m).toBe(800); // 500 + 300
    // distance は running=false で加算なし (= 課金経路は代行中のみ)
    expect(Meter.getState().distance_m).toBe(0);
  });

  // ─── gate 検証: 停車中 (= Worker B が pipelineDeltaM=0 出力) ──────────

  it('★ Worker B が停車中 pipelineDeltaM=0 を返す時・business_distance_m 加算しない', () => {
    Meter.setBusinessDistance(1000);
    Meter.setBusinessActive(true);
    Meter.start();
    Meter._setDrainMmUntil(0);
    // 停車中は Worker B が pipelineDeltaM=0 を返す (= effectivelyStationary freeze)
    fakeWorker._dispatch(deltaResult(0));
    expect(Meter.getState().business_distance_m).toBe(1000); // 不変
  });

  // ─── trip 跨ぎ carryover (= pipeline 駆動後も維持) ──────────────────

  it('複数 trip 跨ぎで business_distance_m が累積する (= trip A 終了 → trip B 開始)', () => {
    Meter.setBusinessActive(true);
    Meter.start();
    Meter._setDrainMmUntil(0);
    fakeWorker._dispatch(deltaResult(500));
    expect(Meter.getState().business_distance_m).toBe(500);

    Meter.reset();
    expect(Meter.getState().distance_m).toBe(0);
    expect(Meter.getState().business_distance_m).toBe(500); // 維持
    expect(Meter.getState().business_active).toBe(true);

    Meter.start();
    Meter._setDrainMmUntil(0);
    fakeWorker._dispatch(deltaResult(300));
    expect(Meter.getState().business_distance_m).toBe(800); // 500 + 300
  });

  // ─── businessEnd 後の次業務開始 ──────────────────

  it('businessEnd 後 setBusinessDistance(0)・新業務開始で 0 から累積', () => {
    Meter.setBusinessActive(true);
    Meter.start();
    Meter._setDrainMmUntil(0);
    fakeWorker._dispatch(deltaResult(500));
    expect(Meter.getState().business_distance_m).toBe(500);

    Meter.businessEnd();
    expect(Meter.getState().business_distance_m).toBe(500); // 維持
    expect(Meter.getState().business_active).toBe(false);

    Meter.setBusinessDistance(0);
    Meter.setBusinessActive(true);
    Meter.start();
    Meter._setDrainMmUntil(0);
    fakeWorker._dispatch(deltaResult(250));
    expect(Meter.getState().business_distance_m).toBe(250); // 新業務 0 + 250
  });

  // ─── 回帰防止: business と distance が同じ値で増加 ──────────

  it('★ 回帰防止: 代行中 pipeline delta で business と distance が同じ値で増加', () => {
    Meter.setBusinessActive(true);
    Meter.start();
    Meter._setDrainMmUntil(0);
    fakeWorker._dispatch(deltaResult(500));
    const s = Meter.getState();
    expect(s.business_distance_m).toBe(500);
    expect(s.distance_m).toBe(500);
    expect(s.business_distance_m).toBeGreaterThanOrEqual(s.distance_m);
  });

  // ─── ★ GPS update 単独 (= pipeline delta なし) では business 加算しない ─

  it('★ GPS update 単独 (= pipeline delta 受信なし) では business_distance_m 加算しない', () => {
    Meter.setBusinessActive(true);
    Meter.start();
    Meter._setDrainMmUntil(0);
    // 道路ロード完了済を明示 (= loadfill 非発火・ロード完了後は GPS 単独で距離が動かない契約)
    fakeWorker._dispatch({ type: 'roadsLoaded', ok: true, pref: 'ehime' });
    // GPS update のみ・worker が delta を返さない (= fake worker は postMessage no-op)
    Meter.update(gpsAt(0));
    Meter.update(gpsAt(1));
    Meter.update(gpsAt(2));
    // 距離は pipeline delta 受信でのみ動く (= GPS 直線課金なし)
    expect(Meter.getState().business_distance_m).toBe(0);
    // pipeline delta を 1 度 dispatch → business 加算
    fakeWorker._dispatch(deltaResult(100));
    expect(Meter.getState().business_distance_m).toBe(100);
  });
});

// ─── ★ tier2 preview 廃止の verify (= 後方互換キーは残るが常に 0) ─

describe('tier2 preview 廃止 verify (clean-rebuild-pipeline)', () => {
  let Meter, fakeWorker;
  beforeEach(() => {
    mockGPS();
    Meter = loadMeter();
    Meter.setFareConfig(DEFAULT_FARE_CONFIG);
    Meter.reset();
    fakeWorker = makeFakeWorker();
    Meter.setMapMatcher(fakeWorker);
  });
  afterEach(() => {
    if (Meter) Meter.reset();
    delete globalThis.GPS;
  });

  it('後方互換キー tier2_pending_m / business_tier2_pending_m は存在し初期 0', () => {
    const s = Meter.getState();
    expect(s.tier2_pending_m).toBe(0);
    expect(s.business_tier2_pending_m).toBe(0);
  });

  it('tentativeDistanceM 受信でも tier2_pending_m / business_tier2_pending_m は 0 のまま (= preview 回路廃止)', () => {
    Meter.setBusinessActive(true);
    Meter.start();
    Meter._setDrainMmUntil(0);
    fakeWorker._dispatch({
      type: 'mmResult',
      pipelineDeltaM: 0,
      tentativeDistanceM: 50,
      tentativeIncrementM: 30,
      snapped: true,
    });
    const s = Meter.getState();
    expect(s.tier2_pending_m).toBe(0);
    expect(s.business_tier2_pending_m).toBe(0);
  });

  it('meter.js 内に tier2_pending_m への書込コードが存在しない (= preview 回路廃止)', () => {
    const fs = require('fs');
    const meterSrc = fs.readFileSync(METER_JS_PATH, 'utf8');
    const lines = meterSrc.split('\n');
    const codeWrites = [];
    for (let i = 0; i < lines.length; i++) {
      const codePart = lines[i].split('//')[0];
      // state.tier2_pending_m / state.business_tier2_pending_m への直接代入/加算 (初期化 state={} 内は除く)
      if (/^\s*state\.(business_)?tier2_pending_m\s*[+]?=(?!=)/.test(codePart)) {
        codeWrites.push({ lineNo: i + 1, content: lines[i].trim() });
      }
    }
    if (codeWrites.length !== 0) {
      throw new Error(
        'tier2 preview 回路廃止違反: state.tier2_pending_m 書込が残存: ' +
          JSON.stringify(codeWrites)
      );
    }
  });
});
