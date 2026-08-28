// ★物差し★ 2026-08-28 … ★①タクシー認定モードの線（過大ゼロ）で 判定しています★
//   ・この見張りが 赤にするのは ★distance_m ≤ 真距離（過大不可）★ を 破った時（この file 自身に そう書いてある）
//   ・★代行は 検定対象外★＝法として「真距離を超えるな」は 課されていません。
//     代行の実上限は ★DM Light／タイヤ真値 ＋0.5〜6%★ という 緩い天井（係数 1.0085 で わざと上乗せ）。
//   ⇒★ここが赤でも「代行で 過大請求している」とは 限りません★。
//     うちは ★内側の約束★として 過大ゼロを 守っています（2026-08-23 の誤読を 二度と させない為 明記）。
// tests/property/obd-bypass-drain-flicker.test.js
// ★実機しまなみ+14,725m / trip2+2,320m 幻デルタ 回帰テスト (2026-06-19・本丸=OBDバイパス非ドレイン根治)★
//   真因(対立監査確定): createDistanceTracker.ingest の OBDバイパス(sample.obd===true)が smoothBuf を
//   ★ドレインしない非対称★(隣の synthetic 枝はドレインする)。dop→obd→dop の速度源遷移時、dop区間で
//   バッファに残った生点が、OBD点でprevが前進した後に ★負dt★ で「prev→遠buffered点」の巨大弦に
//   焼かれ distance_m に乗る。修正=OBDバイパスにも synthetic と同型の smoothBuf 完全ドレインを追加+
//   stepDistanceクランプを負dt(≤0)でも0化(二重保険)。
'use strict';

const path = require('path');
const PD = require(path.join(__dirname, '..', '..', 'js', 'pipeline-distance.js'));

// snap を必ず失敗させ straightFallback(生弦)に落とす最小 decoder スタブ。
function stub() {
  return new Proxy(
    { precision: 1e5 },
    {
      get(t, k) {
        if (k in t) return t[k];
        return function () {
          return null;
        };
      },
    }
  );
}

// dop移動 → obd → dop の速度源フリッカー。phantom(過大)が出るか否か。
function flickerTotal(opts) {
  const tk = PD.createDistanceTracker(stub(), Object.assign({ smoothedRawMode: true }, opts));
  const t0 = 1000000;
  const lat = 34.0647;
  const lng = 133.0024;
  const step = 0.00011; // ≈12m/点
  let i = 0;
  let r = null;
  for (let k = 0; k < 6; k++, i++)
    r = tk.ingest({
      lat: lat - i * step,
      lng,
      t: t0 + i * 1000,
      acc: 5,
      spd: 13,
      obd: false,
      spdsrc: 'dop',
    });
  for (let k = 0; k < 2; k++, i++)
    r = tk.ingest({
      lat: lat - i * step,
      lng,
      t: t0 + i * 1000,
      acc: 5,
      spd: 13,
      obd: true,
      spdsrc: 'obd',
    });
  for (let k = 0; k < 4; k++, i++)
    r = tk.ingest({
      lat: lat - i * step,
      lng,
      t: t0 + i * 1000,
      acc: 5,
      spd: 13,
      obd: false,
      spdsrc: 'dop',
    });
  if (typeof tk.flush === 'function') tk.flush();
  return tk.totalM ? tk.totalM() : r.totalM;
}

describe('OBDバイパス smoothBuf ドレイン (しまなみ/trip2 幻デルタ根治)', () => {
  const REAL_M = 11 * 0.00011 * 111000; // 12点移動の実距離 ≈ 134m

  it('★dop→obd→dop フリッカーで phantom 過大が出ない (≤ 実距離+5%)', () => {
    const total = flickerTotal({});
    // 修正前は ~157m(実134mに+23m phantom)。修正後は ~118m(過小側=過大ゼロ)。
    expect(total).toBeLessThanOrEqual(REAL_M * 1.05);
    expect(total).toBeGreaterThan(0);
  });

  it('all-OBD 全行程は不変(byte不変・smoothBuf空でドレイン不発)', () => {
    const tk = PD.createDistanceTracker(stub(), { smoothedRawMode: true });
    const t0 = 1000000;
    let r = null;
    for (let i = 0; i < 8; i++)
      r = tk.ingest({
        lat: 34.0647 - i * 0.00011,
        lng: 133.0024,
        t: t0 + i * 1000,
        acc: 5,
        spd: 13,
        obd: true,
        spdsrc: 'obd',
      });
    const total = tk.totalM ? tk.totalM() : r.totalM;
    expect(total).toBeGreaterThan(REAL_M * 0.5); // OBD∫v で前進(13m/s×7s≈91m)
    expect(total).toBeLessThanOrEqual(REAL_M * 1.05); // 過大なし
  });

  it('★負dtステップは distance 化されない(クランプ二重保険)', () => {
    // 既定 physMaxStepAbsMps=60 が出荷ONであることを固定。
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', '..', 'js', 'pipeline-distance.js'),
      'utf8'
    );
    expect(src).toMatch(/physMaxStepAbsMps:\s*60/);
    // クランプが負dt(_dt<=0)を 0化する分岐を持つこと(回帰固定)。
    expect(src).toMatch(/_dt <= 0/);
  });
});
