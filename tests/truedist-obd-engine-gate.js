#!/usr/bin/env node
'use strict';
/* ============================================================================
 * ★実エンジン OBD-main 真距離KP採点ゲート (truedist-obd-engine-gate.js)
 *   — 2026-06-11 / テストツール班★
 * ----------------------------------------------------------------------------
 * これは何か / なぜ要るか:
 *   既存 truedist-kp-gate.js は ★録画済み biz.td(本番出力)を読むだけ★ で、
 *   その OBD∫v は ★オフライン台形★= 実エンジン(Meter+map-matcher worker+pipeline-distance)
 *   の OBD-main 経路を ★通っていない★。つまり「∫v(OBD) が distance_m を実際に駆動したか」
 *   「δ自己キャリブ(obdDeltaCalib)を flip したら過大ゼロを保ったまま精度が改善するか」を
 *   ★実コードで★ 検証できなかった。
 *
 *   本ゲートは 0610b の各サンプルを ★実エンジンに流し★、OBD有効サンプル(obd>=0)では
 *   gps.js L629 相当で speedKmh=OBD車速 / ★speedSrc='obd'★ を Meter.update へ届け、
 *   map-matcher L309 (obd: speedSrc==='obd') → pipeline-distance L1735 (cur.obd===true→∫v(OBD))
 *   を ★実発火★ させる。OBD無効サンプルは本番 gps.js と同条件で GPS Doppler(spd)へフォールバック。
 *   出力 ★distance_m(業務別差分)★ を真距離KP(国道196号RTKキロポスト差km)で採点する。
 *
 *   OBD-main が本当に発火したかは pipeline stats.obdSegs(=∫v(OBD)で駆動した区間数)で実証する。
 *   発火していなければ obdSegs=0 で露見する(=「実エンジンを通している」の捏造防止)。
 *
 * 使い方:
 *   node tests/truedist-obd-engine-gate.js                 # δ OFF/ON 両方を比較・gate
 *   node tests/truedist-obd-engine-gate.js --json          # 機械可読 JSON も出力
 *   node tests/truedist-obd-engine-gate.js --trace=fixtures/0610b-Android.json
 *
 * 終了コード: いずれかの run(OFF/ON)で過大(over-count)業務があれば 1(FAIL)、無ければ 0。
 *
 * ★不可侵★: distance_m の意味 / calcFare / business分離 / 過大ゼロ。本ゲートは ★読むだけ★。
 *   obdDeltaCalib の ON/OFF は ★worker context の PipelineDistance.DEFAULTS を実行時に差し替える★
 *   だけ(本番 flip と同じ設定面。source は 1byte も変更しない)。
 * ※緑≠実機。本ゲートは fixture 上の回帰/発火検出器であり、実機検証の代替ではない。
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
const EPS = parseFloat(getOpt(/^--eps=([0-9.]+)$/, '0.05')); // 過大しきい(% ・丸め誤差での誤FAIL防止)
const PASS_MAX_M = parseFloat(getOpt(/^--passmax=([0-9.]+)$/, '80')); // 最接近これ超 = そのKP未通過
const JSON_OUT = process.argv.slice(2).includes('--json');
const IS_IOS = false; // 0610b は Android 実走

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

// ---- geo (KP通過検出専用・距離値そのものは KP番号差から来る) ------------------
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
// STEP 1 — 業務分割 (truedist-kp-gate.js 流用): act=1 && it=1 を tc で束ねる
//   ★合計や勝手な分割は禁止。業務=代行開始→精算終了の単位のみ。★
//   ※ ここでの分割は ★KP採点の対象区間特定★ のためで、距離値は biz.td でなく
//      ★実エンジン distance_m の該当 index 差★ を使う(これが本ゲートの核)。
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
  // 実走 index>0 の span のみ (停車のみ等の極小 span を除外)
  return spans.filter((s) => s.i1 > s.i0);
}

// span 内で指定KPの最接近サンプル(index/距離)を取る。未通過(>PASS_MAX_M)なら null。
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

// ============================================================================
// ★実エンジン run★ — Meter + map-matcher worker + pipeline-distance を実起動し、
//   0610b を OBD-main 経路で流す。各サンプル後の state.distance_m を 1:1 で配列に記録。
//   戻り: { dmByIdx[], obdSegs, distSrcMix, finalDm }
//   obdDeltaCalib は worker の PipelineDistance.DEFAULTS を実行時に差し替えて ON/OFF する
//   (本番 flip と同じ設定面。createDistanceTracker(dec,{}) が DEFAULTS を読むため反映される)。
// ============================================================================
function runEngine(obdDeltaCalib, vehicleK, quantMps) {
  const worker = createMapMatcherWorker({ debug: false });
  let roadsLoaded = false;
  worker.on((e) => {
    const m = e.data;
    if (!m) return;
    if (m.type === 'roadsLoaded') roadsLoaded = m.ok;
  });

  // ★OBD δ自己キャリブの ON/OFF を実行時に注入★(source 不変・本番 flip と同設定面)。
  //   map-matcher は createDistanceTracker(dec, {}) で生成するため cfg は DEFAULTS を読む。
  //   tracker 生成は最初の GPS ingest 時 lazy なので、ここ(GPS 流す前)で差し替えれば確実に反映。
  try {
    const PD = worker.ctx && worker.ctx.self && worker.ctx.self.PipelineDistance;
    if (PD && PD.DEFAULTS) {
      PD.DEFAULTS.obdDeltaCalib = obdDeltaCalib === true;
      // ★OBD量子化補正 (+半量子・1km/h floor回収) 注入★: quantMps 指定時のみ上書き(未指定=DEFAULTS既定)。
      if (typeof quantMps === 'number') PD.DEFAULTS.obdQuantCorrectMps = quantMps;
    }
  } catch (_) {
    /* 反映不可は下流 obdSegs / cfg 確認で露見させる */
  }

  const roadsData = loadPrefRoadsData('ehime');
  // ★随伴車別 k 注入 (vehicleK 指定時)★: meter は業務開始ロックで window.DK_VEHICLE_PROFILE.k を読む。
  //   k=1.0 / 未指定 は profile 不在 = 恒等(byte 不変)。VK_MAX clamp は meter 側で効く(=テストが実態を反映)。
  const Meter = loadMeter({
    debug: false,
    vehicleProfile: vehicleK ? { k: vehicleK, k_samples: 1, vin: 'TESTK' } : undefined,
  });
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

  // 各サンプル後の cumulative distance_m を 1:1 で記録(KP区間 = index 差で切り出す)
  const dmByIdx = new Array(SAMPLES.length).fill(0);
  let lastDm = 0;
  for (let i = 0; i < SAMPLES.length; i++) {
    const g = SAMPLES[i];
    // ★gps.js L629 相当の速度源選択★:
    //   OBD 有効(g.obd>=0) → speedKmh=OBD車速, speedSrc='obd'(=∫v(OBD)で距離駆動)。
    //   OBD 無効          → GPS Doppler(g.spd m/s→km/h), speedSrc は spd>=0 で 'dop' / spd<0 で 'hav'。
    //   (本番 gps.js L640: _speedSrc = obd?'obd' : (speed>=0?'dop':'hav'))
    const obdValid = typeof g.obd === 'number' && g.obd >= 0;
    let speedKmh, speedSrc;
    if (obdValid) {
      speedKmh = g.obd; // OBD は km/h
      speedSrc = 'obd';
    } else {
      const dop = typeof g.spd === 'number' && g.spd >= 0 ? g.spd : -1; // m/s
      speedKmh = dop >= 0 ? dop * 3.6 : null;
      speedSrc = dop >= 0 ? 'dop' : 'hav';
    }
    Meter.update({
      lat: g.lat,
      lng: g.lng,
      accuracy: g.acc,
      speedKmh: speedKmh,
      speedSrc: speedSrc, // ★OBD経路を通す印(meter.js L683 で worker へ貫通→map-matcher L309)
      headingDeg: g.hdg,
      altitude: g.alt,
      timestamp: g.t,
      isStationary: false,
    });
    const dm = Meter.getState().distance_m || 0;
    dmByIdx[i] = dm;
    lastDm = dm;
  }

  // ★OBD-main 実発火の実証★: pipeline stats を worker から取得(obdSegs / 距離源内訳)。
  //   ★必ず businessEnd の前に取得★: businessEnd は _resetPipelineTrackers() で tracker を
  //   破棄するため、後で問い合わせると stats=null になる(=発火数が読めなくなる)。
  let stats = null,
    totalM = null;
  const onBd = (e) => {
    const m = e.data;
    if (m && m.type === 'pipelineBreakdown') {
      stats = m.stats || null;
      totalM = m.totalM;
    }
  };
  worker.on(onBd);
  worker.sendMessage({ type: 'getPipelineBreakdown' });
  worker.off(onBd);

  Meter.businessEnd();
  const finalDm = Meter.getState().distance_m || 0;
  // businessEnd 後の flush 増分も末尾 index に反映(KP区間は途中なので影響しないが整合のため)
  if (finalDm > lastDm && dmByIdx.length) dmByIdx[dmByIdx.length - 1] = finalDm;

  const obdSegs = stats ? stats.obdSegs || 0 : 0;
  const distSrcMix = stats
    ? {
        points: stats.points || 0,
        obdSegs: obdSegs,
        sameRoadSegs: stats.sameRoadSegs || 0,
        routedSegs: stats.routedSegs || 0,
        dopplerSegs: stats.dopplerSegs || 0,
        coastSegs: stats.coastSegs || 0,
        straightSegs: stats.straightSegs || 0,
      }
    : null;

  return { dmByIdx, finalDm, obdSegs, distSrcMix, pipelineTotalM: totalM };
}

// ---- 採点 (業務別: 実エンジン distance_m 差 vs 真距離KP差) ---------------------
//   ★公式区間(GROUND_TRUTH)を ★正(canonical)★ とし、1業務=1行で採点する。★
//   業務=「同 tc(完了トリップ番号)の代行走行 span 群の和」(代行開始→精算終了の単位)。
//   tc が途中再開で複数 span に割れても、その tc 全 span の index 範囲(union)を採点域にする
//   (= splitBusinesses の per-span 採点で同 tc が二重採点される人工物を排除)。
function tcRange(tc) {
  const spans = splitBusinesses(SAMPLES).filter((s) => s.tc === tc);
  if (!spans.length) return null;
  return { i0: Math.min(...spans.map((s) => s.i0)), i1: Math.max(...spans.map((s) => s.i1)) };
}

function scoreRun(eng) {
  const gt = GROUND_TRUTH[TRACE_BASE] || [];
  const rows = [];
  let anyOver = false;
  gt.forEach((gtSeg, bi) => {
    const rng = tcRange(gtSeg.tc);
    if (!rng) {
      rows.push({
        label: '業務' + (bi + 1) + '(tc=' + gtSeg.tc + ')',
        scored: false,
        reason: 'tc-span-not-found',
        tc: gtSeg.tc,
      });
      return;
    }
    const startHit = hitFor(rng.i0, rng.i1, gtSeg.startKP);
    const endHit = hitFor(rng.i0, rng.i1, gtSeg.endKP);
    if (!startHit || !endHit) {
      rows.push({
        label: '業務' + (bi + 1) + '(tc=' + gtSeg.tc + ')',
        scored: false,
        reason: 'gt-KP-not-passed',
        tc: gtSeg.tc,
      });
      return;
    }
    const trueKm = Math.abs(gtSeg.endKP - gtSeg.startKP);
    // ★実エンジン距離 = KP通過点 index 間の distance_m 差★(録画biz.tdではない)
    const a = Math.min(startHit.idx, endHit.idx);
    const b = Math.max(startHit.idx, endHit.idx);
    const engM = eng.dmByIdx[b] - eng.dmByIdx[a];
    const engKm = engM / 1000;
    const errPct = (engKm / trueKm - 1) * 100;
    const over = errPct > EPS;
    if (over) anyOver = true;
    rows.push({
      label: '業務' + (bi + 1) + '(tc=' + gtSeg.tc + ')',
      scored: true,
      tc: gtSeg.tc,
      startKP: gtSeg.startKP,
      endKP: gtSeg.endKP,
      trueKm,
      startIdx: startHit.idx,
      endIdx: endHit.idx,
      startDist: round(startHit.dist),
      endDist: round(endHit.dist),
      engKm: round(engKm),
      errPct: round(errPct),
      over,
    });
  });
  return { rows, anyOver };
}

function round(v) {
  return v == null ? null : Math.round(v * 10000) / 10000;
}
function fmtPct(e) {
  return e == null ? '—' : (e >= 0 ? '+' : '') + e.toFixed(2) + '%';
}
function band(e) {
  if (e == null) return '—';
  return e > EPS ? '✗過大(FAIL)' : e >= -4 ? '✓合格' : '✗過小';
}

// ============================================================================
// RUN — δ OFF / ON 両方で実エンジンを回し比較
// ============================================================================
const report = {
  trace: TRACE_BASE,
  eps: EPS,
  passMaxM: PASS_MAX_M,
  groundTruth: GROUND_TRUTH[TRACE_BASE] || null,
  runs: {},
};

console.log('===========================================================');
console.log('★実エンジン OBD-main 真距離KP採点ゲート★');
console.log(
  'trace=' +
    TRACE_BASE +
    ' (' +
    SAMPLES.length +
    '点) / eps=' +
    EPS +
    '% / passMax=' +
    PASS_MAX_M +
    'm'
);
console.log('真距離 = KP差(国道196号RTK実測) / 認定バンド=-4%〜0%(過大不可)');
console.log('★採点対象 = 録画biz.td ではなく ★実エンジン出力 distance_m の業務別差分★');
console.log('===========================================================\n');

let gateFail = false;
for (const mode of [false, true]) {
  const tag = mode ? 'δ-ON (obdDeltaCalib=true)' : 'δ-OFF (obdDeltaCalib=false・現出荷既定)';
  let eng;
  try {
    eng = runEngine(mode);
  } catch (e) {
    console.log('【' + tag + '】 ENGINE ERROR: ' + e.message);
    report.runs[mode ? 'on' : 'off'] = { error: e.message };
    gateFail = true;
    continue;
  }
  const sc = scoreRun(eng);

  console.log('───────────────────────────────────────────────────────────');
  console.log('【' + tag + '】');
  console.log(
    '  ★OBD-main 実発火★: obdSegs=' +
      eng.obdSegs +
      ' (=∫v(OBD)で距離を駆動した区間数) / pipeline totalM=' +
      (eng.pipelineTotalM != null ? eng.pipelineTotalM.toFixed(1) + 'm' : '—')
  );
  if (eng.distSrcMix) {
    const m = eng.distSrcMix;
    console.log(
      '  距離源内訳: points=' +
        m.points +
        ' obd=' +
        m.obdSegs +
        ' sameRoad=' +
        m.sameRoadSegs +
        ' routed=' +
        m.routedSegs +
        ' doppler=' +
        m.dopplerSegs +
        ' coast=' +
        m.coastSegs +
        ' straight=' +
        m.straightSegs
    );
  }
  console.log('  エンジン最終 distance_m = ' + (eng.finalDm / 1000).toFixed(3) + 'km');
  if (eng.obdSegs === 0) {
    console.log('  ★警告: obdSegs=0 = OBD-main が発火していない(∫v(OBD)が距離を駆動していない)★');
  }
  console.log('');
  console.log('  業務            | 採点区間       | 真距離  | エンジン距離 | vs真距離 | 判定');
  for (const r of sc.rows) {
    if (!r.scored) {
      console.log('  ' + r.label.padEnd(14) + ' | 採点スキップ (' + r.reason + ')');
      continue;
    }
    console.log(
      '  ' +
        r.label.padEnd(14) +
        ' | KP' +
        r.startKP +
        '→KP' +
        r.endKP +
        ' (' +
        r.startDist.toFixed(0) +
        '/' +
        r.endDist.toFixed(0) +
        'm) | ' +
        (r.trueKm.toFixed(1) + 'km').padStart(6) +
        ' | ' +
        (r.engKm.toFixed(3) + 'km').padStart(10) +
        ' | ' +
        fmtPct(r.errPct).padStart(8) +
        ' | ' +
        band(r.errPct)
    );
  }
  console.log('');

  report.runs[mode ? 'on' : 'off'] = {
    obdSegs: eng.obdSegs,
    distSrcMix: eng.distSrcMix,
    finalKm: round(eng.finalDm / 1000),
    pipelineTotalM: eng.pipelineTotalM != null ? round(eng.pipelineTotalM) : null,
    businesses: sc.rows,
    over: sc.anyOver,
  };
  if (sc.anyOver) gateFail = true;
}

// ---- δ ON vs OFF 比較 (過大ゼロを保ったまま精度改善したか) --------------------
const off = report.runs.off,
  on = report.runs.on;
if (off && on && !off.error && !on.error) {
  console.log('───────────────────────────────────────────────────────────');
  console.log('★δ OFF → ON 比較 (過大ゼロを保ったまま精度改善したか)★');
  const offByTc = {},
    onByTc = {};
  for (const r of off.businesses) if (r.scored) offByTc[r.tc] = r;
  for (const r of on.businesses) if (r.scored) onByTc[r.tc] = r;
  for (const tc of Object.keys(offByTc)) {
    const o = offByTc[tc],
      n = onByTc[tc];
    if (!n) continue;
    const improved = Math.abs(n.errPct) < Math.abs(o.errPct);
    const stillSafe = !n.over;
    console.log(
      '  ' +
        o.label +
        ': OFF ' +
        fmtPct(o.errPct) +
        ' → ON ' +
        fmtPct(n.errPct) +
        '  (誤差' +
        (improved ? '改善' : '悪化/同') +
        ' / 過大ゼロ' +
        (stillSafe ? '維持✓' : '違反✗') +
        ')'
    );
  }
  console.log(
    '  ※obdSegs OFF=' + off.obdSegs + ' / ON=' + on.obdSegs + ' (両 run で OBD-main 発火を確認)'
  );
  console.log('');
}

report.pass = !gateFail;
console.log('===========================================================');
if (gateFail) {
  console.log(
    '★GATE FAIL★ — いずれかの run で過大(>+' +
      EPS +
      '%)業務あり = 片側公差(過大不可)違反、またはエンジンエラー。'
  );
} else {
  console.log('★GATE PASS★ — δ OFF/ON 両 run で全業務 distance_m ≤ 真距離(過大ゼロ維持)。');
}
console.log('※緑≠実機。本ゲートは fixture 上の OBD-main 発火/回帰検出器。実機検証の代替ではない。');
console.log(
  '※obdDeltaCalib flip 判断は ①obdSegs>0(実発火) ②過大ゼロ維持 ③誤差改善 の3点を本出力で確認すること。'
);
console.log('===========================================================');

// ============================================================================
// ★--k-neverover★ : OBD+センサーメイン・アーキ検証 (テスト先行・2026-06-12)
//   司さん確定アーキ(memory: obd_sensor_main_architecture): OBD接続中は OBD∫v×手動k で距離・
//   GPSベースδは二重補正になるので OFF。これを ★196号KP RTK真値★ で過大ゼロ検証する:
//     (1) δ-OFF + k=1.02 → 全業務 ★-1%以内 かつ 過大ゼロ(≤真値)★ (本命・実装前REDの想定)
//     (2) δ-ON  + k=1.02 → ★二重補正で過大★ になることを可視化(=δ-OFF を採る根拠)
//   ★実装前(VK_MAX=1.01でkが1.01にclampされる)は (1)が -1.13%級で「-1%以内」を満たさず RED。
//     VK_MAX→1.02(source-aware・OBD駆動のみ)実装後に GREEN。★ フラグ無し時はCI現行と完全に不変。
// ============================================================================
const K_NEVEROVER = process.argv.slice(2).includes('--k-neverover');
if (K_NEVEROVER) {
  console.log('\n===========================================================');
  console.log('★--k-neverover : OBD∫v×手動k 過大ゼロ&-1%以内 検証 (RTK真値)★');
  console.log('===========================================================');
  let kFail = false;
  const K = 1.02;
  // ★手動k と quant(+0.5km/h) は ★択一の補正戦略★ (k=車別手動 / quant=全車普遍・k不要)で、
  //   両方を重ねると二重補正で過大化する(=quant既定ON下で k=1.02 を足すと +0.34% 過大)。
  //   本ゲートは「手動k 単独」を分離検証するので quant=0 で実行する。実運用も既定 k=1.0(無較正)で非スタック。
  const Q_OFF = 0;
  // (1) 本命: δ-OFF + k (quant無しで手動k単独を検証)
  let eOff;
  try {
    eOff = runEngine(false, K, Q_OFF);
  } catch (e) {
    console.log('δ-OFF+k ENGINE ERROR: ' + e.message);
    process.exit(1);
  }
  const scOff = scoreRun(eOff);
  console.log(
    '【δ-OFF + k=' + K + ' (本命: OBD∫v×手動k・GPSベースδ無し)】 obdSegs=' + eOff.obdSegs
  );
  for (const r of scOff.rows) {
    if (!r.scored) {
      console.log('  ' + r.label.padEnd(14) + ' 採点スキップ(' + r.reason + ')');
      continue;
    }
    const withinTarget = r.errPct >= -1.0 && r.errPct <= EPS; // -1%以内 かつ 過大ゼロ
    if (!withinTarget) kFail = true;
    console.log(
      '  ' +
        r.label.padEnd(14) +
        ' 真距離' +
        r.trueKm.toFixed(1) +
        'km vs ' +
        r.engKm.toFixed(3) +
        'km = ' +
        fmtPct(r.errPct).padStart(8) +
        '  → ' +
        (r.errPct > EPS
          ? '★過大(FAIL)★'
          : r.errPct < -1.0
            ? '★-1%未達(FAIL)★'
            : '✓ -1%以内&過大ゼロ')
    );
  }
  // (2) 負例: δ-ON + k = 二重補正の過大を可視化
  let eOn;
  try {
    eOn = runEngine(true, K, Q_OFF);
  } catch (e) {
    eOn = null;
  }
  if (eOn) {
    const scOn = scoreRun(eOn);
    const anyOverOn = scOn.rows.some((r) => r.scored && r.errPct > EPS);
    console.log('【δ-ON + k=' + K + ' (負例: δとkの二重補正)】');
    for (const r of scOn.rows) {
      if (!r.scored) continue;
      console.log(
        '  ' +
          r.label.padEnd(14) +
          ' = ' +
          fmtPct(r.errPct).padStart(8) +
          (r.errPct > EPS ? ' ★過大=二重補正の証拠(δ-OFFを採る根拠)★' : '')
      );
    }
    console.log(
      '  → δ-ON+k 過大あり: ' +
        (anyOverOn ? 'YES(=δとkを重ねるな・OBD車はδ-OFF)' : 'NO(clampで未到達)')
    );
  }
  console.log('───────────────────────────────────────────────────────────');
  console.log(
    kFail
      ? '★K-GATE FAIL★ — δ-OFF+k で -1%以内&過大ゼロ 未達 (実装前の想定RED or 実装後の回帰)。exit 1。'
      : '★K-GATE PASS★ — δ-OFF+k で全業務 -1%以内 かつ 過大ゼロ(≤RTK真値)。'
  );
  console.log('===========================================================');
  if (JSON_OUT) console.log('\n' + JSON.stringify(report, null, 2));
  process.exit(kFail ? 1 : gateFail ? 1 : 0);
}

// ============================================================================
// ★--quant★ : OBD∫v 量子化補正(+0.5km/h floor回収・全車自動・manual k不要) 検証 (テスト先行・2026-06-13)
//   OBD車速は1km/h刻みで切り捨て(floor)→ ∫v が systematically 過少(-2.5%級)。真の速度は[v,v+1)で
//   平均 v+0.5 → ∫v に +0.5km/h 足せば ★車によらず普遍的に★ floor過少を回収(δ/manual k 不要)。
//   実証(196号KP RTK・業務2): ∫v生-2.50% → +0.5km/h -1.32% (改善・過大ゼロ側)。残差(タイヤ器差)は別。
//   ★実装前(engine が obdQuantCorrectMps 未読)は quant ON=OFF で改善せず RED。実装後 GREEN。★
//   フラグ無し時はCI現行と完全不変。
// ============================================================================
const QUANT = process.argv.slice(2).includes('--quant');
if (QUANT) {
  console.log('\n===========================================================');
  console.log('★--quant : OBD∫v 量子化補正(+0.5km/h floor回収) 改善&過大ゼロ 検証 (RTK真値)★');
  console.log('===========================================================');
  let qFail = false;
  const QMPS = 0.5 / 3.6; // +0.5km/h = 半量子(truncation補正)
  let eOff, eOn;
  try {
    eOff = runEngine(false, undefined, 0); // 補正なし
    eOn = runEngine(false, undefined, QMPS); // +0.5km/h
  } catch (e) {
    console.log('quant ENGINE ERROR: ' + e.message);
    process.exit(1);
  }
  const scOff = scoreRun(eOff),
    scOn = scoreRun(eOn);
  const offByTc = {},
    onByTc = {};
  for (const r of scOff.rows) if (r.scored) offByTc[r.tc] = r;
  for (const r of scOn.rows) if (r.scored) onByTc[r.tc] = r;
  const tcs = Object.keys(offByTc);
  if (!tcs.length) {
    console.log('  ★採点KP通過業務なし=検証不能(fixture/KP窓要確認)★');
    qFail = true;
  }
  for (const tc of tcs) {
    const o = offByTc[tc],
      n = onByTc[tc];
    if (!n) continue;
    const improved = n.errPct > o.errPct + 0.1; // +0.5km/h で真値へ寄った(0.1pt超)
    const overZero = n.errPct <= EPS; // 過大ゼロ維持
    if (!improved || !overZero) qFail = true;
    console.log(
      '  業務(tc' +
        tc +
        ') 真距離' +
        o.trueKm.toFixed(1) +
        'km: 補正なし ' +
        fmtPct(o.errPct) +
        ' → +0.5km/h ' +
        fmtPct(n.errPct) +
        '  (' +
        (improved ? '改善✓' : '改善せず✗') +
        ' / 過大ゼロ' +
        (overZero ? '維持✓' : '違反✗') +
        ')'
    );
  }
  console.log('───────────────────────────────────────────────────────────');
  console.log(
    qFail
      ? '★QUANT-GATE FAIL★ — +0.5km/h で改善せず or 過大化 (実装前の想定RED or 回帰)。exit 1。'
      : '★QUANT-GATE PASS★ — +0.5km/h量子化補正で全車自動改善・過大ゼロ維持(≤RTK真値)。'
  );
  console.log('===========================================================');
  process.exit(qFail ? 1 : gateFail ? 1 : 0);
}

if (JSON_OUT) console.log('\n' + JSON.stringify(report, null, 2));

process.exit(gateFail ? 1 : 0);
