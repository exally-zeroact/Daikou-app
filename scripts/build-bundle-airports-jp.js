#!/usr/bin/env node
/**
 * build-bundle-airports-jp.js
 *
 * KSJ C28-21 (空港) の GeoJSON から全国主要空港を抽出。
 *
 * 出力: data/airports-jp.js  ~30KB
 */

const path = require('path');
const u = require('./bundle-utils.js');

const PROJECT_ROOT = path.join(__dirname, '..');
const TMP = path.join(PROJECT_ROOT, 'tmp', 'bundle-airports');
const OUT = path.join(PROJECT_ROOT, 'data', 'airports-jp.js');
const URL = 'https://nlftp.mlit.go.jp/ksj/gml/data/C28/C28-21/C28-21_GML.zip';

(async () => {
  console.log(`  DL+extract: ${URL}`);
  // Airport.geojson（範囲polygon・108箇所・名称付き C28_005）を採用 → 重心点に変換
  const { features, fileCounts, zipBytes } = await u.loadKsjFeaturesFromZipUrl(URL, TMP, {
    layerFilter: (name) => /^C28-21_Airport\.geojson$/.test(name),
  });
  console.log(`  zip ${(zipBytes/1024).toFixed(1)}KB → features=${features.length}`);
  console.log('  files:', JSON.stringify(fileCounts));

  // KSJ C28 属性コード（製品仕様書 v3.0）:
  //   C28_001: 空港コード(国土交通省)
  //   C28_004: 状態（供用中/休止中/予定）
  //   C28_005: 空港名
  //   C28_011: 空港種別（1=会社管理空港, 2=国管理空港, 3=特定地方管理, 4=地方管理, 5=その他, 6=共用空港）
  const items = [];
  for (const f of features) {
    const props = f.properties || {};
    const name = props.C28_005 || '';
    const status = props.C28_004 || '';
    if (status && /休止|閉鎖/.test(status)) continue; // 休止空港は除外
    const lit = u.representativeLatLng(f.geometry);
    if (!lit || !name) continue;
    items.push({
      lat: lit.lat,
      lng: lit.lng,
      n: name,
      type: parseInt(props.C28_011, 10) || 0,
      code: props.C28_001 || '',
    });
  }

  // 重複排除（同名・近接）
  const dedup = new Map();
  for (const it of items) {
    const key = `${it.n}_${Math.round(it.lat*100)}_${Math.round(it.lng*100)}`;
    if (!dedup.has(key)) dedup.set(key, it);
  }
  const uniq = Array.from(dedup.values());
  console.log(`  raw=${items.length} → dedup=${uniq.length}`);

  if (uniq.length === 0) {
    console.error('❌ no airports parsed');
    process.exit(1);
  }

  // サンプル
  console.log('  sample:', uniq.slice(0, 3).map(x => ({ name: x.n, lat: x.lat.toFixed(3), lng: x.lng.toFixed(3) })));

  const data = u.buildPointBundle(uniq, (it) => {
    const o = {};
    if (it.n) o.n = it.n;
    if (it.code) o.c = it.code;
    if (it.type) o.t = it.type;
    return o;
  });
  data.source = 'KSJ C28-21 (国土交通省・空港)';

  const size = u.writeBundleJs(OUT, 'AIRPORTS_JP', data, [
    `// 出典: 国土数値情報 空港 C28-21（PDL1.0）`,
    `// 全国 ${uniq.length} 件`,
  ]);
  console.log(`✅ ${OUT}`);
  console.log(`  count=${uniq.length} size=${(size/1024).toFixed(2)} KB`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
