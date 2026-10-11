'use strict';
// ============================================================
// ★タスクキルの 後に 待機の 秒（と 待機料金）が 消えない★（2026-10-11）
//
//   js/meter-persist.js は 同じ 代行の 時だけ wait_sec を 返していたが、
//   index.html の _restoreMeterSnapshot は 読まず、Meter に 戻す 口も 無かった。
//   待機料金を 入れた 会社では 開き直すと 待機が 0 に なり、料金が 下がっていた
//   （「前回の続きから ◯円」の 知らせの 額とも 合わない）。
//
//   本物の meter.js・meter-persist.js と、index.html から 切り出した
//   本物の _restoreMeterSnapshot を 回す。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const METER = path.join(ROOT, 'js', 'meter.js');
const MP = path.join(ROOT, 'js', 'meter-persist.js');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const BIZ = 1785890000000;
const TRIP = 1785899000000;
const WAIT = { wait: { enabled: true, freeMins: 5, ratePerMin: 100 } };

let store;

function freshMeter() {
  delete require.cache[require.resolve(METER)];
  const m = require(METER);
  m.setFareConfig(WAIT);
  m.setBusinessActive(true);
  m.start();
  return m;
}

function restoreFn() {
  const at = HTML.indexOf('function _restoreMeterSnapshot() {');
  expect(at, '_restoreMeterSnapshot が index.html に 無い').toBeGreaterThan(0);
  const end = HTML.indexOf('\n      }\n', at);
  // eslint-disable-next-line no-new-func
  return new Function(
    'Meter',
    'MeterPersist',
    '_meterCtx',
    'window',
    'dlog',
    'showToastLong',
    'appState',
    'onSend',
    HTML.slice(at, end + 8) + '\nreturn _restoreMeterSnapshot;'
  );
}

function hikae(over) {
  store.dk_meter_snapshot = JSON.stringify(
    Object.assign(
      {
        v: 1,
        saved_at: Date.now() - 5000,
        business_start_time: BIZ,
        trip_start_time: TRIP,
        distance_m: 3000,
        business_distance_m: 3000,
        elapsed_accumulated_sec: 0,
        fare_yen: 0,
        wait_sec: 900, // 15分 待った＝無料 5分を 引いて 10分＝1,000円
        running: true,
        business_active: true,
        billing_frozen: false,
      },
      over || {}
    )
  );
}

function modosu(m, tripStart, onSend) {
  const P = require(MP);
  const fn = restoreFn()(
    m,
    P,
    () => ({ businessStart: BIZ, tripStart: tripStart, now: Date.now() }),
    {},
    null,
    () => {},
    'driving',
    onSend || (() => {})
  );
  fn();
}

beforeEach(() => {
  store = {};
  globalThis.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  };
});
afterEach(() => {
  delete globalThis.localStorage;
});

describe('★同じ 代行なら 待機を 戻し、料金も 待機込みに なる★', () => {
  it('待機 15分（課金 10分）を 戻すと 料金が 待機 0 の 時より 1,000円 高い', () => {
    hikae({ wait_sec: 0 });
    const m0 = freshMeter();
    modosu(m0, TRIP);
    const nashi = m0.getState().fare_yen;

    hikae();
    const m1 = freshMeter();
    modosu(m1, TRIP);
    const st = m1.getState();
    expect(st.wait_sec).toBe(900);
    expect(st.distance_m).toBe(3000);
    expect(st.fare_yen - nashi).toBe(1000);
  });

  it('★知らせの 額（控えの fare_yen）と 戻した 後の 料金が 合う★', () => {
    const P = require(MP);
    const m1 = freshMeter();
    m1.setDistance(3000);
    m1.setWaitSec(900);
    const mae = m1.getState();
    expect(P.save(null, mae, { businessStart: BIZ, tripStart: TRIP, now: Date.now() })).toBe(true);
    const m2 = freshMeter();
    modosu(m2, TRIP);
    expect(m2.getState().fare_yen).toBe(mae.fare_yen);
  });
});

describe('★戻さない 時★', () => {
  it('別の 代行の 控えでは 待機を 戻さない（距離だけ）', () => {
    hikae();
    const m = freshMeter();
    modosu(m, TRIP + 1);
    expect(m.getState().wait_sec).toBe(0);
    expect(m.getState().distance_m).toBe(3000);
  });

  it('今の 待機より 短い 控えでは 縮めない', () => {
    const m = freshMeter();
    m.setWaitSec(1200);
    m.setWaitSec(600);
    expect(m.getState().wait_sec).toBe(1200);
  });

  it('数でない・負の 値では 変えない', () => {
    const m = freshMeter();
    m.setWaitSec(300);
    m.setWaitSec(-1);
    m.setWaitSec(NaN);
    m.setWaitSec('900');
    expect(m.getState().wait_sec).toBe(300);
  });
});

describe('★確定した 後に 落ちても、確定額より 上がらない★（taiketsu の 指摘・10-11）', () => {
  function kakuteiShiteKorosu() {
    const P = require(MP);
    const m1 = freshMeter();
    m1.setDistance(3000);
    m1.setWaitSec(900);
    m1.freezeBilling(); // 確定
    const kakutei = m1.getState().fare_yen;
    expect(
      P.save(null, m1.getState(), { businessStart: BIZ, tripStart: TRIP, now: Date.now() })
    ).toBe(true);
    return kakutei;
  }

  it('開き直した 後に 停車 300秒（客の 支払い中）でも 料金は 確定額の まま', () => {
    const kakutei = kakuteiShiteKorosu();
    const m2 = freshMeter();
    m2.setDistance(3000); // checkDrivingRestore と 同じ
    modosu(m2, TRIP);
    expect(m2.getState().billing_frozen).toBe(true);
    let t = Date.now();
    m2.setLastGps(35, 139, 0, 0, t);
    for (let i = 0; i < 300; i++) {
      t += 1000;
      m2.update({ lat: 35, lng: 139, altitude: 0, speedKmh: 0, accuracy: 5, timestamp: t });
    }
    const st = m2.getState();
    expect(st.fare_yen).toBe(kakutei);
    expect(m2.calcFare(st.distance_m)).toBe(kakutei);
  });

  it('確定画面へ 戻す（onSend を 1回 呼ぶ）', () => {
    kakuteiShiteKorosu();
    const m2 = freshMeter();
    let n = 0;
    modosu(m2, TRIP, () => n++);
    expect(n).toBe(1);
  });

  it('確定して いない 控えでは 凍結も 確定画面へも 行かない', () => {
    hikae({ billing_frozen: false });
    const m2 = freshMeter();
    let n = 0;
    modosu(m2, TRIP, () => n++);
    expect(m2.getState().billing_frozen).toBe(false);
    expect(n).toBe(0);
  });

  it('別の 代行の 控えが 確定済みでも 凍結しない', () => {
    hikae({ billing_frozen: true });
    const m2 = freshMeter();
    let n = 0;
    modosu(m2, TRIP + 1, () => n++);
    expect(m2.getState().billing_frozen).toBe(false);
    expect(n).toBe(0);
  });
});
