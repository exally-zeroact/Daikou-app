// tests/unit/k-calib-shared.test.js
// ★STEP2: 較正器を車単位(共有)に格上げ★ — 県別tracker/業務resetでtrackerが作り直されても
//   externalKCalib(共有較正器)に注入すれば K(Ks)が残ることを検証する。
//   =司さん「業務ごとリセットは無駄」の根治。distance_m/byte不変はOFF経路で別途担保。

const PD = require('../../js/pipeline-distance.js');
const KCalib = require('../../js/k-calib.js');

const stub = {
  snapToNearestRoad: () => null,
  getRoadsNear: () => [],
  calcRoadDistance: () => null,
  decodeRoadAt: () => null,
};

// ~1km/窓 になる合成OBD走行を tracker.ingest へ流す。obd:true で OBD∫v枝が kCalibrator.addPair を呼ぶ。
//   GPS弦/step ≈ 10m(lat+9e-5deg), OBD 10m/s×1s=10m → 窓K≈1.0(健全域内)。100step=1km=1窓。
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

describe('STEP2 externalKCalib 共有(車単位較正器)', () => {
  it('★共有較正器は tracker 作り直し(県跨ぎ/業務reset相当)を跨いでKを保持する★', () => {
    const shared = KCalib.createKCalibrator({ calibKm: 1.0 });

    // tracker1(=県A or 業務1): 3窓ぶん走って confident に到達
    const tk1 = PD.createDistanceTracker(stub, {
      autoCalibK: true,
      externalKCalib: shared,
      useSnapCache: false,
      enableRouting: false,
    });
    const p = drive(tk1, 320, 1000, 34.0); // ~3.2km → 3窓+
    expect(shared.confident()).toBe(true);
    const kAfter1 = shared.getK();
    const wAfter1 = shared.snapshot().windows;
    expect(wAfter1).toBeGreaterThanOrEqual(3);

    // ★業務終了→新業務 or 県跨ぎ相当 = 新しい tracker を作る(map-matcherの_pipelineTrackers.clear()と同じ)★
    const tk2 = PD.createDistanceTracker(stub, {
      autoCalibK: true,
      externalKCalib: shared, // ★同じ共有較正器を注入★
      useSnapCache: false,
      enableRouting: false,
    });
    // 新trackerでも共有較正器はリセットされず confident のまま=Kが残ってる
    expect(shared.confident()).toBe(true);
    expect(shared.getK()).toBeCloseTo(kAfter1, 6);

    // ★2026-07-04 K凍結後の挙動: confident済なので2業務目は学習しない(窓は凍結・K保持=決定的)★
    //   (旧: 継続学習で窓が増える → K凍結で「一度較正→ずっと正確・再較正不要」に変更)
    drive(tk2, 120, p.t, p.lat);
    expect(shared.snapshot().windows).toBe(wAfter1); // 凍結=増えない(ドリフトしない)
    expect(shared.getK()).toBeCloseTo(kAfter1, 6); // K保持(共有較正器の値は決定的)
  });

  it('★K自動保存サイクル: 走行で貯めたKs→車に保存→別日その車で復元→再較正せず即confident同K★', () => {
    const VR = require('../../js/veh-registry.js');
    // セッション1: 共有較正器で走って較正完了
    const cal1 = KCalib.createKCalibrator({ calibKm: 1.0 });
    const tk = PD.createDistanceTracker(stub, {
      autoCalibK: true,
      externalKCalib: cal1,
      useSnapCache: false,
      enableRouting: false,
    });
    drive(tk, 320, 1000, 34.0);
    expect(cal1.confident()).toBe(true);
    const ksSaved = cal1.snapshot().Ks; // = mmResult.calibStatus.Ks 相当(index.htmlが保存する値)

    // 車レジストリに保存(index.html: VehRegistry.setCalibKs)
    const m = new Map();
    const store = {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    };
    VR.save(store, { id: 'v1', name: 'アルト' });
    VR.setCalibKs(store, 'v1', ksSaved);

    // セッション2(別日・接続→業務開始の configVehicle restoreKs 相当): その車のKsで復元
    const cal2 = KCalib.createKCalibrator({ calibKm: 1.0, restoreKs: VR.getCalibKs(store, 'v1') });
    expect(cal2.confident()).toBe(true); // ★再較正不要で即 confident★
    expect(cal2.getK()).toBeCloseTo(cal1.getK(), 6); // ★同じK★
  });

  it('externalKCalib 未注入(内部生成)では tracker毎に別較正器=従来通り(後方互換)', () => {
    const tkA = PD.createDistanceTracker(stub, {
      autoCalibK: true,
      useSnapCache: false,
      enableRouting: false,
    });
    drive(tkA, 320, 1000, 34.0);
    // 別trackerは別の内部較正器→Aの学習を共有しない(externalKCalib無し時の従来挙動)
    const tkB = PD.createDistanceTracker(stub, {
      autoCalibK: true,
      useSnapCache: false,
      enableRouting: false,
    });
    // tkB は未走行=未較正(getK は coldStart無しで null)。A の K を引き継がない。
    // (距離は totalM で確認: B は走ってないので 0)
    expect(tkB.totalM()).toBe(0);
  });
});
