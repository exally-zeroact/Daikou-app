#!/usr/bin/env node
/**
 * build-bundle-ports-jp.js
 *
 * KSJ C02-06 (港湾) を shapefile npm で読み込み・全国の港湾を抽出。
 *
 * 出力: data/ports-jp.js
 *
 * KSJ C02 属性:
 *   C02_001: 港湾種別 (1=国際戦略港湾, 2=国際拠点港湾, 3=重要港湾, 4=地方港湾)
 *   C02_005: 港湾名
 *   C02_007: 所在地
 *   C02_010: 取扱品目コード（カンマ区切り）
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const u = require('./bundle-utils.js');

function requireGlobal(name) {
  try {
    return require(name);
  } catch {}
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(root, name));
}
const shapefile = requireGlobal('shapefile');

const PROJECT_ROOT = path.join(__dirname, '..');
const TMP = path.join(PROJECT_ROOT, 'tmp', 'bundle-ports');
const OUT = path.join(PROJECT_ROOT, 'data', 'ports-jp.js');
const URL = 'https://nlftp.mlit.go.jp/ksj/gml/data/C02/C02-06/C02-06_GML.zip';

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const zipPath = path.join(TMP, 'C02-06.zip');

  if (!fs.existsSync(zipPath) || Date.now() - fs.statSync(zipPath).mtimeMs > 30 * 86400000) {
    console.log(`  DL: ${URL}`);
    const buf = await u.fetchBuffer(URL, 60000);
    fs.writeFileSync(zipPath, buf);
  }
  try {
    execSync(`unzip -qo "${zipPath}" -d "${TMP}"`, { stdio: 'pipe' });
  } catch {}

  // PortAndHarbor.shp が港湾の代表点
  const shp = path.join(TMP, 'C02-06-g_PortAndHarbor.shp');
  const dbf = path.join(TMP, 'C02-06-g_PortAndHarbor.dbf');
  if (!fs.existsSync(shp)) {
    console.error('shp not found');
    process.exit(1);
  }

  const items = [];
  const source = await shapefile.open(shp, dbf, { encoding: 'shift-jis' });
  while (true) {
    const r = await source.read();
    if (r.done) break;
    const f = r.value;
    const lit = u.representativeLatLng(f.geometry);
    if (!lit) continue;
    const props = f.properties || {};
    const name = props.C02_005 || '';
    if (!name) continue;
    items.push({
      lat: lit.lat,
      lng: lit.lng,
      n: name,
      type: parseInt(props.C02_001, 10) || 0, // 1=国際戦略, 2=国際拠点, 3=重要, 4=地方
      addr: props.C02_007 || '',
    });
  }

  console.log(`  total: ${items.length} 港湾`);
  console.log('  sample:', { name: items[0].n, type: items[0].type });

  // 種別の分布
  const byType = {};
  for (const it of items) byType[it.type] = (byType[it.type] || 0) + 1;
  console.log('  type分布:', byType, '(1=国際戦略, 2=国際拠点, 3=重要, 4=地方)');

  const data = u.buildPointBundle(items, (it) => {
    const o = {};
    if (it.n) o.n = it.n;
    if (it.type) o.t = it.type;
    return o;
  });
  data.source = 'KSJ C02-06 (国土交通省・港湾)';
  data.license = 'PDL1.0';
  data.typeMap = { 1: '国際戦略港湾', 2: '国際拠点港湾', 3: '重要港湾', 4: '地方港湾' };

  const size = u.writeBundleJs(OUT, 'PORTS_JP', data, [
    `// 出典: 国土数値情報 港湾 C02-06（PDL1.0）`,
    `// 全国 ${items.length} 港湾`,
  ]);
  console.log(`✅ ${OUT}  count=${items.length} size=${(size / 1024).toFixed(2)} KB`);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
