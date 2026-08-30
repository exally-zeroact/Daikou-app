'use strict';
// ============================================================
// ★★「見えていなかった間」を 数えている事を 機械で 縛る★★ 2026-08-30
//
//   ★どちらの物差しか★
//     ★これは 距離の採点では ありません★。距離は ★1mmも 変わりません★。
//     タクシー認定モードでも 代行モード（係数1.0085・検定対象外・DM Light基準）でも
//     ★同じ数を 出すだけ★の 記録係です。
//
//   ★なぜ 要るか（2026-08-30・司さんの申告）★
//     従業員「こないだ いつもより 距離も 金額も 少なく出た」＝★300円ほど★。
//     420m刻み×3段 ＝ ★約1,260m★。
//     実測すると、アプリに 点が 1つも 来ない時間が ★60秒★ あると
//     72km/h で ★約1,208m（＝ちょうど300円）★ が 消えます。
//     ところが ★捨てた事を 誰も 数えていませんでした★（stats に 1つも 無かった）
//     ＝★エラーも 出ず 合計だけ 小さくなる★＝うちの決まり
//       「#ERROR より『黙って 合計が 小さくなる』を 先に潰せ」の 現物。
//
//   ★これで 何が 変わるか★
//     門（gate-bg-freeze-nagaana / gate-obd-mienai）は ★試験の中で 落ちたか★しか 見えません。
//     この数は ★実機の 走行で 落ちたか★が 見えます。★直さなくても 分かるように なります★。
//
//   ★距離は 触っていません（実測）★
//     実物の fixture ★68本（fixture×モード）★で 足す前と 後の distance_m を 突き合わせ、
//     ★1本も 変わっていない★事を 確かめてから 入れました。
// ============================================================
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const mod = require(path.join(ROOT, 'js', 'pipeline-distance.js'));
const { createDistanceTracker } = mod;

const stubDec = {
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

const LAT = 34.0;
const SPD = 20.0; // m/s = 72km/h
// ★エンジンと 同じ物差しで 作る★（EARTH_R=6371000 の まん丸の地球）
//   ここを 間違えると 自分の換算ミスを エンジンのせいに します（2026-08-30 に 実際に やった）
const M_PER_DEG_LNG = (Math.PI / 180) * 6371000 * Math.cos((LAT * Math.PI) / 180);
const LNG_PER_M = 1 / M_PER_DEG_LNG;

function hashiru(anaSec) {
  const tk = createDistanceTracker(stubDec, { useSnapCache: false, enableRouting: false });
  const T0 = 1700000000000;
  let susunda = 0;
  for (let s = 0; s <= 1000; s++) {
    if (anaSec > 0 && s > 300 && s < 300 + anaSec) {
      susunda += SPD; // ★車は 走っている（点だけ 来ない）★
      continue;
    }
    tk.ingest({
      lat: LAT,
      lng: 133.0 + LNG_PER_M * susunda,
      t: T0 + s * 1000,
      acc: 5,
      spd: SPD,
      synthetic: false,
      obd: true,
    });
    susunda += SPD;
  }
  tk.flush();
  return { total: tk.totalM(), mienai: tk.mienakattaBun() };
}

describe('★「見えていなかった間」を 数えている★', () => {
  it('★出口が 在る★（外されたら ここが 赤）', () => {
    const tk = createDistanceTracker(stubDec, { useSnapCache: false, enableRouting: false });
    expect(
      typeof tk.mienakattaBun,
      '★mienakattaBun が 無くなっています★\n' +
        '  ＝落ちた事を 外から 見られない状態に 戻っています（黙って 小さくなる）'
    ).toBe('function');
  });

  it('★穴が 無い時は 0★（普段は 何も 出さない）', () => {
    const r = hashiru(0);
    // ★2026-08-31: 内訳も 出すように なりました（nagasugi/hayasugi/sonota/umeta）★
    expect(r.mienai.kaisuu).toBe(0);
    expect(r.mienai.byou).toBe(0);
    expect(r.mienai.meter).toBe(0);
    expect(r.mienai.umeta).toBe(0);
  });

  it('★10秒の 内側（9秒）は 0★（捨てていないので 数えない）', () => {
    const r = hashiru(9);
    expect(r.mienai.kaisuu, '9秒は 捨てていないのに 数えています').toBe(0);
  });

  it('★10秒を 超えたら 数える（秒数と メートルが 合っている）★', () => {
    [11, 30, 60, 120].forEach((a) => {
      const r = hashiru(a);
      expect(r.mienai.kaisuu, a + '秒の穴を 数えていません').toBe(1);
      expect(r.mienai.byou, a + '秒の穴の 秒数が 合っていません').toBeCloseTo(a, 1);
      // ★2026-08-31: #39 で 穴は 埋まるので ★損は 0★。★埋めた分は 別に 出る★
      expect(r.mienai.meter, a + '秒の穴は 埋まるのに 損として 数えています').toBe(0);
      expect(r.mienai.umeta, a + '秒の穴を 埋めていません').toBeGreaterThan(0);
    });
  });

  // ★★2026-08-30: この試験の 意味が 変わりました（直したので）★★
  //   前は「数えた分 ＝ 実際に 足りない分」でした。
  //   ★穴を 位置の 直線で 埋めるように 直した★ので、
  //   ★実際に 足りない分は ほぼ 0 に なりました★（60秒の穴で 1,208.3m → ★8.3m★）。
  //   ⇒ 数えた分（mienakattaBun）は これから ★「何秒 見えていなかったか」の 記録★です。
  //     ★お金の 実害とは 別物★に なりました。★ここを 混ぜないでください★。
  it('★直したので 実際に 足りない分は ほぼ 0★（穴を 直線で 埋めている）', () => {
    const soko = hashiru(0).total;
    [11, 30, 60, 120].forEach((a) => {
      const r = hashiru(a);
      const tarinai = soko - r.total; // 実際に 足りない分
      const hashitta = SPD * a; // その間に 走った距離
      expect(
        tarinai,
        a +
          '秒 見えない間に ' +
          hashitta.toFixed(0) +
          'm 走ったのに ' +
          tarinai.toFixed(1) +
          'm 足りません\n' +
          '  ＝穴を 直線で 埋める直しが 効いていません（前は 丸ごと 落ちていました）'
      ).toBeLessThan(Math.max(20, hashitta * 0.02));
    });
  });

  it('★見えていなかった時間は これからも 記録される★（お金とは 別物）', () => {
    const r = hashiru(60);
    expect(r.mienai.kaisuu).toBe(1);
    expect(r.mienai.byou).toBeCloseTo(60, 1);
    // ★2026-08-31: 埋まる穴なので 損は 0。★時間の 記録は 残る★
    expect(r.mienai.meter, '★埋めた穴を 損として 数えています★').toBe(0);
    expect(r.mienai.umeta, '★埋めた分が 記録されていません★').toBeGreaterThan(1100);
  });

  // ★★2026-08-31: この試験の 意味が 変わりました★★
  //   前は「★60秒 見えないと 約1,200m＝約300円 損する★」でした（#39 の 前）。
  //   ★#39 で 埋めるように なったので、その 60秒は ★もう 損では ありません★★。
  //   ⇒★損に なるのは「捨てた穴」だけ★＝3分 超え／110km/h 超え（＝位置が 飛んだ）。
  it('★捨てた穴（3分 超え）は 損として 出る★（黙って 落とさない）', () => {
    const r = hashiru(181); // 3分＋1秒 ⇒ 埋めない＝捨てる
    expect(r.mienai.kaisuu).toBe(1);
    expect(r.mienai.meter, '★捨てたのに 損として 出ていません★').toBeGreaterThan(0);
    expect(r.mienai.nagasugi, '★内訳（長すぎ）が 出ていません★').toBeGreaterThan(0);
    expect(r.mienai.umeta, '★捨てたのに 埋めた事に なっています★').toBe(0);
  });
});
