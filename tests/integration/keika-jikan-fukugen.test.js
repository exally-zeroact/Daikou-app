'use strict';
// ============================================================
// ★経過時間が タスクキルの 後に 0 から 数え直しに ならない★（2026-10-11）
//
//   前は メーターの 控え（dk_meter_snapshot・js/meter-persist.js）が
//   meter.js の elapsed_accumulated_sec を そのまま 書いていた。
//   ここに 足されるのは stop と 業務終了の 時だけ＝止めずに 走っている 代行では 0。
//   起動の 時は checkDrivingRestore（daikou_driving_state の elapsed_sec）の 後に
//   _restoreMeterSnapshot が 走り、0 で 上書きしていた（確定画面の「経過時間」と 終了の 記録に 出る）。
//
//   ここでは 本物の meter.js・meter-persist.js と、index.html から 切り出した
//   本物の _restoreMeterSnapshot を 回す（画面の 関数を 真似ない）。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const METER = path.join(ROOT, 'js', 'meter.js');
const MP = path.join(ROOT, 'js', 'meter-persist.js');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const BIZ = 1785890000000;
const TRIP = 1785899000000;

let store;
let T;
const realNow = Date.now;

function freshMeter() {
  delete require.cache[require.resolve(METER)];
  return require(METER);
}

function restoreFn() {
  const at = HTML.indexOf('function _restoreMeterSnapshot() {');
  expect(at, '_restoreMeterSnapshot が index.html に 無い').toBeGreaterThan(0);
  const end = HTML.indexOf('\n      }\n', at);
  const src = HTML.slice(at, end + 8);
  // eslint-disable-next-line no-new-func
  return new Function(
    'Meter',
    'MeterPersist',
    '_meterCtx',
    'window',
    'dlog',
    src + '\nreturn _restoreMeterSnapshot;'
  );
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
  T = 1785900000000;
  Date.now = () => T;
});
afterEach(() => {
  Date.now = realNow;
  delete globalThis.localStorage;
});

function hashiruToKoroshite(minutes) {
  const P = require(MP);
  const m1 = freshMeter();
  m1.setBusinessActive(true);
  m1.start();
  T += minutes * 60 * 1000;
  const st = m1.getState();
  expect(st.elapsed_sec).toBe(minutes * 60);
  // 本物の 書き方（index.html _saveMeterSnapshot と 同じ 引数）
  expect(P.save(null, st, { businessStart: BIZ, tripStart: TRIP, now: T })).toBe(true);
  // daikou_driving_state（A の 刻み）は elapsed_sec を 持つ
  const ds = { elapsed_sec: st.elapsed_sec, distance_m: st.distance_m };
  T += 5000; // 落ちて 開き直す
  return { P, ds };
}

describe('★タスクキルの 後も 経過時間が 続く★', () => {
  it('控えに 今 走っている 分の 経過時間が 入る（0 でない）', () => {
    hashiruToKoroshite(15);
    const j = JSON.parse(store.dk_meter_snapshot);
    expect(j.elapsed_accumulated_sec).toBe(15 * 60 * 1000);
  });

  it('checkDrivingRestore の 後に 控えを 戻しても 15分 から 続く', () => {
    const { P, ds } = hashiruToKoroshite(15);
    const m2 = freshMeter();
    m2.setBusinessActive(true);
    // checkDrivingRestore（index.html）と 同じ 順
    m2.start();
    m2.setElapsedAccumulated(ds.elapsed_sec * 1000);
    const fn = restoreFn()(
      m2,
      P,
      () => ({ businessStart: BIZ, tripStart: TRIP, now: T }),
      {},
      null
    );
    fn();
    T += 1000;
    expect(m2.getState().elapsed_sec).toBe(15 * 60 + 1);
  });

  it('daikou_driving_state が 無くても 控えだけで 15分 から 続く', () => {
    const { P } = hashiruToKoroshite(15);
    const m2 = freshMeter();
    m2.setBusinessActive(true);
    m2.start();
    const fn = restoreFn()(
      m2,
      P,
      () => ({ businessStart: BIZ, tripStart: TRIP, now: T }),
      {},
      null
    );
    fn();
    T += 1000;
    expect(m2.getState().elapsed_sec).toBe(15 * 60 + 1);
  });

  it('★控えの 方が 短い 時は 上書きしない★（今の 経過時間を 縮めない）', () => {
    const P = require(MP);
    store.dk_meter_snapshot = JSON.stringify({
      v: 1,
      saved_at: T - 1000,
      business_start_time: BIZ,
      trip_start_time: TRIP,
      distance_m: 0,
      business_distance_m: 0,
      elapsed_accumulated_sec: 0,
      fare_yen: 0,
      wait_sec: 0,
      running: true,
      business_active: true,
      billing_frozen: false,
    });
    const m2 = freshMeter();
    m2.setBusinessActive(true);
    m2.start();
    m2.setElapsedAccumulated(900 * 1000);
    const fn = restoreFn()(
      m2,
      P,
      () => ({ businessStart: BIZ, tripStart: TRIP, now: T }),
      {},
      null
    );
    fn();
    expect(m2.getState().elapsed_sec).toBe(900);
  });
});
