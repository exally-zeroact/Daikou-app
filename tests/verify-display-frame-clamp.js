#!/usr/bin/env node
'use strict';

// tests/verify-display-frame-clamp.js
// ★タブ復帰/描画間引き (dtFrame 巨大化) の「飛び」防止契約 (2026-05-31)★
//
//   監査官 (edge-cases) が発見: _smoothDisplay の step = catchupRate * dtFrame の dtFrame が
//   無制限だと、30秒タブ隠れ→復帰の ★1フレームで gap 全量 (実測 最大 840m) を一撃着地★ し、
//   司さんの「20/30m を一気に飛ばさない (10m 単位で動く)」契約に違反する。
//   (overshoot=0/単調 は保持されるので課金は安全・壊れるのは"滑らかさ"=飛び)。
//
//   契約: ★どんなに dtFrame が大きくても 1フレームの display 前進 ≤ 10m★ (= DISP_MAX_FRAME_DT_S
//   による dtFrame clamp で頭打ち)。残り gap は次フレーム以降で連続的に詰めて収束する。
//   display ≤ distance_m (先取りゼロ)・単調 も全フレーム維持。
//
//   ★絶対不可侵★: distance_m / calcFare は読むだけ。表示層のみ。
//   使い方: node tests/verify-display-frame-clamp.js  (EXPECT_FAIL=1 で clamp 前の飛びを確認)

const path = require('path');
const Meter = require(path.join(__dirname, '..', 'js', 'meter.js'));

const STEP_SKIP_MAX_M = 10.0; // 1フレーム前進の上限 (= 飛び禁止)
const EXPECT_FAIL = process.env.EXPECT_FAIL === '1';

function main() {
  const _realDateNow = Date.now;
  let _mockNow = 1_700_000_000_000;
  Date.now = () => _mockNow;

  let prevDisplay = 0;
  let maxStepJump = 0;
  let maxOvershoot = 0;
  let monoViolations = 0;
  let target = 0;

  function setTarget(v) {
    target = v;
    Meter.setDistance(target);
  }
  function frame(advanceMs) {
    _mockNow += advanceMs;
    const s = Meter.getState();
    const disp = s.display_distance_m || 0;
    const dist = s.distance_m || 0;
    const inc = disp - prevDisplay;
    if (inc > maxStepJump) maxStepJump = inc;
    if (disp < prevDisplay - 1e-9) monoViolations++;
    if (disp - dist > maxOvershoot) maxOvershoot = disp - dist;
    prevDisplay = Math.max(prevDisplay, disp);
    return { disp, dist };
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

    // 巡航 5秒 (rate 確立・60Hz)
    for (let f = 0; f < 5; f++) {
      setTarget(target + 11.1);
      for (let k = 0; k < 60; k++) frame(17);
    }

    // ★大 gap を作る★: distance_m を一気に +300m (= 長い穴の routed lump 相当)
    setTarget(target + 300);

    // ★タブ復帰を模す: 次の1フレームが 30秒後に来る (dtFrame=30s)★
    const before = Meter.getState().display_distance_m || 0;
    const r = frame(30000); // ← clamp が無ければここで +300m 一撃 (= 飛び)
    const firstFrameJump = r.disp - before;

    // 復帰後 rAF 60Hz で連続描画 → 残り gap を滑らかに詰める
    for (let k = 0; k < 60 * 30; k++) frame(17); // 30秒 60Hz
    const afterConverge = Meter.getState();
    const residual = (afterConverge.distance_m || 0) - (afterConverge.display_distance_m || 0);

    Date.now = _realDateNow;

    console.log(
      '[frame-clamp] タブ復帰1フレーム前進     = ' +
        firstFrameJump.toFixed(3) +
        ' m (<= ' +
        STEP_SKIP_MAX_M +
        ')'
    );
    console.log(
      '[frame-clamp] 全フレーム最大前進        = ' +
        maxStepJump.toFixed(3) +
        ' m (<= ' +
        STEP_SKIP_MAX_M +
        ')'
    );
    console.log('[frame-clamp] max overshoot(先取り)     = ' + maxOvershoot.toFixed(6) + ' m');
    console.log('[frame-clamp] mono violations           = ' + monoViolations);
    console.log('[frame-clamp] 復帰後 収束残差           = ' + residual.toFixed(4) + ' m');

    const noSkip = maxStepJump <= STEP_SKIP_MAX_M;
    const ok = noSkip && maxOvershoot <= 0.01 && monoViolations === 0 && residual <= 0.5;

    if (EXPECT_FAIL) {
      if (ok) {
        console.error('[frame-clamp] FAIL: ★EXPECT_FAIL だが PASS してしまった (clamp 済?)★');
        process.exit(1);
      }
      console.log(
        '[frame-clamp] EXPECT_FAIL: 予期通り飛び/未収束を確認 (1フレーム=' +
          maxStepJump.toFixed(1) +
          'm)'
      );
      process.exit(0);
    }
    if (!ok) {
      console.error(
        '[frame-clamp] FAIL: ' +
          (!noSkip ? '1フレーム飛び ' + maxStepJump.toFixed(1) + 'm > ' + STEP_SKIP_MAX_M : '') +
          (maxOvershoot > 0.01 ? ' overshoot' : '') +
          (monoViolations ? ' mono' : '') +
          (residual > 0.5 ? ' 未収束' : '')
      );
      process.exit(1);
    }
    console.log(
      '[frame-clamp] 判定: PASS (= タブ復帰でも1フレーム ≤10m・飛ばさず・先取りゼロ・収束)'
    );
    process.exit(0);
  } finally {
    Date.now = _realDateNow;
  }
}

main();
