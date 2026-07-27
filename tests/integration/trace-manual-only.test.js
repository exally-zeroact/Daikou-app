// tests/integration/trace-manual-only.test.js
//
// ★設計変更宣言 (2026-07-03・司さん指示「自動trace廃止・オンライン＋ボタン押下時のみ送信」):
//   従来テストビルドは trace を自動アップロードしていた:
//     - debug-trace.js:      90秒毎/4500点毎に自動 chunk 送信 + pagehide/hidden で自動 beacon 送信
//     - debug-log-uploader.js: console log を 30秒毎/500件毎に自動アップロード (既定 ON)
//   これを全廃し「送信は司さんが📡ボタンを押した時 (=オンライン時に手動) のみ」に限定する。
//
// 検証内容 (grep ベース・既存 debug-trace-default-on.test.js と同流儀):
//   A. debug-trace.js
//      1. MANUAL_ONLY = true フラグが存在
//      2. onPosition の自動 flush が MANUAL_ONLY で無効化 (!MANUAL_ONLY で gate)
//      3. pagehide/visibilitychange の自動 beacon が MANUAL_ONLY で無効化
//      4. ★手動経路は不変★: window.uploadGpsTrace / _flushTrace(false) / btnUploadTrace ボタン binding
//      5. ★送信はオンライン前提★: outbox (DaikomeTraceOutbox) 経由 (オフラインは queue→オンラインで送信)
//   B. debug-log-uploader.js
//      6. 未設定時は既定 OFF (_enabled = false)・旧 `_enabled = !_isProd` は撤去
//      7. 明示 ?debuglog=on は従来通り有効 (診断セッション用の escape hatch)
//
// 絶対ルール準拠: 距離機構 / 課金 / Worker B は 1 byte も非関与 (診断ツールのみ)。

'use strict';

const fs = require('fs');
const path = require('path');

let traceSrc;
let logSrc;

beforeAll(() => {
  const root = path.join(__dirname, '..', '..');
  traceSrc = fs.readFileSync(path.join(root, 'js', 'debug-trace.js'), 'utf8');
  logSrc = fs.readFileSync(path.join(root, 'js', 'debug-log-uploader.js'), 'utf8');
});

describe('debug-trace.js: 自動アップロード廃止・手動ボタンのみ', () => {
  it('★ MANUAL_ONLY = true フラグが存在', () => {
    expect(traceSrc).toMatch(/const\s+MANUAL_ONLY\s*=\s*true/);
  });

  it('★ onPosition の自動 flush が MANUAL_ONLY で無効化 (!MANUAL_ONLY で gate)', () => {
    // 旧: if (_dueByCount || _dueByTime) { ... _flushTrace(true) }
    // 新: if (!MANUAL_ONLY && (_dueByCount || _dueByTime)) { ... }
    expect(traceSrc).toMatch(/!MANUAL_ONLY\s*&&\s*\(_dueByCount\s*\|\|\s*_dueByTime\)/);
    // 生の (無 gate) 自動 flush が残っていないこと
    expect(traceSrc).not.toMatch(/if\s*\(_dueByCount\s*\|\|\s*_dueByTime\)/);
  });

  it('★ pagehide/hidden の自動 beacon が MANUAL_ONLY で無効化', () => {
    // pagehide の addEventListener が !MANUAL_ONLY ブロック配下にあること
    expect(traceSrc).toMatch(/if\s*\(!MANUAL_ONLY\)[\s\S]*?addEventListener\('pagehide'/);
  });

  it('★ 手動経路は不変: window.uploadGpsTrace / _flushTrace(false)', () => {
    expect(traceSrc).toMatch(/window\.uploadGpsTrace\s*=\s*function/);
    expect(traceSrc).toMatch(/_flushTrace\(false\)/);
  });

  it('★ 手動ボタン binding は不変: btnUploadTrace の click で送信', () => {
    expect(traceSrc).toMatch(/getElementById\('btnUploadTrace'\)/);
    expect(traceSrc).toMatch(/btn\.addEventListener\('click'/);
  });

  it('★ 送信はオンライン前提: outbox (DaikomeTraceOutbox) 経由', () => {
    expect(traceSrc).toMatch(/DaikomeTraceOutbox/);
  });

  it('★ watchPosition の収集自体は継続 (ボタン押下時に送る中身を貯める)', () => {
    expect(traceSrc).toMatch(/navigator\.geolocation\.watchPosition/);
  });
});

describe('debug-log-uploader.js: console log 自動アップロードは既定 OFF', () => {
  it('★ 未設定時は既定 OFF (_enabled = false)・旧 !_isProd は撤去', () => {
    // 未設定 (stored が null) の else 分岐で・_enabled = false になること
    expect(logSrc).toMatch(/_enabled\s*=\s*false;/);
    // 旧「テストビルドで既定 ON」= _enabled = !_isProd は撤去されていること
    expect(logSrc).not.toMatch(/_enabled\s*=\s*!_isProd/);
  });

  it('★ 明示 ?debuglog=on は従来通り有効 (診断用 escape hatch)', () => {
    expect(logSrc).toMatch(/t === 'on'[\s\S]*?setItem\(FLAG_KEY,\s*'1'\)/);
    expect(logSrc).toMatch(/stored === '1'/);
  });
});
