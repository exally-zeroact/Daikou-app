#!/usr/bin/env node
'use strict';
// ★テストツール見直し(2026-05-31)★: 実機3台の生GPStrace(汚いGPS含む)を ★実エンジン
//   (Worker B + Meter + pipeline-distance)★ に流し、停車中creep・距離内訳・端末差を実測する gate。
//   既存テストは合成/綺麗なfixtureだけで「iPhone13の汚いGPSで creep 553m」を一度も catch できず
//   1013緑でも実機で壊れた。本gateは実traceでその穴を埋める。
//   判定: 各端末で creep(停車spd<0.5中に distance_m が増えた量) ≤ CREEP_MAX。
//   ★着手時(基点343b9b5)は iPhone13 creep≈553m で FAIL する=バグを捕捉できる証明。修正後 PASS。★
//   不可侵: distance_m/calcFare は読むだけ。実コードを byte 等価で評価。
const fs = require('fs'),
  path = require('path');
const { createMapMatcherWorker, loadPrefRoadsData } = require('./replay-mm-worker/worker-sim');
const { loadMeter } = require('./replay-mm-worker/runner');

const CREEP_MAX_M = 5.0; // ★目指す所★（停車中の distance_m 増加上限）

// ★★基準（2026-08-27 実測）★★ 指示役の裁定②
//   この見張りは ★package.json に在るのに どの workflow にも入っていなかった★
//   （最後に触られたのは 2026-06-12 の一括同期。check-hosts と同じ「在るのに0回」）。
//   ★登録した時点の実測が 目指す所(5m)を超えていた★:
//     iPhone13 14.3m ／ iPhoneSE 10.2m ／ Android 12.6m（内訳は3台とも doppler）
//
//   ★soft（無視できる形）にはしません★＝★無視できる赤は 無いのと同じ★（指示役）
//   ⇒ ★今日の数字を基準にして「悪化したら赤／同じか良くなったら緑」★にする。
//     目指す所(5m)まで下げるのは ★別の回（Ｂ doppler の切り分け → Ｃ 上限の決め直し）★。
//
//   ★言葉を混ぜない★: ★代行は検定対象外★＝「認定10mを超えた＝法令違反」ではありません。
//     縛りは ★DM Light／タイヤ真値という緩い天井★（START_HERE.md の先頭）。
// ★★この行の読み方（2026-08-27 実測・Ｂ 切り分け）★★
//   下に出る「[道なり◯/routing◯/直線◯/doppler◯]」は ★距離の内訳ではありません★。
//   実測：この4つの合計は ★全行程の 1.5〜4.5% しか説明していません★
//     iPhone13 232m/9,390m=2.5% ／ iPhoneSE 143m/9,470m=1.5% ／ Android 459m/10,180m=4.5%
//   ＝★「3台とも doppler だから creep は doppler 由来」と読むのは 間違いです★
//     （私が 2026-08-26 に そう読んで 指示役へ渡しました。★この行が 誤読を誘います★）
//
// ★★では creep は どこから来るか（2026-08-27 実測）★★
//   ★42回すべてが「止まってから 1点め」★／★3点め以降は 3台とも 0m★
//     iPhone13 17回 14.30m ／ iPhoneSE 14回 10.18m ／ Android 11回 12.63m
//   ★増えた量 ≒ 直前の速度 × 時間★（合計の比 0.74 / 1.11 / 0.89）
//   ⇒ ★止まってからのドリフトではなく、「まだ動いていた最後の1秒」が
//      速度が0.5m/sを切った点で 計上されている★物です。
//   ⇒ ★止まり続けている間の増えは 0m★（実測）。
//   ⇒ 直すなら ★エンジンではなく この見張りの数え方★（境界の1点を どちら側に数えるか）。
//      ★上限5mの決め直し（Ｃ）と一緒に 指示役が決める★。

const CREEP_BASELINE_M = {
  iPhone13: 14.3,
  iPhoneSE: 10.2,
  Android: 12.6,
};
// 基準からの ★許す揺れ★（実トレースの再生は同じ入力＝同じ答えになるが、丸めの幅を少し持つ）
const CREEP_TOLERANCE_M = 0.5;
const FARE = {
  version: 2,
  base_fare: 1300,
  base_distance_m: 1000,
  add_fare: 100,
  add_distance_m: 420,
  tiers: [],
  surcharges: [],
  minFare: null,
  maxFare: null,
  rounding: 10,
  autoSurcharges: {},
  vehicles: [],
  vehiclesEnabled: false,
  wait: { enabled: false, freeMins: 5, ratePerMin: 100 },
};

function run(label, samples, isIOS) {
  const worker = createMapMatcherWorker({ debug: false });
  let roadsLoaded = false,
    pb = null;
  worker.on((e) => {
    const m = e.data;
    if (!m) return;
    if (m.type === 'roadsLoaded') roadsLoaded = m.ok;
    if (m.type === 'pipelineBreakdown') pb = m;
  });
  const roadsData = loadPrefRoadsData('ehime');
  const Meter = loadMeter({ debug: false });
  Meter.setFareConfig(FARE);
  Meter.reset();
  const handlers = [];
  worker.on((e) => {
    for (const h of handlers) h(e);
  });
  const adapter = {
    addEventListener(t, h) {
      if (t === 'message') handlers.push(h);
    },
    removeEventListener(t, h) {
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    },
    postMessage(msg) {
      worker.sendMessage(msg);
    },
  };
  Meter.setMapMatcher(adapter);
  adapter.postMessage({ type: 'configPlatform', isIOS });
  adapter.postMessage({ type: 'loadRoads', pref: roadsData.prefecture, roadsData });
  if (!roadsLoaded) throw new Error(label + ': loadRoads FAIL');
  if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);
  let creep = 0,
    lastDm = 0,
    maxJump = 0,
    lastKnownSpd = -1; // ★穴入口直前の確かな速度★ (= 走行/停止を分類する真の信号)
  for (const g of samples) {
    Meter.update({
      lat: g.lat,
      lng: g.lng,
      accuracy: g.acc,
      speedKmh: typeof g.spd === 'number' && g.spd >= 0 ? g.spd * 3.6 : null,
      headingDeg: g.hdg,
      altitude: g.alt,
      timestamp: g.t,
      isStationary: false,
    });
    const dm = Meter.getState().distance_m || 0;
    const jump = dm - lastDm;
    if (jump > maxJump) maxJump = jump;
    // ★creep 判定の真値 = 「車が実際に停止しているか」★。
    //   旧実装は当該点 g.spd<0.5 で計上したが、g.spd=-1 (= 速度 ★不明★・ゴミ GPS の sentinel) を
    //   「停止」と誤分類し、正当な ★走行中の穴 fill★ (= 直前 15.8m/s で走行→79s GPS 欠落→復帰) を
    //   全量 creep に算入していた (監査 CRITICAL①)。-1 は「停止」ではなく「速度不明」。
    //   真の停止判定 = ①当該点が 0<=spd<0.5 (実測停止) か、または ②速度不明 (spd<0) かつ
    //   ★穴入口直前の確かな速度 lastKnownSpd も停止 (0<=lastKnownSpd<0.5)★ の時のみ creep 計上。
    //   = engine の parked ゲート (停止由来のみ creep) と同義 → 走行 fill を creep に数えない。
    const curStopped = typeof g.spd === 'number' && g.spd >= 0 && g.spd < 0.5;
    const unknownButEnteredStopped =
      (typeof g.spd !== 'number' || g.spd < 0) && lastKnownSpd >= 0 && lastKnownSpd < 0.5;
    if ((curStopped || unknownButEnteredStopped) && dm - lastDm > 0.01) creep += dm - lastDm;
    if (typeof g.spd === 'number' && g.spd >= 0) lastKnownSpd = g.spd; // 確かな速度のみ更新
    lastDm = dm;
  }
  adapter.postMessage({ type: 'getPipelineBreakdown' });
  const dm = Meter.getState().distance_m || 0;
  const bd = pb && pb.breakdown;
  return { dm, creep, maxJump, bd };
}

function main() {
  const devs = [
    ['iPhone13', true, 'realdevice-iphone13-noisy.json'],
    ['iPhoneSE', true, 'realdevice-iphonese.json'],
    ['Android', false, 'realdevice-android.json'],
  ];
  let anyFail = false;
  for (const [d, ios, fn] of devs) {
    const f = path.join(__dirname, 'fixtures', fn);
    if (!fs.existsSync(f)) {
      console.log(d + ': fixture無し SKIP');
      continue;
    }
    const s = JSON.parse(fs.readFileSync(f, 'utf8'))
      .filter((x) => x && Number.isFinite(x.lat) && Number.isFinite(x.lng))
      .sort((a, b) => (a.t || 0) - (b.t || 0));
    const r = run(d, s, ios);
    // ★悪化していないか★で見る（基準＝2026-08-27 の実測）
    const base = CREEP_BASELINE_M[d];
    const kijun = typeof base === 'number' ? base + CREEP_TOLERANCE_M : CREEP_MAX_M;
    const pass = r.creep <= kijun;
    if (!pass) anyFail = true;
    // ★目指す所(5m)に届いているか★も 毎回 出す（黙って忘れない為）
    const mokuhyou = r.creep <= CREEP_MAX_M;
    console.log(
      '[' +
        d +
        '] creep=' +
        r.creep.toFixed(1) +
        'm (基準 ' +
        (typeof base === 'number' ? base.toFixed(1) : '—') +
        'm ±' +
        CREEP_TOLERANCE_M +
        ') ' +
        (pass ? 'PASS' : '★FAIL(悪化)★') +
        (mokuhyou ? '' : '  ※目指す所 ' + CREEP_MAX_M + 'm には まだ届いていません') +
        '  最大ジャンプ=' +
        r.maxJump.toFixed(0) +
        'm  distance_m=' +
        (r.dm / 1000).toFixed(2) +
        'km' +
        (r.bd
          ? '  [道なり' +
            (r.bd.sameRoadM || 0).toFixed(0) +
            '/routing' +
            (r.bd.routedM || 0).toFixed(0) +
            '/直線' +
            (r.bd.straightFallbackM || 0).toFixed(0) +
            '/doppler' +
            (r.bd.dopplerM || 0).toFixed(0) +
            ']'
          : '')
    );
  }
  console.log(
    '\n=== GATE: ' +
      (anyFail ? 'FAIL' : 'PASS') +
      ' (★2026-08-27 の実測より 悪化していない事★ を全端末で要求) ==='
  );
  if (!anyFail) {
    const nokori = Object.keys(CREEP_BASELINE_M).filter((k) => CREEP_BASELINE_M[k] > CREEP_MAX_M);
    if (nokori.length) {
      console.log(
        '★宿題★ 目指す所 ' +
          CREEP_MAX_M +
          'm に届いていない端末: ' +
          nokori.join(' / ') +
          '（Ｂ doppler の切り分け → Ｃ 上限の決め直し の順・指示役 2026-08-27）'
      );
    }
  }
  process.exit(anyFail ? 1 : 0);
}
if (require.main === module) main();
module.exports = { run, CREEP_MAX_M, CREEP_BASELINE_M, CREEP_TOLERANCE_M };
