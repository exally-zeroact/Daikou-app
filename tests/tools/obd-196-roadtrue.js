// tests/tools/obd-196-roadtrue.js
// ★高市→小泉 真距離リファレンス = 実OSM道路スナップの道なり距離 (2026-06-14)★
//   壊れたKP-RTK基準の代わりに、data/roads-ehime.js + 実RoadDecoder で実走パスを
//   道路スナップし「通った道の道なり距離」を出す。これを真距離の代理として
//   OBD∫v / Doppler∫ / 平滑GPS弦 と突合し、moco の過小を確定する。
//   2手法を併記: (A) 実 createDistanceTracker(GPS駆動・snap+routing) の distance_m
//               (B) 直接 snap→calcRoadDistance 連結 (gap guard 付き) の道なり弧長
const fs = require('fs');
const path = require('path');
const os = require('os');
const PD = require(path.join(__dirname, '..', '..', 'js', 'pipeline-distance.js'));

function loadDecoder(pref) {
  const savedWindow = global.window,
    savedSelf = global.self,
    savedRD = global.RoadDecoder;
  const key = 'ROADS_' + pref.toUpperCase();
  const savedRoads = global[key];
  global.window = global;
  global.self = global;
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'roads-decoder.js'), 'utf8'));
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'roads-' + pref + '.js'), 'utf8'));
  const roadsData = global[key];
  const dec = new global.RoadDecoder(roadsData);
  dec.buildOffsetTable();
  global.window = savedWindow;
  global.self = savedSelf;
  global.RoadDecoder = savedRD;
  global[key] = savedRoads;
  return dec;
}

const R = 6371000,
  rad = (d) => (d * Math.PI) / 180;
const hav = (a, b) => {
  const dla = rad(b.lat - a.lat),
    dln = rad(b.lng - a.lng);
  const x =
    Math.sin(dla / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dln / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

function main() {
  const c = JSON.parse(fs.readFileSync(os.tmpdir() + '/obd-196-trace-cache.json', 'utf8'));
  const s = c.samples;
  console.log('端末=' + c.label + ' 点数=' + s.length);
  const dec = loadDecoder('ehime');
  console.log('OSM ehime 道路ロード完了');

  // 参考量
  let obd = 0,
    dop = 0;
  for (let i = 1; i < s.length; i++) {
    const dt = (s[i].t - s[i - 1].t) / 1000;
    if (dt > 0 && dt <= 10) {
      if (typeof s[i].obd === 'number' && s[i].obd >= 0) obd += (s[i].obd / 3.6) * dt;
      if (typeof s[i].spd === 'number' && s[i].spd >= 0) dop += s[i].spd * dt;
    }
  }
  const sm = s.map((_, i) => {
    let la = 0,
      ln = 0,
      n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(s.length - 1, i + 2); j++) {
      la += s[j].lat;
      ln += s[j].lng;
      n++;
    }
    return { lat: la / n, lng: ln / n };
  });
  let smc = 0;
  for (let i = 1; i < sm.length; i++) smc += hav(sm[i - 1], sm[i]);

  // (A) 実 createDistanceTracker (GPS駆動・obdなし)
  const tkA = PD.createDistanceTracker(dec, {
    useSnapCache: true,
    enableRouting: true,
    adaptiveMode: false,
  });
  tkA.ingest({ lat: s[0].lat, lng: s[0].lng, t: s[0].t, acc: s[0].acc || 5 });
  for (let i = 1; i < s.length; i++)
    tkA.ingest({ lat: s[i].lat, lng: s[i].lng, t: s[i].t, acc: s[i].acc || 5 });
  const distA = tkA.totalM();

  // (B) 直接 snap→calcRoadDistance (gap guard: 1点ずつだとノイズ flip→3点間引きで安定化)
  let roadArc = 0,
    snapOk = 0,
    snapMiss = 0,
    gapSkip = 0;
  const STEP = 3;
  let prevSnap = null,
    prevP = null;
  for (let i = 0; i < s.length; i += STEP) {
    const p = s[i];
    let snap = null;
    try {
      snap = dec.snapToNearestRoad(p.lat, p.lng, { maxSnapM: 40 });
    } catch {
      snap = null;
    }
    if (!snap) {
      snapMiss++;
      prevSnap = null;
      prevP = p;
      continue;
    }
    snapOk++;
    if (prevSnap && prevP) {
      let d = null;
      try {
        d = dec.calcRoadDistance(prevSnap, snap);
      } catch {
        d = null;
      }
      const chord = hav(prevP, p);
      // gap guard: 道なり距離が無効/弦の3倍超(flip)/弦より極端に短い → 弦で代替
      if (d == null || !(d >= 0) || d > chord * 3 + 30) {
        roadArc += chord;
        gapSkip++;
      } else roadArc += Math.max(d, chord); // 道なり弧≥弦
    }
    prevSnap = snap;
    prevP = p;
  }

  console.log('\n=== 高市→小泉 真距離リファレンス (実OSM道路スナップ) ===');
  console.log('(A) 実pipeline GPS駆動 distance_m = ' + (distA / 1000).toFixed(3) + 'km');
  console.log(
    '(B) 直接snap道なり弧長        = ' +
      (roadArc / 1000).toFixed(3) +
      'km  (snap成功' +
      snapOk +
      '/失敗' +
      snapMiss +
      '/gap弦代替' +
      gapSkip +
      ')'
  );
  console.log('--- 参考 ---');
  console.log('平滑GPS弦 win5 = ' + (smc / 1000).toFixed(3) + 'km');
  console.log('Doppler∫       = ' + (dop / 1000).toFixed(3) + 'km');
  console.log('OBD∫v          = ' + (obd / 1000).toFixed(3) + 'km  ← 今のエンジン');
  const refs = { 'pipeline(A)': distA, 'roadArc(B)': roadArc, 平滑弦: smc };
  console.log('\n=== OBD∫v(=エンジン) の各リファレンス比 ===');
  for (const k of Object.keys(refs))
    if (refs[k] > 0)
      console.log('  vs ' + k + ' = ' + ((obd / refs[k] - 1) * 100).toFixed(2) + '%');
}
main();
