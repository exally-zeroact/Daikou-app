// tests/property/business-state-property.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step ㉗ / 全32件)
//
// 検証対象: business.js state 任意操作列での invariant 維持
//   property: 任意 (start/end/resume/onTripEnd/onWaypoint) 操作列で
//     - actual_total_m / fare_total_yen は単調非減少
//     - !state.active 中は onTripEnd で加算なし
//     - state.ended → resume() で active=true 復帰可能

const fs = require('fs');
const path = require('path');
const { fc, propertyAssert } = require('../../scripts/zeroact-test-commons/property-test-helpers');

const B_PATH = path.join(__dirname, '..', '..', 'js', 'business.js');
const SRC = fs.readFileSync(B_PATH, 'utf8');

function makeLS() {
  const s = Object.create(null);
  return {
    getItem: (k) => s[k] || null,
    setItem: (k, v) => {
      s[k] = String(v);
    },
    removeItem: (k) => delete s[k],
    clear: () => {
      for (const k of Object.keys(s)) delete s[k];
    },
    key: (i) => Object.keys(s)[i] || null,
    get length() {
      return Object.keys(s).length;
    },
  };
}

function loadBusiness() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.Meter = {
    getState: () => ({ distance_m: 0, business_distance_m: 0, running: false }),
    setDistance: () => {},
    setBusinessDistance: () => {},
    getNearestAddress: () => 'mock',
  };
  sandbox.localStorage = makeLS();
  sandbox.dlog = () => {};
  sandbox.console = console;
  const fn = new Function(
    'window',
    'Meter',
    'localStorage',
    'dlog',
    'console',
    SRC + '\n;return window.Business;'
  );
  return fn(sandbox, sandbox.Meter, sandbox.localStorage, sandbox.dlog, sandbox.console);
}

describe('business.js state 任意操作 property (㉗)', () => {
  it('B1: actual_total_m / fare_total_yen は単調非減少 (任意操作列)', () => {
    propertyAssert(
      fc.property(
        fc.array(
          fc.record({
            distance: fc.integer({ min: 0, max: 5000 }),
            fare: fc.integer({ min: 0, max: 10000 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (trips) => {
          const B = loadBusiness();
          B.start();
          let prevDist = 0;
          let prevFare = 0;
          for (const t of trips) {
            B.onTripEnd(t.distance, t.fare, Date.now());
            const s = B.getState();
            if (s.actual_total_m < prevDist) {
              throw new Error('actual_total_m 減少');
            }
            if (s.fare_total_yen < prevFare) {
              throw new Error('fare_total_yen 減少');
            }
            prevDist = s.actual_total_m;
            prevFare = s.fare_total_yen;
          }
        }
      )
    );
  });

  it('B2: !state.active 中の onTripEnd は state 不変', () => {
    propertyAssert(
      fc.property(fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 10000 }), (d, f) => {
        const B = loadBusiness();
        // start していないので active=false
        const before = B.getState();
        B.onTripEnd(d, f, Date.now());
        const after = B.getState();
        if (after.actual_total_m !== before.actual_total_m) {
          throw new Error('!active で actual 変化');
        }
      })
    );
  });

  it('B3: end → resume で active=true / ended=false に復帰', () => {
    propertyAssert(
      fc.property(fc.integer({ min: 1, max: 5 }), (n) => {
        const B = loadBusiness();
        for (let i = 0; i < n; i++) {
          B.start();
          B.end();
          const before = B.getState();
          if (before.ended !== true) throw new Error('end 後 ended=true 期待');
          B.resume();
          const after = B.getState();
          if (after.active !== true) throw new Error('resume 後 active=true 期待');
          if (after.ended !== false) throw new Error('resume 後 ended=false 期待');
          B.end();
          B.abandon();
        }
      })
    );
  });

  it('B4: trip_count === trips.length 不変条件', () => {
    propertyAssert(
      fc.property(fc.integer({ min: 0, max: 10 }), (n) => {
        const B = loadBusiness();
        B.start();
        for (let i = 0; i < n; i++) {
          B.onTripEnd(100, 1300, Date.now());
        }
        const s = B.getState();
        if (s.trip_count !== s.trips.length) {
          throw new Error('trip_count vs trips.length 不一致');
        }
      })
    );
  });

  it('B5: 任意 onWaypoint 連続で waypoints.length 単調増加', () => {
    propertyAssert(
      fc.property(fc.integer({ min: 0, max: 20 }), (n) => {
        const B = loadBusiness();
        B.start();
        B.onTripStart(33.84, 132.7656, 5);
        let prevLen = 0;
        for (let i = 0; i < n; i++) {
          B.onWaypoint(33.84 + i * 0.001, 132.7656, 5);
          const trip = B.getCurrentTrip();
          if (trip.waypoints.length <= prevLen && n > 0) {
            throw new Error('waypoints 単調増加違反 at i=' + i);
          }
          prevLen = trip.waypoints.length;
        }
      })
    );
  });

  it('B6: state.start_time が active 中不変', () => {
    propertyAssert(
      fc.property(fc.integer({ min: 0, max: 5 }), (n) => {
        const B = loadBusiness();
        B.start();
        const ts = B.getState().start_time;
        for (let i = 0; i < n; i++) {
          B.onTripEnd(100, 1300, Date.now());
        }
        if (B.getState().start_time !== ts) {
          throw new Error('start_time が active 中に変化');
        }
      })
    );
  });
});
