#!/usr/bin/env node
/**
 * build-bundle-peaks-jp.js
 *
 * 全国の山頂・火山・峠 (name 付き) を Overpass API から取得し
 * data/peaks-jp.js に出力。
 *
 *   natural=peak       kind 0
 *   natural=volcano    kind 1
 *   mountain_pass=yes  kind 2
 *
 * 約 13,700 件 ・ ~540 KB を見込む
 */
const fs = require('fs');
const path = require('path');
const u = require('./bundle-utils.js');

const PROJECT_ROOT = path.join(__dirname, '..');
const TMP = path.join(PROJECT_ROOT, 'tmp');
const OUT = path.join(PROJECT_ROOT, 'data', 'peaks-jp.js');
const CACHE = path.join(TMP, 'peaks-overpass.json');

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const QUERY =
  '[out:json][timeout:300];' +
  'area["ISO3166-1"="JP"][admin_level=2]->.jp;' +
  '(' +
  'node["natural"="peak"]["name"](area.jp);' +
  'node["natural"="volcano"]["name"](area.jp);' +
  'node["mountain_pass"="yes"]["name"](area.jp);' +
  ');' +
  'out;';

async function fetchOverpass() {
  let lastErr = null;
  for (const ep of ENDPOINTS) {
    try {
      console.log(`  POST ${ep}`);
      const t0 = Date.now();
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 300000);
      try {
        const res = await fetch(ep, {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'User-Agent': 'Daikou-app-test/0.1',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'data=' + encodeURIComponent(QUERY),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const json = await res.json();
        console.log(
          `  got elements=${(json.elements || []).length} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`
        );
        return json;
      } finally {
        clearTimeout(t);
      }
    } catch (err) {
      console.log(`  failed: ${err.message}`);
      lastErr = err;
    }
  }
  throw lastErr || new Error('all overpass endpoints failed');
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });

  let json;
  if (fs.existsSync(CACHE) && Date.now() - fs.statSync(CACHE).mtimeMs < 7 * 86400000) {
    console.log(`  cache: ${CACHE}`);
    json = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  } else {
    json = await fetchOverpass();
    fs.writeFileSync(CACHE, JSON.stringify(json));
  }

  const items = [];
  const stats = { peak: 0, volcano: 0, pass: 0, withEle: 0 };
  for (const el of json.elements || []) {
    if (el.type !== 'node') continue;
    const tags = el.tags || {};
    const name = (tags.name || '').trim();
    if (!name) continue;
    let kind = -1;
    if (tags.natural === 'volcano') {
      kind = 1;
      stats.volcano++;
    } else if (tags.mountain_pass === 'yes') {
      kind = 2;
      stats.pass++;
    } else if (tags.natural === 'peak') {
      kind = 0;
      stats.peak++;
    } else continue;
    if (typeof el.lat !== 'number' || typeof el.lon !== 'number') continue;
    const ele = parseInt(tags.ele, 10);
    const validEle = !isNaN(ele) && ele >= -500 && ele <= 4000;
    if (validEle) stats.withEle++;
    items.push({
      lat: el.lat,
      lng: el.lon,
      n: name,
      k: kind,
      e: validEle ? ele : null,
    });
  }

  console.log(
    `  parsed: peak=${stats.peak} volcano=${stats.volcano} pass=${stats.pass} (ele 付き ${stats.withEle})`
  );

  if (items.length === 0) {
    console.error('❌ no peaks parsed');
    process.exit(1);
  }

  const data = u.buildPointBundle(items, (it) => {
    const o = {};
    if (it.n) o.n = it.n;
    if (it.k) o.k = it.k; // peak (0) はデフォルト・省略
    if (it.e != null) o.e = it.e;
    return o;
  });
  data.source = 'OpenStreetMap (ODbL) natural=peak / natural=volcano / mountain_pass=yes';
  data.kindLegend = { 0: 'peak', 1: 'volcano', 2: 'mountain_pass' };

  const size = u.writeBundleJs(OUT, 'PEAKS_JP', data, [
    `// 出典: OpenStreetMap (ODbL)`,
    `// 内訳: peak ${stats.peak} / volcano ${stats.volcano} / mountain_pass ${stats.pass}`,
    `// 全国 ${items.length} 件 (ele 付き ${stats.withEle})`,
  ]);
  console.log(`✅ ${OUT}  count=${items.length} size=${(size / 1024).toFixed(2)} KB`);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
