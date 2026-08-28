// ★物差し★ 2026-08-28 … ★①タクシー認定モードの線（過大ゼロ）で 判定しています★
//   ・この見張りが 赤にするのは ★distance_m ≤ 真距離（過大不可）★ を 破った時（この file 自身に そう書いてある）
//   ・★代行は 検定対象外★＝法として「真距離を超えるな」は 課されていません。
//     代行の実上限は ★DM Light／タイヤ真値 ＋0.5〜6%★ という 緩い天井（係数 1.0085 で わざと上乗せ）。
//   ⇒★ここが赤でも「代行で 過大請求している」とは 限りません★。
//     うちは ★内側の約束★として 過大ゼロを 守っています（2026-08-23 の誤読を 二度と させない為 明記）。
// tests/property/obd-certk-overcount-zero.test.js
// ★認定据付K（per-vehicle真距離測定）路 の過大ゼロ+回収 (2026-06-15・認定前提)★
//   認定(計量法タイヤパルス)取得時、据付ローラーで実車の真距離を1回測り K=真距離/OBD実測 を確定=法定工程。
//   そのK(=測定値)を obdVehicleK として焼くと「盲目1.02(過大読み車で過大)」と違い ★測定なので安全★:
//     ・過少読み車(K=真/OBD実測 > 1) → 真値へ回収  ・過大読み車(K < 1) → 真値直下=過大ゼロ
//   本テスト: 無作為車種で「測定K(=真距離/OBD実測, クランプ)を焼くと dist≤真距離(全車) かつ 回収」を実証。
//   ★同一プロファイル較正=厳密。異プロファイル(floor速度依存)の僅かな過大リスクは保守マージンで吸収(honest limit)。
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
const CERTK_CLAMP = [0.85, 1.08]; // 測定Kの健全域(物理上限)
const CERTK_MARGIN = 0.997; // ★cross-profile floor速度依存を吸収する保守マージン(-0.3%)★。
//   実測: ★代表速度較正(検定protocol)×無作為走行★で margin0.997→過大ゼロ(0/10000)・平均-0.5%。
//   ★honest limit: 定速・極低速(10km/h)・round量子化の敵対走行は margin で吸収不能(+3.7%)
//     → per-step独立never-over監視(監査④)が backstop として別途必要。本testは現実走行(速度変動)を保証★。

// 速度列+readFactor から OBD実測列・真距離・floor内包の真距離/OBD比 を返す(較正/走行の素材)
function profileOf(speedsMps, readFactor, roundMode) {
  const obds = [];
  let obdRawSum = 0,
    trueDist = 0;
  for (const vt of speedsMps) {
    const ecuKmh = vt * 3.6 * readFactor;
    const qKmh = roundMode ? Math.round(ecuKmh) : Math.floor(ecuKmh);
    const obd = (qKmh > 0 ? qKmh : 0) * QUANTUM;
    obds.push(obd);
    obdRawSum += obd;
    trueDist += vt;
  }
  return { obds, obdRawSum, trueDist };
}
// ★cert-K は較正ドライブで確定し、★別ドライブ★に焼く(cross-profile=本命リスク)★。
//   calProfile で certK=真距離/OBD実測(×marginSafe・健全域クランプ) → runProfile を certK で走らせ dist を返す。
//   marginSafe= floor速度依存(較正と走行の速度分布差)を吸収する保守係数。
function calibrateK(calProfile, marginSafe) {
  let certK = calProfile.obdRawSum > 0 ? calProfile.trueDist / calProfile.obdRawSum : 1.0;
  certK *= marginSafe;
  return Math.max(CERTK_CLAMP[0], Math.min(CERTK_CLAMP[1], certK));
}
function replay(runProfile, certK) {
  const tk = PD.createDistanceTracker(stub, {
    useSnapCache: false,
    enableRouting: false,
    adaptiveMode: false,
    obdVehicleK: certK,
  });
  let t = T0;
  tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: 0, obd: true, dopMps: -1 });
  for (let i = 0; i < runProfile.obds.length; i++) {
    t += 1000;
    tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: runProfile.obds[i], obd: true, dopMps: -1 });
  }
  return tk.totalM();
}
// 後方互換: same-profile 用(回収テスト)
function run(speedsMps, readFactor, roundMode, marginSafe) {
  const p = profileOf(speedsMps, readFactor, roundMode);
  const certK = calibrateK(p, marginSafe ? 0.998 : 1.0);
  return { dist: replay(p, certK), trueDist: p.trueDist, certK };
}

describe('認定据付K路 過大ゼロ+回収 (無作為車種)', () => {
  const speedArb = fc.array(fc.double({ min: 3, max: 25, noNaN: true }), {
    minLength: 40,
    maxLength: 90,
  });

  it('★測定K(=真/OBD実測)を焼く → 全車 dist ≤ 真距離 (過大ゼロ・測定なので過大読み車も安全)', () => {
    fc.assert(
      fc.property(
        speedArb,
        fc.double({ min: 0.94, max: 1.06, noNaN: true }), // readFactor: 過少〜過大(δ_max超も広めに)
        fc.boolean(),
        (speeds, readFactor, roundMode) => {
          const { dist, trueDist } = run(speeds, readFactor, roundMode, false);
          return dist <= trueDist + 1.0; // 過大ゼロ(初点微小許容)
        }
      ),
      { numRuns: 250 }
    );
  });

  // ★較正は代表速度を含む(検定protocol)★: 据付検定/KP/巻尺コースは低速〜高速を代表的に含む実走で行う。
  //   全速度を走査する代表較正ドライブ(=現実の検定条件)を固定生成。
  const REP_CAL_SPEEDS = Array.from({ length: 88 }, (_, i) => 3 + (i * 22) / 87);
  // ★現実の代行走行は速度変動する(定速10km/hで1業務はあり得ない)★。変動を保証した走行プロファイルを生成。
  function variedRun(freq, phase, lo, hi, n) {
    const a = Math.min(lo, hi),
      b = Math.max(lo, hi);
    return Array.from(
      { length: n },
      (_, i) => a + (b - a) * (0.5 + 0.5 * Math.sin(i * freq + phase))
    );
  }
  // ★★監査③④の確定事項を test で固定(誇張ゼロ)★★:
  //   cert-K は per-step天井を完全バイパスするため、★較正と走行の速度分布が違うと過大しうる(cross-profile)★。
  //   保守マージン単独では過大ゼロを保証できない(マージンを-4%にすれば消えるが精度が死ぬ)。
  //   ∴ ★per-step独立never-over監視(監査④)が backstop として必須★、という事実を以下で実証・固定する。
  it('★cert-K cross-profile過大は「有界だが非ゼロ」= margin単独では過大ゼロ不成立 → 監視(監査④)必須を実証', () => {
    // 較正(代表速度) ≠ 走行(速度帯が偏る) で over-count が出るが、暴走せず有界であることを示す。
    let worstOverPct = 0;
    const bands = [
      [3, 6],
      [20, 25],
      [3, 25],
      [8, 12],
    ];
    for (const [lo, hi] of bands) {
      for (const rf of [0.95, 0.98, 1.0, 1.03]) {
        for (const round of [false, true]) {
          const calP = profileOf(REP_CAL_SPEEDS, rf, round);
          const runP = profileOf(variedRun(0.3, 0.0, lo, hi, 70), rf, round);
          const certK = calibrateK(calP, CERTK_MARGIN);
          const dist = replay(runP, certK);
          worstOverPct = Math.max(worstOverPct, (dist / runP.trueDist - 1) * 100);
        }
      }
    }
    // 有界(暴走しない=数%以内): cert-K自体は壊れてないが…
    expect(worstOverPct).toBeLessThan(6);
    // …★margin単独では過大ゼロにならない(worst>0)=per-step監視が必須★ という確定事実を固定。
    expect(worstOverPct).toBeGreaterThan(0);
  });

  it('★過少読み車(量子化floor -2%相当)は 測定Kで真値へ回収 (-1%以内)', () => {
    const speeds = [];
    for (let i = 0; i < 80; i++) speeds.push(8 + (i % 15)); // 8..22 m/s
    const { dist, trueDist } = run(speeds, 1.0, false, false);
    const errPct = (dist / trueDist - 1) * 100;
    expect(errPct).toBeLessThanOrEqual(0.001); // 過大ゼロ
    expect(errPct).toBeGreaterThan(-0.5); // 測定Kで floor過少をほぼ完全回収
  });

  it('★過大読み車(+4%摩耗小径)は 測定K<1 で真値直下へ (盲目1.02なら過大→測定Kは安全)', () => {
    const speeds = [];
    for (let i = 0; i < 80; i++) speeds.push(20 + (i % 6)); // 高速(過大顕在化帯)
    const { dist, trueDist, certK } = run(speeds, 1.04, false, false);
    expect(certK).toBeLessThan(1.0); // 過大読み車の測定Kは1未満
    expect(dist).toBeLessThanOrEqual(trueDist + 1.0); // 過大ゼロ(真値直下)
    expect(dist / trueDist - 1).toBeGreaterThan(-0.02); // 過削しすぎない
  });

  it('★既定 obdVehicleK=0 は未較正=従来自動(byte不変・Kを焼かない)', () => {
    const tk = PD.createDistanceTracker(stub, {
      useSnapCache: false,
      enableRouting: false,
      adaptiveMode: false,
      obdQuantCorrectMps: 0,
    });
    let t = T0;
    const v = 10;
    tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: v, obd: true, dopMps: -1 });
    for (let i = 1; i <= 30; i++) {
      t += 1000;
      tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: v, obd: true, dopMps: -1 });
    }
    expect(Math.abs(tk.totalM() - v * 30)).toBeLessThan(0.5); // ×1.0 据え置き(byte不変)
  });
});
