// tests/integration/trace-selfdiag.test.js
//
// ★2026-07-03 自己診断trace(足す①)★:
//   今回の事故は「Kが乗ってるか/どのビルドか」がtraceに一切記録されておらず、何日も原因を特定
//   できなかった(憶測しかできなかった)のが核。→ 全traceのmetaに実行時のK適用状態を焼く:
//     ac  = window.DK_AUTO_CALIB_K (autoCalibKが有効か・OFFキー診断の核)
//     act = calibStatus.active     (実行時に学習Kが実際に乗ってるか)
//     deg = calibStatus.degraded   (較正器ロード失敗か)
//     k   = calibStatus.K          (適用K値)
//     sw  = window.DK_SW_CACHE      (SWが掴んでるビルド=旧キャッシュ判定・best-effort)
//   → 次の1走行traceで「Kが乗った/乗ってない・原因」を数字で断定できる=憶測を根絶。
//   ※source assertion(実DOMは実機trace)。

'use strict';

const fs = require('fs');
const path = require('path');

let trace, html;
beforeAll(() => {
  const root = path.join(__dirname, '..', '..');
  trace = fs.readFileSync(path.join(root, 'js', 'debug-trace.js'), 'utf8');
  html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
});

describe('自己診断trace: K適用状態を毎traceに記録 (足す①)', () => {
  it('★ debug-trace.js に _diagSnapshot があり DK_AUTO_CALIB_K/_lastCalibStatus/DK_SW_CACHE を読む', () => {
    expect(trace).toMatch(/_diagSnapshot/);
    expect(trace).toMatch(/DK_AUTO_CALIB_K/);
    expect(trace).toMatch(/_lastCalibStatus/);
    expect(trace).toMatch(/DK_SW_CACHE/);
  });

  it('★ _postBatch の meta に diag を焼く', () => {
    expect(trace).toMatch(/diag:\s*_diagSnapshot\(\)/);
  });

  it('★ index.html の mmResult が calibStatus を window._lastCalibStatus に保存', () => {
    expect(html).toMatch(/window\._lastCalibStatus\s*=\s*m\.calibStatus/);
  });

  it('★ index.html が SW の CACHE_NAME を window.DK_SW_CACHE に保存(ビルド判定用)', () => {
    expect(html).toMatch(/window\.DK_SW_CACHE\s*=/);
  });
});
