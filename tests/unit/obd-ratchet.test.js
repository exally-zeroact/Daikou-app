// tests/unit/obd-ratchet.test.js
// ★OBDティア 精度ラチェット (2026-06-13)★
//   過大ゼロ天井(min(∫v, dopP25·dt))は安全(過大読み車を刈る)だが、★過少読み車(モコ等)は回収しない★
//   (vEff < dopP25 なので min は vEff のまま=-2%据え置き)。
//   是正: k_now を Doppler下側分位の観測スケール k_obs=dopP25/vEff へ ★上方向のみ★ ラチェットし
//        vEff·k_now を真値(dopP25)へ前進収束させる。過去距離は不変=単調=認定。過大ゼロは天井が独立保証。
//   本テストは「過少読み車×Doppler(真)」で k上昇→真値接近・単調・過大ゼロ を hard 検証(実装前=RED)。

const PD = require('../../js/pipeline-distance.js');

const stubDecoder = {
  snapToNearestRoad() {
    return null;
  },
  getRoadsNear() {
    return [];
  },
  calcRoadDistance() {
    return null;
  },
  decodeRoadAt() {
    return null;
  },
};

function newTracker(opts) {
  return PD.createDistanceTracker(stubDecoder, {
    useSnapCache: false,
    enableRouting: false,
    adaptiveMode: false,
    obdQuantCorrectMps: 0,
    ...opts,
  });
}

const T0 = 1_000_000_000;

describe('OBDティア 精度ラチェット (過少読み回収)', () => {
  it('★過少読みECU(-2%)×Doppler(真) → kラチェットで真値へ前進収束 (過大ゼロ・単調)', () => {
    const tk = newTracker({ obdRatchet: true });
    const vTrue = 14; // m/s
    const vObd = 13.72; // -2% 過少読み
    let t = T0;
    let monotonic = true;
    tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: vObd, obd: true, dopMps: vTrue });
    for (let i = 1; i <= 180; i++) {
      t += 1000;
      const r = tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: vObd, obd: true, dopMps: vTrue });
      if (r.deltaM < -1e-9) monotonic = false; // 後退ゼロ
    }
    const trueDist = vTrue * 180;
    const errPct = (tk.totalM() / trueDist - 1) * 100;
    expect(monotonic).toBe(true); // 単調(後退ゼロ)
    expect(errPct).toBeLessThanOrEqual(0.001); // 過大ゼロ (≤真距離)
    // ラチェット無しなら -2% 据え置き。ラチェットで真値へ回収= -1%以内へ前進。
    expect(errPct).toBeGreaterThan(-1.0);
  });

  it('ラチェットしても過大ゼロは保つ (過少読みでk上限到達してもdopP25天井で頭打ち)', () => {
    const tk = newTracker({ obdRatchet: true });
    const vTrue = 10,
      vObd = 9.7; // -3%
    let t = T0;
    tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: vObd, obd: true, dopMps: vTrue });
    for (let i = 1; i <= 180; i++) {
      t += 1000;
      tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: vObd, obd: true, dopMps: vTrue });
    }
    expect(tk.totalM()).toBeLessThanOrEqual(vTrue * 180 + 0.5);
  });

  it('★トンネル死区間: Doppler確立後にDoppler消失(長トンネル)→ k_now保持でOBD連続・正確・過大ゼロ・単調', () => {
    // 山越えトンネルの忠実シナリオ: 196号でDopplerがk_nowを真スケールへ確立 → トンネルでDoppler消失(dopMps=-1)
    //   → k_now を保持してOBD∫v×k_now で連続前進(トンネルも正確)。過大ゼロ・後退ゼロを死区間で保つ。
    const tk = newTracker({ obdRatchet: true });
    const vTrue = 16; // m/s (≈58km/h・山道)
    const vObd = 15.68; // -2% 過少読み
    let t = T0;
    tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: vObd, obd: true, dopMps: vTrue });
    // 前半60s: Doppler有り → k_now を真スケールへ確立
    for (let i = 1; i <= 60; i++) {
      t += 1000;
      tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: vObd, obd: true, dopMps: vTrue });
    }
    const preTunnelTotal = tk.totalM();
    // 後半120s: ★トンネル=Doppler消失(dopMps=-1)・OBDは継続★
    let mono = true,
      prev = preTunnelTotal;
    for (let i = 61; i <= 180; i++) {
      t += 1000;
      const r = tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: vObd, obd: true, dopMps: -1 });
      if (r.deltaM < -1e-9) mono = false; // 後退ゼロ
      if (tk.totalM() < prev - 1e-9) mono = false;
      prev = tk.totalM();
      expect(r.reason).toBe('obd'); // トンネルでもOBD駆動継続
    }
    const totalTrue = vTrue * 180;
    const tunnelTrue = vTrue * 120;
    const tunnelDist = tk.totalM() - preTunnelTotal;
    expect(mono).toBe(true); // 死区間でも単調(認定)
    expect(tk.totalM()).toBeLessThanOrEqual(totalTrue + 0.5); // 過大ゼロ(死区間込み)
    // トンネル区間も保持k_nowで真値近く前進(生-2%でなく回収後スケール)= -1%以内
    expect(tunnelDist / tunnelTrue - 1).toBeGreaterThan(-1.0 / 100);
    expect(tunnelDist).toBeGreaterThan(0); // 凍結せず連続前進(2026-06-10一括ドン根治の維持)
  });

  it('業務内 k は単調増加のみ (後退ゼロ・認定要件) — Doppler一時悪化でも下げない', () => {
    const tk = newTracker({ obdRatchet: true });
    const vTrue = 12,
      vObd = 11.76; // -2%
    let t = T0;
    tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: vObd, obd: true, dopMps: vTrue });
    // 前半: 真Dopplerでkを上げる
    for (let i = 1; i <= 90; i++) {
      t += 1000;
      tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: vObd, obd: true, dopMps: vTrue });
    }
    const midTotal = tk.totalM();
    // 後半: Dopplerが低めに振れてもk_nowは下げない→距離は減速こそすれ後退しない
    let mono = true,
      prev = midTotal;
    for (let i = 91; i <= 150; i++) {
      t += 1000;
      tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: vObd, obd: true, dopMps: vTrue * 0.9 });
      if (tk.totalM() < prev - 1e-9) mono = false;
      prev = tk.totalM();
    }
    expect(mono).toBe(true);
  });
});
