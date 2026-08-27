#!/usr/bin/env node
'use strict';

// tests/verify-display-smoothness.js
// 白紙書き直し (clean-rebuild-pipeline) 表示層検証:
//   実 js/meter.js (新・pipeline 駆動) + 実 js/map-matcher.js (Worker B) に
//   実走 trace (gpstrace.json seg1) を Meter.update 経由で流し、各点後に
//   getState() を ★UI ループ相当で複数回★ 呼んで display_distance_m の挙動を検証する。
//
//   ★検証 invariant (= index.html 距離表示層の白紙契約)★
//     (1) display_distance_m は単調非減少 (= 表示後退ゼロ)
//     (2) ★司さん確定方針 (2026-05-30)★: display_distance_m は課金値 distance_m を
//         ★絶対に超えない (overshoot ゼロ・先取り廃止)★。catch-up で「下から」追従する。
//         ※ display は表示専用。display ≤ distance_m ゆえ calcFare(display) ≤ calcFare(distance_m)
//           で過大請求は不能。distance_m は不可侵 (= verify-new-meter-9677.js が 9,675.91m を別途 gate)。
//     (3) display_distance_m は trip 終了 (最終 getState) で distance_m に収束する
//         (= 乖離放置なし・等速ペース catch-up で target に着地)。
//     (4) business_display_distance_m も同様に単調・overshoot ゼロ・収束
//
//   ★等速ペース前提 (2026-05-30)★: display は target へ ★一定速度 (直近進行レート)★ で
//     「下から」詰める (= 旧・指数減速や 10m 先取りグリッドではない)。1Hz GPS でも「動いて→
//     止まって→動いて」の脈動を出さず連続的に動く。本テストは overshoot ゼロ・単調・収束を
//     gate し、等速性そのものの脈動 invariant は tests/verify-display-even-pace.js が担当する。
//
//   ★絶対不可侵★ distance_m / calcFare / 課金経路は本テストで一切変更しない (= 読むだけ)。
//
//   使い方: node tests/verify-display-smoothness.js
//   exit 0 = PASS / 非0 = FAIL (= CI gate)。

const fs = require('fs');
const { createMapMatcherWorker, loadPrefRoadsData } = require('./replay-mm-worker/worker-sim');
const { loadMeter } = require('./replay-mm-worker/runner');

const PREF = (process.env.ROADS_PREF || 'ehime').toLowerCase();
// ★2026-08-28: repo の外（C:/Users/zeroa/gpstrace.json）を見ていました★
//   ⇒ 手元では緑／★CI では 実物が無い★。この試験を CI に登録して ★赤で気づきました★。
//   ⇒ repo の中の実物（実走・タイヤ計 8.39km）を 既定にします。
const path = require('path');
const TRACE_PATH =
  process.env.GPS_TRACE || path.join(__dirname, 'fixtures', 'real-trace-iphone13-8.39km-tire.json');
const TRIP_GAP_SEC = 120;
const R = 6371000;

// ★司さん確定方針 (2026-05-30・過大請求根絶)★: display は target(distance_m) を
// ★絶対に超えない (overshoot ゼロ)★。先取り (predict lookahead) は撤去済。
// 本テストは display が「下から catch-up」し target を超えないこと・単調・収束を検証する。
// distance_m (課金値) 自体は verify-new-meter-9677.js が別途 gate。
const OVERSHOOT_TOL_M = 0.01; // float 誤差のみ許容 (= 先取りは設計上ゼロ)。
const CONVERGE_TOL_M = 1.0; // trip 終了時の display↔distance 収束許容。
const UI_TICKS_PER_GPS = 4; // 1 GPS 点あたり UI ループ呼び出し回数 (= rAF/setInterval 相当)。

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

function fail(msg) {
  console.error('[display] FAIL: ' + msg);
  process.exit(1);
}

function main() {
  if (!fs.existsSync(TRACE_PATH)) {
    // ★2026-08-28: 前は ここで ★戻り値0（緑）★で終わっていました＝★何も見ていないのに緑★。
    //   ⇒「未測定」と はっきり言って ★赤★にします（指示役 2026-08-28・全アプリ共通）。
    console.error('★[display] ★未測定★ … 実物が在りません: ' + TRACE_PATH + '★');
    console.error('  ⇒「実物が無い」は「異常なし」ではありません。');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(TRACE_PATH, 'utf8'));
  const samples = Array.isArray(raw) ? raw : raw.samples || raw.trace || [];
  const seg = pickMainTrip(samples);
  if (seg.length < 2) fail('seg1 too short');
  console.log('[display] seg1 points=' + seg.length);

  const prefRoadsData = loadPrefRoadsData(PREF);
  const worker = createMapMatcherWorker({ debug: false });
  let roadsLoaded = false;
  worker.on((e) => {
    const m = e.data;
    if (m && m.type === 'roadsLoaded') roadsLoaded = m.ok;
  });

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
  if (!roadsLoaded) fail('loadRoads failed');

  Meter.setBusinessActive(true);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);

  let prevDisplay = 0;
  let prevBizDisplay = 0;
  let maxOvershoot = 0; // display - distance_m の最大値 (= 課金値超え量)。
  let maxBizOvershoot = 0;
  let monoViolations = 0;
  let bizMonoViolations = 0;
  let totalTicks = 0;
  let maxGapToTarget = 0; // 走行中 display が distance_m から離れた最大量。

  // ★mock clock★: catch-up は実時間 (Date.now) ベースで target へ収束する。本ハーネスは
  //   trace を実時間無視で高速 replay するため、Date.now を trace 時刻に同期させて
  //   「実機で 1Hz・実秒が経過する」状況を再現する (= 時間ベース catch-up を正しく検証)。
  const _realDateNow = Date.now;
  let _mockNow = seg.length ? seg[0].t : _realDateNow();
  Date.now = () => _mockNow;

  for (let i = 0; i < seg.length; i++) {
    const p = seg[i];
    _mockNow = p.t; // GPS 受信時刻 = trace timestamp
    // 次点までの実経過 (= 1Hz なら ~1000ms)。UI tick はこの間に時間が進むものとして配分。
    const dtToNext = i + 1 < seg.length ? Math.max(0, Math.min(5000, seg[i + 1].t - p.t)) : 1000;
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

    // UI ループ相当: 1 GPS 点ごとに複数回 getState (= rAF 60Hz / setInterval 100ms の高頻度読出)。
    //   getState は now=Date.now() ベースの等速ペース catch-up ゆえ、複数回呼んでも単調・課金値以下。
    for (let k = 0; k < UI_TICKS_PER_GPS; k++) {
      // UI tick ごとに次点までの実時間を配分して進める (= rAF/setInterval が実秒で回る再現)。
      _mockNow = p.t + Math.round((dtToNext * (k + 1)) / UI_TICKS_PER_GPS);
      const s = Meter.getState();
      const disp = s.display_distance_m || 0;
      const dist = s.distance_m || 0;
      const biz = s.business_display_distance_m || 0;
      const bizTarget = s.business_distance_m || 0;
      totalTicks++;

      // (1) 単調非減少 (display)
      if (disp < prevDisplay - 1e-6) monoViolations++;
      prevDisplay = Math.max(prevDisplay, disp);

      // (2) 課金値 distance_m に対する overshoot 量 (= 先取りゼロ契約・0 であるべき)
      const over = disp - dist;
      if (over > maxOvershoot) maxOvershoot = over;

      // (3) 走行中の display↔target 乖離量を記録 (= 等速 catch-up の下からの追従ラグ上限)
      const gap = dist - disp;
      if (gap > maxGapToTarget) maxGapToTarget = gap;

      // (4) business display 単調 + 課金 business 超えない
      if (biz < prevBizDisplay - 1e-6) bizMonoViolations++;
      prevBizDisplay = Math.max(prevBizDisplay, biz);
      const bizOver = biz - bizTarget;
      if (bizOver > maxBizOvershoot) maxBizOvershoot = bizOver;
    }
  }

  // trip 終了後: display は target に収束するまで getState を回す (= UI が止まらない限り追従)。
  //   mock clock を 100ms/tick 進め、実機で停車後に実秒が経過し catch-up が収束する状況を再現。
  let s = Meter.getState();
  let settleGuard = 0;
  while (s.distance_m - (s.display_distance_m || 0) > CONVERGE_TOL_M && settleGuard < 100000) {
    _mockNow += 100; // 100ms/tick の実時間経過
    s = Meter.getState();
    settleGuard++;
  }
  Date.now = _realDateNow; // mock clock 復旧
  const finalDisp = s.display_distance_m || 0;
  const finalDist = s.distance_m || 0;
  const finalBizDisp = s.business_display_distance_m || 0;
  const finalBizDist = s.business_distance_m || 0;
  const convergeGap = Math.abs(finalDist - finalDisp);
  const bizConvergeGap = Math.abs(finalBizDist - finalBizDisp);

  console.log('[display] ticks                       = ' + totalTicks);
  console.log('[display] final distance_m            = ' + finalDist.toFixed(2) + ' m (課金値)');
  console.log('[display] final display_distance_m    = ' + finalDisp.toFixed(2) + ' m');
  console.log('[display] final business_distance_m   = ' + finalBizDist.toFixed(2) + ' m');
  console.log('[display] final business_display_m    = ' + finalBizDisp.toFixed(2) + ' m');
  console.log('[display] mono violations (display)   = ' + monoViolations);
  console.log('[display] mono violations (business)  = ' + bizMonoViolations);
  console.log(
    '[display] max overshoot (display)     = ' +
      maxOvershoot.toFixed(4) +
      ' m (契約 = 0・先取りゼロ)'
  );
  console.log(
    '[display] max overshoot (business)    = ' +
      maxBizOvershoot.toFixed(4) +
      ' m (契約 = 0・先取りゼロ)'
  );
  console.log('[display] max gap display→distance    = ' + maxGapToTarget.toFixed(2) + ' m');
  console.log('[display] converge gap (display)      = ' + convergeGap.toFixed(4) + ' m');
  console.log('[display] converge gap (business)     = ' + bizConvergeGap.toFixed(4) + ' m');

  // ─── 判定 ───
  if (monoViolations > 0)
    fail('display_distance_m が後退した (= 単調非減少違反 ' + monoViolations + ' 回)');
  if (bizMonoViolations > 0)
    fail('business_display_distance_m が後退した (= 単調非減少違反 ' + bizMonoViolations + ' 回)');
  if (maxOvershoot > OVERSHOOT_TOL_M)
    fail(
      'display_distance_m が実距離を超えた (= overshoot ゼロ契約違反・最大 ' +
        maxOvershoot.toFixed(4) +
        ' m・先取り混入=過大請求の穴)'
    );
  if (maxBizOvershoot > OVERSHOOT_TOL_M)
    fail(
      'business_display_distance_m が実距離を超えた (= overshoot ゼロ契約違反・最大 ' +
        maxBizOvershoot.toFixed(4) +
        ' m)'
    );
  if (convergeGap > CONVERGE_TOL_M)
    fail('display が distance_m に収束しない (= 乖離 ' + convergeGap.toFixed(4) + ' m・追従破綻)');
  if (finalDist <= 0) fail('distance_m が 0 のまま (= 距離駆動が動いていない・harness 異常)');

  console.log('[display] 判定: PASS');
  process.exit(0);
}

main();
