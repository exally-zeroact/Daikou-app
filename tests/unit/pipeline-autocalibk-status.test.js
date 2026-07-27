// tests/unit/pipeline-autocalibk-status.test.js
//
// ★2026-07-03 修正: 無音の較正K未適用を"検知可能"にする(Fix B)★
//   従来 calibStatus() は kCalibrator が無い時 null を返し、「autoCalibK OFF」と
//   「autoCalibK要求したのに較正器ロード失敗(degraded)」が区別できなかった。
//   → autoCalibK要求時は必ずオブジェクトを返し {requested, active, degraded, confident, K} を出す。
//     app/ゲートが「要求したのにactive=false」を掴んで警告できる=生∫v過小の無音を根絶。
//   ★距離の数字は不変(observability追加のみ・fallback挙動は従来通り)★。

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

describe('pipeline calibStatus: autoCalibK 適用状態を検知可能に (Fix B)', () => {
  it('★ autoCalibK未要求(false) → calibStatus()=null (従来通り・区別の基準)', () => {
    const tk = PD.createDistanceTracker(stub, { useSnapCache: false, enableRouting: false });
    expect(tk.calibStatus()).toBeNull();
  });

  it('★ 要求+confident(保存Ks復元済) → requested:true active:true degraded:false', () => {
    const shared = KCalib.createKCalibrator({
      calibKm: 1.0,
      restoreKs: [1.02, 1.021, 1.019, 1.022, 1.02], // 5窓=即confident
    });
    const tk = PD.createDistanceTracker(stub, {
      autoCalibK: true,
      externalKCalib: shared,
      useSnapCache: false,
      enableRouting: false,
    });
    const cs = tk.calibStatus();
    expect(cs).not.toBeNull();
    expect(cs.requested).toBe(true);
    expect(cs.degraded).toBe(false);
    expect(cs.active).toBe(true); // ★confident=実際にKが乗る状態
    expect(cs.confident).toBe(true);
    expect(cs.K).toBeGreaterThan(1.0);
  });

  it('★ 要求だが未confident(較正中・保存Ks無) → requested:true active:false (=まだ生∫v・検知可)', () => {
    const shared = KCalib.createKCalibrator({ calibKm: 1.0 }); // 空=未confident
    const tk = PD.createDistanceTracker(stub, {
      autoCalibK: true,
      externalKCalib: shared,
      useSnapCache: false,
      enableRouting: false,
    });
    const cs = tk.calibStatus();
    expect(cs).not.toBeNull();
    expect(cs.requested).toBe(true);
    expect(cs.active).toBe(false); // ★まだKが乗ってない=appが警告できる
    expect(cs.confident).toBe(false);
  });

  it('★ 走って3窓貯まれば active:true に遷移する', () => {
    const shared = KCalib.createKCalibrator({ calibKm: 1.0 });
    const tk = PD.createDistanceTracker(stub, {
      autoCalibK: true,
      externalKCalib: shared,
      useSnapCache: false,
      enableRouting: false,
    });
    expect(tk.calibStatus().active).toBe(false);
    drive(tk, 320, 1000, 34.0); // ~3.2km=3窓+
    const cs = tk.calibStatus();
    expect(cs.active).toBe(true);
    expect(cs.confident).toBe(true);
  });

  it('★★ degraded: 較正器を作れない環境(k-calib未ロード相当) → requested:true degraded:true active:false ★★', () => {
    // pipeline-distance が見る self.KCalib.createKCalibrator を「欠落」させ、内部生成を失敗させる
    // (= worker で importScripts('k-calib.js') が404で失敗した実機相当)。externalKCalibは渡さない。
    const orig = globalThis.self;
    globalThis.self = { KCalib: { createKCalibrator: undefined } };
    try {
      const tk = PD.createDistanceTracker(stub, {
        autoCalibK: true,
        useSnapCache: false,
        enableRouting: false,
      });
      const cs = tk.calibStatus();
      // ★従来はここが null=「OFF」と区別不能だった。修正後は degraded を明示=appが検知して警告できる★
      expect(cs).not.toBeNull();
      expect(cs.requested).toBe(true);
      expect(cs.degraded).toBe(true);
      expect(cs.active).toBe(false);
    } finally {
      if (orig === undefined) delete globalThis.self;
      else globalThis.self = orig;
    }
  });
});
