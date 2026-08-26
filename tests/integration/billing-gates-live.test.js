// tests/integration/billing-gates-live.test.js
//
// ★AIの指摘②④を「実際に走らせて」見張る★ 2026-08-26（指示役の裁定）
//
//   ソースを読むだけの見張り（drift-static/billing-gates-anchor.test.js）と 2枚重ね。
//   ここは ★本物の Worker B（HMM Viterbi）＋ 本物の meter ＋ 実機で録った本物のGPS★ を通す。
//   土台は tests/replay-mm-worker/worker-sim.js（実コードを Node でそのまま走らせる）。
//
//   ★前提（START_HERE.md の先頭）★
//     代行の距離が真距離より多いのは ★わざと★（係数1.011でDM Lightに合わせる）。
//     ここで見るのは ★意図しない物が乗るか★ だけ。「過大課金」の話ではない。
'use strict';

const fs = require('fs');
const path = require('path');
const { createMapMatcherWorker, loadPrefRoadsData } = require('../replay-mm-worker/worker-sim');
const { loadMeter } = require('../replay-mm-worker/runner');

const FARE = {
  version: 2,
  base_fare: 1300,
  base_distance_m: 1000,
  add_fare: 100,
  add_distance_m: 420,
  tiers: [],
  surcharges: [],
  minFare: null,
  maxFare: null,
};

// ★道路データは 1回だけ読む★（run ごとに読むと 1回 5.5秒 → 見張りが時間切れになる）
let _roads = null;
const ROADS = () => (_roads = _roads || loadPrefRoadsData('ehime'));

const N = 300;
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'realdevice-android.json');

function trace() {
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    .filter((x) => x && Number.isFinite(x.lat))
    .map((x) => ({
      lat: x.lat,
      lng: x.lng !== undefined ? x.lng : x.lon,
      acc: x.acc !== undefined ? x.acc : x.accuracy,
      spd: x.spd !== undefined ? x.spd : x.speed,
      t: x.t !== undefined ? x.t : x.timestamp,
    }))
    .sort((a, b) => a.t - b.t)
    .slice(0, N);
}

function run(samples, opts) {
  opts = opts || {};
  const worker = createMapMatcherWorker({ debug: false });
  let roadsLoaded = false;
  worker.on((e) => {
    if (e.data && e.data.type === 'roadsLoaded') roadsLoaded = e.data.ok;
  });
  const roadsData = ROADS(); // ★道路は1回だけ読む（毎回読むと 見張り自身が重くなる）★
  const Meter = loadMeter({ debug: false });
  Meter.setFareConfig(FARE);
  Meter.reset();

  const handlers = [];
  const seen = { mm: 0 };
  worker.on((e) => {
    let d = e.data;
    if (d && d.type === 'mmResult') {
      seen.mm++;
      if (opts.hook) d = opts.hook(Object.assign({}, d)) || d;
    }
    for (const h of handlers) h({ data: d });
  });
  const adapter = {
    addEventListener(t, h) {
      if (t === 'message') handlers.push(h);
    },
    removeEventListener(t, h) {
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    },
    postMessage(msg) {
      worker.sendMessage(msg);
    },
  };
  Meter.setMapMatcher(adapter);
  adapter.postMessage({ type: 'configPlatform', isIOS: false });
  adapter.postMessage({ type: 'loadRoads', pref: roadsData.prefecture, roadsData });
  if (!roadsLoaded) throw new Error('loadRoads FAIL');

  if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
  if (opts.start !== false) Meter.start();
  // ★開始直後に わざと捨てる窓★を開ける（開けないと 何も通らず「差0」を嘘で出す）
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);

  let i = 0;
  for (const g of samples) {
    if (opts.stopAfter && i === opts.stopAfter) Meter.stop();
    Meter.update({
      lat: g.lat,
      lng: g.lng,
      accuracy: g.acc,
      speedKmh: typeof g.spd === 'number' && g.spd >= 0 ? g.spd * 3.6 : null,
      timestamp: g.t,
      isStationary: false,
    });
    i++;
  }
  const st = Meter.getState();
  return {
    distance_m: st.distance_m,
    business_distance_m: st.business_distance_m || 0,
    fare_yen: st.fare_yen,
    seen,
  };
}

describe('★課金距離の門（実際に走らせて見る）★', () => {
  const S = trace();
  // ★走らせるのは 4回だけ★（同じ物を何度も走らせない＝見張り自身を重くしない）
  const R = {};
  beforeAll(() => {
    R.futsuu = run(S, {});
    R.obd = run(S, {
      hook: (d) => {
        d.pipelineDeltaSrc = 'obd';
        return d;
      },
    });
    R.jissha_nashi = run(S, { start: false });
    R.kakutei = run(S, { stopAfter: Math.floor(S.length / 2) });
  }, 180000);

  it('★測れている事を先に確かめる★（0のまま比べて「同じ」と読まない）', () => {
    const a = R.futsuu;
    expect(a.seen.mm, '★worker から1通も届いていない＝この見張りは何も見ていない★').toBeGreaterThan(
      50
    );
    expect(a.distance_m, '★課金距離が 0 のまま＝何も通っていない★').toBeGreaterThan(100);
  });

  it('★②距離源を obd と返させても 距離は1mmも動かない★', () => {
    const a = R.futsuu;
    const b = R.obd;
    expect(
      Math.abs(b.distance_m - a.distance_m),
      `★距離源で 距離が動いた（${a.distance_m.toFixed(2)}m → ${b.distance_m.toFixed(2)}m）★\n` +
        '  ＝js/meter.js の _kForDelta が 1.0 の定数でなくなった可能性'
    ).toBeLessThan(1e-9);
    expect(b.fare_yen, '★距離源で 料金が動いた★').toBe(a.fare_yen);
  });

  it('★④実車していなければ 課金距離は1mmも増えない★（業務の走行は わざと増える）', () => {
    const off = R.jissha_nashi;
    expect(off.seen.mm, '★worker から1通も届いていない＝測れていない★').toBeGreaterThan(50);
    expect(
      off.distance_m,
      `★実車していないのに 課金距離が ${off.distance_m.toFixed(2)}m 増えた★`
    ).toBe(0);
    // ★業務の走行（空車ぶん）は 増えるのが正しい★（後付メーターと対等にする決まり）
    expect(
      off.business_distance_m,
      '★業務の走行まで止まった（空車ぶんが 後付メーターと合わなくなる）★'
    ).toBeGreaterThan(100);
  });

  it('★④-2 確定した後は 課金距離も料金も 止まる★', () => {
    const zenbu = R.futsuu;
    const fz = R.kakutei;
    expect(
      fz.distance_m,
      `★確定した後も 課金距離が伸びた（${fz.distance_m.toFixed(2)}m）★`
    ).toBeLessThan(zenbu.distance_m);
    expect(fz.fare_yen, '★確定した後も 料金が伸びた★').toBeLessThanOrEqual(zenbu.fare_yen);
  });
});
