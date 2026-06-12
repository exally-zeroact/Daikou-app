#!/usr/bin/env node
'use strict';

// tests/meter-mm-priority.js
// 2026-05-09: meter.js の MM 優先 + GPS fallback 設計の振る舞いを検証する
//
// 検証ケース:
//   ケース 1: MM Worker から mmIncrementM>0 が来続ける → distance_m は MM 由来
//   ケース 2: MM 沈黙 5 秒で GPS fallback に切替・distance_m に GPS 直線を加算
//   ケース 3: Worker null (= MM 完全 OFF) → 常に GPS fallback
//   ケース 4: MM 復帰 → distance_m は再び MM 由来
//
// 実装方針:
//   meter.js は globalThis に GPS / dlog 等を要求するため、最小スタブを構築して
//   vm.runInThisContext で読み込み。Meter API を直接叩き、state を inspect する。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ─── スタブ環境構築 ─────────────────────────────────────────
const ctx = {
  console: console,
  Date: Date,
  Math: Math,
  Float32Array: Float32Array,
  setInterval: () => null, // タイマー副作用は無視
  clearInterval: () => {},
  performance: { now: () => Date.now() },
  // GPS グローバル: meter.js が calcDistance3D / calcDistance を期待する
  GPS: {
    calcDistance3D: function (lat1, lng1, _alt1, lat2, lng2, _alt2) {
      return haversineM(lat1, lng1, lat2, lng2);
    },
    calcDistance: function (lat1, lng1, lat2, lng2) {
      return haversineM(lat1, lng1, lat2, lng2);
    },
  },
  // RegionLoader は未定義のままにして inline fallback に流れないようにする
  // dlog はデバッグログ抑制
  dlog: function () {},
};
// 自己参照でグローバル化
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.self = ctx;
vm.createContext(ctx);

// ハバーサイン (テスト内で計算検証用)
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
ctx.haversineM = haversineM;
// vm の context 内でも GPS が同じハバーサインを使えるよう注入し直し
ctx.GPS.calcDistance3D = function (lat1, lng1, _alt1, lat2, lng2, _alt2) {
  return haversineM(lat1, lng1, lat2, lng2);
};
ctx.GPS.calcDistance = function (lat1, lng1, lat2, lng2) {
  return haversineM(lat1, lng1, lat2, lng2);
};

// meter.js は `const Meter = (() => {...})();` で宣言するため、
// vm context の globalThis にプロパティとして現れない。末尾に明示的な代入を追加してロード。
const meterSrc =
  fs.readFileSync(path.join(__dirname, '..', 'js', 'meter.js'), 'utf8') +
  '\n;globalThis.Meter = Meter;\n';
vm.runInContext(meterSrc, ctx, { filename: 'js/meter.js' });
const Meter = ctx.Meter;
if (!Meter) {
  console.error('[meter-test] failed to load Meter');
  process.exit(2);
}

// ─── ヘルパー: 最低限の Worker モック ─────────────────────────
// addEventListener('message', handler) で受けた handler を保持
// dispatchMm({mmIncrementM}) で fake な mmResult を Meter に流し込む
function makeFakeWorker() {
  const handlers = [];
  return {
    addEventListener(type, h) {
      if (type === 'message') handlers.push(h);
    },
    removeEventListener(type, h) {
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    },
    postMessage() {}, // Meter は postMessage を呼ぶが本テストでは無視
    _dispatch(data) {
      for (const h of handlers) h({ data: data });
    },
    _handlerCount() {
      return handlers.length;
    },
  };
}

// ─── アサーション ───────────────────────────────────────────
let _failures = 0;
function assert(cond, msg) {
  if (!cond) {
    _failures++;
    console.error('  ✗ ' + msg);
  } else {
    console.log('  ✓ ' + msg);
  }
}
function assertNear(actual, expected, tol, msg) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) {
    _failures++;
    console.error(`  ✗ ${msg} (actual=${actual} expected=${expected}±${tol})`);
  } else {
    console.log(`  ✓ ${msg} (${actual.toFixed(2)} ≈ ${expected})`);
  }
}

// ─── テストケース実装 ────────────────────────────────────────
// 各 GPS は (lat, lng) 直線距離 100m 北・1 秒間隔で前進する単純設定
function gpsAt(stepIdx, baseLat = 34.0658, baseLng = 132.997) {
  // 1 step = 0.0009 度 ≈ 100m
  return {
    lat: baseLat + 0.0009 * stepIdx,
    lng: baseLng,
    altitude: 0,
    timestamp: 1714000000000 + stepIdx * 1000,
    speedKmh: 36,
    accuracy: 5,
    isStationary: false,
    compassHeading: 0,
  };
}

// ★白紙書き直し (2026-05-30・clean-rebuild-pipeline・新挙動へ更新)★
//   距離駆動は pipeline-distance エンジンの delta (= mmResult.pipelineDeltaM) のみ。
//   distanceSource = 'pipeline' 固定。GPS 直線課金は meter.js に存在しない。
//   tier2 preview / mmIncrementM 累積 / distanceSource='mm'/'gps' は廃止。

console.log('\n[case1] pipeline delta → distance_m は道路 snap 道なり累積で増える');
{
  Meter.reset();
  const w = makeFakeWorker();
  Meter.setMapMatcher(w);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  // 道路ロード完了を明示 (= loadfill 非発火・ロード完了後は pipeline delta 単一経路の契約)
  w._dispatch({ type: 'roadsLoaded', ok: true, pref: 'ehime' });
  // ステップ 0 で last_gps 確定。ステップ 1,2 で worker が 90m delta を返す → distance_m ~180m
  for (let i = 0; i < 3; i++) {
    Meter.update(gpsAt(i));
    if (i > 0) w._dispatch({ type: 'mmResult', pipelineDeltaM: 90, snapped: 1, committed: true });
  }
  const s = Meter.getState();
  assertNear(s.distance_m, 180, 0.01, 'distance_m に pipeline delta が累積');
  assert(
    s.distanceSource === 'pipeline',
    `distanceSource = 'pipeline' (got '${s.distanceSource}')`
  );
  Meter.stop();
}

console.log('\n[case1b] 絶対ルール: pipeline delta のみで加算 (GPS 直線課金は使われない)');
{
  Meter.reset();
  const w = makeFakeWorker();
  Meter.setMapMatcher(w);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  w._dispatch({ type: 'roadsLoaded', ok: true, pref: 'ehime' });
  for (let i = 0; i < 3; i++) {
    Meter.update(gpsAt(i));
    if (i > 0) w._dispatch({ type: 'mmResult', pipelineDeltaM: 90, snapped: 1, committed: true });
  }
  const s = Meter.getState();
  assertNear(s.distance_m, 180, 0.01, 'pipeline delta のみで ~180m (GPS 直線は使わない)');
  assert(s.distanceSource === 'pipeline', '最終 source = pipeline');
  Meter.stop();
}

console.log('\n[case2] 絶対ルール: pipeline delta が来ない間は distance_m が動かない');
{
  Meter.reset();
  const w = makeFakeWorker();
  Meter.setMapMatcher(w);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  w._dispatch({ type: 'roadsLoaded', ok: true, pref: 'ehime' });
  Meter.update(gpsAt(0));
  Meter.update(gpsAt(1));
  w._dispatch({ type: 'mmResult', pipelineDeltaM: 90, snapped: 1, committed: true });
  const after1 = Meter.getState();
  assert(after1.distanceSource === 'pipeline', 'step 1: source = pipeline');
  // delta が来ない GPS step → distance_m 据え置き (= GPS 直線課金禁止)
  Meter.update(gpsAt(2));
  const after2 = Meter.getState();
  assertNear(
    after2.distance_m,
    after1.distance_m,
    0.01,
    'pipeline delta 不在中は distance_m が動かない (絶対ルール: GPS 直線課金禁止)'
  );
  Meter.stop();
}

console.log('\n[case3] 絶対ルール: Worker null + roads 未 load → distance_m 据え置き');
{
  Meter.reset();
  Meter.setMapMatcher(null);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  for (let i = 0; i < 3; i++) Meter.update(gpsAt(i));
  const s = Meter.getState();
  assertNear(
    s.distance_m,
    0,
    0.01,
    'roads データ無 + Worker 無 → 加算ゼロ (GPS 直線課金は絶対不可)'
  );
  assert(
    s.distanceSource === 'pipeline',
    `distanceSource 初期値 'pipeline' のまま (got '${s.distanceSource}')`
  );
  Meter.stop();
}

console.log('\n[case4] delta 不在 → 復帰 → distance_m は復帰分のみ追加');
{
  Meter.reset();
  const w = makeFakeWorker();
  Meter.setMapMatcher(w);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  w._dispatch({ type: 'roadsLoaded', ok: true, pref: 'ehime' });
  Meter.update(gpsAt(0));
  // delta なしの GPS step (加算なし)
  Meter.update(gpsAt(1));
  const s1 = Meter.getState();
  assertNear(s1.distance_m, 0, 0.01, 'delta 不在中は 0 据え置き');
  // 復帰 → pipeline delta で 90m 加算
  w._dispatch({ type: 'mmResult', pipelineDeltaM: 90, snapped: 1, committed: true });
  const s2 = Meter.getState();
  assert(s2.distanceSource === 'pipeline', '復帰: source = pipeline');
  assertNear(s2.distance_m - s1.distance_m, 90, 0.01, 'pipeline delta 由来で 90m 追加');
  Meter.stop();
}

console.log('\n[case5] setMapMatcher(null) でリスナー leak しない (M-1 修正の維持確認)');
{
  Meter.reset();
  const w1 = makeFakeWorker();
  const w2 = makeFakeWorker();
  Meter.setMapMatcher(w1);
  Meter.setMapMatcher(w2); // 旧 worker のリスナー除去 + 新規登録
  Meter.setMapMatcher(null); // null で全解除
  assert(w1._handlerCount() === 0, 'w1 のリスナーが除去されている');
  assert(w2._handlerCount() === 0, 'w2 のリスナーが除去されている');
}

console.log('\n[case6] ROAD_FACTOR が削除され Meter 内に未参照');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'meter.js'), 'utf8');
  assert(src.indexOf('const ROAD_FACTOR') === -1, 'ROAD_FACTOR 定数が削除されている');
  assert(src.indexOf('* ROAD_FACTOR') === -1, '* ROAD_FACTOR の乗算が消えている');
}

// ─── case7 (白紙書き直し): tier2 preview 回路廃止 → tentativeDistanceM 受信でも tier2 は 0 ─
console.log('\n[case7] tier2 preview 廃止: tentativeDistanceM 受信でも tier2_pending_m=0');
{
  Meter.reset();
  const w = makeFakeWorker();
  Meter.setMapMatcher(w);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  Meter.update(gpsAt(0));
  // 旧 tier2 preview は廃止: tentativeDistanceM を送っても tier2 は 0 のまま・距離は delta のみ
  w._dispatch({
    type: 'mmResult',
    pipelineDeltaM: 0,
    tentativeDistanceM: 270,
    tentativeIncrementM: 30,
    snapped: 1,
    committed: false,
  });
  let s = Meter.getState();
  assertNear(s.tier2_pending_m, 0, 0.01, 'tier2_pending_m は廃止 (= 0 のまま)');
  assertNear(s.distance_m, 0, 0.01, 'delta 不在で distance_m は 0');
  // pipeline delta 受信で distance_m が加算される
  w._dispatch({ type: 'mmResult', pipelineDeltaM: 200, snapped: 1, committed: true });
  s = Meter.getState();
  assertNear(s.distance_m, 200, 0.01, 'pipeline delta 200m で distance_m=200');
  assertNear(s.tier2_pending_m, 0, 0.01, 'tier2_pending_m 依然 0 (= 廃止)');
  Meter.stop();
}

// ─── case8 (白紙書き直し): business preview 回路廃止 ─
console.log('\n[case8] business preview 廃止: tentativeDistanceM 受信でも business_tier2=0');
{
  Meter.businessEnd();
  Meter.reset();
  Meter.setBusinessDistance(0);
  const w = makeFakeWorker();
  Meter.setMapMatcher(w);
  Meter.setBusinessActive(true);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  Meter.update(gpsAt(0));
  w._dispatch({
    type: 'mmResult',
    pipelineDeltaM: 0,
    tentativeDistanceM: 90,
    snapped: 1,
    committed: false,
  });
  let s = Meter.getState();
  assertNear(s.business_tier2_pending_m, 0, 0.01, 'business_tier2_pending_m は廃止 (= 0)');
  // pipeline delta は business_active gate で business_distance_m に加算
  w._dispatch({ type: 'mmResult', pipelineDeltaM: 90, snapped: 1, committed: true });
  s = Meter.getState();
  assertNear(s.business_distance_m, 90, 0.01, 'business_distance_m に pipeline delta 90m 加算');
  assertNear(s.business_tier2_pending_m, 0, 0.01, 'business_tier2_pending_m 依然 0');
  Meter.businessEnd();
  Meter.stop();
}

// ─── case9 (2026-05-16・Step4 で仕様変更): 停車中は Worker B 側で出力 0 化 ───
console.log('\n[case9] Step4: 停車中は Worker B 出力 = 0 → main 加算ゼロ');
{
  // ★business_distance_m は per-trip reset しない (= case 間で累積) ため明示 0 化してから開始
  Meter.businessEnd();
  Meter.reset();
  Meter.setBusinessDistance(0);
  const w = makeFakeWorker();
  Meter.setMapMatcher(w);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  // 停車中状態をセット (isStationary=true 明示・speedKmh は 0)
  // ★設計変更宣言 (2026-05-16・補助 speedKmh 閾値撤去): _isStationary() は
  //   state.last_isStationary === true のみで判定するため isStationary: true を明示する。
  const slowGps = Object.assign({}, gpsAt(0), { speedKmh: 0, isStationary: true });
  Meter.update(slowGps);

  // ★設計変更宣言 (2026-05-16・Step4 整合): Worker B が isStationary=true 受信時に
  //   mmIncrementM=0 を出力する設計に移行。テストでは fakeWorker が「Worker B が
  //   0 化した結果」を直接 dispatch する想定で mmIncrementM=0 を送る。
  //   main 側のスキップ判定は撤去済 (= 無条件加算) なので 0 を送れば結果も 0 になる。
  w._dispatch({
    type: 'mmResult',
    pipelineDeltaM: 0,
    snapped: 1,
    committed: true,
    isStationary: true,
    snap: {
      observationTimestamp: slowGps.timestamp,
      typeCode: 0,
      prefecture: 'ehime',
      roadIndex: 1,
    },
  });
  const s = Meter.getState();
  // 停車中は worker が pipelineDeltaM=0 → distance_m と business_distance_m が両者整合
  assertNear(s.distance_m, 0, 0.01, '停車中 Worker B 出力 0 → distance_m 加算ゼロ');
  assertNear(
    s.business_distance_m,
    0,
    0.01,
    '停車中 Worker B 出力 0 → business_distance_m 加算ゼロ (整合性確保)'
  );

  Meter.stop();
}

if (_failures === 0) {
  console.log('\n[meter-test] PASS (all cases)');
  process.exit(0);
} else {
  console.error(`\n[meter-test] FAIL (${_failures} assertions)`);
  process.exit(1);
}
