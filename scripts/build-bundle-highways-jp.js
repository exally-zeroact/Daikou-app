#!/usr/bin/env node
/**
 * build-bundle-highways-jp.js
 *
 * KSJ N06-22 (高速道路時系列) から IC/JCT/SAPA を抽出。
 *
 * 出力: data/highways-jp.js  ~250KB
 */

const path = require('path');
const u = require('./bundle-utils.js');

const PROJECT_ROOT = path.join(__dirname, '..');
const TMP = path.join(PROJECT_ROOT, 'tmp', 'bundle-highways');
const OUT = path.join(PROJECT_ROOT, 'data', 'highways-jp.js');
const URL = 'https://nlftp.mlit.go.jp/ksj/gml/data/N06/N06-22/N06-22_GML.zip';

(async () => {
  console.log(`  DL+extract: ${URL}`);
  // N06_Joint = IC/JCT/SAPA の点データ・2435件
  const { features, fileCounts, zipBytes } = await u.loadKsjFeaturesFromZipUrl(URL, TMP, {
    layerFilter: (name) => /Joint/.test(name),
  });
  console.log(`  zip ${(zipBytes / 1024).toFixed(1)}KB → features=${features.length}`);
  console.log('  files:', JSON.stringify(fileCounts));

  // KSJ N06 Joint レイヤ属性:
  //   N06_012: 開始年
  //   N06_013: 供用開始年
  //   N06_014: 廃止年（9999=継続中）
  //   N06_015: 路線コード
  //   N06_018: 施設名
  //   N06_019: 種別 (1=IC, 2=JCT, 3=SA, 4=PA, 5=BS, 6=TB, 7=TG, 8=その他)
  const items = [];
  for (const f of features) {
    const props = f.properties || {};
    const name = props.N06_018 || '';
    const closeYear = parseInt(props.N06_014, 10) || 9999;
    if (!name || closeYear < 9999) continue; // 廃止施設はスキップ
    const lit = u.representativeLatLng(f.geometry);
    if (!lit) continue;
    items.push({
      lat: lit.lat,
      lng: lit.lng,
      n: name,
      type: parseInt(props.N06_019, 10) || 0,
      route: props.N06_015 || '',
    });
  }

  // サンプル
  if (items[0]) console.log('  sample[0]:', JSON.stringify({ ...items[0], _props: undefined }));
  console.log(`  raw=${items.length}`);

  // 重複排除（同名・近接10m・最新年度残し）
  const dedup = new Map();
  for (const it of items) {
    const key = `${it.n}_${Math.round(it.lat * 1000)}_${Math.round(it.lng * 1000)}`;
    const ex = dedup.get(key);
    if (!ex || it.year > ex.year) dedup.set(key, it);
  }
  const uniq = Array.from(dedup.values());
  console.log(`  dedup=${uniq.length}`);

  if (uniq.length === 0) {
    console.error('❌ no highway features parsed');
    if (features[0]) console.error('  raw feature:', JSON.stringify(features[0]).slice(0, 500));
    process.exit(1);
  }

  const data = u.buildPointBundle(uniq, (it) => {
    const o = { n: it.n };
    if (it.route) o.r = it.route;
    if (it.type) o.t = it.type;
    return o;
  });
  data.source = 'KSJ N06-22 (国土交通省・高速道路時系列)';

  const size = u.writeBundleJs(OUT, 'HIGHWAYS_JP', data, [
    `// 出典: 国土数値情報 高速道路時系列 N06-22（PDL1.0）`,
    `// IC/JCT/SAPA ${uniq.length} 件`,
  ]);
  console.log(`✅ ${OUT}`);
  console.log(`  count=${uniq.length} size=${(size / 1024).toFixed(2)} KB`);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
