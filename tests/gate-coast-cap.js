#!/usr/bin/env node
'use strict';
// ============================================================
// ★★合成点の cap ゲート ＝ ★取りこぼし と 二重計上を 同時に 見る★★ 2026-08-30
//
//   ★どちらの物差しか★
//     ★上と下を 両方 見ます★（他の門は だいたい 片側だけです）
//       下（過少）… 走ったのに 数えられていない
//       上（過大）… 走っていないのに 数えている
//     どちらも ★タクシー認定モードでも 代行モード（係数1.0085・検定対象外・DM Light基準）でも
//     おかしい★ので、この門は ★物差しを 選びません★。線は 真距離との%ではなく
//     ★「合計が 実際に 走った距離を 超えない／大きく 下回らない」★という 形で 引いています。
//
//   ★なぜ 作ったか（2026-08-30・指示役の指摘）★
//     私は「捨てた分を 位置の 弦で 拾う」直し方を 出しました。
//     指示役から ★私が 見落としていた 危険★を 指摘されました:
//       ・合成点が ★10秒以下の 間隔★で 来ると、cap(coastHoleMaxSec=25秒)まで
//         ★速度×時間で 500m が すでに 乗ります★
//       ・そこで 私の案どおり ★prev を 前進させない★と、
//         復帰後の 弦は ★穴の 入口から★ 測られる＝800m
//       ・★500m ＋ 800m ＝ 1,300m ＝ 実際に 走った 800m を 超える＝過大★
//     ⇒★直す前に この形の 門を 作れ★（指示役 2026-08-30）＝これです。
//
//   ★2026-08-30 実測（直す前）★ 20m/s=72km/h・合成点が 10秒ごとに 来る
//     凍結  40秒 … 実際に 走った 800m に対して ★504.5m★（★−295.5m 取りこぼし★）
//     凍結  60秒 … 1,200m に対して ★504.5m★
//     凍結 100秒 … 2,000m に対して ★504.5m★
//     ＝★500m ＝ coastHoleMaxSec 25秒 × 20m/s★（数字が 自分で 説明を 持っています）
//
//   ★この門が 見る 2つ★
//     ①★合計が 実際に 走った距離を 超えない★（＝二重計上を 止める・過大ゼロ）
//     ②★合計が 実際に 走った距離を 大きく 下回らない★（＝取りこぼしを 止める）
//     ★①は 直す前も 今も 守られています★（504.5 ≤ 800）。★②が 今 破れています★。
//     ⇒★直した後も ①が 守られている事★を、この門が 見張ります。
//
//   ★本番の計算は 1文字も 触っていません★（この門を 入れた時点では）
//   使い方: node tests/gate-coast-cap.js
//   終了コード: 0=全部OK / 1=1つでも 不成立
// ============================================================
const path = require('path');

const mod = require(path.join(__dirname, '..', 'js', 'pipeline-distance.js'));
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
const M_PER_DEG_LNG = (Math.PI / 180) * 6371000 * Math.cos((LAT * Math.PI) / 180);
const LNG_PER_M = 1 / M_PER_DEG_LNG;
const T0 = 1700000000000;

// stepS 秒ごとに 合成点が 来る／凍結 ana 秒 ×（1つ以上）／位置は 据え置き
//   → 復帰の 本物 GPS で 位置が 進む
// ★anaList に 2つ以上 入れると「穴が 2回 在る走行」に なります★（指示役の条件2）
//   ＝1つ目の穴で 加算した分が 2つ目の穴に ★持ち越されないか★ を 見る為。
//     持ち越すと 2つ目で 引きすぎて ★今度は 減ります★。
function hashiru(stepS, anaList) {
  const tk = createDistanceTracker(stubDec, { useSnapCache: false, enableRouting: false });
  let x = 0;
  let t = 0;
  const susumu = () => {
    tk.ingest({
      lat: LAT,
      lng: 133.0 + LNG_PER_M * x,
      t: T0 + t * 1000,
      acc: 5,
      spd: SPD,
      synthetic: false,
      obd: false,
    });
    x += SPD;
    t += 1;
  };
  susumu();
  susumu();
  const mae = tk.totalM();
  let susunda = 0;
  anaList.forEach((anaS) => {
    // 凍結中: 合成点が stepS 秒ごとに 来る（位置は 据え置き）
    for (let k = stepS; k <= anaS; k += stepS) {
      tk.ingest({
        lat: LAT,
        lng: 133.0 + LNG_PER_M * x, // ★位置は 据え置き（画面が 消えている間は 位置が 来ない）★
        t: T0 + (t + k) * 1000,
        acc: 30,
        spd: SPD,
        synthetic: true,
        obd: false,
      });
    }
    x += SPD * anaS; // 凍結中に 本当に 走った距離
    susunda += SPD * anaS;
    t += anaS;
    // 復帰（本物のGPS点・位置は 進んでいる）
    tk.ingest({
      lat: LAT,
      lng: 133.0 + LNG_PER_M * x,
      t: T0 + t * 1000 + 150,
      acc: 5,
      spd: SPD,
      synthetic: false,
      obd: false,
    });
    t += 1;
    // 穴と 穴の 間は 普通に 走る（10秒）
    for (let i = 0; i < 10; i++) {
      susumu();
      susunda += 0; // susumu() の分は mae 側の 連続走行と 同じ扱い
    }
  });
  tk.flush();
  // ★本当に 走った距離★ = 最初の2点ぶん(mae) + 穴の中 + 穴と穴の間
  const aida = SPD * 10 * anaList.length; // 穴のあとに 10秒ずつ 普通に 走った分
  return { mae: mae, total: tk.totalM(), honto: mae + susunda + aida, susunda: susunda };
}

// ★またぐ 両側を 見る★（cap 25秒の 手前・ちょうど・向こう側）
const HYOU = [
  { step: 10, ana: [20] }, // cap の 手前（25秒 未満）
  { step: 10, ana: [40] }, // ★cap に 当たる（指示役の指摘の形）★
  { step: 10, ana: [60] },
  { step: 5, ana: [40] }, // 合成点が 細かく 来る形
  { step: 5, ana: [100] },
  { step: 10, ana: [40, 40] }, // ★穴が 2つ（持ち越しを 見る・指示役の条件2）★
];

console.log('===========================================================');
console.log('★合成点の cap ゲート＝★取りこぼし と 二重計上を 同時に 見る★★');
console.log('  ★上（走っていないのに 数える）と 下（走ったのに 数えない）の 両方★');
console.log('===========================================================');
console.log('  合成点  凍結    本当に走った    出た距離      差');

const machigai = [];
HYOU.forEach((h) => {
  const r = hashiru(h.step, h.ana);
  const anaMoji = h.ana.join('+');
  const sa = r.total - r.honto;
  console.log(
    '  ' +
      String(h.step).padStart(4) +
      '秒 ' +
      anaMoji.padStart(7) +
      '秒 ' +
      r.honto.toFixed(1).padStart(12) +
      ' m ' +
      r.total.toFixed(1).padStart(12) +
      ' m ' +
      (sa >= 0 ? '+' : '') +
      sa.toFixed(1).padStart(9) +
      ' m'
  );
  // ①★実際に 走った距離を 超えない★（過大ゼロ・二重計上を 止める）
  //   1m の余裕は 丸めの分（弦の計算・浮動小数）
  if (sa > 1.0) {
    machigai.push(
      '★合成点 ' +
        h.step +
        '秒ごと・凍結 ' +
        anaMoji +
        '秒: 実際に 走った ' +
        r.honto.toFixed(1) +
        'm より ' +
        sa.toFixed(1) +
        'm 多く 出ています★\n' +
        '    ＝走っていないのに 数えている（★二重計上の 疑い★）。★過大は 一番 いけません★'
    );
  }
  // ②★大きく 下回らない★（取りこぼしを 止める）
  //   ★なぜ 9割か（2026-08-30・指示役の条件3）★
  //     直した後の 見込みは ★理想ぴったり（100%）★です。9割は ★緩い★線ですが、
  //     端の 4.5m（1フレの予算）や 丸めが 乗るので 余裕を 取っています。
  //     ★締めるのは 安全・緩めるのは 禁止★。門2の 実測が 100%近くなら そこで 締めます。
  if (r.total < r.honto * 0.9) {
    machigai.push(
      '★合成点 ' +
        h.step +
        '秒ごと・凍結 ' +
        anaMoji +
        '秒: 実際に 走った ' +
        r.honto.toFixed(1) +
        'm のうち ' +
        r.total.toFixed(1) +
        'm しか 出ていません★（9割 未満）\n' +
        '    ＝走った分が 数えられていない（黙って 小さくなる）'
    );
  }
});

console.log('');
console.log('★見た本数 = ' + HYOU.length + ' 本／おかしい所 = ' + machigai.length + ' 件★');
machigai.forEach((m) => console.log('  ' + m));
console.log('');
if (machigai.length === 0) {
  console.log('★GATE PASS★ — 取りこぼしも 二重計上も ありません。');
  process.exit(0);
}
console.log('★GATE FAIL★ — ★2026-08-30 時点では「下（取りこぼし）だけ 赤」が 正しい★。');
console.log('  ★上（過大）が 赤に なったら、それは 直しが 行き過ぎています★。');
process.exit(1);
