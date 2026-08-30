'use strict';
// ============================================================
// ★★「見えなかった分」を 二重に 数えない★★ 2026-08-31
//
//   ★どちらの物差しか★
//     ★距離(distance_m)では ありません★。★客に 見せる「損した分」の 数字★を 見ます。
//     ★タクシー認定モードでも 代行モード（係数1.0085・検定対象外・DM Light基準）でも 同じ★
//     ＝この試験は ★物差しを 選びません★（距離に 1mmも 触らないので）。
//     ★距離は 1mmも 触りません★（この試験でも 距離が 変わらない事を 見ます）。
//
//   ★何が 起きていたか★
//     2026-08-30 の #39 で ★穴は 位置の直線で 埋まる★ように なりました。
//     ところが 見えなかった分は ★穴に 入った 瞬間に「速度×秒」で 足していた★ので、
//     ★埋めた穴まで「見えなかった分」に 入っていました＝★二重★★
//     ⇒★客に「◯◯円 損した」と ★実際より 大きい 数字★を 見せます★
//     ⇒★「黙って 小さくなる」の 逆＝★黙って 大きく 見せる★★
//
//   ★直した形（指示役の 条件）★
//     ・★新しく 数え直さない★（2通り 在ると 必ず 食い違う）
//     ・★見えなかった分＝すでに 数えている 3つの 合計★
//         anaTooLongM（3分 超えで 捨てた）
//         anaTooFastM（110km/h 超えで 捨てた＝位置が 飛んだ）
//         anaChordSkippedM（その他で 埋めなかった）
//     ・★埋めた分（anaChordM）は 入れない★
//
//   ★ここで 見る事（境目の 両側）★
//     ①★埋まる穴★では 見えなかった分が ★0★（埋めた分は 別に 出る）
//     ②★捨てる穴（長すぎ）★では 見えなかった分に ★入る★
//     ③★捨てる穴（速すぎ）★でも 入る
//     ④★埋まる穴と 捨てる穴が 両方 在る走行★で、埋めた分が 混ざらない
//     ⑤内訳の 足し算が 合っている
//     ⑥★距離は どの場合も 変わらない★
// ============================================================
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { createDistanceTracker } = require(path.join(ROOT, 'js', 'pipeline-distance.js'));

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
const M_PER_DEG_LNG = (Math.PI / 180) * 6371000 * Math.cos((LAT * Math.PI) / 180);
const LNG_PER_M = 1 / M_PER_DEG_LNG;
const T0 = 1700000000000;

// ★穴を 1つ 作る走行★（anaSec 秒 空けて susundaM 進む）
function hashiru(ana) {
  const tk = createDistanceTracker(stubDec, { useSnapCache: false, enableRouting: false });
  let t = T0;
  let m = 0;
  const oku = (dt, susumu, spd) => {
    t += dt * 1000;
    m += susumu;
    tk.ingest({
      lat: LAT,
      lng: 133.0 + LNG_PER_M * m,
      t: t,
      acc: 5,
      spd: spd === undefined ? 20 : spd,
      synthetic: false,
      obd: true,
    });
  };
  oku(0, 0);
  oku(1, 20);
  for (const a of ana) oku(a.sec, a.m);
  oku(1, 20);
  tk.flush();
  return { tk: tk, mienai: tk.mienakattaBun(), kyori: tk.totalM() };
}

describe('★「見えなかった分」を 二重に 数えない★', () => {
  it('★★① 埋まる穴では 見えなかった分は 0（埋めた分は 別に 出る）★★', () => {
    // 2分・80km/h ぶん ＝ 3分より 短く 110km/h より 遅い ⇒ ★埋まる★
    const r = hashiru([{ sec: 126, m: 2826 }]);
    expect(r.mienai.meter, '★埋めた穴を 見えなかった分に 数えています（二重）★').toBe(0);
    expect(r.mienai.umeta, '★埋めた分が 出ていません★').toBeGreaterThan(2700);
    expect(r.mienai.kaisuu, '★穴が 空いた事は 数えるべきです★').toBe(1);
    expect(r.mienai.byou, '★穴の 秒数は 数えるべきです★').toBeCloseTo(126, 0);
  });

  it('★② 長すぎて 捨てた穴は 見えなかった分に 入る★', () => {
    const r = hashiru([{ sec: 181, m: 2000 }]); // 3分＋1秒 ⇒ 捨てる
    expect(r.mienai.meter, '★捨てたのに 数えていません★').toBeGreaterThan(1900);
    expect(r.mienai.nagasugi, '★内訳（長すぎ）が 出ていません★').toBeGreaterThan(1900);
    expect(r.mienai.umeta, '★捨てたのに 埋めた事に なっています★').toBe(0);
  });

  it('★③ 速すぎて 捨てた穴も 見えなかった分に 入る★', () => {
    const r = hashiru([{ sec: 60, m: 1900 }]); // 114km/h ⇒ 捨てる
    expect(r.mienai.meter, '★捨てたのに 数えていません★').toBeGreaterThan(1800);
    expect(r.mienai.hayasugi, '★内訳（速すぎ）が 出ていません★').toBeGreaterThan(1800);
    expect(r.mienai.umeta).toBe(0);
  });

  it('★★④ 埋まる穴と 捨てる穴が 両方 在る時に 混ざらない★★', () => {
    const r = hashiru([
      { sec: 126, m: 2826 }, // 埋まる
      { sec: 181, m: 2000 }, // 捨てる（長すぎ）
    ]);
    expect(r.mienai.meter, '★埋めた分が 混ざっています★').toBeGreaterThan(1900);
    expect(r.mienai.meter, '★埋めた分まで 数えています（二重）★').toBeLessThan(2100);
    expect(r.mienai.umeta, '★埋めた分が 出ていません★').toBeGreaterThan(2700);
    expect(r.mienai.kaisuu, '★穴の 回数が 合いません★').toBe(2);
  });

  it('★⑤ 内訳の 足し算が 合っている★', () => {
    const r = hashiru([
      { sec: 181, m: 2000 }, // 長すぎ
      { sec: 60, m: 1900 }, // 速すぎ
    ]);
    const wa = r.mienai.nagasugi + r.mienai.hayasugi + r.mienai.sonota;
    expect(Math.abs(wa - r.mienai.meter), '★合計と 内訳が 合いません★').toBeLessThan(0.05);
  });

  it('★★⑥ どの場合も 距離は 変わらない（お金に 触っていない）★★', () => {
    // ★埋まる穴★は 距離に 入る（#39）。★捨てる穴★は 入らない。
    const umaru = hashiru([{ sec: 126, m: 2826 }]);
    const suteru = hashiru([{ sec: 181, m: 2000 }]);
    // 埋まる方は 弦のぶん 増える／捨てる方は 増えない ＝★#39 の 決めたとおり★
    expect(umaru.kyori, '★埋めた穴が 距離に 入っていません★').toBeGreaterThan(2700);
    expect(suteru.kyori, '★捨てた穴が 距離に 入っています（過大）★').toBeLessThan(100);
  });

  // ★★2026-08-31 直し（わざと壊して 分かった）★★
  //   前は 字を 読むだけ（dtSkippedM = が 在るか）で 見ていました。
  //   ⇒★わざと 速度×秒の 行を 戻しても ★緑のまま★でした★
  //     （見えなかった分の 出し口は anaChordSkippedM を 使うので、
  //       ★2つ目の 数え方が 裏で 動いていても 出口の 数字は 変わらない★）
  //   ⇒★字では なく ★動かして★ 見ます★:
  //     ★埋まる穴だけの 走行で、どの 数字にも 速度×秒の 値が 出ていない事★
  it('★★⑦ 速度×秒の 2つ目の 数え方が 戻ってきていない（動かして 見る）★★', () => {
    // 126秒・2,826m の 穴 ＝ ★埋まる★。速度20m/s で 数えると 2,520m が どこかに 出る。
    const r = hashiru([{ sec: 126, m: 2826 }]);
    const nakami = JSON.stringify(r.mienai);
    expect(r.mienai.meter, '★埋めた穴を 見えなかった分に 数えています★').toBe(0);
    // ★どの値にも 「速度×秒」の 2,520 前後が 出ていない事★
    Object.keys(r.mienai).forEach((k) => {
      if (k === 'umeta' || k === 'byou' || k === 'kaisuu') return;
      expect(
        r.mienai[k],
        '★' + k + ' に 速度×秒の 数え方が 出ています（2通り＝必ず 食い違う）★ ' + nakami
      ).toBe(0);
    });
    // ★字でも 見る（戻し防止・二重の 保険）★
    const fs = require('fs');
    const src = fs
      .readFileSync(path.join(ROOT, 'js', 'pipeline-distance.js'), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(/dtSkippedM\s*=/.test(src), '★速度×秒の 数え方が コードに 戻っています★').toBe(false);
  });
});
