// tests/property/obd-overcount-zero.test.js
// ★OBDティア 過大ゼロ property (2026-06-13)★
//   赤チーム致命穴(OBD∫v天井ゼロ→摩耗過大読み車が過大課金)の是正を、★無作為な車種条件で網羅検証★。
//   生成: 真速度プロファイル × 読み係数(過大/過少 readFactor) × 量子化(floor/round) × Doppler(スパイク/欠落)。
//   述語: distance_m ≤ 真距離(認定 over=0・法的)。
//   ・天井(min(vEff·dt, dopP25·dt))が Doppler有り区間で過大読み車を毎点刈る。
//   ・cold-start k0=0.97 が δ_max≈3%(タイヤサイズ既知)内の過大読みを窓充足前も抑える。
//   honest limit: readFactor>1.03(δ_max超=規格外タイヤ) かつ Doppler皆無 は構造的に保証外→生成範囲を分離。

const path = require('path');
const fc = require('fast-check');
const PD = require(path.join(__dirname, '..', '..', 'js', 'pipeline-distance.js'));

const stubDecoder = {
  snapToNearestRoad: () => null,
  getRoadsNear: () => [],
  calcRoadDistance: () => null,
  decodeRoadAt: () => null,
};
function newTracker(opts) {
  return PD.createDistanceTracker(stubDecoder, {
    useSnapCache: false,
    enableRouting: false,
    adaptiveMode: false,
    ...opts,
  });
}
const QUANTUM = 1 / 3.6; // 1km/h in m/s
const T0 = 1_000_000_000;

// 真速度列(m/s) を渡し OBD(量子化)+Doppler を生成して走らせ、distance と 真距離 を返す。
function run(speedsMps, readFactor, roundMode, dopFn) {
  const tk = newTracker();
  let t = T0;
  let trueDist = 0;
  // first point
  tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: 0, obd: true, dopMps: dopFn(0, 0) });
  for (let i = 0; i < speedsMps.length; i++) {
    t += 1000;
    const vTrue = speedsMps[i];
    // ECU速度 = 真速度 × タイヤ読み係数。量子化(floor or round)で1km/h刻みに。
    const ecuKmh = vTrue * 3.6 * readFactor;
    const qKmh = roundMode ? Math.round(ecuKmh) : Math.floor(ecuKmh);
    const obdMps = (qKmh > 0 ? qKmh : 0) * QUANTUM;
    tk.ingest({
      lat: 34,
      lng: 133,
      t,
      acc: 5,
      spd: obdMps,
      obd: true,
      dopMps: dopFn(i, vTrue),
    });
    trueDist += vTrue * 1.0; // dt=1s
  }
  return { dist: tk.totalM(), trueDist };
}

describe('OBDティア 過大ゼロ property (無作為車種)', () => {
  const speedArb = fc.array(fc.double({ min: 3, max: 25, noNaN: true }), {
    minLength: 40,
    maxLength: 90,
  });

  // ★全行程の過大ゼロ保証は readFactor ≤ 1.03 (=δ_max=3%・タイヤサイズ既知の物理上限)★。
  //   cold-start(比窓充足前)は k0=0.97 が δ_max まで保護。>1.03(規格外タイヤ)は比窓充足後のみ天井が刈る
  //   =全行程ではcold-startで微小過大しうる(honest limit)。よって本 property は δ_max 内で検証。
  it('Doppler有り(スパイク含む)× readFactor[0.95,1.03](δ_max内) → distance ≤ 真距離', () => {
    fc.assert(
      fc.property(
        speedArb,
        fc.double({ min: 0.95, max: 1.03, noNaN: true }), // タイヤ読み係数(過少〜δ_max過大)
        fc.boolean(), // 量子化: round / floor
        fc.double({ min: 0, max: 1, noNaN: true }), // スパイク種
        (speeds, readFactor, roundMode, spikeSeed) => {
          // Doppler = 真速度(微小ノイズ)・5点に1点 上向きスパイク(マルチパス)
          const dopFn = (i, vTrue) => {
            if (vTrue <= 0) return 0;
            if (i % 5 === 0) return vTrue * (1.5 + spikeSeed); // 上向きスパイク
            return vTrue; // クリーン真値
          };
          const { dist, trueDist } = run(speeds, readFactor, roundMode, dopFn);
          // 過大ゼロ: 真距離を超えない(数値・初点の微小許容 +1.0m)
          return dist <= trueDist + 1.0;
        }
      ),
      { numRuns: 120 }
    );
  });

  it('Doppler間欠(50%欠落)× readFactor[0.95,1.03](δ_max内) → distance ≤ 真距離', () => {
    fc.assert(
      fc.property(
        speedArb,
        fc.double({ min: 0.95, max: 1.03, noNaN: true }), // δ_max=3%内(タイヤサイズ既知)
        fc.boolean(),
        (speeds, readFactor, roundMode) => {
          // Doppler 50%欠落(トンネル/キャニオン断続)= cold-start k0 + 保持 k_now が保証
          const dopFn = (i, vTrue) => (i % 2 === 0 && vTrue > 0 ? vTrue : -1);
          const { dist, trueDist } = run(speeds, readFactor, roundMode, dopFn);
          return dist <= trueDist + 1.0;
        }
      ),
      { numRuns: 120 }
    );
  });
});
