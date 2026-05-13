#!/usr/bin/env node
'use strict';

// tests/tier4-google.js
// Tier1 (OSRM) と Tier2 (self) が「一致しない」点だけを Google Directions API に問合せて
// 第三者推定値として記録する。月 150 円以内に収めるためレート制限を厳格化。
//
// GOOGLE_DIRECTIONS_API_KEY 未設定 → skip (CI failure にしない)
//
// $5 / 1000 リクエスト = ¥0.75 / 件 (¥1=$0.0067 換算)
// 月 ¥150 上限 → 200 リクエスト / 月
// 1 回の CI 実行で最大 5 リクエストに制限 (週 1 cron なら月 20 件 = ¥15 程度)

const fs = require('fs');
const path = require('path');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const LATEST = path.join(__dirname, '..', 'data', 'test-results', 'latest.json');

const KEY = process.env.GOOGLE_DIRECTIONS_API_KEY || '';
const MAX_REQUESTS_PER_RUN = parseInt(process.env.GOOGLE_MAX_REQUESTS_PER_RUN || '5', 10);
const TIMEOUT_MS = 8000;
const DISAGREE_THRESHOLD = 0.02;   // tier1 と tier2 が 2% 以上違うときだけ Google に聞く

if(!KEY){
  console.log('[tier4] GOOGLE_DIRECTIONS_API_KEY not set — skipping');
  process.exit(0);
}
if(typeof fetch !== 'function'){
  console.log('[tier4] global fetch not available (Node 18+ required) — skipping');
  process.exit(0);
}

async function callGoogleDirections(originLat, originLng, destLat, destLng){
  // mode=driving / waypoints=optimize:true|... を将来的に追加可能
  const url = 'https://maps.googleapis.com/maps/api/directions/json' +
    '?origin=' + originLat + ',' + originLng +
    '&destination=' + destLat + ',' + destLng +
    '&mode=driving&key=' + encodeURIComponent(KEY);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if(!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch(e){
    clearTimeout(t);
    throw e;
  }
}

function googleDistance(resp){
  if(!resp || !resp.routes || !resp.routes[0]) return null;
  const legs = resp.routes[0].legs || [];
  let s = 0;
  for(const l of legs) s += (l.distance && l.distance.value) || 0;
  return s;
}

function readJsonl(file){
  return fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter(l => l.trim().length > 0).map(l => JSON.parse(l));
}

async function main(){
  if(!fs.existsSync(LATEST)){
    console.error('[tier4] latest.json missing - run replay-mm.js first');
    process.exit(2);
  }
  const latest = JSON.parse(fs.readFileSync(LATEST, 'utf8'));
  const tier1 = latest.tiers.tier1_osrm || {};
  const tier1Map = new Map();
  if(tier1.fixtures){
    for(const f of tier1.fixtures) tier1Map.set(f.name, f.osrm_distance_m);
  }

  // どの fixture を Google に問合せるか決定: tier1 と tier2 の差が大きいものを優先
  const candidates = [];
  for(const fix of latest.fixtures){
    const osrm = tier1Map.get(fix.name);
    let diverge = 0;
    if(osrm != null && fix.mm_distance_m > 0){
      diverge = Math.abs(osrm - fix.mm_distance_m) / fix.mm_distance_m;
    } else {
      diverge = Number.POSITIVE_INFINITY;  // OSRM 未取得 → 優先
    }
    candidates.push({ name: fix.name, diverge: diverge });
  }
  candidates.sort((a, b) => b.diverge - a.diverge);
  const targets = candidates.filter(c => c.diverge >= DISAGREE_THRESHOLD)
                            .slice(0, MAX_REQUESTS_PER_RUN);
  if(targets.length === 0){
    latest.tiers.tier4_google = {
      status: 'skipped_no_disagreement',
      ran_at: new Date().toISOString(),
      note: 'tier1 と tier2 の差が ' + (DISAGREE_THRESHOLD * 100) + '% 未満・問合せ不要',
    };
    fs.writeFileSync(LATEST, JSON.stringify(latest, null, 2));
    console.log('[tier4] no disagreement above ' + (DISAGREE_THRESHOLD * 100) + '% — no requests sent');
    return;
  }

  const results = [];
  for(const tgt of targets){
    const file = path.join(FIXTURES_DIR, tgt.name + '.jsonl');
    if(!fs.existsSync(file)) continue;
    const lines = readJsonl(file);
    const gps = lines.slice(1);
    if(gps.length < 2) continue;
    const o = gps[0], d = gps[gps.length - 1];
    try {
      const resp = await callGoogleDirections(o.lat, o.lng, d.lat, d.lng);
      const dist = googleDistance(resp);
      results.push({
        name: tgt.name,
        google_distance_m: dist,
        status: dist != null ? 'ok' : 'no_route',
      });
      console.log('  ' + tgt.name + ': google=' + (dist == null ? 'null' : dist + 'm'));
    } catch(e){
      results.push({ name: tgt.name, status: 'error', error: e.message });
      console.error('  ' + tgt.name + ': ' + e.message);
    }
  }

  latest.tiers.tier4_google = {
    status: 'ok',
    ran_at: new Date().toISOString(),
    requests_sent: targets.length,
    max_requests_per_run: MAX_REQUESTS_PER_RUN,
    disagree_threshold: DISAGREE_THRESHOLD,
    fixtures: results,
  };
  fs.writeFileSync(LATEST, JSON.stringify(latest, null, 2));
  console.log('[tier4] sent ' + targets.length + ' Google Directions requests');
}

main().catch(e => { console.error('[tier4] fatal:', e); process.exit(0); });
