#!/usr/bin/env node
'use strict';

// tests/real-trace-roadsnap.js
// 実走 debug trace を「自前の道路データ (roads-{pref}.js)」に
// ゲート/clamp 無しでクリーンに snap し、道なり距離を算出する自前の答え合わせ。
// → 完全オフライン (Google/OSRM/オドメーター不要)。アプリが持つ道路情報だけで
//    「理想的な道なり距離」を出し、ダイコメ実測 (business) との差で
//    『データは十分か / パイプライン(ゲート・clamp・gap-skip)が距離を削っとるか』を切り分ける。
//
// 使い方: node tests/real-trace-roadsnap.js  (env: REAL_TRACE_KEY / ROADS_PREF=ehime)

const fs = require('fs');
const path = require('path');

const DB = 'https://daikou-app-c821a-default-rtdb.asia-southeast1.firebasedatabase.app';
const PREF = (process.env.ROADS_PREF || 'ehime').toLowerCase();
const FORCED_KEY = process.env.REAL_TRACE_KEY || '';
const TRIP_GAP_SEC = 120;
const SNAP_MAX_M = 50;
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

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function findLatestGpsTrace() {
  if (FORCED_KEY) return FORCED_KEY;
  const keys = Object.keys((await getJson(DB + '/debug_traces.json?shallow=true')) || {}).sort();
  for (let i = keys.length - 1; i >= 0 && i >= keys.length - 60; i--) {
    try {
      const m = await getJson(DB + '/debug_traces/' + keys[i] + '/meta.json');
      if (m && m.kind == null && m.watch_options) return keys[i];
    } catch (_) {
      /* skip */
    }
  }
  return null;
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

// roads-decoder.js + roads-{pref}.js を Node で読み込む (browser IIFE を global shim で)
function loadDecoder(pref) {
  global.window = global;
  global.self = global;
  const decSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'roads-decoder.js'), 'utf8');
  // eslint-disable-next-line no-eval
  eval(decSrc); // → global.RoadDecoder
  const dataFile = path.join(__dirname, '..', 'data', 'roads-' + pref + '.js');
  if (!fs.existsSync(dataFile)) throw new Error('roads データ無し: ' + dataFile);
  const dataSrc = fs.readFileSync(dataFile, 'utf8');
  // eslint-disable-next-line no-eval
  eval(dataSrc); // → window.ROADS_<PREF> (= global.ROADS_<PREF>)
  const key = 'ROADS_' + pref.toUpperCase();
  const roadsData = global[key];
  if (!roadsData) throw new Error('global.' + key + ' 未定義');
  const dec = new global.RoadDecoder(roadsData);
  dec.buildOffsetTable();
  return dec;
}

async function main() {
  const key = await findLatestGpsTrace();
  if (!key) {
    console.error('[roadsnap] GPS trace 見つからず');
    process.exit(0);
  }
  const samples = await getJson(DB + '/debug_traces/' + key + '/samples.json');
  const trip = pickMainTrip(samples);
  if (trip.length < 2) {
    console.error('[roadsnap] 走行区間なし');
    process.exit(0);
  }

  let raw = 0;
  for (let i = 1; i < trip.length; i++) raw += haversine(trip[i - 1], trip[i]);

  console.log('[roadsnap] trace=' + key + ' pref=' + PREF + ' pts=' + trip.length);
  console.log('[roadsnap] roads-' + PREF + ' 読込中...');
  const dec = loadDecoder(PREF);

  // クリーン snap: 各点を最近接道路へ。ゲート/clamp/Viterbi/gap-skip は一切かけない。
  let cleanRoad = 0;
  let snapHit = 0;
  let sameRoad = 0;
  let diffRoad = 0;
  let prevSnap = null;
  for (const p of trip) {
    const snap = dec.snapToNearestRoad(p.lat, p.lng, { maxDistM: SNAP_MAX_M });
    if (!snap) {
      prevSnap = null;
      continue;
    }
    snapHit++;
    if (prevSnap) {
      const r = dec.calcRoadDistance(prevSnap, snap);
      if (r && typeof r.distanceM === 'number' && r.distanceM >= 0 && r.distanceM < 2000) {
        cleanRoad += r.distanceM;
        if (r.onSameRoad) sameRoad++;
        else diffRoad++;
      }
    }
    prevSnap = snap;
  }

  const snapRate = ((snapHit / trip.length) * 100).toFixed(1);
  const out = {
    trace_key: key,
    pref: PREF,
    points: trip.length,
    snap_rate_pct: +snapRate,
    raw_haversine_m: +raw.toFixed(0),
    clean_road_snap_m: +cleanRoad.toFixed(0),
    same_road_segs: sameRoad,
    diff_road_segs: diffRoad,
  };
  console.log('\n=== 自前道路データによるクリーン道なり距離 (オフライン答え合わせ) ===');
  console.log(
    '  snap率           : ' + snapRate + '%  (道路に乗った点 ' + snapHit + '/' + trip.length + ')'
  );
  console.log('  生GPS haversine  : ' + out.raw_haversine_m + ' m');
  console.log('  ★クリーン道なり  : ' + out.clean_road_snap_m + ' m  ← 自前道路データの理想値');
  console.log('  同一道路/別道路  : ' + sameRoad + ' / ' + diffRoad + ' 区間');
  const OUT_DIR = path.join(__dirname, '..', 'data', 'test-results');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'real-trace-roadsnap.json'), JSON.stringify(out, null, 2));
  console.log('[roadsnap] wrote data/test-results/real-trace-roadsnap.json');
}

main().catch((e) => {
  console.error('[roadsnap] fatal:', e && e.message ? e.message : e);
  process.exit(1);
});
