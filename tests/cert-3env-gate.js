#!/usr/bin/env node
'use strict';
/* ============================================================================
 * ★cert-3env ゲート (cert-3env-gate.js) — 2026-06-12 / テストツール班★
 * ----------------------------------------------------------------------------
 * これは何か / なぜ要るか:
 *   国交省 ソフトメーター認定「別表2」の ★二段公差★ を採点 gate 化する。
 *   既存の truedist-kp-gate.js / truedist-obd-engine-gate.js は一律 -4%〜0% の
 *   ★パーセント片公差★ しか見ていない。だが別表2は区間長で公差が切り替わる:
 *
 *     ・短区間 (真距離 <= 1km)  → ★絶対値公差★  engM - trueM ∈ [-40m, 0m]
 *     ・長区間 (真距離 >  1km)  → ★パーセント公差★ errPct ∈ [-4.0%, 0%]
 *
 *   どちらの段でも ★過大側は EPS=0★(過大 1m / +0.0001% でも即 FAIL)。
 *   日本基準(過大ゼロ=司さん哲学)に厳密一致させ、短区間で %公差だと甘くなる穴を塞ぐ
 *   (例: 真距離 300m の区間は -4% で -12m まで許してしまうが、別表2 短区間は -40m 絶対値。
 *    逆に過大側は短区間でも 0m 厳守=パーセントの丸め緩和に逃がさない)。
 *
 *   採点対象は ★録画 biz.td ではなく実エンジン出力 distance_m の業務別差分★
 *   (truedist-obd-engine-gate.js と同じ実 Meter+map-matcher worker+pipeline-distance 経路)。
 *   KP 通過検出は truedist-kp-gate.js の業務内・時系列単調ロジックを流用する。
 *
 * 使い方:
 *   node tests/cert-3env-gate.js                 # 実エンジン distance_m を二段公差で採点
 *   node tests/cert-3env-gate.js --json          # 機械可読 JSON も出力
 *   node tests/cert-3env-gate.js --trace=fixtures/0610b-Android.json
 *   node tests/cert-3env-gate.js --negraw        # ★負例★ 生GPS弦+わずか過大を採点→exit1実証
 *                                                #  (trivial-green でない=REDを出せる証明・空緑禁止)
 *
 * 終了コード: いずれかの採点済み業務が二段公差を外れたら 1(FAIL)、全て収まれば 0(PASS)。
 *
 * ★不可侵★: distance_m の意味 / calcFare / business 分離 / 過大ゼロ。本ゲートは ★読むだけ★。
 *   pipeline-distance.js 等 prod js は require して観測するのみ(1byte も変更しない)。
 * ※緑≠実機。本ゲートは fixture 上の認定二段公差 回帰検出器であり、実機検証の代替ではない。
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const { createMapMatcherWorker, loadPrefRoadsData } = require('./replay-mm-worker/worker-sim');
const { loadMeter } = require('./replay-mm-worker/runner');

// ---- args -------------------------------------------------------------------
function getOpt(re, dflt) {
  for (const a of process.argv.slice(2)) {
    const m = re.exec(a);
    if (m) return m[1];
  }
  return dflt;
}
const TRACE_ARG = getOpt(/^--trace=(.+)$/, 'fixtures/0610b-Android.json');
const PASS_MAX_M = parseFloat(getOpt(/^--passmax=([0-9.]+)$/, '80')); // 最接近これ超 = そのKP未通過
const JSON_OUT = process.argv.slice(2).includes('--json');
// ★負例 (RED 実証) モード★: 採点距離を実エンジン distance_m でなく
//   「生GPS弦長 × (1+負例過大率)」にすげ替える。生GPS弦は中心線より系統的に長く、
//   さらに微小過大を足すことで ★過大側 EPS=0★ に必ず引っかけ exit1 を実証する。
const NEG_RAW = process.argv.slice(2).includes('--negraw');
const NEG_OVER_PCT = parseFloat(getOpt(/^--negover=([0-9.]+)$/, '0.5')); // 負例で足す過大率(%)

const IS_IOS = false; // 0610b は Android 実走

// ============================================================================
// ★認定 別表2 二段公差★
//   短区間 (真距離 <= TIER_SPLIT_M) → 絶対値: engM - trueM ∈ [ABS_LO_M, ABS_HI_M]
//   長区間 (真距離 >  TIER_SPLIT_M) → %    : errPct ∈ [PCT_LO, PCT_HI]
//   過大側 (HI 端) は EPS=0 厳守(過大 1m / +0.0001% で即 FAIL)。
// ============================================================================
const TIER_SPLIT_M = 1000; // 1km
const ABS_LO_M = -40; // 短区間 下限 (過小 -40m まで)
const ABS_HI_M = 0; // 短区間 上限 (過大ゼロ)
const PCT_LO = -4.0; // 長区間 下限 (-4.0%)
const PCT_HI = 0.0; // 長区間 上限 (過大ゼロ)
const OVER_EPS_M = 0; // 過大側しきい(絶対m)=0 厳守
const OVER_EPS_PCT = 0; // 過大側しきい(%)=0 厳守

// ============================================================================
// ★真距離 ground truth (truedist-kp-gate.js と同一・司さん提示の公式採点区間)★
//   業務1: 東予→大西  KP48→39 = 9km
//   業務2: 大西→今治  KP38→42 = 4km
// ============================================================================
const GROUND_TRUTH = {
  '0610b-Android.json': [
    { tc: 0, startKP: 48, endKP: 39 },
    { tc: 1, startKP: 38, endKP: 42 },
  ],
};

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

// ---- geo (KP通過検出専用) ----------------------------------------------------
function hav(aLat, aLng, bLat, bLng) {
  const R = 6371000,
    r = Math.PI / 180;
  const dLat = (bLat - aLat) * r,
    dLng = (bLng - aLng) * r;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ---- KP anchors -------------------------------------------------------------
const KP_FILE = path.join(__dirname, 'fixtures', 'imabari-196-kp-rtk.json');
const kpData = JSON.parse(fs.readFileSync(KP_FILE, 'utf8'));
const KP = {};
for (const p of kpData.kp) KP[p.kp] = p;

// ---- trace ------------------------------------------------------------------
const tracePath = path.isAbsolute(TRACE_ARG) ? TRACE_ARG : path.join(__dirname, TRACE_ARG);
let SAMPLES = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
SAMPLES = (Array.isArray(SAMPLES) ? SAMPLES : Object.values(SAMPLES))
  .filter((x) => x && Number.isFinite(x.lat) && Number.isFinite(x.lng))
  .sort((a, b) => (a.t || 0) - (b.t || 0));
const TRACE_BASE = path.basename(tracePath);

// ============================================================================
// 業務分割 (truedist-kp-gate.js 流用): act=1 && it=1 を tc で束ねる
// ============================================================================
function splitBusinesses(arr) {
  const spans = [];
  let cur = null;
  for (let i = 0; i < arr.length; i++) {
    const b = arr[i].biz || {};
    const driving = b.act === 1 && b.it === 1;
    if (driving) {
      if (!cur || cur.tc !== b.tc) {
        if (cur) spans.push(cur);
        cur = { tc: b.tc, i0: i, i1: i };
      } else {
        cur.i1 = i;
      }
    } else if (cur) {
      spans.push(cur);
      cur = null;
    }
  }
  if (cur) spans.push(cur);
  return spans.filter((s) => s.i1 > s.i0);
}

// span 内で指定KPの最接近サンプル(index/距離)。未通過(>PASS_MAX_M)なら null。
function hitFor(i0, i1, kpNum) {
  const P = KP[kpNum];
  if (!P) return null;
  let best = Infinity,
    bi = -1;
  for (let i = i0; i <= i1; i++) {
    const d = hav(SAMPLES[i].lat, SAMPLES[i].lng, P.lat, P.lng);
    if (d < best) {
      best = d;
      bi = i;
    }
  }
  if (bi < 0 || best > PASS_MAX_M) return null;
  return { kp: kpNum, idx: bi, dist: best };
}

// tc の全 span を union した index 範囲を採点域にする(同 tc 二重採点排除)。
function tcRange(tc) {
  const spans = splitBusinesses(SAMPLES).filter((s) => s.tc === tc);
  if (!spans.length) return null;
  return { i0: Math.min(...spans.map((s) => s.i0)), i1: Math.max(...spans.map((s) => s.i1)) };
}

// ============================================================================
// ★実エンジン run★ — Meter + map-matcher worker + pipeline-distance を実起動し、
//   0610b を流して各サンプル後の cumulative distance_m を 1:1 で配列に記録する
//   (truedist-obd-engine-gate.js と同一手法・prod js は読むだけ)。
//   戻り: { dmByIdx[], finalDm }
// ============================================================================
function runEngine() {
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
  adapter.postMessage({ type: 'configPlatform', isIOS: IS_IOS });
  adapter.postMessage({ type: 'loadRoads', pref: roadsData.prefecture, roadsData });
  if (!roadsLoaded) throw new Error('loadRoads FAIL');

  if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);

  const dmByIdx = new Array(SAMPLES.length).fill(0);
  let lastDm = 0;
  for (let i = 0; i < SAMPLES.length; i++) {
    const g = SAMPLES[i];
    // gps.js L629 相当: OBD有効→speedSrc='obd'(∫v(OBD)駆動) / 無効→Doppler / 速度欠→hav。
    const obdValid = typeof g.obd === 'number' && g.obd >= 0;
    let speedKmh, speedSrc;
    if (obdValid) {
      speedKmh = g.obd;
      speedSrc = 'obd';
    } else {
      const dop = typeof g.spd === 'number' && g.spd >= 0 ? g.spd : -1;
      speedKmh = dop >= 0 ? dop * 3.6 : null;
      speedSrc = dop >= 0 ? 'dop' : 'hav';
    }
    Meter.update({
      lat: g.lat,
      lng: g.lng,
      accuracy: g.acc,
      speedKmh: speedKmh,
      speedSrc: speedSrc,
      headingDeg: g.hdg,
      altitude: g.alt,
      timestamp: g.t,
      isStationary: false,
    });
    const dm = Meter.getState().distance_m || 0;
    dmByIdx[i] = dm;
    lastDm = dm;
  }

  Meter.businessEnd();
  const finalDm = Meter.getState().distance_m || 0;
  if (finalDm > lastDm && dmByIdx.length) dmByIdx[dmByIdx.length - 1] = finalDm;

  return { dmByIdx, finalDm };
}

// 生GPS弦長(連続 haversine)を index 範囲で算出(負例の採点距離用)。
function rawChordM(lo, hi) {
  let m = 0;
  for (let i = lo + 1; i <= hi; i++) {
    m += hav(SAMPLES[i - 1].lat, SAMPLES[i - 1].lng, SAMPLES[i].lat, SAMPLES[i].lng);
  }
  return m;
}

// ============================================================================
// ★二段公差 採点★ — 1業務=1行。engM(採点距離) vs trueM(KP差) を別表2で判定。
//   tier='abs' (短区間 <=1km) → engM-trueM ∈ [ABS_LO_M, ABS_HI_M], 過大>OVER_EPS_M で FAIL
//   tier='pct' (長区間 >1km)  → errPct    ∈ [PCT_LO, PCT_HI],     過大>OVER_EPS_PCT で FAIL
// ============================================================================
function judge(engM, trueM) {
  const tier = trueM <= TIER_SPLIT_M ? 'abs' : 'pct';
  const dM = engM - trueM; // 残差m(正=過大)
  const errPct = (engM / trueM - 1) * 100; // 残差%(正=過大)
  let over, underFail, pass, lo, hi, unit, val;
  if (tier === 'abs') {
    over = dM > OVER_EPS_M; // 過大側 0m 厳守
    underFail = dM < ABS_LO_M; // 過小 -40m 超過
    pass = !over && !underFail;
    lo = ABS_LO_M;
    hi = ABS_HI_M;
    unit = 'm';
    val = dM;
  } else {
    over = errPct > OVER_EPS_PCT; // 過大側 0% 厳守
    underFail = errPct < PCT_LO; // 過小 -4% 超過
    pass = !over && !underFail;
    lo = PCT_LO;
    hi = PCT_HI;
    unit = '%';
    val = errPct;
  }
  return { tier, dM, errPct, over, underFail, pass, lo, hi, unit, val };
}

function round(v) {
  return v == null ? null : Math.round(v * 10000) / 10000;
}

function scoreRun(eng) {
  const gt = GROUND_TRUTH[TRACE_BASE] || [];
  const rows = [];
  let anyFail = false;
  let anyOver = false;
  gt.forEach((gtSeg, bi) => {
    const label = '業務' + (bi + 1) + '(tc=' + gtSeg.tc + ')';
    const rng = tcRange(gtSeg.tc);
    if (!rng) {
      rows.push({ label, scored: false, reason: 'tc-span-not-found', tc: gtSeg.tc });
      return;
    }
    const startHit = hitFor(rng.i0, rng.i1, gtSeg.startKP);
    const endHit = hitFor(rng.i0, rng.i1, gtSeg.endKP);
    if (!startHit || !endHit) {
      rows.push({ label, scored: false, reason: 'gt-KP-not-passed', tc: gtSeg.tc });
      return;
    }
    const trueM = Math.abs(gtSeg.endKP - gtSeg.startKP) * 1000;
    const a = Math.min(startHit.idx, endHit.idx);
    const b = Math.max(startHit.idx, endHit.idx);

    // ★採点距離★:
    //   通常 = 実エンジン distance_m の KP通過点 index 間差(=本番出力)。
    //   負例(--negraw) = 生GPS弦長 ×(1+NEG_OVER_PCT/100) … 過大側 EPS=0 を必ず突く RED 実証用。
    let engM;
    if (NEG_RAW) {
      engM = rawChordM(a, b) * (1 + NEG_OVER_PCT / 100);
    } else {
      engM = eng.dmByIdx[b] - eng.dmByIdx[a];
    }

    const j = judge(engM, trueM);
    if (!j.pass) anyFail = true;
    if (j.over) anyOver = true;
    rows.push({
      label,
      scored: true,
      tc: gtSeg.tc,
      startKP: gtSeg.startKP,
      endKP: gtSeg.endKP,
      trueM,
      tier: j.tier,
      engM: round(engM),
      residM: round(j.dM),
      errPct: round(j.errPct),
      bandLo: j.lo,
      bandHi: j.hi,
      bandUnit: j.unit,
      bandVal: round(j.val),
      over: j.over,
      underFail: j.underFail,
      pass: j.pass,
      startIdx: a,
      endIdx: b,
      startDist: round(startHit.dist),
      endDist: round(endHit.dist),
    });
  });
  return { rows, anyFail, anyOver };
}

// ============================================================================
// RUN
// ============================================================================
const report = {
  trace: TRACE_BASE,
  mode: NEG_RAW ? 'negraw' : 'engine',
  negOverPct: NEG_RAW ? NEG_OVER_PCT : null,
  passMaxM: PASS_MAX_M,
  tierSplitM: TIER_SPLIT_M,
  absBandM: [ABS_LO_M, ABS_HI_M],
  pctBand: [PCT_LO, PCT_HI],
  groundTruth: GROUND_TRUTH[TRACE_BASE] || null,
  businesses: [],
};

console.log('===========================================================');
console.log('★cert-3env ゲート (国交省別表2 二段公差)★');
console.log('trace=' + TRACE_BASE + ' (' + SAMPLES.length + '点) / passMax=' + PASS_MAX_M + 'm');
console.log(
  '二段公差: <=1km区間→[' +
    ABS_LO_M +
    'm,' +
    ABS_HI_M +
    'm](絶対) / >1km区間→[' +
    PCT_LO +
    '%,' +
    PCT_HI +
    '%] / 過大側EPS=0'
);
console.log(
  '採点距離 = ' +
    (NEG_RAW
      ? '★負例★ 生GPS弦×(1+' + NEG_OVER_PCT + '%) (RED実証用・空緑禁止)'
      : '実エンジン出力 distance_m の業務別差分')
);
console.log('===========================================================\n');

let gateFail = false;

let eng = { dmByIdx: new Array(SAMPLES.length).fill(0), finalDm: 0 };
if (!NEG_RAW) {
  try {
    eng = runEngine();
  } catch (e) {
    console.log('ENGINE ERROR: ' + e.message);
    report.error = e.message;
    console.log('\n★GATE FAIL★ — エンジン起動失敗。');
    if (JSON_OUT) console.log('\n' + JSON.stringify(report, null, 2));
    process.exit(1);
  }
  console.log('エンジン最終 distance_m = ' + (eng.finalDm / 1000).toFixed(3) + 'km\n');
}

const sc = scoreRun(eng);

console.log('  業務            | 段  | 真距離 | 採点距離 | 残差        | 公差帯            | 判定');
for (const r of sc.rows) {
  if (!r.scored) {
    console.log('  ' + r.label.padEnd(14) + ' | 採点スキップ (' + r.reason + ')');
    continue;
  }
  const tierLbl = r.tier === 'abs' ? '<=1k' : '>1k ';
  const residStr =
    r.tier === 'abs'
      ? (r.residM >= 0 ? '+' : '') + r.residM.toFixed(1) + 'm'
      : (r.errPct >= 0 ? '+' : '') + r.errPct.toFixed(2) + '%';
  const bandStr = '[' + r.bandLo + r.bandUnit + ',' + r.bandHi + r.bandUnit + ']';
  const verdict = r.over ? '✗過大(FAIL)' : r.underFail ? '✗過小(FAIL)' : '✓合格';
  console.log(
    '  ' +
      r.label.padEnd(14) +
      ' | ' +
      tierLbl +
      '| ' +
      (r.trueM / 1000).toFixed(1) +
      'km | ' +
      (r.engM / 1000).toFixed(3) +
      'km | ' +
      residStr.padStart(10) +
      ' | ' +
      bandStr.padEnd(16) +
      ' | ' +
      verdict
  );
  if (!r.pass) gateFail = true;
}
console.log('');

report.businesses = sc.rows;
report.anyOver = sc.anyOver;
report.pass = !gateFail;

console.log('===========================================================');
if (gateFail) {
  console.log(
    '★GATE FAIL★ — 二段公差を外れた業務あり' +
      (sc.anyOver ? ' (過大側 EPS=0 違反含む=片公差 過大不可違反)' : ' (過小側 公差超過)') +
      '。'
  );
} else {
  console.log('★GATE PASS★ — 全業務が別表2 二段公差内(短区間 [-40m,0m] / 長区間 [-4%,0%])。');
}
console.log('※緑≠実機。本ゲートは fixture 上の認定二段公差 回帰検出器。実機検証の代替ではない。');
console.log('===========================================================');

if (JSON_OUT) console.log('\n' + JSON.stringify(report, null, 2));

process.exit(gateFail ? 1 : 0);
