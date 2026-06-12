// tests/replay-mm-worker/gps-layer-pipeline.js
// ★設計変更宣言 (2026-05-28・新構造テストツール): GPS層を実コードで通す full pipeline harness。
//
//   従来の問題: 全テストが Meter.update({isStationary: ...}) に「GPS層の出力」を注入し、
//               gps-worker.js の判定プロセス (= Fix① 静止判定 / Fix② accuracy gate) を
//               一切通していなかった。判定が腐っても緑になる構造。
//
//   本 harness: raw GPS → 実 gps-worker.js (processPosition) → worker result(isStationary 含む)
//               → 実 meter.js (Meter.update) → state.distance_m / business_distance_m。
//               worker が reject した点は result を emit しない → Meter.update を呼ばない
//               (= 実機 gps.js が onUpdateCallback を呼ばないのと同じ = 凍結を再現できる)。
//
//   絶対前提 (= 既存 harness と同じ):
//     ・実 js/gps-worker.js / js/meter.js を実 evaluate (= 再実装/コピー/isolated 禁止)
//     ・distance_m / calcFare / running gate: 1 byte 不変 (= 本タスクはテスト追加のみ)
//     ・Worker B (map-matcher) は creep/freeze 検証には不要 (= 静止 early-return / GPS fallback
//       haversine 経路で完結)。DER 系で必要なら withWorkerB:true で接続。
'use strict';

const { createGpsWorker } = require('../worker/gps-worker-sim');
const { loadMeter } = require('./runner');

const STANDARD_FARE = {
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

// raw GPS サンプル列を GPS層 (worker→meter) に流す。
//   rawSamples: generateGpsTrace() の出力 [{lat,lng,accuracy,speedKmh,speedSrc,headingDeg,accelSamples,timestamp}]
//   opts:
//     businessActive (default true), running (default true・代行中。false=空車),
//     workerConfig (gps-worker CONFIG override), flush (default true), debug
//   戻り:
//     { finalState, perStep[], workerEmittedCount, workerRejectedCount, stationaryTrueCount }
function runGpsLayerPipeline(rawSamples, opts) {
  opts = opts || {};
  const businessActive = opts.businessActive !== false;
  const running = opts.running !== false;

  // 1. 実 gps-worker.js 起動 (= Fix① 静止判定 / Fix② accuracy gate を含む実コード)
  const worker = createGpsWorker({ debug: !!opts.debug });
  worker.sendMessage({
    type: 'init',
    data: { config: opts.workerConfig || {}, debug: !!opts.debug },
  });

  // 2. 実 meter.js 起動
  const Meter = loadMeter({ debug: !!opts.debug });
  Meter.setFareConfig(STANDARD_FARE);
  Meter.reset();
  if (businessActive && typeof Meter.setBusinessActive === 'function') {
    Meter.setBusinessActive(true);
  }
  if (running) {
    Meter.start();
  }
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);

  const perStep = [];
  let workerEmittedCount = 0;
  let workerRejectedCount = 0;
  let stationaryTrueCount = 0;

  for (let i = 0; i < rawSamples.length; i++) {
    const raw = rawSamples[i];
    const before = Meter.getState();
    const bDist = before.distance_m;
    const bBiz = before.business_distance_m || 0;

    const nBefore = worker.getResults().length;
    // raw GPS を実 gps-worker.js に投入 (= gps.js が worker に postMessage するのと同じ data 形)
    worker.sendMessage({
      type: 'position',
      data: {
        lat: raw.lat,
        lng: raw.lng,
        accuracy: raw.accuracy,
        speedKmh: raw.speedKmh,
        heading: raw.headingDeg != null ? raw.headingDeg : null,
        altitude: 0,
        now: raw.timestamp,
        compassHeading: null,
        accelData: null,
        accelSamples: raw.accelSamples || [],
        gyroData: null,
        gyroSamples: [],
        speedSrc: raw.speedSrc || 'dop',
      },
    });
    const results = worker.getResults();
    const emitted = results.length > nBefore;
    const workerOut = emitted ? results[results.length - 1] : null;

    if (emitted) {
      workerEmittedCount++;
      if (workerOut.isStationary) stationaryTrueCount++;
      // 実 gps-worker の出力 (= filtered 位置 + 判定 isStationary) を実 meter に渡す
      Meter.update({
        lat: workerOut.lat,
        lng: workerOut.lng,
        accuracy: workerOut.accuracy != null ? workerOut.accuracy : raw.accuracy,
        speedKmh: workerOut.speedKmh != null ? workerOut.speedKmh : raw.speedKmh,
        headingDeg: raw.headingDeg,
        altitude: 0,
        timestamp: raw.timestamp,
        isStationary: workerOut.isStationary,
        accelSamples: raw.accelSamples || null,
      });
    } else {
      workerRejectedCount++; // worker が reject (= accuracy/jump/accel 異常) → meter 未呼出 (凍結シグナル)
    }

    const after = Meter.getState();
    perStep.push({
      step: i,
      emitted,
      isStationary: workerOut ? workerOut.isStationary : null,
      dDist: round3(after.distance_m - bDist),
      dBiz: round3((after.business_distance_m || 0) - bBiz),
      accuracy: raw.accuracy,
      speedKmh: raw.speedKmh,
      speedSrc: raw.speedSrc,
    });
  }

  if (opts.flush !== false && typeof Meter.businessEnd === 'function') {
    // businessEnd は confirm ダイアログを使わない内部経路 (test harness では state 確定のみ)
    try {
      Meter.businessEnd();
    } catch (_) {
      /* harness: businessEnd の UI 依存は無視 */
    }
  }

  return {
    finalState: Meter.getState(),
    perStep,
    workerEmittedCount,
    workerRejectedCount,
    stationaryTrueCount,
    totalSteps: rawSamples.length,
  };
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

module.exports = { runGpsLayerPipeline, STANDARD_FARE };
