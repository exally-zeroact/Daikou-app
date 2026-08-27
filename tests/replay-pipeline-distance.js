#!/usr/bin/env node
'use strict';

// tests/replay-pipeline-distance.js
// 新距離コア js/pipeline-distance.js を、実走 trace (C:/Users/zeroa/gpstrace.json) の
// seg1 (gap>120s で分割した最大区間) に流して distance_m を出力する検証ハーネス。
//
// 完全オフライン: roads-decoder.js + data/roads-ehime.js を global shim で eval 読込
//   (tests/real-trace-roadsnap.js の loader を流用)。
//
// 使い方: node tests/replay-pipeline-distance.js
//   env: GPS_TRACE=...（trace path 上書き）/ ROADS_PREF=ehime

const fs = require('fs');
const path = require('path');

const PREF = (process.env.ROADS_PREF || 'ehime').toLowerCase();
// ★2026-08-28: repo の外（C:/Users/zeroa/gpstrace.json）を見ていました★
//   ⇒ 手元では緑／★CI では 実物が無い★。この試験を CI に登録して ★赤で気づきました★。
//   ⇒ repo の中の実物（実走・タイヤ計 8.39km）を 既定にします。
const TRACE_PATH =
  process.env.GPS_TRACE || path.join(__dirname, 'fixtures', 'real-trace-iphone13-8.39km-tire.json');
const TRIP_GAP_SEC = 120;
const R = 6371000;

function rad(x) {
  return (x * Math.PI) / 180;
}
function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// gap>120s で分割した最大距離 seg を返す (real-trace-roadsnap.js と同手法)
function pickMainTrip(samples) {
  const s = samples
    .filter((x) => x && typeof x.lat === 'number' && typeof x.lng === 'number')
    .sort((a, b) => a.t - b.t);
  const segs = [[]];
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && s[i].t - s[i - 1].t > TRIP_GAP_SEC * 1000) segs.push([]);
    segs[segs.length - 1].push(s[i]);
  }
  let best = [];
  let bd = -1;
  for (const g of segs) {
    if (g.length < 2) continue;
    let d = 0;
    for (let i = 1; i < g.length; i++) d += haversine(g[i - 1], g[i]);
    if (d > bd) {
      bd = d;
      best = g;
    }
  }
  return best;
}

// roads-decoder.js + roads-{pref}.js を Node で読み込む (browser IIFE を global shim で)
function loadDecoder(pref) {
  global.window = global;
  global.self = global;
  const decSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'roads-decoder.js'), 'utf8');
  // eslint-disable-next-line no-eval
  eval(decSrc); // → global.RoadDecoder
  const dataFile = path.join(__dirname, '..', 'data', 'roads-' + pref + '.js');
  if (!fs.existsSync(dataFile)) throw new Error('roads データ無し: ' + dataFile);
  const dataSrc = fs.readFileSync(dataFile, 'utf8');
  // eslint-disable-next-line no-eval
  eval(dataSrc); // → global.ROADS_<PREF>
  const key = 'ROADS_' + pref.toUpperCase();
  const roadsData = global[key];
  if (!roadsData) throw new Error('global.' + key + ' 未定義');
  const dec = new global.RoadDecoder(roadsData);
  dec.buildOffsetTable();
  return dec;
}

// ── 合成回帰テスト: spd 無し + 停車中 GPS ジッタ → distance_m ≈ 0 (creep 防止) ──
//    監査官 critical「spd 欠落フレーム/spd 非対応端末で ZUPT 失効・phantom 距離加算」の回帰。
//    道路上の 1 点に ±8e-5 度 (≈ 数 m) のジッタを 60 秒分置き、spd を一切付けない。
//    変位ベース静止 fallback が効いていれば distance_m は ≈ 0 でなければならない。
function runStationaryJitterRegression(computeDistance, dec, seg1) {
  // seg1 から道路 snap される実在点を 1 つ基準に取る (snap 必ず当たる座標)
  const base = seg1[Math.floor(seg1.length / 2)];
  const t0 = base.t || Date.now();
  const samples = [];
  // 60 秒・1Hz・±8e-5 度のジッタ (停車中 GPS ノイズ相当)・spd フィールド無し・acc 8m
  const jit = [8e-5, -8e-5, 5e-5, -6e-5, 7e-5, -4e-5, 8e-5, -8e-5, 3e-5, -7e-5];
  for (let i = 0; i < 60; i++) {
    samples.push({
      lat: base.lat + jit[i % jit.length],
      lng: base.lng + jit[(i + 3) % jit.length],
      t: t0 + i * 1000,
      acc: 8,
      // spd 無し (= 監査官の critical 条件・spd-optional 運用)
    });
  }
  const r = computeDistance(samples, dec, { enableRouting: true });

  // 比較: spd=0 を全点に与えた同一データ (= 速度ベース ZUPT が効くケース)
  const samplesSpd0 = samples.map((s) => Object.assign({}, s, { spd: 0 }));
  const rSpd0 = computeDistance(samplesSpd0, dec, { enableRouting: true });

  return {
    noSpd_distance_m: +r.distance_m.toFixed(2),
    noSpd_stationarySkipped: r.breakdown.stationarySkipped,
    spd0_distance_m: +rSpd0.distance_m.toFixed(2),
    pts: samples.length,
  };
}

// ── (b) インクリメンタル vs バッチ 合計一致テスト ──
//    live meter は GPS を 1 点ずつ受ける。createDistanceTracker を seg1 と「同一順序」で
//    ingest した totalM() が、batch computeDistance(seg1).distance_m と一致することを確認。
//    一致 = meter.js 課金境界差込の前提 (回帰)。計測時間も返す。
function runIncrementalVsBatchParity(computeDistance, createDistanceTracker, dec, seg1) {
  // batch は内部で t 昇順 sort する。tracker は到着順をそのまま使うため、
  // 一致を見るには tracker にも同じ sort 済み順で流す。
  const ordered = seg1
    .filter((x) => x && typeof x.lat === 'number' && typeof x.lng === 'number')
    .slice()
    .sort((a, b) => (a.t || 0) - (b.t || 0));

  const batchT0 = Date.now();
  const batch = computeDistance(seg1, dec, { enableRouting: true });
  const batchMs = Date.now() - batchT0;

  const tk = createDistanceTracker(dec, { enableRouting: true });
  const incT0 = Date.now();
  let lastTotal = 0;
  const reasonCounts = {};
  for (let i = 0; i < ordered.length; i++) {
    const res = tk.ingest(ordered[i]);
    lastTotal = res.totalM;
    reasonCounts[res.reason] = (reasonCounts[res.reason] || 0) + 1;
  }
  // ★flush 必須★: 末尾 h 点 (前方窓が未到着の tail) を片側窓で確定する。batch は配列末尾を
  //   片側窓で処理済みなので、tracker も flush しないと末尾区間が未計上のまま (gpstrace で 3.13m
  //   過少) になり parity が崩れる。本番 (map-matcher/meter) も業務終了で flush を呼ぶ契約 (L2153)。
  tk.flush();
  const incMs = Date.now() - incT0;
  const incTotal = tk.totalM();

  // reset 動作確認: reset 後 totalM=0、再 ingest で再び同値に到達
  tk.reset();
  const afterReset = tk.totalM();
  for (let i = 0; i < ordered.length; i++) tk.ingest(ordered[i]);
  tk.flush(); // ★incTotal と同条件で比較するため再 ingest 後も flush
  const afterResetReingest = tk.totalM();

  const diff = Math.abs(incTotal - batch.distance_m);
  return {
    batch_distance_m: +batch.distance_m.toFixed(2),
    incremental_total_m: +incTotal.toFixed(2),
    incremental_lastTotal_m: +lastTotal.toFixed(2),
    abs_diff_m: +diff.toFixed(4),
    batch_ms: batchMs,
    incremental_ms: incMs,
    points_ingested: ordered.length,
    reason_counts: reasonCounts,
    after_reset_m: +afterReset.toFixed(2),
    after_reset_reingest_m: +afterResetReingest.toFixed(2),
  };
}

// ── 配線テスト: opts.speedProvider pluggable 経路の実差し替え検証 ──
//    配線役指摘 [A]「speedProvider 差し替えが replay で未検証」の解消。
//    全点静止を返す provider を差し込み → distance_m が 0 になることで経路導通を実証。
function runSpeedProviderInjection(computeDistance, dec, seg1) {
  let called = 0;
  const alwaysStationary = function (sample, prevSample) {
    called++;
    // prevSample を実際に参照 (orphan 引数の導通も確認)
    void prevSample;
    return 0; // 常に静止 (< stationarySpdMps)
  };
  const r = computeDistance(seg1, dec, {
    enableRouting: true,
    speedProvider: alwaysStationary,
  });
  return {
    provider_called: called,
    distance_m: +r.distance_m.toFixed(2),
    stationarySkipped: r.breakdown.stationarySkipped,
  };
}

// ── 回帰テスト: NaN/Infinity 座標の入力検証 (監査官 major #1 解消) ──
//    typeof==='number' は NaN/Infinity を通すため、汚染点を中間に挿入すると
//    straightFallbackM が NaN に汚染され breakdown が JSON 化で {…:null} になる失敗。
//    Number.isFinite 防御で batch/ingest 双方が汚染点を除外することを確認。
function runNonFiniteRejection(computeDistance, createDistanceTracker, dec, seg1) {
  // clean な seg1 (有限点のみ) を基準にする
  const clean = seg1.filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng));
  const baseline = computeDistance(clean, dec, { enableRouting: true });

  // clean 列の中間に NaN/Infinity/null 座標点を注入 (spd 無しで直線 fallback 経路を踏ませる)
  const poisoned = [];
  const mid = Math.floor(clean.length / 2);
  for (let i = 0; i < clean.length; i++) {
    poisoned.push(clean[i]);
    if (i === mid) {
      const t = clean[i].t != null ? clean[i].t : i;
      poisoned.push({ lat: NaN, lng: clean[i].lng, t: t + 1 });
      poisoned.push({ lat: clean[i].lat, lng: Infinity, t: t + 2 });
      poisoned.push({ lat: -Infinity, lng: -Infinity, t: t + 3 });
      poisoned.push(null);
    }
  }
  const poisonedRes = computeDistance(poisoned, dec, { enableRouting: true });
  const bdValues = Object.keys(poisonedRes.breakdown).map((k) => poisonedRes.breakdown[k]);
  const breakdownAllFinite = bdValues.every((v) => Number.isFinite(v));
  const distanceFinite = Number.isFinite(poisonedRes.distance_m);
  const batchMatchesBaseline = Math.abs(poisonedRes.distance_m - baseline.distance_m) < 0.01;

  // ingest 側: 汚染点が reason:'skip' を返し deltaM=0、totalM が汚染されないこと
  const tk = createDistanceTracker(dec, { enableRouting: true });
  let skipCount = 0;
  let ingestTotalFinite = true;
  for (let i = 0; i < poisoned.length; i++) {
    const res = tk.ingest(poisoned[i]);
    if (res.reason === 'skip') skipCount++;
    if (!Number.isFinite(res.totalM) || !Number.isFinite(res.deltaM)) {
      ingestTotalFinite = false;
    }
  }
  tk.flush(); // ★tail 確定 (batch baseline と同条件)・汚染点除去後の totalM == baseline を測る
  const ingestTotal = tk.totalM();
  const ingestMatchesBaseline = Math.abs(ingestTotal - baseline.distance_m) < 0.01;

  return {
    baseline_distance_m: +baseline.distance_m.toFixed(2),
    poisoned_distance_m: +poisonedRes.distance_m.toFixed(2),
    breakdown_all_finite: breakdownAllFinite,
    distance_finite: distanceFinite,
    batch_matches_baseline: batchMatchesBaseline,
    ingest_skip_count: skipCount, // 期待: NaN/Infinity/null 計 4 点
    ingest_total_finite: ingestTotalFinite,
    ingest_total_m: +ingestTotal.toFixed(2),
    ingest_matches_baseline: ingestMatchesBaseline,
  };
}

// ── 回帰テスト: out-of-order ingest ガード (監査官 major #2 / 配線役指摘 解消) ──
//    監査官の再現: 隣接ペアを入れ替えた列を「無ガードで」ingest すると total が
//    batch(sort済) より水増しされる (監査官実測 9955 > 9677)。
//    本ガードは t 逆転フレームを破棄するため:
//      (1) 無ガード相当(全点採用)では水増し >0 が観測される (脅威の実在を実証)。
//      (2) ガードありでは batch を超える水増しが起きない (guarded <= batch)。
//      (3) ★stale 重複の遅延到着★ (= 既処理 t より古い frame の再送) を注入しても
//          全て破棄され total が clean batch と完全一致する (本番で最も起き得る形)。
function runOutOfOrderGuard(computeDistance, createDistanceTracker, dec, seg1) {
  const clean = seg1
    .filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng) && Number.isFinite(s.t))
    .slice()
    .sort((a, b) => a.t - b.t);
  if (clean.length < 8) {
    return { skipped: true, reason: 't ありの clean 点が不足' };
  }
  const batch = computeDistance(clean, dec, { enableRouting: true });

  // (1) 監査官再現: 隣接ペア入れ替え列。ガード ON で water-mark を超えない (<= batch)。
  const swapped = clean.slice();
  for (let i = 0; i + 1 < swapped.length; i += 2) {
    const tmp = swapped[i];
    swapped[i] = swapped[i + 1];
    swapped[i + 1] = tmp;
  }
  const tkSwap = createDistanceTracker(dec, { enableRouting: true });
  let swapDropped = 0;
  for (let i = 0; i < swapped.length; i++) {
    if (tkSwap.ingest(swapped[i]).reason === 'out_of_order') swapDropped++;
  }
  tkSwap.flush(); // ★tail 確定 (batch と同条件)
  const swapTotal = tkSwap.totalM();

  // (3) stale 遅延到着: clean 列の合間に「過去 frame の再送」を挿入。
  //     既処理 t より古いため全て破棄され、残りは clean と同一順序 → total 完全一致。
  const withStale = [];
  let staleInjected = 0;
  for (let i = 0; i < clean.length; i++) {
    withStale.push(clean[i]);
    if (i >= 3 && i % 50 === 0) {
      // 3 点前の古い frame を再送 (t が現時点 prev より小さい)
      withStale.push(clean[i - 3]);
      staleInjected++;
    }
  }
  const tkStale = createDistanceTracker(dec, { enableRouting: true });
  let staleDropped = 0;
  for (let i = 0; i < withStale.length; i++) {
    if (tkStale.ingest(withStale[i]).reason === 'out_of_order') staleDropped++;
  }
  tkStale.flush(); // ★tail 確定 (batch と同条件)・stale 除去後 batch と完全一致を測る
  const staleTotal = tkStale.totalM();
  const staleDiff = Math.abs(staleTotal - batch.distance_m);

  return {
    batch_distance_m: +batch.distance_m.toFixed(2),
    swap_dropped: swapDropped,
    swap_guarded_total_m: +swapTotal.toFixed(2),
    swap_no_inflation: swapTotal <= batch.distance_m + 0.01, // batch を超えない (水増し無し)
    stale_injected: staleInjected,
    stale_dropped: staleDropped,
    stale_total_m: +staleTotal.toFixed(2),
    stale_abs_diff_vs_batch_m: +staleDiff.toFixed(4),
  };
}

function main() {
  const {
    computeDistance,
    createDistanceTracker,
    RoadGraphRouter,
    gpsSpeedProvider,
    haversineM,
    DEFAULTS,
  } = require(path.join(__dirname, '..', 'js', 'pipeline-distance.js'));
  // export 導通確認 (配線役 orphan 指摘の最小カバー)
  if (
    typeof computeDistance !== 'function' ||
    typeof createDistanceTracker !== 'function' ||
    typeof RoadGraphRouter !== 'function' ||
    typeof gpsSpeedProvider !== 'function' ||
    typeof haversineM !== 'function' ||
    !DEFAULTS
  ) {
    throw new Error(
      'pipeline-distance.js export 不整合 (computeDistance/createDistanceTracker/RoadGraphRouter/gpsSpeedProvider/haversineM/DEFAULTS)'
    );
  }

  if (!fs.existsSync(TRACE_PATH)) throw new Error('trace 無し: ' + TRACE_PATH);
  const samples = JSON.parse(fs.readFileSync(TRACE_PATH, 'utf8'));
  const seg1 = pickMainTrip(samples);
  if (seg1.length < 2) throw new Error('seg1 走行区間なし');

  let raw = 0;
  for (let i = 1; i < seg1.length; i++) raw += haversine(seg1[i - 1], seg1[i]);

  const hasSpd = seg1.some((s) => typeof s.spd === 'number' && s.spd >= 0);

  console.log('[replay] trace=' + TRACE_PATH);
  console.log('[replay] seg1 pts=' + seg1.length + '  raw_haversine=' + raw.toFixed(0) + ' m');
  console.log(
    '[replay] seg1 に spd フィールドあり: ' +
      hasSpd +
      ' (無ければ Doppler 補間は不発・直線 fallback)'
  );
  console.log('[replay] roads-' + PREF + ' 読込中...');
  const dec = loadDecoder(PREF);

  // --- routing ON (本命) ---
  const onT0 = Date.now();
  const on = computeDistance(seg1, dec, { enableRouting: true });
  const onMs = Date.now() - onT0;

  // --- routing OFF (比較: 別道路は常に直線 = 旧 calcRoadDistance 相当) ---
  const off = computeDistance(seg1, dec, { enableRouting: false });

  // --- SnapCache 等価性 + 無効化経路 ---
  //   SnapCache 経路 (既定) と decoder 直叩き (useSnapCache:false) の distance_m が
  //   一致することで「高速化が結果を変えていない」ことを実証 (snap 等価の回帰)。
  const noCache = computeDistance(seg1, dec, { enableRouting: true, useSnapCache: false });
  const snapCacheDiff = Math.abs(on.distance_m - noCache.distance_m);

  console.log('\n=== 新距離コア pipeline-distance.js (seg1) ===');
  console.log('  生GPS haversine        : ' + raw.toFixed(0) + ' m');
  console.log('  ★distance_m (routing ON): ' + on.distance_m.toFixed(0) + ' m   (' + onMs + ' ms)');
  console.log('   distance_m (routing OFF): ' + off.distance_m.toFixed(0) + ' m');
  console.log('  --- routing ON 内訳 ---');
  console.log(
    '    同一道路弧長  : ' +
      on.breakdown.sameRoadM.toFixed(0) +
      ' m  (' +
      on.stats.sameRoadSegs +
      ' 区間)'
  );
  console.log(
    '    routing道なり : ' +
      on.breakdown.routedM.toFixed(0) +
      ' m  (' +
      on.stats.routedSegs +
      ' 区間)'
  );
  console.log(
    '    直線fallback  : ' +
      on.breakdown.straightFallbackM.toFixed(0) +
      ' m  (' +
      on.stats.straightSegs +
      ' 区間)'
  );
  console.log(
    '    Doppler補間   : ' +
      on.breakdown.dopplerM.toFixed(0) +
      ' m  (' +
      on.stats.dopplerSegs +
      ' 区間)'
  );
  console.log('    静止skip(ZUPT): ' + on.breakdown.stationarySkipped + ' 区間');
  console.log('    routing過大fallback: ' + on.stats.routingFallbacks + ' 回');
  console.log('    snap hit/miss : ' + on.stats.snapHit + ' / ' + on.stats.snapMiss);

  // ── (a) 性能: 実行時間計測 (routing ON の seg1 全 routing 時間) ──
  console.log('\n=== (a) 性能: 実行時間計測 (seg1 routing ON) ===');
  console.log(
    '  seg1 routing ON 実行時間 : ' +
      onMs +
      ' ms  (' +
      seg1.length +
      ' 点・' +
      (onMs / seg1.length).toFixed(2) +
      ' ms/点)'
  );
  console.log(
    '  SnapCache 等価            : useSnapCache:false distance_m=' +
      noCache.distance_m.toFixed(2) +
      ' m  |差|=' +
      snapCacheDiff.toFixed(4) +
      ' m'
  );

  // ── (b) インクリメンタル vs バッチ 合計一致 ──
  const parity = runIncrementalVsBatchParity(computeDistance, createDistanceTracker, dec, seg1);
  console.log('\n=== (b) インクリメンタル vs バッチ 合計一致 ===');
  console.log(
    '  batch  distance_m        : ' + parity.batch_distance_m + ' m  (' + parity.batch_ms + ' ms)'
  );
  console.log(
    '  incr   totalM()          : ' +
      parity.incremental_total_m +
      ' m  (' +
      parity.incremental_ms +
      ' ms, ' +
      parity.points_ingested +
      ' 点)'
  );
  console.log('  |差|                     : ' + parity.abs_diff_m + ' m');
  console.log('  reset 後 totalM          : ' + parity.after_reset_m + ' m');
  console.log('  reset→再ingest totalM    : ' + parity.after_reset_reingest_m + ' m');
  console.log('  区間 reason 内訳         : ' + JSON.stringify(parity.reason_counts));

  // ── 回帰/配線テスト ──
  const jitReg = runStationaryJitterRegression(computeDistance, dec, seg1);
  const provInj = runSpeedProviderInjection(computeDistance, dec, seg1);
  const nonFinite = runNonFiniteRejection(computeDistance, createDistanceTracker, dec, seg1);
  const ooo = runOutOfOrderGuard(computeDistance, createDistanceTracker, dec, seg1);

  console.log('\n=== 回帰テスト: spd 無し + 停車ジッタ → creep 防止 ===');
  console.log(
    '  spd無し distance_m       : ' +
      jitReg.noSpd_distance_m +
      ' m  (静止skip ' +
      jitReg.noSpd_stationarySkipped +
      '/' +
      jitReg.pts +
      ')'
  );
  console.log('  spd=0   distance_m (参考): ' + jitReg.spd0_distance_m + ' m');
  console.log('=== 配線テスト: speedProvider 差し替え ===');
  console.log('  provider 呼出回数        : ' + provInj.provider_called);
  console.log(
    '  全点静止 provider distance_m: ' +
      provInj.distance_m +
      ' m  (静止skip ' +
      provInj.stationarySkipped +
      ')'
  );

  console.log('=== 回帰テスト: NaN/Infinity 座標の入力検証 (major #1) ===');
  console.log(
    '  baseline(clean) distance_m : ' +
      nonFinite.baseline_distance_m +
      ' m   poisoned distance_m: ' +
      nonFinite.poisoned_distance_m +
      ' m'
  );
  console.log(
    '  breakdown 全項目 finite     : ' +
      nonFinite.breakdown_all_finite +
      '   distance_m finite: ' +
      nonFinite.distance_finite
  );
  console.log(
    '  ingest skip 点数            : ' +
      nonFinite.ingest_skip_count +
      '   ingest totalM finite: ' +
      nonFinite.ingest_total_finite +
      '   ingest=baseline: ' +
      nonFinite.ingest_matches_baseline
  );
  console.log('=== 回帰テスト: out-of-order ingest ガード (major #2) ===');
  if (ooo.skipped) {
    console.log('  スキップ: ' + ooo.reason);
  } else {
    console.log('  batch(sort済) distance_m       : ' + ooo.batch_distance_m + ' m');
    console.log(
      '  ペア入替: 破棄 ' +
        ooo.swap_dropped +
        ' 点  guarded totalM=' +
        ooo.swap_guarded_total_m +
        ' m  水増し無し(<=batch): ' +
        ooo.swap_no_inflation
    );
    console.log(
      '  stale 遅延再送: 注入 ' +
        ooo.stale_injected +
        ' / 破棄 ' +
        ooo.stale_dropped +
        '  totalM=' +
        ooo.stale_total_m +
        ' m  |差 vs batch|=' +
        ooo.stale_abs_diff_vs_batch_m +
        ' m'
    );
  }

  // PASS/FAIL 判定 (creep 防止 critical の合否)
  const CREEP_MAX_M = 5.0; // 60 秒静止で 5m 超の phantom 距離は creep とみなし FAIL
  const failures = [];
  if (jitReg.noSpd_distance_m > CREEP_MAX_M) {
    failures.push(
      'spd 無し停車ジッタで distance_m=' +
        jitReg.noSpd_distance_m +
        'm (>' +
        CREEP_MAX_M +
        'm) = creep 再発'
    );
  }
  if (provInj.provider_called === 0) {
    failures.push('speedProvider が一度も呼ばれない (差し替え経路未導通)');
  }
  if (provInj.distance_m > CREEP_MAX_M) {
    failures.push(
      '全点静止 provider で distance_m=' +
        provInj.distance_m +
        'm (>' +
        CREEP_MAX_M +
        'm) = ZUPT 失効'
    );
  }
  // (b) インクリメンタル vs バッチ 合計一致 (回帰): 浮動小数の累積誤差のみ許容
  const PARITY_MAX_DIFF_M = 0.01;
  // SnapCache 等価性: 高速化 (cell decode cache + 展開リング) が snap 結果を変えていないこと
  if (snapCacheDiff > PARITY_MAX_DIFF_M) {
    failures.push(
      'SnapCache が distance_m を変化させた |差|=' +
        snapCacheDiff.toFixed(4) +
        'm (>' +
        PARITY_MAX_DIFF_M +
        'm) = snap 等価性違反'
    );
  }
  if (parity.abs_diff_m > PARITY_MAX_DIFF_M) {
    failures.push(
      'incremental vs batch 不一致 |差|=' +
        parity.abs_diff_m +
        'm (>' +
        PARITY_MAX_DIFF_M +
        'm) = tracker/batch ロジック乖離'
    );
  }
  if (parity.after_reset_m !== 0) {
    failures.push('reset() 後 totalM=' + parity.after_reset_m + 'm (≠0) = reset 不全');
  }
  if (Math.abs(parity.after_reset_reingest_m - parity.incremental_total_m) > PARITY_MAX_DIFF_M) {
    failures.push(
      'reset→再ingest が初回 totalM と不一致 (' +
        parity.after_reset_reingest_m +
        ' vs ' +
        parity.incremental_total_m +
        ') = 状態残留'
    );
  }
  // NaN/Infinity 入力検証 (major #1): 汚染点が batch/ingest 双方で除外され、
  // breakdown/距離が finite を保ち baseline と一致すること。
  if (!nonFinite.breakdown_all_finite) {
    failures.push('NaN/Infinity 注入で breakdown に非 finite 値が混入 = 入力検証ギャップ');
  }
  if (!nonFinite.distance_finite) {
    failures.push('NaN/Infinity 注入で distance_m が非 finite = 入力検証ギャップ');
  }
  if (!nonFinite.batch_matches_baseline) {
    failures.push(
      'NaN/Infinity 注入で batch distance_m が baseline(' +
        nonFinite.baseline_distance_m +
        ') と乖離 (' +
        nonFinite.poisoned_distance_m +
        ')'
    );
  }
  if (nonFinite.ingest_skip_count !== 4) {
    failures.push(
      'ingest が NaN/Infinity/null 4 点を skip しない (skip=' + nonFinite.ingest_skip_count + ')'
    );
  }
  if (!nonFinite.ingest_total_finite) {
    failures.push('ingest が非 finite な deltaM/totalM を返した = 入力検証ギャップ');
  }
  if (!nonFinite.ingest_matches_baseline) {
    failures.push('NaN/Infinity 注入で ingest totalM が baseline と乖離');
  }
  // out-of-order ガード (major #2):
  //   (a) t 逆転フレームが実際に破棄される (ガード導通)。
  //   (b) ペア入替列で batch を超える水増しが起きない (guarded <= batch)。
  //   (c) stale 遅延再送を注入しても全破棄され total が clean batch と完全一致。
  if (!ooo.skipped) {
    if (ooo.swap_dropped === 0) {
      failures.push('ペア入替列で 1 点も破棄されない = out-of-order ガード未導通');
    }
    if (!ooo.swap_no_inflation) {
      failures.push(
        'out-of-order 列で totalM=' +
          ooo.swap_guarded_total_m +
          'm が batch(' +
          ooo.batch_distance_m +
          'm) を超過 = 距離水増し'
      );
    }
    if (ooo.stale_injected > 0 && ooo.stale_dropped !== ooo.stale_injected) {
      failures.push(
        'stale 遅延再送 ' +
          ooo.stale_injected +
          ' 点中 ' +
          ooo.stale_dropped +
          ' 点しか破棄されない = ガード漏れ'
      );
    }
    if (ooo.stale_abs_diff_vs_batch_m > PARITY_MAX_DIFF_M) {
      failures.push(
        'stale 再送除去後 totalM が clean batch と不一致 |差|=' +
          ooo.stale_abs_diff_vs_batch_m +
          'm (>' +
          PARITY_MAX_DIFF_M +
          'm)'
      );
    }
  }

  const testPass = failures.length === 0;
  console.log('\n=== 判定: ' + (testPass ? 'PASS' : 'FAIL') + ' ===');
  for (const f of failures) console.log('  [FAIL] ' + f);

  const OUT_DIR = path.join(__dirname, '..', 'data', 'test-results');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = {
    trace: TRACE_PATH,
    seg1_points: seg1.length,
    raw_haversine_m: +raw.toFixed(0),
    distance_m_routing_on: +on.distance_m.toFixed(0),
    distance_m_routing_off: +off.distance_m.toFixed(0),
    routing_on_breakdown: on.breakdown,
    routing_on_stats: on.stats,
    routing_ms: onMs,
    ms_per_point: +(onMs / seg1.length).toFixed(3),
    distance_m_no_snapcache: +noCache.distance_m.toFixed(2),
    snapcache_abs_diff_m: +snapCacheDiff.toFixed(4),
    incremental_vs_batch: parity,
    regression_stationary_jitter: jitReg,
    wiring_speedprovider_injection: provInj,
    regression_non_finite_rejection: nonFinite,
    regression_out_of_order_guard: ooo,
    test_pass: testPass,
    test_failures: failures,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, 'replay-pipeline-distance.json'),
    JSON.stringify(out, null, 2)
  );
  console.log('\n[replay] wrote data/test-results/replay-pipeline-distance.json');

  if (!testPass) process.exit(1);
}

main();
