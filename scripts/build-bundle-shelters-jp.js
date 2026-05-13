#!/usr/bin/env node
/**
 * build-bundle-shelters-jp.js
 *
 * KSJ P20-12 (避難施設) 47県分から指定避難施設を取得・統合。
 * shapefile npm パッケージで .shp + .dbf を読む（Shift-JIS encoding 対応）。
 *
 * 出力: data/shelters-jp.js
 *
 * P20-12 属性（KSJ 仕様書 v1.0）:
 *   P20_001: 行政区域コード
 *   P20_002: 施設名
 *   P20_003: 所在地
 *   P20_004: 施設種別
 *   P20_005: 収容人数
 *   P20_006: 建物面積
 *   P20_007〜012: 対応災害bitmap (洪水/崖崩れ/高潮/地震/津波/大火事)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const u = require('./bundle-utils.js');

// グローバル shapefile npm を解決
function requireGlobal(name) {
  try { return require(name); } catch {}
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(root, name));
}
const shapefile = requireGlobal('shapefile');

const PROJECT_ROOT = path.join(__dirname, '..');
const TMP = path.join(PROJECT_ROOT, 'tmp', 'bundle-shelters');
const OUT = path.join(PROJECT_ROOT, 'data', 'shelters-jp.js');
const VERSION = 'P20-12';

(async () => {
  fs.mkdirSync(TMP, { recursive: true });

  const items = [];
  let prefsOk = 0, prefsFail = 0;

  for (let i = 1; i <= 47; i++) {
    const code = String(i).padStart(2, '0');
    const url = `https://nlftp.mlit.go.jp/ksj/gml/data/P20/${VERSION}/${VERSION}_${code}_GML.zip`;
    const zipPath = path.join(TMP, `${code}.zip`);

    if (!fs.existsSync(zipPath) || (Date.now() - fs.statSync(zipPath).mtimeMs) > 30*86400000) {
      try {
        const buf = await u.fetchBuffer(url, 60000);
        fs.writeFileSync(zipPath, buf);
      } catch (e) {
        console.warn(`  ⚠️ pref=${code}: DL失敗`);
        prefsFail++;
        continue;
      }
    }

    const ext = path.join(TMP, code);
    fs.mkdirSync(ext, { recursive: true });
    try { execSync(`unzip -qo "${zipPath}" -d "${ext}"`, { stdio: 'pipe' }); } catch {}

    // .shp ファイルを探す
    const shps = u.findFiles(ext, /\.shp$/i);
    if (shps.length === 0) { prefsFail++; continue; }
    const shp = shps[0];
    const dbf = shp.replace(/\.shp$/i, '.dbf');

    let prefCount = 0;
    try {
      const source = await shapefile.open(shp, dbf, { encoding: 'shift-jis' });
      while (true) {
        const r = await source.read();
        if (r.done) break;
        const f = r.value;
        const lit = u.representativeLatLng(f.geometry);
        if (!lit) continue;
        const props = f.properties || {};
        const name = props.P20_002 || '';
        if (!name) continue;
        // 災害種別 bitmap (1=対応, それ以外=非対応)
        let kinds = 0;
        if (props.P20_007 === 1) kinds |= 1<<1; // 洪水
        if (props.P20_008 === 1) kinds |= 1<<2; // 崖崩れ
        if (props.P20_009 === 1) kinds |= 1<<4; // 高潮
        if (props.P20_010 === 1) kinds |= 1<<0; // 地震
        if (props.P20_011 === 1) kinds |= 1<<3; // 津波
        if (props.P20_012 === 1) kinds |= 1<<5; // 大火事
        items.push({
          lat: lit.lat,
          lng: lit.lng,
          n: name,
          k: kinds,
          // 収容人数 (P20_005) で重要度判別可
          cap: props.P20_005 || 0,
        });
        prefCount++;
      }
    } catch (e) {
      console.warn(`  ⚠️ pref=${code}: shapefile parse失敗 ${e.message}`);
      prefsFail++;
      continue;
    }
    prefsOk++;
    if (i === 1 || i % 10 === 0 || i === 47) {
      console.log(`  pref ${code}: ${prefCount} 施設 (累計 ${items.length})`);
    }
  }

  console.log(`\n  prefs OK: ${prefsOk} / 47 / fail: ${prefsFail}`);
  console.log(`  total raw: ${items.length} 施設`);

  if (items.length === 0) { console.error('❌ no shelter parsed'); process.exit(1); }

  // サイズ制約: 全国125k は 11MB → バンドル予算超過
  // フィルタ: 収容人数 ≥ 100 または対応災害指定あり
  const filtered = items.filter(x => x.cap >= 100 || x.k > 0);
  console.log(`  filtered (cap>=100 OR kinds>0): ${filtered.length}`);
  // それでも多すぎる場合は capacity 降順で 30,000 にキャップ
  const CAP = 30000;
  let final = filtered;
  if (filtered.length > CAP) {
    final = filtered.sort((a,b) => (b.cap||0) - (a.cap||0)).slice(0, CAP);
    console.log(`  capped to top ${CAP} by capacity`);
  }
  console.log('  sample:', { name: final[0].n, kinds: final[0].k, cap: final[0].cap });

  const data = u.buildPointBundle(final, (it) => {
    const o = {};
    if (it.n) o.n = it.n;
    if (it.k) o.k = it.k;
    // capacity は cap >= 1000 のものだけ（収容大規模のみ表示用）
    if (it.cap >= 1000) o.cap = it.cap;
    return o;
  });
  data.source = `KSJ ${VERSION} (国土交通省・避難施設・47県別 Shape→shapefile npm パース)`;
  data.license = 'PDL1.0';
  data.kindBitmap = { 1:'地震', 2:'洪水', 4:'崖崩れ', 8:'津波', 16:'高潮', 32:'大火事' };

  const size = u.writeBundleJs(OUT, 'SHELTERS_JP', data, [
    `// 出典: 国土数値情報 避難施設 ${VERSION}（PDL1.0）`,
    `// 47県 ${items.length} 施設・対応災害bitmap・収容人数付き`,
  ]);
  console.log(`✅ ${OUT}  count=${items.length} size=${(size/1024).toFixed(2)} KB`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
