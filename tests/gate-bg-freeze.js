#!/usr/bin/env node
'use strict';
// ★物差し★ 2026-08-28 … ★どちらの採点でもない（距離の「多い少ない」を見ていない）★
//   見ているのは ★1フレームに まとめて乗るか（滑らかさ・認定メーターの「穴中も連続前進」契約）★。
//   ・タクシー認定モード(係数1.0・過大不可) … ここでは 判定していない（(C)の過大ゼロは 参考）
//   ・代行モード(係数1.0085・天井=DM Light/タイヤ真値 +0.5〜6%) … ここでは 判定していない
//   ⇒★この赤を「過大請求」と 読まないでください★。総額は 変わらない（直すと むしろ 増える）。
/* ============================================================================
 * ★bg-freeze ゲート (gate-bg-freeze.js) — 2026-06-12 / テストツール班★
 * ----------------------------------------------------------------------------
 * これは何か / なぜ要るか:
 *   ダイコメの穴埋め(トンネル/GPS stale)は gps.js の自走タイマー _gapTick
 *   (setInterval(GAP_TIMER_INTERVAL_MS)) が GPS stale 中だけ ★合成点 (synthetic・
 *   位置据え置き+t前進)★ を流して距離を連続前進させる設計。
 *
 *   ★bg-freeze (画面ロック / アプリ background) は別事象★:
 *     OS は background で setInterval を ★凍結★ する(tick が出ない=穴中の合成 coast が
 *     一切流れない)。画面復帰 (resume) すると setInterval は ★1回だけ★ 発火し、その
 *     単一フレームの timestamp 差分 = ★凍結中の経過時間そのもの★ になる。
 *     現状 pipeline-distance.js の coast 枝 (L1821〜) は dt<=obdMaxDtS(10s) なら
 *     synDelta = spd × dt を ★そのまま単フレで計上★ する(=フレーム単位の tick 予算を
 *     持たない)。結果、resume 単フレで 凍結中経過分が ★ドンと一括計上★ される。
 *     これは認定メーターの『穴中も連続前進・復帰で一括しない(滑らか)』契約に反し、
 *     実機 trace の「停車後/トンネル後のドン」と同型の欠陥。
 *
 *   本ゲートは ★実エンジン (createDistanceTracker)★ を実コードのまま動かし、
 *   bg-freeze-tunnel.json (resume 単一合成フレ) を 1 点ずつ ingest して:
 *     (A) ★ドン無し★: resume 直後の ★単フレ増分★ が、凍結中経過分(spd×freezeSec)を
 *         一括計上していない = tick サイズ予算 (spd×tick×capRatio 級) 内に収まる。
 *     (B) ★順序不変条件★: resume 合成フレを処理する時、prev は ★穴入口の実走行点★ で、
 *         合成フレ処理後に prev.synthetic が確立される(=穴明けの実点が新バッファ起点に
 *         なる前提条件)。これが崩れると穴跨ぎ平滑 / 二重計上の土台が崩れる。
 *     (C) ★過大ゼロ★: 全体 total が 凍結区間の理想 (spd×freezeSec) を超えない (never-over)。
 *
 *   ★想定 RED (現状 FAIL)★: 現コードは resume 単フレで spd×freezeSec(=20×9=180m) を
 *   そのまま乗せるため (A) が FAIL = exit 1。tick 予算化(穴中の経過を tick で割って
 *   連続前進させる/resume フレを tick 上限でクランプ)が入って初めて (A) が GREEN 化する。
 *
 * 使い方:
 *   node tests/gate-bg-freeze.js                          # PASS/FAIL
 *   node tests/gate-bg-freeze.js --json                   # 機械可読 JSON 併記
 *   node tests/gate-bg-freeze.js --fixture=fixtures/bg-freeze-tunnel.json
 *   NEG=1 node tests/gate-bg-freeze.js                    # ★負例 (RED 実証)★: 修正後挙動を
 *                                                          #   合成して『連続 tick なら PASS』を確認
 *
 * 終了コード: (A)(B)(C) いずれか不成立で 1 (FAIL)、全成立で 0。
 *
 * ★不可侵★: distance_m の意味 / calcFare / business 分離 / 過大ゼロ天井。
 *   本ゲートは pipeline-distance.js を ★require して観測するだけ★ (1byte も触らない)。
 * ※緑≠実機。本ゲートは fixture 上の bg-freeze 一括計上検出器であり実機検証の代替ではない。
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

const mod = require(path.join(__dirname, '..', 'js', 'pipeline-distance.js'));
const { createDistanceTracker, DEFAULTS } = mod;

// ---- args -------------------------------------------------------------------
function getOpt(re, dflt) {
  for (const a of process.argv.slice(2)) {
    const m = re.exec(a);
    if (m) return m[1];
  }
  return dflt;
}
const FIXTURE_ARG = getOpt(/^--fixture=(.+)$/, 'fixtures/bg-freeze-tunnel.json');
const JSON_OUT = process.argv.slice(2).includes('--json');
// 負例: 修正後の理想挙動 (resume を 1 発でなく tick 連続で流す) を合成し『連続 tick なら PASS』を実証。
//   = captive な空緑でないこと (RED は本物の欠陥検出) を裏取りする。
const NEG = process.env.NEG === '1';

// ---- 道路非依存スタブ (synthetic coast 枝は snap/road を使わない=純粋に speed×dt) -----
//   timer-continuous-advance.test.js と同一スタブ (= prod の synthetic 枝を素通しで観測)。
const stubDec = {
  snapToNearestRoad() {
    return null;
  },
  getRoadsNear() {
    return [];
  },
  calcRoadDistance() {
    return null;
  },
  decodeRoadAt() {
    return null;
  },
};
const OPT = { useSnapCache: false, enableRouting: false };

// ---- fixture ----------------------------------------------------------------
const fixturePath = path.isAbsolute(FIXTURE_ARG) ? FIXTURE_ARG : path.join(__dirname, FIXTURE_ARG);
const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const SAMPLES = Array.isArray(raw) ? raw : raw.samples;
const META = (raw && raw._meta) || {};
const FREEZE_SEC = Number.isFinite(META.freezeSec) ? META.freezeSec : 9;
const SPEED_MPS = Number.isFinite(META.speedMps) ? META.speedMps : 20;
const TICK_MS = Number.isFinite(META.tickMs) ? META.tickMs : 150;
if (!Array.isArray(SAMPLES) || !SAMPLES.length) {
  console.error('fixture に samples がありません: ' + fixturePath);
  process.exit(2);
}

// resume 合成フレ 1 発が許される最大増分 (= tick サイズ予算)。
//   穴埋めは『tick ごとに spd×tick を連続前進』が正で、単フレで凍結全経過を乗せてはいけない。
//   許容上限は never-over cap と同型 (spd×tick×smoothDopplerCapRatio) + 小マージン。
const TICK_BUDGET_M = SPEED_MPS * (TICK_MS / 1000) * (DEFAULTS.smoothDopplerCapRatio || 1.5) + 5;
// 凍結中経過分を一括計上した場合の値 (=ドンの大きさ)。これが乗ったら FAIL。
const LUMP_M = SPEED_MPS * FREEZE_SEC;

// ============================================================================
// RUN — bg-freeze 列を実エンジンに 1 点ずつ流し、resume 合成フレの単フレ増分を捕捉。
//   NEG=1 では resume を「凍結を tick 刻みに分割した連続合成」で置換し、修正後挙動を観測。
// ============================================================================
function run() {
  const tk = createDistanceTracker(stubDec, OPT);

  // prev.synthetic を観測するためのフック: ingest 前後で内部 prev は読めないが、
  //   reason / deltaM と「合成フレ直後の実点が二重計上されないか」で順序不変条件を担保する。
  //   (B) は『resume 合成フレが reason=coast で確定し、その直後の実点が lump を生まない』で判定。

  const events = []; // {tag, reason, deltaM, totalAfter}
  let resumeDelta = null;
  let postResumeExitDelta = null;

  for (let i = 0; i < SAMPLES.length; i++) {
    const s = SAMPLES[i];

    // 負例 (修正後挙動の合成): resume 合成フレを tick 刻みの連続合成で置換。
    if (NEG && s.synthetic === true && s.tag === 'resume_synthetic') {
      const prev = SAMPLES[i - 1];
      const t0 = prev && Number.isFinite(prev.t) ? prev.t : s.t - FREEZE_SEC * 1000;
      const ticks = Math.max(1, Math.round((s.t - t0) / TICK_MS));
      let lastDelta = 0;
      for (let k = 1; k <= ticks; k++) {
        const tk_t = Math.min(t0 + k * TICK_MS, s.t);
        const r = tk.ingest({
          lat: s.lat,
          lng: s.lng,
          t: tk_t,
          acc: s.acc,
          spd: s.spd,
          synthetic: true,
        });
        lastDelta = r.deltaM;
        events.push({
          tag: 'resume_tick',
          reason: r.reason,
          deltaM: r.deltaM,
          totalAfter: tk.totalM(),
        });
      }
      resumeDelta = lastDelta; // 連続化後は『単 tick 増分』(小さいはず)
      continue;
    }

    const r = tk.ingest({
      lat: s.lat,
      lng: s.lng,
      t: s.t,
      acc: s.acc,
      spd: s.spd,
      synthetic: s.synthetic === true,
      obd: s.obd === true,
    });
    const ev = { tag: s.tag || '', reason: r.reason, deltaM: r.deltaM, totalAfter: tk.totalM() };
    events.push(ev);
    if (s.tag === 'resume_synthetic') resumeDelta = r.deltaM;
    if (s.tag === 'gps_exit') postResumeExitDelta = r.deltaM;
  }

  const fl = tk.flush();
  const total = tk.totalM();

  return { events, resumeDelta, postResumeExitDelta, flushDelta: fl.deltaM, total };
}

const res = run();

// ============================================================================
// 判定
// ============================================================================
// (A) ★ドン無し★: resume 直後の単フレ増分が tick 予算内 (= 凍結全経過の一括計上でない)。
const aResume = res.resumeDelta == null ? 0 : res.resumeDelta;
const aPass = aResume <= TICK_BUDGET_M;

// (B) ★順序不変条件 (prev.synthetic 確立)★:
//   resume 合成フレは reason='coast' で確定し(=合成枝を通った=prev に被さり prev.synthetic を確立)、
//   その直後の実 GPS 復帰点 (gps_exit) は『穴明け実点』として ★二重計上しない★ こと
//   (prev.synthetic 直後の弦 cap が効く=単フレで凍結全長の弦が乗らない)。
const resumeEv = res.events.find((e) => e.tag === 'resume_synthetic' || e.tag === 'resume_tick');
const reasonOk = !!resumeEv && resumeEv.reason === 'coast';
const exitDelta = res.postResumeExitDelta == null ? 0 : res.postResumeExitDelta;
const exitNoDouble = exitDelta + res.flushDelta <= TICK_BUDGET_M + LUMP_M * 0.25; // 穴明け弦も lump 化しない
const bPass = reasonOk && exitNoDouble;

// (C) ★過大ゼロ★: total が 凍結区間理想 (spd×freezeSec) + 復帰残差マージン を超えない。
const idealM = SPEED_MPS * FREEZE_SEC; // 凍結中に実際に進んだ理想距離
const cPass = res.total <= idealM + TICK_BUDGET_M + 1e-6;

const gatePass = aPass && bPass && cPass;

// ============================================================================
// 出力
// ============================================================================
console.log('===========================================================');
console.log('★bg-freeze ゲート (画面ロック/background タイマー凍結→resume一括計上検出)★');
console.log(
  'fixture=' +
    path.basename(fixturePath) +
    ' / freeze=' +
    FREEZE_SEC +
    's / spd=' +
    SPEED_MPS +
    'm/s / tick=' +
    TICK_MS +
    'ms' +
    (NEG ? '  ★NEG(負例: resume を tick 連続化した修正後挙動)★' : '')
);
console.log(
  'tick予算(単フレ上限)=' +
    TICK_BUDGET_M.toFixed(2) +
    'm  /  凍結一括(ドン)=' +
    LUMP_M.toFixed(2) +
    'm  /  obdMaxDtS=' +
    DEFAULTS.obdMaxDtS +
    's'
);
console.log('===========================================================\n');

console.log('  # | tag               | reason     | deltaM    | totalAfter');
res.events.forEach((e, i) => {
  console.log(
    '  ' +
      String(i).padStart(1) +
      ' | ' +
      String(e.tag).padEnd(17) +
      ' | ' +
      String(e.reason).padEnd(10) +
      ' | ' +
      e.deltaM.toFixed(2).padStart(9) +
      ' | ' +
      e.totalAfter.toFixed(2)
  );
});
console.log(
  '  flush delta = ' +
    res.flushDelta.toFixed(2) +
    'm  /  final total = ' +
    res.total.toFixed(2) +
    'm\n'
);

console.log(
  '(A) ドン無し(単フレ予算内): ' +
    (aPass ? 'PASS' : '★FAIL★') +
    '  resume単フレ増分=' +
    aResume.toFixed(2) +
    'm  (<= 予算 ' +
    TICK_BUDGET_M.toFixed(2) +
    'm)  ' +
    (aPass
      ? ''
      : '← 凍結 ' + FREEZE_SEC + 's 経過分(' + LUMP_M.toFixed(0) + 'm)を単フレで一括計上=ドン')
);
console.log(
  '(B) 順序不変(prev.synthetic確立): ' +
    (bPass ? 'PASS' : '★FAIL★') +
    '  reason=coast:' +
    (reasonOk ? 'OK' : 'NG') +
    ' / 穴明け実点の二重計上なし:' +
    (exitNoDouble ? 'OK' : 'NG (exitDelta=' + (exitDelta + res.flushDelta).toFixed(2) + 'm)')
);
console.log(
  '(C) 過大ゼロ(never-over): ' +
    (cPass ? 'PASS' : '★FAIL★') +
    '  total=' +
    res.total.toFixed(2) +
    'm  (<= 理想 ' +
    (idealM + TICK_BUDGET_M).toFixed(2) +
    'm)'
);

console.log('\n===========================================================');
if (gatePass) {
  console.log('★GATE PASS★ — bg-freeze resume で一括計上(ドン)なし・順序不変・過大ゼロ維持。');
} else {
  console.log(
    '★GATE FAIL★ — bg-freeze resume で凍結経過分が単フレ一括計上された(ドン)、' +
      'または順序不変/過大ゼロ違反。穴埋めを tick 連続化(resume を tick 予算でクランプ)して断つこと。'
  );
}
console.log('※緑≠実機。本ゲートは fixture 上の bg-freeze 一括計上検出器。実機検証の代替ではない。');
console.log('※distance_m / pipeline-distance.js は read-only require のみ(1byte 不可侵)。');
console.log('===========================================================');

if (JSON_OUT) {
  console.log(
    '\n' +
      JSON.stringify(
        {
          fixture: path.basename(fixturePath),
          neg: NEG,
          freezeSec: FREEZE_SEC,
          speedMps: SPEED_MPS,
          tickMs: TICK_MS,
          tickBudgetM: +TICK_BUDGET_M.toFixed(2),
          lumpM: +LUMP_M.toFixed(2),
          resumeDelta: res.resumeDelta == null ? null : +res.resumeDelta.toFixed(2),
          exitDelta: res.postResumeExitDelta == null ? null : +res.postResumeExitDelta.toFixed(2),
          flushDelta: +res.flushDelta.toFixed(2),
          total: +res.total.toFixed(2),
          a_no_lump: aPass,
          b_order_invariant: bPass,
          c_overcount_zero: cPass,
          gate_pass: gatePass,
        },
        null,
        2
      )
  );
}

process.exit(gatePass ? 0 : 1);
