#!/usr/bin/env node
'use strict';
// tests/tools/realtest-dm-score.js
// ★実機テスト 業務別 DM Light採点ハーネス (2026-06-25・テストツール先行)★
//   目的: 実走trace(OBD接続・spdsrc=obd)を ★本番と同一配線★(Meter→map-matcher→pipeline)で
//   ★業務別(it=1区間)★ に GPS主体(smoothedRawMode) と OBD主体(OBDメイン∫v) の両方で再生し、
//   随伴車メーター機 DM Light 読みを基準に「実際にDM比何%か」を採点する。
//
//   なぜ新規: replay-obd-main.js は全走行を1個で採点する=司さんの「距離分析は業務別のみ」
//   (feedback_daikome_business_only)に反する。daiko-dm-target-gate.js は stub(道路抜き)で
//   ~1.9%ズレる。本ツールは ★忠実エンジン(roads込み) × 業務別 × DM基準★ を一度に出す。
//
//   採点基準: ★代行=DM Light基準(feedback_daiko_no_overzero_dmlight_reference)★。
//   タクシーの過大ゼロは課さない。GPS主体/OBD主体それぞれが DM比 何% かを並記し、
//   per-car器差(車違いで距離が変わる)を見るための土台にする。1車1走行では器差は出ない
//   (同経路を複数台が走り各台のDMを採る必要がある)ことを明記する。
//
//   本番 distance_m / calcFare 無改変。read-only 検証専用。
//
//   使い方:
//     node tests/tools/realtest-dm-score.js [traceFile] [--dm=11.43,6.77] [--pref=ehime]
//   既定 traceFile = tests/fixtures/realtrace-0617-daiko-dm.json
//   --dm 省略時は trace の meta.dm_ref(trip1_km,trip2_km,...) を使う。
//   meta.daikome_screen があれば「実機画面値(較正の真基準)」も並記する。

const fs = require('fs');
const path = require('path');
const { createMapMatcherWorker, loadPrefRoadsData } = require('../replay-mm-worker/worker-sim');
const { loadMeter } = require('../replay-mm-worker/runner');

// ── replay-obd-main.js と同一の本番配線定数/ペイロード生成(忠実再現) ──
const OBD_STALE_S = 2.0; // 本番 getSpeed().valid は age≤2000ms
const OBD_MAX_DT_S = 10; // pipeline obdMaxDtS と一致(過大ゼロ保険)

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

// obdMain=true: 鮮度内で OBD車速があれば speedSrc='obd' を付与 → pipeline ∫v(OBD) 駆動。
// obdMain=false: speedSrc 無し → 従来 GPS系(smoothedRawMode/snap-arc/coast) = GPS主体。
function buildPayload(g, prevT, obdMain) {
  const base = {
    lat: g.lat,
    lng: g.lng,
    accuracy: g.acc,
    headingDeg: g.hdg,
    altitude: g.alt,
    timestamp: g.t,
    isStationary: false,
  };
  const obdKmh = typeof g.obd === 'number' ? g.obd : -1;
  if (obdMain && obdKmh >= 0) {
    const dt = prevT != null ? (g.t - prevT) / 1000 : 0;
    const fresh = prevT == null || (dt > 0 && dt <= OBD_STALE_S);
    if (fresh) return Object.assign(base, { speedKmh: obdKmh, speedSrc: 'obd' });
  }
  return Object.assign(base, {
    speedKmh: typeof g.spd === 'number' && g.spd >= 0 ? g.spd * 3.6 : null,
  });
}

function makeEngine(pref) {
  const worker = createMapMatcherWorker({ debug: false });
  let roadsLoaded = false;
  worker.on((e) => {
    const m = e.data;
    if (m && m.type === 'roadsLoaded') roadsLoaded = m.ok;
  });
  const roadsData = loadPrefRoadsData(pref);
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
  adapter.postMessage({ type: 'configPlatform', isIOS: false });
  adapter.postMessage({ type: 'loadRoads', pref: roadsData.prefecture, roadsData });
  if (!roadsLoaded) throw new Error('loadRoads failed');
  if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);
  return Meter;
}

// 1業務分の samples を obdMain モードで実エンジン再生し distance_m(km) を返す。
function runSegment(samples, pref, obdMain) {
  const Meter = makeEngine(pref);
  let prevT = null;
  for (const g of samples) {
    Meter.update(buildPayload(g, prevT, obdMain));
    prevT = g.t;
  }
  Meter.businessEnd();
  return (Meter.getState().distance_m || 0) / 1000;
}

// raw ∫v(OBD・k=1): distance_m非依存の素の積分(真距離突合用)。台形・dt<=OBD_MAX_DT_S。
function obdRawIntegralKm(samples) {
  let m = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].t - samples[i - 1].t) / 1000;
    if (!(dt > 0 && dt <= OBD_MAX_DT_S)) continue;
    const a = samples[i - 1].obd;
    const b = samples[i].obd;
    if (!(typeof a === 'number' && a >= 0 && typeof b === 'number' && b >= 0)) continue;
    m += ((a + b) / 2 / 3.6) * dt;
  }
  return m / 1000;
}

// 実車(業務 it=1)区間でセグメント化。daiko-dm-target-gate と同一規則(length>5)。
function segmentBusinesses(samples) {
  const segs = [];
  let cur = null;
  for (const x of samples) {
    const it = x.biz && x.biz.it ? 1 : 0;
    if (it === 1) {
      if (!cur) cur = [];
      cur.push(x);
    } else {
      if (cur && cur.length > 5) segs.push(cur);
      cur = null;
    }
  }
  if (cur && cur.length > 5) segs.push(cur);
  return segs;
}

function parseArgs(argv) {
  const out = { file: null, dm: null, pref: 'ehime' };
  for (const a of argv) {
    let m;
    if ((m = /^--dm=(.+)$/.exec(a))) out.dm = m[1].split(',').map((s) => parseFloat(s));
    else if ((m = /^--pref=(.+)$/.exec(a))) out.pref = m[1].toLowerCase();
    else if (!/^--/.test(a) && !out.file) out.file = a;
  }
  return out;
}

function loadTrace(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const samples = (j.samples || j)
    .filter((x) => x && Number.isFinite(x.lat) && Number.isFinite(x.lng))
    .sort((a, b) => (a.t || 0) - (b.t || 0));
  return { samples, meta: j.meta || null };
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = args.file || path.join(__dirname, '..', 'fixtures', 'realtrace-0617-daiko-dm.json');
  if (!fs.existsSync(file)) {
    console.log('trace 無し: ' + file);
    process.exit(1);
  }
  const { samples, meta } = loadTrace(file);
  const segs = segmentBusinesses(samples);

  // DM Light 基準: --dm 優先 → meta.dm_ref(trip1_km..) → 無ければ null
  let dm = args.dm;
  if (!dm && meta && meta.dm_ref) {
    dm = Object.keys(meta.dm_ref)
      .filter((k) => /trip\d+_km/.test(k))
      .sort()
      .map((k) => meta.dm_ref[k]);
  }
  let screen = null;
  if (meta && meta.daikome_screen) {
    screen = Object.keys(meta.daikome_screen)
      .filter((k) => /trip\d+_km/.test(k))
      .sort()
      .map((k) => meta.daikome_screen[k]);
  }

  console.log('=== 実機テスト 業務別 DM Light採点: ' + path.basename(file) + ' ===');
  console.log('  入力点数=' + samples.length + ' / 業務(it=1)区間=' + segs.length);
  console.log(
    '  基準=DM Light(随伴車メーター) ' + (dm ? '[' + dm.join(', ') + ']km' : '未指定(--dm=…)')
  );
  console.log('  ※代行はDM Light基準(過大ゼロ非拘束)。GPS主体/OBD主体のDM比を並記。');
  console.log('');
  console.log(
    pad('業務', 6) +
      '| ' +
      pad('GPS主体', 10) +
      '| ' +
      pad('OBD主体', 10) +
      '| ' +
      pad('raw∫v', 9) +
      '| ' +
      pad('DM Light', 9) +
      '| ' +
      pad('GPS vs DM', 10) +
      '| ' +
      pad('OBD vs DM', 10) +
      (screen ? '| ' + pad('画面値', 8) : '')
  );
  console.log('-'.repeat(screen ? 92 : 82));

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const gps = runSegment(seg, args.pref, false);
    const obd = runSegment(seg, args.pref, true);
    const raw = obdRawIntegralKm(seg);
    const d = dm && dm[i] != null ? dm[i] : null;
    const gpsPct = d ? ((gps / d - 1) * 100).toFixed(2) + '%' : '—';
    const obdPct = d ? ((obd / d - 1) * 100).toFixed(2) + '%' : '—';
    const sc = screen && screen[i] != null ? screen[i].toFixed(2) + 'km' : '—';
    console.log(
      pad('実車' + (i + 1), 6) +
        '| ' +
        pad(gps.toFixed(3) + 'km', 10) +
        '| ' +
        pad(obd.toFixed(3) + 'km', 10) +
        '| ' +
        pad(raw.toFixed(3), 9) +
        '| ' +
        pad(d != null ? d.toFixed(2) + 'km' : '—', 9) +
        '| ' +
        pad(gpsPct, 10) +
        '| ' +
        pad(obdPct, 10) +
        (screen ? '| ' + pad(sc, 8) : '')
    );
  }
  console.log('');
  console.log(
    '※GPS主体とOBD主体の差=この1台での距離方式差。per-car器差(車違いで距離が変わる#1問題)は'
  );
  console.log('  同経路を複数台が走り各台のDM Lightを採らないと見えない(1走行では出ない)。');
  if (screen)
    console.log('※画面値=実機が表示した distance_m(較正の真基準)。忠実エンジンはこれに近いはず。');
}

main();
