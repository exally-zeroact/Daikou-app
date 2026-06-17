// tests/unit/obd-main-distance.test.js
// ★OBD メインモード(2026-06-05・obdブランチ): 速度源がOBDの時、距離を ∫v(OBD)=車輪速度×dt で駆動★
//   = タクシー認定メーター方式・タイヤ値直結。createDistanceTracker に obd:true サンプルを流して検証。
//   cur.obd 未設定の通常GPS経路が不変であることは既存スイート(road-arc)で担保。

const PD = require('../../js/pipeline-distance.js');

// 道路を使わない最小スタブ decoder (OBDメイン経路は snap/road-arc を使わない)
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

function newTracker() {
  // ★OBD ∫v 全駆動は adaptiveMode(2026-06-09出荷)では廃止(実機-3.86%悪化)。
  //   本テスト群は rollback 経路(adaptiveMode:false=従来 OBD ∫v)の契約を固定する。★
  // ★obdQuantCorrectMps:0★ = +0.5km/h floor回収(全車普遍補正)を切り、純 ∫v(=spd×dt)契約を固定する。
  //   量子化補正の改善&過大ゼロは専用ゲート(truedist-obd-engine-gate --quant)で担保。
  return PD.createDistanceTracker(stubDecoder, {
    useSnapCache: false,
    enableRouting: false,
    adaptiveMode: false,
    obdQuantCorrectMps: 0,
  });
}

const T0 = 1_000_000_000;

describe('OBD メインモード ∫v(OBD) 距離駆動', () => {
  it('一定速度 10m/s × 1秒 × 4区間 = 40m (∫v)', () => {
    const tk = newTracker();
    let t = T0;
    let r = tk.ingest({ lat: 34, lng: 133, t: t, acc: 5, spd: 10, obd: true }); // first
    expect(r.deltaM).toBe(0);
    for (let i = 1; i <= 4; i++) {
      t += 1000;
      r = tk.ingest({ lat: 34, lng: 133 + i * 0.0001, t: t, acc: 5, spd: 10, obd: true });
      expect(r.reason).toBe('obd');
      expect(Math.abs(r.deltaM - 10)).toBeLessThan(1e-9);
    }
    expect(Math.abs(tk.totalM() - 40)).toBeLessThan(1e-9);
  });

  it('可変速度を正しく積分する (∫v dt)', () => {
    const tk = newTracker();
    let t = T0;
    tk.ingest({ lat: 34, lng: 133, t: t, acc: 5, spd: 0, obd: true }); // first
    const speeds = [20, 30, 10, 0, 25]; // m/s・各 dt=2s
    let expected = 0;
    for (const s of speeds) {
      t += 2000;
      tk.ingest({ lat: 34, lng: 133, t: t, acc: 5, spd: s, obd: true });
      expected += s * 2;
    }
    expect(Math.abs(tk.totalM() - expected)).toBeLessThan(1e-9);
  });

  it('OBD 速度0(停車)は加算しない (自然ZUPT)', () => {
    const tk = newTracker();
    let t = T0;
    tk.ingest({ lat: 34, lng: 133, t: t, acc: 5, spd: 0, obd: true });
    for (let i = 0; i < 5; i++) {
      t += 1000;
      const r = tk.ingest({ lat: 34, lng: 133, t: t, acc: 5, spd: 0, obd: true });
      expect(r.deltaM).toBe(0);
    }
    expect(tk.totalM()).toBe(0);
  });

  it('異常 dt (>obdMaxDtS=10s) は加算しない (過大ゼロ保険)', () => {
    const tk = newTracker();
    tk.ingest({ lat: 34, lng: 133, t: T0, acc: 5, spd: 20, obd: true });
    const r = tk.ingest({ lat: 34, lng: 133, t: T0 + 30000, acc: 5, spd: 20, obd: true }); // 30s gap
    expect(r.deltaM).toBe(0);
  });

  it('OBD無効(obd未設定)なら ∫v 経路に入らない (reason は obd でない)', () => {
    const tk = newTracker();
    tk.ingest({ lat: 34, lng: 133, t: T0, acc: 5, spd: 10 }); // obd 未設定
    const r = tk.ingest({ lat: 34, lng: 133.0001, t: T0 + 1000, acc: 5, spd: 10 });
    expect(r.reason).not.toBe('obd');
  });

  it('OBD→GPS フォールバック: obd:true→false で OBD積分を止め従来経路へ', () => {
    const tk = newTracker();
    let t = T0;
    tk.ingest({ lat: 34, lng: 133, t: t, acc: 5, spd: 10, obd: true });
    t += 1000;
    const rObd = tk.ingest({ lat: 34, lng: 133.0001, t: t, acc: 5, spd: 10, obd: true });
    expect(rObd.reason).toBe('obd');
    t += 1000;
    const rGps = tk.ingest({ lat: 34, lng: 133.0002, t: t, acc: 5, spd: 10 }); // OBD鮮度切れ→obd無し
    expect(rGps.reason).not.toBe('obd');
  });

  it('_breakdown に obdM が積算される (監査用)', () => {
    const tk = newTracker();
    let t = T0;
    tk.ingest({ lat: 34, lng: 133, t: t, acc: 5, spd: 10, obd: true });
    t += 1000;
    tk.ingest({ lat: 34, lng: 133.0001, t: t, acc: 5, spd: 10, obd: true });
    expect(tk._breakdown().obdM).toBeGreaterThan(0);
    expect(tk._stats().obdSegs).toBeGreaterThanOrEqual(1);
  });
});

// 配線の静的ガード: map-matcher が speedSrc==='obd' を ingest に渡すこと
describe('OBD メイン 配線(静的)', () => {
  const fs = require('fs');
  const path = require('path');
  it('map-matcher が obd: msg.speedSrc===obd を ingest に渡す', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'map-matcher.js'), 'utf8');
    expect(/obd:\s*msg\.speedSrc\s*===\s*'obd'/.test(src)).toBe(true);
  });
  it('gps.js が speedSrc に obd を立てる', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'gps.js'), 'utf8');
    expect(/_speedFromObd\s*\?\s*'obd'/.test(src)).toBe(true);
  });
});
