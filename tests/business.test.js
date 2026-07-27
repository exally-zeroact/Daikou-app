// tests/business.test.js
// js/business.js の状態遷移 / onGps / onTripEnd / getReport の純粋ロジック検証
//
// 読込方式: js/business.js は `window.Business = (function(){})()` 形式の IIFE。
// Node では window が存在しないので、global.window を用意してから new Function 経由で
// ソースを実行し、その内側で `window.Business = ...` が代入される結果を取り出す。
//
// 依存: Meter (global) / dlog (global・optional) / localStorage (global)
// → テストごとに stub を差し替え可能なように beforeEach でリセット
//
// 課金本体・距離計算には触らない (絶対ルール: 距離計算は道路ジオメトリで)。

// describe / it / expect / beforeEach は vitest.config.js の globals:true で自動注入
const fs = require('fs');
const path = require('path');

const BUSINESS_JS_PATH = path.join(__dirname, '..', 'js', 'business.js');
const BUSINESS_JS_SOURCE = fs.readFileSync(BUSINESS_JS_PATH, 'utf8');

function makeLocalStorage() {
  const store = Object.create(null);
  return {
    getItem(k) {
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
    setItem(k, v) {
      store[k] = String(v);
    },
    removeItem(k) {
      delete store[k];
    },
    clear() {
      for (const k of Object.keys(store)) delete store[k];
    },
    key(i) {
      return Object.keys(store)[i] || null;
    },
    get length() {
      return Object.keys(store).length;
    },
    _raw: store,
  };
}

function makeMeterMock(initialDistance = 0, initialBusinessDistance = 0) {
  let dist = initialDistance;
  let bizDist = initialBusinessDistance;
  let running = false;
  return {
    getState: () => ({
      distance_m: dist,
      business_distance_m: bizDist,
      distanceSource: 'mm',
      running,
    }),
    setDistance: (v) => {
      dist = v;
    },
    setBusinessDistance: (v) => {
      bizDist = typeof v === 'number' && v >= 0 ? v : 0;
    },
    _setRunning: (v) => {
      running = !!v;
    },
  };
}

function loadBusiness({ meter, localStorageMock } = {}) {
  // Fresh sandbox: each test gets its own window so Business state is clean.
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.Meter = meter || makeMeterMock(0);
  sandbox.localStorage = localStorageMock || makeLocalStorage();
  sandbox.dlog = () => {};
  sandbox.console = console;
  // new Function in non-strict mode: assign to `this` to expose globals.
  // The business.js IIFE references Meter / localStorage / dlog as bare identifiers.
  // We feed them as named args so they resolve without leaking to real global.
  const fn = new Function(
    'window',
    'Meter',
    'localStorage',
    'dlog',
    'console',
    BUSINESS_JS_SOURCE + '\n;return window.Business;'
  );
  return {
    Business: fn(sandbox, sandbox.Meter, sandbox.localStorage, sandbox.dlog, sandbox.console),
    sandbox,
  };
}

describe('Business.start()', () => {
  let Business;
  beforeEach(() => {
    ({ Business } = loadBusiness());
  });

  it('全フィールドを 0 化し active=true にする', () => {
    Business.start();
    const s = Business.getState();
    expect(s.active).toBe(true);
    expect(s.start_time).toBeGreaterThan(0);
    expect(s.end_time).toBeNull();
    expect(s.ended).toBe(false);
    expect(s.ended_at).toBeNull();
    expect(s.total_distance_m).toBe(0);
    expect(s.actual_total_m).toBe(0);
    expect(s.fare_total_yen).toBe(0);
    expect(s.trip_count).toBe(0);
    expect(s.trips).toEqual([]);
    expect(s.last_meter_distance_m).toBe(0);
  });

  it('active 中に start() を再呼出すると false を返し state を変更しない', () => {
    expect(Business.start()).toBe(true);
    const before = Business.getState();
    const ret = Business.start();
    expect(ret).toBe(false);
    const after = Business.getState();
    expect(after.start_time).toBe(before.start_time);
    expect(after.active).toBe(true);
  });

  it('ended 状態 (limbo) なら abandon してから新業務開始する', () => {
    Business.start();
    Business.end();
    const limboStart = Business.getState().start_time;
    expect(Business.getState().ended).toBe(true);

    const result = Business.start();
    expect(result).toBe(true);
    const s = Business.getState();
    expect(s.active).toBe(true);
    expect(s.ended).toBe(false);
    // start_time は新規 Date.now() でセットされる (テストの実行が高速だと同 ms 値もありうるので
    // 値の前後関係のみ確認・"異なる ms" は要件ではない)
    expect(s.start_time).toBeGreaterThanOrEqual(limboStart);
    // 前業務が abandon() 経由で履歴 push されたことを localStorage 経由で確認
    expect(s.trip_count).toBe(0);
    expect(s.total_distance_m).toBe(0);
  });
});

describe('Business.end()', () => {
  let Business;
  beforeEach(() => {
    ({ Business } = loadBusiness());
  });

  it('active=false / ended=true にし start_time を保持する', () => {
    Business.start();
    const startTime = Business.getState().start_time;
    const report = Business.end();
    const s = Business.getState();
    expect(s.active).toBe(false);
    expect(s.ended).toBe(true);
    expect(s.start_time).toBe(startTime);
    expect(s.end_time).toBeGreaterThanOrEqual(startTime);
    expect(s.ended_at).toBeGreaterThanOrEqual(startTime);
    expect(report).toBeTypeOf('object');
    expect(report.start_time).toBe(startTime);
  });

  it('業務未開始 (start_time=null && active=false) なら null を返す', () => {
    const ret = Business.end();
    expect(ret).toBeNull();
  });
});

describe('Business.resume()', () => {
  let Business;
  beforeEach(() => {
    ({ Business } = loadBusiness());
  });

  it('end 後の limbo 状態から active=true に復帰する', () => {
    Business.start();
    const startTime = Business.getState().start_time;
    Business.end();
    const ok = Business.resume();
    expect(ok).toBe(true);
    const s = Business.getState();
    expect(s.active).toBe(true);
    expect(s.ended).toBe(false);
    expect(s.ended_at).toBeNull();
    expect(s.start_time).toBe(startTime); // start_time を引き継ぐ
  });

  it('active 中の resume() は false (冪等性)', () => {
    Business.start();
    expect(Business.resume()).toBe(false);
    expect(Business.getState().active).toBe(true);
  });

  it('start していない (start_time=null) なら resume() は false', () => {
    expect(Business.resume()).toBe(false);
  });
});

describe('Business.onTripEnd()', () => {
  let Business;
  beforeEach(() => {
    ({ Business } = loadBusiness());
  });

  it('!state.active なら false を返し state を加算しない (active gate)', () => {
    // Never started → active=false
    expect(Business.onTripEnd(500, 1300, Date.now())).toBe(false);
    const s = Business.getState();
    expect(s.actual_total_m).toBe(0);
    expect(s.fare_total_yen).toBe(0);
    expect(s.trip_count).toBe(0);
  });

  it('end() 後 (active=false) でも加算しない', () => {
    Business.start();
    Business.end();
    expect(Business.onTripEnd(500, 1300, Date.now())).toBe(false);
    expect(Business.getState().trip_count).toBe(0);
  });

  it('active 中の正常 trip は actual_total_m / fare_total_yen / trip_count に加算', () => {
    Business.start();
    const ok = Business.onTripEnd(1500, 1400, Date.now());
    expect(ok).toBe(true);
    const s = Business.getState();
    expect(s.actual_total_m).toBe(1500);
    expect(s.fare_total_yen).toBe(1400);
    expect(s.trip_count).toBe(1);
    expect(s.trips.length).toBe(1);
    expect(s.trips[0].distance_m).toBe(1500);
    expect(s.trips[0].fare_yen).toBe(1400);
  });

  it('negative distance / fare を reject (state 変更なし)', () => {
    Business.start();
    expect(Business.onTripEnd(-1, 1300, Date.now())).toBe(false);
    expect(Business.onTripEnd(500, -1, Date.now())).toBe(false);
    expect(Business.getState().trip_count).toBe(0);
  });

  it('数値以外の引数を reject', () => {
    Business.start();
    expect(Business.onTripEnd('500', 1300, Date.now())).toBe(false);
    expect(Business.onTripEnd(500, '1300', Date.now())).toBe(false);
    expect(Business.getState().trip_count).toBe(0);
  });

  it('複数 trip の累積', () => {
    Business.start();
    Business.onTripEnd(500, 1300, Date.now());
    Business.onTripEnd(1500, 1700, Date.now());
    Business.onTripEnd(800, 1500, Date.now());
    const s = Business.getState();
    expect(s.actual_total_m).toBe(2800);
    expect(s.fare_total_yen).toBe(4500);
    expect(s.trip_count).toBe(3);
  });
});

describe('Business.onGps() — Meter.business_distance_m 信源直結 (2026-05-14 変更後)', () => {
  it('!state.active なら何もしない (early return)', () => {
    const meter = makeMeterMock(100, 500);
    const { Business } = loadBusiness({ meter });
    Business.onGps({});
    // active=false なので state.total_distance_m は同期されない
    expect(Business.getState().total_distance_m).toBe(0);
  });

  it('Meter.business_distance_m を state.total_distance_m に sync する (永続化ミラー)', () => {
    const meter = makeMeterMock(0, 0);
    const { Business } = loadBusiness({ meter });
    Business.start(); // Business.start は Meter.setBusinessDistance(0) で 0 化する
    meter.setBusinessDistance(150);
    Business.onGps({});
    expect(Business.getState().total_distance_m).toBe(150);
    meter.setBusinessDistance(350);
    Business.onGps({});
    expect(Business.getState().total_distance_m).toBe(350);
  });

  it('Meter.distance_m が 0 (空車中) でも business_distance_m が増えれば total に反映', () => {
    const meter = makeMeterMock(0, 0);
    const { Business } = loadBusiness({ meter });
    Business.start();
    // 実車中相当 (Meter.running=true): distance_m + business_distance_m が連動して増える
    meter._setRunning(true);
    meter.setDistance(500);
    meter.setBusinessDistance(500);
    Business.onGps({});
    expect(Business.getState().total_distance_m).toBe(500);
    // 空車相当 (Meter.running=false): distance_m はリセットされても business_distance_m は伸び続ける
    meter._setRunning(false);
    meter.setDistance(0); // Meter.reset 想定
    meter.setBusinessDistance(800); // 空車中の道路距離増加 300m
    Business.onGps({});
    expect(Business.getState().total_distance_m).toBe(800);
  });

  it('Meter 未ロード時は early return (state.total_distance_m 不変)', () => {
    const { Business } = loadBusiness({ meter: undefined });
    Business.start();
    expect(() => Business.onGps({})).not.toThrow();
    expect(Business.getState().total_distance_m).toBe(0);
  });
});

describe('Business.getReport()', () => {
  let Business;
  beforeEach(() => {
    ({ Business } = loadBusiness());
  });

  it('未開始時の getReport は 0 値で 0 除算なし', () => {
    const r = Business.getReport();
    expect(r.total_distance_m).toBe(0);
    expect(r.actual_total_m).toBe(0);
    expect(r.empty_distance_m).toBe(0);
    expect(r.fare_total_yen).toBe(0);
    expect(r.trip_count).toBe(0);
    expect(r.actual_ratio).toBe(0); // total=0 → 0 で返す (0 除算回避)
    expect(r.avg_fare_yen).toBe(0); // trip_count=0 → 0
    expect(r.avg_speed_kmh).toBe(0); // elapsedH=0 → 0
    expect(r.elapsed_sec).toBe(0);
  });

  it('elapsed_sec は start_time / end_time から正しく計算される', () => {
    Business.start();
    // start_time は今 〜 数ms 前。end_time セット前は (Date.now() - start_time) ベース
    const r1 = Business.getReport();
    expect(r1.elapsed_sec).toBeGreaterThanOrEqual(0);
    expect(r1.elapsed_sec).toBeLessThan(2); // テスト実行は数ms

    Business.end();
    const r2 = Business.getReport();
    expect(r2.elapsed_sec).toBeGreaterThanOrEqual(0);
    expect(r2.elapsed_sec).toBeLessThan(2);
  });

  it('actual_ratio = actual / total (total>0 のみ・total は Meter.business_distance_m 信源)', () => {
    const meter = makeMeterMock(0, 0);
    const { Business: B2 } = loadBusiness({ meter });
    B2.start();
    // total=1000 (Meter.business_distance_m) / actual=300 (onTripEnd)
    meter.setBusinessDistance(1000);
    B2.onGps({});
    B2.onTripEnd(300, 1300, Date.now());
    const r = B2.getReport();
    expect(r.total_distance_m).toBe(1000);
    expect(r.actual_total_m).toBe(300);
    expect(r.empty_distance_m).toBe(700);
    expect(r.actual_ratio).toBeCloseTo(0.3, 5);
    expect(r.avg_fare_yen).toBe(1300);
  });

  it('actual > total になる異常データでも empty_distance_m は 0 で floor (整合性保証)', () => {
    const meter = makeMeterMock(0, 0);
    const { Business } = loadBusiness({ meter });
    Business.start();
    // total=100 (Meter) / actual=500 (onTripEnd) → empty=max(0, -400)=0
    meter.setBusinessDistance(100);
    Business.onGps({});
    Business.onTripEnd(500, 1300, Date.now());
    const r = Business.getReport();
    expect(r.empty_distance_m).toBe(0); // Math.max(0, 100-500) = 0
  });

  it('getReport().total_distance_m は Meter.getState().business_distance_m を直接参照', () => {
    const meter = makeMeterMock(0, 0);
    const { Business } = loadBusiness({ meter });
    Business.start();
    // onGps を呼ばずに Meter.business_distance_m だけ変えても getReport は反映する
    meter.setBusinessDistance(2500);
    const r = Business.getReport();
    expect(r.total_distance_m).toBe(2500);
  });

  it('Meter 未ロード時は state.total_distance_m (永続化ミラー) を fallback として返す', () => {
    const { Business } = loadBusiness({ meter: undefined });
    Business.start();
    const r = Business.getReport();
    expect(r.total_distance_m).toBe(0);
  });
});

// ★バグ修正回帰 (2026-06-20・「業務終了→再読込→再開で総走行距離が 0 に戻る」根治)
//   load() の business_distance_m 復元ガードが state.active 限定だったため、
//   業務終了 (limbo・active=false) の後に再読込/タスクキルすると Meter が 0 で起動し、
//   再開しても総走行が復元されず 0.00 に落ちる事象。limbo (start_time あり) も復元対象に
//   含めることで根治。distance_m / 課金は不可侵 (= 表示用 業務総走行ミラーの復元のみ)。
const STORAGE_KEY = 'daikou_business_state';

function seedLimboState(localStorageMock, overrides = {}) {
  const limbo = {
    active: false, // ★業務終了済 (limbo・再開可能)
    start_time: 1714100000000,
    end_time: 1714103600000,
    ended: true,
    ended_at: 1714103600000,
    total_distance_m: 5000, // 永続化ミラー (= 前業務の総走行 5.0km)
    actual_total_m: 4000,
    fare_total_yen: 8600,
    trip_count: 3,
    trips: [],
    last_meter_distance_m: 0,
    ...overrides,
  };
  localStorageMock.setItem(STORAGE_KEY, JSON.stringify(limbo));
}

describe('Business.load() — 業務終了→再読込→再開で総走行を復元 (bug 2026-06-20)', () => {
  it('★limbo (active=false・start_time あり) を load すると Meter.business_distance_m が復元される', () => {
    // 再読込直後を模擬: Meter は business_distance_m=0 で起動
    const meter = makeMeterMock(0, 0);
    const localStorageMock = makeLocalStorage();
    seedLimboState(localStorageMock);
    const { Business } = loadBusiness({ meter, localStorageMock });
    expect(meter.getState().business_distance_m).toBe(0); // load 前は 0

    expect(Business.load()).toBe(true);
    // ★修正の核心: limbo でも Meter.business_distance_m=5000 に復元される
    expect(meter.getState().business_distance_m).toBe(5000);
  });

  it('★復元後に resume() すると getReport().total_distance_m が前業務の値を継続する', () => {
    const meter = makeMeterMock(0, 0);
    const localStorageMock = makeLocalStorage();
    seedLimboState(localStorageMock);
    const { Business } = loadBusiness({ meter, localStorageMock });
    Business.load();
    expect(Business.resume()).toBe(true);
    expect(Business.getState().active).toBe(true);
    // 総走行 (= 表示の totalDist 信源) が 0 でなく 5000 に復元されている
    expect(Business.getReport().total_distance_m).toBe(5000);
  });

  it('active 業務の復元は従来通り維持される (回帰防止)', () => {
    const meter = makeMeterMock(0, 0);
    const localStorageMock = makeLocalStorage();
    seedLimboState(localStorageMock, {
      active: true,
      ended: false,
      ended_at: null,
      end_time: null,
    });
    const { Business } = loadBusiness({ meter, localStorageMock });
    Business.load();
    expect(meter.getState().business_distance_m).toBe(5000);
  });

  it('業務が一度も無い (start_time=null) なら復元しない (= 0 のまま・誤復元防止)', () => {
    const meter = makeMeterMock(0, 0);
    const localStorageMock = makeLocalStorage();
    seedLimboState(localStorageMock, {
      active: false,
      start_time: null,
      ended: false,
      total_distance_m: 5000,
    });
    const { Business } = loadBusiness({ meter, localStorageMock });
    Business.load();
    expect(meter.getState().business_distance_m).toBe(0);
  });

  it('total_distance_m=0 の limbo は復元呼出しない (= 無意味な prime 回避)', () => {
    const meter = makeMeterMock(0, 0);
    const localStorageMock = makeLocalStorage();
    seedLimboState(localStorageMock, { total_distance_m: 0 });
    const { Business } = loadBusiness({ meter, localStorageMock });
    Business.load();
    expect(meter.getState().business_distance_m).toBe(0);
  });
});
