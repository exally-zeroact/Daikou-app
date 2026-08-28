#!/usr/bin/env node
'use strict';
// ★物差し★ 2026-08-28 … ★画面の見え方の線（display ≤ distance_m）で 判定しています★
//   ・見ているのは ★画面の数字が 課金距離を 先取りしないか★（この file 自身に そう書いてある）
//   ・★距離そのもの（いくら取るか）の採点では ありません★。
//   ・タクシー認定モード（過大不可）／代行モード（天井 +0.5〜6%）の どちらの線でも ありません。

// tests/verify-display-stop-restart.js
// ★減速→完全停車→確定→再発進 の表示契約 (2026-05-31・司さん4要求の直接テスト化)★
//
//   司さんの確定要求 (この会話で1つずつ確認):
//     (1) 停車する時は減速窓の間に display が実距離に追いつき切る → ★完全停車時は一致★。
//     (2) ★完全停車後 (速度0) は display を 1m も動かさない★ (= 動いてないのにメーターが動く=揉める)。
//     (3) 確定 latch は ★no-op★ (= 既に一致しとるので跳ねない)。
//     (4) ★再発進 (信号/経由地) は ≤1秒 (目標~0.5秒) で動き出す★ (= GPS 検知の物理底のみ・表示が足す遅れ0)。
//     (5) ★10m 単位で動く = 1回の表示変化が10m以下・20m/30m を一気に飛ばさない★。
//   全シーンで display ≤ distance_m (先取り/過大ゼロ・認定) かつ 単調非減少。
//
//   ★着手時 (実装前) は (a)(c)(e) が FAIL するはず★ (= gap で出来た遅れが停車時に残り・latch で
//     一気に snap = 20〜30m 飛び)。spring/gap比例 catch-up 実装後に全 GREEN。
//
//   ★絶対不可侵★: distance_m / calcFare / 課金経路は読むだけ (= setDistance で target を与えるのみ)。
//
//   使い方:
//     node tests/verify-display-stop-restart.js
//     EXPECT_FAIL=1 node tests/verify-display-stop-restart.js  … 現行で (a)(e) が FAIL する事を確認 (exit 0)

const path = require('path');
const Meter = require(path.join(__dirname, '..', 'js', 'meter.js'));

const UI_HZ = 60; // rAF 相当
const UI_DT_MS = 1000 / UI_HZ;
const CRUISE_MPS = 11.1; // ~40 km/h

// 契約しきい値
const CAUGHT_UP_TOL_M = 1.0; // (a) 完全停車時の残差上限
const STOPPED_MOVE_TOL_M = 0.05; // (b) 完全停車後 (settle 後) の display 移動上限
const LATCH_SNAP_TOL_M = 1.0; // (c) 確定 latch の跳ね上限 (= 既に一致なので ~0)
const RESTART_DELAY_MAX_S = 1.0; // (4) 再発進→display が動き出すまでの上限
const STEP_SKIP_MAX_M = 10.0; // (5) 1回の表示変化の上限 (= 20/30m 飛び禁止)
const SETTLE_S = 1.0; // 完全停車後 display が落ち着くのを待つ猶予 (= 減速窓の延長・この後は不動)

const EXPECT_FAIL = process.env.EXPECT_FAIL === '1';

function main() {
  const _realDateNow = Date.now;
  let _mockNow = 1_700_000_000_000;
  Date.now = () => _mockNow;

  // 計測グローバル
  let prevDisplay = 0;
  let maxStepJump = 0; // (5) 1フレーム最大増分
  let maxOvershoot = 0; // 先取り
  let monoViolations = 0;
  let target = 0;

  function setTarget(v) {
    target = v;
    Meter.setDistance(target);
  }
  // poll を回し、各フレームで display を観測。onFrame(disp, dist, inc)。
  function pollMs(ms, onFrame) {
    const ticks = Math.max(1, Math.round(ms / UI_DT_MS));
    for (let k = 0; k < ticks; k++) {
      _mockNow += Math.round(UI_DT_MS);
      const s = Meter.getState();
      const disp = s.display_distance_m || 0;
      const dist = s.distance_m || 0;
      const inc = disp - prevDisplay;
      if (inc > maxStepJump) maxStepJump = inc; // (5)
      if (disp < prevDisplay - 1e-9) monoViolations++;
      const over = disp - dist;
      if (over > maxOvershoot) maxOvershoot = over;
      if (onFrame) onFrame(disp, dist, inc);
      prevDisplay = Math.max(prevDisplay, disp);
    }
  }

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

    // ── フェーズA: 巡航 8秒 (rate 確立) ──
    for (let f = 0; f < 8; f++) {
      setTarget(target + CRUISE_MPS);
      pollMs(1000);
    }

    // ── フェーズB: GPS穴 4秒 (遅れ deficit を作る) ──
    pollMs(4000);
    // 復帰 lump (穴中に進んだ分が一気に)
    setTarget(target + 4 * CRUISE_MPS);
    pollMs(2000); // lump を飲む時間

    // ── フェーズC: 減速 (target 増分を段階的に縮小・ブレーキ) ──
    const decelSteps = [9.0, 7.0, 5.0, 3.0, 1.5, 0.5]; // m / fix
    for (const stepM of decelSteps) {
      setTarget(target + stepM);
      pollMs(1000);
    }

    // ── フェーズD: 完全停車 (target 静止) ──
    //   settle 窓 (=減速の延長) の後、display は不動でなければならない。
    pollMs(SETTLE_S * 1000); // settle (まだ詰めてよい)
    const distAtStop = Meter.getState().distance_m || 0;
    const dispAtStopStart = Meter.getState().display_distance_m || 0;
    const caughtUpResidual = distAtStop - dispAtStopStart; // (a)
    let stoppedMove = 0; // (b)
    pollMs(5000, (disp) => {
      const mv = disp - dispAtStopStart;
      if (mv > stoppedMove) stoppedMove = mv;
    });

    // ── フェーズE: 確定 latch (no-op であるべき) ──
    const beforeLatch = Meter.getState().display_distance_m || 0;
    Meter.latchDisplay();
    const afterLatch = Meter.getState().display_distance_m || 0;
    const latchSnap = afterLatch - beforeLatch; // (c)

    // ── フェーズF: 再発進 (target 再成長)・display が動き出すまでの遅れ ──
    //   GPS は ~1Hz: 発進後 dt=0.5秒 で最初の fix が来る想定。表示が足す遅れを測るため
    //   「target が増えてから display が STEP_SKIP 検知未満→以上 に動くまで」を計測。
    //   ここでは fix を 0.5秒後に1つ入れ、その後 display が動き出すフレームの経過秒を測る。
    let restartDelayS = null;
    // 発進: 0.5秒待ってから最初の fix (= GPS 検知 latency 0.5秒を模す)。
    pollMs(500, () => {});
    const dispBeforeMove = Meter.getState().display_distance_m || 0;
    setTarget(target + CRUISE_MPS); // 最初の fix
    // この fix 後、display が動き出すまでの経過 (= 表示が足す遅れ)。
    let movedAfterFixS = 0;
    pollMs(2000, (disp) => {
      if (restartDelayS === null) {
        movedAfterFixS += UI_DT_MS / 1000;
        if (disp - dispBeforeMove > STEP_SKIP_MAX_M * 0.02) {
          // 実質的に動き出した (= 0.2m 以上)
          restartDelayS = movedAfterFixS; // fix 到着からの遅れ
        }
      }
    });
    if (restartDelayS === null) restartDelayS = 99; // 動き出さなかった

    // ── フェーズG: 巡航 → 再減速停車 (再収束確認) ──
    for (let f = 0; f < 4; f++) {
      setTarget(target + CRUISE_MPS);
      pollMs(1000);
    }
    for (const stepM of decelSteps) {
      setTarget(target + stepM);
      pollMs(1000);
    }
    pollMs(SETTLE_S * 1000);
    const reconvergeResidual =
      (Meter.getState().distance_m || 0) - (Meter.getState().display_distance_m || 0);

    Date.now = _realDateNow;

    // ── レポート (node 実値) ──
    console.log(
      '[stop-restart] (a) 完全停車時 残差         = ' +
        caughtUpResidual.toFixed(3) +
        ' m (<= ' +
        CAUGHT_UP_TOL_M +
        ')'
    );
    console.log(
      '[stop-restart] (b) 完全停車後 display 移動  = ' +
        stoppedMove.toFixed(4) +
        ' m (<= ' +
        STOPPED_MOVE_TOL_M +
        ')'
    );
    console.log(
      '[stop-restart] (c) 確定 latch snap          = ' +
        latchSnap.toFixed(3) +
        ' m (<= ' +
        LATCH_SNAP_TOL_M +
        ')'
    );
    console.log(
      '[stop-restart] (4) 再発進 fix→動き出し遅れ  = ' +
        restartDelayS.toFixed(3) +
        ' s (<= ' +
        RESTART_DELAY_MAX_S +
        ')'
    );
    console.log(
      '[stop-restart] (5) 最大1フレーム増分        = ' +
        maxStepJump.toFixed(3) +
        ' m (<= ' +
        STEP_SKIP_MAX_M +
        ' = 20/30m飛び禁止)'
    );
    console.log('[stop-restart]     max overshoot(先取り)    = ' + maxOvershoot.toFixed(6) + ' m');
    console.log('[stop-restart]     mono violations          = ' + monoViolations);
    console.log(
      '[stop-restart]     再収束残差               = ' + reconvergeResidual.toFixed(3) + ' m'
    );

    const checks = {
      a_caught_up: caughtUpResidual <= CAUGHT_UP_TOL_M,
      b_no_move_stopped: stoppedMove <= STOPPED_MOVE_TOL_M,
      c_latch_noop: latchSnap <= LATCH_SNAP_TOL_M,
      d_restart_delay: restartDelayS <= RESTART_DELAY_MAX_S,
      e_no_skip: maxStepJump <= STEP_SKIP_MAX_M,
      overshoot: maxOvershoot <= 0.01,
      mono: monoViolations === 0,
      reconverge: reconvergeResidual <= CAUGHT_UP_TOL_M,
    };
    const allPass = Object.values(checks).every(Boolean);
    const failed = Object.entries(checks)
      .filter(([, v]) => !v)
      .map(([k]) => k);

    if (EXPECT_FAIL) {
      if (allPass) {
        console.error('[stop-restart] FAIL: ★EXPECT_FAIL だが全 PASS してしまった★');
        process.exit(1);
      }
      console.log('[stop-restart] EXPECT_FAIL: 予期通り FAIL を確認 → ' + failed.join(', '));
      console.log('[stop-restart] 判定: PASS (= 予期した FAIL を確認・trivial-green でない)');
      process.exit(0);
    }

    if (!allPass) {
      console.error('[stop-restart] FAIL: ' + failed.join(', '));
      process.exit(1);
    }
    console.log(
      '[stop-restart] 判定: PASS (= 停車時一致・停車後不動・latch no-op・再発進≤1s・10m飛ばさず)'
    );
    process.exit(0);
  } finally {
    Date.now = _realDateNow;
  }
}

main();
