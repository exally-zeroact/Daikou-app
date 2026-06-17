// tests/unit/obd-tire-coldstart-k0.test.js
// ★契約タイヤ → cold-start k0 (2026-06-15・会議生存解②)★
//   観測だけで器差は取れない(情報理論)ので、唯一安全な入力=契約タイヤ申告で cold-start 床を上げる。
//   per-step Doppler天井/ラチェット/quant には触らない(過大ゼロの砦は不変)。
//   本テスト: ①k0は[0.97,1.0]・②良タイヤほどk0高い(単調)・③申告なし=0.97(byte不変)・
//            ④cold-start(Doppler皆無)で「申告が正なら(readFactor≤1/k0)過大ゼロ」を hard 検証。
const PD = require('../../js/pipeline-distance.js');
const stub = {
  snapToNearestRoad: () => null,
  getRoadsNear: () => [],
  calcRoadDistance: () => null,
  decodeRoadAt: () => null,
};
const T0 = 1_000_000_000;
const Q = 1 / 3.6;

describe('契約タイヤ → cold-start k0 純関数', () => {
  it('★k0 は常に [0.97, 1.0] (下限=現状未満禁止・上限=cold-startで過大方向禁止)', () => {
    const specs = [
      undefined,
      {},
      { condition: 'unknown' },
      { condition: 'worn' },
      { condition: 'normal' },
      { condition: 'new' },
      { condition: 'new', sizeDeltaPct: -10 },
      { condition: 'new', sizeDeltaPct: +5 },
      { condition: 'new', season: 'winter' },
    ];
    for (const s of specs) {
      const k0 = PD.tireSpecToK0(s);
      expect(k0).toBeGreaterThanOrEqual(0.97);
      expect(k0).toBeLessThanOrEqual(1.0);
    }
  });

  it('★良いタイヤ(new/OEM径)ほど k0 が高い・悪い/小径ほど低い (単調・保守)', () => {
    const kNew = PD.tireSpecToK0({ condition: 'new' });
    const kNormal = PD.tireSpecToK0({ condition: 'normal' });
    const kWorn = PD.tireSpecToK0({ condition: 'worn' });
    expect(kNew).toBeGreaterThan(kNormal);
    expect(kNormal).toBeGreaterThan(kWorn);
    // 小径申告は過大読み方向→ k0 を下げる
    expect(PD.tireSpecToK0({ condition: 'new', sizeDeltaPct: -3 })).toBeLessThan(kNew);
    // 大径申告(過少方向=安全)は k0 を据え置き(過大方向に上げない)
    expect(PD.tireSpecToK0({ condition: 'new', sizeDeltaPct: +3 })).toBe(kNew);
  });

  it('★申告なし/unknown は 0.97 (= 現状既定・byte不変)', () => {
    expect(PD.tireSpecToK0(undefined)).toBe(0.97);
    expect(PD.tireSpecToK0({})).toBe(0.97);
    expect(PD.tireSpecToK0({ condition: 'unknown' })).toBe(0.97);
  });

  it('★過大ゼロ穴を塞ぐ: Doppler皆無+過大読みECUは 現状×1.0で真値超 → applyNoDop+tire k0 で刈れる', () => {
    // 現行の honest-limit 穴: Doppler一度も無い区間は ×1.0 フォールバック → 過大読み車(readFactor>1)が真値超。
    // 契約タイヤ申告(obdColdStartApplyNoDop:true + k0=1/(1+δ))で、申告整合(readFactor≤1/k0)の過大読み車を刈る。
    const conds = ['new', 'normal', 'worn'];
    for (const cond of conds) {
      const k0 = PD.tireSpecToK0({ condition: cond });
      const readFactor = 1 / k0; // 申告と整合する最悪過大読み(=丁度 s_min)
      const run = (applyNoDop, coldK) => {
        const tk = PD.createDistanceTracker(stub, {
          useSnapCache: false,
          enableRouting: false,
          adaptiveMode: false,
          obdQuantCorrectMps: 0,
          obdColdStartK: coldK,
          obdColdStartApplyNoDop: applyNoDop,
        });
        let t = T0,
          trueDist = 0;
        tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: 0, obd: true, dopMps: -1 });
        for (let i = 0; i < 60; i++) {
          t += 1000;
          // ★高速域(22-25m/s)★: floor量子化損失が小さく、過大読み(readFactor>1)が真値超として顕在化する帯。
          //   (低速域は floor損失-2〜5%が過大読み+1〜3%を相殺するため ×1.0 でも超えない=穴が開かない)
          const vt = 22 + (i % 4);
          const obd = Math.floor(vt * readFactor * 3.6) * Q;
          tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: obd, obd: true, dopMps: -1 });
          trueDist += vt;
        }
        return { dist: tk.totalM(), trueDist };
      };
      // 現状(穴): applyNoDop=false → ×1.0 → 過大読み車は真値超しうる(穴の存在を固定)
      const hole = run(false, k0);
      expect(hole.dist).toBeGreaterThan(hole.trueDist - 0.5); // ×1.0 で真値近傍 or 超(穴)
      // 修正(タイヤ申告): applyNoDop=true + k0 → 申告整合の過大読み車を真値以下に刈る(過大ゼロ)
      const fixed = run(true, k0);
      expect(fixed.dist).toBeLessThanOrEqual(fixed.trueDist + 0.5); // 過大ゼロ達成
    }
  });

  it('★既定(applyNoDop=false)は byte不変: Doppler皆無は従来×1.0 のまま', () => {
    const tk = PD.createDistanceTracker(stub, {
      useSnapCache: false,
      enableRouting: false,
      adaptiveMode: false,
      obdQuantCorrectMps: 0,
      obdColdStartK: 0.99, // tire値を渡しても applyNoDop=false なら無視され ×1.0
    });
    let t = T0;
    const v = 10;
    tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: v, obd: true, dopMps: -1 });
    for (let i = 1; i <= 30; i++) {
      t += 1000;
      tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: v, obd: true, dopMps: -1 });
    }
    // ×1.0 据え置き(byte不変) = 10m/s × 30s = 300m
    expect(Math.abs(tk.totalM() - v * 30)).toBeLessThan(0.5);
  });
});
