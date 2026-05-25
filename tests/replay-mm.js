#!/usr/bin/env node
'use strict';

// tests/replay-mm.js
// fixtures/*.jsonl を全て再生して mm_distance_m / snap_rate を出力する
// 出力: data/test-results/latest.json (test-dashboard.html がこれを fetch)
//
// 使い方:
//   node tests/replay-mm.js
//   node tests/replay-mm.js --fixture synthetic-straight-1km
//
// CI / 端末側 Wi-Fi 自動 push のいずれからも同じ JSON を生成する。

const fs = require('fs');
const path = require('path');
const { snapToPolyline, calcRoadDistance } = require('./lib/snap');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const OUT_DIR = path.join(__dirname, '..', 'data', 'test-results');
const OUT_LATEST = path.join(OUT_DIR, 'latest.json');
const HISTORY_FILE = path.join(OUT_DIR, 'history.json');

const MM_GAP_RESET_SEC = 5;
const MM_MAX_SEGMENT_DIST_M = 1000;
const MM_MAX_SNAP_DIST_M = 50;

function readJsonl(file) {
  const txt = fs.readFileSync(file, 'utf8');
  return txt
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

function replayFixture(file) {
  const lines = readJsonl(file);
  const meta = lines[0];
  const gps = lines.slice(1);
  const roads = meta.roads;

  let totalCount = 0,
    snapCount = 0,
    skipCount = 0,
    mmDistance = 0;
  let layerHits = 0,
    layerChecks = 0;
  let prevSnap = null;
  const issues = [];

  const t0 = Date.now();
  for (const p of gps) {
    totalCount++;
    const snap = snapToPolyline(roads, p.lat, p.lng, { maxDistM: MM_MAX_SNAP_DIST_M });
    if (!snap) {
      prevSnap = null;
      continue;
    }
    snapCount++;
    if (meta.expected_layer != null) {
      layerChecks++;
      if (snap.layer === meta.expected_layer) layerHits++;
    }
    if (prevSnap) {
      const dtSec = (p.timestamp - prevSnap.timestamp) / 1000;
      if (dtSec > MM_GAP_RESET_SEC) {
        prevSnap = Object.assign({}, snap, { timestamp: p.timestamp });
        continue;
      }
      const r = calcRoadDistance(roads, prevSnap, snap);
      if (r && r.distanceM >= 0 && r.distanceM <= MM_MAX_SEGMENT_DIST_M) {
        mmDistance += r.distanceM;
      } else {
        skipCount++;
      }
    }
    prevSnap = Object.assign({}, snap, { timestamp: p.timestamp });
  }
  const elapsedMs = Date.now() - t0;

  const expected = meta.expected_distance_m;
  const der = expected > 0 ? Math.abs(mmDistance - expected) / expected : 0;
  if (meta.expected_layer != null && layerChecks > 0) {
    const layerErrors = layerChecks - layerHits;
    if (layerErrors > 0) {
      issues.push({
        ja: '高架/地上の取り違えが' + layerErrors + '件',
        en: 'layer mismatch ' + layerErrors,
      });
    }
  }
  if (der > 0.01) {
    issues.push({
      ja: meta.name + ' で誤差 ' + (der * 100).toFixed(2) + '%',
      en: meta.name + ' DER ' + (der * 100).toFixed(2) + '%',
    });
  }

  return {
    name: meta.name,
    description: meta.description || '',
    expected_distance_m: expected,
    mm_distance_m: +mmDistance.toFixed(2),
    distance_error_m: +(mmDistance - expected).toFixed(2),
    distance_error_ratio: +der.toFixed(5),
    total_count: totalCount,
    snap_count: snapCount,
    snap_rate: totalCount > 0 ? +(snapCount / totalCount).toFixed(4) : 0,
    skip_count: skipCount,
    layer_check_count: layerChecks,
    layer_hit_count: layerHits,
    elapsed_ms: elapsedMs,
    issues: issues,
  };
}

function main() {
  const argv = process.argv.slice(2);
  let onlyName = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fixture' && argv[i + 1]) onlyName = argv[++i];
  }

  if (!fs.existsSync(FIXTURES_DIR)) {
    console.error('[replay] fixtures dir missing:', FIXTURES_DIR);
    console.error('[replay] run: node tests/lib/generate-fixtures.js');
    process.exit(2);
  }
  const files = fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .filter((f) => onlyName == null || f.indexOf(onlyName) >= 0)
    .sort();
  if (files.length === 0) {
    console.error('[replay] no fixtures matched');
    process.exit(2);
  }

  const results = [];
  for (const f of files) {
    const r = replayFixture(path.join(FIXTURES_DIR, f));
    console.log(
      '  ' +
        r.name +
        ': mm=' +
        r.mm_distance_m +
        'm exp=' +
        r.expected_distance_m +
        'm DER=' +
        (r.distance_error_ratio * 100).toFixed(2) +
        '%' +
        ' snap=' +
        (r.snap_rate * 100).toFixed(1) +
        '%'
    );
    results.push(r);
  }

  const sumExpected = results.reduce((s, r) => s + r.expected_distance_m, 0);
  const sumMM = results.reduce((s, r) => s + r.mm_distance_m, 0);
  const totalSnap = results.reduce((s, r) => s + r.snap_count, 0);
  const totalCount = results.reduce((s, r) => s + r.total_count, 0);
  const allIssues = [];
  for (const r of results) for (const it of r.issues) allIssues.push(it);

  const summary = {
    snap_rate_overall: totalCount > 0 ? +(totalSnap / totalCount).toFixed(4) : 0,
    distance_error_ratio_overall:
      sumExpected > 0 ? +(Math.abs(sumMM - sumExpected) / sumExpected).toFixed(5) : 0,
    mm_distance_total_m: +sumMM.toFixed(2),
    expected_distance_total_m: +sumExpected.toFixed(2),
    fixture_count: results.length,
    total_gps_points: totalCount,
  };

  // tier 結果は将来 tier1-osrm.js / tier4-google.js が更新する場所
  const out = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    git_sha: process.env.GITHUB_SHA || process.env.GIT_SHA || null,
    git_ref: process.env.GITHUB_REF_NAME || null,
    runner: process.env.GITHUB_RUN_ID ? 'github-actions' : 'local',
    summary: summary,
    fixtures: results,
    tiers: {
      tier1_osrm: { status: 'not_run', note: 'weekly cron / set OSRM_ENDPOINT secret' },
      tier2_self: {
        status: 'ok',
        note: 'replay-mm.js (this run)',
        der: summary.distance_error_ratio_overall,
      },
      tier4_google: {
        status: 'not_run',
        note: 'monthly limited / set GOOGLE_DIRECTIONS_API_KEY secret',
      },
    },
    issues: allIssues,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_LATEST, JSON.stringify(out, null, 2));

  // history.json: 直近 10 件のみ保持
  let history = [];
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    } catch (_) {}
  }
  history.push({
    generated_at: out.generated_at,
    git_sha: out.git_sha,
    snap_rate: summary.snap_rate_overall,
    der: summary.distance_error_ratio_overall,
  });
  if (history.length > 10) history = history.slice(history.length - 10);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));

  console.log('[replay] wrote ' + OUT_LATEST);
  console.log(
    '[replay] overall snap_rate=' +
      (summary.snap_rate_overall * 100).toFixed(2) +
      '% DER=' +
      (summary.distance_error_ratio_overall * 100).toFixed(3) +
      '%'
  );
}

if (require.main === module) main();
module.exports = { replayFixture };
