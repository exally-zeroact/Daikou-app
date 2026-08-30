#!/usr/bin/env node
'use strict';
// ============================================================
// ★★OBD「見えていない間」ゲート ＝ ★過少（落ちる側）を 見る 2本目★★ 2026-08-30
//
//   ★どちらの物差しか★
//     ★この門は タクシー認定モードでも 代行モードでも 同じように 赤です★。
//     上側（過大）は 物差しで 線が 違います
//       ・★タクシー認定モード★ … 係数1.0・過大ゼロ（distance_m ≤ 真距離）
//       ・★代行モード★ ……… 係数1.0085・★検定対象外★・天井は ★DM Light★基準 +6%
//     ★下側（走ったのに 数えられない）は どちらの物差しでも おかしい★ので、
//     この門は ★物差しを 選びません★。線も 真距離との%ではなく
//     ★「OBD を 繋いだ方が 短く出るのは おかしい」★という 形で 引いています。
//
//   ★1本目（gate-bg-freeze-nagaana.js）との 違い★ ★混ぜないでください★
//     1本目 … ★位置が 進まない★形（画面ロック中の 合成フレーム）
//     この門 … ★点が 1つも 来ない★形（アプリに 何も 届かない・車は 走っている）
//     ＝実機では ★別の起き方★です（他アプリへ切替・着信・電池節約・権限）。
//
//   ★なぜ 作ったか（2026-08-30・司さんの申告「300円ほど 少なく出た」）★
//     ★300円 ＝ 420m刻み × 3段 ＝ 約1,260m★
//     20km・72km/h・OBD接続で 測った実測:
//       点が 来ない 11秒 → ★221.5m 消える★／20秒 → 402.8m／30秒 → 604.2m
//       ★60秒 → 1,208.3m★  ← ★これが ちょうど 300円★
//     ＝★1回 約1分 アプリに 点が 来なければ 説明が つきます★
//
//   ★★一番 重い事：OBD を 繋いだ方が 弱い★★（実測）
//     同じ 60秒の穴で
//       ★OBD 有り … 1,208m 消える★
//       ★OBD 無し …    17m しか 消えない★
//     理由（js/pipeline-distance.js 2075行あたり）:
//       OBD が 繋がっていると ★OBD の枝が 先に 効く★（spd×dt・位置を 見ない）。
//       dt > obdMaxDtS(10秒) なら ★0m★。
//       ★GPS の「切れる前と 後を 結んだ 直線」に 行き着く前に 終わります★。
//       OBD が 無い時は その直線が 効くので ほとんど 消えません。
//     ⇒★より 正確な機械を 繋いだ方が 距離が 短く出る＝どんな設計でも 正当化できません★
//     ⇒★この門は そこだけを 見ます（％の線を 引きません）★
//
//   ★落とした事を 誰も 数えていません★（2026-08-30 実測）
//     stats に obdSkipped の類は ★0件★。★エラーも 出ません★＝黙って 小さくなります。
//
//   ★本番の計算は 1文字も 触っていません★
//     直し方（10秒を 何秒にする／OBD が 落ちた時に GPS の直線へ 逃がす）は
//     ★客への 請求が 増える★話なので ★司さんの決め事★です。この門は ★赤で正しい★。
//
//   使い方: node tests/gate-obd-mienai.js
//   終了コード: 0=全部OK / 1=1つでも 不成立
// ============================================================
const path = require('path');

const mod = require(path.join(__dirname, '..', 'js', 'pipeline-distance.js'));
const { createDistanceTracker } = mod;

// ★道路に 頼らないスタブ★（gate-bg-freeze.js から 借りた物と 同じ）
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
const OPT = { useSnapCache: false, enableRouting: false };

const SPD = 20.0; // m/s = 72km/h
const TOTAL_SEC = 1000; // 20km ぶん（東予までの 実際の走行と 同じ桁）
// ★1m ぶんの経度★: エンジンは EARTH_R=6371000 の haversine で 測るので、
//   ★エンジンと 同じ物差しで 作ります★（ここを 間違えると 自分の換算ミスを
//   エンジンのせいに します。2026-08-30 に 私が 実際に やりました）
const LAT = 34.0;
const EARTH_R = 6371000; // ★エンジン(js/pipeline-distance.js 45行)と 同じ値★
// 緯度34度で 経度1度 = (π/180)×R×cos(34°) = 92,184.8 m（★まん丸の地球★）
const M_PER_DEG_LNG = (Math.PI / 180) * EARTH_R * Math.cos((LAT * Math.PI) / 180);
const LNG_PER_M = 1 / M_PER_DEG_LNG;

function hashiru(anaSec, obdAri) {
  const tk = createDistanceTracker(stubDec, OPT);
  const T0 = 1700000000000;
  const anaAt = 300;
  let susunda = 0;
  for (let s = 0; s <= TOTAL_SEC; s++) {
    const ana = anaSec > 0 && s > anaAt && s < anaAt + anaSec;
    if (ana) {
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
      obd: obdAri === true,
    });
    susunda += SPD;
  }
  tk.flush();
  return tk.totalM();
}

const ANA = [0, 5, 9, 11, 20, 30, 60, 120];
const kekka = ANA.map((a) => ({
  ana: a,
  obdAri: hashiru(a, true),
  obdNashi: hashiru(a, false),
}));

console.log('===========================================================');
console.log('★OBD「見えていない間」ゲート＝★過少（落ちる側）を 見る 2本目★★');
console.log('  ★1本目（長穴）は「位置が 進まない」形／この門は「点が 1つも 来ない」形★');
console.log('===========================================================');

const soko = kekka[0]; // 穴なし
console.log('  点が来ない   OBD有りの距離   OBD無しの距離   OBD有りで 消えた分');
kekka.forEach((k) => {
  k.kieta = soko.obdAri - k.obdAri;
  console.log(
    '  ' +
      String(k.ana).padStart(6) +
      '秒 ' +
      k.obdAri.toFixed(1).padStart(14) +
      ' m ' +
      k.obdNashi.toFixed(1).padStart(14) +
      ' m ' +
      k.kieta.toFixed(1).padStart(16) +
      ' m'
  );
});
console.log('');

const machigai = [];

// ── ① OBD を 繋いだ方が 短く出るのは おかしい ──
//   ★％の線を 引きません★。より 正確な機械を 足して 距離が 減る事自体が おかしい。
kekka.forEach((k) => {
  if (k.ana === 0) return;
  if (k.obdAri < k.obdNashi - 1.0) {
    machigai.push(
      '★' +
        k.ana +
        '秒 点が来なかった時、OBD を 繋いだ方が 短く出ています★\n' +
        '    OBD有り ' +
        k.obdAri.toFixed(1) +
        'm ／ OBD無し ' +
        k.obdNashi.toFixed(1) +
        'm ＝ ★' +
        (k.obdNashi - k.obdAri).toFixed(1) +
        'm 少ない★\n' +
        '    ＝より 正確な機械を 繋いだ方が 距離が 減る。★どんな設計でも 正当化できません★'
    );
  }
});

// ── ② 点が 来なかった間に 走った分が 丸ごと 消えていないか ──
//   （①が 直っても ここが 残る事が 在るので 別に 数えます）
kekka.forEach((k) => {
  if (k.ana === 0) return;
  const hashitta = k.ana * SPD; // その間に 実際に 走った距離
  if (k.kieta >= hashitta * 0.9) {
    machigai.push(
      '★' +
        k.ana +
        '秒 点が来なかった間に 走った ' +
        hashitta.toFixed(0) +
        'm のうち ★' +
        k.kieta.toFixed(1) +
        'm が 消えています★（9割以上）\n' +
        '    ＝その間 走った分が ほとんど 数えられていません（黙って 小さくなる）'
    );
  }
});

console.log('★見た本数 = ' + kekka.length + ' 本／おかしい所 = ' + machigai.length + ' 件★');
machigai.forEach((m) => console.log('  ' + m));
console.log('');
if (machigai.length === 0) {
  console.log('★GATE PASS★ — 点が 来ない間の 距離が 落ちていません。');
  process.exit(0);
}
console.log('★GATE FAIL★ — ★これは「赤で正しい」★（2026-08-30 時点）。');
console.log('  直し方は ★客への請求が 増える★話なので ★司さんの決め事★です。');
console.log('  ★線を 緩めて 緑にするのは 不可★＝それをやると 何も見ていない緑になります。');
process.exit(1);
