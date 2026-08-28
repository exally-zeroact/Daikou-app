#!/usr/bin/env node
'use strict';

// tests/tier1-osrm.js
// 全 fixture を OSRM /match に投げて mm_distance との差を取る
// OSRM_ENDPOINT 未設定 → 何もせず exit 0 (CI failure にしない)
//
// .github/workflows/mm-regression.yml の cron job から呼ばれる
// 出力: data/test-results/latest.json の tiers.tier1_osrm を更新

const fs = require('fs');
const path = require('path');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const LATEST = path.join(__dirname, '..', 'data', 'test-results', 'latest.json');

const ENDPOINT = (process.env.OSRM_ENDPOINT || '').replace(/\/+$/, '');
const TIMEOUT_MS = 8000;
const PROFILE = process.env.OSRM_PROFILE || 'driving';

// ★2026-08-28（指示役）★ 外の物が要る見張りは ★正しい★。ただし ★黙って緑にしない★。
//   「skipping (no failure)」＝★読む人には 合格に見えます★。
//   ⇒ ★★未測定★★ と はっきり書く／★何本 未測定かを 数えられる形で出す★。
//   ⇒ 0件と未測定を 混ぜない（全アプリ共通・2026-08-28）
if (!ENDPOINT) {
  console.log('[tier1] ★未測定★ OSRM_ENDPOINT が 設定されていません（外のサービスが要ります）');
  console.log('[tier1] MISOKUTEI=1 reason=OSRM_ENDPOINT-not-set');
  console.log('  ⇒「測っていない」であって「異常なし」ではありません。');
  process.exit(0);
}
if (typeof fetch !== 'function') {
  console.log('[tier1] ★未測定★ この Node には fetch が在りません（Node 18以上が要ります）');
  console.log('[tier1] MISOKUTEI=1 reason=no-fetch');
  process.exit(0);
}

async function callOsrmMatch(coords) {
  // OSRM /match: lng,lat;lng,lat;...
  // GET /match/v1/{profile}/{coords}?overview=false&geometries=geojson
  const coordStr = coords.map((c) => c[1].toFixed(6) + ',' + c[0].toFixed(6)).join(';');
  const url =
    ENDPOINT +
    '/match/v1/' +
    PROFILE +
    '/' +
    coordStr +
    '?overview=false&annotations=distance&tidy=true';
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

function readJsonl(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

function totalDistance(matchResp) {
  if (!matchResp || !matchResp.matchings) return null;
  let s = 0;
  for (const m of matchResp.matchings) s += m.distance || 0;
  return s;
}

async function main() {
  const files = fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();
  const results = [];
  let okCount = 0,
    failCount = 0,
    skipCount = 0;
  let sumDaikou = 0,
    sumOsrm = 0;

  for (const f of files) {
    const lines = readJsonl(path.join(FIXTURES_DIR, f));
    const meta = lines[0];
    const gps = lines.slice(1);
    // OSRM /match は座標数が多すぎると拒否するので 100 点までに間引く
    const stride = Math.max(1, Math.floor(gps.length / 100));
    const coords = [];
    for (let i = 0; i < gps.length; i += stride) coords.push([gps[i].lat, gps[i].lng]);
    if (coords[coords.length - 1] !== gps[gps.length - 1]) {
      coords.push([gps[gps.length - 1].lat, gps[gps.length - 1].lng]);
    }
    try {
      const resp = await callOsrmMatch(coords);
      const dOsrm = totalDistance(resp);
      if (dOsrm == null) {
        results.push({ name: meta.name, status: 'no_match', osrm_distance_m: null });
        skipCount++;
        continue;
      }
      results.push({
        name: meta.name,
        status: 'ok',
        osrm_distance_m: +dOsrm.toFixed(2),
        expected_distance_m: meta.expected_distance_m,
        der_vs_expected: +(
          Math.abs(dOsrm - meta.expected_distance_m) / meta.expected_distance_m
        ).toFixed(5),
      });
      sumOsrm += dOsrm;
      sumDaikou += meta.expected_distance_m;
      okCount++;
      console.log(
        '  ' +
          meta.name +
          ': osrm=' +
          dOsrm.toFixed(1) +
          'm expected=' +
          meta.expected_distance_m +
          'm'
      );
    } catch (e) {
      results.push({ name: meta.name, status: 'error', error: e.message });
      failCount++;
      console.error('  ' + meta.name + ': ' + e.message);
    }
  }

  if (!fs.existsSync(LATEST)) {
    console.error('[tier1] latest.json missing - run replay-mm.js first');
    process.exit(2);
  }
  const latest = JSON.parse(fs.readFileSync(LATEST, 'utf8'));
  const overallDer = sumDaikou > 0 ? Math.abs(sumOsrm - sumDaikou) / sumDaikou : 0;
  latest.tiers.tier1_osrm = {
    status: okCount > 0 ? 'ok' : failCount > 0 ? 'error' : 'no_data',
    endpoint: ENDPOINT,
    profile: PROFILE,
    ran_at: new Date().toISOString(),
    fixture_count: files.length,
    ok_count: okCount,
    fail_count: failCount,
    skip_count: skipCount,
    der_overall: +overallDer.toFixed(5),
    fixtures: results,
  };
  fs.writeFileSync(LATEST, JSON.stringify(latest, null, 2));
  console.log(
    '[tier1] updated latest.json (ok=' + okCount + ' fail=' + failCount + ' skip=' + skipCount + ')'
  );
}

main().catch((e) => {
  console.error('[tier1] fatal:', e);
  process.exit(0);
}); // 失敗しても CI fail にしない
