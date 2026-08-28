#!/usr/bin/env node
'use strict';
// ★真距離スコアハーネス (2026-06-10)★
//   今日の実機3台 0610 trace を ★実エンジン(Worker B + Meter + pipeline-distance)★ に流し、
//   出力 distance_m を ★真距離(DM Light 代行メーター = 25.69km)★ と比較して認定バンド(-4%〜0%)を採点する。
//   さらに トンネル一括ドン(最大単更新ジャンプ) と 停車creep を計測。
//   ログ値読みでなく「実コードに実入力を流した出力」= 推測ゼロ。
const fs = require('fs');
const path = require('path');
const { createMapMatcherWorker, loadPrefRoadsData } = require('./replay-mm-worker/worker-sim');
const { loadMeter } = require('./replay-mm-worker/runner');

// ★真距離 (今日の実測参照)★
// ★★2026-08-28 実測：この道具の「真値」と 実物が 合っていません★★
//   真値 25.69km（約40分の走行）に対し、repo の実物は:
//     0610-iPhone13.json … 2,400点 ／ ★40.0分★（＝合う）
//     0610-iPhoneSE.json …… 336点 ／ ★5.6分★（★短すぎる★）
//     0610-Android.json …… 464点 ／ ★9.8分★（★短すぎる★）
//   ⇒ 出る数字 … iPhone13 −7.64% ／ iPhoneSE ★−90.61%★ ／ Android ★−69.58%★
//   ⇒★エンジンが おかしいのではなく「比べる相手（実物）が 途中までしか無い」★
//     （同じ日に タイヤ計 8.39km では ★−0.93%・過大ゼロ★／creep の見張りでも ★0.00m★）
//   ⇒★この道具を「距離の合否」に使ってはいけません★（実物を揃えるまで）
//   ★裁定待ち★ … 実物を揃える／iPhone13 だけで見る／この道具は数を見るだけにする
const TRUE_DIST_KM = 25.69; // DM Light 代行メーター = 課金の真値
const ODO_KM = 25.9; // 車オドメーター(緩い天井・参考)
const BAND_LO = -4.0,
  BAND_HI = 0.0; // 認定バンド(JIS/国交省ソフトメーター: -4%〜0%・過大不可)

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
  let roadsLoaded = false;
  const mm = [];
  worker.on((e) => {
    const m = e.data;
    if (!m) return;
    if (m.type === 'mmResult') mm.push(m);
    if (m.type === 'roadsLoaded') roadsLoaded = m.ok;
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
  if (!roadsLoaded) {
    console.log(label + ': loadRoads FAIL');
    return null;
  }
  if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);

  let creep = 0,
    lastDm = 0,
    maxJump = 0,
    maxJumpAtSpd0 = 0;
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
    const s = Meter.getState();
    const dm = s.distance_m || 0;
    const jump = dm - lastDm;
    if (jump > maxJump) maxJump = jump;
    // 停車/GPS無効(spd<0.5 or spd<0)で起きた一括計上=トンネルlump/creepの実体
    if ((typeof g.spd !== 'number' || g.spd < 0.5) && jump > maxJumpAtSpd0) maxJumpAtSpd0 = jump;
    if (typeof g.spd === 'number' && g.spd < 0.5 && jump > 0.01) creep += jump;
    lastDm = dm;
  }
  Meter.businessEnd();
  const fs2 = Meter.getState();
  return {
    distance_m: fs2.distance_m || 0,
    business_distance_m: fs2.business_distance_m || 0,
    creep,
    maxJump,
    maxJumpAtSpd0,
    n: samples.length,
  };
}

function loadFixture(name) {
  const f = path.join(__dirname, 'fixtures', name);
  if (!fs.existsSync(f)) return null;
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  return s
    .filter((x) => x && Number.isFinite(x.lat) && Number.isFinite(x.lng))
    .sort((a, b) => (a.t || 0) - (b.t || 0));
}

console.log(
  '真距離(DM Light)=' +
    TRUE_DIST_KM +
    'km / 車オドメーター=' +
    ODO_KM +
    'km / 認定バンド=' +
    BAND_LO +
    '%〜' +
    BAND_HI +
    '%\n'
);
const devs = [
  ['iPhone13', '0610-iPhone13.json', true],
  ['iPhoneSE', '0610-iPhoneSE.json', true],
  ['Android', '0610-Android.json', false],
];
const rows = [];
// ★2026-08-28: 「fixture無し」で 飛ばして そのまま緑で終わっていました＝★0件でも緑★。
//   ⇒ ★何台 測れたかを 数えてから 終わる★（下の判定で 0件なら 赤）。
const misokutei = [];
for (const [label, file, ios] of devs) {
  const s = loadFixture(file);
  if (!s) {
    console.log('★' + label + ': ★未測定★（実物が在りません: ' + file + '）★');
    misokutei.push(label);
    continue;
  }
  let r = null;
  try {
    r = run(label, s, ios);
  } catch (e) {
    console.log('★' + label + ' ERROR: ' + e.message + '★');
    misokutei.push(label);
    continue;
  }
  if (!r) {
    misokutei.push(label);
    continue;
  }
  const km = r.distance_m / 1000;
  const errVsTrue = ((km - TRUE_DIST_KM) / TRUE_DIST_KM) * 100;
  const errVsOdo = ((km - ODO_KM) / ODO_KM) * 100;
  const inBand = errVsTrue >= BAND_LO && errVsTrue <= BAND_HI;
  rows.push({
    label,
    km,
    errVsTrue,
    errVsOdo,
    inBand,
    creep: r.creep,
    maxJump: r.maxJump,
    maxJumpAtSpd0: r.maxJumpAtSpd0,
    n: r.n,
  });
}

console.log(
  '端末       | エンジン距離 | vs真距離  | vs odo  | 認定バンド | 停車creep | 停車時最大lump'
);
console.log(
  '-----------|-------------|----------|---------|-----------|-----------|---------------'
);
for (const r of rows) {
  console.log(
    r.label.padEnd(10) +
      ' | ' +
      (r.km.toFixed(3) + 'km').padStart(11) +
      ' | ' +
      (r.errVsTrue >= 0 ? '+' : '') +
      r.errVsTrue.toFixed(2) +
      '%' +
      ' | ' +
      (r.errVsOdo >= 0 ? '+' : '') +
      r.errVsOdo.toFixed(2) +
      '%' +
      ' | ' +
      (r.inBand ? '✓ 合格' : '✗ 範囲外').padEnd(9) +
      ' | ' +
      (r.creep.toFixed(1) + 'm').padStart(9) +
      ' | ' +
      (r.maxJumpAtSpd0.toFixed(0) + 'm').padStart(13)
  );
}
console.log(
  '\n※停車時最大lump = 停車/GPS無効中に1更新で計上された最大距離 = トンネル一括ドンの実体(認定creep要件に直結)'
);

// ★★2026-08-28: この道具には ★合否の線が ありませんでした★★（指示役の順番3）
//   ここまで 何を測っても ★必ず 戻り値0（緑）★で終わっていました。
//   ＝★cert-gate に入れた私の判断ミス★（「緑だった」のではなく「赤にならない作り」だった）。
//
//   ★今回 入れたのは「0件なら赤」だけです★
//     ・1台も測れなかったら ★赤★（実物が消えた／名前が変わった時に 気づける）
//     ・★どの台が 帯（BAND_LO〜BAND_HI）から外れたら赤にするか は 指示役の裁定待ち★
//       （距離・課金の線なので 私が勝手に決めません）
console.log('');
console.log('★測れた台数 … ' + rows.length + ' / ' + devs.length + ' 台★');
if (misokutei.length) console.log('★未測定 … ' + misokutei.join(' / ') + '★');
const soto = rows.filter((r) => !r.inBand);
console.log(
  '★帯から外れた台 … ' +
    (soto.length ? soto.map((r) => r.label).join(' / ') : 'なし') +
    '★（★今は これで赤にしていません＝裁定待ち★）'
);
if (rows.length === 0) {
  console.log('★判定: FAIL（1台も測れていません＝「異常なし」ではありません）★');
  process.exit(1);
}
console.log('★判定: PASS（測れた台数 ' + rows.length + ' 台・0件ではない）★');
process.exit(0);
