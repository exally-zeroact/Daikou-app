#!/usr/bin/env node
'use strict';
// ★物差し★ 2026-08-28 … ★画面の見え方の線（display ≤ distance_m）で 判定しています★
//   ・見ているのは ★画面の数字が 課金距離を 先取りしないか★（この file 自身に そう書いてある）
//   ・★距離そのもの（いくら取るか）の採点では ありません★。
//   ・タクシー認定モード（過大不可）／代行モード（天井 +0.5〜6%）の どちらの線でも ありません。

// tests/verify-display-even-pace.js
// ★メーター等速ペース化 invariant (2026-05-30・「止まって動いて」脈動の根治契約)★
//
//   司さん実機 3 台 trace 解析で確定した症状:
//     1Hz GPS で run=true 時 distance_m は ~1 秒ごとに ~step 増える。現 _smoothDisplay は
//     ★指数 catch-up★ (display += gap*(1-exp(-dt/τ)) τ=0.4)。fix 到着ごとに「最初速く→
//     減速しながら詰めて」次 fix まで gap≈0 で ★止まる★。1Hz では「動いて→止まって→動いて」
//     = ★脈動 (pulsation)★。これが実機の「止まって動いて」。
//
//   ★本テストの中核 invariant (a)★: 一定速度の合成 trace を 1Hz で流し、UI を高頻度 poll した
//     とき、display の毎フレーム増分が ★ほぼ一定 (等速ペース)★ であり、motion 中に
//     ★長い sit (複数フレーム連続で gap>0 なのに display 不動)★ が出ないこと。
//     = 脈動解消の中核。現行の指数 catch-up では「減速→sit」で ★FAIL するはず★
//       (= trivial-green でない証明。下の EXPECT_PULSATION で現状 FAIL を可視化)。
//
//   付随 invariant:
//     (b) display ≤ distance_m (overshoot ゼロ・過大請求リスクなし) を全フレームで維持。
//     (c) latch (latchDisplay) 後 display == distance_m (= 支払時 メーター=実距離=料金 一致)。
//     (d) 停車 (target 不進) で creep ゼロ (= display 不動・単調非減少)。
//
//   ★絶対不可侵★: distance_m / calcFare / 課金経路は本テストで一切変更しない (= 読むだけ)。
//     本テストは表示層 (_smoothDisplay via getState) のみを合成 target で検証する。
//
//   使い方:
//     node tests/verify-display-even-pace.js            … 等速契約を gate (PASS 必須)
//     EXPECT_PULSATION=1 node tests/verify-display-even-pace.js
//                                                       … 現行 (指数) で (a) が FAIL する事を確認
//                                                         (= FAIL を期待・exit 0 で「予期通り FAIL」報告)
//   exit 0 = PASS (= 契約満たす or 予期した FAIL を確認) / 非0 = FAIL (= CI gate)。

const path = require('path');
const Meter = require(path.join(__dirname, '..', 'js', 'meter.js'));

// 一定速度合成 trace のパラメータ (= 実機 1Hz・典型市街地速度を模す)。
const GPS_HZ = 1; // GPS fix 頻度 (Hz)
const GPS_DT_MS = 1000 / GPS_HZ; // fix 間隔
const SPEED_MPS = 11.1; // ~40 km/h 定速
const STEP_M = SPEED_MPS * (GPS_DT_MS / 1000); // 1 fix あたり target 増分 (= 約 11.1m)
const N_FIX = 60; // 60 秒走行
const UI_HZ = 30; // UI poll 頻度 (= rAF 相当・skip 間引きは無効化前提の full rate を模す)
const UI_DT_MS = 1000 / UI_HZ;

// 等速契約の許容しきい値。
const OVERSHOOT_TOL_M = 0.01; // (b) display ≤ distance_m (float 誤差のみ)
const LATCH_TOL_M = 0.0001; // (c) latch 後の一致誤差
const CREEP_TOL_M = 0.0001; // (d) 停車中 creep 許容
// (a) 等速性: motion 中フレーム増分の変動係数 (CV = std/mean) がこの値以下なら「ほぼ一定」。
//   指数 catch-up は fix 直後に大きく増え末尾でほぼ 0 になるため CV が極端に大きくなる。
const PACE_CV_MAX = 0.6;
// (a) 「長い sit」: motion 中 (gap>0) に display 増分がほぼ 0 のフレームが連続した最大数。
//   等速ペースなら連続 sit はごく短いはず。指数では fix 末尾で長く sit する。
const MAX_SIT_FRAMES = Math.ceil((UI_HZ / GPS_HZ) * 0.5); // = 半 fix 周期 (= 15 frame) 超を「長い sit」とする
const SIT_EPS_M = (STEP_M / UI_HZ) * 0.15; // この増分未満を「実質不動 (sit)」とみなす
// (a) ★fix 内減速比★ (= 脈動の最も直接的な指標): 1 fix 周期内の display 毎フレーム増分の
//   「末尾 frame / 先頭 frame」比。等速ペースなら ~1.0。指数 catch-up は先頭で速く末尾でほぼ
//   止まる (= 実測 ~0.09 = 約 11x 減速 = 「動いて→止まって」)。この比がこの下限を下回ったら脈動。
//   ★0.5 = 末尾増分が先頭の半分未満なら「fix 内で目に見えて減速 (= 止まりかけ)」とみなす★。
const FIX_DECEL_RATIO_MIN = 0.5;

const EXPECT_PULSATION = process.env.EXPECT_PULSATION === '1';

function fail(msg) {
  console.error('[even-pace] FAIL: ' + msg);
  process.exit(1);
}

function main() {
  // ── mock clock: catch-up は Date.now ベース。合成 1Hz/30Hz を実時間同期で再現 ──
  const _realDateNow = Date.now;
  let _mockNow = 1_700_000_000_000; // 任意固定 epoch
  Date.now = () => _mockNow;

  try {
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
    Meter.setBusinessActive(true);
    Meter.start();

    // ── 計測バッファ ──
    let prevDisplay = 0;
    let target = 0;
    let maxOvershoot = 0; // (b)
    let monoViolations = 0; // 単調非減少
    const motionIncrements = []; // (a) motion 中の毎フレーム display 増分
    let curSit = 0; // (a) 連続 sit frame 数
    let maxSit = 0;
    let totalFrames = 0;
    const fixDecelRatios = []; // (a) 各 fix 周期内の (末尾増分/先頭増分) 比
    const WARMUP_FIX = 5; // 先頭数 fix は catch-up 立ち上がり中なので計測から除外

    // ── 走行 (= 1Hz で target を STEP_M ずつ進め、その間に UI を UI_HZ で poll) ──
    for (let f = 0; f < N_FIX; f++) {
      // GPS fix 到着: target (= distance_m) を 1 step 進める。distance_m は本物の課金値経路。
      target += STEP_M;
      Meter.setDistance(target);
      _mockNow += 0; // fix は同時刻。以降の UI tick で時間が進む。

      const uiTicks = Math.round(GPS_DT_MS / UI_DT_MS);
      let firstInc = null; // この fix 周期で最初に観測した motion 増分
      let lastInc = null; // この fix 周期で最後に観測した motion 増分
      for (let k = 0; k < uiTicks; k++) {
        _mockNow += Math.round(UI_DT_MS);
        const s = Meter.getState();
        const disp = s.display_distance_m || 0;
        const dist = s.distance_m || 0;
        totalFrames++;

        // 単調非減少
        if (disp < prevDisplay - 1e-9) monoViolations++;
        // (b) overshoot
        const over = disp - dist;
        if (over > maxOvershoot) maxOvershoot = over;
        // (a) motion 中増分・sit 検出 (= gap>0 = まだ target に追いついていない局面)
        const gap = dist - disp;
        const inc = disp - prevDisplay;
        if (gap > SIT_EPS_M) {
          // まだ詰める余地がある = この frame は「動くべき」。
          motionIncrements.push(inc);
          // fix 直後の最初の getState は catch-up の時刻基準確立で dt=0 → 増分 0 になる
          //   (= setDistance が _prev_target_time=null にするため)。先頭増分は「最初に
          //   実際に動いた frame」を採る (= 減速比の分母をゼロにしない)。
          if (firstInc === null && inc > 1e-9) firstInc = inc;
          lastInc = inc;
          if (inc < SIT_EPS_M) {
            curSit++;
            if (curSit > maxSit) maxSit = curSit;
          } else {
            curSit = 0;
          }
        } else {
          curSit = 0;
        }
        prevDisplay = Math.max(prevDisplay, disp);
      }
      // (a) この fix 周期の減速比 (= 末尾 motion 増分 / 先頭 motion 増分)。
      //   等速なら ~1.0・指数なら << 1 (= fix 内で減速して止まりかける)。
      if (f >= WARMUP_FIX && firstInc !== null && lastInc !== null && firstInc > 1e-9) {
        fixDecelRatios.push(lastInc / firstInc);
      }
    }

    // ── (d) 停車: target を進めず UI を回し creep を見る ──
    const beforeStopDisp = Meter.getState().display_distance_m || 0;
    // まず現在の gap を収束させる (= 走行末尾の追従を完了させてから停車計測)。
    for (let k = 0; k < UI_HZ * 5; k++) {
      _mockNow += Math.round(UI_DT_MS);
      Meter.getState();
    }
    const stationaryStart = Meter.getState().display_distance_m || 0;
    let stationaryCreep = 0;
    for (let k = 0; k < UI_HZ * 10; k++) {
      _mockNow += Math.round(UI_DT_MS);
      const d = Meter.getState().display_distance_m || 0;
      const c = d - stationaryStart;
      if (c > stationaryCreep) stationaryCreep = c;
    }

    // ── (c) latch: display == distance_m ──
    Meter.latchDisplay();
    const lat = Meter.getState();
    const latchGap = Math.abs((lat.display_distance_m || 0) - (lat.distance_m || 0));

    Date.now = _realDateNow;

    // ── (a) 等速性指標の算出 ──
    const movingIncs = motionIncrements.filter((x) => Number.isFinite(x));
    const mean =
      movingIncs.length > 0 ? movingIncs.reduce((a, b) => a + b, 0) / movingIncs.length : 0;
    let variance = 0;
    for (const x of movingIncs) variance += (x - mean) ** 2;
    variance = movingIncs.length > 0 ? variance / movingIncs.length : 0;
    const std = Math.sqrt(variance);
    const cv = mean > 1e-9 ? std / mean : Infinity;
    // fix 内減速比の中央値 (= 外れ値に強い代表値)。1.0 に近いほど等速。
    const sortedRatios = fixDecelRatios.slice().sort((a, b) => a - b);
    const medianDecelRatio =
      sortedRatios.length > 0 ? sortedRatios[Math.floor(sortedRatios.length / 2)] : 1;

    // ── 実値レポート (= node 実値・捏造なし) ──
    console.log('[even-pace] frames total              = ' + totalFrames);
    console.log('[even-pace] target final (distance_m) = ' + target.toFixed(2) + ' m');
    console.log('[even-pace] STEP_M / fix              = ' + STEP_M.toFixed(2) + ' m');
    console.log('[even-pace] mono violations           = ' + monoViolations);
    console.log('[even-pace] max overshoot (b)         = ' + maxOvershoot.toFixed(6) + ' m');
    console.log('[even-pace] motion frame mean inc     = ' + mean.toFixed(4) + ' m');
    console.log('[even-pace] motion frame std inc      = ' + std.toFixed(4) + ' m');
    console.log('[even-pace] pace CV (a, <= ' + PACE_CV_MAX + ')      = ' + cv.toFixed(4));
    console.log(
      '[even-pace] max sit frames (a, <= ' + MAX_SIT_FRAMES + ')  = ' + maxSit + ' (frame)'
    );
    console.log(
      '[even-pace] fix-内 decel ratio median (a, >= ' +
        FIX_DECEL_RATIO_MIN +
        ') = ' +
        medianDecelRatio.toFixed(4) +
        ' (= 末尾増分/先頭増分・1.0=等速)'
    );
    console.log('[even-pace] stationary creep (d)      = ' + stationaryCreep.toFixed(6) + ' m');
    console.log('[even-pace] latch gap (c)             = ' + latchGap.toFixed(6) + ' m');
    void beforeStopDisp;

    // ── 判定 ──
    // (b)(c)(d) と単調は等速化前後どちらでも満たすべき不変条件 (= 常に gate)。
    if (monoViolations > 0) fail('display 後退 (= 単調非減少違反 ' + monoViolations + ' 回)');
    if (maxOvershoot > OVERSHOOT_TOL_M)
      fail('(b) overshoot ゼロ契約違反・最大 ' + maxOvershoot.toFixed(6) + ' m (= 過大請求の穴)');
    if (stationaryCreep > CREEP_TOL_M)
      fail('(d) 停車中 creep 発生・' + stationaryCreep.toFixed(6) + ' m (= phantom 進行)');
    if (latchGap > LATCH_TOL_M)
      fail('(c) latch 後 display != distance_m・乖離 ' + latchGap.toFixed(6) + ' m');

    // (a) 等速ペース判定 (= 脈動解消の中核)。3 指標すべてを満たすこと:
    //   CV (全体ばらつき) ・maxSit (連続不動) ・fix 内減速比 (= 各 fix で止まりかけないこと)。
    const paceOk =
      cv <= PACE_CV_MAX && maxSit <= MAX_SIT_FRAMES && medianDecelRatio >= FIX_DECEL_RATIO_MIN;

    if (EXPECT_PULSATION) {
      // 現行 (指数 catch-up) では脈動 = (a) FAIL するはず。FAIL を確認できたら exit 0。
      if (paceOk) {
        fail(
          '★EXPECT_PULSATION モードだが (a) 等速契約が PASS してしまった★ ' +
            '(= 既に等速化済 or テストが脈動を検出できていない。trivial-green の疑い)'
        );
      }
      console.log(
        '[even-pace] EXPECT_PULSATION: (a) は予期通り FAIL を確認 ' +
          '(CV=' +
          cv.toFixed(4) +
          ' > ' +
          PACE_CV_MAX +
          ' or maxSit=' +
          maxSit +
          ' > ' +
          MAX_SIT_FRAMES +
          ' or decelRatio=' +
          medianDecelRatio.toFixed(4) +
          ' < ' +
          FIX_DECEL_RATIO_MIN +
          ')。= 指数 catch-up の脈動を本テストが正しく捕捉している (trivial-green でない証明)。'
      );
      console.log('[even-pace] 判定: PASS (= 予期した FAIL を確認)');
      process.exit(0);
    }

    if (!paceOk)
      fail(
        '(a) 等速ペース契約違反 (= 脈動)・CV=' +
          cv.toFixed(4) +
          ' (<= ' +
          PACE_CV_MAX +
          ') / maxSit=' +
          maxSit +
          ' frame (<= ' +
          MAX_SIT_FRAMES +
          ') / decelRatio=' +
          medianDecelRatio.toFixed(4) +
          ' (>= ' +
          FIX_DECEL_RATIO_MIN +
          ')。' +
          '= 「動いて→止まって→動いて」が表示層に残存。_smoothDisplay を等速ペース catch-up へ。'
      );

    console.log('[even-pace] 判定: PASS (= 等速ペース・overshoot0・creep0・latch一致)');
    process.exit(0);
  } finally {
    Date.now = _realDateNow;
  }
}

main();
