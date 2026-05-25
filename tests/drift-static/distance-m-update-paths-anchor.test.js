// tests/drift-static/distance-m-update-paths-anchor.test.js
//
// ★設計変更宣言 Phase 6-7 (2026-05-21・(M) 分離・司さん採択):
//   旧: tests/property/distance-m-update-paths.test.js 内に・行アンカー線 ±10 の
//       静的 expectedLines 検証 (C1 / C3) が混在。
//   新: 本 file へ切出し・通常 vitest では実行 (= ±10 LINE_TOLERANCE 完全保持)・
//       Stryker run では exclude。
//
//   block コードは旧 file から **byte 不変** で移動。
//
//   旧 file 由来 (= tests/property/distance-m-update-paths.test.js):
//     C1 (state.distance_m += 5 経路 line anchor) → 本 file の it 'C1'
//     C3 (GPS.calcDistance 3 経路 line anchor) → 本 file の it 'C3'
//     C2 (sanitizer marker・線アンカーなし) は旧 file に残す (= 行シフトの影響なし)

'use strict';

const fs = require('fs');
const path = require('path');

const METER_JS_PATH = path.join(__dirname, '..', '..', 'js', 'meter.js');

function loadMeterSource() {
  return fs.readFileSync(METER_JS_PATH, 'utf8');
}

describe('drift-static: meter.js distance_m += 5 経路 / GPS.calcDistance 3 経路 line anchor (旧 distance-m-update-paths.test.js C1/C3)', () => {
  it('C1: state.distance_m への代入/加算は meter.js 内で 5 経路のみ', () => {
    const source = loadMeterSource();
    const lines = source.split('\n');
    const matchedLines = [];
    const writePattern = /^\s*state\.distance_m\s*[+]?=\s*[^=]/;
    for (let i = 0; i < lines.length; i++) {
      if (writePattern.test(lines[i])) {
        matchedLines.push({ lineNo: i + 1, content: lines[i].trim() });
      }
    }
    if (matchedLines.length !== 5) {
      throw new Error(
        '述語 C 違反: distance_m 書込経路 5 経路 (L496/L576/L1043/L1064/L1461) を逸脱。検出: ' +
          JSON.stringify(matchedLines, null, 2)
      );
    }
    // 2026-05-18 更新 (Phase 3): GPS predictive + Reconciliation 追加で更に shift。
    // 旧 (Phase 2 後): [415, 484, 874, 893, 1239]
    // 旧 (Phase 3 後): [427, 496, 917, 936, 1315]
    // 2026-05-19 更新 (business_distance_m 完全分離): 4 加算経路から business 削除で shift。
    // 旧: [428, 495, 927, 945, 1324]
    // 2026-05-19 R1 更新 (Off-Road grace period): _offRoadGraceUntil 追加で shift。
    // 旧: [440, 514, 948, 966, 1345]
    // 2026-05-19 haversine 更新 (業務単位連続点累積): GPS.calcDistance 呼出追加で shift。
    // 旧: [440, 514, 955, 973, 1352]
    // 2026-05-20 室内停車中誤加算 bug 修正: state.last_gps accuracy 追加 + gap fill isStationary gate 追加で shift。
    // 旧: [440, 514, 961, 979, 1365]
    // 2026-05-24 道路 snap 構成 (= 司さん採用指示): business_active gate 並記 + ZUPT helper 追加で shift。
    // 旧: [496, 576, 1043, 1064, 1461]
    // 2026-05-24 business preview 別回路 (= business_tier2_pending_m): state 追加 + 別 if ブロック 2 件で shift。
    // 旧: [506, 622, 1099, 1120, 1517]
    // 2026-05-24 表示層 予測補間 (= business_display_distance_m + _target_velocity_mps state 追加) で shift。
    // 新: [519, 635, 1132, 1153, 1625]
    const expectedLines = [519, 635, 1132, 1153, 1625];
    // Stryker sandbox は project files をコピーする際に line offset を作る可能性あり。
    // 完全一致ではなく ±10 line 許容で drift 検出する (= 大幅 drift は捕捉・微小 offset は許容)。
    const LINE_TOLERANCE = 10;
    for (let i = 0; i < 5; i++) {
      const diff = Math.abs(matchedLines[i].lineNo - expectedLines[i]);
      if (diff > LINE_TOLERANCE) {
        throw new Error(
          '述語 C 違反: 経路 #' +
            (i + 1) +
            ' 期待 L' +
            expectedLines[i] +
            ' ±' +
            LINE_TOLERANCE +
            ' 実検出 L' +
            matchedLines[i].lineNo +
            ' (drift=' +
            diff +
            ' line・memory 更新が必要)'
        );
      }
    }
  });

  it('C3: dangerous_sources (GPS.calcDistance) は 4 箇所・うち 2 箇所 sanitizer 内 + 1 箇所 ZUPT helper + 1 箇所 gps_predictive (= 連続点許可済)', () => {
    // ★設計変更宣言 (2026-05-19・業務単位を haversine 連続点累積に移行):
    //   業界標準 (= Strava / Garmin / 米国タクシー特許) と整合・iOS speedKmh ノイズ免疫。
    //   ★絶対ルール「連続点 polyline 累積 = 許可」(meter.js L106-108) と完全整合。
    //   distance_m 加算経路には触れない (= 課金根拠不可侵維持)。
    // ★設計変更宣言 (2026-05-24・道路 snap 構成・ZUPT helper 追加):
    //   business_distance_m の・Off-Road incremental 屋内対策で・連続点 ZUPT 判定用に
    //   GPS.calcDistance 呼出 1 箇所追加 (= _isBusinessZuptMicroMotion 内)。
    //   gps_predictive_distance_m の・連続点 haversine も維持 (= 表示用・trip 単位)。
    const source = loadMeterSource();
    const lines = source.split('\n');
    const calls = [];
    for (let i = 0; i < lines.length; i++) {
      if (/GPS\.calcDistance\(/.test(lines[i]) && !/^\s*\/\//.test(lines[i])) {
        calls.push({ lineNo: i + 1, content: lines[i].trim() });
      }
    }
    if (calls.length !== 4) {
      throw new Error(
        'GPS.calcDistance 呼出件数違反: 期待 4 件 (L323 sanitizer / L373 ZUPT helper / L413 sanitizer / L1093 gps_predictive) 実検出 ' +
          calls.length +
          ' 件・' +
          JSON.stringify(calls)
      );
    }
    // L323 は _trackHaversineBetweenGps 内 (sanitizer)
    // L373 は _isBusinessZuptMicroMotion 内 (ZUPT helper・道路 snap 構成屋内対策)
    // L413 は _calculateOffRoadIncrement 内 (sanitizer)
    // L1093 は gps_predictive_distance_m 連続点累積 (= 表示用・trip 単位・連続点累積は絶対ルール許可)
    const expectedLines = [323, 373, 413, 1093];
    const LINE_TOLERANCE = 10;
    for (let i = 0; i < 4; i++) {
      const diff = Math.abs(calls[i].lineNo - expectedLines[i]);
      if (diff > LINE_TOLERANCE) {
        throw new Error(
          'GPS.calcDistance 呼出 #' +
            (i + 1) +
            ' 期待 L' +
            expectedLines[i] +
            ' ±' +
            LINE_TOLERANCE +
            ' 実検出 L' +
            calls[i].lineNo +
            ' (drift=' +
            diff +
            ' line)'
        );
      }
    }
  });
});
