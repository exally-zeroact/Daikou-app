#!/usr/bin/env node
/**
 * build-bundle-coarse-jp.js
 *
 * 国交省 街区レベル位置参照情報（ISJ）47県分から
 * 「都道府県+市区町村」レベルの粗住所データを生成。
 *
 * 出力:
 *   data/coarse-jp.js  ~1MB
 *   1741市区町村の重心 + 簡易境界 + grid索引
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const u = require('./bundle-utils.js');

const PROJECT_ROOT = path.join(__dirname, '..');
const TMP = path.join(PROJECT_ROOT, 'tmp', 'bundle-coarse');
const OUT = path.join(PROJECT_ROOT, 'data', 'coarse-jp.js');

// 都道府県コード（ISJ ファイル名は {code}000-22.0a.zip）
const PREF_CODES = [];
for (let i = 1; i <= 47; i++) PREF_CODES.push(String(i).padStart(2, '0'));

const VERSION = '22.0a';

(async () => {
  fs.mkdirSync(TMP, { recursive: true });

  // 集計バケット: key="都道府県名|市区町村名" → { p, c, sumLat, sumLng, n, minLat, maxLat, minLng, maxLng }
  const cities = new Map();
  let totalRows = 0;
  let downloadedZips = 0;
  let cachedZips = 0;

  for (const code of PREF_CODES) {
    const zipUrl = `https://nlftp.mlit.go.jp/isj/dls/data/${VERSION}/${code}000-${VERSION}.zip`;
    const zipPath = path.join(TMP, `${code}.zip`);
    const extractDir = path.join(TMP, code);

    if (fs.existsSync(zipPath) && (Date.now() - fs.statSync(zipPath).mtimeMs) < 30 * 86400000) {
      cachedZips++;
    } else {
      try {
        const buf = await u.fetchBuffer(zipUrl, 60000);
        fs.writeFileSync(zipPath, buf);
        downloadedZips++;
      } catch (e) {
        console.warn(`  ⚠️ pref=${code} DL失敗: ${e.message}`);
        continue;
      }
    }

    // 解凍（unzip は backslash 警告で exit 1 を返すが実体は成功するため例外を握り潰す）
    fs.mkdirSync(extractDir, { recursive: true });
    try {
      execSync(`unzip -qo "${zipPath}" -d "${extractDir}"`, { stdio: 'pipe' });
    } catch (e) {
      // 警告だけのケース（exit code 1）もあるので、CSV が出ていれば続行
      const csvCheck = u.findFiles(extractDir, /\.csv$/i);
      if (csvCheck.length === 0) {
        console.warn(`  ⚠️ pref=${code} unzip失敗（CSV 無し・exit=${e.status})`);
        continue;
      }
    }

    // CSV を見つけて Shift-JIS → UTF-8 変換 → パース
    const csvFiles = u.findFiles(extractDir, /\.csv$/i);
    if (csvFiles.length === 0) {
      console.warn(`  ⚠️ pref=${code} CSV見つからず`);
      continue;
    }
    let prefRowCount = 0;
    for (const csvPath of csvFiles) {
      let text;
      try {
        // iconv で Shift-JIS → UTF-8
        const buf = execSync(`iconv -f SHIFT_JIS -t UTF-8 "${csvPath}"`, {
          maxBuffer: 200 * 1024 * 1024,
        });
        text = buf.toString('utf8');
      } catch (e) {
        console.warn(`  ⚠️ pref=${code} iconv失敗: ${e.message}`);
        continue;
      }
      const lines = text.split(/\r?\n/);
      // ヘッダスキップ
      for (let i = 1; i < lines.length; i++) {
        const ln = lines[i];
        if (!ln) continue;
        // CSV: "都道府県名","市区町村名",...,"緯度","経度",...
        // 簡易パース（"" で囲まれたフィールドのみ・カンマ区切り）
        const parts = ln.match(/"([^"]*)"/g);
        if (!parts || parts.length < 10) continue;
        const pref = parts[0].slice(1, -1);
        const city = parts[1].slice(1, -1);
        const lat = parseFloat(parts[8].slice(1, -1));
        const lng = parseFloat(parts[9].slice(1, -1));
        if (!isFinite(lat) || !isFinite(lng)) continue;
        if (!pref || !city) continue;

        const key = `${pref}|${city}`;
        let c = cities.get(key);
        if (!c) {
          c = { p: pref, n: city, sumLat: 0, sumLng: 0, count: 0, bb: [Infinity, Infinity, -Infinity, -Infinity] };
          cities.set(key, c);
        }
        c.sumLat += lat;
        c.sumLng += lng;
        c.count++;
        if (lat < c.bb[0]) c.bb[0] = lat;
        if (lng < c.bb[1]) c.bb[1] = lng;
        if (lat > c.bb[2]) c.bb[2] = lat;
        if (lng > c.bb[3]) c.bb[3] = lng;
        prefRowCount++;
      }
    }
    totalRows += prefRowCount;
    if (prefRowCount > 0 && (parseInt(code, 10) % 10 === 0 || code === '01' || code === '47')) {
      console.log(`  pref ${code}: ${prefRowCount.toLocaleString()} rows / ${cities.size} 累計都市`);
    }
  }

  console.log(`\n  ZIP: ${downloadedZips} DL + ${cachedZips} cached`);
  console.log(`  total rows parsed: ${totalRows.toLocaleString()}`);
  console.log(`  unique cities: ${cities.size}`);

  // 都市別 重心 + bbox を最終データに整形
  const items = [];
  for (const c of cities.values()) {
    if (c.count === 0) continue;
    items.push({
      p: c.p,
      n: c.n,
      lat: c.sumLat / c.count,
      lng: c.sumLng / c.count,
      bb: c.bb,
    });
  }

  // grid + 圧縮形式で出力（粗住所は逆引きで使うので grid 索引が重要）
  const PRECISION = u.PRECISION;
  const GRID_INT = u.GRID_INT;
  const grid = {};
  const cityPacked = items.map((it, idx) => {
    const latI = Math.round(it.lat * PRECISION);
    const lngI = Math.round(it.lng * PRECISION);
    const k = u.gridKey(latI, lngI);
    (grid[k] ||= []).push(idx);
    return {
      p: it.p,
      n: it.n,
      lat: latI,
      lng: lngI,
      bb: [
        Math.round(it.bb[0] * PRECISION),
        Math.round(it.bb[1] * PRECISION),
        Math.round(it.bb[2] * PRECISION),
        Math.round(it.bb[3] * PRECISION),
      ],
    };
  });

  const data = {
    v: 1,
    generated: new Date().toISOString(),
    precision: PRECISION,
    gridSize: GRID_INT,
    cities: cityPacked,
    grid,
    source: '国土交通省 街区レベル位置参照情報 ' + VERSION,
  };

  const size = u.writeBundleJs(OUT, 'COARSE_JP', data, [
    `// 出典: 国土数値情報・街区レベル位置参照情報 ${VERSION}（PDL1.0）`,
    `// 全国 ${cityPacked.length} 市区町村の重心 + bbox + grid索引`,
  ]);
  console.log(`✅ ${OUT}`);
  console.log(`  cities=${cityPacked.length} cells=${Object.keys(grid).length} size=${(size/1024/1024).toFixed(2)} MB`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
