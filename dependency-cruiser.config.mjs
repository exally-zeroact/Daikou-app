/* eslint-env node */
// dependency-cruiser config (2026-05-17 新規・Stage 1)
// 目的: 循環依存禁止 + module 境界ルール検査
// 対象: js/ + scripts/zeroact-test-commons/
// 既存ファイル無変更原則: 違反検出時は別 commit で修正・このルール自体は触らない
//
// ─── ダイコメ知識注入 (2026-05-18) ───────────────────────────────
//
// 【絶対ルール】
//   distance_m は課金根拠・絶対不可侵 / GPS 直線距離での課金禁止 /
//   道路ジオメトリ沿いのみ
//
// 【アーキテクチャ・依存方向】
//   gps.js → Worker A (gps-worker.js) → main thread → meter.js →
//   Worker B (map-matcher.js)
//   全 hop は main thread 経由 (= 2-hop messaging)
//   Worker A → Worker B の直接通信なし
//
// 【dep-cruiser 検出限界】
//   ダイコメ js/*.js は IIFE 設計 + <script src> 読込で require/import を
//   使わない (= dep-cruiser の依存グラフ追跡対象外)。
//   結果として js/*.js が全て orphan 扱い (= 24 warnings)・これは設計通り。
//   循環依存・解決不能 import の検出は scripts/zeroact-test-commons/ 配下で有効。
//
// 【期待依存関係 (= informational・dep-cruiser では検出不能だが設計意図として記録)】
//   index.html → js/meter.js / gps.js / map-matcher.js / gps-worker.js 等
//   js/meter.js (main thread) → js/map-matcher.js (= new Worker 経由 Worker B)
//   js/gps.js (main thread) → js/gps-worker.js (= new Worker 経由 Worker A)
//   js/meter.js (main thread) ← js/gps.js (= onUpdateCallback 経由)

export default {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: '循環依存禁止 (= require/import の輪を作らない)',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: '孤立モジュール (entry から到達不能) は warn',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '\\.test\\.js$',
          '\\.spec\\.js$',
          '\\.config\\.(js|mjs)$',
          'tests/lib/',
        ],
      },
      to: {},
    },
    {
      name: 'no-unresolvable',
      severity: 'error',
      comment: '解決できない require/import (= 存在しない module) は error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-cross-worker-direct',
      severity: 'error',
      comment:
        'Worker A (gps-worker.js) と Worker B (map-matcher.js) の直接 import 禁止 ' +
        '(= main thread 経由 2-hop messaging 必須・絶対ルール準拠)',
      from: { path: '^js/(gps-worker|map-matcher)\\.js$' },
      to: { path: '^js/(gps-worker|map-matcher)\\.js$' },
    },
    {
      name: 'no-sw-direct-import',
      severity: 'error',
      comment:
        'js/*.js から sw.js への直接 import 禁止 ' +
        '(= sw.js は別系統 runtime・PRECACHE 規約に影響するため独立性維持)',
      from: { path: '^js/' },
      to: { path: '^sw\\.js$' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    includeOnly: '^(js|scripts/zeroact-test-commons)/',
    exclude: 'node_modules|data|coverage|test-results',
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
