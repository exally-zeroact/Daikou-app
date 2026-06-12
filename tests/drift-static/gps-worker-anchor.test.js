// tests/drift-static/gps-worker-anchor.test.js
//
// ★設計変更宣言 Phase 6-7 (2026-05-21・(M) 分離・司さん採択):
//   旧: tests/worker/gps-worker-unit.test.js 内に・行アンカー線 ±10 の静的 grep
//       (3-AND L627 / 加速度 null 救済 L596-598) が混在。
//   新: 本 file へ切出し・通常 vitest では実行 (= 厳格度 完全保持)・Stryker run では exclude。
//
//   block コードは旧 file から **byte 不変** で移動。
//
//   旧 file 由来 (= tests/worker/gps-worker-unit.test.js):
//     it 'isStationary 判定 3-AND が L627 周辺に存在' → 本 file 同名 it
//     it '加速度サンプル null 救済 (L596-598) が存在' → 本 file 同名 it

'use strict';

const fs = require('fs');
const path = require('path');

const GPS_WORKER_PATH = path.join(__dirname, '..', '..', 'js', 'gps-worker.js');

function loadSource() {
  return fs.readFileSync(GPS_WORKER_PATH, 'utf8');
}

describe('drift-static: gps-worker.js 静止判定(加速度variance主体) / 加速度 null 救済 line anchor (旧 gps-worker-unit.test.js)', () => {
  it('isStationary 判定が加速度主体 (c1Stationary && !c2Moving) で L829 周辺に存在', () => {
    const source = loadSource();
    const lines = source.split('\n');
    // Stryker sandbox の line offset 吸収のため ±10 line window
    // 2026-05-26 更新 (Phase A-3 後退検出 追加): L627 → L647 (+20) 移動・window 同期。
    // 2026-05-26 更新 (Phase A-4 Doppler-Speed Sanity Gate 追加): L647 → L669 (+22) 移動・window 同期。
    // 2026-05-26 更新 (Phase A-5 R-only Sage-Husa 追加): L669 → L713 (+44) 移動・window 同期。
    // 2026-05-28 STEP0 診断 (_postGpsDbg helper + reject診断 追加・prettier整形込) で L784 へ移動・window 同期。
    // ★2026-05-28 ★設計変更宣言★ Fix①: 静止判定を加速度variance主体に作り直し。
    //   旧 3-AND (finalStationary = gpsStationary && c1Stationary && !c2Moving) を廃止。
    //   GPS速度(A3/Doppler)を主信号にせず・accel 主体 (c1Stationary && !c2Moving) に。L829 へ移動。
    // ★2026-05-28 Fix① v2: dwell time (= 連続 N step 観測) 追加で・main block +27 行 shift。
    //   accel主体 pattern が L858 へ移動・window 同期。
    // ★2026-05-30 §4 死コード一掃 (_calcAccelLayerHint + 定数 + _prevAccuracy 除去) で・
    //   -57 行 shift。accel主体 pattern が L801 へ移動・window 同期 (slice 790..815)。
    // ★2026-05-31 Fix④ (Doppler-速度ゲート位置受理 + CONFIG.trust_position_acc_m 追加) で
    //   +34 行 shift。accel主体 pattern が L835 へ移動・window 同期 (slice 824..849)。
    // ★2026-06-06 監査 wf_1cd1ef59 (変位継続性ゲート disp_window/disp_net_m + 全点バッファ 追加) で
    //   +36 行 shift。finalStationary pattern が L871 へ移動・window 同期 (slice 860..885)。
    const window = lines.slice(860, 885).join('\n');
    if (!/finalStationary\s*=\s*c1Stationary\s*&&\s*!c2Moving/.test(window)) {
      throw new Error(
        'gps-worker.js L835 周辺 (±10) に 加速度主体 静止判定 pattern 未検出 (drift detected)'
      );
    }
  });

  it('加速度サンプル null 救済 (位置半径 fallback) が L801 周辺に存在', () => {
    const source = loadSource();
    const lines = source.split('\n');
    // 2026-05-26 更新 (Phase A-3 後退検出 追加): L596 → L616 (+20) 移動・window 同期。
    // 2026-05-26 更新 (Phase A-4 Doppler-Speed Sanity Gate 追加): L616 → L638 (+22) 移動・window 同期。
    // 2026-05-26 更新 (Phase A-5 R-only Sage-Husa 追加): L638 → L682 (+44) 移動・window 同期。
    // 2026-05-28 STEP0 診断 (_postGpsDbg helper + reject診断 追加・prettier整形込) で L753 へ移動・window 同期。
    // ★2026-05-28 Fix①: accel 不能時は posStationary(位置半径のみ) に fallback。L801 へ移動。
    // ★2026-05-28 Fix① v2: dwell time logic 追加で +15 行 shift。accel-null pattern が L830 へ。
    // ★2026-05-30 §4 死コード一掃で -57 行 shift。accel-null pattern が L773 へ移動・
    //   window 同期 (slice 762..787)。
    // ★2026-05-31 Fix④ (Doppler-速度ゲート位置受理 + CONFIG.trust_position_acc_m 追加) で
    //   +34 行 shift。accel-null pattern が L807 へ移動・window 同期 (slice 796..821)。
    // ★2026-06-06 監査 wf_1cd1ef59 (変位継続性ゲート 追加) で +36 行 shift。
    //   accel-null pattern が L843 へ移動・window 同期 (slice 832..857)。
    const window = lines.slice(832, 857).join('\n');
    // accelVariance === null && accelDeviation === null で位置半径 fallback 採用
    if (!/accelVariance\s*===\s*null\s*&&\s*accelDeviation\s*===\s*null/.test(window)) {
      throw new Error(
        'gps-worker.js L807 周辺 (±10) に 加速度 null 救済 pattern 未検出 (drift detected)'
      );
    }
  });
});
