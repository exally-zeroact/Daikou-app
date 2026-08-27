#!/usr/bin/env node
'use strict';

// tests/verify-new-meter-9677.js
//
// ★★2026-08-28 に「比べる相手」を 変えました（指示役の裁定①）★★
//
//   ★前は 計算値どうしで閉じていました★
//     こちら側 … 今のエンジンが出す距離（＝平滑した生GPSの弦・2026-06-06 から）
//     あちら側 … TARGET 9,220.9m（＝道路の当てはめ(Viterbi確定snap)・★2026-05-31 に置いた計算値★）
//     ⇒ ★物差しが 2026-06-06 に変わったのに 基準は 5/31 のまま★＝−155.14m（−1.68%）で ずっと赤。
//     ⇒ ★中の値どうしで閉じるな★の型でした。
//
//   ★もう1つ 動かない理由が ありました★
//     実物が ★repo の外のファイル（C:/Users/zeroa/gpstrace.json）★でした。
//     ⇒ ★CI では そもそも動きません（trace not found で終わる）★。
//
//   ★今の形★
//     実物 … ★tests/fixtures/real-trace-iphone13-8.39km-tire.json（repo の中）★
//     真値 … ★車のタイヤ計 8,390m（愛媛 実走・2台同乗）★
//             出どころ tests/gate-road-distance.js:48
//     合格の線 … ★真値を超えない（過大ゼロ）★ かつ ★−0.3〜−1.4% の中★（設計の言葉どおり・
//             js/pipeline-distance.js:262「全fixtureで 過大ゼロ + 精度 −0.3〜−1.4%」）
//
//   ★真値が無い実物は「精度の見張り」に使いません★（指示役 2026-08-28）
//     使うなら「前の版より 悪化していないか」だけ＝別の見張りにする。
//
//   ★昔の基準の記録（消しません）★
//     TARGET 9,220.89m … 2026-05-31 に置いた物・道路の当てはめ(Viterbi確定snap)駆動。
//     さらに前 … 9,676.69m（greedy snap の別道路 flip を含む過大値）／9,233.39m（greedy batch）。
//
// 白紙書き直し検証: 実 js/meter.js (新・pipeline 駆動) + 実 js/map-matcher.js (Worker B) に
//   実走 trace (gpstrace.json seg1・1582 点) を Meter.update 経由で流し、
//   最終 state.distance_m が pipeline-distance batch と一致することを確認する。
// 完全に実コード経路。spd → speedKmh = spd*3.6 で渡す。
//
// ★再 baseline (2026-05-31・L1 配線: 距離源を Viterbi 確定 snap (outSnap) へ一本化)★:
//   旧 TARGET=9676.69 は greedy snap の別道路 flip (余計な弦) を含む過大値・9233.39 は
//   greedy SnapCache 駆動 batch 値だった。L1 配線後の prod 経路は ★Viterbi emission/transition で
//   選んだ確定 snap (outSnap)★ を距離源とする (= greedy 最近傍 snap を距離計算に使わない)。
//   よって live meter は Viterbi 確定 snap 駆動値 ★9220.9m★ に収束する (= greedy batch 9233.39m と
//   12.5m / 0.135% 差・Viterbi 平滑により別道路 flip がさらに減ったため)。
//   distance governance 合意 (MEMORY: bit 固定は廃止・固定すべきはタイヤ真値検証の通過) に従い、
//   bit 固定をやめ Viterbi 確定 snap 駆動値を新 baseline とする。許容 ±15m / 0.2%。
//   ★タイヤ真値検証 (8.39km) は tests/gate-road-distance.js が担当・本 test は live==安定性のみ。★

const fs = require('fs');
const path = require('path');
const { createMapMatcherWorker, loadPrefRoadsData } = require('./replay-mm-worker/worker-sim');
const { loadMeter } = require('./replay-mm-worker/runner');

const PREF = (process.env.ROADS_PREF || 'ehime').toLowerCase();
// ★repo の中の実物★（外のファイルを見ると CI で動きません）
const TRACE_PATH =
  process.env.GPS_TRACE || path.join(__dirname, 'fixtures', 'real-trace-iphone13-8.39km-tire.json');
const TRIP_GAP_SEC = 120;
const R = 6371000;

function rad(x) {
  return (x * Math.PI) / 180;
}
function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function pickMainTrip(samples) {
  const s = samples
    .filter((x) => x && typeof x.lat === 'number' && typeof x.lng === 'number')
    .sort((a, b) => a.t - b.t);
  const segs = [[]];
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && s[i].t - s[i - 1].t > TRIP_GAP_SEC * 1000) segs.push([]);
    segs[segs.length - 1].push(s[i]);
  }
  let best = [];
  let bd = -1;
  for (const g of segs) {
    if (g.length < 2) continue;
    let d = 0;
    for (let i = 1; i < g.length; i++) d += haversine(g[i - 1], g[i]);
    if (d > bd) {
      bd = d;
      best = g;
    }
  }
  return best;
}

function main() {
  if (!fs.existsSync(TRACE_PATH)) {
    console.error('[verify] trace not found: ' + TRACE_PATH);
    process.exit(2);
  }
  const raw = JSON.parse(fs.readFileSync(TRACE_PATH, 'utf8'));
  const samples = Array.isArray(raw) ? raw : raw.samples || raw.trace || [];
  const seg = pickMainTrip(samples);
  if (seg.length < 2) {
    console.error('[verify] seg1 too short');
    process.exit(2);
  }
  console.log('[verify] seg1 points=' + seg.length);

  // 実 Worker B 起動 + ehime roads load
  const prefRoadsData = loadPrefRoadsData(PREF);
  const worker = createMapMatcherWorker({ debug: false });
  let roadsLoaded = false;
  worker.on((e) => {
    const m = e.data;
    if (m && m.type === 'roadsLoaded') roadsLoaded = m.ok;
  });

  // 実 Meter (新) 起動 + adapter で連携
  const Meter = loadMeter({ debug: false });
  Meter.setFareConfig({
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
  });
  Meter.reset();

  // adapter
  const handlers = [];
  worker.on((e) => {
    for (const h of handlers) h(e);
  });
  const adapter = {
    addEventListener(type, h) {
      if (type === 'message') handlers.push(h);
    },
    removeEventListener(type, h) {
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    },
    postMessage(msg) {
      worker.sendMessage(msg);
    },
  };
  Meter.setMapMatcher(adapter);
  adapter.postMessage({ type: 'configPlatform', isIOS: true });
  adapter.postMessage({ type: 'loadRoads', pref: PREF, roadsData: prefRoadsData });
  if (!roadsLoaded) {
    console.error('[verify] loadRoads failed');
    process.exit(2);
  }

  Meter.setBusinessActive(true);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);

  // GPS dispatch via Meter.update (= prod 経路)
  //   spd (m/s) → speedKmh = spd * 3.6。spd 無し時は speedKmh 未指定 (= worker 側 -1 扱い)。
  //   isStationary は注入しない (= worker 側 pipeline ZUPT が変位/速度で判定)。
  let nonStationary = 0;
  for (let i = 0; i < seg.length; i++) {
    const p = seg[i];
    const spd = typeof p.spd === 'number' && p.spd >= 0 ? p.spd : null;
    const speedKmh = spd != null ? spd * 3.6 : undefined;
    const input = {
      lat: p.lat,
      lng: p.lng,
      accuracy:
        typeof p.acc === 'number' ? p.acc : typeof p.accuracy === 'number' ? p.accuracy : 10,
      timestamp: p.t,
      altitude: 0,
      compassHeading: null,
      isStationary: false,
    };
    if (speedKmh !== undefined) input.speedKmh = speedKmh;
    Meter.update(input);
    nonStationary++;
  }

  const s = Meter.getState();
  const distance_m = s.distance_m;
  const fare = Meter.calcFare(distance_m);

  // ★★比べる相手＝車のタイヤ計（真値）★★ 2026-08-28（指示役の裁定①）
  //   8,390m = 愛媛 実走・2台同乗（出どころ tests/gate-road-distance.js:48）
  const TIRE_TRUTH_M = 8390;
  //   ★昔の基準（記録として残す・判定には使わない）★
  //     2026-05-31 の TARGET 9,220.89m は ★道路の当てはめ駆動の計算値★。
  //     物差しが 2026-06-06 に「平滑した生GPSの弦」へ変わったので 比べる相手にしません。
  const OLD_TARGET_2026_05_31 = 9220.89;
  const sa = distance_m - TIRE_TRUTH_M; // ＋なら 真値を超えている（過大）
  const pct = (sa / TIRE_TRUTH_M) * 100;

  console.log('[verify] dispatched (non-stationary) = ' + nonStationary);
  console.log('[verify] Meter.state.distance_m       = ' + distance_m.toFixed(2) + ' m');
  console.log('[verify] ★タイヤ計（真値）★           = ' + TIRE_TRUTH_M + ' m');
  console.log(
    '[verify] ★差★ = ' +
      (sa >= 0 ? '+' : '') +
      sa.toFixed(2) +
      ' m  (' +
      (pct >= 0 ? '+' : '') +
      pct.toFixed(2) +
      '%)'
  );
  console.log(
    '[verify] （記録）2026-05-31 の古い基準 = ' +
      OLD_TARGET_2026_05_31 +
      ' m ※道路の当てはめ駆動の計算値・判定には使いません'
  );
  console.log('[verify] fare_yen (calcFare)          = ' + fare + ' 円');
  console.log(
    '[verify] mm_distance_m (mirror)       = ' + (s.mm_distance_m || 0).toFixed(2) + ' m'
  );

  // ★合格の線（指示役 2026-08-28）★
  //   ①★真値を超えない（過大ゼロ）★
  //   ②★−0.3〜−1.4% の中★（js/pipeline-distance.js:262 の実測レンジ）
  //   ※★代行は わざと 真距離+0.1%（係数1.011・DM Light基準）★＝この見張りは
  //     ★係数を掛ける前の距離★を見ています。混同しないでください。
  const OVER_OK = sa <= 0; // 過大ゼロ
  const BAND_LO = -1.4;
  const BAND_HI = -0.3;
  const BAND_OK = pct >= BAND_LO && pct <= BAND_HI;
  const PASS = OVER_OK && BAND_OK;
  console.log(
    '[verify] ①過大ゼロ（真値を超えない）… ' +
      (OVER_OK ? 'PASS' : '★FAIL★') +
      ' ／ ②' +
      BAND_LO +
      '〜' +
      BAND_HI +
      '% の中 … ' +
      (BAND_OK ? 'PASS' : '★FAIL★')
  );
  console.log('[verify] 判定: ' + (PASS ? 'PASS' : 'FAIL'));
  process.exit(PASS ? 0 : 1);
}

main();
