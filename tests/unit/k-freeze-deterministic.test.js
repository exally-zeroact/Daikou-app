// tests/unit/k-freeze-deterministic.test.js
//
// ★2026-07-04 距離の同経路ブレ 根治(K凍結=決定的化)★
//   実機モコ(較正済40窓)で同一経路の2本が td 2851 vs 2868(0.6%ブレ)。生OBD∫vは2759 vs 2761で
//   ピタリ一致=OBDは決定的なのに td がブレる=適用K(getK)がドリフトしてるのが原因。
//   真因: OBD有効中も addPair が毎点発火し続け、confident(較正済)後も較正器が学習を続けて median K が
//   業務ごとにズレる → 同経路でも適用Kが変わり距離がブレる(DECIDED「一度較正→ずっと正確」違反)。
//   根治: confident になったら学習を止め K を凍結 → 距離=生OBD∫v×凍結K=同経路同距離(決定的)。
//   ※pipeline経由(addPairはpipeline-distanceのOBD枝が呼ぶ)で検証。

'use strict';

const PD = require('../../js/pipeline-distance.js');
const KCalib = require('../../js/k-calib.js');

const stub = {
  snapToNearestRoad: () => null,
  getRoadsNear: () => [],
  calcRoadDistance: () => null,
  decodeRoadAt: () => null,
};
function drive(tk, nSteps, startT, startLat) {
  let t = startT,
    lat = startLat;
  for (let i = 0; i < nSteps; i++) {
    tk.ingest({ lat: lat, lng: 133.0, t: t, acc: 5, spd: 10, obd: true });
    t += 1000;
    lat += 9e-5;
  }
  return { t, lat };
}

describe('K凍結: confident後は学習停止=決定的(同経路同距離)', () => {
  it('★ confident後に走り続けても windows/getK が変わらない(=凍結・ドリフトしない)', () => {
    const shared = KCalib.createKCalibrator({ calibKm: 1.0 });
    const tk = PD.createDistanceTracker(stub, {
      autoCalibK: true,
      externalKCalib: shared,
      useSnapCache: false,
      enableRouting: false,
    });
    const p = drive(tk, 320, 1000, 34.0); // ~3.2km → 3窓+ = confident
    expect(shared.confident()).toBe(true);
    const wFrozen = shared.windows();
    const kFrozen = shared.getK();

    // ★confident後にさらに走る → 従来は windows 増加(ドリフト)。凍結後は不変であるべき★
    drive(tk, 400, p.t, p.lat);
    expect(shared.windows()).toBe(wFrozen); // 学習停止=窓は増えない
    expect(shared.getK()).toBe(kFrozen); // K凍結
  });

  it('★ 較正済(復元40窓)なら最初から凍結=学習ゼロ・getK不変', () => {
    const ks = Array.from({ length: 40 }, () => 1.02);
    const shared = KCalib.createKCalibrator({ calibKm: 1.0, restoreKs: ks });
    expect(shared.confident()).toBe(true);
    const kFrozen = shared.getK();
    const wFrozen = shared.windows();
    const tk = PD.createDistanceTracker(stub, {
      autoCalibK: true,
      externalKCalib: shared,
      useSnapCache: false,
      enableRouting: false,
    });
    drive(tk, 500, 1000, 34.0); // 走っても学習しない(既にconfident)
    expect(shared.windows()).toBe(wFrozen);
    expect(shared.getK()).toBe(kFrozen);
  });

  it('★ 決定的: 較正済の同じKで同じOBD入力を2回 → 同じ距離(ブレ無し)', () => {
    const ks = Array.from({ length: 40 }, () => 1.02);
    const mk = () =>
      PD.createDistanceTracker(stub, {
        autoCalibK: true,
        externalKCalib: KCalib.createKCalibrator({ calibKm: 1.0, restoreKs: ks.slice() }),
        useSnapCache: false,
        enableRouting: false,
      });
    const a = mk();
    const b = mk();
    drive(a, 300, 1000, 34.0);
    drive(b, 300, 1000, 34.0);
    expect(a.totalM()).toBeCloseTo(b.totalM(), 6); // 同一入力→同一距離(決定的)
    expect(a.totalM()).toBeGreaterThan(0);
  });
});
