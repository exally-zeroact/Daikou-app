#!/usr/bin/env node
'use strict';
// ============================================================
// ★★bg-freeze【長穴】ゲート ＝ ★過少（落ちる側）を 見る 1本目★★ 2026-08-30
//
//   ★★どちらの物差しか★★（2026-08-30・monosashi-mode の決まり）
//     ★この門は タクシー認定モードでも 代行モードでも 同じように 赤です★。
//     理由: 上側（過大）は 物差しで 線が 違います
//       ・★タクシー認定モード★ … 係数1.0・過大ゼロ（distance_m ≤ 真距離）
//       ・★代行モード★ ……… 係数1.0085・★検定対象外★・天井は ★DM Light★基準 +6%
//     ですが ★下側（実際に 走った分が 数えられない）は どちらの物差しでも おかしい★。
//     ＝★この門は 物差しを 選びません★。線も 真距離との %ではなく
//       「穴を 長くしたら 距離も 増える」という ★物差しに 依らない 形★で 引いています。
//
//   ★★この門は「少なすぎたら 赤」です★★
//     ★今 在る門は 全部 上側（過大）です★:
//       cert-gnss-degraded / obd-overcount-zero / obd-certk-overcount-zero /
//       k-neverover / gate-road-distance … ★どれも「多すぎたら 赤」★
//     ★過少を 見ていたのは smoothed-longtunnel-routefill の「回収できたか」だけ★でした。
//     ⇒★次に 読む人へ: この門と 上側の門を 混ぜないでください★
//
//   ★なぜ 作ったか（2026-08-30・司さんからの 実際の報告）★
//     従業員から「こないだ いつもより ★距離も 金額も 少なく出た★」。
//     うちの決まり ★「#ERROR より『黙って 合計が 小さくなる』を 先に潰せ」★ の 現物です。
//
//   ★既にある bg-freeze の門が 見ていなかった理由（fixture 自身が 書いています）★
//     tests/fixtures/bg-freeze-tunnel.json の _meta.note（原文）:
//       「freezeSec(9) は obdMaxDtS(10) 直下に置き
//         ★『dt 上限で 全捨てされる長穴』ではなく★『単フレで 一括計上される中穴』を 狙う」
//     ＝★長穴は 最初から 1本も 試していません★。
//     ★実機の 画面ロックは 分単位★なので、★試していない側が 本番の姿★です。
//
//   ★2026-08-30 実測（20m/s=72km/h・この門の fixture で 測った物）★
//     凍結  9秒 … 出た 184.50m（理想 180m）  … 穴の中身 ★乗る★（既存の門が 赤にしている）
//     凍結 11秒 … 出た ★4.50m★（理想 220m） … ★98.0% 落ちる★
//     凍結 30秒 … 出た ★4.50m★（理想 600m） … ★99.2% 落ちる★
//     凍結 60秒 … 出た ★4.50m★（理想1200m） … ★99.6% 落ちる★
//     凍結300秒 … 出た ★4.50m★（理想6000m） … ★99.9% 落ちる★
//     ★4.50m は「穴の外」の分です★（fixture の note が「1フレの予算 ≈4.5m」と 書いています）
//     ＝★11秒を 超えると 穴の中身が きれいに 0 に なります★
//
//   ★原因（わざと 壊して 確かめた）★
//     js/pipeline-distance.js の ★obdMaxDtS: 10★（10秒を 超える dt は 加算しない）
//     10 → 600 に 広げると 60秒の穴が 4.5m → ★504.5m★ に 戻りました（戻して sha 一致）。
//     ※全部は 戻りません＝★coastHoleMaxM: 600 など 落とす上限が 重なっています★。
//     ＋ js/gps.js 355行 `COAST_DECAY_PER_S = 0.92`（毎秒 減衰）
//        72km/h → 9km/h(COAST_FREEZE_KMH=前進停止) まで ★約25秒★
//        ＝★落ちる道が 二重に 在ります★
//
//   ★★線の引き方（★足される量を 先に 見積もってから 引いた★）★★
//     直した場合に 増える距離（72km/h）:
//       11秒 +215.5m（料金 +0円）／30秒 +595.5m（+100円）／
//       60秒 +1,195.5m（+200円）／300秒 +5,995.5m（★+1,400円★）
//     ⇒★％の線は 引きません★（何%なら良いかは 決められない＝恣意的になる）。
//       代わりに ★誰が見ても おかしい 2つ★だけを 見ます:
//         ①★穴が 長くなったのに 距離が 減る★（9秒 184.5m → 11秒 4.5m）
//         ②★穴の中身が 丸ごと 0m★（11秒以上で 穴の寄与が 0）
//       ＝★この2つは どんな設計でも 正当化できません★
//
//   ★★本番の計算は 1文字も 触っていません★★
//     直し方（10秒を 何秒にする／600m の上限を どうする）は ★客への請求が 増える★話なので
//     ★司さんの決め事★です（指示役 2026-08-30 の裁定）。この門は ★赤で正しい★。
//
//   使い方: node tests/gate-bg-freeze-nagaana.js
//   終了コード: 0=全部OK / 1=1つでも 不成立
// ============================================================
const fs = require('fs');
const path = require('path');

const mod = require(path.join(__dirname, '..', 'js', 'pipeline-distance.js'));
const { createDistanceTracker } = mod;

// ★道路に 頼らないスタブ★（既存の gate-bg-freeze.js と ★同じ物を 借りました★。
//   合成 coast の枝は 道路を 見ないので、これで 純粋に 速度×時間 だけを 観測できます）
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

// ★見る組★（9秒＝またぐ 手前も 必ず 入れる＝両側で 測る）
const HYOU = [
  { sec: 9, kitai: 'noru' }, // 穴の中身が 乗る（既存の門が「ドン」を 赤にしている側）
  { sec: 11, kitai: 'ochiru' },
  { sec: 30, kitai: 'ochiru' },
  { sec: 60, kitai: 'ochiru' },
  { sec: 300, kitai: 'ochiru' },
];

function fixturePath(sec) {
  return sec === 9
    ? path.join(__dirname, 'fixtures', 'bg-freeze-tunnel.json')
    : path.join(__dirname, 'fixtures', 'bg-freeze-nagaana-' + sec + 's.json');
}

function hakaru(sec) {
  const fx = JSON.parse(fs.readFileSync(fixturePath(sec), 'utf8'));
  const meta = fx._meta || {};
  const spd = Number.isFinite(meta.speedMps) ? meta.speedMps : 20;
  const freeze = Number.isFinite(meta.freezeSec) ? meta.freezeSec : sec;
  if (typeof createDistanceTracker !== 'function') {
    throw new Error('★tracker を 作れません（pipeline-distance.js の出口が 変わった）★');
  }
  const tk = createDistanceTracker(stubDec, OPT);
  (fx.samples || []).forEach((s) => {
    tk.ingest({
      lat: s.lat,
      lng: s.lng,
      t: s.t,
      acc: s.acc,
      spd: s.spd,
      synthetic: s.synthetic === true,
      obd: s.obd === true,
    });
  });
  tk.flush();
  return { total: tk.totalM(), risou: spd * freeze, freeze: freeze, spd: spd };
}

const kekka = [];
HYOU.forEach((h) => {
  try {
    const r = hakaru(h.sec);
    // ★穴の外の分（1フレの予算）を 引いて、穴の中身だけを 見る★
    kekka.push(Object.assign({ sec: h.sec, kitai: h.kitai, err: null }, r));
  } catch (e) {
    kekka.push({ sec: h.sec, kitai: h.kitai, err: (e && e.message) || String(e) });
  }
});

console.log('===========================================================');
console.log('★bg-freeze【長穴】ゲート＝★過少（落ちる側）を 見る門★★');
console.log('  ★上側（過大）は 別の門が 見ています。混ぜないでください★');
console.log('===========================================================');

const yometa = kekka.filter((k) => !k.err);
if (yometa.length !== HYOU.length) {
  kekka
    .filter((k) => k.err)
    .forEach((k) => console.error('  ★読めません★ ' + k.sec + '秒: ' + k.err));
  console.error('★' + HYOU.length + '本 見ていません＝数え落とし★');
  process.exit(1);
}

// ★★2026-08-30 の 直し：基準を「自分の結果」から 取らない★★
//   最初は「一番小さい total を 穴の外の分とみなす」形で 書きましたが、
//   ★直した後は 9秒が 一番小さくなり、9秒だけ 中身0＝嘘の赤★になりました。
//   ＝★自分の答えを 自分の物差しに していた★（うちで 何度も 踏んでいる型）。
//   ⇒★引き算を やめ、★穴を 長くした時に 増えるか★だけを 見ます★（基準が 要らない）。
const jun = yometa.slice().sort((a, b) => a.sec - b.sec);
console.log('  凍結    理想距離     出た距離    一つ前からの増え');
jun.forEach((k, i) => {
  k.fue = i === 0 ? null : k.total - jun[i - 1].total;
  console.log(
    '  ' +
      String(k.sec).padStart(4) +
      '秒 ' +
      k.risou.toFixed(1).padStart(9) +
      ' m ' +
      k.total.toFixed(2).padStart(11) +
      ' m ' +
      (k.fue === null ? '        —' : k.fue.toFixed(2).padStart(9) + ' m')
  );
});
console.log('');

const machigai = [];

// ── ① 穴が 長くなったのに 距離が 減らない（単調）──
for (let i = 1; i < jun.length; i++) {
  if (jun[i].total < jun[i - 1].total - 0.01) {
    machigai.push(
      '★穴が 長いのに 距離が 減っています★: ' +
        jun[i - 1].sec +
        '秒 ' +
        jun[i - 1].total.toFixed(2) +
        'm → ' +
        jun[i].sec +
        '秒 ' +
        jun[i].total.toFixed(2) +
        'm\n' +
        '    ＝時間が 長い方が 短く出る。★どんな設計でも 正当化できません★'
    );
  }
}

// ── ② 穴を 長くしたら 距離も 増える（＝穴の中身が 数えられている）──
//   ★引き算の基準を 持たなくても、これで「中身が 丸ごと 0」を 捕まえられます★
//   （中身が 0 なら、穴を どれだけ 伸ばしても total は 動きません）
for (let i = 1; i < jun.length; i++) {
  const nobita = jun[i].sec - jun[i - 1].sec; // 穴が 何秒 伸びたか
  const hazu = nobita * jun[i].spd; // その分 走ったはずの距離
  if (jun[i].fue <= 0.01) {
    machigai.push(
      '★穴を ' +
        jun[i - 1].sec +
        '秒 → ' +
        jun[i].sec +
        '秒 に 伸ばしても 距離が 増えません★' +
        '（' +
        jun[i - 1].total.toFixed(2) +
        'm → ' +
        jun[i].total.toFixed(2) +
        'm）\n' +
        '    その間に ' +
        hazu.toFixed(1) +
        'm 走っています。★1mも 数えられていません（黙って 小さくなる）★'
    );
  }
}

console.log('★見た本数 = ' + yometa.length + ' 本／おかしい所 = ' + machigai.length + ' 件★');
machigai.forEach((m) => console.log('  ' + m));
console.log('');
if (machigai.length === 0) {
  console.log('★GATE PASS★ — 長い画面ロックでも 距離が 落ちていません。');
  process.exit(0);
}
console.log('★GATE FAIL★ — ★これは「赤で正しい」★（2026-08-30 時点）。');
console.log('  直し方は ★客への請求が 増える★話なので ★司さんの決め事★です（指示役 裁定）。');
console.log('  ★線を 緩めて 緑にするのは 不可★＝それをやると 何も見ていない緑になります。');
process.exit(1);
