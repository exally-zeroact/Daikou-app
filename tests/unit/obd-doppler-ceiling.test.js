// ★物差し★ 2026-08-28 … ★①タクシー認定モードの線（過大ゼロ）で 判定しています★
//   ・この見張りが 赤にするのは ★distance_m ≤ 真距離（過大不可）★ を 破った時（この file 自身に そう書いてある）
//   ・★代行は 検定対象外★＝法として「真距離を超えるな」は 課されていません。
//     代行の実上限は ★DM Light／タイヤ真値 ＋0.5〜6%★ という 緩い天井（係数 1.0085 で わざと上乗せ）。
//   ⇒★ここが赤でも「代行で 過大請求している」とは 限りません★。
//     うちは ★内側の約束★として 過大ゼロを 守っています（2026-08-23 の誤読を 二度と させない為 明記）。
// tests/unit/obd-doppler-ceiling.test.js
// ★OBDティア 過大ゼロ天井 (2026-06-13)★
//   赤チーム指摘の致命穴: OBD∫v 枝が min 天井ゼロで early return → 摩耗で過大読みのECU(PID010D)が
//   真速度を超えて焼かれ、過大ゼロ(認定片公差 over=0・法的)を破る。
//   是正: 車輪非経由の独立速度=GNSS Doppler(cur.dopMps)の窓内下側分位(p25)×dt を天井にし
//        obdDelta = min(vEff·dt, dopP25·dt)。Dopplerが真距離スケールに保守的に下なので過大を毎点刈る。
//   本テストは「過大読み車×Doppler有り」で distance ≤ 真距離 を hard 検証する(実装前=RED)。

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
    obdQuantCorrectMps: 0, // 量子化補正は切り、天井の効果を単離
    ...opts,
  });
}

const T0 = 1_000_000_000;

describe('OBDティア 過大ゼロ天井 (Doppler下側分位)', () => {
  it('★過大読みECU(+3%)×Doppler(真)有り → distance ≤ 真距離 (天井が刈る)', () => {
    const tk = newTracker();
    const vTrue = 10; // m/s 真速度
    const vObd = 10.3; // m/s OBD過大読み(+3%・摩耗+空気圧・タイヤサイズ既知のδ_max相当)
    let t = T0;
    tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: vObd, obd: true, dopMps: vTrue }); // first
    for (let i = 1; i <= 60; i++) {
      t += 1000;
      tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: vObd, obd: true, dopMps: vTrue });
    }
    const trueDist = vTrue * 60; // 600m
    // 過大ゼロ: 真距離を超えない (微小許容 +0.5m)
    expect(tk.totalM()).toBeLessThanOrEqual(trueDist + 0.5);
  });

  it('過大読みでも過少にしすぎない (Doppler真値の-3%以内には収まる)', () => {
    const tk = newTracker();
    const vTrue = 12,
      vObd = 12.36; // +3%
    let t = T0;
    tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: vObd, obd: true, dopMps: vTrue });
    for (let i = 1; i <= 60; i++) {
      t += 1000;
      tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: vObd, obd: true, dopMps: vTrue });
    }
    const trueDist = vTrue * 60;
    expect(tk.totalM()).toBeGreaterThanOrEqual(trueDist * 0.97);
  });

  it('Dopplerの上向きスパイクは天井を緩めない (p25がスパイク棄却)', () => {
    const tk = newTracker();
    const vTrue = 10,
      vObd = 10.3; // +3%
    let t = T0;
    tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: vObd, obd: true, dopMps: vTrue });
    for (let i = 1; i <= 60; i++) {
      t += 1000;
      // 5点に1点 Doppler が 3倍スパイク(マルチパス) → p25下側分位なら無視されるべき
      const dop = i % 5 === 0 ? vTrue * 3 : vTrue;
      tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: vObd, obd: true, dopMps: dop });
    }
    const trueDist = vTrue * 60;
    expect(tk.totalM()).toBeLessThanOrEqual(trueDist + 0.5);
  });

  it('Doppler無し(dopMps=-1)区間は天井退避し従来∫v (天井で過少暴走しない・後続STEPでk保持/never-over)', () => {
    // この区間は per-step Doppler天井が効かない。現段階では従来∫v が出ることを固定(後続: 保持k/never-over)。
    const tk = newTracker();
    let t = T0;
    tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: 10, obd: true, dopMps: -1 });
    t += 1000;
    const r = tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: 10, obd: true, dopMps: -1 });
    expect(r.reason).toBe('obd');
    expect(r.deltaM).toBeGreaterThan(0);
  });
});
