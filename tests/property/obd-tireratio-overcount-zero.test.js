// tests/property/obd-tireratio-overcount-zero.test.js
// ★タイヤ円周比(物理的真距離補正)路 の過大ゼロ + 二重補正回避 (2026-06-17)★
//   OBD車速はECUが工場タイヤ円周で換算済み。タイヤ交換(現タイヤ≠工場)で OBD は系統的にズレる。
//   tireRatio = 今÷工場 を ★vEff段(Doppler天井の手前)★ で乗算 → 「現タイヤの真距離」に対し過大ゼロを保つ。
//   ・正しい比 → 真値へ回収  ・過大方向に誤った比 → Doppler天井(車輪非経由の独立速度)が刈り有界。
//   ・恒等(1.0) → byte不変  ・実測K(measured=true) → tireRatio無視(二重回避)  ・factory-K → tireRatio併用。
const path = require('path');
const fc = require('fast-check');
const PD = require(path.join(__dirname, '..', '..', 'js', 'pipeline-distance.js'));

const stub = {
  snapToNearestRoad: () => null,
  getRoadsNear: () => [],
  calcRoadDistance: () => null,
  decodeRoadAt: () => null,
};
const QUANTUM = 1 / 3.6;
const T0 = 1_000_000_000;

// 現タイヤで走った真速度列 + tireRatio(今÷工場) → OBD実測列(工場タイヤ換算でfloor量子化) と Doppler(=真速度・独立)。
function profileOf(speedsMps, tireRatio, roundMode) {
  const obds = [];
  const dops = [];
  let trueDist = 0;
  for (const vt of speedsMps) {
    // OBD車速 = 真速度を★工場タイヤ円周★で換算 = vt / tireRatio (tireRatio=今/工場)。1km/h floor。
    const ecuKmh = (vt * 3.6) / tireRatio;
    const qKmh = roundMode ? Math.round(ecuKmh) : Math.floor(ecuKmh);
    obds.push((qKmh > 0 ? qKmh : 0) * QUANTUM);
    dops.push(vt); // Doppler=搬送波由来=タイヤ非経由=真速度
    trueDist += vt; // dt=1s
  }
  return { obds, dops, trueDist };
}
function replay(p, tireRatio, opts) {
  const tk = PD.createDistanceTracker(stub, {
    useSnapCache: false,
    enableRouting: false,
    adaptiveMode: false,
    obdTireRatio: tireRatio,
    ...(opts || {}),
  });
  let t = T0;
  tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: 0, obd: true, dopMps: 0 });
  for (let i = 0; i < p.obds.length; i++) {
    t += 1000;
    tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: p.obds[i], obd: true, dopMps: p.dops[i] });
  }
  return tk.totalM();
}

describe('タイヤ円周比路 過大ゼロ + 二重補正回避 (2026-06-17)', () => {
  const speedArb = fc.array(fc.double({ min: 3, max: 25, noNaN: true }), {
    minLength: 50,
    maxLength: 90,
  });
  const ratioArb = fc.double({ min: 0.85, max: 1.2, noNaN: true }); // タイヤ大小(健全域内)

  it('★正しい比 → 現タイヤの真距離に対し dist ≤ 真距離 (過大ゼロ)', () => {
    fc.assert(
      fc.property(speedArb, ratioArb, fc.boolean(), (speeds, tireRatio, round) => {
        const p = profileOf(speeds, tireRatio, round);
        const dist = replay(p, tireRatio);
        return dist <= p.trueDist + 1.0; // 初点微小許容
      }),
      { numRuns: 250 }
    );
  });

  it('★過大方向に誤った比でも Doppler天井で有界 (runaway しない backstop)', () => {
    // 実比より +10% 過大な補正でも、独立Dopplerが天井で刈る → +数%以内(cold-start ぶんのみ)。
    fc.assert(
      fc.property(speedArb, ratioArb, (speeds, realRatio) => {
        const p = profileOf(speeds, realRatio, false);
        const dist = replay(p, Math.min(1.25, realRatio * 1.1));
        return dist <= p.trueDist * 1.03; // 天井が無ければ +10% になるところを cold-start 域のみに抑制
      }),
      { numRuns: 150 }
    );
  });

  it('★恒等(tireRatio=1.0) は byte不変 (DEFAULT省略と一致)', () => {
    const speeds = [];
    for (let i = 0; i < 70; i++) speeds.push(8 + (i % 14));
    const p = profileOf(speeds, 1.0, false);
    const withRatio1 = replay(p, 1.0);
    const tk = PD.createDistanceTracker(stub, {
      useSnapCache: false,
      enableRouting: false,
      adaptiveMode: false,
    }); // obdTireRatio 省略=DEFAULT 1.0
    let t = T0;
    tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: 0, obd: true, dopMps: 0 });
    for (let i = 0; i < p.obds.length; i++) {
      t += 1000;
      tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: p.obds[i], obd: true, dopMps: p.dops[i] });
    }
    expect(withRatio1).toBeCloseTo(tk.totalM(), 6);
  });

  it('★実測K(obdVehicleKMeasured=true)路は tireRatio を無視 (二重補正回避)', () => {
    const speeds = [];
    for (let i = 0; i < 70; i++) speeds.push(8 + (i % 14));
    const p = profileOf(speeds, 1.0, false);
    const withTire = replay(p, 1.2, { obdVehicleK: 1.0, obdVehicleKMeasured: true });
    const noTire = replay(p, 1.0, { obdVehicleK: 1.0, obdVehicleKMeasured: true });
    expect(withTire).toBeCloseTo(noTire, 6); // measured=true ならタイヤ比は効かない
  });

  it('★factory-K(measured=false)路は tireRatio を併用 (タイヤ補正が効く)', () => {
    const speeds = [];
    for (let i = 0; i < 70; i++) speeds.push(8 + (i % 14));
    const p = profileOf(speeds, 1.0, false);
    const r10 = replay(p, 1.0, { obdVehicleK: 1.0, obdVehicleKMeasured: false });
    const r11 = replay(p, 1.1, { obdVehicleK: 1.0, obdVehicleKMeasured: false });
    expect(r11).toBeGreaterThan(r10); // factory prior はタイヤ比と併用=効く
  });
});
