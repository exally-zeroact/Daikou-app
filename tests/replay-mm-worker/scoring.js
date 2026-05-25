// tests/replay-mm-worker/scoring.js (Phase 1 基盤・2026-05-21・rev2 warmup-aware)
// ★設計変更宣言 Phase 1 (2026-05-21・rev2):
//   旧 rev1: 全 GPS step を等しく扱う precision/recall・末尾未 flush で FN 過大
//   新 rev2: first_commit_step を warmup として分離・post-warmup 区間で本物の評価
//
//   ・recall_overall      : 全 step 中 TP 数 (= 旧仕様・参考値)
//   ・recall_post_warmup  : post-warmup step 中 TP 数 (= 本物 recall)
//   ・snap_rate_post_warmup: post-warmup step 中 committed snap 数 (= 真の snap 性能)
//   ・der_post_warmup     : committedDistanceM と post-warmup 区間 expected の比較
//   ・warmup_steps        : first commit までの step 数 (= Viterbi N 等の窓 warmup)
//
//   committedDistanceM は実 Meter.getState().distance_m で全集約済 (= retroactive L514 /
//   gap fill L961 / Off-Road incremental L979 / setDistance L1365 すべて含む)。
'use strict';

function score(opts) {
  const gt = opts.groundTruth || [];
  const cm = opts.committedSnaps || [];
  if (gt.length !== cm.length) {
    throw new Error(
      '[scoring] groundTruth.length=' + gt.length + ' != committedSnaps.length=' + cm.length
    );
  }

  // first_commit_step = warmup boundary (= 最初に committed=true となった step)
  let firstCommitStep = -1;
  for (let i = 0; i < cm.length; i++) {
    if (cm[i] != null) {
      firstCommitStep = i;
      break;
    }
  }
  const warmupSteps = firstCommitStep < 0 ? cm.length : firstCommitStep;

  // overall (旧仕様・参考値)
  let tpAll = 0,
    fpAll = 0,
    fnAll = 0,
    snapAll = 0;
  // post-warmup (本物の評価)
  let tpPost = 0,
    fpPost = 0,
    fnPost = 0,
    snapPost = 0;

  for (let i = 0; i < gt.length; i++) {
    const g = gt[i];
    const c = cm[i];
    const isPost = i >= warmupSteps;
    if (!c) {
      fnAll++;
      if (isPost) fnPost++;
      continue;
    }
    snapAll++;
    if (isPost) snapPost++;
    const matched =
      g &&
      c.roadIndex === g.roadIndex &&
      (g.segmentIndex == null || c.segmentIndex === g.segmentIndex);
    if (matched) {
      tpAll++;
      if (isPost) tpPost++;
    } else {
      fpAll++;
      if (isPost) fpPost++;
    }
  }

  const precisionAll = snapAll > 0 ? tpAll / snapAll : 0;
  const recallAll = gt.length > 0 ? tpAll / gt.length : 0;
  const f1All =
    precisionAll + recallAll > 0 ? (2 * precisionAll * recallAll) / (precisionAll + recallAll) : 0;
  const snapRateAll = gt.length > 0 ? snapAll / gt.length : 0;

  const postWarmupTotal = gt.length - warmupSteps;
  const precisionPost = snapPost > 0 ? tpPost / snapPost : 0;
  const recallPost = postWarmupTotal > 0 ? tpPost / postWarmupTotal : 0;
  const f1Post =
    precisionPost + recallPost > 0
      ? (2 * precisionPost * recallPost) / (precisionPost + recallPost)
      : 0;
  const snapRatePost = postWarmupTotal > 0 ? snapPost / postWarmupTotal : 0;

  // DER (= committedDistanceM は実 Meter.distance_m で全 5 経路集約済)
  // post-warmup 期待距離: ground_truth segments の中で・post-warmup step に
  // 対応する区間の距離を計算する (= warmup 区間の expected は除外して二重計上回避)
  let der = null,
    derPost = null;
  if (typeof opts.expectedDistanceM === 'number' && opts.expectedDistanceM > 0) {
    const committed = opts.committedDistanceM || 0;
    der = Math.abs(committed - opts.expectedDistanceM) / opts.expectedDistanceM;
  }
  if (
    typeof opts.expectedDistancePostWarmupM === 'number' &&
    opts.expectedDistancePostWarmupM > 0
  ) {
    const committed = opts.committedDistanceM || 0;
    derPost =
      Math.abs(committed - opts.expectedDistancePostWarmupM) / opts.expectedDistancePostWarmupM;
  }

  let layerAccuracy = null;
  if (Array.isArray(opts.groundTruthLayers) && Array.isArray(opts.committedLayers)) {
    let hit = 0,
      total = 0;
    for (let i = 0; i < opts.groundTruthLayers.length; i++) {
      if (opts.groundTruthLayers[i] == null || opts.committedLayers[i] == null) continue;
      total++;
      if (opts.groundTruthLayers[i] === opts.committedLayers[i]) hit++;
    }
    layerAccuracy = total > 0 ? hit / total : null;
  }

  return {
    // post-warmup (= 本物の評価)
    precision_post_warmup: round4(precisionPost),
    recall_post_warmup: round4(recallPost),
    f1_post_warmup: round4(f1Post),
    snap_rate_post_warmup: round4(snapRatePost),
    der_post_warmup: derPost != null ? round5(derPost) : null,
    true_positive_post_warmup: tpPost,
    false_positive_post_warmup: fpPost,
    false_negative_post_warmup: fnPost,
    post_warmup_total: postWarmupTotal,

    // overall (= 旧仕様・参考値)
    precision_overall: round4(precisionAll),
    recall_overall: round4(recallAll),
    f1_overall: round4(f1All),
    snap_rate_overall: round4(snapRateAll),
    der_overall: der != null ? round5(der) : null,
    true_positive_overall: tpAll,
    false_positive_overall: fpAll,
    false_negative_overall: fnAll,

    // warmup boundary
    first_commit_step: firstCommitStep,
    warmup_steps: warmupSteps,
    total_steps: gt.length,

    // 補助
    layer_accuracy: layerAccuracy != null ? round4(layerAccuracy) : null,
  };
}

// post-warmup 期待距離計算 helper (= ground_truth_segments と warmup_steps から逆算)
function calcExpectedDistancePostWarmup(segments, warmupSteps, haversineFn, decoder, precision) {
  // 各 segment の num_samples を warmup 境界で切る
  let cumSteps = 0;
  let total = 0;
  for (const seg of segments) {
    const road = decoder.decodeRoadAt(seg.roadIndex);
    if (!road || !road.points || seg.segmentIndex >= road.points.length - 1) continue;
    const pA = road.points[seg.segmentIndex];
    const pB = road.points[seg.segmentIndex + 1];
    const aLat = pA[0] / precision;
    const aLng = pA[1] / precision;
    const bLat = pB[0] / precision;
    const bLng = pB[1] / precision;
    const tStart = seg.t_start != null ? seg.t_start : 0;
    const tEnd = seg.t_end != null ? seg.t_end : 1;
    const n = seg.num_samples != null ? seg.num_samples : 3;
    // ★ Phase 1 残り 4 fixture (2026-05-21・U-turn / reverse-oneway 対応):
    //   t_start > t_end (= 逆方向) でも実走距離は絶対値で扱う (= 全加算ルール)
    const segLen = haversineFn(aLat, aLng, bLat, bLng) * Math.abs(tEnd - tStart);
    // この segment の step 範囲 = [cumSteps, cumSteps + n)
    const segStart = cumSteps;
    const segEnd = cumSteps + n;
    cumSteps = segEnd;
    if (segEnd <= warmupSteps) continue; // 全て warmup 内・除外
    if (segStart >= warmupSteps) {
      total += segLen; // 全て post-warmup
    } else {
      // 一部 warmup・一部 post (= segment 内境界)
      const postRatio = (segEnd - warmupSteps) / n;
      total += segLen * postRatio;
    }
  }
  return total;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}
function round5(n) {
  return Math.round(n * 100000) / 100000;
}

module.exports = { score, calcExpectedDistancePostWarmup };
