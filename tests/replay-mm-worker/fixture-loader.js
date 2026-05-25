// tests/replay-mm-worker/fixture-loader.js (Phase 1 基盤・2026-05-21)
// ★設計変更宣言 Phase 1 (2026-05-21): fixture loader (= 合成 fixture + 実機 trace jsonl 両対応)
//   合成 fixture: meta + ground_truth segments + noise_model config (JSON file)
//   実機 trace : 実機計測で取得した GPS 列 (jsonl 形式) を取り込む口・現状は loader のみ提供。
//                各行 = { lat, lng, timestamp, accuracy?, speedKmh?, headingDeg?, altitude?, isStationary? }
//                先頭行は meta = { name, description, prefecture, expected_distance_m, ground_truth_segments? }
//   実機 trace 取り込み後の較正処理 (= noise model 推定) は本タスク対象外。
'use strict';

const fs = require('fs');

function loadSyntheticFixture(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    throw new Error('[fixture-loader] not found: ' + jsonPath);
  }
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const data = JSON.parse(raw);
  if (!data || !data.meta || !Array.isArray(data.meta.ground_truth_segments)) {
    throw new Error('[fixture-loader] invalid fixture: missing meta.ground_truth_segments');
  }
  return data;
}

// jsonl loader (= 実機 trace 取り込み口・1 行目 meta・2 行目以降 GPS samples)
function loadJsonlTrace(jsonlPath) {
  if (!fs.existsSync(jsonlPath)) {
    throw new Error('[fixture-loader] not found: ' + jsonlPath);
  }
  const lines = fs
    .readFileSync(jsonlPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('[fixture-loader] jsonl too short (need meta + >=1 GPS sample): ' + jsonlPath);
  }
  const meta = JSON.parse(lines[0]);
  const samples = lines.slice(1).map((l, i) => {
    try {
      return JSON.parse(l);
    } catch (e) {
      throw new Error('[fixture-loader] jsonl parse error at line ' + (i + 2) + ': ' + e.message);
    }
  });
  return { meta, samples };
}

module.exports = {
  loadSyntheticFixture,
  loadJsonlTrace,
};
