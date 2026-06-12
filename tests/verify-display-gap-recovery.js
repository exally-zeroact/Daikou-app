#!/usr/bin/env node
'use strict';

// tests/verify-display-gap-recovery.js
// ★GPS穴(gap)→復帰 の表示契約 (2026-05-31・実機「固まって→ドン」の根治テスト)★
//
//   司さん実機症状:「メーターが固まっていきなり何十mドンって増える」。
//   even-pace テスト (verify-display-even-pace.js) は ★定速1Hz・GPS穴なし★ しか見ておらず、
//   この症状を全く捕捉できない。本テストは ★GPS穴 (target が数秒凍る) → 復帰時の lump ジャンプ★
//   を注入し、表示層 (_smoothDisplay) の挙動を測る。
//
//   ★認定整合 (最重要)★: タクシー認定は「display ≤ 確定 distance_m・過大ゼロ・先取り禁止」。
//   よって「gap 中に確定距離を超えて進める」= 先取り = 認定違反 = やらない。
//   gap 中の固まり低減は ★距離層 (distance_m が gap 中に道路 routing で進むか = STEP2)★ の役目。
//   ★表示層の責務 = 復帰時の lump ジャンプを「ドン」でなく直近速度基準で滑らかに飲むこと★。
//
//   検証項目:
//     (a) ★復帰ドン無し★: distance_m が lump で一気に増えた時、display の追従速度が
//         ★物理的に妥当な上限 (= 直近走行速度の数倍以内)★ に収まり、55m/s 張り付きの「ドン」を出さない。
//         現行は DISP_RATE_MAX_MPS=55 に張り付くため ★FAIL するはず★ (= trivial-green でない証明)。
//     (b) ★過大ゼロ (認定)★: display ≤ distance_m を全フレーム維持 (先取り/overshoot ゼロ)。
//     (c) 単調非減少 (display は後退しない)。
//     (d) ★収束★: 復帰後しばらくで display は distance_m に追いつく (置き去り lag が永続しない)。
//     (e) gap 固まり時間 (= 診断): target 凍結中に display が止まる秒数を記録 (gate は距離層 STEP2)。
//
//   ★絶対不可侵★: distance_m / calcFare / 課金経路は読むだけ。表示層のみ検証。
//
//   使い方:
//     node tests/verify-display-gap-recovery.js
//     EXPECT_DON=1 node tests/verify-display-gap-recovery.js  … 現行で (a) が FAIL する事を確認 (exit 0)
//   exit 0 = PASS (契約満たす or 予期 FAIL 確認) / 非0 = FAIL。

const path = require('path');
const Meter = require(path.join(__dirname, '..', 'js', 'meter.js'));

const UI_HZ = 30;
const UI_DT_MS = 1000 / UI_HZ;
const SPEED_MPS = 11.1; // ~40 km/h 定速
const STEP_M = SPEED_MPS; // 1Hz fix での 1 step 増分

// (a) 復帰ドン上限: display 追従の瞬間速度がこの値を超えたら「ドン」とみなす。
//   直近走行速度 11.1m/s の ~2.2 倍 = 25 m/s (= 90km/h) を妥当上限とする (= 物理的な追従の余裕)。
//   現行は lump/dtTarget が大きく inst が 55m/s cap に張り付く → これを超え FAIL するはず。
const RECOVERY_RATE_MAX_MPS = 25.0;
const OVERSHOOT_TOL_M = 0.01; // (b)
const CONVERGE_TOL_M = 0.5; // (d) 収束とみなす残差
const SIT_EPS_M = (STEP_M / UI_HZ) * 0.15; // 実質不動とみなす frame 増分

const EXPECT_DON = process.env.EXPECT_DON === '1';

function fail(msg) {
  console.error('[gap-recovery] FAIL: ' + msg);
  process.exit(1);
}

function main() {
  const _realDateNow = Date.now;
  let _mockNow = 1_700_000_000_000;
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

    let target = 0;
    let prevDisplay = 0;
    let maxOvershoot = 0;
    let monoViolations = 0;

    // poll を回しつつ display を観測するヘルパ (mockNow を進める)。
    const pollFor = (ms, onFrame) => {
      const ticks = Math.max(1, Math.round(ms / UI_DT_MS));
      for (let k = 0; k < ticks; k++) {
        _mockNow += Math.round(UI_DT_MS);
        const s = Meter.getState();
        const disp = s.display_distance_m || 0;
        const dist = s.distance_m || 0;
        const inc = disp - prevDisplay;
        const rate = inc / (UI_DT_MS / 1000); // m/s
        if (disp < prevDisplay - 1e-9) monoViolations++;
        const over = disp - dist;
        if (over > maxOvershoot) maxOvershoot = over;
        if (onFrame) onFrame({ disp, dist, inc, rate });
        prevDisplay = Math.max(prevDisplay, disp);
      }
    };

    // ── フェーズ1: 定速10秒 (rate EMA を実速度に確立) ──
    for (let f = 0; f < 10; f++) {
      target += STEP_M;
      Meter.setDistance(target);
      pollFor(1000);
    }

    // ── フェーズ2: GPS穴 5秒 (target 凍結・UI は回り続ける) ──
    //   車は動いとる (= 真の距離は 5*STEP_M 増えとる) が GPS が来ず target 凍結。
    const gapStartDisp = Meter.getState().display_distance_m || 0;
    let gapFreezeFrames = 0; // display がほぼ止まったフレーム数
    const GAP_SEC = 5;
    pollFor(GAP_SEC * 1000, ({ inc }) => {
      if (inc < SIT_EPS_M) gapFreezeFrames++;
    });
    const gapEndDisp = Meter.getState().display_distance_m || 0;
    const gapFreezeSec = gapFreezeFrames / UI_HZ;

    // ── フェーズ3: 復帰 = gap中に進んだ分の lump ジャンプが一気に来る ──
    //   distance_m += (5秒分の道路距離) を 1 tick で。これが「ドン」の源。
    const lump = GAP_SEC * STEP_M; // 55.5m を一気に
    target += lump;
    Meter.setDistance(target);
    let recoveryMaxRate = 0;
    let recoveryDon = false;
    // 復帰直後 ~6 秒の追従を観測 (= lump を飲む過程)。
    pollFor(6000, ({ rate, dist, disp }) => {
      if (rate > recoveryMaxRate) recoveryMaxRate = rate;
      if (rate > RECOVERY_RATE_MAX_MPS) recoveryDon = true;
      void dist;
      void disp;
    });

    // ── フェーズ4: 定速再開して収束確認 ──
    for (let f = 0; f < 5; f++) {
      target += STEP_M;
      Meter.setDistance(target);
      pollFor(1000);
    }
    const finalState = Meter.getState();
    const convergeGap = (finalState.distance_m || 0) - (finalState.display_distance_m || 0);

    // ── latch ──
    Meter.latchDisplay();
    const lat = Meter.getState();
    const latchGap = Math.abs((lat.display_distance_m || 0) - (lat.distance_m || 0));

    Date.now = _realDateNow;

    // ── レポート (node 実値・捏造なし) ──
    console.log(
      '[gap-recovery] gap 固まり時間 (e, 診断)      = ' +
        gapFreezeSec.toFixed(2) +
        ' s (gap=' +
        GAP_SEC +
        's 中・gapStart→end disp ' +
        gapStartDisp.toFixed(1) +
        '→' +
        gapEndDisp.toFixed(1) +
        'm)'
    );
    console.log(
      '[gap-recovery] 復帰 lump                      = ' +
        lump.toFixed(1) +
        ' m を 1 tick で distance_m に加算'
    );
    console.log(
      '[gap-recovery] 復帰 max 追従速度 (a, <= ' +
        RECOVERY_RATE_MAX_MPS +
        ') = ' +
        recoveryMaxRate.toFixed(2) +
        ' m/s' +
        (recoveryDon ? '  ★ドン検出★' : '')
    );
    console.log(
      '[gap-recovery] max overshoot (b, <= ' +
        OVERSHOOT_TOL_M +
        ')    = ' +
        maxOvershoot.toFixed(6) +
        ' m'
    );
    console.log('[gap-recovery] mono violations (c)            = ' + monoViolations);
    console.log(
      '[gap-recovery] 収束残差 (d, <= ' +
        CONVERGE_TOL_M +
        ')         = ' +
        convergeGap.toFixed(4) +
        ' m'
    );
    console.log('[gap-recovery] latch gap                      = ' + latchGap.toFixed(6) + ' m');

    // ── 判定 (認定不変は常に gate) ──
    if (monoViolations > 0) fail('(c) display 後退 ' + monoViolations + ' 回');
    if (maxOvershoot > OVERSHOOT_TOL_M)
      fail('(b) overshoot/先取り ' + maxOvershoot.toFixed(6) + ' m (= 認定 過大違反)');
    if (latchGap > 0.001)
      fail('latch 後 display != distance_m・乖離 ' + latchGap.toFixed(6) + ' m');
    if (convergeGap > CONVERGE_TOL_M)
      fail('(d) 復帰後 display が distance_m に収束しない・残差 ' + convergeGap.toFixed(4) + ' m');

    const donOk = recoveryMaxRate <= RECOVERY_RATE_MAX_MPS;

    if (EXPECT_DON) {
      if (donOk)
        fail(
          '★EXPECT_DON だが (a) ドン無し契約が PASS してしまった★ (= 既に直っとる or テストがドンを検出できてない)'
        );
      console.log(
        '[gap-recovery] EXPECT_DON: (a) は予期通り FAIL を確認 (復帰速度 ' +
          recoveryMaxRate.toFixed(2) +
          ' > ' +
          RECOVERY_RATE_MAX_MPS +
          ' m/s = 「ドン」)。= 現行の rate 55m/s 張り付きを本テストが捕捉。'
      );
      console.log('[gap-recovery] 判定: PASS (= 予期した FAIL を確認)');
      process.exit(0);
    }

    if (!donOk)
      fail(
        '(a) 復帰ドン: 追従速度 ' +
          recoveryMaxRate.toFixed(2) +
          ' m/s > ' +
          RECOVERY_RATE_MAX_MPS +
          ' (= lump を一気に飲んで「ドン」)。直近速度基準で rate 上限を。'
      );

    console.log('[gap-recovery] 判定: PASS (= 復帰ドン無し・過大ゼロ・単調・収束・latch一致)');
    process.exit(0);
  } finally {
    Date.now = _realDateNow;
  }
}

main();
