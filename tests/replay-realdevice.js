#!/usr/bin/env node
'use strict';
// 実機3台の生GPStraceを ★実エンジン(Worker B + Meter + pipeline-distance)★ に流し、
// 距離と内訳(道なり弧長/routing/直線fallback/coast/flip/creep)を実測する。
// ログの値読みでなく「実コードに実入力を流した出力」= 推測ゼロ。
const fs = require('fs');
const { createMapMatcherWorker, loadPrefRoadsData } = require('./replay-mm-worker/worker-sim');
const { loadMeter } = require('./replay-mm-worker/runner');

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
  rounding: 10,
  autoSurcharges: {},
  vehicles: [],
  vehiclesEnabled: false,
  wait: { enabled: false, freeMins: 5, ratePerMin: 100 },
};

function run(label, samples, isIOS) {
  const worker = createMapMatcherWorker({ debug: false });
  let roadsLoaded = false,
    pb = null;
  const mm = [];
  worker.on((e) => {
    const m = e.data;
    if (!m) return;
    if (m.type === 'mmResult') mm.push(m);
    if (m.type === 'roadsLoaded') roadsLoaded = m.ok;
    if (m.type === 'pipelineBreakdown') pb = m;
  });
  const roadsData = loadPrefRoadsData('ehime');
  const Meter = loadMeter({ debug: false });
  Meter.setFareConfig(FARE);
  Meter.reset();
  const handlers = [];
  worker.on((e) => {
    for (const h of handlers) h(e);
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
  adapter.postMessage({ type: 'configPlatform', isIOS });
  adapter.postMessage({ type: 'loadRoads', pref: roadsData.prefecture, roadsData });
  if (!roadsLoaded) {
    console.log(label + ': loadRoads FAIL');
    return;
  }
  if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);

  // 停車中(spd<0.5m/s)に distance_m が増えたか(creep)を更新ごとに観測
  let creep = 0,
    lastDm = 0,
    maxJump = 0;
  for (const g of samples) {
    Meter.update({
      lat: g.lat,
      lng: g.lng,
      accuracy: g.acc,
      speedKmh: typeof g.spd === 'number' && g.spd >= 0 ? g.spd * 3.6 : null,
      headingDeg: g.hdg,
      altitude: g.alt,
      timestamp: g.t,
      isStationary: false,
    });
    const s = Meter.getState();
    const dm = s.distance_m || 0;
    const jump = dm - lastDm;
    if (jump > maxJump) maxJump = jump;
    if (typeof g.spd === 'number' && g.spd < 0.5 && dm - lastDm > 0.01) creep += dm - lastDm;
    lastDm = dm;
  }
  adapter.postMessage({ type: 'getPipelineBreakdown' });
  Meter.businessEnd();
  const fs2 = Meter.getState();
  const bd = pb && pb.breakdown,
    st = pb && pb.stats;
  console.log('\n===== ' + label + ' (isIOS=' + isIOS + ') =====');
  console.log('  入力点数=' + samples.length);
  console.log(
    '  ★エンジン distance_m=' +
      (fs2.distance_m / 1000).toFixed(2) +
      'km  business_distance_m=' +
      ((fs2.business_distance_m || 0) / 1000).toFixed(2) +
      'km★'
  );
  console.log(
    '  停車中(spd<0.5)のdistance_m増加(creep)=' +
      creep.toFixed(1) +
      'm   最大単更新ジャンプ=' +
      maxJump.toFixed(1) +
      'm'
  );
  if (bd) {
    console.log(
      '  内訳: 道なり弧長(sameRoad)=' +
        (bd.sameRoadM || 0).toFixed(0) +
        'm  routing=' +
        (bd.routedM || 0).toFixed(0) +
        'm  直線fallback=' +
        (bd.straightFallbackM || 0).toFixed(0) +
        'm  coast=' +
        (bd.coastM || 0).toFixed(0) +
        'm  doppler=' +
        (bd.dopplerM || 0).toFixed(0) +
        'm'
    );
  }
  if (st) {
    console.log(
      '  stats: Viterbi確定snap=' +
        (st.viterbiSnaps || 0) +
        '  偽flip棄却=' +
        (st.flipRejected || 0) +
        '  直線seg=' +
        (st.straightSegs || 0) +
        '  coastSeg=' +
        (st.coastSegs || 0) +
        '  停止skip=' +
        (st.stationarySkipped || 0)
    );
  }
  console.log('  mmResult数=' + mm.length);
}

const devs = [
  ['iPhone13', true],
  ['iPhoneSE', true],
  ['Android', false],
];
for (const [d, ios] of devs) {
  const f = require('path').join(__dirname, '..', 'data', 'test-results', 'rd_' + d + '.json');
  if (!fs.existsSync(f)) {
    console.log(d + ': fixture無し');
    continue;
  }
  let s = JSON.parse(fs.readFileSync(f, 'utf8'));
  s = s
    .filter((x) => x && Number.isFinite(x.lat) && Number.isFinite(x.lng))
    .sort((a, b) => (a.t || 0) - (b.t || 0));
  try {
    run(d, s, ios);
  } catch (e) {
    console.log(d + ' ERROR: ' + e.message);
  }
}
