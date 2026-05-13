#!/usr/bin/env node
/**
 * build-bundle-pref-borders-jp.js
 *
 * KSJ N03-2024 (行政区域) を県単位に集約・大幅簡略化して
 * pref-borders-jp.js を生成。
 *
 * 出力: data/pref-borders-jp.js  ~50KB目標（簡略化前は~10MB）
 *
 * 簡略化方針:
 *   - 市区町村ポリゴンを県単位で外周 union
 *     → 厳密な union は実装困難なので、近似策として「全 ring を結合 + 重複点除去」
 *     → 県内のすべての ring を残し、最も外側の輪郭が描けるようにする
 *   - 各 ring を Douglas-Peucker 簡略化（tolerance 0.005 度 ≈ 500m）
 *   - 1e5 整数化 + delta varint base64 圧縮
 */

const fs = require('fs');
const path = require('path');
const u = require('./bundle-utils.js');

const PROJECT_ROOT = path.join(__dirname, '..');
const TMP = path.join(PROJECT_ROOT, 'tmp', 'bundle-pref-borders');
const OUT = path.join(PROJECT_ROOT, 'data', 'pref-borders-jp.js');
const URL = 'https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2024/N03-20240101_GML.zip';

// 都道府県コード → 名前（KSJ N03_001 = 都道府県名）
const PREF_CODES = {
  '01':'hokkaido', '02':'aomori', '03':'iwate', '04':'miyagi', '05':'akita',
  '06':'yamagata','07':'fukushima','08':'ibaraki','09':'tochigi','10':'gunma',
  '11':'saitama','12':'chiba','13':'tokyo','14':'kanagawa','15':'niigata',
  '16':'toyama','17':'ishikawa','18':'fukui','19':'yamanashi','20':'nagano',
  '21':'gifu','22':'shizuoka','23':'aichi','24':'mie','25':'shiga',
  '26':'kyoto','27':'osaka','28':'hyogo','29':'nara','30':'wakayama',
  '31':'tottori','32':'shimane','33':'okayama','34':'hiroshima','35':'yamaguchi',
  '36':'tokushima','37':'kagawa','38':'ehime','39':'kochi','40':'fukuoka',
  '41':'saga','42':'nagasaki','43':'kumamoto','44':'oita','45':'miyazaki',
  '46':'kagoshima','47':'okinawa',
};

// Douglas-Peucker 簡略化（[lng, lat] ポイント列）
function pointLineDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / (dx*dx + dy*dy)));
  return Math.hypot(p[0] - (a[0]+t*dx), p[1] - (a[1]+t*dy));
}
function douglasPeucker(pts, tol) {
  if (pts.length < 3) return pts;
  let maxDist = 0, maxIdx = 0;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointLineDist(pts[i], a, b);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > tol) {
    return douglasPeucker(pts.slice(0, maxIdx+1), tol).slice(0, -1)
      .concat(douglasPeucker(pts.slice(maxIdx), tol));
  }
  return [a, b];
}

(async () => {
  console.log(`  DL+extract: ${URL}`);
  const { features, fileCounts, zipBytes } = await u.loadKsjFeaturesFromZipUrl(URL, TMP);
  console.log(`  zip ${(zipBytes/1024/1024).toFixed(1)}MB → features=${features.length}`);
  console.log('  files:', JSON.stringify(fileCounts));

  // KSJ N03 属性: N03_001=都道府県名, N03_002=支庁/振興局名, N03_003=郡/政令市, N03_004=市区町村名
  // 各 feature は市区町村ポリゴン
  const byPref = {};
  for (const f of features) {
    const props = f.properties || {};
    const prefName = props.N03_001;
    if (!prefName) continue;
    if (!byPref[prefName]) byPref[prefName] = [];
    // ジオメトリのリングを集める（外環のみ・穴は無視）
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates]
                : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const p of polys) {
      const ring = p[0]; // exterior ring
      if (Array.isArray(ring) && ring.length >= 4) byPref[prefName].push(ring);
    }
  }

  console.log(`  prefectures parsed: ${Object.keys(byPref).length}`);

  // 各県のリングを Douglas-Peucker で簡略化 + 1e5 整数化 + ring ごとに encodeLineB64
  // 出力: { 'hokkaido': { rings: [b64 of [lat,lng] varint+delta, ...], bbox: [...] } }
  const TOL = 0.005; // 度（≈500m at mid lat）
  const out = {};
  let totalRings = 0;
  let totalPointsBefore = 0;
  let totalPointsAfter = 0;

  for (const [prefJp, rings] of Object.entries(byPref)) {
    const code = Object.entries(PREF_CODES).find(([_, n]) => false); // not used
    // 簡略化＋整数化
    const bbox = [Infinity, Infinity, -Infinity, -Infinity];
    const ringB64s = [];
    for (const ring of rings) {
      totalPointsBefore += ring.length;
      // ring は [[lng, lat], ...]
      const simplified = douglasPeucker(ring, TOL);
      if (simplified.length < 4) continue;
      totalPointsAfter += simplified.length;
      // 1e5 整数化 [lat, lng] 順
      const intPts = simplified.map(([lng, lat]) => {
        const latI = Math.round(lat * u.PRECISION);
        const lngI = Math.round(lng * u.PRECISION);
        if (latI < bbox[0]) bbox[0] = latI;
        if (lngI < bbox[1]) bbox[1] = lngI;
        if (latI > bbox[2]) bbox[2] = latI;
        if (lngI > bbox[3]) bbox[3] = lngI;
        return [latI, lngI];
      });
      const b64 = u.encodeLineB64(intPts);
      ringB64s.push(b64);
      totalRings++;
    }
    out[prefJp] = { rings: ringB64s, bbox };
  }
  console.log(`  rings total: ${totalRings}`);
  console.log(`  points: ${totalPointsBefore.toLocaleString()} → ${totalPointsAfter.toLocaleString()} (${((1-totalPointsAfter/totalPointsBefore)*100).toFixed(1)}% 削減)`);

  // 都道府県名を英語キーに変換（CLAUDE.md/その他の整合性）
  // 入力 prefJp: "北海道", "青森県", ...
  const PREF_JP_TO_EN = {
    '北海道':'hokkaido', '青森県':'aomori', '岩手県':'iwate', '宮城県':'miyagi',
    '秋田県':'akita', '山形県':'yamagata', '福島県':'fukushima', '茨城県':'ibaraki',
    '栃木県':'tochigi', '群馬県':'gunma', '埼玉県':'saitama', '千葉県':'chiba',
    '東京都':'tokyo', '神奈川県':'kanagawa', '新潟県':'niigata', '富山県':'toyama',
    '石川県':'ishikawa', '福井県':'fukui', '山梨県':'yamanashi', '長野県':'nagano',
    '岐阜県':'gifu', '静岡県':'shizuoka', '愛知県':'aichi', '三重県':'mie',
    '滋賀県':'shiga', '京都府':'kyoto', '大阪府':'osaka', '兵庫県':'hyogo',
    '奈良県':'nara', '和歌山県':'wakayama', '鳥取県':'tottori', '島根県':'shimane',
    '岡山県':'okayama', '広島県':'hiroshima', '山口県':'yamaguchi', '徳島県':'tokushima',
    '香川県':'kagawa', '愛媛県':'ehime', '高知県':'kochi', '福岡県':'fukuoka',
    '佐賀県':'saga', '長崎県':'nagasaki', '熊本県':'kumamoto', '大分県':'oita',
    '宮崎県':'miyazaki', '鹿児島県':'kagoshima', '沖縄県':'okinawa',
  };
  const data = { v: 1, generated: new Date().toISOString(), precision: u.PRECISION };
  data.prefs = {};
  for (const [jp, info] of Object.entries(out)) {
    const en = PREF_JP_TO_EN[jp];
    if (!en) continue;
    data.prefs[en] = { name: jp, ...info };
  }
  data.source = 'KSJ N03-2024 (国土交通省・行政区域・簡略化済)';

  const size = u.writeBundleJs(OUT, 'PREF_BORDERS_JP', data, [
    `// 出典: 国土数値情報 行政区域 N03-2024（PDL1.0）`,
    `// 47都道府県の境界（市区町村ring 集約・DP 500m簡略・varint+base64）`,
  ]);
  console.log(`✅ ${OUT}`);
  console.log(`  prefs=${Object.keys(data.prefs).length} size=${(size/1024).toFixed(2)} KB`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
