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

describe('drift-static: gps-worker.js 3-AND gate / 加速度 null 救済 line anchor (旧 gps-worker-unit.test.js)', () => {
  it('isStationary 判定 3-AND が L627 周辺に存在', () => {
    const source = loadSource();
    const lines = source.split('\n');
    // Stryker sandbox の line offset 吸収のため ±10 line window
    const window = lines.slice(617, 640).join('\n');
    if (!/finalStationary\s*=\s*gpsStationary\s*&&\s*c1Stationary\s*&&\s*!c2Moving/.test(window)) {
      throw new Error(
        'gps-worker.js L627 周辺 (±10) に 3-AND 判定 pattern 未検出 (drift detected)'
      );
    }
  });

  it('加速度サンプル null 救済 (L596-598) が存在', () => {
    const source = loadSource();
    const lines = source.split('\n');
    const window = lines.slice(586, 608).join('\n');
    // accelVariance === null && accelDeviation === null で gpsStationary 単独採用
    if (!/accelVariance\s*===\s*null\s*&&\s*accelDeviation\s*===\s*null/.test(window)) {
      throw new Error(
        'gps-worker.js L596-598 周辺 (±10) に 加速度 null 救済 pattern 未検出 (drift detected)'
      );
    }
  });
});
