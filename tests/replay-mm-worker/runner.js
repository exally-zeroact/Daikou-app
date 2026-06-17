// tests/replay-mm-worker/runner.js (Phase 1 基盤・2026-05-21・rev2 計測方法修正)
// ★設計変更宣言 Phase 1 (2026-05-21・rev2):
//   旧 rev1: GPS を Worker B に直接 postMessage・末尾 flush なし・state.distance_m 未集約
//   新 rev2: 実 js/meter.js も harness で起動し・Meter.update → Worker B の prod 経路で動かす。
//           末尾で実 Meter.businessEnd() を呼んで Worker B に reset (= Viterbi flush) を送り
//           未確定 tail を確定 commit させる。distance_m += 5 経路 (= L440/L514/L961/L979/L1365)
//           はすべて Meter 内で発火・最終 state.distance_m で全距離出力を集約できる。
//   絶対前提: 実コードを通す・再実装禁止・課金 5 経路は不変・mock は GPS.calcDistance 等の
//             外部 helper のみ (= meter.js が globalThis.GPS を要求するため最小スタブ)。
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { createMapMatcherWorker } = require('./worker-sim');
const {
  createPrng,
  applyNoise,
  generateAccelSamples,
  defaultAccelConfigStationary,
  defaultAccelConfigMoving,
} = require('./noise-model');

const JS_DIR = path.join(__dirname, '..', '..', 'js');

// ──────────────────────────────────────────────────────────────
// 実 js/meter.js を vm context で load (= tests/meter-mm-priority.js と同パターン)
// ──────────────────────────────────────────────────────────────
function loadMeter(opts) {
  opts = opts || {};
  // ハバーサイン距離 (meter.js が globalThis.GPS.calcDistance / calcDistance3D を要求)
  const haversineM = function (lat1, lng1, lat2, lng2) {
    if (lat1 === lat2 && lng1 === lng2) return 0;
    const R = 6371000,
      tr = Math.PI / 180;
    const dLat = (lat2 - lat1) * tr;
    const dLng = (lng2 - lng1) * tr;
    const a =
      Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * tr) * Math.cos(lat2 * tr) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };
  const ctx = {
    console: opts.debug ? console : { log() {}, warn() {}, error() {} },
    Date,
    Math,
    JSON,
    Map,
    Set,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
    ArrayBuffer,
    DataView,
    Buffer,
    Promise,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    performance: { now: () => Date.now() },
    dlog: () => {},
    GPS: {
      calcDistance: haversineM,
      calcDistance3D: (la, lo, _, lb, lob) => haversineM(la, lo, lb, lob),
      setRoadType: () => {},
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  // ★随伴車別 k 注入 (opt-in・テスト用)★: meter.js は window.DK_VEHICLE_PROFILE.k を _resolveVK で読む。
  //   opts.vehicleProfile 未指定なら従来通り (profile 不在 → k=1.0 恒等 = byte 不変)。
  if (opts.vehicleProfile && typeof opts.vehicleProfile === 'object') {
    ctx.DK_VEHICLE_PROFILE = opts.vehicleProfile;
  }
  vm.createContext(ctx);
  const meterSrc =
    fs.readFileSync(path.join(JS_DIR, 'meter.js'), 'utf8') + '\n;globalThis.Meter = Meter;\n';
  vm.runInContext(meterSrc, ctx, { filename: 'js/meter.js' });
  return ctx.Meter;
}

// Meter ↔ Worker B 連携 adapter
// Meter は workerLike (= addEventListener('message', h) / postMessage(msg)) を要求
function createMeterWorkerAdapter(workerSim) {
  const handlers = [];
  workerSim.on((e) => {
    for (const h of handlers) h(e);
  });
  return {
    addEventListener(type, h) {
      if (type === 'message') handlers.push(h);
    },
    removeEventListener(type, h) {
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    },
    postMessage(msg) {
      workerSim.sendMessage(msg);
    },
  };
}

// ──────────────────────────────────────────────────────────────
// ground_truth segments → 真値 trace 生成
// ──────────────────────────────────────────────────────────────
function buildTrueTrace(segments, decoder, precision) {
  const trace = [];
  for (const seg of segments) {
    const road = decoder.decodeRoadAt(seg.roadIndex);
    if (!road || !road.points || seg.segmentIndex >= road.points.length - 1) {
      throw new Error(
        '[runner] invalid segment: roadIndex=' + seg.roadIndex + ' segmentIndex=' + seg.segmentIndex
      );
    }
    const pA = road.points[seg.segmentIndex];
    const pB = road.points[seg.segmentIndex + 1];
    const aLat = pA[0] / precision;
    const aLng = pA[1] / precision;
    const bLat = pB[0] / precision;
    const bLng = pB[1] / precision;
    const tStart = seg.t_start != null ? seg.t_start : 0;
    const tEnd = seg.t_end != null ? seg.t_end : 1;
    const n = seg.num_samples != null ? seg.num_samples : 3;
    // ★ Phase 1 残り 4 fixture (2026-05-21): t_start > t_end で逆方向 trace 対応
    //   U-turn fixture (= 同 road 上で 180度反転) で・復路 ground_truth を表現するため
    const isReverse = tStart > tEnd;
    const heading = isReverse
      ? segmentBearing(bLat, bLng, aLat, aLng)
      : segmentBearing(aLat, aLng, bLat, bLng);
    for (let i = 0; i < n; i++) {
      const t = tStart + ((tEnd - tStart) * i) / Math.max(1, n - 1);
      const lat = aLat + t * (bLat - aLat);
      const lng = aLng + t * (bLng - aLng);
      trace.push({
        trueLat: lat,
        trueLng: lng,
        trueHeadingDeg: heading,
        roadIndex: seg.roadIndex,
        segmentIndex: seg.segmentIndex,
        layer: road.layer || 0,
      });
    }
  }
  return trace;
}

function segmentBearing(latA, lngA, latB, lngB) {
  const tr = Math.PI / 180;
  const y = Math.sin((lngB - lngA) * tr) * Math.cos(latB * tr);
  const x =
    Math.cos(latA * tr) * Math.sin(latB * tr) -
    Math.sin(latA * tr) * Math.cos(latB * tr) * Math.cos((lngB - lngA) * tr);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000,
    tr = Math.PI / 180;
  const dLat = (lat2 - lat1) * tr;
  const dLng = (lng2 - lng1) * tr;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * tr) * Math.cos(lat2 * tr) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcExpectedDistanceM(segments, decoder, precision) {
  // ★ Phase 1 残り 4 fixture (2026-05-21・U-turn / reverse-oneway 対応):
  //   t_start > t_end (= 逆方向 trace) でも・実走距離は **絶対値** で加算する
  //   (= 全加算ルール: 逆走でも distance accrue する物理走行距離)
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
    const segLen = haversineM(aLat, aLng, bLat, bLng);
    total += segLen * Math.abs(tEnd - tStart);
  }
  return total;
}

// ──────────────────────────────────────────────────────────────
// runReplay main (= rev2・実 Meter 経路 + 末尾 flush)
// ──────────────────────────────────────────────────────────────
async function runReplay(fixture, prefRoadsData, options) {
  options = options || {};
  const startTs = options.startTimestamp || 1714000000000;
  const intervalMs = options.gpsIntervalMs || 1000;

  // 1. main side decoder (= ground_truth 探索 + 期待距離計算)
  const decSrc = fs.readFileSync(path.join(JS_DIR, 'roads-decoder.js'), 'utf8');
  const decCtx = {
    window: {},
    Buffer,
    Uint8Array,
    Uint32Array,
    performance: { now: () => Date.now() },
  };
  vm.createContext(decCtx);
  vm.runInContext(decSrc, decCtx, { filename: 'js/roads-decoder.js' });
  const RoadDecoder = decCtx.window.RoadDecoder;
  const mainDec = new RoadDecoder(prefRoadsData);
  mainDec.buildOffsetTable();

  // 2. ground_truth 真値 trace + 期待距離
  const trueTrace = buildTrueTrace(
    fixture.meta.ground_truth_segments,
    mainDec,
    prefRoadsData.precision
  );
  const expectedDistanceM =
    fixture.meta.expected_distance_m != null
      ? fixture.meta.expected_distance_m
      : calcExpectedDistanceM(fixture.meta.ground_truth_segments, mainDec, prefRoadsData.precision);

  // 3. 合成 GPS samples 生成 (= noise model 適用)
  //    ★ Phase 1 残り 4 fixture (2026-05-21):
  //    fixture.meta.stationary_step_indices (= step 番号 array) があれば・該当 step を
  //    強制 stationary (= speedKmh=0 / isStationary=true) で生成 (= low-speed-stop fixture 用)。
  //    ground_truth 側は・停車区間の lat/lng を同一座標で表現する (= t_start=t_end 等)。
  const baseSeed = (fixture.meta.noise_model && fixture.meta.noise_model.seed) || 42;
  const prng = createPrng(baseSeed);
  // ★ Phase 4 fidelity (2026-05-21): accel 用 prng を分離 (= GPS trace 変動防止)
  //   既存 fixture の baseline (= seed 42 等) を不変に保つため・accel 追加で GPS prng の
  //   消費数を変えない設計。base_seed+1000 で独立 stream。
  const accelPrng = createPrng(baseSeed + 1000);
  const stationarySet = new Set((fixture.meta.stationary_step_indices || []).map(Number));
  const gpsSamples = trueTrace.map((tp, i) => {
    const isStationaryStep = stationarySet.has(i);
    const sample = applyNoise(
      {
        trueLat: tp.trueLat,
        trueLng: tp.trueLng,
        trueHeadingDeg: tp.trueHeadingDeg,
        trueSpeedKmh: isStationaryStep
          ? 0
          : fixture.meta.true_speed_kmh != null
            ? fixture.meta.true_speed_kmh
            : 40,
      },
      prng,
      fixture.meta.noise_model || {}
    );
    sample.timestamp = startTs + i * intervalMs;
    if (isStationaryStep) {
      sample.speedKmh = 0; // 強制 (= noise が drift させても 0 維持)
      sample.isStationary = true;
    } else {
      sample.isStationary = sample.speedKmh < 3;
    }
    // ★ Phase 4 fidelity (2026-05-21): realistic 合成 accelSamples 追加
    //   gps-worker.js 3-AND gate (= C-1 variance + C-2 deviation) を実機相当で動かす
    //   ゼロ完全静止は禁止・実機相当 std で deterministic noise
    if (fixture.meta.synthesize_accel !== false) {
      const accelCfg = isStationaryStep
        ? defaultAccelConfigStationary()
        : defaultAccelConfigMoving();
      sample.accelSamples = generateAccelSamples(sample.timestamp, accelPrng, accelCfg, 5);
    }
    return sample;
  });

  // 4. 実 Worker B 起動 + ehime data load
  //    ★ phase 分離: gps phase (= Meter.update 経由)・flush phase (= Meter.businessEnd 経由)
  //    Worker B reset で発火する 追加 mmResult は flush phase に振り分け・gt との照合からは除外。
  //    distance は Meter.state.distance_m に集約されるため scoring からは抜けない。
  //
  // ★設計変更宣言 (2026-05-28・新構造対応): options.useGpsWorker=true で実 gps-worker.js を
  //   挿入し isStationary を「runner 側 speedKmh<3 注入」 → 「実 worker (Fix① accel主体) 判定」 に
  //   置換する。worker reject 時は Meter.update を呼ばない (= 実機 gps.js が onUpdateCallback を
  //   呼ばないのと同じ・凍結を再現)。既定 false で既存 index.test.js は不変。
  let gpsWorker = null;
  if (options.useGpsWorker) {
    const { createGpsWorker } = require('../worker/gps-worker-sim');
    gpsWorker = createGpsWorker({ debug: !!options.debug });
    gpsWorker.sendMessage({
      type: 'init',
      data: { config: options.gpsWorkerConfig || {}, debug: !!options.debug },
    });
  }
  const worker = createMapMatcherWorker({ debug: !!options.debug });
  let currentPhase = 'init'; // init / gps / flush
  const mmResults = []; // gps phase の mmResult のみ
  const mmResultsFlush = []; // flush phase の mmResult (= businessEnd 後)
  let roadsLoaded = false;
  worker.on((e) => {
    const m = e.data;
    if (!m) return;
    if (m.type === 'mmResult') {
      if (currentPhase === 'flush') mmResultsFlush.push(m);
      else mmResults.push(m);
    }
    if (m.type === 'roadsLoaded') roadsLoaded = m.ok;
  });

  // 5. 実 Meter 起動 + adapter 経由で Worker B 連携 (= prod 経路)
  //    ★順序重要: setMapMatcher を loadRoads より先に呼ぶ。Meter は B1 設計で
  //    roadsLoaded ack を adapter 経由で受信して初めて _workerLoadedPrefs を更新する
  //    (= meter.js L1061 の guard `if (mmWorker && _workerLoadedPrefs.size > 0)`)。
  //    setMapMatcher が後だと・loadRoads の roadsLoaded postMessage を Meter が捕捉できず・
  //    Meter.update(gps) が Worker B に postMessage を発火しない → mmResults 全件 0 になる。
  const Meter = loadMeter({ debug: !!options.debug });
  Meter.setFareConfig({
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
  });
  Meter.reset();
  const adapter = createMeterWorkerAdapter(worker);
  Meter.setMapMatcher(adapter);

  // iOS mode (= Viterbi N=10) + loadRoads を adapter 経由で送信 (= Meter が roadsLoaded を捕捉できる)
  if (options.platform !== 'android') {
    adapter.postMessage({ type: 'configPlatform', isIOS: true });
  }
  adapter.postMessage({
    type: 'loadRoads',
    pref: prefRoadsData.prefecture,
    roadsData: prefRoadsData,
  });
  if (!roadsLoaded) {
    throw new Error('[runner] loadRoads failed for pref=' + prefRoadsData.prefecture);
  }

  // setBusinessActive で business_distance_m 加算 gate を開ける (= prod の Business.start 経路)
  if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
  Meter.start();
  // test 用 escape hatch: drain (= 500ms) と Off-Road grace (= 5秒) を即時無効化
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);

  // 6. GPS dispatch via Meter.update (= prod 経路・Meter が Worker B に postMessage)
  //    diagnostic: captureStateSnapshots option で・各 step 前後の state.* を snapshot
  //    観測専用 (= Meter / Worker のロジックは一切改変せず・state を read するのみ)
  currentPhase = 'gps';
  // committedSnaps を gpsSamples と 1:1 で揃える (= 停車 step や Meter.update guard で
  // mmResult が来ない step は null を入れる)
  //   理由: prod では isStationary=true の GPS は・meter.js L1054 で return ・Worker B に
  //   postMessage されない (= 停車中の Worker 起動を抑止する設計)。その結果 mmResults.length
  //   < gpsSamples.length になり・gt との 1:1 照合が崩れる。
  const committedSnapsByStep = [];
  const stateSnapshots = []; // [{ step, before, after, delta, mmResultIdx }]
  function _readState() {
    const s = Meter.getState();
    return {
      distance_m: s.distance_m,
      mm_distance_m: s.mm_distance_m || 0,
      offroad_distance_m: s.offroad_distance_m || 0,
      gap_fill_total_m: s.gap_fill_total_m || 0,
      gap_fill_count: s.gap_fill_count || 0,
      offroad_count: s.offroad_count || 0,
      _offRoadActive: s._offRoadActive,
      distanceSource: s.distanceSource,
    };
  }
  for (let stepIdx = 0; stepIdx < gpsSamples.length; stepIdx++) {
    const g = gpsSamples[stepIdx];
    const before = options.captureStateSnapshots ? _readState() : null;
    const mmCountBefore = mmResults.length;
    // ★useGpsWorker (2026-05-28・新構造): 実 gps-worker.js を挿入し isStationary を実判定に置換
    let meterInput;
    let workerRejected = false;
    if (gpsWorker) {
      const nBefore = gpsWorker.getResults().length;
      gpsWorker.sendMessage({
        type: 'position',
        data: {
          lat: g.lat,
          lng: g.lng,
          accuracy: g.accuracy,
          speedKmh: g.speedKmh,
          heading: g.headingDeg != null ? g.headingDeg : null,
          altitude: 0,
          now: g.timestamp,
          compassHeading: null,
          accelData: null,
          accelSamples: g.accelSamples || [],
          gyroData: null,
          gyroSamples: [],
          speedSrc: g.speedSrc || 'dop',
        },
      });
      const results = gpsWorker.getResults();
      if (results.length > nBefore) {
        const wOut = results[results.length - 1];
        meterInput = {
          lat: wOut.lat,
          lng: wOut.lng,
          accuracy: wOut.accuracy != null ? wOut.accuracy : g.accuracy,
          speedKmh: wOut.speedKmh != null ? wOut.speedKmh : g.speedKmh,
          headingDeg: g.headingDeg,
          altitude: 0,
          timestamp: g.timestamp,
          isStationary: wOut.isStationary, // ★実 Fix① 判定結果
          accelSamples: g.accelSamples || null,
        };
      } else {
        // gps-worker が reject (= accuracy/jump/accel/Doppler-sanity ゲートで弾く)
        // → Meter.update を呼ばない (= 実機 gps.js が onUpdateCallback を呼ばないのと同じ)
        workerRejected = true;
      }
    } else {
      meterInput = {
        lat: g.lat,
        lng: g.lng,
        accuracy: g.accuracy,
        speedKmh: g.speedKmh,
        headingDeg: g.headingDeg,
        altitude: 0,
        timestamp: g.timestamp,
        isStationary: g.isStationary,
        accelSamples: g.accelSamples || null,
      };
    }
    if (!workerRejected) {
      Meter.update(meterInput);
    }
    // step ごとに・mmResult が増えていれば最新の committed snap を採用・なければ null
    if (mmResults.length > mmCountBefore) {
      const m = mmResults[mmResults.length - 1];
      if (m.snapped && m.snap && m.committed) {
        committedSnapsByStep.push({
          roadIndex: m.snap.roadIndex,
          segmentIndex: m.snap.segmentIndex,
          lat: m.snap.snapLat,
          lng: m.snap.snapLng,
          layer: m.snap.layer != null ? m.snap.layer : 0,
          prefecture: m.snap.prefecture,
          _mmIncrement: m.mmIncrementM,
        });
      } else {
        committedSnapsByStep.push(null);
      }
    } else {
      committedSnapsByStep.push(null); // mmResult なし (= 停車 / drain / guard で skip)
    }
    if (options.captureStateSnapshots) {
      const after = _readState();
      // 経路推定: state フィールドの delta から逆引き
      //   L440 Tier1 commit       = mm_distance_m delta が distance_m delta と同額の部分
      //   L514 retroactive Off-R  = Off-Road 初回起動 step での offroad_distance_m 大幅 delta
      //   L961 gap-fill           = gap_fill_total_m delta
      //   L979 Off-Road incremental = Off-Road 中継続 step の offroad_distance_m delta
      //   L1365 setDistance       = (test では呼ばない・常に 0)
      const dDist = after.distance_m - before.distance_m;
      const dMm = after.mm_distance_m - before.mm_distance_m;
      const dOff = after.offroad_distance_m - before.offroad_distance_m;
      const dGap = after.gap_fill_total_m - before.gap_fill_total_m;
      const offRoadStarted = after.offroad_count > before.offroad_count;
      stateSnapshots.push({
        step: stepIdx,
        before,
        after,
        delta: {
          distance_m: round3(dDist),
          mm_distance_m: round3(dMm),
          offroad_distance_m: round3(dOff),
          gap_fill_total_m: round3(dGap),
        },
        offRoadStarted,
        mmResultsConsumed: mmResults.length - mmCountBefore,
      });
    }
  }

  // 7. ★末尾 flush (= 実 Meter.businessEnd → Worker B に reset → Viterbi 未確定 tail を確定)
  //    これで未確定 commit が mmResult として返り・distance_m に最終加算される
  currentPhase = 'flush';
  Meter.businessEnd();

  // 8. committed snap chain 抽出 + 最終 state 取得
  //    ★ step ごとに 1:1 で対応する committedSnapsByStep を採用 (= 停車 step null 含む)
  const committedSnaps = committedSnapsByStep;

  // first_commit_step (= warmup boundary)
  let firstCommitStep = -1;
  for (let i = 0; i < committedSnaps.length; i++) {
    if (committedSnaps[i] != null) {
      firstCommitStep = i;
      break;
    }
  }

  // committed distance: 実 Meter の最終 state.distance_m を採用 (= L440/L514/L961/L979/L1365
  // 5 経路の全集約・retroactive / gap fill / Off-Road incremental も含む)
  const finalState = Meter.getState();
  const committedDistanceM = finalState.distance_m;
  const mmStats = typeof Meter.getMMStats === 'function' ? Meter.getMMStats() : null;

  // 5 経路別累積 (= 最終 state から逆引き・diagnostic 用)
  const breakdown = {
    L440_tier1_commit_m: round3(
      finalState.distance_m -
        (finalState.offroad_distance_m || 0) -
        (finalState.gap_fill_total_m || 0)
    ),
    L514_L979_offroad_m: round3(finalState.offroad_distance_m || 0),
    L961_gap_fill_m: round3(finalState.gap_fill_total_m || 0),
    L1365_setdistance_m: 0, // test では setDistance を呼ばない
    total_m: round3(finalState.distance_m),
    gap_fill_count: finalState.gap_fill_count || 0,
    offroad_count: finalState.offroad_count || 0,
  };

  return {
    fixture,
    trueTrace,
    gpsSamples,
    mmResults,
    mmResultsFlush,
    committedSnaps,
    committedDistanceM,
    expectedDistanceM,
    firstCommitStep,
    finalState,
    mmStats,
    stateSnapshots,
    breakdown,
  };
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

module.exports = {
  runReplay,
  buildTrueTrace,
  calcExpectedDistanceM,
  haversineM,
  segmentBearing,
  loadMeter,
};
