'use strict';

// 合成 fixture 生成スクリプト (CI でも実走でも regression を確認できる固定種)
// 既知 ground truth を JSONL で出力し、replay-mm.js が即読めるように tests/fixtures/ に書く
// 使い方: node tests/lib/generate-fixtures.js

const fs = require('fs');
const path = require('path');
const { haversineM } = require('./distance');

const OUT_DIR = path.join(__dirname, '..', 'fixtures');
fs.mkdirSync(OUT_DIR, { recursive: true });

const TR = Math.PI / 180;
function metersPerDegree(lat) {
  return { lat: 111132.92, lng: 111412.84 * Math.cos(lat * TR) };
}

// 与えた lat/lng から bearing(deg) 方向に distM 進んだ点 (近似平面)
function step(lat, lng, bearingDeg, distM) {
  const mpd = metersPerDegree(lat);
  const dx = distM * Math.sin(bearingDeg * TR);
  const dy = distM * Math.cos(bearingDeg * TR);
  return [lat + dy / mpd.lat, lng + dx / mpd.lng];
}

// 道路ポリラインの実距離を haversine 累積で計測
function polylineLength(pts) {
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    s += haversineM(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
  }
  return s;
}

// 道路上を distM 進んだ位置の [lat, lng]
function pointAtDistance(pts, distM) {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const segLen = haversineM(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (acc + segLen >= distM) {
      const t = segLen > 0 ? (distM - acc) / segLen : 0;
      return [
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
      ];
    }
    acc += segLen;
  }
  return pts[pts.length - 1];
}

// 決定的乱数 (seedable)
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function writeJsonl(name, meta, gpsPoints) {
  const lines = [JSON.stringify(meta)];
  for (const p of gpsPoints) lines.push(JSON.stringify(p));
  fs.writeFileSync(path.join(OUT_DIR, name), lines.join('\n') + '\n');
  console.log('  wrote', name, '(' + gpsPoints.length, 'points)');
}

// セグメント単位に進む道路を構築 (ジグザグ・スパイラル化を防ぐ)
function buildRoad(lat0, lng0, segments) {
  const pts = [[lat0, lng0]];
  let lat = lat0,
    lng = lng0;
  for (const seg of segments) {
    const [nlat, nlng] = step(lat, lng, seg.bearing, seg.length);
    pts.push([nlat, nlng]);
    lat = nlat;
    lng = nlng;
  }
  return pts;
}

// GPS トレース生成: 道路上を gpsLengthM 走り gpsStepM ごとに点を打つ・横方向ノイズ noiseM
function makeGpsTrace(road, gpsLengthM, gpsStepM, noiseM, t0, speedKmh, seed) {
  const rand = mulberry32(seed);
  const gps = [];
  for (let m = 0; m <= gpsLengthM; m += gpsStepM) {
    const [lat, lng] = pointAtDistance(road, m);
    // 横方向ノイズ: 緯度経度を独立にずらす近似
    const mpd = metersPerDegree(lat);
    const nx = (rand() - 0.5) * 2 * noiseM;
    const ny = (rand() - 0.5) * 2 * noiseM;
    gps.push({
      lat: +(lat + ny / mpd.lat).toFixed(7),
      lng: +(lng + nx / mpd.lng).toFixed(7),
      timestamp: t0 + (m / gpsStepM) * 1000,
      accuracy: 5,
      speedKmh: speedKmh,
      headingDeg: 0,
    });
  }
  return gps;
}

// ─── Fixture 1: 直線 1km ─────────────────────────────────────
function makeStraight1km() {
  const road = buildRoad(34.0658, 132.997, [{ bearing: 0, length: 1100 }]);
  const gps = makeGpsTrace(road, 1000, 10, 3, 1714000000000, 36, 42);
  const expected = 1000;
  writeJsonl(
    'synthetic-straight-1km.jsonl',
    {
      name: 'synthetic-straight-1km',
      description: '直線 1km 北向き・GPS 横方向ノイズ ±3m',
      roads: [{ typeCode: 5, oneway: 0, layer: 0, points: road }],
      expected_distance_m: expected,
      road_length_m: +polylineLength(road).toFixed(2),
    },
    gps
  );
}

// ─── Fixture 2: ゆるカーブ 1.5km (ジグザグ 5 セグメント) ───────────
function makeCurve15km() {
  const road = buildRoad(33.8403, 132.7656, [
    { bearing: -45, length: 300 },
    { bearing: -30, length: 300 },
    { bearing: -15, length: 300 },
    { bearing: 0, length: 300 },
    { bearing: 15, length: 400 },
  ]);
  const total = polylineLength(road);
  const gpsLen = Math.floor(total) - 50;
  const gps = makeGpsTrace(road, gpsLen, 10, 2, 1714100000000, 36, 7);
  writeJsonl(
    'synthetic-curve-1.5km.jsonl',
    {
      name: 'synthetic-curve-1.5km',
      description: 'ゆるカーブ 5 セグメント 約 1.6km・GPS ノイズ ±2m',
      roads: [{ typeCode: 5, oneway: 0, layer: 0, points: road }],
      expected_distance_m: gpsLen,
      road_length_m: +total.toFixed(2),
    },
    gps
  );
}

// ─── Fixture 3: 高架/地上の取り違え誘発 (並行 2 道路 6m 離隔) ───────
function makeOverpass() {
  const ground = buildRoad(33.88, 132.77, [{ bearing: 90, length: 800 }]);
  // overpass は ground を緯度方向に +6m オフセットしただけ (並行)
  const overpass = ground.map((p) => step(p[0], p[1], 0, 6));
  const gps = makeGpsTrace(ground, 700, 10, 2, 1714200000000, 30, 99);
  // GPS は ground 寄り・layer=0 を当てるべき
  writeJsonl(
    'synthetic-overpass-700m.jsonl',
    {
      name: 'synthetic-overpass-700m',
      description: '並行 2 道路 (地上/高架 6m 離隔)・GPS は地上寄り',
      roads: [
        { typeCode: 5, oneway: 0, layer: 0, points: ground },
        { typeCode: 5, oneway: 0, layer: 1, points: overpass },
      ],
      expected_distance_m: 700,
      expected_layer: 0,
      road_length_m: +polylineLength(ground).toFixed(2),
    },
    gps
  );
}

console.log('[fixtures] generating synthetic fixtures...');
makeStraight1km();
makeCurve15km();
makeOverpass();
console.log('[fixtures] done -> ' + OUT_DIR);
