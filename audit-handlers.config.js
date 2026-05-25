'use strict';
/* eslint-env node */

// ============================================================
// audit-handlers.config.js (ダイコメ用設定・2026-05-17 新規)
//   ZEROact 共通テスト基盤 audit-message-handlers の入力ファイル。
//   ダイコメの postMessage 接続 (Worker A / Worker B / SW) を網羅。
//
//   allowDeadHandlers には「現状送信されていないが Worker B 内に handler が
//   存在するもの (= 既知の dead handler)」を明示登録する。
//   将来送信側を実装したら allowlist から外す運用。
// ============================================================

module.exports = {
  name: 'daikome',
  channels: [
    // ─── Worker B (map-matcher.js) チャネル ─────────────────────────
    {
      channel: 'mm-worker-b',
      handler: {
        file: 'js/map-matcher.js',
        pattern: /msg\.type\s*===\s*['"]([^'"]+)['"]/g,
      },
      senders: [
        // index.html: _mmWorker.postMessage({ type: 'X' })
        {
          file: 'index.html',
          pattern: /_mmWorker\.postMessage\(\s*\{\s*type:\s*['"]([^'"]+)['"]/g,
        },
        // meter.js: mmWorker.postMessage({ type: 'X' })
        {
          file: 'js/meter.js',
          pattern: /mmWorker\.postMessage\(\s*\{\s*type:\s*['"]([^'"]+)['"]/g,
        },
        // mm-data-pipeline.js: this.worker.postMessage({ type: 'X' })
        {
          file: 'js/mm-data-pipeline.js',
          pattern: /this\.worker\.postMessage\(\s*\{\s*type:\s*['"]([^'"]+)['"]/g,
        },
      ],
      // DataRegistry の msgType フィールドで動的注入される handler 名
      // (mm-data-pipeline.js L109 で entry.msgType として送信)
      // loadTile / tileNotFound は index.html L4583 で三項演算子経由送信のため
      // 正規表現で捕捉できず extraSenders に明示登録。
      extraSenders: [
        'loadCoarse',
        'loadPrefBorders',
        'loadHighways',
        'loadCoastline',
        'loadRailways',
        'loadBackbone',
        'loadDem',
        'loadTile',
        'tileNotFound',
      ],
      // ★ 既知の dead handler (本セッションで特定・将来実装予定)
      allowDeadHandlers: [
        // configDebug: 実機 dlog ON/OFF 切替・未配線 (デバッグログ設定固定で動作には影響なし)
        'configDebug',
        // ★2026-05-18 configPlatform 配線完了・index.html L4502 で _setupMmWorker 内送信開始 (削除済)
        // updateCrossUserPheromone: Firebase cross-user pheromone 受信・呼出経路なし
        'updateCrossUserPheromone',
        // configOsrm: OSRM endpoint 動的切替・osrm-client.js コメントで言及あるが未実装
        'configOsrm',
        // loadEmergencyAttrs: D3 緊急輸送道路・登録ロジックあるが呼出なし
        'loadEmergencyAttrs',
      ],
      allowOrphanSenders: [],
    },
    // ─── Worker A (gps-worker.js) チャネル ─────────────────────────
    {
      channel: 'gps-worker-a',
      handler: {
        file: 'js/gps-worker.js',
        pattern: /type\s*===\s*['"]([^'"]+)['"]/g,
      },
      senders: [
        // gps.js: worker.postMessage({ type: 'X' })
        {
          file: 'js/gps.js',
          pattern: /worker\.postMessage\(\s*\{\s*type:\s*['"]([^'"]+)['"]/g,
        },
      ],
      allowDeadHandlers: [],
      allowOrphanSenders: [],
    },
  ],
};
