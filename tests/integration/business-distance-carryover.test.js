// tests/integration/business-distance-carryover.test.js
// ZEROact 共通テスト基盤 (2026-05-24 仕様更新・道路 snap 構成に変更)
//
// 検証対象: meter.js business_distance_m の道路 snap 5 経路加算 + trip 跨ぎ carry-over
//
// ★設計変更宣言 (2026-05-24・司さん採用指示・道路 snap 構成に変更):
//   旧 (2026-05-19 dac45f03): GPS haversine 直接 += (= L991 周辺)
//   新: distance_m と同じ道路 snap 5 経路 (mm commit / Off-Road retro / gap fill / Off-Road incremental
//       / setBusinessDistance) で・state.business_active gate 並記で加算
//   非対称ガード解消の根拠:
//     過去 dac45f03 真因 = 「business 側のみ !_isStationary() 追加ガード」 = 100%
//     今回・「全く同じ構造で・gate だけ business_active」 で・構造的に解消
//     Worker B は・既に「停車中 mmIncrementM = 0」 (= 2026-05-16 Step4) のため
//     main 側で・追加 isStationary 判定不要・Worker B 出力を信頼
//   屋内対策:
//     Off-Road incremental (= L1078) のみ・business 側に・追加 ZUPT ガード
//     (= 直近 30 秒 net 変位 < 10m AND 現 haver < 5m → skip)
//     distance_m 側は・1 byte 不変 (= 課金根拠不可侵・running gate で空車中既 skip)
//
// 絶対ルール準拠:
//   distance_m 加算 5 経路は完全不変 (= L496/L576/L1043/L1064/L1461)
//   Worker B (= map-matcher.js) / gps-worker.js / sw.js: untouched
//   isStationary 判定本体: 1 byte 不変 (= 司さん専決)

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

describe('business-distance-carryover (道路 snap 構成・2026-05-24)', () => {
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

  // ─── ★ 道路 snap 構成: Worker B mm commit で business_distance_m も加算 ─

  it('★ 道路 snap: Worker B mm commit (mmIncrementM>0) で business_distance_m に加算 (= business_active 時)', () => {
    Meter.setBusinessDistance(1000);
    Meter.setBusinessActive(true);
    Meter.start();
    Meter._setDrainMmUntil(0);
    fakeWorker._dispatch({ type: 'mmResult', mmIncrementM: 200, snapped: true, committed: true });
    // ★ 道路 snap 構成: business も distance と同じく mmIncrementM 加算 ★
    expect(Meter.getState().distance_m).toBe(200);
    expect(Meter.getState().business_distance_m).toBe(1200); // 1000 + 200
  });

  // ─── gate 検証: business_active=false ─────────────────────────────

  it('★ business_active=false なら mm commit でも business_distance_m 加算しない', () => {
    Meter.setBusinessDistance(1000);
    Meter.setBusinessActive(false);
    Meter.start();
    Meter._setDrainMmUntil(0);
    fakeWorker._dispatch({ type: 'mmResult', mmIncrementM: 200, snapped: true, committed: true });
    expect(Meter.getState().business_distance_m).toBe(1000); // 不変
    expect(Meter.getState().distance_m).toBe(200); // distance は加算 (= running=true)
  });

  // ─── gate 検証: 空車中 (= running=false) でも業務単位は加算 ──────────

  it('★ business_active=true・running=false (= 空車中) で mm commit でも business に加算', () => {
    Meter.setBusinessDistance(500);
    Meter.setBusinessActive(true);
    // Meter.start() を呼ばない (= running=false・空車中)
    Meter._setDrainMmUntil(0);
    fakeWorker._dispatch({ type: 'mmResult', mmIncrementM: 300, snapped: true, committed: true });
    // ★ business は・business_active gate で加算 (= 空車中も) ★
    expect(Meter.getState().business_distance_m).toBe(800); // 500 + 300
    // ★ distance は・running=false で加算なし (= 課金経路は代行中のみ) ★
    expect(Meter.getState().distance_m).toBe(0);
  });

  // ─── gate 検証: 停車中 (= Worker B が mmIncrementM=0 出力) ──────────

  it('★ Worker B が・停車中 mmIncrementM=0 を返す時・business_distance_m 加算しない', () => {
    Meter.setBusinessDistance(1000);
    Meter.setBusinessActive(true);
    Meter.start();
    Meter._setDrainMmUntil(0);
    // 停車中は Worker B が・mmIncrementM=0 を返す (= 2026-05-16 Step4 設計)
    fakeWorker._dispatch({ type: 'mmResult', mmIncrementM: 0, snapped: true, committed: true });
    expect(Meter.getState().business_distance_m).toBe(1000); // 不変
  });

  // ─── trip 跨ぎ carryover (= 道路 snap 構成後も維持) ──────────────────

  it('複数 trip 跨ぎで business_distance_m が累積する (= trip A 終了 → trip B 開始)', () => {
    Meter.setBusinessActive(true);
    Meter.start();
    Meter._setDrainMmUntil(0);
    // trip A: mm commit で 500m
    fakeWorker._dispatch({ type: 'mmResult', mmIncrementM: 500, snapped: true, committed: true });
    const afterA = Meter.getState().business_distance_m;
    expect(afterA).toBe(500);

    Meter.reset();
    expect(Meter.getState().distance_m).toBe(0);
    expect(Meter.getState().business_distance_m).toBe(500); // 維持
    expect(Meter.getState().business_active).toBe(true);

    // trip B: mm commit で 300m
    Meter.start();
    Meter._setDrainMmUntil(0);
    fakeWorker._dispatch({ type: 'mmResult', mmIncrementM: 300, snapped: true, committed: true });
    // trip A 500 + trip B 300 = 800
    expect(Meter.getState().business_distance_m).toBe(800);
  });

  // ─── businessEnd 後の次業務開始 ──────────────────

  it('businessEnd 後 setBusinessDistance(0)・新業務開始で 0 から累積', () => {
    Meter.setBusinessActive(true);
    Meter.start();
    Meter._setDrainMmUntil(0);
    fakeWorker._dispatch({ type: 'mmResult', mmIncrementM: 500, snapped: true, committed: true });
    expect(Meter.getState().business_distance_m).toBe(500);

    Meter.businessEnd();
    expect(Meter.getState().business_distance_m).toBe(500); // 0 化撤廃・維持
    expect(Meter.getState().business_active).toBe(false);

    // 次業務開始
    Meter.setBusinessDistance(0);
    Meter.setBusinessActive(true);
    Meter.start();
    Meter._setDrainMmUntil(0);
    fakeWorker._dispatch({ type: 'mmResult', mmIncrementM: 250, snapped: true, committed: true });
    expect(Meter.getState().business_distance_m).toBe(250); // 新業務 0 + 250
  });

  // ─── 司さん実車事象の回帰防止: business >= distance を保証 ──────────

  it('★ 回帰防止: 代行中 mm commit で business と distance が同じ値で増加 (= 非対称ガード解消)', () => {
    // 過去 dac45f03 真因: business 側のみ !_isStationary() 追加ガード → 非対称累積
    // 道路 snap 構成: gate だけ business_active/running の違い・他条件は全く同じ
    Meter.setBusinessActive(true);
    Meter.start();
    Meter._setDrainMmUntil(0);
    fakeWorker._dispatch({ type: 'mmResult', mmIncrementM: 500, snapped: true, committed: true });
    const s = Meter.getState();
    expect(s.business_distance_m).toBe(500); // 道路 snap 加算
    expect(s.distance_m).toBe(500); // 道路 snap 加算 (= 同じ値)
    expect(s.business_distance_m).toBeGreaterThanOrEqual(s.distance_m);
  });

  // ─── ★ GPS update 単独 (= mm commit なし) では business 加算しない (= 道路 snap 主源) ─

  it('★ GPS update 単独 (= mm commit 受信なし) では business_distance_m 加算しない', () => {
    Meter.setBusinessActive(true);
    Meter.start();
    Meter._setDrainMmUntil(0);
    // GPS update のみ・mm commit なし
    Meter.update(gpsAt(0));
    Meter.update(gpsAt(1));
    Meter.update(gpsAt(2));
    // GPS haversine 直接 += は・撤去済 (= 道路 snap 5 経路で並記)
    expect(Meter.getState().business_distance_m).toBe(0);
    // mm commit を 1 度 dispatch → business 加算
    fakeWorker._dispatch({ type: 'mmResult', mmIncrementM: 100, snapped: true, committed: true });
    expect(Meter.getState().business_distance_m).toBe(100);
  });
});

// ─── ★ business preview 別回路 (= 2026-05-24・business_tier2_pending_m) ─

describe('business preview 別回路 (= 2026-05-24・課金 tier2_pending_m と完全非共有)', () => {
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

  it('初期 state.business_tier2_pending_m = 0', () => {
    expect(Meter.getState().business_tier2_pending_m).toBe(0);
  });

  it('★ tentativeIncrementM 受信時・business_active=true で・business_tier2_pending_m += 加算', () => {
    Meter.setBusinessActive(true);
    Meter.start();
    Meter._setDrainMmUntil(0);
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 0,
      tentativeIncrementM: 50,
      snapped: true,
    });
    expect(Meter.getState().business_tier2_pending_m).toBe(50);
  });

  it('★ business_active=false なら・tentativeIncrementM 受信でも・business_tier2_pending_m 加算しない', () => {
    Meter.setBusinessActive(false);
    Meter.start();
    Meter._setDrainMmUntil(0);
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 0,
      tentativeIncrementM: 50,
      snapped: true,
    });
    expect(Meter.getState().business_tier2_pending_m).toBe(0);
  });

  it('★ mm commit (mmIncrementM>0) で・business_tier2_pending_m 確定減算 (= 単調増加保証)', () => {
    Meter.setBusinessActive(true);
    Meter.start();
    Meter._setDrainMmUntil(0);
    // preview 100m 累積
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 0,
      tentativeIncrementM: 100,
      snapped: true,
    });
    expect(Meter.getState().business_tier2_pending_m).toBe(100);
    // commit 60m 受信 → preview -60 = 40
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 60,
      snapped: true,
      committed: true,
    });
    expect(Meter.getState().business_tier2_pending_m).toBe(40);
    // business_distance_m も・mm commit で +60
    expect(Meter.getState().business_distance_m).toBe(60);
  });

  it('★ mm commit > preview なら・business_tier2_pending_m = 0 (= Math.max 0 下限)', () => {
    Meter.setBusinessActive(true);
    Meter.start();
    Meter._setDrainMmUntil(0);
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 0,
      tentativeIncrementM: 30,
      snapped: true,
    });
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 100,
      snapped: true,
      committed: true,
    });
    expect(Meter.getState().business_tier2_pending_m).toBe(0); // 30 - 100 → 0
  });

  it('★ 完全非共有 verify: 課金 tier2_pending_m と business_tier2_pending_m は・独立計算', () => {
    Meter.setBusinessActive(true); // business gate ON
    Meter.start(); // running gate ON
    Meter._setDrainMmUntil(0);
    // tentativeIncrementM 受信 → 両方加算 (= ただし別 if ブロック)
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 0,
      tentativeIncrementM: 50,
      snapped: true,
    });
    const s = Meter.getState();
    expect(s.tier2_pending_m).toBe(50); // 課金 preview
    expect(s.business_tier2_pending_m).toBe(50); // business preview
    // 両者は・独立変数・互いに影響なし
  });

  it('★ 非対称 gate: running=true・business_active=false なら・課金 preview のみ加算 / business は 0', () => {
    Meter.setBusinessActive(false); // business gate OFF
    Meter.start(); // running gate ON
    Meter._setDrainMmUntil(0);
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 0,
      tentativeIncrementM: 50,
      snapped: true,
    });
    const s = Meter.getState();
    expect(s.tier2_pending_m).toBe(50); // 課金 preview (= running gate)
    expect(s.business_tier2_pending_m).toBe(0); // business preview (= business_active gate skip)
  });

  it('★ 非対称 gate: running=false・business_active=true (= 空車中) なら・business preview のみ加算', () => {
    Meter.setBusinessActive(true);
    Meter._setDrainMmUntil(0);
    // Meter.start() を呼ばない (= running=false・空車中)
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 0,
      tentativeIncrementM: 50,
      snapped: true,
    });
    const s = Meter.getState();
    expect(s.tier2_pending_m).toBe(0); // 課金 preview (= running=false で skip)
    expect(s.business_tier2_pending_m).toBe(50); // business preview (= business_active=true で加算)
  });

  it('★ per-trip reset で・business_tier2_pending_m は・引き継ぎ (= business_distance_m と同仕様)', () => {
    Meter.setBusinessActive(true);
    Meter.start();
    Meter._setDrainMmUntil(0);
    fakeWorker._dispatch({
      type: 'mmResult',
      mmIncrementM: 0,
      tentativeIncrementM: 30,
      snapped: true,
    });
    expect(Meter.getState().business_tier2_pending_m).toBe(30);
    Meter.reset();
    expect(Meter.getState().business_tier2_pending_m).toBe(30); // 引き継ぎ
    Meter.start();
    expect(Meter.getState().business_tier2_pending_m).toBe(30); // start でも引き継ぎ
    expect(Meter.getState().tier2_pending_m).toBe(0); // 課金 preview は・per-trip 0 化 (= 既存)
  });
});

// ─── ★ 完全非共有 verify: source code 静的 verify (= 課金変数 read/write ゼロ) ─

describe('課金 / business 完全非共有 verify (= source 静的)', () => {
  it('★ 課金 tier2_pending_m の・実コード書込は・既存 2 経路のみ (= 確定減算 + tentative 累積)', () => {
    const fs = require('fs');
    const meterSrc = fs.readFileSync(
      require('path').join(__dirname, '..', '..', 'js', 'meter.js'),
      'utf8'
    );
    // 実コード行 (= コメント除外・行頭から state.tier2_pending_m 直接書込) のみ
    const lines = meterSrc.split('\n');
    const codeWrites = [];
    for (let i = 0; i < lines.length; i++) {
      const codePart = lines[i].split('//')[0]; // // コメント除外
      if (/^\s*state\.tier2_pending_m\s*[+]?=(?!=)/.test(codePart)) {
        codeWrites.push({ lineNo: i + 1, content: lines[i].trim() });
      }
    }
    if (codeWrites.length !== 2) {
      throw new Error(
        '課金 tier2_pending_m 書込違反: 期待 2 件 (確定減算 + tentative 累積)・実検出 ' +
          codeWrites.length +
          ' 件: ' +
          JSON.stringify(codeWrites)
      );
    }
  });

  it('★ business 回路で・課金 tier2_pending_m を read していない (= 同一 if 内 相互参照ゼロ)', () => {
    const fs = require('fs');
    const meterSrc = fs.readFileSync(
      require('path').join(__dirname, '..', '..', 'js', 'meter.js'),
      'utf8'
    );
    // business_tier2_pending_m 周辺 (= 同行/前後 5 行) に・課金 tier2_pending_m 参照なし
    const lines = meterSrc.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/business_tier2_pending_m/.test(lines[i])) {
        // 同行 + 同 ブロック内に・「state.tier2_pending_m」 (= business 接頭辞なし) なし
        // ※ コメント行は・許可 (= 設計説明で参照する場合あり)
        const codePart = lines[i].split('//')[0]; // コメント除外
        if (
          /state\.tier2_pending_m\b/.test(codePart) &&
          !/business_tier2_pending_m/.test(codePart.replace(/business_tier2_pending_m/g, 'X'))
        ) {
          throw new Error(
            'L' +
              (i + 1) +
              ' で・business_tier2_pending_m と・課金 tier2_pending_m が・同行に・存在: ' +
              lines[i].trim()
          );
        }
      }
    }
  });
});
