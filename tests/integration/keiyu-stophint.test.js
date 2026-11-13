'use strict';
// tests/integration/keiyu-stophint.test.js
// ★経由を押した後の「止まった時の増え」だけ消す・トンネルは変えない（2026-11-13 司さんの直）★
//   設計＝C:/Users/zeroa/sekkei_keiyu_2026-11-13.md の v6（設計前 taiketsu 止め0）＋任意 N1〜N4。
//   直し：GPS.stopHint()（経由ボタン）→ 非OBD の穴の中なら合成点に stopHint:true →
//         meter.js → map-matcher.js → pipeline-distance.js が「足す距離だけ」0（他の計算は今と同じ）。
//   ★物差し（N4）＝同じコードで 押す／押さない の2本を比べる（写しは作らない）★
//     ・Meter に届く点の並び・時刻・速度・wait_sec・料金の待機分が同じ
//     ・距離の差＝印の点の合成の距離の和だけ（印の無い点の増えは1つ残らず同じ）
//   土台＝実 gps.js（_gapTick を setInterval ごと捕まえて回す）→ 実 meter.js（loadMeter）→
//         実 map-matcher（worker-sim）→ 実 pipeline-distance.js。走りは実機の記録（愛媛）。

const fs = require('fs');
const path = require('path');
const { createMapMatcherWorker, loadPrefRoadsData } = require('../replay-mm-worker/worker-sim');
const { loadMeter } = require('../replay-mm-worker/runner');

const GPS_JS = '../../js/gps.js';
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'realdevice-android.json');
const M_PER_DEG = 111320;
const FARE = {
  version: 2,
  base_fare: 1300,
  base_distance_m: 1000,
  add_fare: 100,
  add_distance_m: 420,
  tiers: [],
  surcharges: [],
  minFare: null,
  maxFare: null,
  wait: { enabled: true, unit_sec: 60, unit_fare: 100 },
};

let _roads = null;
const ROADS = () => (_roads = _roads || loadPrefRoadsData('ehime'));

function trace(n) {
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    .filter((x) => x && Number.isFinite(x.lat))
    .map((x) => ({
      lat: x.lat,
      lng: x.lng !== undefined ? x.lng : x.lon,
      acc: x.acc !== undefined ? x.acc : x.accuracy,
      spd: x.spd !== undefined ? x.spd : x.speed,
      t: x.t !== undefined ? x.t : x.timestamp,
    }))
    .sort((a, b) => a.t - b.t)
    .slice(0, n);
}

// ─── ① 実 gps.js を回して「Meter へ渡る点の列」を作る ───
//   実 fix は gps-worker を通る（ここでは Worker を止めてある）ので、Meter へは同じ形を自分で並べる。
//   合成点は gps.js の _gapTick が onUpdateCallback へ渡した物をそのまま使う（stopHint もそのまま）。
const GLOBALS = [
  'Date',
  'Worker',
  'navigator',
  'window',
  'self',
  'alert',
  'addEventListener',
  'document',
  'DeviceMotionEvent',
  'DeviceOrientationEvent',
  'KalmanGPS',
  'RoadDecoder',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
  'dlog',
  'DEBUG',
  'showToast',
  'FB',
  'Meter',
  'OBD_DRIVE_DISTANCE',
  'OBDClient',
];

function makeStream(scenario, { motion = 'yure', obd = false } = {}) {
  const g = globalThis;
  const saved = GLOBALS.map((k) => [k, Object.getOwnPropertyDescriptor(g, k)]);
  const stream = [];
  try {
    const S = trace(120);
    let CLOCK = Math.round(S[0].t / 10) * 10;
    const RealDate = Date;
    g.Date = class extends RealDate {
      static now() {
        return CLOCK;
      }
    };
    const ticks = [];
    const motionCbs = [];
    g.Worker = class {
      postMessage() {}
      set onmessage(_) {}
      set onerror(_) {}
      terminate() {}
      addEventListener() {}
    };
    let onPos = null;
    Object.defineProperty(g, 'navigator', {
      value: {
        userAgent: 'node',
        geolocation: {
          watchPosition: (cb) => ((onPos = cb), 1),
          clearWatch: () => {},
          getCurrentPosition: () => {},
        },
      },
      configurable: true,
      writable: true,
    });
    g.window = g;
    g.self = g;
    g.alert = () => {};
    g.addEventListener = (type, cb) => {
      if (type === 'devicemotion') motionCbs.push(cb);
    };
    g.document = { addEventListener() {}, getElementById: () => null };
    g.DeviceMotionEvent = function () {};
    g.DeviceOrientationEvent = function () {};
    g.KalmanGPS = class {};
    g.RoadDecoder = class {};
    g.setInterval = (fn) => (ticks.push(fn), ticks.length);
    g.clearInterval = () => {};
    g.setTimeout = () => 0;
    g.clearTimeout = () => {};
    g.dlog = () => {};
    g.DEBUG = { enabled: false };
    g.showToast = () => {};
    g.FB = {};
    g.Meter = {};
    let obdKmh = 0;
    g.OBD_DRIVE_DISTANCE = obd;
    g.OBDClient = obd ? { getSpeed: () => ({ valid: true, kmh: obdKmh }) } : undefined;

    const p = require.resolve(GPS_JS);
    delete require.cache[p];
    const GPS = require(GPS_JS);
    try {
      GPS.start((r) => {
        if (r && r.isSynthetic === true) stream.push(Object.assign({}, r));
      });
    } catch (_) {
      /* 一部依存の例外は onPosition/_gapTick に影響しない */
    }
    let mi = 0;
    const yure = () => {
      if (motion === 'nashi') return;
      const a = motion === 'shizuka' ? 0.01 : 1.5;
      mi++;
      const e = {
        accelerationIncludingGravity: {
          x: a * Math.sin(mi * 2.3),
          y: a * Math.cos(mi * 1.7),
          z: 9.81 + a * Math.sin(mi * 0.9),
        },
        rotationRate: { alpha: 0, beta: 0, gamma: 0 },
      };
      motionCbs.forEach((cb) => cb(e));
    };
    const susumu = (ms) => {
      for (let t = 0; t < ms; t += 10) {
        CLOCK += 10;
        if (CLOCK % 20 === 0) yure();
        if (CLOCK % 150 === 0) ticks.forEach((fn) => fn());
      }
    };
    const fix = (lat, lng, spdMps, acc = 5) => {
      const kmh = typeof spdMps === 'number' && spdMps >= 0 ? spdMps * 3.6 : null;
      obdKmh = kmh == null ? 0 : kmh;
      stream.push({
        lat,
        lng,
        accuracy: acc,
        speedKmh: kmh,
        speedSrc: kmh == null ? 'hav' : 'dop',
        timestamp: CLOCK,
        isStationary: false,
      });
      onPos({
        coords: {
          latitude: lat,
          longitude: lng,
          accuracy: acc,
          speed: spdMps,
          heading: 0,
          altitude: 0,
        },
        timestamp: CLOCK,
      });
    };
    // 実機の記録を走る（時刻の間も実機の通り）
    let last = S[0];
    for (const s of S) {
      susumu(Math.max(10, Math.round((s.t - last.t) / 10) * 10));
      fix(s.lat, s.lng, typeof s.spd === 'number' && s.spd >= 0 ? s.spd : null, s.acc || 5);
      last = s;
    }
    const ctx = {
      GPS,
      susumu,
      fix,
      setObd: (k) => (obdKmh = k),
      lat: last.lat,
      lng: last.lng,
      // 北へ m 進んだ所
      mae: (m) => (ctx.lat += m / M_PER_DEG),
    };
    scenario(ctx);
  } finally {
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  }
  return stream;
}

// ─── ② 点の列を 実 Meter＋実 map-matcher＋実 pipeline に流す ───
function runMeter(stream) {
  const worker = createMapMatcherWorker({ debug: false });
  let roadsLoaded = false;
  worker.on((e) => {
    if (e.data && e.data.type === 'roadsLoaded') roadsLoaded = e.data.ok;
  });
  const roadsData = ROADS();
  const Meter = loadMeter({ debug: false });
  Meter.setFareConfig(FARE);
  Meter.reset();
  const handlers = [];
  const posts = [];
  const seen = { mm: 0 };
  worker.on((e) => {
    if (e.data && e.data.type === 'mmResult') seen.mm++;
    for (const h of handlers) h({ data: e.data });
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
      if (msg && msg.type === 'gps') posts.push(Object.assign({}, msg));
      worker.sendMessage(msg);
    },
  };
  Meter.setMapMatcher(adapter);
  adapter.postMessage({ type: 'configPlatform', isIOS: false });
  adapter.postMessage({ type: 'loadRoads', pref: roadsData.prefecture, roadsData });
  if (!roadsLoaded) throw new Error('loadRoads FAIL');
  if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);
  const dist = [];
  for (const r of stream) {
    Meter.update(r);
    dist.push(Meter.getState().distance_m);
  }
  const st = Meter.getState();
  return {
    distance_m: st.distance_m,
    wait_sec: st.wait_sec,
    fare_yen: st.fare_yen,
    dist,
    posts,
    seen,
  };
}

const zoubun = (dist) => dist.map((d, i) => d - (i ? dist[i - 1] : 0));
const katachi = (stream) =>
  stream.map(
    (r) =>
      `${r.timestamp}|${r.lat}|${r.lng}|${r.speedKmh}|${r.speedSrc}|${r.isSynthetic === true}|${r.accuracy}`
  );
const katachiPost = (posts) =>
  posts.map((m) => {
    const c = Object.assign({}, m);
    delete c.stopHint;
    return JSON.stringify(c);
  });

// 減速しながら止まる（1秒ごと）→ 穴（GPS 途切れ）→ 同じ場所に戻る。osu＝最後の実 fix から何 ms で経由を押すか
function tomaru({ osu = null, ana = 25000 } = {}) {
  return (c) => {
    for (const k of [40, 33, 26, 20, 15]) {
      c.susumu(1000);
      c.mae(k / 3.6);
      c.fix(c.lat, c.lng, k / 3.6);
    }
    if (osu != null) {
      c.susumu(osu);
      c.GPS.stopHint();
      c.susumu(ana - osu);
    } else c.susumu(ana);
    c.mae(3);
    c.fix(c.lat, c.lng, 0);
    for (let i = 0; i < 5; i++) {
      c.susumu(1000);
      c.fix(c.lat, c.lng, 0);
    }
  };
}

// 2本（押す／押さない）を比べて、約束を全部見る
function kuraberu(oshita, oshiteinai, label) {
  const a = runMeter(oshiteinai);
  const b = runMeter(oshita);
  expect(a.seen.mm, `${label}: worker から届いていない＝何も見ていない`).toBeGreaterThan(50);
  expect(a.distance_m, `${label}: 距離が 0 のまま＝何も通っていない`).toBeGreaterThan(100);
  // Meter に届く点の並び・時刻・速度は同じ（印の字だけ違う）
  expect(katachi(oshita)).toEqual(katachi(oshiteinai));
  expect(katachiPost(b.posts)).toEqual(katachiPost(a.posts));
  // 待機と料金の待機分は1秒も違わない
  expect(b.wait_sec).toBe(a.wait_sec);
  // 距離の差＝印の点の増えの和だけ
  const za = zoubun(a.dist);
  const zb = zoubun(b.dist);
  let shirushi = 0;
  let sa = 0;
  oshita.forEach((r, i) => {
    if (r.stopHint === true) {
      shirushi++;
      sa += za[i];
      expect(zb[i], `${label}: 印の点 ${i} に距離が入った`).toBe(0);
    } else {
      expect(Math.abs(zb[i] - za[i]), `${label}: 印の無い点 ${i} の増えが変わった`).toBeLessThan(
        1e-9
      );
    }
  });
  expect(Math.abs(a.distance_m - b.distance_m - sa)).toBeLessThan(1e-6);
  expect(b.distance_m).toBeLessThanOrEqual(a.distance_m);
  return { a, b, shirushi, sa };
}

describe('★経由を押した後の止まった印（実 gps.js → 実 Meter → 実 pipeline）★', () => {
  let ROADS_READY = false;
  beforeAll(() => {
    ROADS();
    ROADS_READY = true;
  }, 120000);

  for (const motion of ['yure', 'nashi']) {
    it(`①止まる→穴の中（5秒）で押す（${motion}）＝押した後の合成の距離は 0・他は同じ`, () => {
      expect(ROADS_READY).toBe(true);
      const nashi = makeStream(tomaru(), { motion });
      const ari = makeStream(tomaru({ osu: 5000 }), { motion });
      const { shirushi, sa, a, b } = kuraberu(ari, nashi, `①${motion}`);
      expect(shirushi, '印の点が1つも無い＝直しが効いていない').toBeGreaterThan(0);
      expect(sa, '押さない時に印の点で距離が入っていない＝試験が穴を見ていない').toBeGreaterThan(1);
      expect(a.distance_m - b.distance_m).toBeGreaterThan(1);
    }, 120000);
  }

  it('①-2 穴の前（0.5秒）で押す＝押さないのと点の列も距離も全く同じ（印は立たない）', () => {
    const nashi = makeStream(tomaru());
    const ari = makeStream(tomaru({ osu: 500 }));
    expect(ari.filter((r) => r.stopHint === true).length).toBe(0);
    const { a, b } = kuraberu(ari, nashi, '①-2');
    expect(b.distance_m).toBe(a.distance_m);
    expect(b.fare_yen).toBe(a.fare_yen);
  }, 120000);

  it('③待機：押す／押さないで wait_sec と料金の待機分が1秒も違わない（止まって長く待つ）', () => {
    const matsu = (osu) => tomaru({ osu, ana: 25000 });
    const nashi = makeStream((c) => {
      matsu(null)(c);
      for (let i = 0; i < 90; i++) {
        c.susumu(1000);
        c.fix(c.lat, c.lng, 0);
      }
    });
    const ari = makeStream((c) => {
      matsu(5000)(c);
      for (let i = 0; i < 90; i++) {
        c.susumu(1000);
        c.fix(c.lat, c.lng, 0);
      }
    });
    const { a, b } = kuraberu(ari, nashi, '③');
    expect(a.wait_sec, '待機が数えられていない＝試験が待機を見ていない').toBeGreaterThan(60);
    expect(b.wait_sec).toBe(a.wait_sec);
  }, 120000);

  it('④トンネル（押さない）＝印は1つも立たない・穴の外で押しても次の穴に持ち越さない', () => {
    const tunnel = (osuSoto) => (c) => {
      if (osuSoto) c.GPS.stopHint(); // 実 fix が来ている時に押す＝穴の外
      for (let i = 0; i < 5; i++) {
        c.susumu(1000);
        c.mae(13);
        c.fix(c.lat, c.lng, 13);
      }
      c.susumu(15000);
      c.mae(195);
      c.fix(c.lat, c.lng, 13);
      for (let i = 0; i < 5; i++) {
        c.susumu(1000);
        c.mae(13);
        c.fix(c.lat, c.lng, 13);
      }
    };
    const nashi = makeStream(tunnel(false));
    const ari = makeStream(tunnel(true));
    expect(
      nashi.filter((r) => r.isSynthetic === true).length,
      '穴埋めが無い＝トンネルを見ていない'
    ).toBeGreaterThan(3);
    expect(nashi.filter((r) => r.stopHint === true).length).toBe(0);
    expect(ari.filter((r) => r.stopHint === true).length).toBe(0);
    const { a, b } = kuraberu(ari, nashi, '④');
    expect(b.distance_m).toBe(a.distance_m);
  }, 120000);

  it('⑥押した穴→精度の悪い実 fix（pipeline が落としうる）→次の穴＝印は次の穴へ持ち越さない・他は同じ（N1）', () => {
    const futatsu = (osu) => (c) => {
      for (const k of [40, 33, 26, 20, 15]) {
        c.susumu(1000);
        c.mae(k / 3.6);
        c.fix(c.lat, c.lng, k / 3.6);
      }
      if (osu) {
        c.susumu(5000);
        c.GPS.stopHint();
        c.susumu(10000);
      } else c.susumu(15000);
      c.mae(2);
      c.fix(c.lat, c.lng, 30 / 3.6, 80); // 精度 80m の実 fix＝gps.js は穴明け・pipeline は落としうる
      c.mae(10);
      c.fix(c.lat, c.lng, 30 / 3.6, 80);
      c.susumu(15000); // 次の穴（押さない）
      c.mae(60);
      for (let i = 0; i < 5; i++) {
        c.fix(c.lat, c.lng, 20 / 3.6);
        c.susumu(1000);
        c.mae(20 / 3.6);
      }
    };
    const nashi = makeStream(futatsu(false));
    const ari = makeStream(futatsu(true));
    const iBad = ari.findIndex((r) => r.accuracy === 80);
    expect(iBad).toBeGreaterThan(0);
    expect(
      ari.slice(0, iBad).filter((r) => r.stopHint === true).length,
      '押した穴に印が無い'
    ).toBeGreaterThan(0);
    expect(
      ari.slice(iBad).filter((r) => r.isSynthetic === true).length,
      '次の穴に穴埋めが無い'
    ).toBeGreaterThan(0);
    expect(
      ari.slice(iBad).filter((r) => r.stopHint === true).length,
      '印が次の穴へ持ち越した'
    ).toBe(0);
    kuraberu(ari, nashi, '⑥');
  }, 120000);

  it('⑤OBD が生きている穴で押す＝印は立たない・押さないのと全く同じ', () => {
    const nashi = makeStream(tomaru(), { obd: true });
    const ari = makeStream(tomaru({ osu: 5000 }), { obd: true });
    expect(
      nashi.filter((r) => r.isSynthetic === true && r.speedSrc === 'obd').length,
      'OBD の穴埋めが無い'
    ).toBeGreaterThan(0);
    expect(ari.filter((r) => r.stopHint === true).length).toBe(0);
    expect(katachi(ari)).toEqual(katachi(nashi));
  }, 120000);
});
