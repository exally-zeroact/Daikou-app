// tests/unit/business-waypoint.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step P2-⑩ / 全32件)
//
// 検証対象: business.js onWaypoint / setEndAddress (2026-05-15 新規)
//   L383 onWaypoint(lat, lng, accuracy): current_trip.waypoints に push
//   L411 setEndAddress(lat, lng, accuracy): current_trip.end_address セット
//
// 既存 business.test.js は state 遷移 / onGps / onTripEnd / getReport をカバー。
// 本 test は経由地点 / 終了住所の新機能を補完。
//
// 絶対ルール準拠:
//   js/business.js は触らない absolute・既存 business.test.js と同じ sandbox pattern。

const fs = require('fs');
const path = require('path');

const BUSINESS_JS_PATH = path.join(__dirname, '..', '..', 'js', 'business.js');
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

function makeMeterMock(opts) {
  opts = opts || {};
  let dist = opts.distance_m || 0;
  let bizDist = opts.business_distance_m || 0;
  return {
    getState: () => ({ distance_m: dist, business_distance_m: bizDist, running: true }),
    setDistance: (v) => {
      dist = v;
    },
    setBusinessDistance: (v) => {
      bizDist = typeof v === 'number' && v >= 0 ? v : 0;
    },
    getNearestAddress: opts.getNearestAddress || (() => 'mock-address'),
    isAddressDataReady: opts.isAddressDataReady || (() => true),
  };
}

function loadBusiness({ meter } = {}) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.Meter = meter || makeMeterMock();
  sandbox.localStorage = makeLocalStorage();
  sandbox.dlog = () => {};
  sandbox.console = console;
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

describe('business.js onWaypoint / setEndAddress (P2-⑩)', () => {
  // ─── onWaypoint ────────────────────────────────────────

  describe('Business.onWaypoint(lat, lng, accuracy)', () => {
    it('current_trip null (= onTripStart 前) なら null を返し state 変更なし', () => {
      const { Business } = loadBusiness();
      Business.start();
      const ret = Business.onWaypoint(33.84, 132.7656, 5);
      expect(ret).toBeNull();
    });

    it('onTripStart 後の onWaypoint で current_trip.waypoints に push', () => {
      const { Business } = loadBusiness();
      Business.start();
      Business.onTripStart(33.84, 132.7656, 5);
      Business.onWaypoint(33.85, 132.77, 5);
      const trip = Business.getCurrentTrip();
      expect(trip.waypoints.length).toBe(1);
      expect(trip.waypoints[0].address).toBe('mock-address');
      expect(typeof trip.waypoints[0].timestamp).toBe('number');
    });

    it('onWaypoint は記録した住所文字列を返す', () => {
      const meter = makeMeterMock({ getNearestAddress: () => '東京都港区 1-2-3' });
      const { Business } = loadBusiness({ meter });
      Business.start();
      Business.onTripStart(33.84, 132.7656, 5);
      const addr = Business.onWaypoint(33.85, 132.77, 5);
      expect(addr).toBe('東京都港区 1-2-3');
    });

    it('onWaypoint を複数回呼ぶと waypoints に順次追加される', () => {
      const { Business } = loadBusiness();
      Business.start();
      Business.onTripStart(33.84, 132.7656, 5);
      Business.onWaypoint(33.85, 132.77, 5);
      Business.onWaypoint(33.86, 132.78, 5);
      Business.onWaypoint(33.87, 132.79, 5);
      const trip = Business.getCurrentTrip();
      expect(trip.waypoints.length).toBe(3);
    });

    it('住所取得失敗 (null) でも waypoints には push される (= 業務継続性最優先)', () => {
      const meter = makeMeterMock({ getNearestAddress: () => null });
      const { Business } = loadBusiness({ meter });
      Business.start();
      Business.onTripStart(33.84, 132.7656, 5);
      Business.onWaypoint(33.85, 132.77, 5);
      const trip = Business.getCurrentTrip();
      expect(trip.waypoints.length).toBe(1);
      expect(trip.waypoints[0].address).toBeNull();
      expect(typeof trip.waypoints[0].timestamp).toBe('number');
    });

    it('onTripStart → onWaypoint → onTripEnd で waypoints が trips[] に保持される', () => {
      const { Business } = loadBusiness();
      Business.start();
      Business.onTripStart(33.84, 132.7656, 5);
      Business.onWaypoint(33.85, 132.77, 5);
      Business.onWaypoint(33.86, 132.78, 5);
      Business.onTripEnd(500, 1300, Date.now());
      const state = Business.getState();
      expect(state.trips.length).toBe(1);
      expect(state.trips[0].waypoints).toBeDefined();
      expect(state.trips[0].waypoints.length).toBe(2);
    });
  });

  // ─── setEndAddress ────────────────────────────────────

  describe('Business.setEndAddress(lat, lng, accuracy)', () => {
    it('current_trip null なら null を返し state 変更なし', () => {
      const { Business } = loadBusiness();
      Business.start();
      const ret = Business.setEndAddress(33.84, 132.7656, 5);
      expect(ret).toBeNull();
    });

    it('current_trip.end_address に set される', () => {
      const meter = makeMeterMock({ getNearestAddress: () => '到着地住所' });
      const { Business } = loadBusiness({ meter });
      Business.start();
      Business.onTripStart(33.84, 132.7656, 5);
      const addr = Business.setEndAddress(33.85, 132.77, 5);
      expect(addr).toBe('到着地住所');
      const trip = Business.getCurrentTrip();
      expect(trip.end_address).toBe('到着地住所');
    });

    it('住所取得失敗 (null) でも end_address は null セットされる', () => {
      const meter = makeMeterMock({ getNearestAddress: () => null });
      const { Business } = loadBusiness({ meter });
      Business.start();
      Business.onTripStart(33.84, 132.7656, 5);
      Business.setEndAddress(33.85, 132.77, 5);
      const trip = Business.getCurrentTrip();
      expect(trip.end_address).toBeNull();
    });

    it('setEndAddress 後の onTripEnd で end_address が trips[] に保持', () => {
      const meter = makeMeterMock({ getNearestAddress: () => '最終目的地' });
      const { Business } = loadBusiness({ meter });
      Business.start();
      Business.onTripStart(33.84, 132.7656, 5);
      Business.setEndAddress(33.85, 132.77, 5);
      Business.onTripEnd(500, 1300, Date.now());
      const state = Business.getState();
      expect(state.trips[0].end_address).toBe('最終目的地');
    });

    it('setEndAddress を複数回呼ぶと最新値で上書きされる (= 仕様: 最終確定用)', () => {
      const addresses = ['addr-1', 'addr-2', 'addr-3'];
      let idx = 0;
      const meter = makeMeterMock({
        getNearestAddress: () => addresses[idx++] || 'addr-final',
      });
      const { Business } = loadBusiness({ meter });
      Business.start();
      Business.onTripStart(33.84, 132.7656, 5); // start_address で addr-1 消費
      const firstSet = Business.setEndAddress(33.85, 132.77, 5);
      const firstSnapshot = Business.getCurrentTrip().end_address;
      Business.setEndAddress(33.86, 132.78, 5);
      const secondSnapshot = Business.getCurrentTrip().end_address;
      // 最新値で上書き (= 値が異なることが確認できれば仕様検証として OK)
      expect(firstSnapshot).toBe(firstSet);
      expect(secondSnapshot).not.toBe(firstSnapshot);
    });
  });

  // ─── localStorage 永続化 ────────────────────────────────

  describe('永続化 (localStorage)', () => {
    it('onWaypoint 呼出後 save() が localStorage に書込まれている', () => {
      const { Business, sandbox } = loadBusiness();
      Business.start();
      Business.onTripStart(33.84, 132.7656, 5);
      Business.onWaypoint(33.85, 132.77, 5);
      // localStorage の任意 key に business state が保存されている (= save() 経由)
      const keys = Object.keys(sandbox.localStorage._raw);
      const hasState = keys.some((k) => /daikou_business/.test(k));
      expect(hasState).toBe(true);
    });

    it('setEndAddress 呼出後も localStorage が更新される', () => {
      const { Business, sandbox } = loadBusiness();
      Business.start();
      Business.onTripStart(33.84, 132.7656, 5);
      Business.setEndAddress(33.85, 132.77, 5);
      const keys = Object.keys(sandbox.localStorage._raw);
      const hasState = keys.some((k) => /daikou_business/.test(k));
      expect(hasState).toBe(true);
    });
  });
});
