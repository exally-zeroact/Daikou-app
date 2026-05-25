// tests/worker/gps-worker-sim.js (Phase 4 基盤・2026-05-21)
//
// ★設計変更宣言 Phase 4 (2026-05-21・Worker A 実走 simulator):
//   実 js/gps-worker.js を Node 環境で・Worker context として そのまま evaluate する simulator。
//   既存 gps-worker-unit.test.js は静的 grep のみ (= drift-risk #4)・本 simulator で
//   実コード実走化して挙動検証する。
//
//   Worker B の tests/replay-mm-worker/worker-sim.js と同パターン (= vm.runInContext)。
//   gps-worker.js は importScripts() を呼ばない (= 内蔵 KalmanGPS class のみ依存) ので
//   依存解決は不要。
//
//   絶対前提:
//     - 実 js/gps-worker.js を実 evaluate (= 再実装 / Node コピー / isolated 禁止)
//     - gps-worker.js 本体・meter.js は無変更 (= 本タスクはテスト追加のみ)
//     - distance_m / commit 機構: 不可侵 (= Worker A は触らない)
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..', '..', 'js');

function createGpsWorker(opts) {
  opts = opts || {};
  const debug = !!opts.debug;
  const messageLog = [];
  const listeners = [];

  const ctx = {
    console: debug ? console : { log() {}, warn() {}, error() {} },
    Date,
    Math,
    JSON,
    Map,
    Set,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
    ArrayBuffer,
    DataView,
    Buffer,
    Promise,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    performance: { now: () => Date.now() },
  };
  ctx.self = ctx;
  ctx.globalThis = ctx;

  // self.postMessage: Worker → main 方向
  ctx.postMessage = function (msg) {
    messageLog.push(msg);
    for (const l of listeners) {
      try {
        l({ data: msg });
      } catch (e) {
        if (debug) console.error('[gps-worker-sim] listener error:', e);
      }
    }
  };

  ctx.addEventListener = function (type, handler) {
    if (type === 'message') {
      const prev = ctx.onmessage;
      ctx.onmessage = function (e) {
        if (prev) prev(e);
        handler(e);
      };
    }
  };
  ctx.removeEventListener = function () {};

  vm.createContext(ctx);

  // 実 gps-worker.js を Worker context として evaluate
  const src = fs.readFileSync(path.join(JS_DIR, 'gps-worker.js'), 'utf8');
  vm.runInContext(src, ctx, { filename: 'js/gps-worker.js' });

  function sendMessage(msg) {
    if (typeof ctx.onmessage !== 'function') {
      throw new Error('[gps-worker-sim] gps-worker.js が self.onmessage を設定していない');
    }
    ctx.onmessage({ data: msg });
  }

  function on(callback) {
    listeners.push(callback);
  }

  function getResults() {
    // result message のみ抽出 (= position 入力に対する戻り)
    return messageLog.filter((m) => m && m.type === 'result').map((m) => m.data);
  }

  return {
    ctx,
    sendMessage,
    on,
    messageLog,
    getResults,
  };
}

module.exports = { createGpsWorker };
