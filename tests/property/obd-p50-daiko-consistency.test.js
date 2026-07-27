// tests/property/obd-p50-daiko-consistency.test.js
// ★p50モードゲート: 代行で過大読みOBDを真スケール(p50)へ持ち上げ全車一致 (2026-06-22)★
//   K無しOBD代行車(アルト=小径タイヤで OBD過大読み)は、タクシー用の保守天井 p25(=比の下側25%分位・
//   真より約1%低い)で約1%過小に削られ、factory K車(モコ)と不一致になっていた。
//   代行(daikouMode=true)で天井分位を p25→p50(中央値=真スケール)に切替え、全車を真スケールへ揃える。
//   ・代行は過大ゼロ非拘束(DM Light基準)なので p50 で真に乗せてよい。
//   ・タクシー(daikouMode=false)は p25 維持=過大ゼロ法要件(別テストで保証)。
//   ・距離コア distance_m の式形は不変=分位選択のみ。
const path = require('path');
const PD = require(path.join(__dirname, '..', '..', 'js', 'pipeline-distance.js'));

const stub = {
  snapToNearestRoad: () => null,
  getRoadsNear: () => [],
  calcRoadDistance: () => null,
  decodeRoadAt: () => null,
};
const T0 = 1_000_000_000;

function replay(obds, dops, daikouMode) {
  const tk = PD.createDistanceTracker(stub, {
    useSnapCache: false,
    enableRouting: false,
    adaptiveMode: false,
    obdDaikouMode: daikouMode,
  });
  let t = T0;
  tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: 0, obd: true, dopMps: 0 });
  for (let i = 0; i < obds.length; i++) {
    t += 1000;
    tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: obds[i], obd: true, dopMps: dops[i] });
  }
  return tk.totalM();
}

describe('p50モードゲート 代行=真スケール全車一致 (2026-06-22)', () => {
  // 過大読みシナリオ(アルト=小径タイヤ): OBD = 真速度×1.03、Doppler = 真速度(雑音±4%で比に分散)。
  const N = 80;
  const obds = [];
  const dops = [];
  let trueDist = 0;
  for (let i = 0; i < N; i++) {
    const v = 8 + 5 * Math.sin(i * 0.3) + (i % 7); // 3〜18 m/s 変動
    trueDist += v; // dt=1s
    obds.push(v * 1.03); // OBD過大読み +3%
    dops.push(v * (1 + 0.04 * Math.sin(i * 1.7))); // Doppler=真(雑音で比に分散→p25<p50)
  }

  it('★代行(daikouMode=true=p50) は タクシー(false=p25) より距離が高い(p25保守バイアスを解消)', () => {
    const distP25 = replay(obds, dops, false);
    const distP50 = replay(obds, dops, true);
    expect(distP50).toBeGreaterThan(distP25);
  });

  it('★p50 は真距離(Doppler積分)に p25 より近いか同等(=真スケール着地)', () => {
    const distP25 = replay(obds, dops, false);
    const distP50 = replay(obds, dops, true);
    const errP25 = Math.abs(distP25 / trueDist - 1);
    const errP50 = Math.abs(distP50 / trueDist - 1);
    expect(errP50).toBeLessThanOrEqual(errP25 + 1e-9);
  });

  it('★p50 でも暴走しない(真距離×1.05 以下=DM Light基準の有界性)', () => {
    const distP50 = replay(obds, dops, true);
    expect(distP50).toBeLessThanOrEqual(trueDist * 1.05);
  });

  it('★daikouMode 既定(未指定)= p25(=タクシー/byte不変)', () => {
    const tk = PD.createDistanceTracker(stub, {
      useSnapCache: false,
      enableRouting: false,
      adaptiveMode: false,
    });
    let t = T0;
    tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: 0, obd: true, dopMps: 0 });
    for (let i = 0; i < obds.length; i++) {
      t += 1000;
      tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: obds[i], obd: true, dopMps: dops[i] });
    }
    const distDefault = tk.totalM();
    const distP25 = replay(obds, dops, false);
    expect(distDefault).toBe(distP25); // 既定=false=p25 と完全一致
  });

  // ★universal化 (2026-06-22・司さん要望「モコもKなし対応」): factory K車(MG33S=1.018)でも
  //   代行(daikouMode=true)では K表をバイパスし全車と同じ Doppler自己較正(p50)を使う。
  //   タクシー(daikouMode=false)のみ測定K(認定/過大ゼロ)を使う。
  function replayK(obds, dops, vehicleK, daikouMode) {
    const tk = PD.createDistanceTracker(stub, {
      useSnapCache: false,
      enableRouting: false,
      adaptiveMode: false,
      obdVehicleK: vehicleK,
      obdDaikouMode: daikouMode,
    });
    let t = T0;
    tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: 0, obd: true, dopMps: 0 });
    for (let i = 0; i < obds.length; i++) {
      t += 1000;
      tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: obds[i], obd: true, dopMps: dops[i] });
    }
    return tk.totalM();
  }

  it('★モコ等factory K車: タクシー(daikouMode=false)は測定K使用 / 代行(true)はKバイパスでp50=universal', () => {
    const K = 1.018; // MG33S factory K
    const distTaxiK = replayK(obds, dops, K, false); // タクシー: K=1.018 適用
    const distDaikoP50 = replayK(obds, dops, K, true); // 代行: K無視→p50
    const distNoKP50 = replay(obds, dops, true); // K無し車の代行(p50)
    // 代行のfactory K車は K を使わない=K適用結果と異なる(=バイパスされている)
    expect(distDaikoP50).not.toBe(distTaxiK);
    // 代行のfactory K車は K無し車と同じ p50 経路=完全一致(=universal・同じ仕組み)
    expect(distDaikoP50).toBe(distNoKP50);
  });
});
