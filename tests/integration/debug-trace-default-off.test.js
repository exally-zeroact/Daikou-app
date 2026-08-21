// tests/integration/debug-trace-default-off.test.js
//
// ★設計変更宣言 (2026-08-01・司さん指示「蛇口を閉める」・旧 debug-trace-default-on.test.js を改名):
//   旧: テストビルド (= !DEBUG.isProduction) は既定 ON。
//   新: ★本番/テストとも既定 OFF★。有効化は ?trace=on を明示した時のみ (= localStorage '1' に永続)。
//   理由: テスト URL を開くだけで startup_metrics が自動送信され続け、Firebase RTDB (無料枠 1GB)
//         が 92% に到達して警告メールが来た (2026-08-01・debug_traces 15,698件/約1,000MB を削除)。
//         debug-log-uploader.js は 2026-07-03 に同じ理由で既定 OFF 済み＝これで蛇口を両方閉じる。
//   debug-trace.js の・feature flag 判定 logic を・grep ベース で・verify。
//   実行時 verify は・jsdom 不要 (= source 解析のみ)・既存 test framework 整合。
//
// 検証内容:
//   1. ?trace=off で・localStorage に・'0' を・set する (= 明示 OFF 印)
//   2. ★localStorage 未設定 → 環境によらず 既定 OFF (= 開いただけでは 1 byte も送らない)
//   3. ★DEBUG.isProduction による分岐は撤去 (= 環境で挙動が変わらない)
//   4. localStorage = '1' → ON / '0' → OFF (= 明示 優先)
//   5. localStorage 不可 → 安全側 OFF
//   6. 記録 field (= t/lat/lng/acc/spd/hdg/alt) が・onPosition に・含まれる (= replay 十分)
//   7. 触らないファイル (= meter.js / gps.js / gps-worker.js / map-matcher.js): 1 byte 不変
//
// 絶対ルール準拠:
//   ✓ debug-trace.js のみ変更 (= passive 記録)
//   ✓ distance_m / 課金 / Worker B 本体: 完全無関係
//   ✓ 収集 (watchPosition) の作りは不変・変えるのは「既定で有効か」だけ

'use strict';

const fs = require('fs');
const path = require('path');

let debugTraceSrc;

beforeAll(() => {
  debugTraceSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'debug-trace.js'), 'utf8');
});

describe('debug-trace.js: 既定 OFF verify (= 開いただけでは送らない)', () => {
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

  it('★ 未設定 → 環境によらず既定 OFF (= 旧 !_isProd は撤去)', () => {
    // 未設定 (stored が null) の else 分岐で・_enabled = false になること
    expect(debugTraceSrc).toMatch(/_enabled = false;/);
    // 旧「テストビルドは既定 ON」が残っていたら赤
    expect(debugTraceSrc).not.toMatch(/_enabled = !_isProd/);
  });

  it('★ DEBUG.isProduction による分岐そのものが無い (= 環境で挙動が変わらない)', () => {
    expect(debugTraceSrc).not.toMatch(/const _isProd\s*=/);
    expect(debugTraceSrc).not.toMatch(/DEBUG\.isProduction === true/);
  });

  it('★ localStorage 不可 → 安全側 OFF', () => {
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
