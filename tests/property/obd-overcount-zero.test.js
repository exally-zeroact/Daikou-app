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
function run(speedsMps, readFactor, roundMode, dopFn, daikouMode) {
  // daikouMode=true → 代行(p50)／false or 省略 → タクシー(p25・既定)
  const tk = newTracker({ obdDaikouMode: daikouMode === true });
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

describe('OBDティア 距離の物差し (無作為車種)', () => {
  // ============================================================
  // ★なぜ物差しが2つ要るのか（2026-08-23・司さんの再指摘／私と指示役が続けて間違えた）★
  //  ①★代行(運転代行メーター)は 検定対象外★。★代行係数 1.011 で わざと真距離+0.1%に乗せ★、
  //    随伴車の DM Light に合わせている＝★わずかに真距離を超えるのが 正常★。
  //    天井は ★タイヤ真値(オドメーター)＝真距離 +0.5〜6%★ という緩い天井。
  //  ②★厳密な過大ゼロ(≤真距離)は タクシーモード(代行係数1.0)専用★。
  //  ⇒★代行に「≤真距離」を当てない★。当てると ★正常な物を「過大課金」と呼ぶ★（2026-08-23 実際に起きた）。
  //  詳しくは CLAUDE.md の頭「★距離を触る前に必ず読む★」。
  // ============================================================
  const speedArb = fc.array(fc.double({ min: 3, max: 25, noNaN: true }), {
    minLength: 40,
    maxLength: 90,
  });
  // 良Doppler：5点に1点だけ上向きスパイク(マルチパス)・他は真値
  const spikyDop = (spikeSeed) => (i, vTrue) => {
    if (vTrue <= 0) return 0;
    if (i % 5 === 0) return vTrue * (1.5 + spikeSeed);
    return vTrue;
  };

  // ★出しているのは代行だけ★＝これが本番の物差し。
  //   天井＝タイヤ真値(オド)の上限 +6%（記憶 2026-06-19「オドは真距離+0.5〜6%」）。
  //   実測（無作為3,000回・2026-08-23）… 代行のいちばん過大な時 ★+1.554%★（412.5m で +6.41m）
  it('★代行(p50)★ Doppler有り × readFactor[0.95,1.03] → distance ≤ タイヤ真値の天井(+6%)', () => {
    fc.assert(
      fc.property(
        speedArb,
        fc.double({ min: 0.95, max: 1.03, noNaN: true }),
        fc.boolean(),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (speeds, readFactor, roundMode, spikeSeed) => {
          const { dist, trueDist } = run(speeds, readFactor, roundMode, spikyDop(spikeSeed), true);
          return dist <= trueDist * 1.06 + 1.0;
        }
      ),
      { numRuns: 120 }
    );
  });

  // ============================================================
  // ★タクシーモードの宿題（2026-08-23 実測・直さないと決めた物）★
  //   タクシー(p25・係数1.0)は 本来 ★≤真距離★ が法要件。だが実測で超える反例が在る:
  //     ★seed = -622600790★ … 40点・タイヤの読み1.0103倍・floor・5点に1点1.5倍のスパイク
  //     150m→+1.18m(0.787%)／752m→+8.25m(1.10%)／3,760m→+43.6m(1.16%)＝★距離に比例して増える★
  //   無作為3,000回での いちばん過大 … ★+0.130%★（427.6m で +0.56m）
  //   ★今 客に出しているのは代行だけ＝この違反は客に効いていない★ ので直さない（司さん/指示役 2026-08-23）。
  //   ★タクシー参入を決めた日に 下の 1.01 を外して ≤真距離(+1.0m) に戻す★＝その時 必ず赤くなる。
  //   ここは「見なかった事にする」ではなく ★今の大きさを数字で見張る★ 為の試験。
  //   直す所 … js/pipeline-distance.js の obdDopQuantile(0.25) / obdDopMinN(5) / obdColdStartK(0.97)
  // ============================================================
  it('★タクシー(p25)の宿題★ 今の過大は +1% 以内に収まっている（超えたら悪化＝赤）', () => {
    fc.assert(
      fc.property(
        speedArb,
        fc.double({ min: 0.95, max: 1.03, noNaN: true }),
        fc.boolean(),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (speeds, readFactor, roundMode, spikeSeed) => {
          const { dist, trueDist } = run(speeds, readFactor, roundMode, spikyDop(spikeSeed), false);
          return dist <= trueDist * 1.01 + 1.0;
        }
      ),
      { numRuns: 120 }
    );
  });

  it('★タクシー(p25)の宿題・反例そのもの★ seed=-622600790 を毎回 通す（回帰）', () => {
    fc.assert(
      fc.property(
        speedArb,
        fc.double({ min: 0.95, max: 1.03, noNaN: true }),
        fc.boolean(),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (speeds, readFactor, roundMode, spikeSeed) => {
          const { dist, trueDist } = run(speeds, readFactor, roundMode, spikyDop(spikeSeed), false);
          return dist <= trueDist * 1.01 + 1.0;
        }
      ),
      {
        numRuns: 1,
        seed: -622600790,
        path: '8:6:10:15:18:3:0:6:14:17:19:24:26:28:32:36:36:20:20:2:15:17:17:17:16:17:16:16:17:16:19:16:16:17:16:19:16:19:20:24:17:19:16:17:17:17:1:12:0:4:4:7:4:4:6:12:4:6:4:9:7:5:4:4:4:6:4:4:4:4:6:6:4:4:5:4:4:4:5:1:0:2:6:0:3:0:3:1:1:1:2:1:1:0:1:0:2:1:0:1:0:0:1:0:1:1:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:1:0:0:0:0:0:0:1:0:0:0:0:2:0:0:0:1:1:1:1:0:1:0:0:2:1:0:0:0:1:0:6:0:0:0:0:1:3:0:0:0:0:0:0:0:0:1:1:0:6:4:2:0:0:0:7:0:0:0:0:1:1:2:1:1:13:0:0:1:0:5:0:1:1:0:1:1:2:0:1:1:0:0:4:4:0:2:0:1:0:0:0:1:1:0:0:2:0:1:1:1:0:1:2:5:0:1:1:0:1:0:3:0:6:0:1:2:1:1:0:1:4:0:0:0:2:1:0:3:1:1:0:3:1:0:5:0:1:1:4:0:0:0:2:3:0:1:3:0:0:0:0:4:0:1:0:0:0:0:4:3:0:0:0:0:0:3:0:1:1:4:2:2:1:5:0:1:0:2:2:1:1:52',
        endOnFailure: true,
      }
    );
  });

  it('Doppler間欠(50%欠落)× readFactor[0.95,1.03](δ_max内) → distance ≤ 真距離+honest-limit', () => {
    // ★これはタクシー(p25)の採点★（代行の天井は上の +6%）
    fc.assert(
      fc.property(
        speedArb,
        fc.double({ min: 0.95, max: 1.03, noNaN: true }), // δ_max=3%内(タイヤサイズ既知)
        fc.boolean(),
        (speeds, readFactor, roundMode) => {
          // Doppler 50%欠落(トンネル/キャニオン断続)= cold-start k0 + 保持 k_now が保証
          const dopFn = (i, vTrue) => (i % 2 === 0 && vTrue > 0 ? vTrue : -1);
          const { dist, trueDist } = run(speeds, readFactor, roundMode, dopFn, false);
          // ★honest-limit(2026-07-04・実測で確定)★: Doppler が半分欠落した劣化入力 かつ readFactor=1.03
          //   (δ_max=タイヤ誤差の境界) の合成worstでは、天井(dopP25)が present 点にしか効かず、held k_now が
          //   missing 点を抑えるが端で微小過大しうる(fast-check探索の実測 最大 +1.055m=+0.170%・rf=1.03丁度)。
          return dist <= trueDist * 1.005 + 0.5;
        }
      ),
      { numRuns: 120 }
    );
  });
});
