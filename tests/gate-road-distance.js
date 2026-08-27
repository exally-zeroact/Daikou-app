#!/usr/bin/env node
'use strict';

// ============================================================
// tests/gate-road-distance.js
//   ★STEP0 ゲート (実装前テスト先行)★ — 「通った道の正確な距離」の検証ゲート。
//
//   司さん核心:「通った道の正確な距離を出せ」。
//   真値 = 車のタイヤ計 (絶対) = 8.39km (愛媛 2 台同乗・iPhone13 fixture)。
//
//   本ゲートは ★実 js/map-matcher.js (Worker B) + 実 js/meter.js を Node で evaluate★ し
//   (= 再実装/コピー禁止・prod 経路と byte 等価)、iPhone13 fixture (ROADS_PREF=ehime) を
//   1 点ずつ Meter.update → Worker B → mmResult → meter distance_m の prod 経路で流す。
//   さらに js/pipeline-distance.js を直接呼んで「現状 distance 駆動 = greedy per-point snap」
//   の内訳 (flip / 偽遷移弦) を分解する。
//
//   検証項目 (タスク STEP0):
//     (a) distance ≈ 8.39km (±3% = 8.14〜8.64km)  … 現状 greedy 8.9km 台で FAIL
//     (b) flip (別道路への遷移区間) ≈ 0           … 現状 146 区間で FAIL
//     (c) 配線完全性: 距離駆動 source が Viterbi 確定経路か / greedy 寄与が残ってないか
//                                                  … 現状 greedy 駆動で FAIL
//     (d) 停車 creep = 0 / calcFare 式不変 / 業務 vs trip 分離 (= 不変項目・現状 PASS 想定)
//
//   ★着手時 (STEP0) は (a)(b)(c) が ★現状 FAIL★ することを実値で確認する (trivial-green でない証明)。★
//   L1/L2/L3 の配線実装 (距離源を Viterbi 確定経路 committed chain の道なり弧長へ一本化 +
//   連結性ハード拘束で偽遷移棄却) が入って初めて (a)(b)(c) が GREEN になる。
//
//   絶対不変 (本ゲートは検証のみ・実コードは 1 byte も触らない):
//     calcFare / tier 境界 / business vs trip 分離 / haversine 業務 / GPS 直線課金ゼロ /
//     mm-data-pipeline.js / sw.js / 停車 creep=0。
//
//   使い方:
//     node tests/gate-road-distance.js              (CLI・PASS/FAIL + JSON 出力)
//     ROADS_PREF=ehime node tests/gate-road-distance.js
//   import:
//     const { runGate } = require('./gate-road-distance'); runGate({pref:'ehime'})
// ============================================================

const fs = require('fs');
const path = require('path');
const { createMapMatcherWorker, loadPrefRoadsData } = require('./replay-mm-worker/worker-sim');
const { loadMeter } = require('./replay-mm-worker/runner');

const DEFAULT_PREF = 'ehime';
const FIXTURE_NAME = 'real-trace-iphone13-8.39km-tire.json';

// ── 真値 (タイヤ計・絶対) と許容帯 ──
const TIRE_TRUTH_M = 8390; // 車のタイヤ計 = 8.39km (愛媛 実走・2 台同乗)
const TOL_RATIO = 0.03; // ±3%
const DIST_MIN_M = TIRE_TRUTH_M * (1 - TOL_RATIO); // 8138.3 m
const DIST_MAX_M = TIRE_TRUTH_M * (1 + TOL_RATIO); // 8641.7 m

// ★今 どちらの物差しで走っているか★（2026-06-06 の設計変更・指示役の裁定③ 2026-08-28）
//   ON（今）… 平滑した生GPSの弦で距離を出す ⇒ ★Viterbi を距離に使わないのが正しい姿★
//   OFF ……… 道路の当てはめで距離を出す ⇒ (b)(c) は 昔どおりの見方
const SMOOTHED_ON = /^\s*smoothedRawMode:\s*true,/m.test(
  fs.readFileSync(path.join(__dirname, '..', 'js', 'pipeline-distance.js'), 'utf8')
);

// (b) flip ≈ 0 の許容上限 (= 別道路 roadIndex 変化区間)。連結拘束導入後は legit な交差点通過のみ
//     残るが・偽遷移 (繋がってない道) は 0 を要求する。
const FLIP_TOTAL_MAX = 10; // 全別道路遷移の上限 (legit turn を多少許容)
const FLIP_BADFLIP_MAX = 0; // ★偽遷移 (連結不能) は 0★ (= 余計な弦ゼロ)

// ── ★認定バンド (国交省 GPS ソフトメーター 片公差・過大側ゼロ)★ ──────────────
//   タスク A1 の合否基準。±3% 対称帯 (DIST_MIN/MAX) とは別の ★過大ゼロ拘束★。
//     1km 超: distance_m は [真値×0.96, 真値] = [−4%, 0%] (過大不可)。
//     1km 以下: [真値−40m, 真値] (過大不可)。← 本 fixture は 8.39km なので %帯を適用。
//   ★現コード (pre-A1) は distance_m=8489m (+1.18% 過大) = ★この帯の上限 (真値) を超える = RED★。
//   A1 (routedM de-bias) 後に distance_m ≤ 8390m へ下がり GREEN 化する想定。
//   ★テスト・ゲーミング禁止: 帯は認定根拠で固定・新値が真値以下に入って初めて GREEN★。
const CERT_OVER_MAX_M = TIRE_TRUTH_M; // 過大側上限 = 真値 (0%・1m も超えない)
const CERT_UNDER_MIN_M = TIRE_TRUTH_M * (1 - 0.04); // 過少側下限 = −4% = 8054.4 m

// (d) creep: 停車区間の phantom 距離上限
const CREEP_MAX_M = 5.0;

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

function haversineM(la1, lo1, la2, lo2) {
  const R = 6371000,
    tr = Math.PI / 180;
  const dLat = (la2 - la1) * tr;
  const dLng = (lo2 - lo1) * tr;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1 * tr) * Math.cos(la2 * tr) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function loadFixture() {
  const p = path.join(__dirname, 'fixtures', FIXTURE_NAME);
  if (!fs.existsSync(p)) throw new Error('fixture 無し: ' + p);
  return JSON.parse(fs.readFileSync(p, 'utf8'))
    .filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .sort((a, b) => (a.t || 0) - (b.t || 0));
}

// roads-decoder.js + roads-{pref}.js を ★独立 vm 風 global shim★ で Node load (pipeline-distance 直叩き用)。
//   worker-sim とは別インスタンスの decoder (= greedy 内訳分解専用)。global 汚染を最小化するため
//   既存 global を退避して復元する。
function loadDecoderStandalone(pref) {
  const savedWindow = global.window;
  const savedSelf = global.self;
  const savedRD = global.RoadDecoder;
  const key = 'ROADS_' + pref.toUpperCase();
  const savedRoads = global[key];
  try {
    global.window = global;
    global.self = global;
    // eslint-disable-next-line no-eval
    eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'roads-decoder.js'), 'utf8'));
    // eslint-disable-next-line no-eval
    eval(fs.readFileSync(path.join(__dirname, '..', 'data', 'roads-' + pref + '.js'), 'utf8'));
    const roadsData = global[key];
    if (!roadsData) throw new Error('global.' + key + ' 未定義');
    const dec = new global.RoadDecoder(roadsData);
    dec.buildOffsetTable();
    return dec;
  } finally {
    global.window = savedWindow;
    global.self = savedSelf;
    global.RoadDecoder = savedRD;
    global[key] = savedRoads;
  }
}

// ── (a)(c)(d) 実 prod 経路: 実 Worker B + 実 Meter で fixture を流す ──
//    distanceSource = pipelineDeltaM (= 距離駆動の単一 sink) を meter.state.distance_m で集約。
//    mmResult から committed chain (Viterbi 確定) と pipeline / mmIncrement の各源を計測。
function runProdPipeline(pref, samples) {
  const worker = createMapMatcherWorker({ debug: false });
  const mmResults = [];
  let roadsLoaded = false;
  let pipelineBreakdown = null;
  worker.on((e) => {
    const m = e.data;
    if (!m) return;
    if (m.type === 'mmResult') mmResults.push(m);
    if (m.type === 'roadsLoaded') roadsLoaded = m.ok;
    if (m.type === 'pipelineBreakdown') pipelineBreakdown = m;
  });
  const roadsData = loadPrefRoadsData(pref);

  const Meter = loadMeter({ debug: false });
  Meter.setFareConfig(STANDARD_FARE);
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
  // ★順序重要: setMapMatcher の後に adapter 経由で loadRoads (= roadsLoaded ack を Meter が捕捉)
  adapter.postMessage({ type: 'configPlatform', isIOS: true });
  adapter.postMessage({ type: 'loadRoads', pref: roadsData.prefecture, roadsData });
  if (!roadsLoaded) throw new Error('loadRoads failed for pref=' + pref);
  if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);

  // ── (d) creep 計測のため・末尾に 60 秒分の停車サンプル (spd=0) を追加した別走を後段で行う ──
  for (const g of samples) {
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
  }
  // ★(b)(c) 実距離源の内訳取得 (businessEnd 前 = tracker reset 前に取得)。
  //   距離源 = Viterbi 確定 snap で駆動する pipeline tracker。straightFallbackM/straightSegs=0 が
  //   「余計な弦 (偽遷移由来の chord) を距離に入れていない」= タスク核心の品質指標。
  adapter.postMessage({ type: 'getPipelineBreakdown' });
  Meter.businessEnd();
  const finalState = Meter.getState();

  // mmResult 集計: pipeline (= 現状距離駆動) / mmIncrement (= Viterbi 確定 dead-coded) / committed flip
  let sumPipeline = 0;
  let sumMmIncrement = 0;
  let committedCount = 0;
  let committedFlips = 0;
  let prevRoad = null;
  let prevPref = null;
  for (const m of mmResults) {
    // ★smoothedRawMode flush (2026-06-07)★: 'reset' 時の末尾 flush delta は ★設計どおり★ meter の
    //   gate (businessEnd が先に閉じる) で落ちる一回限りの後着 (過小方向・実測 ≤13m)。単一source検査
    //   (sink == Σδ) は「meter が受け取り得た delta」で行うため flush message は総和から除外する。
    if (m._reason === 'pipeline flush before reset') continue;
    if (typeof m.pipelineDeltaM === 'number' && m.pipelineDeltaM > 0)
      sumPipeline += m.pipelineDeltaM;
    if (typeof m.mmIncrementM === 'number' && m.mmIncrementM > 0) sumMmIncrement += m.mmIncrementM;
    if (m.committed && m.snap) {
      committedCount++;
      if (prevRoad != null && (m.snap.prefecture !== prevPref || m.snap.roadIndex !== prevRoad)) {
        committedFlips++;
      }
      prevRoad = m.snap.roadIndex;
      prevPref = m.snap.prefecture;
    }
  }

  return {
    roadsLoaded,
    mmResultCount: mmResults.length,
    committedCount,
    committedFlips,
    sumPipelineDeltaM: sumPipeline,
    sumMmIncrementM: sumMmIncrement,
    meter_distance_m: finalState.distance_m,
    meter_business_distance_m: finalState.business_distance_m || 0,
    meter_fare_yen: finalState.fare_yen,
    distanceSource: finalState.distanceSource,
    pipelineBreakdown, // ★距離源 tracker の実内訳 (Viterbi 確定 snap 駆動)
    Meter,
  };
}

// ── (b) flip 分解: pipeline-distance の SnapCache (= 距離駆動の greedy per-point snap) で
//        隣接 snap の roadIndex 変化を数え、そのうち道路網 routing 不能 (= 繋がってない道) を
//        「偽遷移 (badflip)」として分離する。straightFallbackM がその余計な弦の総量。──
function analyzeGreedyFlips(dec, samples) {
  // pipeline-distance を require (prod の距離駆動エンジン本体)。
  const PD = require(path.join(__dirname, '..', 'js', 'pipeline-distance.js'));
  const snapper = new PD.SnapCache(dec, {});
  const router = new PD.RoadGraphRouter(dec, {});
  let prevSnap = null;
  let flipDiffRoad = 0;
  let flipBad = 0;
  let snapHit = 0;
  for (const g of samples) {
    const snap = snapper.snap(g.lat, g.lng);
    if (snap) snapHit++;
    if (prevSnap && snap && prevSnap.roadIndex !== snap.roadIndex) {
      flipDiffRoad++;
      const routed = router.routeDistance(prevSnap, snap);
      const chord = PD.haversineM(prevSnap.snapLat, prevSnap.snapLng, snap.snapLat, snap.snapLng);
      // routing 不能 or 遠回り過大 = 道路網で繋がってない = 偽遷移 (= 余計な弦)
      if (routed == null || (chord > 0.1 && routed / chord > 4.0)) flipBad++;
    }
    if (snap) prevSnap = snap;
  }
  // batch distance + 内訳 (straightFallbackM = 偽遷移由来の余計な弦)
  const batch = PD.computeDistance(samples, dec, { enableRouting: true });
  return {
    snapHit,
    greedy_distance_m: batch.distance_m,
    breakdown: batch.breakdown,
    flip_diff_road_total: flipDiffRoad,
    flip_badflip: flipBad,
    PD,
  };
}

// ── (d-creep) 停車 creep: 道路上の 1 点に微小ジッタ・spd=0 を 60 秒置き distance≈0 を確認 ──
function analyzeStationaryCreep(PD, dec, samples) {
  const base = samples[Math.floor(samples.length / 2)];
  const t0 = base.t || Date.now();
  const jit = [8e-5, -8e-5, 5e-5, -6e-5, 7e-5, -4e-5, 8e-5, -8e-5, 3e-5, -7e-5];
  const stationary = [];
  for (let i = 0; i < 60; i++) {
    stationary.push({
      lat: base.lat + jit[i % jit.length],
      lng: base.lng + jit[(i + 3) % jit.length],
      t: t0 + i * 1000,
      acc: 8,
      spd: 0, // 停車 (ZUPT)
    });
  }
  const r = PD.computeDistance(stationary, dec, { enableRouting: true });
  return {
    creep_distance_m: r.distance_m,
    stationarySkipped: r.breakdown.stationarySkipped,
    pts: stationary.length,
  };
}

// ── (d) calcFare 不変 + 業務 vs trip 分離 ──
function analyzeFareAndSeparation(Meter, prod) {
  // calcFare 既知値 (v2 標準: 1000m¥1300・以降 420m¥100・rounding10)
  const fareChecks = {
    f1000: Meter.calcFare(1000), // 1300
    f8390: Meter.calcFare(8390), // 真値での運賃 (期待 3100)
    f8966: Meter.calcFare(8966), // greedy 過大での運賃 (期待 3200 = +100 過大課金)
  };
  // 業務 vs trip 分離: business_distance_m と distance_m が独立フィールドであること
  //   (本 fixture は business_active=true & running=true で両方加算されるが・別変数で保持)
  const separation = {
    distance_m: prod.meter_distance_m,
    business_distance_m: prod.meter_business_distance_m,
    are_distinct_fields: true, // state.distance_m と state.business_distance_m は別 key (静的保証)
  };
  return { fareChecks, separation };
}

// ── (c) 配線完全性 (静的): 距離駆動 source → sink を実コードで照合 ──
//   ★L1 配線後 (2026-05-31): 距離源 = Viterbi 確定 snap (outSnap = bestEmit)。★
//   worker は _confirmedRoadDelta で outSnap を sample.snap として ingest に渡し、
//   pipeline-distance は sample.snap がある時 greedy SnapCache.snap を ★呼ばず★ Viterbi
//   確定 snap で道なり弧長 (L2 連結性ハード拘束付き) を算出する。
function analyzeWiringStatic() {
  const meterSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'meter.js'), 'utf8');
  const mmSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'map-matcher.js'), 'utf8');
  const pdSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'pipeline-distance.js'), 'utf8');

  // sink: meter.js が state.distance_m += pipelineDeltaM (= 距離駆動の単一経路)
  // ★2026-08-28: ここは ★ずっと false でした★（(c) が赤い本当の理由の1つ）。
  //   探していたのは `state.distance_m += delta` ですが、実物は ★`+= cal`★。
  //   代行係数を掛ける行（const cal = delta * _kForDelta * _daikouDistFactor）が入った時に
  //   ★変数の名前が変わった★のに、この見張りは 名前で探していました。
  //   ⇒★名前で探さない★＝「加算が在る」＋「その値が delta から作られている」で見る。
  const addName = (meterSrc.match(/state\.distance_m\s*\+=\s*([A-Za-z_$][\w$]*)\s*;/) || [])[1];
  //   ★正規表現を 文字で組み立てない★（\s が消えて いつも false になった・2026-08-28 に踏んだ）
  const declLine =
    meterSrc.split('\n').find((l) => l.indexOf('const ' + addName + ' =') >= 0) || '';
  const sinkPipelineAdd = !!addName && (addName === 'delta' || declLine.indexOf('delta') >= 0);
  const sinkDeltaFromPipeline = /m\.pipelineDeltaM/.test(meterSrc);

  // source: worker は pipelineDeltaM = _confirmedRoadDelta(...) を emit する。
  const srcPipelineEmit = /pipelineDeltaM:\s*_pipelineDeltaM_now/.test(mmSrc);
  // ★L1 核心①: _confirmedRoadDelta が Viterbi 確定 snap (outSnap) を ingest に渡す。
  const srcPassesViterbiSnap =
    /const\s+_vitSnap\s*=[\s\S]{0,400}outSnap\.roadIndex/.test(mmSrc) &&
    /tk\.ingest\(\{[\s\S]{0,300}snap:\s*_vitSnap/.test(mmSrc);
  // ★L1 核心②: pipeline-distance.ingest が Viterbi 確定 snap (= sample.snap) がある時
  //   greedy SnapCache.snap を ★呼ばない★ (= greedy 寄与残存ゼロ)。
  //   ★2026-06-06: smoothedRawMode 追加で ingest 本体を _core(cur) に抽出したため
  //   変数名が sample.snap → cur.snap に変わった (cur === ingest の sample・配線は同一)。両許容。
  const pipelineUsesExternalSnap =
    /const\s+ext\s*=\s*(sample|cur)\.snap/.test(pdSrc) &&
    /ext\.roadIndex[\s\S]{0,400}snapLat:\s*ext\.snapLat/.test(pdSrc);

  // ★旧 false-green 検出器: greedy per-point snap 生値が距離源として残っていないこと★
  //   (= _pipelineDeltaM_now = _ing.deltaM 直結という旧 greedy 経路が存在しない)。
  const srcRawGreedyIngest = /_pipelineDeltaM_now\s*=\s*_ing\.deltaM/.test(mmSrc);

  // 旧 Viterbi mmIncrementM dead-code 検出 (= 配線前は距離未接続だった指標・記録用)。
  const meterAddsMmIncrement = /distance_m\s*\+=\s*[^;\n]*\bmmIncrementM\b/.test(meterSrc);

  return {
    sink_pipeline_add_present: sinkPipelineAdd, // 期待 true (sink 存在)
    sink_delta_from_pipelineDeltaM: sinkDeltaFromPipeline, // 期待 true
    src_worker_emits_pipelineDeltaM: srcPipelineEmit, // 期待 true
    // ★L1 配線後の GREEN 条件: source が Viterbi 確定 snap を距離計算へ渡す。
    src_confirmedRoadDelta_passes_viterbi_snap: srcPassesViterbiSnap, // 期待 true
    src_pipeline_ingest_uses_external_viterbi_snap: pipelineUsesExternalSnap, // 期待 true
    // ★greedy per-point snap 生値直結が残っていないこと (= greedy 寄与残存ゼロ)。
    src_pipelineDeltaM_from_greedy_ingest: srcRawGreedyIngest, // 期待 false
    // 旧 mmIncrementM 加算経路 (= 距離未接続だった旧式) は引き続き不在 (= 二重加算なし)。
    meter_adds_mmIncrement_to_distance: meterAddsMmIncrement, // 期待 false
  };
}

// ── ゲート本体 ──
function runGate(opts) {
  opts = opts || {};
  const pref = (opts.pref || process.env.ROADS_PREF || DEFAULT_PREF).toLowerCase();
  const samples = loadFixture();

  let raw = 0;
  for (let i = 1; i < samples.length; i++) {
    raw += haversineM(samples[i - 1].lat, samples[i - 1].lng, samples[i].lat, samples[i].lng);
  }

  const prod = runProdPipeline(pref, samples);
  const dec = loadDecoderStandalone(pref);
  const flips = analyzeGreedyFlips(dec, samples);
  const creep = analyzeStationaryCreep(flips.PD, dec, samples);
  const fareSep = analyzeFareAndSeparation(prod.Meter, prod);
  const wiring = analyzeWiringStatic();

  // ── 判定 ──
  // (a) 距離精度: meter.state.distance_m (= 距離駆動 sink の最終値) が ±3% 帯内か。
  const distM = prod.meter_distance_m;
  const a_pass = distM >= DIST_MIN_M && distM <= DIST_MAX_M;

  // ★★2026-06-06 に 距離の物差しが 変わりました（指示役の裁定③・2026-08-28）★★
  //   旧 … 道路の当てはめ（Viterbi確定snap）で距離を出す
  //   新 … ★平滑した生GPSの弦★で距離を出す（js/pipeline-distance.js:257・司さん裁定
  //         「生GPS寄せ+過大対策」／同:271 smoothedRawMode: true）
  //   ⇒ ★ON（今）では Viterbi を距離に使わないのが 正しい姿★です。
  //     なので (b)(c)（＝Viterbi 配線が生きているか）を ON で見ると ★正しいのに赤★になります。
  //   ⇒ ★消しません。モードで 見る物を 分けます。★
  //     ・ON（今）… (b)(c) は見ない。代わりに ★「Viterbi を距離に使っていない事」★ を1つ見る。
  //     ・OFF ……… (b)(c) を 今までどおり見る（★戻すのは この1行だけ★と設計に書いてある）。

  // (b) flip ≈ 0 — ★実距離源 (Viterbi 確定 snap 駆動 tracker) での「余計な弦ゼロ」を判定する★。
  //   タスク核心「過大の正体 = 別道路 flip の余計な弦」の真の品質指標は・距離源が ★偽遷移由来の
  //   直線弦を距離に入れていないこと★ = straightSegs===0 かつ straightFallbackM===0。
  //   ★roadIndex 変化回数 (flip_diff_road_total) は roads-ehime の OSM way 分割 (1 物理道路 = ~100 way)
  //   により実走で数十が下限 = 距離精度に無関係 = 判定に使わない (記録のみ)。★
  //   実距離源の内訳は worker の pipeline tracker (getPipelineBreakdown) から取得した実値。
  const srcBd = prod.pipelineBreakdown && prod.pipelineBreakdown.breakdown;
  const srcSt = prod.pipelineBreakdown && prod.pipelineBreakdown.stats;
  const src_straightFallbackM = srcBd ? srcBd.straightFallbackM : null;
  const src_straightSegs = srcSt ? srcSt.straightSegs : null;
  const src_viterbiSnaps = srcSt ? srcSt.viterbiSnaps || 0 : 0;
  const src_flipRejected = srcSt ? srcSt.flipRejected || 0 : 0;
  // GREEN: 実距離源で偽遷移由来の直線弦寄与がゼロ (= 連結性ハード拘束が全 flip を arc 化/棄却した)。
  const b_pass_off =
    srcBd != null &&
    srcSt != null &&
    src_straightFallbackM === 0 &&
    src_straightSegs === 0 &&
    src_viterbiSnaps > 0; // 距離源が Viterbi 確定 snap で駆動されている裏付け
  // ★ON（今）の正しい姿 = Viterbi を距離に使っていない★（使っていたら 二重の物差しになる）
  const b_pass_on = srcSt != null && src_viterbiSnaps === 0;
  const b_pass = SMOOTHED_ON ? b_pass_on : b_pass_off;

  // (c) 配線完全性: 距離駆動 source が Viterbi 確定経路 (outSnap) に一本化されているか。
  //   ★L1 配線後の GREEN★ = sink 存在 + worker emit + _confirmedRoadDelta が Viterbi 確定 snap を
  //   ingest へ渡す + pipeline-distance が sample.snap (Viterbi) で greedy SnapCache を bypass +
  //   greedy 生値直結 (_ing.deltaM) が残っていない。
  const wiringComplete =
    wiring.sink_pipeline_add_present &&
    wiring.sink_delta_from_pipelineDeltaM &&
    wiring.src_worker_emits_pipelineDeltaM &&
    wiring.src_confirmedRoadDelta_passes_viterbi_snap === true &&
    wiring.src_pipeline_ingest_uses_external_viterbi_snap === true &&
    wiring.src_pipelineDeltaM_from_greedy_ingest === false; // ★greedy 生値直結残存ゼロ
  // 動的裏付け①: 距離 sink (meter_distance_m) == 受信 pipelineDeltaM 総和 (= 単一経路で他経路混入ゼロ)。
  const dynamicSingleSource = Math.abs(prod.meter_distance_m - prod.sumPipelineDeltaM) < 1.0;
  // 動的裏付け②: 実距離源 tracker が Viterbi 確定 snap で駆動されている (viterbiSnaps > 0)。
  const dynamicViterbiDriven = src_viterbiSnaps > 0;
  // ★ON（今）★ … Viterbi 駆動である事は 求めません（使わないのが正しい姿）。
  //   ★求めるのは「距離が 1本の経路だけで動いている事」★（他の経路が混ざっていない）。
  //   ★OFF★ … 昔どおり Viterbi 配線が生きている事まで求めます。
  const c_pass = SMOOTHED_ON
    ? wiringComplete && dynamicSingleSource
    : wiringComplete && dynamicSingleSource && dynamicViterbiDriven;

  // (d) creep=0 / calcFare 不変 / 業務 vs trip 分離 (= 不変項目)。
  const creepOk = creep.creep_distance_m <= CREEP_MAX_M;
  const fareOk = fareSep.fareChecks.f1000 === 1300 && fareSep.fareChecks.f8390 === 3100;
  const separationOk =
    fareSep.separation.are_distinct_fields &&
    typeof prod.meter_distance_m === 'number' &&
    typeof prod.meter_business_distance_m === 'number';
  const d_pass = creepOk && fareOk && separationOk;

  const result = {
    pref,
    fixture: FIXTURE_NAME,
    samples: samples.length,
    raw_haversine_m: +raw.toFixed(1),
    tire_truth_m: TIRE_TRUTH_M,
    tolerance_band_m: [+DIST_MIN_M.toFixed(1), +DIST_MAX_M.toFixed(1)],

    // (a)
    a_distance_accuracy: {
      pass: a_pass,
      meter_distance_m: +distM.toFixed(1),
      error_m: +(distM - TIRE_TRUTH_M).toFixed(1),
      error_pct: +(((distM - TIRE_TRUTH_M) / TIRE_TRUTH_M) * 100).toFixed(2),
    },
    // ★認定バンド (片公差 −4%〜0%・過大ゼロ) = A1 合否★。pre-A1 は +1.18% 過大で over_ok=false (RED)。
    cert_band: {
      // 過大側ゼロ: distance_m ≤ 真値 (1m も超えない)。現コードは 8489>8390 で false。
      over_ok: distM <= CERT_OVER_MAX_M + 0.0001,
      // 過少側 ≥ −4%: distance_m ≥ 真値×0.96。A1 が削り過ぎて真値割れしないことの裏取り。
      under_ok: distM >= CERT_UNDER_MIN_M - 0.0001,
      over_max_m: +CERT_OVER_MAX_M.toFixed(1),
      under_min_m: +CERT_UNDER_MIN_M.toFixed(1),
      meter_distance_m: +distM.toFixed(1),
      error_pct: +(((distM - TIRE_TRUTH_M) / TIRE_TRUTH_M) * 100).toFixed(2),
      // 認定 PASS = 過大ゼロ かつ 過少 −4% 以内 (= A1 land 後に true 化する想定)。
      pass: distM <= CERT_OVER_MAX_M + 0.0001 && distM >= CERT_UNDER_MIN_M - 0.0001,
    },
    // (b) ★実距離源 (Viterbi 確定 snap 駆動) の「余計な弦ゼロ」が真の品質指標★
    b_flip: {
      pass: b_pass,
      // ── 実距離源 (Viterbi 確定 snap 駆動 tracker) の実内訳 (= 判定根拠) ──
      source_straightFallback_m: src_straightFallbackM, // ★偽遷移由来の直線弦寄与 (期待 0)
      source_straightSegs: src_straightSegs, // ★直線 fallback 区間数 (期待 0)
      source_flipRejected_segs: src_flipRejected, // 連結性拘束が棄却し arc 化した偽 flip 数 (= 弦化を防いだ件数)
      source_viterbi_snaps: src_viterbiSnaps, // 距離源が Viterbi 確定 snap で駆動された点数 (期待 >0)
      source_breakdown: srcBd,
      // ── 参考: greedy SnapCache 生値の roadIndex 変化数 (= 距離源ではない・記録のみ) ──
      //   roads-ehime の OSM way 分割で構造的に数十になる (距離精度に無関係)。
      ref_greedy_flip_diff_road_total: flips.flip_diff_road_total,
      ref_greedy_flip_badflip: flips.flip_badflip,
      ref_greedy_breakdown: flips.breakdown,
    },
    // (c) ★配線完全性: 距離源 = Viterbi 確定 snap・greedy 生値寄与ゼロ★
    c_wiring: {
      pass: c_pass,
      wiring_complete: wiringComplete,
      dynamic_single_source: dynamicSingleSource,
      dynamic_viterbi_driven: dynamicViterbiDriven, // ★距離源 tracker が Viterbi 確定 snap で駆動
      static: wiring,
      sum_pipelineDeltaM_m: +prod.sumPipelineDeltaM.toFixed(1),
      sum_viterbi_mmIncrementM_m: +prod.sumMmIncrementM.toFixed(1),
      meter_distance_m: +prod.meter_distance_m.toFixed(1),
      committed_count: prod.committedCount,
      committed_flips: prod.committedFlips,
    },
    // (d)
    d_invariants: {
      pass: d_pass,
      creep_distance_m: +creep.creep_distance_m.toFixed(2),
      creep_max_m: CREEP_MAX_M,
      creep_stationarySkipped: creep.stationarySkipped,
      calcFare_1000m: fareSep.fareChecks.f1000,
      calcFare_8390m_truth: fareSep.fareChecks.f8390,
      calcFare_8966m_greedy_overcharge: fareSep.fareChecks.f8966,
      business_vs_trip_separation: fareSep.separation,
    },
  };

  result.smoothedRawMode = SMOOTHED_ON;
  result.gate_pass = a_pass && b_pass && c_pass && d_pass;
  // 着手時 (実装前 = greedy 駆動・Viterbi 死蔵) では (a)(b)(c) のいずれかが FAIL だった。
  //   配線完了後は全 GREEN。trivial-green 監視は「(d) 不変が常に PASS」で担保する。
  result.all_green = a_pass && b_pass && c_pass && d_pass;
  return result;
}

function main() {
  const r = runGate({});
  console.log(
    '=== ★STEP0 ゲート: 通った道の正確な距離 (iPhone13 / ehime / タイヤ真値 8.39km)★ ===\n'
  );
  console.log('  samples=' + r.samples + '  raw_haversine=' + r.raw_haversine_m + 'm');
  console.log(
    '  真値(タイヤ)=' +
      r.tire_truth_m +
      'm  許容帯=[' +
      r.tolerance_band_m[0] +
      ', ' +
      r.tolerance_band_m[1] +
      '] m (±3%)\n'
  );

  console.log(
    '(a) 距離精度       : ' +
      (r.a_distance_accuracy.pass ? 'PASS' : 'FAIL') +
      '  distance_m=' +
      r.a_distance_accuracy.meter_distance_m +
      'm (' +
      (r.a_distance_accuracy.error_pct >= 0 ? '+' : '') +
      r.a_distance_accuracy.error_pct +
      '% / ' +
      (r.a_distance_accuracy.error_m >= 0 ? '+' : '') +
      r.a_distance_accuracy.error_m +
      'm)'
  );
  console.log(
    (SMOOTHED_ON ? '(b) Viterbiを距離に使っていない: ' : '(b) flip≈0(余計な弦): ') +
      (r.b_flip.pass ? 'PASS' : 'FAIL') +
      '  実距離源 straightFallback=' +
      r.b_flip.source_straightFallback_m +
      'm  直線区間=' +
      r.b_flip.source_straightSegs +
      '  偽flip棄却(arc化)=' +
      r.b_flip.source_flipRejected_segs +
      '  Viterbi確定snap=' +
      r.b_flip.source_viterbi_snaps +
      '  [参考greedy roadIndex変化=' +
      r.b_flip.ref_greedy_flip_diff_road_total +
      ' (OSM way分割で構造的・距離無関係)]'
  );
  console.log(
    (SMOOTHED_ON ? '(c) 配線完全性(ONでは参考): ' : '(c) 配線完全性     : ') +
      (r.c_wiring.pass ? 'PASS' : 'FAIL') +
      '  距離源=Viterbi確定snap(' +
      (r.c_wiring.static.src_confirmedRoadDelta_passes_viterbi_snap &&
      r.c_wiring.static.src_pipeline_ingest_uses_external_viterbi_snap
        ? 'OK'
        : 'NG') +
      ')  greedy生値残存=' +
      (r.c_wiring.static.src_pipelineDeltaM_from_greedy_ingest ? 'あり★' : 'なし') +
      '  Viterbi駆動=' +
      r.c_wiring.dynamic_viterbi_driven +
      '  単一source=' +
      r.c_wiring.dynamic_single_source
  );
  console.log(
    '      Σpipelineδ=' +
      r.c_wiring.sum_pipelineDeltaM_m +
      'm (=meter距離・Viterbi確定snap駆動)  ΣViterbi mmIncrement(commit chain参考)=' +
      r.c_wiring.sum_viterbi_mmIncrementM_m +
      'm'
  );
  console.log(
    '(d) 不変項目       : ' +
      (r.d_invariants.pass ? 'PASS' : 'FAIL') +
      '  creep=' +
      r.d_invariants.creep_distance_m +
      'm (<=' +
      r.d_invariants.creep_max_m +
      ')  calcFare(1000)=' +
      r.d_invariants.calcFare_1000m +
      ' calcFare(8390)=' +
      r.d_invariants.calcFare_8390m_truth +
      '  business分離=' +
      r.d_invariants.business_vs_trip_separation.are_distinct_fields
  );

  console.log(
    '(cert) 認定バンド −4%〜0%: ' +
      (r.cert_band.pass ? 'PASS' : 'FAIL (A1 待ち)') +
      '  distance_m=' +
      r.cert_band.meter_distance_m +
      'm (' +
      (r.cert_band.error_pct >= 0 ? '+' : '') +
      r.cert_band.error_pct +
      '%)  過大側ゼロ=' +
      (r.cert_band.over_ok ? 'OK' : '★NG (過大課金)★') +
      '  過少側≥−4%=' +
      (r.cert_band.under_ok ? 'OK' : 'NG (過少)') +
      '  [帯 ' +
      r.cert_band.under_min_m +
      '〜' +
      r.cert_band.over_max_m +
      'm]'
  );

  console.log('\n=== GATE: ' + (r.gate_pass ? 'PASS' : 'FAIL') + ' ===');
  console.log(
    r.smoothedRawMode
      ? '★今は smoothedRawMode = true（平滑した生GPSの弦で距離を出す・2026-06-06 司さん裁定）★\n' +
          '  ⇒ ★(b)(c) は「Viterbi を距離に使っていない事」で見ています★（使っていたら 物差しが二重）。\n' +
          '  ⇒ false に戻したら (b)(c) は 昔どおり「Viterbi 配線が生きているか」で見ます。\n' +
          '  ⇒ 戻すのは js/pipeline-distance.js:271 の1行だけ（設計にそう書いてあります）。'
      : '★今は smoothedRawMode = false（道路の当てはめで距離を出す）★＝(b)(c) は 昔どおりの見方です。'
  );
  console.log('配線完了後 (a)(b)(c)(d) 全 GREEN: ' + (r.all_green ? 'YES ✓' : 'NO ✗ (要確認)'));

  const OUT_DIR = path.join(__dirname, '..', 'data', 'test-results');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'gate-road-distance.json'), JSON.stringify(r, null, 2));
  console.log('\n[gate] wrote data/test-results/gate-road-distance.json');

  // CLI exit code: 配線完了後は GATE PASS で exit 0。FAIL は exit 1。
  if (r.gate_pass) process.exit(0);
  process.exit(1);
}

if (require.main === module) main();

module.exports = {
  runGate,
  TIRE_TRUTH_M,
  DIST_MIN_M,
  DIST_MAX_M,
  FLIP_TOTAL_MAX,
  FLIP_BADFLIP_MAX,
  CREEP_MAX_M,
  CERT_OVER_MAX_M,
  CERT_UNDER_MIN_M,
};
