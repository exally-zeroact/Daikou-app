// 共通エンコードユーティリティ
// build-roads.js / build-road-attrs.js / build-hazard.js で共有

function zigzagEncode(n) {
  return (n << 1) ^ (n >> 31);
}

function writeVarint(buf, n) {
  while (n >= 0x80) {
    buf.push((n & 0x7f) | 0x80);
    n = n >>> 7;
  }
  buf.push(n & 0x7f);
}
function writeSignedVarint(buf, n) {
  writeVarint(buf, zigzagEncode(n));
}

// 整数列 (sorted ascending) を delta-varint-base64 にする
function encodeIndexListB64(indices) {
  if (indices.length === 0) return '';
  const sorted = [...indices].sort((a, b) => a - b);
  const buf = [];
  let prev = 0;
  for (const idx of sorted) {
    const delta = idx - prev;
    writeVarint(buf, delta);
    prev = idx;
  }
  return Buffer.from(buf).toString('base64');
}

// 1e5 整数化された [lat,lng] 列を delta+svarint+base64 にする
function encodeLineB64(intPoints) {
  const buf = [];
  writeVarint(buf, intPoints.length);
  if (intPoints.length === 0) return Buffer.from(buf).toString('base64');
  writeSignedVarint(buf, intPoints[0][0]);
  writeSignedVarint(buf, intPoints[0][1]);
  for (let i = 1; i < intPoints.length; i++) {
    writeSignedVarint(buf, intPoints[i][0] - intPoints[i - 1][0]);
    writeSignedVarint(buf, intPoints[i][1] - intPoints[i - 1][1]);
  }
  return Buffer.from(buf).toString('base64');
}

// 複数リング = ポリゴン
// rings: [[ [lat,lng], ... ], ...]   1e5 整数
// 出力: numRings varint + 各リングは encodeLine と同形式（numPts + 始点 + デルタ列）
function encodePolygonsBytes(polygons) {
  // polygons: [ rings, rings, ... ]
  const buf = [];
  writeVarint(buf, polygons.length);
  for (const rings of polygons) {
    writeVarint(buf, rings.length);
    for (const ring of rings) {
      writeVarint(buf, ring.length);
      if (ring.length === 0) continue;
      writeSignedVarint(buf, ring[0][0]);
      writeSignedVarint(buf, ring[0][1]);
      for (let i = 1; i < ring.length; i++) {
        writeSignedVarint(buf, ring[i][0] - ring[i - 1][0]);
        writeSignedVarint(buf, ring[i][1] - ring[i - 1][1]);
      }
    }
  }
  return Buffer.from(buf).toString('base64');
}

// 47都道府県重心
const PREFECTURES = {
  hokkaido: [43.3, 142.8],
  aomori: [40.8, 140.7],
  iwate: [39.7, 141.2],
  miyagi: [38.3, 140.9],
  akita: [39.7, 140.4],
  yamagata: [38.2, 140.0],
  fukushima: [37.4, 140.2],
  ibaraki: [36.4, 140.4],
  tochigi: [36.7, 139.9],
  gunma: [36.4, 139.0],
  saitama: [35.9, 139.4],
  chiba: [35.5, 140.2],
  tokyo: [35.7, 139.7],
  kanagawa: [35.4, 139.4],
  niigata: [37.5, 138.9],
  toyama: [36.6, 137.2],
  ishikawa: [36.6, 136.7],
  fukui: [35.8, 136.2],
  yamanashi: [35.6, 138.6],
  nagano: [36.2, 138.0],
  gifu: [35.6, 137.0],
  shizuoka: [34.9, 138.4],
  aichi: [35.1, 137.0],
  mie: [34.6, 136.5],
  shiga: [35.1, 136.1],
  kyoto: [35.2, 135.7],
  osaka: [34.6, 135.5],
  hyogo: [35.0, 134.9],
  nara: [34.4, 135.8],
  wakayama: [33.8, 135.5],
  tottori: [35.4, 134.0],
  shimane: [35.0, 132.8],
  okayama: [34.9, 133.8],
  hiroshima: [34.5, 132.7],
  yamaguchi: [34.2, 131.6],
  tokushima: [33.9, 134.4],
  kagawa: [34.3, 134.0],
  ehime: [33.7, 132.9],
  kochi: [33.5, 133.5],
  fukuoka: [33.6, 130.7],
  saga: [33.3, 130.1],
  nagasaki: [32.9, 129.9],
  kumamoto: [32.7, 130.7],
  oita: [33.2, 131.4],
  miyazaki: [32.0, 131.4],
  kagoshima: [31.4, 130.6],
  okinawa: [26.5, 128.0],
};

const PRECISION = 1e5;
const GRID_INT = 1000; // grid cell = 0.01° (1000 / 1e5)

// 1e5 整数座標からグリッドキー
function gridKey(latInt, lngInt) {
  return Math.floor(latInt / GRID_INT) + '_' + Math.floor(lngInt / GRID_INT);
}

// 地方 → 都道府県リスト（build-roads.js / fetch-poi-bulk.sh と同じ）
const REGION_PREFS = {
  hokkaido: ['hokkaido'],
  tohoku: ['aomori', 'iwate', 'miyagi', 'akita', 'yamagata', 'fukushima'],
  kanto: ['ibaraki', 'tochigi', 'gunma', 'saitama', 'chiba', 'tokyo', 'kanagawa'],
  chubu: [
    'niigata',
    'toyama',
    'ishikawa',
    'fukui',
    'yamanashi',
    'nagano',
    'gifu',
    'shizuoka',
    'aichi',
  ],
  kansai: ['mie', 'shiga', 'kyoto', 'osaka', 'hyogo', 'nara', 'wakayama'],
  chugoku: ['tottori', 'shimane', 'okayama', 'hiroshima', 'yamaguchi'],
  shikoku: ['tokushima', 'kagawa', 'ehime', 'kochi'],
  kyushu: ['fukuoka', 'saga', 'nagasaki', 'kumamoto', 'oita', 'miyazaki', 'kagoshima', 'okinawa'],
};

function nearestPrefecture(lat, lng, prefList) {
  const list = prefList || Object.keys(PREFECTURES);
  let best = null,
    bestDist = Infinity;
  for (const pref of list) {
    const [pLat, pLng] = PREFECTURES[pref];
    const dLat = lat - pLat;
    const dLng = lng - pLng;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestDist) {
      bestDist = d;
      best = pref;
    }
  }
  return best;
}

module.exports = {
  zigzagEncode,
  writeVarint,
  writeSignedVarint,
  encodeIndexListB64,
  encodeLineB64,
  encodePolygonsBytes,
  PREFECTURES,
  REGION_PREFS,
  nearestPrefecture,
  PRECISION,
  GRID_INT,
  gridKey,
};
