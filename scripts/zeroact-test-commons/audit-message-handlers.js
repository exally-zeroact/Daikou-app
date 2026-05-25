#!/usr/bin/env node

// ============================================================
// audit-message-handlers.js
//   ZEROact 共通テスト基盤 (2026-05-17 新規)
//   postMessage の送信側と受信側 (handler) の対応を集合差分で検証する汎用 audit。
//
// 用途:
//   ・ダイコメ: index.html / meter.js / mm-data-pipeline.js → map-matcher.js (Worker B)
//                gps.js → gps-worker.js (Worker A)
//   ・Exally:   client → API route / API → AI SDK
//   ・今治AI:   future
//
// 使い方:
//   node scripts/zeroact-test-commons/audit-message-handlers.js <config.js>
//
//   exit 0: 接続健全 (dead handler / 未実装 sender とも 0 件、または allowlist 内)
//   exit 1: 想定外の dead handler / 未実装 sender を検出
//
// config.js 形式 (CommonJS module):
//   module.exports = {
//     name: 'daikome',
//     channels: [
//       {
//         channel: 'mm-worker',                           // 任意の識別子
//         handler: { file: 'js/map-matcher.js',
//                    pattern: /msg\.type\s*===\s*['"]([^'"]+)['"]/g },
//         senders: [
//           { file: 'js/meter.js',
//             pattern: /mmWorker\.postMessage\(\s*\{\s*type:\s*['"]([^'"]+)['"]/g },
//           // ... 複数の sender
//         ],
//         allowDeadHandlers: ['configDebug', 'configPlatform', ...],   // 既知の未送信 (allowlist)
//         allowOrphanSenders: [],                                       // 既知の未実装 sender (通常空)
//       },
//       // ... 複数の channel
//     ],
//   };
//
// 設計:
//   ・正規表現で grep し handler / sender 集合を構築
//   ・集合差分 (handler - sender) → dead handler / (sender - handler) → orphan sender
//   ・allowlist との差分で fail 判定
//   ・コメント内のヒットは含まれる ・「歴史的言及」を除外したい場合は allowlist に登録する
//
// 注意:
//   ・dynamic msgType (例: entry.msgType) は正規表現で捕捉不能のため
//     handlerlist に extraSenders として明示的に追加するか、別 channel で扱う。
// ============================================================

const fs = require('fs');
const path = require('path');

function readSource(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error('file not found: ' + filePath);
  }
  return fs.readFileSync(filePath, 'utf8');
}

// 正規表現でマッチした 1 番目のキャプチャを Set として返す
function extractMatches(source, pattern) {
  const set = new Set();
  // 新しい RegExp instance を作って .lastIndex を独立化
  const re = new RegExp(pattern.source, pattern.flags || 'g');
  let m;
  while ((m = re.exec(source)) !== null) {
    if (m[1]) set.add(m[1]);
  }
  return set;
}

function setDiff(a, b) {
  const out = [];
  for (const v of a) if (!b.has(v)) out.push(v);
  out.sort();
  return out;
}

function auditChannel(channel, projectRoot) {
  const handlerPath = path.join(projectRoot, channel.handler.file);
  const handlerSrc = readSource(handlerPath);
  const handlers = extractMatches(handlerSrc, channel.handler.pattern);

  const senders = new Set();
  for (const senderDef of channel.senders || []) {
    const senderPath = path.join(projectRoot, senderDef.file);
    const senderSrc = readSource(senderPath);
    const matches = extractMatches(senderSrc, senderDef.pattern);
    for (const v of matches) senders.add(v);
  }
  // extraSenders: dynamic msgType 等で grep 不能なものを明示注入
  if (Array.isArray(channel.extraSenders)) {
    for (const v of channel.extraSenders) senders.add(v);
  }

  const deadHandlers = setDiff(handlers, senders);
  const orphanSenders = setDiff(senders, handlers);

  const allowDead = new Set(channel.allowDeadHandlers || []);
  const allowOrphan = new Set(channel.allowOrphanSenders || []);

  const unexpectedDead = deadHandlers.filter((v) => !allowDead.has(v));
  const unexpectedOrphan = orphanSenders.filter((v) => !allowOrphan.has(v));

  return {
    channel: channel.channel,
    handlers: Array.from(handlers).sort(),
    senders: Array.from(senders).sort(),
    deadHandlers,
    orphanSenders,
    unexpectedDead,
    unexpectedOrphan,
    ok: unexpectedDead.length === 0 && unexpectedOrphan.length === 0,
  };
}

function main() {
  const configArg = process.argv[2];
  if (!configArg) {
    console.error('Usage: node audit-message-handlers.js <config.js>');
    process.exit(2);
  }
  const projectRoot = process.cwd();
  const configPath = path.resolve(projectRoot, configArg);
  if (!fs.existsSync(configPath)) {
    console.error('config not found: ' + configPath);
    process.exit(2);
  }
  // eslint-disable-next-line no-undef -- Node CommonJS
  const config = require(configPath);
  if (!config || !Array.isArray(config.channels)) {
    console.error('config.channels must be an array');
    process.exit(2);
  }

  console.log('=== audit-message-handlers: ' + (config.name || 'project') + ' ===');
  let anyFail = false;
  for (const ch of config.channels) {
    const r = auditChannel(ch, projectRoot);
    console.log('\n[channel: ' + r.channel + ']');
    console.log('  handlers (' + r.handlers.length + '): ' + r.handlers.join(', '));
    console.log('  senders  (' + r.senders.length + '): ' + r.senders.join(', '));
    if (r.deadHandlers.length > 0) {
      console.log('  dead handlers (' + r.deadHandlers.length + '): ' + r.deadHandlers.join(', '));
    }
    if (r.orphanSenders.length > 0) {
      console.log(
        '  orphan senders (' + r.orphanSenders.length + '): ' + r.orphanSenders.join(', ')
      );
    }
    if (r.unexpectedDead.length > 0) {
      console.error('  ✘ UNEXPECTED dead handlers: ' + r.unexpectedDead.join(', '));
      anyFail = true;
    }
    if (r.unexpectedOrphan.length > 0) {
      console.error('  ✘ UNEXPECTED orphan senders: ' + r.unexpectedOrphan.join(', '));
      anyFail = true;
    }
    if (r.ok) {
      console.log('  ✅ OK');
    }
  }
  if (anyFail) {
    console.error('\naudit-message-handlers: FAIL (unexpected dead/orphan above)');
    process.exit(1);
  }
  console.log('\naudit-message-handlers: PASS');
  process.exit(0);
}

main();
