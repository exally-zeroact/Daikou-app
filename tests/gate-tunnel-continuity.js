#!/usr/bin/env node
'use strict';
// ★物差し★ 2026-08-28 … ★どちらの採点でもない（距離の「多い少ない」を見ていない）★
//   見ているのは ★穴の出口で 1フレームに まとめて乗るか★。
//   ・真値と比べた結果は 別の道具に在る（tests/tools/realtest-dm-score.js）:
//     ★DM Light 基準で 実車1 −1.36% / 実車2 −1.51%＝天井(+0.5〜6%)の 中どころか 下★（2026-08-28 実測）
//   ⇒★この赤を「過大請求」と 読まないでください★。

// ============================================================================
// tests/gate-tunnel-continuity.js
//   ★トンネル連続性ゲート (tunnel-continuity) — テストツール班★
// ----------------------------------------------------------------------------
// これは何か / なぜ要るか:
//   大トンネル (しまなみ海道) では GPS が長時間 stale になり (dt が数十〜百秒の「穴」)、
//   穴の出口で位置が一気に飛ぶ。距離パイプラインが穴中に距離を ★連続前進させず★、
//   出口フレームで ★+1000m 級を 1 フレームに一括計上 (一括ドン)★ すると、メーターが
//   トンネル出口でガクッと跳ね、過大課金・非連続表示の温床になる (メモリ
//   project_daikome_realtest_2026-06-10_tunnel_rootcause / tunnel_gps_fill_investigation 参照)。
//
//   本ゲートは shimanami-{Android,iPhone13,iPhoneSE}.json を ★実エンジン★
//   (js/pipeline-distance.js の createDistanceTracker) に 1 フレームずつ流し、
//   各フレームの ★単フレーム距離増分 dDelta★ が物理連続上限
//       dDelta <= max(FLOOR_M(10m), 直近確立速度 estSpd(m/s) × dt(s) × SPEED_RATIO(1.5))
//   を満たすことを ★全 fixture・全 業務走行フレーム★ で assert する。
//   超えたフレームが 1 つでもあれば ★exit 1 (FAIL)★。
//
//   ★直近確立速度★ = 直前までに観測した最後の有効 Doppler 速度 (spd>=0・m/s)。穴中は
//   Doppler が落ちる (spd=-1) ため、穴入口直前で確立した速度を上限の基準に使う
//   (= 認定メーター/二葉方式の「穴中も確立速度で連続前進」と同じ拘束)。連続前進していれば
//   各フレームの増分は estSpd×dt 近傍に収まり、一括ドンは起き得ない。
//
//   ★想定 RED (空緑でない証明)★: shimanami-iPhone13 のトンネル (i≈864 で dt≈95.7s の穴) の
//   出口フレーム (i≈865・dt≈1.2s) で現状 dDelta≈+1083m / 上限≈22m → ★捕捉して FAIL★。
//   Android/iPhoneSE のトンネル出口でも同様の一括ドンを捕捉する。
//
// 距離 read-only:
//   js/pipeline-distance.js (および roads-decoder.js / data/roads-*.js) は ★1 byte も触らない★。
//   require して ingest() の戻り (deltaM/totalM/reason) を ★観測するだけ★。distance_m 本体・
//   calcFare・業務分離・過大ゼロ (distance_m<=真距離) は不可侵。
//   ※緑≠実機。本ゲートは fixture 上のトンネル連続性回帰/欠陥検出器。実機検証の代替ではない。
//
// 使い方:
//   node tests/gate-tunnel-continuity.js            # PASS/FAIL + 違反フレーム表
//   node tests/gate-tunnel-continuity.js --json      # 機械可読 JSON も
//   node tests/gate-tunnel-continuity.js --all-frames # 業務走行外も含め全フレーム判定 (参考)
// 終了コード: いずれかの fixture で連続上限超過フレームがあれば 1、無ければ 0。
// ============================================================================

const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..');
const PREF = (process.env.ROADS_PREF || 'ehime').toLowerCase();
const JSON_OUT = process.argv.slice(2).includes('--json');
const ALL_FRAMES = process.argv.slice(2).includes('--all-frames');

// ── 連続上限パラメータ (仕様) ──
const FLOOR_M = 10.0; // dDelta の床 (低速/微小 dt の正当な増分や丸めを誤検出しない)
const SPEED_RATIO = 1.5; // 直近確立速度 × dt の許容倍率 (カーブ/加速の余裕込み)
const HOLE_DT_SEC = 5.0; // dt がこれ超 = GPS 穴 (トンネル/欠落)。穴/穴出口フレームを別集計するのに使う
// 違反集計でゲート判定に使うのは ALL_FRAMES でない限り「業務走行 (act=1 && it=1)」フレームのみ。
// (★業務別のみ★ ルール: 走行外の trip 境界メガギャップ等を distance 欠陥と混同しない)

// ★2026-08-28 … .slim に 向け直した★（指示役の裁定③）
//   ★前は shimanami-*.json（full）を見ていましたが 両repoに 1本も在りません★。
//   ＝'fixture 無し' で throw し、cert-gate.yml の soft: true が それを ✓ に見せていました。
//   ★実物が在るのは .slim（間引き済みの 実機走行）★＝これで ★本当に測れます★。
//   ★材料が 切り貼りでない事を 先に確かめた（2026-08-28 実測）★:
//     ・1〜2秒で 100m 超 動く点 = ★0個★（＝つなぎ目の偽物の飛びは 無い）
//     ・dt>5秒 = 5個（i250 は 3692秒＝別の運行の境目・残り4つが 本物の穴）
//   ⇒ full が 手に入ったら ここを戻す。その時は ★点数と判定を 並べて 比べる★。
const FIXTURES = [
  ['Android', 'shimanami-Android.slim.json'],
  ['iPhone13', 'shimanami-iPhone13.slim.json'],
  ['iPhoneSE', 'shimanami-iPhoneSE.slim.json'],
];

// ── decoder ロード (tests/replay-pipeline-distance.js と同一手法・完全オフライン) ──
function loadDecoder(pref) {
  global.window = global;
  global.self = global;
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(BASE, 'js', 'roads-decoder.js'), 'utf8')); // → global.RoadDecoder
  const dataFile = path.join(BASE, 'data', 'roads-' + pref + '.js');
  if (!fs.existsSync(dataFile)) throw new Error('roads データ無し: ' + dataFile);
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(dataFile, 'utf8')); // → global.ROADS_<PREF>
  const key = 'ROADS_' + pref.toUpperCase();
  const roadsData = global[key];
  if (!roadsData) throw new Error('global.' + key + ' 未定義');
  const dec = new global.RoadDecoder(roadsData);
  dec.buildOffsetTable();
  return dec;
}

function loadFixture(name) {
  const p = path.join(__dirname, 'fixtures', name);
  if (!fs.existsSync(p)) throw new Error('fixture 無し: ' + p);
  // ★材料は 2つの形が 在る★（配列そのまま／{meta, samples}）2026-08-28
  //   前は 配列しか読めず、{meta,samples} の材料に向けると
  //   'JSON.parse(...).filter is not a function' で落ちました（＝真値つきの材料が 使えなかった）。
  const _raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const _arr = Array.isArray(_raw) ? _raw : _raw.samples || _raw.points || [];
  if (!_arr.length) throw new Error('fixture に 点が 無い: ' + p);
  return _arr
    .filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .sort((a, b) => (a.t || 0) - (b.t || 0));
}

function isDriving(s) {
  const b = s.biz || {};
  return b.act === 1 && b.it === 1;
}

// ── 1 fixture を createDistanceTracker に流し、各フレームの連続上限超過を検出する ──
function analyze(dec, PD, samples) {
  const tk = PD.createDistanceTracker(dec, { enableRouting: true });
  let estSpd = -1; // 直近確立速度 (m/s・最後の有効 Doppler)
  let prevT = null;
  const violations = [];
  let drivingFrames = 0;
  let maxDelta = 0;
  let maxAt = -1;
  let holeFrames = 0;

  for (let i = 0; i < samples.length; i++) {
    const g = samples[i];
    const r = tk.ingest(g);
    const delta = r.deltaM || 0;
    const dt = prevT != null && Number.isFinite(g.t) ? (g.t - prevT) / 1000 : 0;
    const driving = isDriving(g);
    const inHole = dt > HOLE_DT_SEC;
    if (inHole) holeFrames++;

    // ★連続上限★: max(床, 直近確立速度 × dt × 倍率)。estSpd 未確立(=-1)時は床のみ。
    const physMax = estSpd >= 0 && dt > 0 ? estSpd * dt * SPEED_RATIO : 0;
    const bound = Math.max(FLOOR_M, physMax);

    const consider = ALL_FRAMES || driving;
    if (consider) {
      drivingFrames++;
      if (delta > maxDelta) {
        maxDelta = delta;
        maxAt = i;
      }
      if (delta > bound + 1e-6) {
        violations.push({
          idx: i,
          deltaM: +delta.toFixed(2),
          bound_m: +bound.toFixed(2),
          dt_s: +dt.toFixed(2),
          estSpd_mps: estSpd >= 0 ? +estSpd.toFixed(2) : null,
          reason: r.reason,
          inHole: inHole,
          // 穴出口の一括ドンは「直前 dt が穴」のフレームで起きるので prevDt も残す
          tc: (g.biz || {}).tc,
        });
      }
    }

    // 直近確立速度の更新 (有効 Doppler のみ)。穴中 spd=-1 は estSpd を据え置き
    // (= 穴入口直前の確立速度を上限基準として保持する)。
    if (typeof g.spd === 'number' && g.spd >= 0) estSpd = g.spd;
    if (Number.isFinite(g.t)) prevT = g.t;
  }

  return {
    points: samples.length,
    consideredFrames: drivingFrames,
    holeFrames: holeFrames,
    totalM: +tk.totalM().toFixed(1),
    maxDeltaM: +maxDelta.toFixed(2),
    maxDeltaAt: maxAt,
    violations: violations,
  };
}

function main() {
  const PD = require(path.join(BASE, 'js', 'pipeline-distance.js'));
  if (typeof PD.createDistanceTracker !== 'function') {
    throw new Error('pipeline-distance.js: createDistanceTracker export 不整合');
  }
  const dec = loadDecoder(PREF);

  console.log('===========================================================');
  console.log('★トンネル連続性ゲート (tunnel-continuity)★');
  console.log(
    '  連続上限: dDelta <= max(' +
      FLOOR_M +
      'm, 直近確立速度×dt×' +
      SPEED_RATIO +
      ')   判定対象=' +
      (ALL_FRAMES ? '全フレーム' : '業務走行フレーム(act=1&&it=1)')
  );
  console.log('  距離 read-only (pipeline-distance.js は触らない・ingest() を観測のみ)');
  console.log('===========================================================\n');

  const report = {
    pref: PREF,
    floor_m: FLOOR_M,
    speed_ratio: SPEED_RATIO,
    hole_dt_sec: HOLE_DT_SEC,
    all_frames: ALL_FRAMES,
    fixtures: {},
  };

  let gateFail = false;
  for (const [label, file] of FIXTURES) {
    const samples = loadFixture(file);
    const a = analyze(dec, PD, samples);
    report.fixtures[label] = a;

    const ok = a.violations.length === 0;
    if (!ok) gateFail = true;

    console.log('───────────────────────────────────────────────────────────');
    console.log(
      '【' +
        label +
        '】 ' +
        a.points +
        '点 / 判定対象 ' +
        a.consideredFrames +
        ' / 穴(dt>' +
        HOLE_DT_SEC +
        's) ' +
        a.holeFrames +
        ' / total ' +
        (a.totalM / 1000).toFixed(3) +
        'km'
    );
    console.log(
      '  最大 dDelta = ' + a.maxDeltaM + 'm @i' + a.maxDeltaAt + '  → ' + (ok ? 'PASS' : 'FAIL')
    );
    if (!ok) {
      console.log('  ★連続上限超過 ' + a.violations.length + ' フレーム (= トンネル等で一括ドン)★');
      for (const v of a.violations.slice(0, 8)) {
        console.log(
          '    i' +
            v.idx +
            ' (tc=' +
            v.tc +
            ')  dDelta=' +
            v.deltaM +
            'm  上限=' +
            v.bound_m +
            'm  dt=' +
            v.dt_s +
            's  確立速度=' +
            (v.estSpd_mps == null ? '—' : v.estSpd_mps + 'm/s') +
            '  reason=' +
            v.reason +
            (v.inHole ? '  [穴フレーム]' : '')
        );
      }
      if (a.violations.length > 8) {
        console.log('    … 他 ' + (a.violations.length - 8) + ' フレーム');
      }
    }
    console.log('');
  }

  report.pass = !gateFail;

  console.log('===========================================================');
  if (gateFail) {
    console.log(
      '★GATE FAIL★ — トンネル/穴の出口で単フレーム距離増分が連続上限を超過 (一括ドン) する fixture あり。'
    );
    console.log(
      '  穴中も確立速度で連続前進させ、出口で一括計上しない実装が入れば全 fixture GREEN になる。'
    );
  } else {
    console.log(
      '★GATE PASS★ — 全 fixture・全判定フレームで dDelta ≤ 連続上限 (トンネル一括ドンなし)。'
    );
  }
  console.log('※緑≠実機。本ゲートは fixture 上のトンネル連続性検出器。実機検証の代替ではない。');
  console.log('===========================================================');

  const OUT_DIR = path.join(BASE, 'data', 'test-results');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, 'gate-tunnel-continuity.json'),
    JSON.stringify(report, null, 2)
  );
  console.log('\n[gate] wrote data/test-results/gate-tunnel-continuity.json');

  if (JSON_OUT) console.log('\n' + JSON.stringify(report, null, 2));

  process.exit(gateFail ? 1 : 0);
}

if (require.main === module) main();

module.exports = { analyze, loadDecoder, FLOOR_M, SPEED_RATIO, HOLE_DT_SEC };
