#!/usr/bin/env node
/**
 * build-bundle-stations-jp.js
 *
 * KSJ N02-22 (鉄道) の Station レイヤから全国の駅を抽出。
 *
 * 出力: data/stations-jp.js  ~300KB
 */

const path = require('path');
const u = require('./bundle-utils.js');

const PROJECT_ROOT = path.join(__dirname, '..');
const TMP = path.join(PROJECT_ROOT, 'tmp', 'bundle-stations');
const OUT = path.join(PROJECT_ROOT, 'data', 'stations-jp.js');
const URL = 'https://nlftp.mlit.go.jp/ksj/gml/data/N02/N02-22/N02-22_GML.zip';

(async () => {
  console.log(`  DL+extract: ${URL}`);
  const { features, fileCounts, zipBytes } = await u.loadKsjFeaturesFromZipUrl(URL, TMP, {
    layerFilter: (name) => /Station/.test(name),
  });
  console.log(`  zip ${(zipBytes/1024).toFixed(1)}KB → features=${features.length}`);
  console.log('  files:', JSON.stringify(fileCounts));

  // KSJ N02 駅レイヤ属性（製品仕様書 v3.0）:
  //   N02_001: 鉄道事業者種別 (11=新幹線, 12=JR在来, 13=公営, 14=民鉄, 15=第3セクター, 16=モノレール...)
  //   N02_002: 路線名
  //   N02_003: 運営会社
  //   N02_004: 駅名 ← これ
  //   N02_005: 駅種別
  //   N02_005c: 駅コード
  const items = [];
  const sample = [];
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const props = f.properties || {};
    const name = props.N02_005 || props.N02_004 || '';
    if (!name) continue;
    const lit = u.representativeLatLng(f.geometry);
    if (!lit) continue;
    if (i < 3) sample.push({ name, props_keys: Object.keys(props) });
    items.push({
      lat: lit.lat,
      lng: lit.lng,
      n: name,
      // 路線名・運営会社（短縮表示用）
      line: props.N02_003 || '',
      operator: props.N02_004 || '',
      // 鉄道種別（1byte 数値で保存）
      type: parseInt(props.N02_001, 10) || 0,
    });
  }
  console.log('  sample:', JSON.stringify(sample, null, 2));
  console.log(`  raw=${items.length}`);

  // 重複排除（同名駅・近接10m）
  const dedup = new Map();
  for (const it of items) {
    const key = `${it.n}_${Math.round(it.lat*1000)}_${Math.round(it.lng*1000)}`;
    if (!dedup.has(key)) dedup.set(key, it);
  }
  const uniq = Array.from(dedup.values());
  console.log(`  dedup=${uniq.length}`);

  if (uniq.length === 0) {
    console.error('❌ no stations parsed - inspect features');
    if (features[0]) console.error('  feature[0]:', JSON.stringify(features[0]).slice(0, 500));
    process.exit(1);
  }

  const data = u.buildPointBundle(uniq, (it) => {
    const o = { n: it.n };
    if (it.line) o.l = it.line;
    if (it.type) o.t = it.type;
    return o;
  });
  data.source = 'KSJ N02-22 (国土交通省・鉄道)';

  const size = u.writeBundleJs(OUT, 'STATIONS_JP', data, [
    `// 出典: 国土数値情報 鉄道 N02-22（PDL1.0）`,
    `// 全国 ${uniq.length} 駅`,
  ]);
  console.log(`✅ ${OUT}`);
  console.log(`  count=${uniq.length} size=${(size/1024).toFixed(2)} KB`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
