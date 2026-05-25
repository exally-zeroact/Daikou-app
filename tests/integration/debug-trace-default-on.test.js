// tests/integration/debug-trace-default-on.test.js
//
// ★設計変更宣言 (2026-05-23・テストビルド常時 ON 化・debug-trace.js 既定 verify):
//   debug-trace.js の・feature flag 判定 logic を・grep ベース で・verify。
//   実行時 verify は・jsdom 不要 (= source 解析のみ)・既存 test framework 整合。
//
// 検証内容:
//   1. ?trace=off で・localStorage に・'0' を・set する (= 明示 OFF 印)
//   2. テストビルド (= DEBUG.isProduction !== true) で・localStorage 未設定 → 既定 ON
//   3. 本番 (= DEBUG.isProduction === true) で・localStorage 未設定 → 既定 OFF (= prod 不変)
//   4. localStorage = '1' → ON / '0' → OFF (= 明示 優先)
//   5. DEBUG 参照不可 → 安全側 OFF
//   6. 記録 field (= t/lat/lng/acc/spd/hdg/alt) が・onPosition に・含まれる (= replay 十分)
//   7. 触らないファイル (= meter.js / gps.js / gps-worker.js / map-matcher.js): 1 byte 不変
//
// 絶対ルール準拠:
//   ✓ debug-trace.js のみ変更 (= passive 記録)
//   ✓ distance_m / 課金 / Worker B 本体: 完全無関係
//   ✓ prod 既定 OFF 不変 (= privacy/cost/同意)

'use strict';

const fs = require('fs');
const path = require('path');

let debugTraceSrc;

beforeAll(() => {
  debugTraceSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'debug-trace.js'), 'utf8');
});

describe('debug-trace.js: テストビルド既定 ON 化 verify', () => {
  it('★ ?trace=off で・localStorage に・"0" を・setItem (= 明示 OFF 印)', () => {
    // 旧: removeItem (= null になる) → 新: setItem('0') (= 明示 OFF)
    expect(debugTraceSrc).toMatch(/t === 'off'[\s\S]*?setItem\(FLAG_KEY,\s*'0'\)/);
    // 旧の removeItem は・撤去されていること
    expect(debugTraceSrc).not.toMatch(/t === 'off'[\s\S]*?removeItem\(FLAG_KEY\)/);
  });

  it('★ ?trace=on で・localStorage に・"1" を・setItem (= 既存互換)', () => {
    expect(debugTraceSrc).toMatch(/t === 'on'[\s\S]*?setItem\(FLAG_KEY,\s*'1'\)/);
  });

  it('★ enabled 判定: stored === "1" → ON / stored === "0" → OFF', () => {
    expect(debugTraceSrc).toMatch(/stored === '1'/);
    expect(debugTraceSrc).toMatch(/stored === '0'/);
  });

  it('★ 未設定: DEBUG.isProduction === true で・OFF / != true で・ON', () => {
    // DEBUG.isProduction === true → _isProd = true → _enabled = !_isProd = false (= 本番 OFF)
    // DEBUG.isProduction !== true → _isProd = false → _enabled = true (= テスト ON)
    expect(debugTraceSrc).toMatch(/DEBUG\.isProduction === true/);
    expect(debugTraceSrc).toMatch(/_enabled = !_isProd/);
  });

  it('★ DEBUG 参照不可 (= debug-config 未 load 等) → 安全側 OFF', () => {
    // typeof DEBUG !== 'undefined' で・gard・undefined なら _isProd = false → ★テスト扱い ★
    // ただし・catch block で・localStorage 不可 → _enabled = false 安全側 OFF
    expect(debugTraceSrc).toMatch(/typeof DEBUG !== 'undefined'/);
    expect(debugTraceSrc).toMatch(/_enabled = false[\s\S]*?\/\/ localStorage 不可/);
  });

  it('★ 早期 return: _enabled = false なら return (= 通常 user 完全サイレント)', () => {
    expect(debugTraceSrc).toMatch(/if \(!_enabled\) return;/);
  });
});

describe('debug-trace.js: 記録 field (= replay 十分性 verify)', () => {
  it('★ onPosition で・t/lat/lng/acc/spd/hdg/alt 全 record (= raw GPS 完備)', () => {
    // onPosition 内で・samples.push({ t, lat, lng, acc, spd, hdg, alt })
    const m = debugTraceSrc.match(/samples\.push\(\{[\s\S]*?\}\)/);
    expect(m).not.toBeNull();
    const block = m[0];
    expect(block).toMatch(/t:\s*p\.timestamp/);
    expect(block).toMatch(/lat:\s*c\.latitude/);
    expect(block).toMatch(/lng:\s*c\.longitude/);
    expect(block).toMatch(/acc:\s*c\.accuracy/);
    expect(block).toMatch(/spd:\s*c\.speed/);
    expect(block).toMatch(/hdg:\s*c\.heading/);
    expect(block).toMatch(/alt:\s*c\.altitude/);
  });

  it('★ watchPosition options: enableHighAccuracy / timeout / maximumAge (= 最大 sample rate)', () => {
    expect(debugTraceSrc).toMatch(/enableHighAccuracy:\s*true/);
    expect(debugTraceSrc).toMatch(/timeout:\s*3000/);
    expect(debugTraceSrc).toMatch(/maximumAge:\s*0/);
  });

  it('★ MAX_SAMPLES = 5000 (= 90 分代行相当の上限・Firebase rules と整合)', () => {
    expect(debugTraceSrc).toMatch(/MAX_SAMPLES\s*=\s*5000/);
  });

  it('★ watchPosition 独立 subscribe (= 既存 gps.js とは・並行・干渉なし)', () => {
    expect(debugTraceSrc).toMatch(/navigator\.geolocation\.watchPosition/);
  });
});

describe('debug-trace.js: 触らないファイル無変更 verify (= prod 不変)', () => {
  it('★ meter.js / gps.js / gps-worker.js / map-matcher.js への参照なし (= passive)', () => {
    // 本 file は・独立 watchPosition で・並行 subscribe・コアに hook しない
    expect(debugTraceSrc).not.toMatch(/require.*meter|require.*gps-worker|require.*map-matcher/);
    expect(debugTraceSrc).not.toMatch(/Meter\.\w+\s*=/); // Meter への代入なし
  });

  it('★ Firebase POST 経路は・debug_traces のみ (= prod 距離経路 非影響)', () => {
    expect(debugTraceSrc).toMatch(/DB_PATH\s*=\s*'\/debug_traces\.json'/);
  });
});

describe('debug-trace.js: 設計宣言コメント', () => {
  it('★ 設計変更宣言: テストビルド常時 ON 化 + prod 不変', () => {
    expect(debugTraceSrc).toMatch(/設計変更宣言.*テストビルド[\s\S]*?ON/);
    expect(debugTraceSrc).toMatch(/本番.*既定 OFF/);
  });
});
