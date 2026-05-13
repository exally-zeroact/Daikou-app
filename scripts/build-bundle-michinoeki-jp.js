#!/usr/bin/env node
/**
 * build-bundle-michinoeki-jp.js
 *
 * 道の駅 (KSJ P35-2018) を G空間情報センター CKAN API 経由で47県分取得・統合。
 *
 * フロー:
 *   1. CKAN package_show?id=ksj-p35-{NN} で resource UUID を解決
 *   2. UUID URL から GeoJSON DL
 *   3. 47県分を集約して bundle 化
 *
 * 出力: data/michinoeki-jp.js  ~150KB
 */

const fs = require('fs');
const path = require('path');
const u = require('./bundle-utils.js');

const PROJECT_ROOT = path.join(__dirname, '..');
const OUT = path.join(PROJECT_ROOT, 'data', 'michinoeki-jp.js');
const TMP = path.join(PROJECT_ROOT, 'tmp', 'bundle-michinoeki');

(async () => {
  fs.mkdirSync(TMP, { recursive: true });

  const allItems = [];
  let prefsOk = 0, prefsFail = 0;

  for (let i = 1; i <= 47; i++) {
    const code = String(i).padStart(2, '0');
    const cacheFile = path.join(TMP, `p35_18_${code}.geojson`);

    let geojsonText;
    if (fs.existsSync(cacheFile) && (Date.now() - fs.statSync(cacheFile).mtimeMs) < 30 * 86400000) {
      geojsonText = fs.readFileSync(cacheFile, 'utf8');
    } else {
      try {
        // 1. CKAN API で resource URL を取得
        const apiUrl = `https://www.geospatial.jp/ckan/api/3/action/package_show?id=ksj-p35-${code}`;
        const apiResp = await u.fetchText(apiUrl, 20000);
        const api = JSON.parse(apiResp);
        const resources = api.result && api.result.resources || [];
        const geojsonRes = resources.find(r => /geojson/i.test(r.format) || /\.geojson$/i.test(r.url));
        if (!geojsonRes) {
          console.log(`  ⚠️ pref=${code}: GeoJSON resource なし`);
          prefsFail++;
          continue;
        }
        // 2. GeoJSON DL
        geojsonText = await u.fetchText(geojsonRes.url, 30000);
        fs.writeFileSync(cacheFile, geojsonText);
      } catch (e) {
        console.log(`  ⚠️ pref=${code}: ${e.message}`);
        prefsFail++;
        continue;
      }
    }

    // パース
    let fc;
    try { fc = JSON.parse(geojsonText); } catch { prefsFail++; continue; }
    if (!Array.isArray(fc.features)) { prefsFail++; continue; }

    // CKAN 公開 P35 GeoJSON は日本語プロパティ
    //   "道の駅名", "都道府県名", "市町村名", "緯度", "経度", + 各種設備有無 (1=有, 2=無)
    for (const f of fc.features) {
      const lit = u.representativeLatLng(f.geometry);
      if (!lit) continue;
      const props = f.properties || {};
      const name = props['道の駅名'] || props.P35_001 || props.name || '';
      if (!name) continue;
      const facilities = [];
      // 重要な設備: ATM(1), レストラン(1), 宿泊(1), 温泉(1), GS(1), EV充電(1), トイレ(1)
      if (props['ATM有無'] === 1)         facilities.push('atm');
      if (props['レストラン有無'] === 1)  facilities.push('rest');
      if (props['宿泊施設有無'] === 1)    facilities.push('hotel');
      if (props['温泉施設有無'] === 1)    facilities.push('onsen');
      if (props['ガソリンスタンド有無'] === 1) facilities.push('gs');
      if (props['EV充電施設有無'] === 1)  facilities.push('ev');
      if (props['身障者トイレ有無'] === 1) facilities.push('btoilet');
      allItems.push({
        lat: lit.lat,
        lng: lit.lng,
        n: name,
        pref: props['都道府県名'] || '',
        city: props['市町村名'] || '',
        f: facilities,
      });
    }
    prefsOk++;
  }

  console.log(`\n  prefs OK: ${prefsOk} / 47 / fail: ${prefsFail}`);
  console.log(`  total: ${allItems.length} 道の駅`);

  // 重複除去（同名・近接10m）
  const dedup = new Map();
  for (const it of allItems) {
    const key = `${it.n}_${Math.round(it.lat*1000)}_${Math.round(it.lng*1000)}`;
    if (!dedup.has(key)) dedup.set(key, it);
  }
  const uniq = Array.from(dedup.values());
  console.log(`  dedup: ${uniq.length}`);

  if (uniq.length === 0) {
    console.error('❌ no michinoeki data fetched');
    process.exit(1);
  }
  console.log('  sample:', { name: uniq[0].n, addr: uniq[0].addr });

  const data = u.buildPointBundle(uniq, (it) => {
    const o = {};
    if (it.n) o.n = it.n;
    if (it.f && it.f.length) o.f = it.f;
    return o;
  });
  data.source = 'KSJ P35-2018 (国土交通省・道の駅) via G空間情報センター CKAN';
  data.license = 'PDL1.0';

  const size = u.writeBundleJs(OUT, 'MICHINOEKI_JP', data, [
    `// 出典: 国土数値情報 道の駅 P35-2018（PDL1.0）via G空間情報センター CKAN`,
    `// 全国 ${uniq.length} 箇所`,
  ]);
  console.log(`✅ ${OUT}  count=${uniq.length} size=${(size/1024).toFixed(2)} KB`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
