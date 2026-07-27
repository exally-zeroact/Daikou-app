// tests/integration/trace-obd-gps-breakdown.test.js
//
// ★2026-07-04 距離内訳計装(同経路ブレの残り源=GPS漏れ測定)★
//   K凍結でK-driftは止めたが、OBD有効点の一部が GPS弦(smoothed)に漏れると同経路でもブレが残る。
//   mmResult.pipelineDeltaSrc('obd'/'gps') を使い距離増分を OBD∫v駆動 vs GPS駆動 で分けて累積し、
//   traceの各サンプルに om(OBD累積m)/gm(GPS累積m) を焼く → 次の実走で業務窓の差分から
//   「距離のうち何mがGPS漏れか」を数値で特定できる(憶測せず内訳で潰す)。距離/課金に無関与(読むだけ)。
//   ※source assertion。

'use strict';

const fs = require('fs');
const path = require('path');

let html, trace;
beforeAll(() => {
  const root = path.join(__dirname, '..', '..');
  html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  trace = fs.readFileSync(path.join(root, 'js', 'debug-trace.js'), 'utf8');
});

describe('距離内訳計装: OBD∫v駆動 vs GPS駆動 (GPS漏れ測定)', () => {
  it('★ index.html が pipelineDeltaSrc で obdM/gpsM を分けて累積', () => {
    expect(html).toMatch(/m\.pipelineDeltaSrc\s*===\s*'obd'/);
    expect(html).toMatch(
      /window\._cumObdM\s*=\s*\(window\._cumObdM\s*\|\|\s*0\)\s*\+\s*m\.pipelineDeltaM/
    );
    expect(html).toMatch(
      /window\._cumGpsM\s*=\s*\(window\._cumGpsM\s*\|\|\s*0\)\s*\+\s*m\.pipelineDeltaM/
    );
  });

  it('★ trace の各サンプルに om(OBD累積)/gm(GPS累積) を焼く', () => {
    expect(trace).toMatch(/om:\s*[\s\S]*?window\._cumObdM/);
    expect(trace).toMatch(/gm:\s*[\s\S]*?window\._cumGpsM/);
  });
});
