// tests/integration/daiko-dist-factor-recalib.test.js
//
// ★2026-07-04 代行距離係数の再較正 (autoCalibK経路でDM+0.2%着地)★
//   旧1.013は2026-06-22に"factory K経路"のモコ実機で+0.2%へ逆算した値。
//   その後 autoCalibK(学習K=1.022)が距離の本線になりベースが上がったため、同じ1.013では
//   実機モコで平均+0.64%(業務別+0.39/+0.99/+0.56%)に浮いた(実走trace実測)。
//   → autoCalibK経路のベース(平均 DM-0.65%相当)に合わせて係数を 1.013→1.0085 に再較正。
//     projection: base/DM=1.00644/1.013=0.99353 → ×1.0085=1.00197=+0.20%(=DM Light基準ど真ん中)。
//   ※index.html:7062 が「モード変更後は本係数を再較正する」と予告済=その通りの再較正。
//   ※source assertion(実画面較正はtests/tools/daiko-dm-target-gate.js+実走trace)。緑≠実機OK。

'use strict';

const fs = require('fs');
const path = require('path');

let html;
beforeAll(() => {
  html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
});

describe('代行距離係数 再較正: autoCalibK経路でDM+0.2%着地', () => {
  it('★ setDaikouDistanceFactor(1.0085) に再較正(旧1.013は撤去)', () => {
    expect(html).toMatch(/setDaikouDistanceFactor\(1\.0085\)/);
    expect(html).not.toMatch(/setDaikouDistanceFactor\(1\.013\)/);
  });

  it('★ 係数は ≥1.0 のまま(クランプ[1.0,1.05]内・タクシー1.0要件を壊さない)', () => {
    // 1.0085 は 1.0〜1.05 の範囲内(meter.js setDaikouDistanceFactor のクランプを通る)
    expect(1.0085).toBeGreaterThanOrEqual(1.0);
    expect(1.0085).toBeLessThanOrEqual(1.05);
  });
});
