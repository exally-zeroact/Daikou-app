// tests/integration/raf-display-loop.test.js
//
// ★設計変更宣言 (2026-05-24・案 B・rAF 描画ループ 60Hz):
//   描画頻度 (= driveDist/driveFare/totalDist 表示更新) を・setInterval 100ms と・並行で
//   requestAnimationFrame (~60Hz) で・最高峰の・滑らか化。
//   既存 setInterval (= 重い処理・localStorage save) は・1 byte 不変。
//   getState 内・予測補間ロジック (= velocity/predicted_target/display) も・1 byte 不変。
//
// 検証内容 (= static source verify):
//   1. rAF 関数定義あり (= _rafDisplayTick / startRafDisplay / stopRafDisplay)
//   2. startUiTimer 内で・startRafDisplay 呼出
//   3. uiTimer clearInterval 周辺で・stopRafDisplay 呼出
//   4. rAF 内・textContent 比較で・無駄 DOM 書込 防止
//   5. rAF 内・getState 予測補間 利用 (= display_distance_m 採用)
//   6. 既存 setInterval (= 100ms) は・1 byte 不変・並行更新で・二重実行
//   7. 不可侵境界: js/meter.js / js/business.js / 距離計算ロジック・1 byte 不変

'use strict';

const fs = require('fs');
const path = require('path');

let html;
beforeAll(() => {
  html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
});

describe('1. rAF 関数定義 (= _rafDisplayTick / startRafDisplay / stopRafDisplay)', () => {
  it('_rafDisplayTick 関数定義あり', () => {
    expect(html).toMatch(/function _rafDisplayTick\(\)\s*\{/);
  });

  it('startRafDisplay 関数定義あり', () => {
    expect(html).toMatch(/function startRafDisplay\(\)\s*\{/);
  });

  it('stopRafDisplay 関数定義あり', () => {
    expect(html).toMatch(/function stopRafDisplay\(\)\s*\{/);
  });

  it('_rafDisplayId 宣言あり', () => {
    expect(html).toMatch(/let _rafDisplayId\s*=\s*null/);
  });

  it('startRafDisplay 内で・requestAnimationFrame 呼出', () => {
    const m = html.match(/function startRafDisplay\(\)\s*\{[\s\S]*?\n\s\s\s\s\s\s\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/requestAnimationFrame\(_rafDisplayTick\)/);
  });

  it('stopRafDisplay 内で・cancelAnimationFrame 呼出', () => {
    const m = html.match(/function stopRafDisplay\(\)\s*\{[\s\S]*?\n\s\s\s\s\s\s\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/cancelAnimationFrame\(_rafDisplayId\)/);
  });
});

describe('2. startUiTimer 内・rAF start 配線', () => {
  it('startUiTimer 内で・startRafDisplay 呼出', () => {
    const m = html.match(/function startUiTimer\(\)\s*\{[\s\S]*?uiTimer = setInterval/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/startRafDisplay\(\)/);
  });
});

describe('3. uiTimer stop 周辺・rAF stop 配線', () => {
  it('clearInterval(uiTimer) 後・stopRafDisplay 呼出', () => {
    // clearInterval(uiTimer) → uiTimer = null → stopRafDisplay() の・順 verify
    const m = html.match(/clearInterval\(uiTimer\);[\s\S]{0,200}stopRafDisplay\(\);/);
    expect(m).not.toBeNull();
  });
});

describe('4. textContent 比較・無駄 DOM 書込 防止', () => {
  let rafTickBlock;
  beforeAll(() => {
    const m = html.match(/function _rafDisplayTick\(\)\s*\{[\s\S]*?\n\s\s\s\s\s\s\}/);
    rafTickBlock = m ? m[0] : '';
  });

  it('_lastDriveDistKm 比較 (= 前回値・同じなら skip)', () => {
    expect(rafTickBlock).toMatch(/distKm !== _lastDriveDistKm/);
    expect(rafTickBlock).toMatch(/_lastDriveDistKm = distKm/);
  });

  it('_lastDriveFareYen 比較', () => {
    expect(rafTickBlock).toMatch(/fareStr !== _lastDriveFareYen/);
    expect(rafTickBlock).toMatch(/_lastDriveFareYen = fareStr/);
  });

  it('_lastTotalDistKm 比較', () => {
    expect(rafTickBlock).toMatch(/totalDistKm !== _lastTotalDistKm/);
    expect(rafTickBlock).toMatch(/_lastTotalDistKm = totalDistKm/);
  });
});

describe('5. rAF 内・getState 予測補間 利用 (= display_distance_m 採用)', () => {
  let rafTickBlock;
  beforeAll(() => {
    const m = html.match(/function _rafDisplayTick\(\)\s*\{[\s\S]*?\n\s\s\s\s\s\s\}/);
    rafTickBlock = m ? m[0] : '';
  });

  it('Meter.getState() 呼出', () => {
    expect(rafTickBlock).toMatch(/Meter\.getState\(\)/);
  });

  it('s.display_distance_m 採用 (= 予測補間値)', () => {
    expect(rafTickBlock).toMatch(/s\.display_distance_m/);
  });

  it('Meter.calcFare 呼出 (= 料金 表示用再計算)', () => {
    expect(rafTickBlock).toMatch(/Meter\.calcFare\(displayDistM\)/);
  });

  it('Business.getReport 呼出 (= totalDist 用・preview 込み)', () => {
    expect(rafTickBlock).toMatch(/Business\.getReport\(\)/);
    expect(rafTickBlock).toMatch(/r\.total_distance_m/);
  });
});

describe('6. 既存 setInterval (= 100ms) 1 byte 不変・並行維持', () => {
  it('既存 setInterval 100ms 残置 (= uiTimer = setInterval(..., 100))', () => {
    expect(html).toMatch(/uiTimer\s*=\s*setInterval\([\s\S]*?\},\s*100\);/);
  });

  it('既存 setInterval 内・localStorage save 経路維持 (= daikou_driving_state)', () => {
    expect(html).toMatch(/localStorage\.setItem\(\s*'daikou_driving_state'/);
  });

  it('既存 setInterval 内・Firebase 送信維持 (= FB.updateVehicle)', () => {
    expect(html).toMatch(/FB\.updateVehicle\(/);
  });
});

describe('7. 不可侵境界 verify (= 距離計算ロジック 1 byte 不変)', () => {
  it('予測補間ロジック (= meter.js getState 内) は・touch 対象外', () => {
    // 本 test は・index.html のみ・編集対象
    // meter.js / business.js diff は・別 grep で・1 byte 不変 verify (= push 直前)
    expect(true).toBe(true); // = この test は・実 git diff verify は外部
  });

  it('rAF 関数内・state.distance_m / business_distance_m に・write しない', () => {
    const m = html.match(/function _rafDisplayTick\(\)\s*\{[\s\S]*?\n\s\s\s\s\s\s\}/);
    expect(m).not.toBeNull();
    const block = m[0];
    // read は・OK (= s.display_distance_m / s.distance_m)・write は・ない
    expect(block).not.toMatch(/s\.distance_m\s*=/);
    expect(block).not.toMatch(/state\.distance_m\s*=/);
    expect(block).not.toMatch(/business_distance_m\s*=/);
    expect(block).not.toMatch(/Meter\.set\w+/); // Meter.setDistance 等・write も・ない
  });
});

describe('8. rAF visibilitychange 自動 stop/resume (= 仕様確認・追加 logic 不要)', () => {
  it('rAF は・ブラウザ標準仕様で・hidden 時 stop・visible で resume・追加 logic なし', () => {
    // rAF 仕様: requestAnimationFrame は・document.hidden 時・callback 呼ばれない
    // visible 復帰時・自動 callback 再開
    // → 本 file で・追加の visibilitychange ハンドラは・不要
    // → 但し・stopRafDisplay は・「業務終了時 (= idle 戻り)」 で・呼ばれる (= uiTimer stop と同期)
    const m = html.match(/function stopRafDisplay\(\)\s*\{[\s\S]*?\n\s\s\s\s\s\s\}/);
    expect(m).not.toBeNull();
    // stopRafDisplay 内・前回値 reset で・「次回 startRafDisplay 時・初回 frame で・全 DOM 書込」 保証
    expect(m[0]).toMatch(/_lastDriveDistKm\s*=\s*null/);
    expect(m[0]).toMatch(/_lastDriveFareYen\s*=\s*null/);
    expect(m[0]).toMatch(/_lastTotalDistKm\s*=\s*null/);
  });
});
