#!/usr/bin/env node
'use strict';
// ★OBDメイン距離 実エンジン再生ハーネス (2026-06-10・テスト班)★
//   司さん裁定: OBD接続中はOBD車輪速度をメイン距離源にする(=タクシー認定の基準ローラー量)。
//   このハーネスは ★本番と同一配線★ で OBD メイン経路を実コードで再生・採点する:
//     fixture(0610-Android = OBD車速あり) の各点を Meter.update に流す際に
//     ★speedSrc='obd' + speedKmh=OBD車速★ を付与 →
//     map-matcher が obd:true を立て(L307-309) →
//     pipeline-distance の ∫v(OBD) メイン枝(L1666)が距離を駆動。
//
//   現行 truedist-score-0610.js / _analyze-obd.js / replay-realdevice.js は speedSrc を
//   一切渡さない=本番の OBD メイン経路は replay で永久に未発火だった(unit 合成のみ)。
//   このハーネスがその穴を埋め、OBD×k 距離・creep・最大lump を実エンジン出力で出す。
//
// 使い方:
//   node tests/replay-obd-main.js [fixtureFile] [trueKm] [--k=1.04]
//   既定: 0610-Android.json (この車は OBD あり)。trueKm 省略時は biz.td 差を真値代理に使う。
//
// 出力(GPS系 vs OBDメイン系 を並記):
//   ・GPS系   = speedSrc を付けず従来パイプライン(smoothedRaw/snap-arc/coast)
//   ・OBDメイン = speedSrc='obd' で ∫v(OBD) 駆動 = 本番 OBD接続時の挙動
//   ・raw ∫v(OBD・k=1)  = 司さん要望の素のOBD精度(distance_m に k 未適用)
//   ・OBD×k = 採点側で k を掛けた距離(distance_m 不可侵のため pipeline には raw を渡す)
//   ・creep / 最大lump(停車時) / 最大単更新ジャンプ
//
//   ★過大ゼロ(never-over)★: OBDメイン distance_m ≤ raw∫v×k_cap を assert。

const fs = require('fs');
const path = require('path');
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

// OBD 鮮度: 本番 getSpeed().valid は age≤2000ms。replay は連続 dt で近似する。
const OBD_STALE_S = 2.0;
const OBD_MAX_DT_S = 10; // pipeline obdMaxDtS と一致(過大ゼロ保険・穴は ∫v 計上しない)

function parseK(argv) {
  for (const a of argv) {
    const m = /^--k=([0-9.]+)$/.exec(a);
    if (m) return parseFloat(m[1]);
  }
  return null;
}

// ★本番配線を再現する Meter.update ペイロード生成★
//   obdMain=true の時: 前点との dt が鮮度内 かつ OBD車速が有効(>=0)なら speedSrc='obd' を付与。
//   鮮度切れ/欠測(obd<0)は speedSrc 無し(=従来 Doppler/GPS 系へ自然フォールバック)。
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
    if (fresh) {
      // ★OBD車速をメイン距離源に★: speedKmh=OBD・speedSrc='obd' → pipeline ∫v(OBD) 駆動
      return Object.assign(base, { speedKmh: obdKmh, speedSrc: 'obd' });
    }
  }
  // 従来 GPS系: Doppler(spd m/s→km/h)。spd<0 は null(=不明=hav代用に落ちる)
  return Object.assign(base, {
    speedKmh: typeof g.spd === 'number' && g.spd >= 0 ? g.spd * 3.6 : null,
  });
}

function makeEngine(isIOS) {
  const worker = createMapMatcherWorker({ debug: false });
  let roadsLoaded = false;
  worker.on((e) => {
    const m = e.data;
    if (m && m.type === 'roadsLoaded') roadsLoaded = m.ok;
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
  if (!roadsLoaded) throw new Error('loadRoads failed');
  if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);
  return Meter;
}

function run(samples, isIOS, obdMain) {
  const Meter = makeEngine(isIOS);
  let creep = 0,
    lastDm = 0,
    maxJump = 0,
    maxJumpAtSpd0 = 0,
    prevT = null;
  for (const g of samples) {
    Meter.update(buildPayload(g, prevT, obdMain));
    prevT = g.t;
    const dm = Meter.getState().distance_m || 0;
    const jump = dm - lastDm;
    if (jump > maxJump) maxJump = jump;
    const stopped = typeof g.spd !== 'number' || g.spd < 0.5;
    if (stopped && jump > maxJumpAtSpd0) maxJumpAtSpd0 = jump;
    if (typeof g.spd === 'number' && g.spd < 0.5 && jump > 0.01) creep += jump;
    lastDm = dm;
  }
  Meter.businessEnd();
  const st = Meter.getState();
  return {
    distance_m: st.distance_m || 0,
    business_distance_m: st.business_distance_m || 0,
    creep,
    maxJump,
    maxJumpAtSpd0,
    n: samples.length,
  };
}

// ★raw ∫v(OBD・k=1)★: distance_m に依存しない素の積分(司さん要望・真距離突合用)。
//   pipeline と同じ台形・dt<=obdMaxDtS で穴は計上しない=過大ゼロ側。
function obdRawIntegral(samples) {
  let m = 0,
    segs = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].t - samples[i - 1].t) / 1000;
    if (!(dt > 0 && dt <= OBD_MAX_DT_S)) continue;
    const a = samples[i - 1].obd,
      b = samples[i].obd;
    if (!(typeof a === 'number' && a >= 0 && typeof b === 'number' && b >= 0)) continue;
    m += ((a + b) / 2 / 3.6) * dt; // km/h → m/s
    segs++;
  }
  return { km: m / 1000, segs };
}

function bizTdSpanKm(samples) {
  let lo = Infinity,
    hi = -Infinity;
  for (const x of samples) {
    if (x.biz && typeof x.biz.td === 'number') {
      lo = Math.min(lo, x.biz.td);
      hi = Math.max(hi, x.biz.td);
    }
  }
  return hi > lo ? (hi - lo) / 1000 : null;
}

function loadFixture(name) {
  const f = path.isAbsolute(name) ? name : path.join(__dirname, 'fixtures', name);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'))
    .filter((x) => x && Number.isFinite(x.lat) && Number.isFinite(x.lng))
    .sort((a, b) => (a.t || 0) - (b.t || 0));
}

// ---- main ----
const fixArg = process.argv[2] || '0610-Android.json';
const trueArg =
  process.argv[3] && !/^--/.test(process.argv[3]) ? parseFloat(process.argv[3]) : null;
const K_OPT = parseK(process.argv.slice(2));
const k = K_OPT != null ? K_OPT : 1.04; // 暫定(index.html:13368: 実車 OBD k=1 は -2.85〜-3.86% 過小)

const samples = loadFixture(fixArg);
if (!samples) {
  console.log('fixture 無し: ' + fixArg);
  process.exit(1);
}
const obdPts = samples.filter((x) => typeof x.obd === 'number' && x.obd >= 0).length;
const isIOS = /iphone/i.test(fixArg);

const rawObd = obdRawIntegral(samples);
const tdSpan = bizTdSpanKm(samples);
const trueKm = trueArg != null ? trueArg : tdSpan; // 真値: 指定 > biz.td 差(代理)

console.log('=== OBDメイン距離 実エンジン再生: ' + path.basename(fixArg) + ' ===');
console.log(
  '  入力点数=' +
    samples.length +
    ' / OBD有効点=' +
    obdPts +
    ' (' +
    ((obdPts / samples.length) * 100).toFixed(0) +
    '%) / isIOS=' +
    isIOS
);
console.log(
  '  真値(' +
    (trueArg != null ? '指定' : 'biz.td差・代理') +
    ')=' +
    (trueKm != null ? trueKm.toFixed(3) + 'km' : '—') +
    ' / 暫定k=' +
    k
);
if (obdPts === 0)
  console.log(
    '  ⚠ この fixture に OBD車速が無い(iPhone等)。OBDメイン採点は不可=GPS系のみ意味あり。'
  );
console.log('');

const gps = run(samples, isIOS, false);
let obd = null;
if (obdPts > 0) {
  try {
    obd = run(samples, isIOS, true);
  } catch (e) {
    console.log('OBDメイン ERROR: ' + e.message);
  }
}

function errPct(km) {
  return trueKm ? ((km / trueKm - 1) * 100).toFixed(2) + '%' : '—';
}
function band(km) {
  if (!trueKm) return '—';
  const e = (km / trueKm - 1) * 100;
  return e > 0 ? '✗過大(失格)' : e >= -4 ? '✓合格' : '✗過小';
}

console.log('経路              | distance_m  | vs真値   | バンド      | creep   | 停車最大lump');
console.log('------------------|-------------|---------|------------|---------|-------------');
const gKm = gps.distance_m / 1000;
console.log(
  'GPS系(従来)       | ' +
    (gKm.toFixed(3) + 'km').padStart(11) +
    ' | ' +
    errPct(gKm).padStart(7) +
    ' | ' +
    band(gKm).padEnd(10) +
    ' | ' +
    (gps.creep.toFixed(1) + 'm').padStart(7) +
    ' | ' +
    (gps.maxJumpAtSpd0.toFixed(0) + 'm').padStart(11)
);
if (obd) {
  const oKm = obd.distance_m / 1000;
  console.log(
    'OBDメイン(distance)| ' +
      (oKm.toFixed(3) + 'km').padStart(11) +
      ' | ' +
      errPct(oKm).padStart(7) +
      ' | ' +
      band(oKm).padEnd(10) +
      ' | ' +
      (obd.creep.toFixed(1) + 'm').padStart(7) +
      ' | ' +
      (obd.maxJumpAtSpd0.toFixed(0) + 'm').padStart(11)
  );
}
console.log('');
console.log(
  '★raw ∫v(OBD・k=1)★ = ' +
    rawObd.km.toFixed(3) +
    'km (' +
    rawObd.segs +
    'segs)  vs真値 ' +
    errPct(rawObd.km) +
    '  ' +
    band(rawObd.km)
);
console.log(
  '★OBD×k=' +
    k +
    '★       = ' +
    (rawObd.km * k).toFixed(3) +
    'km  vs真値 ' +
    errPct(rawObd.km * k) +
    '  ' +
    band(rawObd.km * k)
);
if (obd) {
  // ★never-over assert: OBDメイン distance_m(=pipeline ∫v, k 未適用) ≤ raw∫v(k=1)★
  //   pipeline は raw spd を積分するので distance_m は raw∫v と一致するはず(±丸め)。
  //   k は採点側のみ適用=distance_m 不可侵。OBD×k は採点表示専用。
  const oKm = obd.distance_m / 1000;
  const neverOver = oKm <= rawObd.km * 1.02 + 0.05; // 2%丸め余裕
  console.log(
    '\n[GATE] OBDメイン distance_m(' +
      oKm.toFixed(3) +
      ') ≤ raw∫v×1.02(' +
      (rawObd.km * 1.02).toFixed(3) +
      ') : ' +
      (neverOver ? '✓ PASS (never-over)' : '✗ FAIL = pipeline が raw∫v を超過(過大)')
  );
  if (trueKm) {
    const overTrue = oKm > trueKm + 0.001;
    console.log(
      '[GATE] OBDメイン distance_m ≤ 真値(' +
        trueKm.toFixed(3) +
        ') : ' +
        (overTrue ? '✗ 過大(認定失格)' : '✓ PASS (過大ゼロ)')
    );
  }
  // ★lump 改善の素の指標★: 現アーキ(タイマー前進なし)では OBD でも gap で lump が出るか確認。
  console.log(
    '[INFO] 停車時最大lump GPS系=' +
      gps.maxJumpAtSpd0.toFixed(0) +
      'm / OBDメイン=' +
      obd.maxJumpAtSpd0.toFixed(0) +
      'm'
  );
}
