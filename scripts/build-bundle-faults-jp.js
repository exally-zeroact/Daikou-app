#!/usr/bin/env node
/**
 * build-bundle-faults-jp.js
 *
 * 産総研活断層DB を ArcGIS REST API 経由で取得して faults-jp.js を生成。
 *
 * 出典: 政府機関オープンデータポータル「活断層（産総研）」
 *   https://national-government.esrij.com/datasets/3b864245a55a44bf9c5b3d655f29b209
 * Feature Service:
 *   https://services3.arcgis.com/PI6kZkOcyJG3voe2/arcgis/rest/services/活断層/FeatureServer/1
 * ライセンス: 政府標準利用規約2.0 (CC-BY 4.0互換・商用OK)
 *
 * 出力: data/faults-jp.js
 */

const fs = require('fs');
const path = require('path');
const u = require('./bundle-utils.js');

const PROJECT_ROOT = path.join(__dirname, '..');
const OUT = path.join(PROJECT_ROOT, 'data', 'faults-jp.js');
const BASE =
  'https://services3.arcgis.com/PI6kZkOcyJG3voe2/arcgis/rest/services/%E6%B4%BB%E6%96%AD%E5%B1%A4/FeatureServer/1/query';

(async () => {
  // GeoJSON で全件取得（maxRecordCount=2000・件数 18 なので 1 回で取れる）
  const url = `${BASE}?where=1%3D1&outFields=*&f=geojson&resultRecordCount=2000`;
  console.log(`  fetching: ${url}`);
  const text = await u.fetchText(url, 60000);
  const fc = JSON.parse(text);
  console.log(`  features: ${fc.features.length}`);

  // 各 feature のジオメトリは LineString or MultiLineString
  // properties: Name (識別子), Snippet, PopupInfo（HTML・断層名含む）
  const PRECISION = u.PRECISION;
  const out = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    const props = f.properties || {};
    const name = props.Name || '';
    // PopupInfo に活断層名が HTML で入っている可能性があるので簡易抽出
    let displayName = name;
    if (props.PopupInfo) {
      const m = props.PopupInfo.match(/<td[^>]*>([^<]+断層[^<]*)<\/td>/);
      if (m) displayName = m[1].trim();
    }

    const lines =
      g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const line of lines) {
      if (line.length < 2) continue;
      const intPts = line.map(([lng, lat]) => [
        Math.round(lat * PRECISION),
        Math.round(lng * PRECISION),
      ]);
      out.push({
        n: displayName,
        line: u.encodeLineB64(intPts),
        pts: intPts.length,
      });
    }
  }

  console.log(`  faults: ${out.length} (uniq=${new Set(out.map((x) => x.n)).size})`);

  const data = {
    v: 1,
    generated: new Date().toISOString(),
    precision: PRECISION,
    faults: out.map((x) => ({ n: x.n, line: x.line })),
    source: '産総研活断層データベース ＜政府標準利用規約第2.0版＞ via ESRI Japan',
    license: '政府標準利用規約2.0（CC-BY 4.0互換）',
  };

  const size = u.writeBundleJs(OUT, 'FAULTS_JP', data, [
    `// 出典: 産総研 活断層データベース（政府標準利用規約2.0 / CC-BY 4.0互換）`,
    `// 取得元: ArcGIS Feature Service ${BASE.split('?')[0]}`,
    `// 主要活断層帯 ${out.length} ライン`,
  ]);
  console.log(`✅ ${OUT}  count=${out.length} size=${(size / 1024).toFixed(2)} KB`);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
