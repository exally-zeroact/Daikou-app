// tests/integration/real-trace-creep-stationary.test.js
//
// ★設計変更宣言 (2026-05-29・real-trace creep 真因解析・freeze 修正検証):
//   司さん iPhone13 親機の実機 trace (= Firebase RTDB 取得・990 sample・5.35km・16.5min・
//   停車中 298 sample) を fixture 化し・実 Worker B (= map-matcher.js) を replay して
//   isStationary=true 期間中の tentativeDistanceM が freeze されることを検証。
//
//   背景 (= 2026-05-29 解析):
//     ・連続点 haversine 累積で・停車中 298 sample 区間に 44.8m の drift が発生
//     ・旧実装: isStationary=true 中・mmIncrementM=0/tentativeIncrementM=0 のみ・
//               tentativeDistanceM (= snapshot 弧長) は更新継続 → main 側
//               business_tier2_pending_m SET 経由で display creep 発生
//     ・新実装: isStationary=true 中・tentativeDistanceM も freeze 値 (= 前回
//               isStationary=false 時の値) で出力 + mmResult に isStationary echo back
//     ・main 側 meter.js L627/L646 にも !m.isStationary ガード追加 (= 二重保険)
//
//   絶対ルール準拠:
//     ・distance_m / business_distance_m 加算経路は 1 byte 不変
//     ・本 test は tentativeDistanceM (= preview・freeze 対象) と isStationary echo のみ assert
//     ・課金経路は無関係
'use strict';

const fs = require('fs');
const path = require('path');
const { createMapMatcherWorker, loadPrefRoadsData } = require('../replay-mm-worker/worker-sim');

const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'real-trace-iphone13-親-16min.json');
const FIXTURE_PATH_V2 = path.join(
  __dirname,
  '..',
  'fixtures',
  'real-trace-iphone13-親-7min-after-38ed5e46.json'
);

function _haversine(lat1, lng1, lat2, lng2) {
  if (lat1 === lat2 && lng1 === lng2) return 0;
  const R = 6371000;
  const tr = Math.PI / 180;
  const dLat = (lat2 - lat1) * tr;
  const dLng = (lng2 - lng1) * tr;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * tr) * Math.cos(lat2 * tr) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 5 秒 window / 3m 半径で isStationary 計算 (= gps.js checkStationaryFallback と同等)
function _computeIsStationary(samples, i) {
  if (i < 5) return false;
  const s = samples[i];
  const wStart = s.t - 5000;
  for (let j = i - 1; j >= 0; j--) {
    if (samples[j].t < wStart) break;
    if (_haversine(s.lat, s.lng, samples[j].lat, samples[j].lng) > 3) return false;
  }
  return true;
}

describe('real-trace iPhone13 親機 (990 sample・16.5min・5.35km) → 停車中 creep 真因解消検証', () => {
  it('mmResult.isStationary echo back が含まれる (= main 側 SET ガード用)', async () => {
    const data = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
    const worker = createMapMatcherWorker();
    const events = [];
    worker.on((e) => events.push(e.data));

    const roadsData = loadPrefRoadsData('ehime');
    worker.sendMessage({ type: 'loadRoads', pref: 'ehime', roadsData });
    const loaded = events.find((m) => m && m.type === 'roadsLoaded');
    expect(loaded && loaded.ok).toBe(true);

    // 1 sample・isStationary=true で送信
    const s = data.samples[0];
    worker.sendMessage({
      type: 'gps',
      lat: s.lat,
      lng: s.lng,
      accuracy: s.acc,
      speedKmh: (s.spd || 0) * 3.6,
      heading: s.hdg,
      timestamp: s.t,
      isStationary: true,
      pref: 'ehime',
    });

    const mm = events.find((e) => e && e.type === 'mmResult');
    expect(mm).toBeDefined();
    expect(mm.isStationary).toBe(true);
    expect(mm.mmIncrementM).toBe(0);
    expect(mm.tentativeIncrementM).toBe(0);
  }, 30000);

  it('停車中 (= 5sec/3m radius) tentativeDistanceM が freeze (= 連続増加せず creep 主因解消)', async () => {
    const data = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
    // 最初 300 sample (= 走行 → 停車境界 → 走行 を含む代表区間・~5 分)
    const samples = data.samples.slice(0, 300);
    const worker = createMapMatcherWorker();
    const events = [];
    worker.on((e) => events.push(e.data));

    const roadsData = loadPrefRoadsData('ehime');
    worker.sendMessage({ type: 'loadRoads', pref: 'ehime', roadsData });

    const results = [];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const isStat = _computeIsStationary(samples, i);
      const before = events.length;
      worker.sendMessage({
        type: 'gps',
        lat: s.lat,
        lng: s.lng,
        accuracy: s.acc,
        speedKmh: (s.spd || 0) * 3.6,
        heading: s.hdg,
        timestamp: s.t,
        isStationary: isStat,
        pref: 'ehime',
      });
      for (let j = before; j < events.length; j++) {
        const e = events[j];
        if (e && e.type === 'mmResult') {
          results.push({
            idx: i,
            isStat,
            tentativeDistanceM: e.tentativeDistanceM,
            mmIsStat: e.isStationary,
          });
        }
      }
    }

    expect(results.length).toBeGreaterThan(50);

    // ★core assert: isStationary=true 連続区間で・tentativeDistanceM が増加しない (= freeze)★
    // 連続停車区間ごとに・最初の tentativeDistanceM を anchor として・以降の差分を観測。
    let anchor = null;
    let maxDeltaWhileStat = 0;
    let statRunLen = 0;
    let maxStatRunLen = 0;
    for (const r of results) {
      if (r.isStat) {
        if (anchor === null) anchor = r.tentativeDistanceM;
        const delta = r.tentativeDistanceM - anchor;
        if (delta > maxDeltaWhileStat) maxDeltaWhileStat = delta;
        statRunLen++;
        if (statRunLen > maxStatRunLen) maxStatRunLen = statRunLen;
      } else {
        anchor = null;
        statRunLen = 0;
      }
    }
    // 停車区間中の tentativeDistanceM max delta < 1m (= freeze 効果検証)
    // freeze なしの場合・GPS drift で 10m+ 累積していた (= 真因)
    expect(maxStatRunLen).toBeGreaterThan(10); // 停車区間が観測できていることを確認
    expect(maxDeltaWhileStat).toBeLessThan(1.0);
  }, 60000);

  // ★設計変更宣言 (2026-05-29 PM・real-trace 38ed5e46 後 残存 creep 検証):
  //   38ed5e46 push 後の trace で・spd<1km/h sample 134 件で haversine 21.7m drift 残存。
  //   原因: isStationary=true (= 5sec/3m radius) 判定外の・spd<2 で 3m radius 超える drift。
  //   freeze 条件拡張 (= isStationary OR speedKmh<2) で・低速 drift も freeze 対象に。
  //   本 test は新 trace fixture で freeze 拡張効果を検証する。
  it('38ed5e46 後 trace: spd<2km/h 低速区間も freeze (= effectively stationary 拡張)', async () => {
    const data = JSON.parse(fs.readFileSync(FIXTURE_PATH_V2, 'utf8'));
    const samples = data.samples.slice(0, 250); // 7 分 fixture の代表区間
    const worker = createMapMatcherWorker();
    const events = [];
    worker.on((e) => events.push(e.data));

    const roadsData = loadPrefRoadsData('ehime');
    worker.sendMessage({ type: 'loadRoads', pref: 'ehime', roadsData });

    const results = [];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const speedKmh = (s.spd || 0) * 3.6;
      const isStat = _computeIsStationary(samples, i);
      const before = events.length;
      worker.sendMessage({
        type: 'gps',
        lat: s.lat,
        lng: s.lng,
        accuracy: s.acc,
        speedKmh,
        heading: s.hdg,
        timestamp: s.t,
        isStationary: isStat,
        pref: 'ehime',
      });
      for (let j = before; j < events.length; j++) {
        const e = events[j];
        if (e && e.type === 'mmResult') {
          results.push({
            idx: i,
            speedKmh,
            isStat,
            effStat: e.isStationary, // ★Worker B echo (= effectively stationary)
            tentativeDistanceM: e.tentativeDistanceM,
          });
        }
      }
    }

    expect(results.length).toBeGreaterThan(50);

    // ★assert 1: spd<2km/h sample で mmResult.isStationary が true (= echo 拡張)★
    const lowSpeedResults = results.filter((r) => r.speedKmh < 2);
    expect(lowSpeedResults.length).toBeGreaterThan(5);
    const echoCorrect = lowSpeedResults.filter((r) => r.effStat === true).length;
    expect(echoCorrect).toBe(lowSpeedResults.length); // 全 low-speed で echo=true

    // ★assert 2: effectively stationary 連続区間で tentativeDistanceM が freeze★
    let anchor = null;
    let maxDeltaWhileEff = 0;
    let effRunLen = 0;
    let maxEffRunLen = 0;
    for (const r of results) {
      if (r.effStat === true) {
        if (anchor === null) anchor = r.tentativeDistanceM;
        const delta = r.tentativeDistanceM - anchor;
        if (delta > maxDeltaWhileEff) maxDeltaWhileEff = delta;
        effRunLen++;
        if (effRunLen > maxEffRunLen) maxEffRunLen = effRunLen;
      } else {
        anchor = null;
        effRunLen = 0;
      }
    }
    expect(maxEffRunLen).toBeGreaterThan(5);
    expect(maxDeltaWhileEff).toBeLessThan(1.0);
  }, 60000);
});
