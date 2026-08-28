// ★物差し★ 2026-08-28 … ★①タクシー認定モードの線（過大ゼロ）で 判定しています★
//   ・この見張りが 赤にするのは ★distance_m ≤ 真距離（過大不可）★ を 破った時（この file 自身に そう書いてある）
//   ・★代行は 検定対象外★＝法として「真距離を超えるな」は 課されていません。
//     代行の実上限は ★DM Light／タイヤ真値 ＋0.5〜6%★ という 緩い天井（係数 1.0085 で わざと上乗せ）。
//   ⇒★ここが赤でも「代行で 過大請求している」とは 限りません★。
//     うちは ★内側の約束★として 過大ゼロを 守っています（2026-08-23 の誤読を 二度と させない為 明記）。
// tests/unit/obd-diagnostic-monitor.test.js
// ★OBD診断モニタ (2026-06-15・距離に焼かない・distance_m不変=過大ゼロ不変)★
//   ① 独立過大ゼロ監視: OBD駆動距離 > Doppler独立基準×1.02 で bd.overcountWarnM 記録(警報・距離不変)。
//   ② ドリフト監視: 較正K と 走行Doppler/OBD比(器差観測) が >3%乖離 → bd.kDriftWarn(タイヤ変化・再較正促し)。
//   監査④の「硬ガードは不可(クリーン≥真値基準が無い)→診断で見張る」を実装。距離は1mmも変えない。
const PD = require('../../js/pipeline-distance.js');
const stub = {
  snapToNearestRoad: () => null,
  getRoadsNear: () => [],
  calcRoadDistance: () => null,
  decodeRoadAt: () => null,
};
const T0 = 1_000_000_000;
function tracker(opts) {
  return PD.createDistanceTracker(stub, {
    useSnapCache: false,
    enableRouting: false,
    adaptiveMode: false,
    obdQuantCorrectMps: 0,
    ...opts,
  });
}
function drive(tk, vObd, dop, n) {
  let t = T0;
  tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: vObd, obd: true, dopMps: dop });
  for (let i = 1; i <= n; i++) {
    t += 1000;
    tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: vObd, obd: true, dopMps: dop });
  }
}

describe('OBD診断モニタ (距離に焼かない)', () => {
  it('★安全(K=1.0・Doppler=OBD)→ overcountWarn 出ない・距離は obd∫v のまま(monitorが距離を変えない)', () => {
    const tk = tracker({ obdVehicleK: 1.0 });
    const v = 14;
    drive(tk, v, v, 60);
    const bd = tk._breakdown();
    expect(bd.overcountWarnM == null || bd.overcountWarnM <= 0).toBe(true); // 過大警報なし
    expect(tk.totalM()).toBeCloseTo(v * 60, 0); // 距離=obd∫v(monitorで変わらない)
    expect(bd.dopRefM).toBeGreaterThan(0); // 独立Doppler基準は積算されてる
  });

  it('★独立過大ゼロ監視: 過大なK(1.05)で OBD駆動距離>Doppler×1.02 → overcountWarnM>0 を記録(距離は別)', () => {
    const tk = tracker({ obdVehicleK: 1.05 });
    const v = 14;
    drive(tk, v, v, 60); // Doppler=OBD=真値相当 / K=1.05 → 距離 = obd×1.05 > Doppler×1.02
    const bd = tk._breakdown();
    expect(bd.overcountWarnM).toBeGreaterThan(0); // 過大を検知
    expect(tk.totalM()).toBeCloseTo(v * 1.05 * 60, 0); // 距離自体はK適用どおり(monitorは記録だけ)
  });

  it('★ドリフト監視: 較正K=1.05 だが走行Doppler/OBD比≈1.0 (タイヤ変化) → kDriftWarn=true', () => {
    const tk = tracker({ obdVehicleK: 1.05 });
    const v = 14;
    drive(tk, v, v, 40); // dop/vEff=1.0・cert-K=1.05 → |1.05/1.0-1|=5%>3% → ドリフト警報
    expect(tk._breakdown().kDriftWarn).toBe(true);
  });

  it('★ドリフトなし: 較正K=1.02 と Doppler/OBD比≈1.02 が整合 → kDriftWarn 出ない', () => {
    const tk = tracker({ obdVehicleK: 1.02 });
    const vObd = 13.72,
      dop = 14; // dop/vEff = 14/13.72 = 1.0204 ≈ cert-K 1.02 → 整合
    drive(tk, vObd, dop, 40);
    const bd = tk._breakdown();
    expect(bd.kDriftWarn == null || bd.kDriftWarn === false).toBe(true);
  });

  it('★未較正(K=0)では ドリフト監視は走らない (kDriftWarn 出ない)', () => {
    const tk = tracker({ obdVehicleK: 0 });
    drive(tk, 13.72, 14, 40);
    const bd = tk._breakdown();
    expect(bd.kDriftWarn == null || bd.kDriftWarn === false).toBe(true);
  });
});
