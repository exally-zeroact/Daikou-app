#!/usr/bin/env node
'use strict';

// ============================================================
// tests/gate-address2-accuracy.js
//   ★住所②(現在地ライブ住所)スナップ精度の ★自動採点★ ゲート (人手ラベル不要)★
//
//   司さん「ユーザーにラベル付けなんかさせるな」→ 正解(ground-truth町名)は
//   ★アプリが既に積んでる町ポリゴン(data/town-polygons-{pref}.js)から自動算出★。
//   町は数十m〜km粒度=GPS誤差(5〜20m)はほぼ同じ町ポリゴン内 → 生GPSのPIPが
//   その地点の「本当の町」。人手ゼロ・全自動で採点する。
//
//   ★「安定だが誤り」を潰す核心★:
//     監査が指摘した罠 = 安定性proxy(町名チャタリング)は「snapが誤った平行道に
//     固着して安定」を逆に高評価する。本ゲートは ★独立オラクル(生GPSの町)に対する
//     正答率★ を測るので、固着して誤った町に居続ける snap は「confident wrong」として
//     摘発される(安定性では隠せない)。
//
//   方法(忠実・実コード):
//     - 正解町 = town(生GPS)  : 実エンジンと同一の _findTownPolygonAddress(PIP)を
//       business.js:438-496 から ★逐語ミラー★ して使用(下記 PIP_MIRROR)。
//     - 表示町 = town(最新snap): getCurrentLiveAddress 段階1(snap fresh→snap位置でPIP)を
//       忠実再現。実 Worker B が出す snap 座標で PIP。
//     - 各入力点ごとに (正解町, 表示町, 町境あいまい?) を記録。
//
//   ★町境あいまい除外★: 生GPSを±~20m ジッタして町が変われば「オラクル不確実」=除外。
//     これで「snapが境界跨ぎのGPS drift を正しく補正したのに誤判定」を誤摘発しない。
//
//   指標:
//     M_correct          = 表示町==正解町 / 評価可能点(あいまい・PIP miss除外)
//     M_wrong_confident  = 誤り & 非あいまい & 両非null = ★本物の誤町(最小化対象)★
//     M_chatter          = 表示町 A→B→A 往復回数(安定性・副指標)
//     M_pip_coverage     = 正解町が非nullの割合(町ポリゴンの被覆)
//     distance_m         = read-only 不変(住所②は距離/課金に非干渉の証明)
//
//   ★proxyの限界(正直注記)★: per-point真値は生GPS(町粒度で正確だが survey級でない)。
//     非あいまい域の不一致は実snap誤りだが、最終確定は実機/タイヤ計位置でやる。
//
//   使い方: node tests/gate-address2-accuracy.js   [ROADS_PREF=ehime]
//   import: const { runAddr2Gate } = require('./gate-address2-accuracy')
// ============================================================

const fs = require('fs');
const path = require('path');
const { createMapMatcherWorker, loadPrefRoadsData } = require('./replay-mm-worker/worker-sim');
const { loadMeter } = require('./replay-mm-worker/runner');

const DEFAULT_PREF = process.env.ROADS_PREF || 'ehime';
// ★複数端末 fixture (全 ehime 実走)★: iPhone13/iPhoneSE/Android で住所②精度を横断採点。
const FIXTURES = [
  'real-trace-iphone13-8.39km-tire.json',
  'real-trace-iphoneSE-5km-tire5.0.json',
  '0610b-Android.json',
];
const M_PER_DEG_LAT = 111000; // 緯度1度≈111km
const STANDARD_FARE = { baseFare: 1300, baseDistance: 1750, addFare: 100, addDistance: 311 };

// ─── 町ポリゴン bundle を window shim で load → window.TOWN_POLYGONS_{PREF} ───
function loadTownBundle(pref) {
  const file = path.join(__dirname, '..', 'data', 'town-polygons-' + pref + '.js');
  if (!fs.existsSync(file)) throw new Error('町ポリゴン無し: ' + file);
  const savedWindow = global.window;
  try {
    global.window = global.window || {};
    // eslint-disable-next-line no-eval
    eval(fs.readFileSync(file, 'utf8'));
    const key = 'TOWN_POLYGONS_' + pref.toUpperCase();
    const bundle = global.window[key];
    if (!bundle) throw new Error('global.window.' + key + ' 未定義');
    return bundle;
  } finally {
    global.window = savedWindow;
  }
}

// ─── PIP エンジン: business.js:400-496 の ★逐語ミラー★ (private のため複製・標準ray-casting) ───
//   ★business.js の _pointInPolygon/_findTownPolygonAddress が変わったら本ミラーも更新する★
const _townGrid = new Map();
const _TOWN_GRID_SIZE_INT = 1000;
function _buildTownGrid(bundle) {
  const grid = {};
  const items = bundle.items;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.bbox || it.bbox.length !== 4) continue;
    const [latMin, lngMin, latMax, lngMax] = it.bbox;
    const tLatMin = Math.floor(latMin / _TOWN_GRID_SIZE_INT);
    const tLatMax = Math.floor(latMax / _TOWN_GRID_SIZE_INT);
    const tLngMin = Math.floor(lngMin / _TOWN_GRID_SIZE_INT);
    const tLngMax = Math.floor(lngMax / _TOWN_GRID_SIZE_INT);
    for (let tlat = tLatMin; tlat <= tLatMax; tlat++) {
      for (let tlng = tLngMin; tlng <= tLngMax; tlng++) {
        const key = tlat + '_' + tlng;
        if (!grid[key]) grid[key] = [];
        grid[key].push(i);
      }
    }
  }
  return grid;
}
function _getTownGrid(bundle) {
  if (!_townGrid.has(bundle)) _townGrid.set(bundle, _buildTownGrid(bundle));
  return _townGrid.get(bundle);
}
function _pointInPolygon(latI, lngI, ring) {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  const n = ring.length;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const iLat = ring[i][0];
    const iLng = ring[i][1];
    const jLat = ring[j][0];
    const jLng = ring[j][1];
    if (
      iLng > lngI !== jLng > lngI &&
      latI < ((jLat - iLat) * (lngI - iLng)) / (jLng - iLng) + iLat
    ) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}
function _findTownPolygonAddress(lat, lng, bundle) {
  if (!bundle || !Array.isArray(bundle.items) || bundle.items.length === 0) return null;
  const COORD_SCALE = bundle.precision || 100000;
  const latI = Math.round(lat * COORD_SCALE);
  const lngI = Math.round(lng * COORD_SCALE);
  const grid = _getTownGrid(bundle);
  const tLat = Math.floor(latI / _TOWN_GRID_SIZE_INT);
  const tLng = Math.floor(lngI / _TOWN_GRID_SIZE_INT);
  const candidates = (grid && grid[tLat + '_' + tLng]) || null;
  const iterIdx = candidates || bundle.items.map((_, i) => i);
  for (let k = 0; k < iterIdx.length; k++) {
    const it = bundle.items[iterIdx[k]];
    if (!it || !it.bbox) continue;
    if (latI < it.bbox[0] || latI > it.bbox[2] || lngI < it.bbox[1] || lngI > it.bbox[3]) continue;
    if (!it.rings || it.rings.length === 0) continue;
    if (_pointInPolygon(latI, lngI, it.rings[0])) {
      let inHole = false;
      for (let r = 1; r < it.rings.length; r++) {
        if (_pointInPolygon(latI, lngI, it.rings[r])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return { n: it.n, c: it.c };
    }
  }
  return null;
}

// 町名キー (市町村+町名・丁目はカットせず素のnで比較=粒度最大)
function _townKey(t) {
  return t && t.n ? (t.c || '') + '/' + t.n : null;
}

// 町境あいまい? 生GPSを ★その点のGPS精度ぶん★ ジッタして町が変われば true(オラクル不確実)。
//   jitterM = clamp(accuracy, 8, 25)m = 「GPSが本当はどこか」の不確実半径。境界内ならオラクル信頼。
function _boundaryAmbiguous(lat, lng, accuracy, bundle) {
  const base = _townKey(_findTownPolygonAddress(lat, lng, bundle));
  const jM = Math.max(8, Math.min(25, Number.isFinite(accuracy) && accuracy > 0 ? accuracy : 12));
  const dLat = jM / M_PER_DEG_LAT;
  const dLng = jM / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  const offs = [
    [dLat, dLng],
    [dLat, -dLng],
    [-dLat, dLng],
    [-dLat, -dLng],
  ];
  for (const [a, b] of offs) {
    const k = _townKey(_findTownPolygonAddress(lat + a, lng + b, bundle));
    if (k !== base) return true;
  }
  return false;
}

function loadFixture(fixtureName) {
  const p = path.join(__dirname, 'fixtures', fixtureName);
  if (!fs.existsSync(p)) throw new Error('fixture 無し: ' + p);
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const arr = Array.isArray(raw) ? raw : raw.samples || raw.points || [];
  return arr
    .filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .sort((a, b) => (a.t || 0) - (b.t || 0));
}

// ─── 実 prod 経路で fixture を流し、各点で (正解町, 表示町) を記録 ───
function runAddr2Gate(opts) {
  opts = opts || {};
  const pref = opts.pref || DEFAULT_PREF;
  const fixture = opts.fixture || FIXTURES[0];
  const samples = loadFixture(fixture);
  const bundle = loadTownBundle(pref);

  const worker = createMapMatcherWorker({ debug: false });
  const mmResults = [];
  let roadsLoaded = false;
  worker.on((e) => {
    const m = e.data;
    if (!m) return;
    if (m.type === 'mmResult') mmResults.push(m);
    if (m.type === 'roadsLoaded') roadsLoaded = m.ok;
  });
  const roadsData = loadPrefRoadsData(pref);

  const Meter = loadMeter({ debug: false });
  Meter.setFareConfig(STANDARD_FARE);
  Meter.reset();
  const handlers = [];
  worker.on((e) => {
    for (const h of handlers) h(e);
  });
  const adapter = {
    addEventListener(t, h) {
      if (t === 'message') handlers.push(h);
    },
    removeEventListener(t, h) {
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    },
    postMessage(msg) {
      worker.sendMessage(msg);
    },
  };
  Meter.setMapMatcher(adapter);
  adapter.postMessage({ type: 'configPlatform', isIOS: true });
  adapter.postMessage({ type: 'loadRoads', pref: roadsData.prefecture, roadsData });
  if (!roadsLoaded) throw new Error('loadRoads failed for pref=' + pref);
  if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);

  // 各点ごと: update→新規mmResultからlastSnap更新→(正解町=生GPS町, 表示町=lastSnap町) 記録。
  //   = getCurrentLiveAddress 段階1(snap fresh→town(snap)) の忠実再現。
  const pairs = [];
  let lastSnap = null;
  for (const g of samples) {
    const before = mmResults.length;
    Meter.update({
      lat: g.lat,
      lng: g.lng,
      accuracy: g.acc,
      speedKmh: g.spd >= 0 ? g.spd * 3.6 : null,
      headingDeg: g.hdg,
      altitude: g.alt,
      timestamp: g.t,
      isStationary: false,
    });
    for (let i = before; i < mmResults.length; i++) {
      const m = mmResults[i];
      if (m.snap && Number.isFinite(m.snap.snapLat) && Number.isFinite(m.snap.snapLng)) {
        lastSnap = m.snap;
      }
    }
    const trueTown = _townKey(_findTownPolygonAddress(g.lat, g.lng, bundle));
    // ★感度自己テスト用★: injectSnapOffsetM>0 で snap を NE 方向に強制ズラし(誤snap注入)。
    //   通常運転では未指定=0。selfTest が「+50mで誤町>0」を確認しゲートの fail能力を恒久担保。
    let dLat2 = 0;
    let dLng2 = 0;
    if (lastSnap && opts.injectSnapOffsetM > 0) {
      dLat2 = opts.injectSnapOffsetM / M_PER_DEG_LAT;
      dLng2 =
        opts.injectSnapOffsetM / (M_PER_DEG_LAT * Math.cos((lastSnap.snapLat * Math.PI) / 180));
    }
    const dispTown = lastSnap
      ? _townKey(
          _findTownPolygonAddress(lastSnap.snapLat + dLat2, lastSnap.snapLng + dLng2, bundle)
        )
      : null;
    pairs.push({
      trueTown,
      dispTown,
      hasSnap: !!lastSnap,
      ambiguous: trueTown ? _boundaryAmbiguous(g.lat, g.lng, g.acc, bundle) : true,
    });
  }
  Meter.businessEnd();
  const distance_m = Meter.getState().distance_m;

  // 指標集計
  const total = pairs.length;
  let pipHit = 0;
  let evaluable = 0; // 非あいまい & 正解非null & snapあり
  let correct = 0;
  let wrongConfident = 0;
  for (const p of pairs) {
    if (p.trueTown) pipHit++;
    if (p.hasSnap && p.trueTown && !p.ambiguous) {
      evaluable++;
      if (p.dispTown === p.trueTown) correct++;
      else if (p.dispTown) wrongConfident++; // 非null同士で不一致 = confident wrong
    }
  }
  // M_chatter: 表示町 A→B→A 往復
  let chatter = 0;
  let prev = null;
  let prevPrev = null;
  for (const p of pairs) {
    if (!p.dispTown) continue;
    if (prevPrev && prev && p.dispTown === prevPrev && prev !== p.dispTown) chatter++;
    prevPrev = prev;
    prev = p.dispTown;
  }

  return {
    pref,
    fixture: opts.fixture || FIXTURES[0],
    total_points: total,
    pip_coverage_pct: round((pipHit / Math.max(1, total)) * 100),
    evaluable_points: evaluable,
    ambiguous_excluded: pairs.filter((p) => p.ambiguous && p.trueTown).length,
    M_correct_pct: round((correct / Math.max(1, evaluable)) * 100),
    M_wrong_confident: wrongConfident,
    M_wrong_confident_pct: round((wrongConfident / Math.max(1, evaluable)) * 100),
    M_chatter: chatter,
    distance_m: round(distance_m),
  };
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}

function runAll(opts) {
  opts = opts || {};
  const pref = opts.pref || DEFAULT_PREF;
  const per = [];
  for (const fx of FIXTURES) {
    try {
      per.push(runAddr2Gate({ pref, fixture: fx }));
    } catch (e) {
      per.push({ fixture: fx, error: e.message });
    }
  }
  const ok = per.filter((p) => !p.error);
  const sumEval = ok.reduce((s, p) => s + p.evaluable_points, 0);
  const sumWrong = ok.reduce((s, p) => s + p.M_wrong_confident, 0);
  const sumCorrect = ok.reduce(
    (s, p) => s + Math.round((p.M_correct_pct / 100) * p.evaluable_points),
    0
  );
  return {
    per_fixture: per,
    agg_evaluable: sumEval,
    agg_correct_pct: round((sumCorrect / Math.max(1, sumEval)) * 100),
    agg_wrong_confident: sumWrong,
    // 合否: 本物の誤町ゼロ(全fixture) = 現状の住所②は confident域で誤らない。
    pass_no_confident_wrong: sumWrong === 0,
  };
}

// ★感度自己テスト★: 第1 fixtureに+50m誤snapを注入し M_wrong_confident>0 を要求。
//   「あいまい判定をsnap位置依存にする」等の退行でゲートが空虚化したら ここで検出する。
function sensitivitySelfTest(pref) {
  const r = runAddr2Gate({
    pref: pref || DEFAULT_PREF,
    fixture: FIXTURES[0],
    injectSnapOffsetM: 50,
  });
  return {
    injected_m: 50,
    wrong_confident: r.M_wrong_confident,
    sensitive: r.M_wrong_confident > 0,
  };
}

if (require.main === module) {
  const all = runAll({});
  console.log('=== 住所②スナップ精度 自動採点ゲート (人手ラベル不要・町ポリゴンが正解) ===');
  console.log(
    '  正解=生GPSの町(独立オラクル) / 表示=最新snapの町 / 町境あいまい(GPS精度ぶん)は除外'
  );
  console.log('');
  for (const r of all.per_fixture) {
    if (r.error) {
      console.log('  ✗ ' + r.fixture + ' : ERROR ' + r.error);
      continue;
    }
    console.log('  ── ' + r.fixture + ' ──');
    console.log(
      '     総点 ' +
        r.total_points +
        ' / 町PIP被覆 ' +
        r.pip_coverage_pct +
        '% / 評価可能 ' +
        r.evaluable_points +
        ' (あいまい除外 ' +
        r.ambiguous_excluded +
        ')'
    );
    console.log(
      '     ★M_correct ' +
        r.M_correct_pct +
        '% / ★M_wrong_confident ' +
        r.M_wrong_confident +
        '点(' +
        r.M_wrong_confident_pct +
        '%) / chatter ' +
        r.M_chatter +
        ' / distance_m ' +
        r.distance_m +
        'm'
    );
  }
  console.log('');
  console.log('  ═══ 集計 ═══');
  console.log('   評価可能点(全fixture): ' + all.agg_evaluable);
  console.log('   ★正答率: ' + all.agg_correct_pct + '%');
  console.log('   ★本物の誤町(confident wrong)合計: ' + all.agg_wrong_confident + '点');
  console.log('');
  console.log(
    all.pass_no_confident_wrong
      ? '★PASS★ — confident域(オラクル確実)で住所②の誤町ゼロ。現エンジンは住所②を既に正しく出している。'
      : '☆要確認☆ — confident域で誤町あり。native強化の対象(本ゲートで改善を実数検証可)。'
  );
  // 感度自己テスト: +50m誤snapで誤町>0 でないと、本ゲートは空虚=信用できない
  const st = sensitivitySelfTest();
  console.log(
    '  [感度自己テスト] +' +
      st.injected_m +
      'm誤snap注入→誤町 ' +
      st.wrong_confident +
      '点 : ' +
      (st.sensitive ? '✓ゲートはfail能力あり(100%は空虚でない)' : '✗ゲート空虚=要修正')
  );
  if (!st.sensitive) {
    console.error('★FATAL★ 感度自己テスト失敗: ゲートが誤snapを検出できない。空虚な100%。');
    process.exit(1);
  }
  console.log('');
  console.log('  ※用途: native強化(候補K/heading等)のflagを入れたら本ゲートで M_correct↑/誤町↓ を');
  console.log(
    '    「安定だが誤り」に騙されず実数検証する。proxy限界=正解はGPS町粒度(最終確定は実機)。'
  );
  console.log('');
  console.log(JSON.stringify(all, null, 2));
}

module.exports = { runAddr2Gate, runAll, _findTownPolygonAddress, loadTownBundle };
