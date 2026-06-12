// tests/gate-snap-accuracy.js
// ============================================================================
//  実機3台 fixture を ★実エンジン(Worker B map-matcher 経由)★ に流し、
//  「道を正しく読めとるか(snap精度)」を ★代理指標★ で測る gate。
//  (STEP1・テストツール先行。司さんの絶対ルール準拠)
//
//  ─── ★★★ これは代理(proxy)指標である ★★★ ───────────────────────────────
//  fixture には ground-truth 道路ラベルが無い(= どの道を走ったかの正解が無い)。
//  従って「snap が正解の道か」は ★この gate では判定できない★。
//  真の判定は (a) 実機での目視/タイヤ計, (b) 人手の道路ラベル のみ。
//
//  この gate が測るのは、ラベル無しでも node 実行で観測できる代理量だけ:
//    (1) 方位整合 (heading alignment):
//          snap 済 segment の bearing と、その step の「融合 device heading」
//          (= 現状は GPS course hdg を compassHeading として供給したもの) の角度差。
//          差が小さいほど「進行方向に沿った道」に snap できている可能性が高い。
//          ★限界: GPS course 自体がノイズ源。低速で暴れる。compass/gyro 未強化の
//                  現状を測っているだけで、heading そのものの正しさは保証しない。
//    (2) snap flip-flop / off-road 逸脱:
//          連続 commit 間で roadIndex が前後に揺れ戻る回数 (A→B→A の振動)、
//          および snap 点が直前 GPS 点から離れた距離(snap residual)の分布。
//          ★限界: 別の道に「正しく」乗り換えた場合も flip に計上されうる。
//    (3) bearingJump 誤検出の代理:
//          GPS trajectory bearing 差が大(>90°)だが速度は連続(中速)な step 数。
//          gyro があれば「本当に曲がったか」を裏取りできるが現状は GPS のみ。
//          ★限界: 実旋回と multipath の区別はラベル無しでは不能。ここでは
//                  「GPS だけで方位ジャンプ判定している step 数」を可視化するに留める。
//
//  ★改善が「証明できる」設計★:
//    将来 gyro/compass を強化 (融合 heading を emission に供給) した時、同じ fixture で
//    本 gate を再実行し、(1) median/p90 heading-align 差の縮小、(2) flip 回数の減少、
//    (3) heading 供給 step 数の増加 が ★数値で見える★。
//    baseline (現状=gyro未接続/compass-Q弱) を本 gate が node 実値で出力する。
//
//  【絶対不可侵・読むだけ】 distance_m / calcFare / tier / running gate / business分離 /
//     mm-data-pipeline.js / sw.js。本 gate は Meter / Worker B を ★改変せず★ 実コードを
//     そのまま通し、state を read するのみ。distance_m は read して「不変」を確認するだけ。
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');

const { createMapMatcherWorker, loadPrefRoadsData } = require('./replay-mm-worker/worker-sim');
const { loadMeter } = require('./replay-mm-worker/runner');

const FIX_DIR = path.join(__dirname, 'fixtures');

// ─── 幾何 helper (haversine / bearing) ─────────────────────────────────────
function haversineM(lat1, lng1, lat2, lng2) {
  if (lat1 === lat2 && lng1 === lng2) return 0;
  const R = 6371000,
    tr = Math.PI / 180;
  const dLat = (lat2 - lat1) * tr;
  const dLng = (lng2 - lng1) * tr;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * tr) * Math.cos(lat2 * tr) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function bearingDeg(latA, lngA, latB, lngB) {
  const tr = Math.PI / 180;
  const y = Math.sin((lngB - lngA) * tr) * Math.cos(latB * tr);
  const x =
    Math.cos(latA * tr) * Math.sin(latB * tr) -
    Math.sin(latA * tr) * Math.cos(latB * tr) * Math.cos((lngB - lngA) * tr);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
function angleDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}
function pctl(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}
function round2(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}

// ─── Meter ↔ Worker B adapter (runner.js と同パターン) ─────────────────────
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

// ─── 実機 raw sample {acc,alt,hdg,lat,lng,spd,t} を正規化 ───────────────────
//   spd: m/s (= -1 unknown) ・ hdg: deg course over ground (= -1 unknown)
function normalizeSample(raw) {
  const spdKmh = raw.spd != null && raw.spd >= 0 ? raw.spd * 3.6 : null;
  const hdg = raw.hdg != null && raw.hdg >= 0 ? raw.hdg : null;
  return {
    lat: raw.lat,
    lng: raw.lng,
    accuracy: raw.acc != null ? raw.acc : 20,
    altitude: raw.alt != null ? raw.alt : 0,
    speedKmh: spdKmh,
    courseDeg: hdg, // GPS course over ground
    timestamp: raw.t,
  };
}

// ─── 1 fixture を実エンジンに流す ──────────────────────────────────────────
//   options.headingSource:
//     'gps-course' (default) = 現状 baseline。GPS course hdg を compassHeading として供給
//                              (= 実機で compass がある端末の emission heading 入口を再現)。
//     'none'                 = heading 完全 null (= compass 無し端末。emission 方位中立)。
//   ★将来 gyro/compass 強化版は・ここに 'fused' を足して同 fixture で比較する★
async function runFixture(fixtureName, prefRoadsData, options) {
  options = options || {};
  const headingSource = options.headingSource || 'gps-course';
  const raw = JSON.parse(fs.readFileSync(path.join(FIX_DIR, fixtureName), 'utf8'));
  const arr = Array.isArray(raw) ? raw : Object.values(raw);
  const samples = arr.map(normalizeSample);

  // 実 Worker B 起動
  const worker = createMapMatcherWorker({ debug: false });
  const mmResults = [];
  let currentPhase = 'gps';
  let roadsLoaded = false;
  worker.on((e) => {
    const m = e.data;
    if (!m) return;
    if (m.type === 'mmResult' && currentPhase === 'gps') mmResults.push(m);
    if (m.type === 'roadsLoaded') roadsLoaded = m.ok;
  });

  // 実 Meter 起動 (= prod 経路。distance_m / calcFare は不可侵・read only)
  const Meter = loadMeter({ debug: false });
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
  if (options.platform !== 'android') {
    adapter.postMessage({ type: 'configPlatform', isIOS: true });
  }
  adapter.postMessage({
    type: 'loadRoads',
    pref: prefRoadsData.prefecture,
    roadsData: prefRoadsData,
  });
  if (!roadsLoaded) throw new Error('[gate] loadRoads failed for ' + prefRoadsData.prefecture);

  if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);

  // step ごとに 1:1 で committed snap を対応づける
  const perStep = []; // { step, sample, mm, courseDeg, headingSupplied }
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const mmBefore = mmResults.length;

    // ★heading 供給: 現状 prod は compassHeading のみ emission に届く (meter.js L608/629)。
    //   baseline では GPS course を compassHeading として供給 (= compass ありの端末を再現)。
    let compassHeading = null;
    if (headingSource === 'gps-course') compassHeading = s.courseDeg;
    // 'none' は null のまま

    const meterInput = {
      lat: s.lat,
      lng: s.lng,
      accuracy: s.accuracy,
      altitude: s.altitude,
      speedKmh: s.speedKmh != null ? s.speedKmh : 0,
      compassHeading: compassHeading,
      timestamp: s.timestamp,
      isStationary: s.speedKmh != null ? s.speedKmh < 3 : false,
    };
    Meter.update(meterInput);

    let mm = null;
    if (mmResults.length > mmBefore) mm = mmResults[mmResults.length - 1];
    perStep.push({
      step: i,
      sample: s,
      mm,
      courseDeg: s.courseDeg,
      headingSupplied: compassHeading != null,
    });
  }

  // 末尾 flush (= Viterbi 未確定 tail 確定。distance 集約)
  currentPhase = 'flush';
  Meter.businessEnd();
  const finalState = Meter.getState();

  // ─── 代理指標の計算 ───────────────────────────────────────────────────
  const headingAlignDiffs = []; // (1) snap segment bearing vs supplied heading
  const snapResiduals = []; // (2b) snap 点と raw GPS 点の距離 (m)
  let committedCount = 0;
  let snappedCount = 0;
  let headingSuppliedSteps = 0;
  let bearingJumpSteps = 0; // (3) GPS-only 方位ジャンプ step

  const committedRoadSeq = []; // committed step の roadIndex 列 (flip 検出用)

  for (let i = 0; i < perStep.length; i++) {
    const ps = perStep[i];
    if (ps.headingSupplied) headingSuppliedSteps++;
    const mm = ps.mm;
    if (!mm) continue;
    if (mm.snapped) snappedCount++;
    const snap = mm.snap;
    if (mm.committed && snap && Number.isFinite(snap.snapLat)) {
      committedCount++;
      committedRoadSeq.push(snap.roadIndex);

      // (2b) snap residual: snap 点 vs raw GPS 点
      snapResiduals.push(haversineM(ps.sample.lat, ps.sample.lng, snap.snapLat, snap.snapLng));

      // (1) heading alignment: snap segment bearing vs supplied heading
      //   segment は double-direction。snap した道の bearing は forward/backward 両方ありうる
      //   ので min(diff_fwd, diff_rev) を取る (= oneway は別途 emission 内で処理済・ここは整合測定)。
      if (ps.headingSupplied && Number.isFinite(snap.segLatA) && Number.isFinite(snap.segLatB)) {
        const segB = bearingDeg(snap.segLatA, snap.segLngA, snap.segLatB, snap.segLngB);
        const dFwd = angleDiff(ps.courseDeg, segB);
        const dRev = angleDiff(ps.courseDeg, (segB + 180) % 360);
        headingAlignDiffs.push(Math.min(dFwd, dRev));
      }
    }

    // (3) bearingJump 代理: GPS trajectory bearing が >90° 変化 かつ 速度連続 (中速)
    if (i >= 2) {
      const p2 = perStep[i - 2].sample;
      const p1 = perStep[i - 1].sample;
      const p0 = ps.sample;
      const d01 = haversineM(p2.lat, p2.lng, p1.lat, p1.lng);
      const d12 = haversineM(p1.lat, p1.lng, p0.lat, p0.lng);
      if (d01 > 3 && d12 > 3) {
        const b1 = bearingDeg(p2.lat, p2.lng, p1.lat, p1.lng);
        const b2 = bearingDeg(p1.lat, p1.lng, p0.lat, p0.lng);
        const spd = ps.sample.speedKmh;
        if (angleDiff(b1, b2) > 90 && spd != null && spd >= 8 && spd <= 50) {
          bearingJumpSteps++;
        }
      }
    }
  }

  // (2a) flip-flop: committed roadIndex 列で A→B→A パターン (振動) を数える
  let flipFlops = 0;
  for (let i = 2; i < committedRoadSeq.length; i++) {
    if (
      committedRoadSeq[i] === committedRoadSeq[i - 2] &&
      committedRoadSeq[i] !== committedRoadSeq[i - 1]
    ) {
      flipFlops++;
    }
  }

  const alignSorted = headingAlignDiffs.slice().sort((a, b) => a - b);
  const residSorted = snapResiduals.slice().sort((a, b) => a - b);
  const alignMean =
    alignSorted.length > 0 ? alignSorted.reduce((s, x) => s + x, 0) / alignSorted.length : null;

  return {
    fixture: fixtureName,
    headingSource,
    totalSteps: samples.length,
    mmResultSteps: mmResults.length,
    snappedCount,
    committedCount,
    headingSuppliedSteps,
    distance_m: finalState.distance_m, // ★read only・不可侵★
    proxy: {
      headingAlign: {
        n: alignSorted.length,
        meanDeg: round2(alignMean),
        medianDeg: round2(pctl(alignSorted, 50)),
        p90Deg: round2(pctl(alignSorted, 90)),
        maxDeg: round2(pctl(alignSorted, 100)),
      },
      snapResidual: {
        n: residSorted.length,
        medianM: round2(pctl(residSorted, 50)),
        p90M: round2(pctl(residSorted, 90)),
        maxM: round2(pctl(residSorted, 100)),
      },
      flipFlops,
      bearingJumpSteps,
    },
  };
}

async function main() {
  const fixtures = [
    { name: 'realdevice-iphone13-noisy.json', platform: 'ios', label: 'iPhone13 (noisy)' },
    { name: 'realdevice-iphonese.json', platform: 'ios', label: 'iPhone SE' },
    { name: 'realdevice-android.json', platform: 'android', label: 'Android' },
  ];
  const prefRoadsData = loadPrefRoadsData('ehime'); // 実機 trace は松山 (34.0x/132.9x)

  console.log('============================================================');
  console.log(' SNAP ACCURACY GATE (★PROXY — ground-truth 道路ラベル無し★)');
  console.log(' 真の判定 = 実機/タイヤ計/人手ラベルのみ。本 gate は代理量のみ。');
  console.log(' baseline = 現状 (gyro 未接続 / compass-Q 弱)。');
  console.log(' heading 供給 = GPS course を compassHeading として実エンジン emission へ。');
  console.log('============================================================');

  const results = [];
  let anyFail = false;
  for (const f of fixtures) {
    const r = await runFixture(f.name, prefRoadsData, { platform: f.platform });
    r.label = f.label;
    results.push(r);
    console.log('\n── ' + f.label + ' (' + f.name + ') ──');
    console.log(
      '  steps=' +
        r.totalSteps +
        ' mmResult=' +
        r.mmResultSteps +
        ' snapped=' +
        r.snappedCount +
        ' committed=' +
        r.committedCount +
        ' headingSupplied=' +
        r.headingSuppliedSteps
    );
    console.log('  distance_m (read-only/不可侵) = ' + round2(r.distance_m) + ' m');
    const p = r.proxy;
    console.log(
      '  (1) heading-align vs snap seg bearing [deg]: n=' +
        p.headingAlign.n +
        ' mean=' +
        p.headingAlign.meanDeg +
        ' median=' +
        p.headingAlign.medianDeg +
        ' p90=' +
        p.headingAlign.p90Deg +
        ' max=' +
        p.headingAlign.maxDeg
    );
    console.log('  (2a) snap flip-flops (A→B→A committed) = ' + p.flipFlops);
    console.log(
      '  (2b) snap residual GPS→snap [m]: median=' +
        p.snapResidual.medianM +
        ' p90=' +
        p.snapResidual.p90M +
        ' max=' +
        p.snapResidual.maxM
    );
    console.log('  (3) GPS-only bearingJump steps (>90deg @ 8-50km/h) = ' + p.bearingJumpSteps);

    // 健全性 gate: 実エンジンが実際に snap/commit できているか (= 配線が生きているか)。
    //   これは「道が正しい」判定ではなく「エンジンが動いた」最低限の確認。
    if (r.committedCount === 0) {
      console.log('  ★FAIL: committed snap がゼロ = 実エンジンが道を読めていない (配線断)。');
      anyFail = true;
    }
  }

  // baseline JSON を出力 (= 将来 gyro/compass 強化版との数値比較用)
  const outPath = path.join(__dirname, 'gate-snap-accuracy.baseline.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        proxyNotice:
          'PROXY metric only — no ground-truth road labels. True accuracy = real device / tire meter / human labels.',
        results,
      },
      null,
      2
    )
  );
  console.log('\nbaseline written: ' + outPath);
  console.log('============================================================');
  console.log(
    anyFail ? 'RESULT: FAIL (配線断あり)' : 'RESULT: PASS (代理指標 baseline 取得・配線健全)'
  );
  console.log('★PASS は「配線が生きて代理指標が取れた」のみ。「道が正しい」証明では無い★');
  process.exit(anyFail ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(2);
  });
}

module.exports = { runFixture };
