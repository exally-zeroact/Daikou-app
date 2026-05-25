// tests/replay-mm-worker/worker-sim.js (Phase 1 基盤・2026-05-21)
// ★設計変更宣言 Phase 1 (2026-05-21): 実 Worker B 実走 simulator
//   目的: 実 js/map-matcher.js + js/roads-decoder.js + js/osrm-client.js を
//         Node 環境で・Worker context として そのまま evaluate する simulator。
//   既存 fake-worker + dispatched mmResult パターン (= mm-drain-after-start 等) は
//   実 Worker B コードを通らない (= 動的監査タスクで判明した致命的 gap) ため、本基盤は
//   実コードを通す方式に統一する。再実装・Node コピーは禁止。
//
//   @vitest/web-worker は classic worker + importScripts 互換性に難があるため
//   vm.runInContext 経由で同等機能を提供する。実 map-matcher.js は本 file 経由で
//   loadRoads / configPlatform / gps message を受信し・本物の HMM Viterbi で snap する。
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..', '..', 'js');

function createMapMatcherWorker(opts) {
  opts = opts || {};
  const debug = !!opts.debug;
  const messageLog = [];
  const listeners = [];

  // Worker context (self) の simulation
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
    // Worker context は navigator.onLine だけ参照する箇所がある (osrm-client.js)
    navigator: { onLine: false }, // 強制 offline で OSRM /match を確実に skip
    // fetch は Worker 内では呼ばれない設計 (= OSRM /match のみ・上記 navigator.onLine=false で skip)
    fetch: () => Promise.reject(new Error('[worker-sim] fetch disabled')),
  };
  // Worker context では window 未定義・self が global
  ctx.self = ctx;
  ctx.globalThis = ctx;

  // self.postMessage: Worker → main 方向
  ctx.postMessage = function (msg) {
    messageLog.push(msg);
    for (const l of listeners) {
      try {
        l({ data: msg });
      } catch (e) {
        if (debug) console.error('[worker-sim] listener error:', e);
      }
    }
  };

  // importScripts: classic worker API simulation
  ctx.importScripts = function (...files) {
    for (const f of files) {
      const fp = path.join(JS_DIR, f);
      const src = fs.readFileSync(fp, 'utf8');
      vm.runInContext(src, ctx, { filename: 'js/' + f });
    }
  };

  // self.addEventListener / removeEventListener (= 一部 codepath で使用される可能性)
  // map-matcher.js は self.onmessage = function() {} 形式で代入するのが主・無くて OK だが念のため
  ctx.addEventListener = function (type, handler) {
    if (type === 'message') {
      // map-matcher.js は self.onmessage 代入を使うので・ここは保険
      const prev = ctx.onmessage;
      ctx.onmessage = function (e) {
        if (prev) prev(e);
        handler(e);
      };
    }
  };
  ctx.removeEventListener = function () {};

  vm.createContext(ctx);

  // 実 map-matcher.js を load (= 内部で importScripts('roads-decoder.js') / importScripts('osrm-client.js'))
  const mapMatcherSrc = fs.readFileSync(path.join(JS_DIR, 'map-matcher.js'), 'utf8');
  vm.runInContext(mapMatcherSrc, ctx, { filename: 'js/map-matcher.js' });

  // ★ map-matcher.js 末尾で self.onmessage = function(e) {...} 設定済
  // main → Worker 方向の message dispatch
  function sendMessage(msg) {
    if (typeof ctx.onmessage !== 'function') {
      throw new Error('[worker-sim] map-matcher.js が self.onmessage を設定していない');
    }
    ctx.onmessage({ data: msg });
  }

  function on(callback) {
    listeners.push(callback);
  }

  function off(callback) {
    const i = listeners.indexOf(callback);
    if (i >= 0) listeners.splice(i, 1);
  }

  return {
    ctx,
    sendMessage,
    on,
    off,
    messageLog,
  };
}

// 実 data/roads-{pref}.js を load して ROADS_{PREF} object を取得 (= main 側で 1 回)
// vm.runInNewContext で eval・worker に渡す前段階
function loadPrefRoadsData(pref) {
  const dataPath = path.join(__dirname, '..', '..', 'data', 'roads-' + pref + '.js');
  if (!fs.existsSync(dataPath)) {
    throw new Error('[worker-sim] roads data not found: ' + dataPath);
  }
  const src = fs.readFileSync(dataPath, 'utf8');
  const mainCtx = { window: {} };
  vm.createContext(mainCtx);
  vm.runInContext(src, mainCtx, { filename: 'data/roads-' + pref + '.js' });
  const upper = pref.toUpperCase();
  const obj = mainCtx.window['ROADS_' + upper];
  if (!obj) {
    throw new Error('[worker-sim] window.ROADS_' + upper + ' not found in data file');
  }
  return obj;
}

module.exports = { createMapMatcherWorker, loadPrefRoadsData };
