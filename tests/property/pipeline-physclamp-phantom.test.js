// ★物差し★ 2026-08-28 … ★①タクシー認定モードの線（過大ゼロ）で 判定しています★
//   ・この見張りが 赤にするのは ★distance_m ≤ 真距離（過大不可）★ を 破った時（この file 自身に そう書いてある）
//   ・★代行は 検定対象外★＝法として「真距離を超えるな」は 課されていません。
//     代行の実上限は ★DM Light／タイヤ真値 ＋0.5〜6%★ という 緩い天井（係数 1.0085 で わざと上乗せ）。
//   ⇒★ここが赤でも「代行で 過大請求している」とは 限りません★。
//     うちは ★内側の約束★として 過大ゼロを 守っています（2026-08-23 の誤読を 二度と させない為 明記）。
// tests/property/pipeline-physclamp-phantom.test.js
// ★実機しまなみ +14,725m/1s 幻デルタ 回帰テスト (2026-06-19)★
//   実OBD走行(しまなみ)で 1秒で distance_m が +14,725m 跳ねた = メーター36.03km vs ダイコメ50.79km(+41%)。
//   真因: GPS飛び(reason=jump)直後に snap が遠road へ飛び、主経路(snap/routing/straightFallback)が
//   spd不明時に「焼き付き弦(prev→遠snapの直線)」を ★無 cap★ で返し distance_m に焼いた。
//   OBD∫v(obdMaxDtS=10s)/coast(coastHoleMaxM=600m)には物理上限があるが本主経路だけ欠落していた。
//   修正: physMaxStepAbsMps(=60m/s・車で不可能)で 1ステップの delta を常時クランプ(過大ゼロ方向)。
'use strict';

const path = require('path');
const PD = require(path.join(__dirname, '..', '..', 'js', 'pipeline-distance.js'));

// snap を必ず失敗させ straightFallback(生弦)に落とす最小 decoder スタブ。
function stubDecoder() {
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

// A → 18.5km 離れた B を 1 秒で(spd不明=-1)。= 実機 GPS飛び後の焼き付き弦の条件。
function runJump(opts) {
  const tk = PD.createDistanceTracker(
    stubDecoder(),
    Object.assign({ smoothedRawMode: false }, opts)
  );
  const t0 = 1000000;
  tk.ingest({ lat: 34.2088, lng: 133.0729, t: t0, acc: 5, spd: 13 }); // 速度確立
  return tk.ingest({ lat: 34.08, lng: 133.2, t: t0 + 1000, acc: 5, spd: -1 }).deltaM; // 18.5km飛び・spd不明
}

describe('pipeline 物理サニティ クランプ (しまなみ +14.7km 幻デルタ根治)', () => {
  it('クランプOFF(従来)は焼き付き弦 ~18.5km を素通しさせる (バグ再現)', () => {
    const d = runJump({ physMaxStepAbsMps: 0 }); // OFF
    expect(d).toBeGreaterThan(5000); // 物理的にあり得ない 1秒で>5km
  });

  it('★クランプON(既定 60m/s)は 1ステップを物理上限へ叩く (≤ 60m+ε)', () => {
    const d = runJump({}); // 既定 physMaxStepAbsMps=60
    expect(d).toBeLessThanOrEqual(61); // 60m/s × 1s = 60m
    expect(d).toBeGreaterThan(0); // 0 化でなく物理上限へ cap (移動ぶんは残す)
  });

  it('既定値が出荷ONであること (physMaxStepAbsMps=60)', () => {
    // computeDistance の DEFAULTS が backstop を既定有効にしている回帰固定。
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', '..', 'js', 'pipeline-distance.js'),
      'utf8'
    );
    expect(src).toMatch(/physMaxStepAbsMps:\s*60/);
  });

  it('正常な低速ステップ(spd既知)はクランプされない (退行なし)', () => {
    // 13m/s で 1 秒 = 13m 進む正常点は cap(=(13+8)*2.5=52.5 or 60)未満で素通り。
    const tk = PD.createDistanceTracker(stubDecoder(), { smoothedRawMode: false });
    const t0 = 1000000;
    tk.ingest({ lat: 34.2088, lng: 133.0729, t: t0, acc: 5, spd: 13 });
    // ~13m 先(0.00012度≒13m)へ 1 秒・spd既知
    const d = tk.ingest({ lat: 34.20892, lng: 133.0729, t: t0 + 1000, acc: 5, spd: 13 }).deltaM;
    expect(d).toBeLessThan(60); // 正常移動はクランプ閾値未満
  });
});
