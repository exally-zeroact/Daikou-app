#!/usr/bin/env node
'use strict';

// ============================================================
// ★物差し★ 2026-08-29 … ★運賃刻み(420m)の線で 判定しています★
//   ・タクシー認定モード（過大不可）の線でも 代行モードの天井でもありません。
//   ・見ているのは ★同じ走行を 3台で測った距離の開き（spread）が 運賃刻みを 割らないか★
//     ＝★司さんの核心「同社で 運賃割れ＝アウト」★そのもの。
//
// ★★2026-08-29 に repo へ 運びました（それまで CI は 無いファイルを 呼んでいた）★★
//   ★soft: true が MODULE_NOT_FOUND を ✓ に 見せていた★（CI 33146596665 で確認）
//
//   ★今の実測（2026-08-29・手元）★
//     Android 10,183.5m ／ iPhoneSE 9,467.2m ／ iPhone13-noisy 9,393.3m
//     (A) 3台収束    ★FAIL  spread=790.2m（7.76%）★  ← 420m 未満が 条件・目標337m
//     (B) 過大ゼロ    PASS   iP13 8,313.7m vs タイヤ真値8,390（−0.91%）
//     (C) creep非再発 ★FAIL  creep=23.86m（上限5m）★
//     (D) seam監査    seam実装=NO（未実装）
//     ★秒数 298.7秒（約5分）★／cert-gate の timeout は 15分＝収まる
//       （★CIの機械は 手元より 遅い事が 多いので、運んだ日に CIの実測秒数を 見る★）
//
//   ★★当時 679.9m → 今 790.2m ＝ 開きが 広がっています★★
//     ＝★「直っていない」だけでなく「悪くなっている」★。直す時の 基準は 790.2m。
//
//   ★数字が 食い違って 見える所（先に 書いておきます）★
//     ・(C) creep 23.86m は ★末尾に 60秒の停車を 足した合成★の上での値。
//       ★実機そのままの走行では creep 0.00m★（tests/gate-realdevice-creep.js・2026-08-28 実測）。
//       ＝★材料が 違う★ので、2つの数字は 食い違っていません。
//     ・(B) の iPSE-5km は ★真値ラベル5000が 誤り（実 約5,570）★＝★参考のみ・合否に 使わない★。
//
//   ★赤で正しい★: seam（穴の継ぎ目の連続化）が ★未実装★なので (A)(C) は 赤が 正しい。
//     ⇒ 直すのは ★指示役の指示があってから★（distance_m は 不可侵）。
// ============================================================
// tests/gate-realdevice-spread.js
//   ★STEP1 ゲート (seam連続化 実装前テスト先行)★ — 3台同一走行の distance_m 収束ゲート。
//
//   司さん核心 (絶対要件):「同社で運賃割れ=アウト」。同一走行を3台 (iPhone13/SE/Android)
//   で計測した distance_m が ★運賃刻み (add_distance_m=420m) を割らない★ こと。
//   = 3台の spread (max−min) が 420m 未満なら、どの2台も同じ運賃 tier に乗り運賃割れしない。
//   目標は 337m 級 (arc-only 収束)・最低でも 420m 未満。
//
//   本ゲートは ★実 prod 経路 (実 Worker B map-matcher + 実 meter)★ を Node で evaluate し
//   (= 再実装/コピー禁止・prod 経路と byte 等価)、realdevice 3 fixture を 1 点ずつ
//   Meter.update → Worker B → mmResult → meter distance_m で流して distance_m / spread を測る。
//   gate-road-distance.js の runProdPipeline と同一手法 (worker-sim + loadMeter)。
//
//   検証項目:
//     (A) ★3台収束★: spread(Android/iPhoneSE/iPhone13-noisy) < add_distance_m(420m)。
//                     現状 (seam前) は 679.9m で ★FAIL (RED)★ = テスト先行の trivial-green でない証明。
//     (B) ★過大ゼロ★: tire fixture (iP13 真値8390) で distance_m ≤ 真値 (1m も超えない・cert_band 過大側)。
//                     SE-5km は真値ラベル5000が誤り (実 ~5570) のため過大判定からは ★参考のみ★ で除外。
//     (C) ★creep 非再発★: realdevice 3台に末尾 60s 停車 (spd=0) を足し distance 増分 ≤ creep_max(5m)。
//     (D) ★seam監査★: seam実装後に bd.seamM / stats.seamSegs (新監査カウンタ) で seam 発火回数と
//                     寄与mを source_breakdown で実測裏取り (seam前は全て 0/undefined)。
//
//   ★着手時 (実装前 = seam無し) は (A) が ★RED★ になること (spread≈680m>420m) を実値で確認する。★
//   seam連続化 (pipeline-distance.js 別道路分岐へ幾何判定1つ挿入) が入って初めて (A) が GREEN 化する。
//   ★θ較正 (勘禁止)★: SEAM_TURN_DEG_SWEEP を走査し (A)spread最小 (B)tire過大ゼロ (C)creep0 を
//   全て満たす ★最大の保守θ★ (過大ゼロ優先) を実走値で選ぶ。__OFF (seamTurnDeg=null) との差分で
//   連続化寄与を定量する。
//
//   絶対不変 (本ゲートは検証のみ・実コードは 1 byte も触らない):
//     distance_m 構造 / calcFare / running gate / business vs trip 分離 /
//     never-over 3段 (routingMaxRatio/perSegmentMax/flip-reject) / A1 phantom 除去 / gapGuard fill。
//
//   使い方:
//     node tests/gate-realdevice-spread.js              (CLI・PASS/FAIL + JSON 出力)
//     SEAM_SWEEP=1 node tests/gate-realdevice-spread.js (θ スイープ table を併記)
//   import:
//     const { runGate } = require('./gate-realdevice-spread'); runGate({})
// ============================================================

const fs = require('fs');
const path = require('path');
const { createMapMatcherWorker, loadPrefRoadsData } = require('./replay-mm-worker/worker-sim');
const { loadMeter } = require('./replay-mm-worker/runner');

const DEFAULT_PREF = 'ehime';

// ── 運賃刻み (= 運賃割れ閾値)。STANDARD_FARE.add_distance_m と一致させること。──
//   3台の distance_m spread がこの値未満なら、どの2台も同一運賃 tier = 運賃割れしない。
const ADD_DISTANCE_M = 420; // 運賃刻み (100円/420m)
const SPREAD_MAX_M = ADD_DISTANCE_M; // (A) PASS 条件: spread < 420m
const SPREAD_TARGET_M = 337; // 目標 (arc-only 収束級・参考表示)

// ── creep (C): realdevice 末尾停車での distance 増分上限 ──
const CREEP_MAX_M = 5.0;

// ── θ スイープ候補 (較正用・勘の固定値でなく実走で選ぶ) ──
const SEAM_TURN_DEG_SWEEP = [null, 10, 15, 20, 25, 30, 35]; // null = __OFF (seam無効・現状)

// ── 3台同一走行 fixture ──
const DEVICES = [
  ['Android', 'realdevice-android.json'],
  ['iPhoneSE', 'realdevice-iphonese.json'],
  ['iPhone13-noisy', 'realdevice-iphone13-noisy.json'],
];

// ── タイヤ真値 (過大ゼロ検証) ──
//   iP13 は真値8390 (タイヤ計・絶対) → 過大判定に使う。
//   SE-5km はラベル5000が誤り (実 ~5570) のため ★参考のみ★ (過大判定から除外)。
const TIRE = [
  ['iP13-8.39km', 'real-trace-iphone13-8.39km-tire.json', 8390, true], // enforce 過大ゼロ
  ['iPSE-5km', 'real-trace-iphoneSE-5km-tire5.0.json', 5000, false], // 参考のみ (ラベル誤り)
];

const STANDARD_FARE = {
  version: 2,
  base_fare: 1300,
  base_distance_m: 1000,
  add_fare: 100,
  add_distance_m: ADD_DISTANCE_M,
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

function loadFixture(name) {
  const p = path.join(__dirname, 'fixtures', name);
  if (!fs.existsSync(p)) throw new Error('fixture 無し: ' + p);
  return JSON.parse(fs.readFileSync(p, 'utf8'))
    .filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .sort((a, b) => (a.t || 0) - (b.t || 0));
}

// ── 実 prod 経路: 実 Worker B + 実 Meter で fixture を流す (gate-road-distance.js と同一手法) ──
//   seamOpt は engine の DEFAULTS.seamTurnDeg を opts で上書きする値。
//     null  → __OFF (cfg.seamTurnDeg = null → seam 分岐は発火せず現状動作)。
//     数値   → その θ で seam 連続化を有効化。
//     undefined → engine の DEFAULTS をそのまま使う (= 既定θ)。
//   ★engine 側は computeDistance/createDistanceTracker が for(k in DEFAULTS) で opts を展開済の
//     ため、worker 経由でも tracker opts に seamTurnDeg を流せば伝播する。worker-sim が opts を
//     受け渡す口が無い場合は __OFF/既定 のみ (seam 実装時に worker opts 配線を併せて確認)。★
function runProd(pref, samples, seamOpt) {
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
  adapter.postMessage({ type: 'configPlatform', isIOS: true });
  // ★seam θ を worker→tracker opts へ伝える口 (seam 実装時に worker-sim/map-matcher が
  //   distanceOpts を受ければ有効。無ければ無視され __OFF/既定 のみ評価される)。★
  if (seamOpt !== undefined) {
    adapter.postMessage({ type: 'configDistance', distanceOpts: { seamTurnDeg: seamOpt } });
  }
  adapter.postMessage({ type: 'loadRoads', pref: roadsData.prefecture, roadsData });
  if (!roadsLoaded) throw new Error('loadRoads failed for pref=' + pref);
  if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);
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
  adapter.postMessage({ type: 'getPipelineBreakdown' });
  Meter.businessEnd();
  const st = Meter.getState();
  const bd = (pipelineBreakdown && pipelineBreakdown.breakdown) || {};
  const stats = (pipelineBreakdown && pipelineBreakdown.stats) || {};
  return {
    distance_m: st.distance_m,
    breakdown: bd,
    stats,
    seamSegs: stats.seamSegs || 0, // seam 実装後の新監査カウンタ (現状 undefined→0)
    seamM: bd.seamM || 0, // seam 寄与m (現状 undefined→0)
  };
}

// ── (C) creep: realdevice 走行末尾に道路上 1 点ジッタ・spd=0 の停車 60s を足し distance 増分を測る ──
//   走行のみ distance (driveOnly = 既測値を再利用) と、停車を継ぎ足した distance の差分が creep。
//   driveOnly を引数で受けることで evalSeam の device run を再利用し +1 run に抑える。
function measureCreepFromBase(pref, fixtureName, driveOnly, seamOpt) {
  const samples = loadFixture(fixtureName);
  const last = samples[samples.length - 1];
  const t0 = last.t || Date.now();
  const jit = [8e-5, -8e-5, 5e-5, -6e-5, 7e-5, -4e-5, 8e-5, -8e-5, 3e-5, -7e-5];
  const withStop = samples.slice();
  for (let i = 0; i < 60; i++) {
    withStop.push({
      lat: last.lat + jit[i % jit.length],
      lng: last.lng + jit[(i + 3) % jit.length],
      t: t0 + (i + 1) * 1000,
      acc: 8,
      spd: 0,
    });
  }
  const withStopDist = runProd(pref, withStop, seamOpt).distance_m;
  return +(withStopDist - driveOnly).toFixed(2);
}

// ── 1 つの θ で 3台 spread + tire 過大 (+ 任意で creep) を測る ──
//   ★コスト注意★: 実 Worker B (HMM Viterbi) は 1700 点で ~30s/run。default は
//   3 device + 2 tire = 5 run。creep は +1 run なので opts.withCreep でのみ実施
//   (= 既存 gate-realdevice-creep.js が creep 専任のため二重実行を避ける)。
function evalSeam(pref, seamOpt, opts) {
  opts = opts || {};
  const devRes = {};
  const dists = [];
  for (const [label, file] of DEVICES) {
    const r = runProd(pref, loadFixture(file), seamOpt);
    devRes[label] = r;
    dists.push(r.distance_m);
  }
  const mx = Math.max(...dists);
  const mn = Math.min(...dists);
  const spread = +(mx - mn).toFixed(1);

  const tireRes = {};
  // ★2026-08-29: tireOverOk（この場で 数えていた物）を 外しました。
  //   ★合否は 下の b_pass（313行あたり）で main.tire を 数え直して 決めています★＝二重帳簿でした。
  //   ★どちらが 正か 確かめた上で 使われている方を 残しています★（消した方は 誰も 読んでいなかった）
  for (const [label, file, truth, enforce] of TIRE) {
    const r = runProd(pref, loadFixture(file), seamOpt);
    const errPct = +(((r.distance_m - truth) / truth) * 100).toFixed(2);
    const overOk = r.distance_m <= truth + 0.0001; // 過大側ゼロ (1m も超えない)
    tireRes[label] = {
      distance_m: +r.distance_m.toFixed(1),
      truth,
      error_pct: errPct,
      over_ok: overOk,
      enforce,
      seamSegs: r.seamSegs,
      seamM: +r.seamM.toFixed(1),
    };
  }

  // creep は Android (acc 良好) で代表測定 (任意・+1 run)。
  //   driveOnly は上で測った Android distance を再利用し withStop だけ +1 run に抑える。
  let creepM = null;
  if (opts.withCreep) {
    creepM = measureCreepFromBase(pref, DEVICES[0][1], devRes['Android'].distance_m, seamOpt);
  }

  return {
    seamTurnDeg: seamOpt,
    devices: Object.fromEntries(
      Object.entries(devRes).map(([k, v]) => [
        k,
        {
          distance_m: +v.distance_m.toFixed(1),
          sameRoadM: +(v.breakdown.sameRoadM || 0).toFixed(1),
          routedM: +(v.breakdown.routedM || 0).toFixed(1),
          straightFB: +(v.breakdown.straightFallbackM || 0).toFixed(1),
          seamSegs: v.seamSegs,
          seamM: +v.seamM.toFixed(1),
        },
      ])
    ),
    spread_m: spread,
    spread_pct: +(((mx - mn) / mx) * 100).toFixed(2),
    tire: tireRes,
    creep_m: creepM,
  };
}

// ── ゲート本体 ──
function runGate(opts) {
  opts = opts || {};
  const pref = (opts.pref || process.env.ROADS_PREF || DEFAULT_PREF).toLowerCase();
  const doSweep = opts.sweep || process.env.SEAM_SWEEP === '1';
  // __OFF 差分は seam 実装 + worker opts 配線後にのみ意味を持つ (+5 run 重い) ため flag 制。
  const doOffDiff = opts.offDiff || process.env.SEAM_OFF_DIFF === '1';

  // 既定 (engine DEFAULTS のθ) で本判定 (3 device + 2 tire + 1 creep = 6 run)。
  //   seam 未実装時は __OFF と同値 (= 現状 spread≈680m) で (A)=RED。
  const main = evalSeam(pref, undefined, { withCreep: true });

  // __OFF (seam無効) 基準 (任意・差分用)。seam 実装後の連続化寄与を差分で出すための対照。
  const off = doOffDiff ? evalSeam(pref, null, {}) : null;

  // ── 判定 ──
  // (A) 3台収束: spread < 運賃刻み 420m。
  const a_pass = main.spread_m < SPREAD_MAX_M;
  // (B) 過大ゼロ: enforce 対象 tire fixture が全て distance_m ≤ 真値。
  let b_pass = true;
  for (const k of Object.keys(main.tire)) {
    const t = main.tire[k];
    if (t.enforce && !t.over_ok) b_pass = false;
  }
  // (C) creep 非再発。
  const c_pass = main.creep_m != null && main.creep_m <= CREEP_MAX_M;

  // θ スイープ table (較正裏取り・任意)。
  let sweep = null;
  if (doSweep) {
    sweep = SEAM_TURN_DEG_SWEEP.map((th) => {
      const e = evalSeam(pref, th, { withCreep: true });
      return {
        seamTurnDeg: th,
        spread_m: e.spread_m,
        spread_lt_420: e.spread_m < SPREAD_MAX_M,
        iP13_distance_m: e.tire['iP13-8.39km'].distance_m,
        iP13_over_ok: e.tire['iP13-8.39km'].over_ok,
        creep_m: e.creep_m,
        seamSegs_android: e.devices['Android'].seamSegs,
        seamM_android: e.devices['Android'].seamM,
      };
    });
  }

  const result = {
    pref,
    spread_max_m: SPREAD_MAX_M,
    spread_target_m: SPREAD_TARGET_M,
    creep_max_m: CREEP_MAX_M,

    // (A) 3台収束
    a_spread: {
      pass: a_pass,
      spread_m: main.spread_m,
      spread_pct: main.spread_pct,
      target_m: SPREAD_TARGET_M,
      max_allowed_m: SPREAD_MAX_M,
      devices: main.devices,
    },
    // (B) 過大ゼロ (cert 過大側)
    b_overcount_zero: {
      pass: b_pass,
      tire: main.tire,
    },
    // (C) creep 非再発
    c_creep: {
      pass: c_pass,
      creep_m: main.creep_m,
      creep_max_m: CREEP_MAX_M,
    },
    // (D) seam 監査 (連続化寄与・__OFF 差分は doOffDiff 時のみ)
    d_seam_audit: {
      off_spread_m: off ? off.spread_m : null,
      on_spread_m: main.spread_m,
      spread_reduction_m: off ? +(off.spread_m - main.spread_m).toFixed(1) : null,
      off_devices: off ? off.devices : null,
      on_devices: main.devices,
      off_diff_measured: !!off,
      seam_implemented:
        main.devices['Android'].seamSegs > 0 ||
        main.devices['iPhoneSE'].seamSegs > 0 ||
        main.devices['iPhone13-noisy'].seamSegs > 0,
    },
    sweep,
  };

  result.gate_pass = a_pass && b_pass && c_pass;
  return result;
}

function main() {
  const r = runGate({});
  console.log('=== ★STEP1 ゲート: 3台収束 (seam連続化・運賃割れ防止)★ ===\n');
  console.log(
    '  運賃刻み add_distance_m=' +
      ADD_DISTANCE_M +
      'm  → PASS 条件: spread < ' +
      SPREAD_MAX_M +
      'm  (目標 ' +
      SPREAD_TARGET_M +
      'm 級)\n'
  );

  const d = r.a_spread.devices;
  for (const k of Object.keys(d)) {
    console.log(
      '  ' +
        k.padEnd(16) +
        ' distance_m=' +
        d[k].distance_m +
        'm  sameRoadM=' +
        d[k].sameRoadM +
        ' routedM=' +
        d[k].routedM +
        ' straightFB=' +
        d[k].straightFB +
        ' seamSegs=' +
        d[k].seamSegs +
        ' seamM=' +
        d[k].seamM
    );
  }

  console.log(
    '\n(A) 3台収束       : ' +
      (r.a_spread.pass ? 'PASS' : 'FAIL') +
      '  spread=' +
      r.a_spread.spread_m +
      'm (' +
      r.a_spread.spread_pct +
      '%)  [< ' +
      SPREAD_MAX_M +
      'm で運賃割れなし / 目標 ' +
      SPREAD_TARGET_M +
      'm]'
  );

  console.log('(B) 過大ゼロ       : ' + (r.b_overcount_zero.pass ? 'PASS' : 'FAIL'));
  for (const k of Object.keys(r.b_overcount_zero.tire)) {
    const t = r.b_overcount_zero.tire[k];
    console.log(
      '      ' +
        k.padEnd(14) +
        ' distance_m=' +
        t.distance_m +
        'm 真値' +
        t.truth +
        ' (' +
        (t.error_pct >= 0 ? '+' : '') +
        t.error_pct +
        '%)  過大ゼロ=' +
        (t.over_ok ? 'OK' : '★NG★') +
        (t.enforce ? ' [enforce]' : ' [参考のみ・ラベル誤り]')
    );
  }

  console.log(
    '(C) creep非再発    : ' +
      (r.c_creep.pass ? 'PASS' : 'FAIL') +
      '  creep=' +
      r.c_creep.creep_m +
      'm (<= ' +
      CREEP_MAX_M +
      ')'
  );

  console.log(
    '(D) seam監査       : seam実装=' +
      (r.d_seam_audit.seam_implemented ? 'YES' : 'NO (未実装・現状)') +
      (r.d_seam_audit.off_diff_measured
        ? '  __OFF spread=' +
          r.d_seam_audit.off_spread_m +
          'm → ON spread=' +
          r.d_seam_audit.on_spread_m +
          'm  (収束 ' +
          r.d_seam_audit.spread_reduction_m +
          'm)'
        : '  (__OFF 差分は SEAM_OFF_DIFF=1 で測定・現状 ON spread=' +
          r.d_seam_audit.on_spread_m +
          'm)')
  );

  if (r.sweep) {
    console.log('\n=== θ スイープ (較正・勘禁止) ===');
    console.log('  θ       spread   <420  iP13dist  過大0  creep  seamSegs(And)  seamM(And)');
    for (const s of r.sweep) {
      console.log(
        '  ' +
          String(s.seamTurnDeg === null ? 'OFF' : s.seamTurnDeg).padEnd(7) +
          ' ' +
          String(s.spread_m).padEnd(8) +
          ' ' +
          String(s.spread_lt_420 ? 'Y' : 'N').padEnd(5) +
          ' ' +
          String(s.iP13_distance_m).padEnd(9) +
          ' ' +
          String(s.iP13_over_ok ? 'Y' : 'N').padEnd(6) +
          ' ' +
          String(s.creep_m).padEnd(6) +
          ' ' +
          String(s.seamSegs_android).padEnd(14) +
          ' ' +
          s.seamM_android
      );
    }
  }

  console.log('\n=== GATE: ' + (r.gate_pass ? 'PASS' : 'FAIL') + ' ===');
  console.log('seam連続化実装後に (A)(B)(C) 全 GREEN を要求 (実装前は spread>420m で (A)=RED)。');

  const OUT_DIR = path.join(__dirname, '..', 'data', 'test-results');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'gate-realdevice-spread.json'), JSON.stringify(r, null, 2));
  console.log('\n[gate] wrote data/test-results/gate-realdevice-spread.json');

  if (r.gate_pass) process.exit(0);
  process.exit(1);
}

if (require.main === module) main();

module.exports = {
  runGate,
  evalSeam,
  SPREAD_MAX_M,
  SPREAD_TARGET_M,
  CREEP_MAX_M,
  ADD_DISTANCE_M,
  SEAM_TURN_DEG_SWEEP,
};
