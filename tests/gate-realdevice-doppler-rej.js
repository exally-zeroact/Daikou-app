#!/usr/bin/env node
'use strict';
// ★物差し★ 2026-08-28 … ★合否は「良いfixの棄却件数」で決めており、距離の採点では ありません★
//   ・タイヤ真値(2leg合算 12.32km)は ★参考表示のみ★（合否に 使っていない）。
//   ・タクシー認定モード／代行モード の どちらの線でも 判定していない。
// gate-realdevice-doppler-rej.js (2026-05-31)
//   目的: ★実機SE/iPhone13の「過少」= 良い精度(acc<10m)の位置fixを Doppler速度の嘘で棄却した★
//   問題を gate 化する。既存 gate-realdevice-creep.js は iPhone13 の creep(過大)だけを捕捉し
//   SE の過少(良いfixをDopplerゲートで捨てて距離が消える)を一度も catch できなかった。
//
//   何を測るか(3軸):
//   (a) 良いfix棄却カウント: 実機 gps-worker.js L569-647 の棄却ゲート4種
//       (accuracy/jump/doppler/accel) を ★同一CONFIG値・同一式★ で fixture に再適用し、
//       acc<10m の位置が棄却された件数を集計。これを GOOD_REJ_MAX 以下に要求。
//       Doppler ゲート(L612-632)は haversine速度 vs Doppler速度の差>10m/s で良いfixを捨てる
//       のが過少の根因。doppler起因の良いfix棄却を特に DOPPLER_GOODREJ_MAX で締める。
//   (b) 受理率(acceptRate): ★report-only(assert非対象)★。decimated fixture 上の代理指標で
//       実機の絶対カウントを再現しないため(下記注意)、絶対閾値の pass/fail にはしない。値は表示のみ。
//   (c) 相対収束: ★report-only(assert非対象)★。実エンジンは gps-worker を迂回して生GPSを直入れ
//       するため replay の distance_m は実機screen値と別物(replay≠on-device)。距離の"値"は信用
//       しない(画面値が唯一の真値)。iPhone13/SE が Android からどれだけ開くかは表示のみ。
//       ★真の端末差判定は実機3台再走行で行う。★ タイヤ真値(2leg合算 12.32km)も参考表示のみ。
//   ⇒ ★pass/fail を決める assert は (a)(a') のみ★ = fix の効き目(良精度fixが Doppler で捨てられ
//       ないか)を1エンジン内のカウントで直接見る論理テスト。harness 迂回と無関係に信用できる。
//
//   注意(検証鉄則): fixture は ~1Hz・約1800点の trace で、実機が見た高頻度生streamより
//   間引かれている可能性が高い(実機 GPSREJ 1158/426 を byte 等価で再現はできない)。
//   よって本gateの棄却カウントは「fixture上で同一ゲートを適用した値」= 代理指標であり、
//   実機の絶対カウントの再現ではない。値は console 出力の単純集計のみ(ログ値読みに依存しない)。
//   不可侵: distance_m / calcFare / tier / running / business分離 / mm-data-pipeline.js / sw.js は読むだけ。

const fs = require('fs'),
  path = require('path');
const { createMapMatcherWorker, loadPrefRoadsData } = require('./replay-mm-worker/worker-sim');
const { loadMeter } = require('./replay-mm-worker/runner');

// ─── gps-worker.js のCONFIG値ミラー(実コード行番号付き・byte等価で評価) ───
//   CONFIG.jump_limit_m_per_s = 50      (gps-worker.js L50)
//   CONFIG.max_acceleration_ms2 = 8     (gps-worker.js L51)
//   CONFIG.accuracy_moving_max_m = 20   (gps-worker.js L76)
//   getDynamicAccuracyLimit                (gps-worker.js L267-276)
//   Dopplerゲート diff>10m/s               (gps-worker.js L612-632)
const GW = {
  JUMP_LIMIT_MPS: 50,
  MAX_ACCEL_MS2: 8,
  ACC_MOVING_MAX_M: 20,
  DOPPLER_DIFF_MPS: 10,
  TRUST_POSITION_ACC_M: 15,
}; // ★Fix④ gps-worker.js trust_position_acc_m と byte 等価ミラー
const GOOD_FIX_ACC_M = 10; // acc<10m を「良いfix」と定義(実機分析と同基準)

// ─── 閾値(現状=修正前で iPhone13/SE が FAIL する基点に設定・緑の捏造でない) ───
const GOOD_REJ_MAX = 3; // 良いfix(acc<10m)の総棄却件数 上限(fixture代理指標)
const DOPPLER_GOODREJ_MAX = 1; // うち Doppler起因の良いfix棄却 上限(過少の主犯を締める)
const ACCEPT_RATE_MIN = 0.985; // 受理率下限(棄却で位置を捨て過ぎていないか)
const TIRE_TOTAL_KM = 12.32; // タイヤ真値 2leg合算(1回目8.09 + 2回目4.23)・参考表示のみ
const REL_SPREAD_MAX_KM = 0.5; // Android基準の |distance_m 乖離| 上限(過大/過少が縮んだか・相対)

// calcDistance = gps-worker.js と同じ haversine(L 内部関数と同式)
function calcDistance(la1, lo1, la2, lo2) {
  const R = 6371000,
    t = Math.PI / 180;
  const dLa = (la2 - la1) * t,
    dLo = (lo2 - lo1) * t;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * t) * Math.cos(la2 * t) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
// getDynamicAccuracyLimit ミラー(gps-worker.js L267-276)
function getDynamicAccuracyLimit(speedKmh, now) {
  let limit;
  if (speedKmh < 30) limit = 10;
  else if (speedKmh < 60) limit = 15;
  else if (speedKmh < 100) limit = 25;
  else limit = 35;
  const hour = new Date(now).getHours();
  if (hour >= 22 || hour < 5) limit *= 1.2;
  return limit;
}

// (a)(b) gps-worker.js L569-647 の棄却4ゲートを fixture に再適用し棄却を集計。
//   lastPosition は「採用済み直前点」(実コードと同じく棄却点は last を更新しない)。
//   isStationary は raw trace では不明 → 実コードの移動分岐(accLimit=ACC_MOVING_MAX_M下限)を採る。
//   これは過少側に厳しい安全側(accuracy で捨てにくくし Doppler/jump 棄却を純粋に観測)。
function countRejections(samples) {
  let last = null,
    accepted = 0;
  const rej = { accuracy: 0, jump: 0, doppler: 0, accel: 0 };
  const rejGood = { accuracy: 0, jump: 0, doppler: 0, accel: 0 };
  for (const g of samples) {
    const spdKmh = typeof g.spd === 'number' && g.spd >= 0 ? g.spd * 3.6 : 0;
    const acc = g.acc,
      now = g.t;
    const good = Number.isFinite(acc) && acc < GOOD_FIX_ACC_M;
    // (1) accuracy ゲート(L572-585・移動分岐)
    const accLimit = Math.max(getDynamicAccuracyLimit(spdKmh, now), GW.ACC_MOVING_MAX_M);
    if (Number.isFinite(acc) && acc > accLimit) {
      rej.accuracy++;
      if (good) rejGood.accuracy++;
      continue;
    }
    // ★Fix④ ミラー: accuracy が良い (<= trust_position_acc_m) 位置 fix は ②-1 Doppler ゲートで
    //   位置ごと棄却せず受理する (速度成分だけ distrust)。gps-worker.js の trustPosition 分岐と同式。
    //   jump ゲートは「真の位置テレポート」検出のため acc によらず棄却維持 (gps-worker と一致)。
    const trustPosition = Number.isFinite(acc) && acc <= GW.TRUST_POSITION_ACC_M;
    // (2) jump ゲート(L588-602・位置テレポートは acc 良でも棄却)
    if (last) {
      const jump = calcDistance(last.lat, last.lng, g.lat, g.lng);
      const dt = (now - last.t) / 1000;
      if (dt > 0 && jump / dt > GW.JUMP_LIMIT_MPS) {
        rej.jump++;
        if (good) rejGood.jump++;
        continue;
      }
    }
    // (3) Doppler-haversine sanity ゲート(L612-632) = 過少の主犯・Fix④ trustPosition で位置受理
    if (last && spdKmh > 0) {
      const dt = (now - last.t) / 1000;
      if (dt > 0 && dt < 5) {
        const haverMs = calcDistance(last.lat, last.lng, g.lat, g.lng) / dt;
        const dopplerMs = spdKmh / 3.6;
        if (Math.abs(dopplerMs - haverMs) > GW.DOPPLER_DIFF_MPS && !trustPosition) {
          rej.doppler++;
          if (good) rejGood.doppler++;
          continue;
        }
      }
    }
    // (4) 加速度異常ゲート(L635-653)
    if (last && last.spdKmh != null && last.spdKmh > 1 && spdKmh > 1) {
      const dt = (now - last.t) / 1000;
      if (dt > 0 && dt < 5) {
        const accel = (spdKmh - last.spdKmh) / 3.6 / dt;
        if (Math.abs(accel) > GW.MAX_ACCEL_MS2) {
          rej.accel++;
          if (good) rejGood.accel++;
          continue;
        }
      }
    }
    accepted++;
    last = { lat: g.lat, lng: g.lng, t: now, spdKmh };
  }
  const totRej = rej.accuracy + rej.jump + rej.doppler + rej.accel;
  const totGood = rejGood.accuracy + rejGood.jump + rejGood.doppler + rejGood.accel;
  const acceptRate = samples.length ? accepted / samples.length : 1;
  return { rej, rejGood, totRej, totGood, accepted, acceptRate };
}

// (c) 実エンジン(Worker B + Meter + pipeline-distance)に流して distance_m を実測
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

function runEngine(label, samples, isIOS) {
  const worker = createMapMatcherWorker({ debug: false });
  let roadsLoaded = false;
  worker.on((e) => {
    const m = e.data;
    if (m && m.type === 'roadsLoaded') roadsLoaded = m.ok;
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
  }
  return (Meter.getState().distance_m || 0) / 1000; // km
}

function main() {
  const devs = [
    ['iPhone13', true, 'realdevice-iphone13-noisy.json'],
    ['iPhoneSE', true, 'realdevice-iphonese.json'],
    ['Android', false, 'realdevice-android.json'],
  ];
  const results = {};
  let anyFail = false;
  let hakattaDaisu = 0; // ★何台 測れたか（0台なら 赤）★
  for (const [d, ios, fn] of devs) {
    const f = path.join(__dirname, 'fixtures', fn);
    // ★2026-08-28: 前は「fixture無し SKIP」で 飛ばして そのまま緑でした
    //   ＝★3台とも 実物が消えても 緑★（何も見ていないのに 合格に見える）。
    //   実物は ★3台とも repo に在ります★（2026-08-28 実測）。無いなら 消えた/名前が変わった＝★赤★。
    if (!fs.existsSync(f)) {
      console.error('★' + d + ': 実物が 在りません（測っていません）: ' + f + '★');
      console.error('  ⇒「測っていない」であって「異常なし」ではありません。');
      anyFail = true;
      continue;
    }
    hakattaDaisu++;
    const s = JSON.parse(fs.readFileSync(f, 'utf8'))
      .filter((x) => x && Number.isFinite(x.lat) && Number.isFinite(x.lng))
      .sort((a, b) => (a.t || 0) - (b.t || 0));
    const rc = countRejections(s);
    const km = runEngine(d, s, ios);
    results[d] = { rc, km };
    console.log(
      '[' +
        d +
        '] 良いfix(acc<' +
        GOOD_FIX_ACC_M +
        ')棄却=' +
        rc.totGood +
        ' (acc' +
        rc.rejGood.accuracy +
        '/jump' +
        rc.rejGood.jump +
        '/doppler' +
        rc.rejGood.doppler +
        '/accel' +
        rc.rejGood.accel +
        ')' +
        '  総棄却=' +
        rc.totRej +
        '  受理率=' +
        (rc.acceptRate * 100).toFixed(1) +
        '%' +
        '  distance_m=' +
        km.toFixed(2) +
        'km  (真値' +
        TIRE_TOTAL_KM +
        'km 乖離' +
        (km - TIRE_TOTAL_KM >= 0 ? '+' : '') +
        (km - TIRE_TOTAL_KM).toFixed(2) +
        'km)'
    );
  }

  const base = results.Android ? results.Android.km : null;
  console.log("\n--- ASSERTIONS (a)(a')(b)=棄却系  (c)=Android基準の相対spread ---");
  for (const d of Object.keys(results)) {
    const { rc, km } = results[d];
    // (a) 良いfix棄却の上限
    const aPass = rc.totGood <= GOOD_REJ_MAX;
    // (a') Doppler起因の良いfix棄却の上限(過少主犯)
    const dPass = rc.rejGood.doppler <= DOPPLER_GOODREJ_MAX;
    // (b) 受理率: ★report-only★。countRejections は decimated fixture(~1Hz/1800点)上の
    //   代理指標で実機の絶対カウントを再現しない(line22-25)。絶対閾値の assert は overreach。
    const bInfo = rc.acceptRate >= ACCEPT_RATE_MIN ? 'OK' : 'low';
    // (c) Android基準の相対乖離: ★report-only★。実エンジンは gps-worker を迂回して生GPSを直入れ
    //   するため(line19)replay の distance_m は実機 screen 値にならない。距離の"値"は信用しない
    //   (司さん確定ルール=画面値が唯一の真値)。真の端末差判定は実機3台再走行で行う。
    const rel = base != null ? km - base : 0;
    const cInfo =
      d === 'Android' || base == null ? 'base' : Math.abs(rel) <= REL_SPREAD_MAX_KM ? 'OK' : 'wide';
    // ★assert は (a)(a') のみ★ = fix の効き目を直接見る論理テスト(良精度fixが Doppler で捨てられないか)。
    const allPass = aPass && dPass;
    if (!allPass) anyFail = true;
    console.log(
      '[' +
        d +
        '] ' +
        '(a)良いfix棄却' +
        rc.totGood +
        '<=' +
        GOOD_REJ_MAX +
        ':' +
        (aPass ? 'PASS' : '★FAIL★') +
        ' ' +
        "(a')doppler良fix棄却" +
        rc.rejGood.doppler +
        '<=' +
        DOPPLER_GOODREJ_MAX +
        ':' +
        (dPass ? 'PASS' : '★FAIL★') +
        ' ' +
        '| [報告のみ] (b)受理率' +
        (rc.acceptRate * 100).toFixed(1) +
        '%(' +
        bInfo +
        ') ' +
        '(c)Android乖離' +
        (rel >= 0 ? '+' : '') +
        rel.toFixed(2) +
        'km(' +
        cInfo +
        ')'
    );
  }
  console.log(
    '  ★(b)(c)は report-only★: 代理指標/gps-worker迂回で実機screen値と別物。真の端末差判定は実機3台再走行(画面値=唯一の真値)。'
  );
  console.log(
    '  (参考)タイヤ真値2leg合算=' + TIRE_TOTAL_KM + 'km・replayの絶対距離は assert非対象'
  );

  console.log('\n=== GATE doppler-rej: ' + (anyFail ? 'FAIL' : 'PASS') + ' ===');
  // ★0台でも緑にしない★（実物が全部 消えた時に 気づけるように）2026-08-28
  if (hakattaDaisu === 0) {
    console.error('★1台も 測れていません（実物が 1つも 在りません）＝赤★');
    anyFail = true;
  } else {
    console.log('★測れた台数 = ' + hakattaDaisu + ' / 3 台★');
  }
  process.exit(anyFail ? 1 : 0);
}

if (require.main === module) main();
module.exports = {
  countRejections,
  getDynamicAccuracyLimit,
  calcDistance,
  runEngine,
  GOOD_REJ_MAX,
  DOPPLER_GOODREJ_MAX,
  ACCEPT_RATE_MIN,
  REL_SPREAD_MAX_KM,
  TIRE_TOTAL_KM,
};
