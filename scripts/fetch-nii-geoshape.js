#!/usr/bin/env node
/* eslint-env node */
// scripts/fetch-nii-geoshape.js (= dev tool・新規)
//
// 全 47 県・全市町村の・NII Geoshape topojson を・tmp/nii-geoshape/ に・download。
// addresses-coarse-jp.js の・全 1919 市町村 JIS code を・iter・curl で取得。
// 既存 file (= ALREADY downloaded) は・skip・delta only 取得。
//
// 出典: 国勢調査町丁・字等別境界データセット (CODH 作成) ・CC BY 4.0
// URL pattern: https://geoshape.ex.nii.ac.jp/ka/topojson/2020/{pref2}/r2ka{code5}.topojson
//
// 使い方: node scripts/fetch-nii-geoshape.js [pref_code]
//   省略 → 全 47 県
//   例: node scripts/fetch-nii-geoshape.js 38  (= 愛媛のみ)

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'tmp', 'nii-geoshape');
const COARSE_JS = path.join(ROOT, 'data', 'addresses-coarse-jp.js');

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function loadCityCodes() {
  const sandbox = {};
  const src = fs.readFileSync(COARSE_JS, 'utf8');
  new Function('window', src)(sandbox);
  const coarse = sandbox.ADDRESSES_COARSE_JP;
  const byPref = {};
  coarse.items.forEach((it) => {
    if (!it.c || typeof it.c !== 'string' || it.c.length !== 5) return;
    const prefCode = it.c.substring(0, 2);
    if (!byPref[prefCode]) byPref[prefCode] = [];
    byPref[prefCode].push(it.c);
  });
  return byPref;
}

function fetchUrl(url, outPath) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve({ ok: false, status: res.statusCode });
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        fs.writeFileSync(outPath, buf);
        resolve({ ok: true, size: buf.length });
      });
      res.on('error', () => resolve({ ok: false, status: 'res-error' }));
    });
    req.on('error', () => resolve({ ok: false, status: 'req-error' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 'timeout' });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const onlyPref = args[0];
  const cityByPref = loadCityCodes();
  let totalFetched = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let totalSize = 0;

  for (const prefCode of Object.keys(cityByPref).sort()) {
    if (onlyPref && onlyPref !== prefCode) continue;
    const codes = cityByPref[prefCode];
    let prefFetched = 0;
    let prefSkipped = 0;
    let prefFailed = 0;
    let prefSize = 0;
    for (const code of codes) {
      const outPath = path.join(CACHE_DIR, code + '.topojson');
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
        prefSkipped++;
        prefSize += fs.statSync(outPath).size;
        continue;
      }
      const url =
        'https://geoshape.ex.nii.ac.jp/ka/topojson/2020/' + prefCode + '/r2ka' + code + '.topojson';
      const r = await fetchUrl(url, outPath);
      if (r.ok) {
        prefFetched++;
        prefSize += r.size;
      } else {
        prefFailed++;
        console.log('  ✗ ' + code + ' status=' + r.status);
      }
      // server-side throttle 配慮 (= 100ms 間隔)
      await new Promise((r2) => setTimeout(r2, 100));
    }
    totalFetched += prefFetched;
    totalSkipped += prefSkipped;
    totalFailed += prefFailed;
    totalSize += prefSize;
    console.log(
      '[' +
        prefCode +
        '] cities=' +
        codes.length +
        ' / fetched=' +
        prefFetched +
        ' / skipped=' +
        prefSkipped +
        ' / failed=' +
        prefFailed +
        ' / size=' +
        (prefSize / 1024 / 1024).toFixed(1) +
        'MB'
    );
  }
  console.log('');
  console.log('===== fetch summary =====');
  console.log('total fetched:', totalFetched);
  console.log('total skipped (already):', totalSkipped);
  console.log('total failed:', totalFailed);
  console.log('total size:', (totalSize / 1024 / 1024).toFixed(1), 'MB');
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('[fetch] FATAL:', e && (e.stack || e.message));
      process.exit(1);
    });
}
