// tests/tools/addr2-road-flicker-probe.js
// ★住所②"道路レベルの荒れ"再現プローブ (2026-06-19・OSRM廃止×住所監査 STEP A)★
//   町ゲート(gate-address2-accuracy)は町ポリゴン単位で「同じ町内で違う道へパタパタ飛ぶ」荒れを見れない。
//   本プローブは ★prod の map-matcher を忠実に流し、住所②が読む snap の road-id(roadIndex) を毎フレーム記録★ し、
//   道路レベルの flicker(短時間 A→B→A 往復)・平行道ジャンプ(位置近いが別road)を定量化する。
//   司さん「しまなみ実走(realtrace-0618)で距離バグと一緒に住所も荒れた」→ そのtraceで荒れを捕まえる。
//   使い方: node tests/tools/addr2-road-flicker-probe.js [fixture=realtrace-0618-shimanami-obd.json] [pref=ehime]
'use strict';
const path = require('path');
const fs = require('fs');
const { createMapMatcherWorker, loadPrefRoadsData } = require(
  path.join(__dirname, '..', 'replay-mm-worker', 'worker-sim')
);
const { loadMeter } = require(path.join(__dirname, '..', 'replay-mm-worker', 'runner'));

const FIX = process.argv[2] || 'realtrace-0618-shimanami-obd.json';
const PREF = process.argv[3] || 'ehime';
const FLICKER_DWELL_MS = 3000; // B滞在がこれ未満で A→B→A に戻る = flicker(荒れ)
const PARALLEL_M = 30; // 別roadだが snap位置がこれ以内 = 平行道ジャンプ

function haversineM(aLat, aLng, bLat, bLng) {
  const R = 6371000,
    toR = Math.PI / 180;
  const dLat = (bLat - aLat) * toR,
    dLng = (bLng - aLng) * toR;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ★実物が要る＝無ければ 未測定で 赤★ 2026-08-28（指示役の裁定③-3）
//   ★0件と 未測定を 混ぜない★。読む人に「異常なし」と 見えてはいけない。
const _fixPath = path.join(__dirname, '..', 'fixtures', FIX);
if (!fs.existsSync(_fixPath)) {
  console.error('★未測定★ 材料が 在りません: ' + _fixPath);
  console.error('  MISOKUTEI=1 reason=fixture-not-found');
  console.error('  ⇒「測っていない」であって「異常なし」ではありません。');
  process.exit(1);
}
const samples = JSON.parse(fs.readFileSync(_fixPath, 'utf8'));
const arr = Array.isArray(samples) ? samples : samples.samples || samples.points || [];
if (!arr.length) {
  console.error('★未測定★ 材料に 点が 1つも 在りません: ' + _fixPath);
  console.error('  MISOKUTEI=1 reason=fixture-empty');
  process.exit(1);
}

const worker = createMapMatcherWorker({ debug: false });
const mmResults = [];
let roadsLoaded = false;
worker.on((e) => {
  const m = e.data;
  if (!m) return;
  if (m.type === 'mmResult') mmResults.push(m);
  if (m.type === 'roadsLoaded') roadsLoaded = m.ok;
});
const roadsData = loadPrefRoadsData(PREF);
const Meter = loadMeter({ debug: false });
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
adapter.postMessage({ type: 'configPlatform', isIOS: true });
adapter.postMessage({ type: 'loadRoads', pref: roadsData.prefecture, roadsData });
if (!roadsLoaded) throw new Error('loadRoads failed pref=' + PREF);
if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
Meter.start();
if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);

// 各フレームの住所②snap road-id を記録(getCurrentLiveAddress 段階1 と同じ snap)。
const seq = []; // {t, road, lat, lng}
let lastSnap = null;
for (const g of arr) {
  const before = mmResults.length;
  Meter.update({
    lat: g.lat,
    lng: g.lng,
    accuracy: g.acc,
    speedKmh: g.spd >= 0 ? g.spd * 3.6 : null,
    headingDeg: g.hdg,
    altitude: g.alt,
    timestamp: g.t,
    isStationary: false,
  });
  for (let i = before; i < mmResults.length; i++) {
    const m = mmResults[i];
    if (m.snap && Number.isFinite(m.snap.roadIndex) && Number.isFinite(m.snap.snapLat))
      lastSnap = m.snap;
  }
  // ★snap位置 vs 生GPS の離隔(=遠snap=全然違う場所)・生GPSスパイクも記録★
  const snapGpsM = lastSnap ? haversineM(g.lat, g.lng, lastSnap.snapLat, lastSnap.snapLng) : -1;
  if (lastSnap)
    seq.push({
      t: g.t,
      road: lastSnap.prefecture + '#' + lastSnap.roadIndex,
      lat: lastSnap.snapLat,
      lng: lastSnap.snapLng,
      gLat: g.lat,
      gLng: g.lng,
      gAcc: g.acc,
      snapGpsM: snapGpsM,
    });
}

// ── ★遠snap(全然違う場所)＆生GPSスパイク 検出★ ──
let far50 = 0,
  far100 = 0,
  far200 = 0,
  maxSnapGps = 0;
const farAt = [];
for (let i = 0; i < seq.length; i++) {
  const d = seq[i].snapGpsM;
  if (d > maxSnapGps) maxSnapGps = d;
  if (d > 50) far50++;
  if (d > 100) far100++;
  if (d > 200) far200++;
  if (d > 100)
    farAt.push({
      t: seq[i].t,
      snapGpsM: Math.round(d),
      gAcc: Math.round(seq[i].gAcc),
      road: seq[i].road,
    });
}
// 生GPSスパイク(連続生点が物理的にあり得ない速度=>飛び)
let gpsSpike = 0,
  maxGpsStep = 0;
const spikeAt = [];
for (let i = 1; i < seq.length; i++) {
  const dt = (seq[i].t - seq[i - 1].t) / 1000;
  if (dt <= 0) continue;
  const dm = haversineM(seq[i - 1].gLat, seq[i - 1].gLng, seq[i].gLat, seq[i].gLng);
  const mps = dm / dt;
  if (dm > maxGpsStep) maxGpsStep = dm;
  if (mps > 60) {
    gpsSpike++;
    spikeAt.push({ t: seq[i].t, stepM: Math.round(dm), mps: Math.round(mps) });
  }
}

// ── 道路レベル flicker / 平行道ジャンプ 計測 ──
let changes = 0,
  flicker = 0,
  parallelJump = 0,
  farJump = 0;
const flickerAt = [];
for (let i = 1; i < seq.length; i++) {
  if (seq[i].road === seq[i - 1].road) continue;
  changes++;
  // 平行道? (位置近いのに別road)
  const d = haversineM(seq[i - 1].lat, seq[i - 1].lng, seq[i].lat, seq[i].lng);
  if (d <= PARALLEL_M) parallelJump++;
  else farJump++;
  // A→B→A flicker: 直前のroad(A)へ短時間で戻るか前方探索
  const A = seq[i - 1].road,
    B = seq[i].road;
  for (let j = i + 1; j < seq.length && seq[j].t - seq[i].t <= FLICKER_DWELL_MS; j++) {
    if (seq[j].road === A) {
      flicker++;
      flickerAt.push({ t: seq[i].t, A, B, backMs: seq[j].t - seq[i].t, parallelM: Math.round(d) });
      break;
    }
    if (seq[j].road !== B) break;
  }
}

const span = seq.length ? (seq[seq.length - 1].t - seq[0].t) / 1000 : 0;
console.log('=== 住所② 道路レベル flicker プローブ ===');
console.log('fixture=%s pref=%s', FIX, PREF);
console.log('snap点数=%d / 走行時間=%ds', seq.length, Math.round(span));
console.log('road切替 総数=%d', changes);
console.log('★flicker(A→B→A・%dms以内に戻る)=%d', FLICKER_DWELL_MS, flicker);
console.log('  ├ 平行道ジャンプ(≤%dm・近接別道)=%d', PARALLEL_M, parallelJump);
console.log('  └ 遠ジャンプ(>%dm・別道へ飛ぶ)=%d', PARALLEL_M, farJump);
console.log(
  'flicker率=%s%% (flicker/road切替)',
  changes ? ((100 * flicker) / changes).toFixed(1) : '0'
);
console.log('--- 最初の10件 flicker 発生点 ---');
flickerAt
  .slice(0, 10)
  .forEach((f) =>
    console.log('  t=%d  %s → %s → 戻り(%dms後・離隔%dm)', f.t, f.A, f.B, f.backMs, f.parallelM)
  );
console.log('');
console.log('=== ★遠snap(全然違う場所) 検出 ===');
console.log('snap位置 vs 生GPS 最大離隔=%dm', Math.round(maxSnapGps));
console.log('  >50m=%d点 / >100m=%d点 / >200m=%d点', far50, far100, far200);
farAt
  .slice(0, 10)
  .forEach((f) =>
    console.log('  t=%d  離隔%dm (acc=%dm) road=%s', f.t, f.snapGpsM, f.gAcc, f.road)
  );
console.log('=== ★生GPSスパイク(>60m/s) 検出 ===');
console.log('最大生GPSステップ=%dm / スパイク=%d点', Math.round(maxGpsStep), gpsSpike);
spikeAt.slice(0, 10).forEach((f) => console.log('  t=%d  step=%dm (%dm/s)', f.t, f.stepM, f.mps));
