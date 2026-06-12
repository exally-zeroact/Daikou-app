// tests/replay-realtrace/clocked-harness.js
// ★テストツール対応 (2026-06-07): 実機 trace を「時刻注入」で忠実再生するハーネス。
//   背景: meter.js(Date.now×19) と map-matcher.js(Date.now×17) は wall-clock 依存
//   (drain window / mm_silent stall 検知 / elapsed 等)。バッチ高速再生だと時刻が進まず
//   実機の「出だしラグ(cold drain)」「走行中の止まり(stall)」が再現されず、緑でも実機で過小になる。
//   本ハーネス: 共有クロックを meter / map-matcher 両 context に注入し、各サンプルの実時刻 t に
//   進めてから投入する。gps-worker は now 駆動なので注入不要。実コードを通す(再実装禁止)。
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createGpsWorker } = require('../worker/gps-worker-sim');

const JS_DIR = path.join(__dirname, '..', '..', 'js');

// ── 共有クロック (set した t を Date.now()/performance.now() が返す) ──
function makeClock() {
  const RealDate = Date;
  let _t = RealDate.now();
  function MockDate(...a) {
    return a.length ? new RealDate(...a) : new RealDate(_t);
  }
  MockDate.now = () => _t;
  MockDate.UTC = RealDate.UTC;
  MockDate.parse = RealDate.parse;
  MockDate.prototype = RealDate.prototype;
  return {
    Date: MockDate,
    set: (t) => {
      _t = t;
    },
    get: () => _t,
  };
}

function baseCtx(clock, debug) {
  return {
    console: debug ? console : { log() {}, warn() {}, error() {} },
    Date: clock.Date,
    Math,
    JSON,
    Map,
    Set,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
    ArrayBuffer,
    DataView,
    Buffer,
    Promise,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    performance: { now: () => clock.get() },
    dlog: () => {},
  };
}

// ── meter.js を clock 注入で load (runner.loadMeter 同等 + Date 差替) ──
function loadMeterClocked(clock, debug) {
  const haversineM = (lat1, lng1, lat2, lng2) => {
    if (lat1 === lat2 && lng1 === lng2) return 0;
    const R = 6371000,
      tr = Math.PI / 180;
    const dLat = (lat2 - lat1) * tr,
      dLng = (lng2 - lng1) * tr;
    const a =
      Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * tr) * Math.cos(lat2 * tr) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };
  const ctx = baseCtx(clock, debug);
  ctx.GPS = {
    calcDistance: haversineM,
    calcDistance3D: (la, lo, _a, lb, lob) => haversineM(la, lo, lb, lob),
    setRoadType: () => {},
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  const src =
    fs.readFileSync(path.join(JS_DIR, 'meter.js'), 'utf8') + '\n;globalThis.Meter = Meter;\n';
  vm.runInContext(src, ctx, { filename: 'js/meter.js' });
  return ctx.Meter;
}

// ── map-matcher.js を clock 注入で load (worker-sim 同等 + Date 差替) ──
function createMapMatcherClocked(clock, debug) {
  const ctx = baseCtx(clock, debug);
  const listeners = [];
  ctx.navigator = { onLine: false };
  ctx.fetch = () => Promise.reject(new Error('fetch disabled'));
  ctx.self = ctx;
  ctx.globalThis = ctx;
  ctx.postMessage = function (msg) {
    for (const l of listeners) {
      try {
        l({ data: msg });
      } catch (_) {
        /* noop */
      }
    }
  };
  ctx.importScripts = function (...files) {
    for (const f of files) {
      vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), ctx, { filename: 'js/' + f });
    }
  };
  ctx.addEventListener = function (type, handler) {
    if (type === 'message') {
      const prev = ctx.onmessage;
      ctx.onmessage = (e) => {
        if (prev) prev(e);
        handler(e);
      };
    }
  };
  ctx.removeEventListener = function () {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(JS_DIR, 'map-matcher.js'), 'utf8'), ctx, {
    filename: 'js/map-matcher.js',
  });
  return {
    sendMessage(msg) {
      if (typeof ctx.onmessage !== 'function') throw new Error('map-matcher onmessage 未設定');
      ctx.onmessage({ data: msg });
    },
    on(cb) {
      listeners.push(cb);
    },
  };
}

function adapter(mm) {
  const hs = [];
  mm.on((e) => {
    for (const h of hs) h(e);
  });
  return {
    addEventListener(t, h) {
      if (t === 'message') hs.push(h);
    },
    removeEventListener() {},
    postMessage(m) {
      mm.sendMessage(m);
    },
  };
}

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
  rounding: 10,
  autoSurcharges: {},
  vehicles: [],
  vehiclesEnabled: false,
  wait: { enabled: false, freeMins: 5, ratePerMin: 100 },
};

// roadsData: data/roads-{pref}.js の ROADS object。samples: 1業務分の生GPS列。
function runRealTraceBusiness(samples, opts) {
  opts = opts || {};
  const platform = opts.platform || 'ios';
  const roadsData = opts.roadsData;
  const clock = makeClock();
  const t0 = samples[0].t;
  clock.set(t0);

  const gw = createGpsWorker({ debug: false });
  gw.sendMessage({ type: 'init', data: { config: opts.gpsWorkerConfig || {}, debug: false } });

  const mm = createMapMatcherClocked(clock, false);
  let _loaded = false;
  mm.on((e) => {
    if (e.data && e.data.type === 'roadsLoaded') _loaded = e.data.ok;
  });

  const Meter = loadMeterClocked(clock, false);
  Meter.setFareConfig(FARE);
  Meter.reset();
  const ad = adapter(mm);
  Meter.setMapMatcher(ad);
  if (platform !== 'android') ad.postMessage({ type: 'configPlatform', isIOS: true });
  // ★(B)再現: roadsReadyAfterMs で「代行開始時に現在県の道路が未ロード」を模擬。
  //   遅延中は loadRoads 未送信 → map-matcher に道路無し → Meter は Worker B に post しても
  //   snap 不可で pipelineDelta 出ず = 序盤の走行距離が計上されない(実機の出だしラグ/止まり)。
  const roadsDelayMs = opts.roadsReadyAfterMs || 0;
  let roadsSent = false;
  const sendRoadsIfDue = (nowT) => {
    if (roadsSent) return;
    if (nowT - t0 >= roadsDelayMs) {
      ad.postMessage({ type: 'loadRoads', pref: roadsData.prefecture, roadsData });
      roadsSent = true;
    }
  };

  // ★warmup GPS 供給 (2026-06-08)★: 実機は業務開始 ★前★ から待機中 GPS が流れ続け、
  //   index.html は常時 Meter.updateGpsOnly(g) + Meter.update(g) を呼ぶ (P3: 業務外でも
  //   Worker B に GPS が流れ MM がウォームアップ・running=false なので課金加算なし)。
  //   旧ハーネスはこれを供給せず毎回コールドスタートで測っており、iPhone13 業務1 が
  //   実機 (-2.5%) より悪い -4.2% に出る ★検証側の人工値★ を作っていた。
  //   opts.warmupSamples (業務開始前の生サンプル列) を本番同様に流してから業務開始する。
  //   道路は実機では待機中にロード済 → 遅延注入なし (roadsDelayMs=0) なら warmup 開始時にロード。
  const warmup = Array.isArray(opts.warmupSamples) ? opts.warmupSamples : [];
  if (roadsDelayMs === 0) {
    const wuT0 = warmup.length ? warmup[0].t : t0;
    clock.set(wuT0);
    ad.postMessage({ type: 'loadRoads', pref: roadsData.prefecture, roadsData });
    roadsSent = true;
  }
  let _wuPrevRaw = null;
  const _wuHav = (x) => {
    if (x.spd >= 0) return x.spd * 3.6;
    if (_wuPrevRaw) {
      const dt = (x.t - _wuPrevRaw.t) / 1000;
      if (dt > 0 && dt < 10) {
        const R = 6371000,
          tr = Math.PI / 180;
        const dLat = (x.lat - _wuPrevRaw.lat) * tr,
          dLng = (x.lng - _wuPrevRaw.lng) * tr;
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(_wuPrevRaw.lat * tr) * Math.cos(x.lat * tr) * Math.sin(dLng / 2) ** 2;
        const dM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const kmh = (dM / dt) * 3.6;
        if (isFinite(kmh) && kmh > 0) return Math.min(kmh, 180);
      }
    }
    return 0;
  };
  for (const x of warmup) {
    clock.set(x.t);
    sendRoadsIfDue(x.t);
    const nb = gw.getResults().length;
    const _k = _wuHav(x);
    _wuPrevRaw = { lat: x.lat, lng: x.lng, t: x.t };
    gw.sendMessage({
      type: 'position',
      data: {
        lat: x.lat,
        lng: x.lng,
        accuracy: x.acc,
        speedKmh: _k,
        heading: x.hdg >= 0 ? x.hdg : null,
        altitude: x.alt || 0,
        now: x.t,
        compassHeading: x.compass != null ? x.compass : null,
        accelData: null,
        accelSamples: x.accel || [],
        gyroData: null,
        gyroSamples: x.gyro ? [x.gyro] : [],
        speedSrc: x.spd >= 0 ? 'dop' : 'hav',
      },
    });
    const r = gw.getResults();
    if (r.length > nb) {
      const o = r[r.length - 1];
      const g = {
        lat: o.lat,
        lng: o.lng,
        accuracy: o.accuracy != null ? o.accuracy : x.acc,
        speedKmh: o.speedKmh != null ? o.speedKmh : _k,
        speedSrc: o.speedSrc != null ? o.speedSrc : x.spd >= 0 ? 'dop' : 'hav',
        headingDeg: x.hdg >= 0 ? x.hdg : null,
        altitude: 0,
        timestamp: x.t,
        isStationary: o.isStationary,
        accelSamples: x.accel || null,
        compassHeading: x.compass != null ? x.compass : null,
      };
      if (typeof Meter.updateGpsOnly === 'function') Meter.updateGpsOnly(g); // 実機 L6799 同等
      Meter.update(g); // 実機 L6811 同等 (running=false なので加算なし・Worker B ウォームアップ)
    }
  }

  clock.set(t0);
  sendRoadsIfDue(t0); // 遅延注入時 (loadfill 検証) は従来どおり業務開始基準
  if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
  Meter.start(); // ★drain は 0 化しない=実機どおり (warmup 供給時は warm 始動 = softReset 経路)

  let emitted = 0,
    rejected = 0,
    statn = 0;
  // ★忠実再生修正 (2026-06-07)★: 本番 gps.js (L538-550) は ★欠落 Doppler (spd<0) を
  //   haversine 代用速度 ('hav'・前raw点との chord/dt・180km/h clamp) で置換★ して worker へ送る。
  //   旧ハーネスは -1→0 (=停止扱い) で食わせており、平滑モードの never-over cap (spd×dt×1.5) が
  //   業務開始直後の Doppler 欠落区間 (GPS warmup) の実走行 chord を 0 化 = SE 業務1 で -69m の
  //   ★ハーネス側人工過小★ を作っていた。gps.js と同一の代用則で再現する。
  const HAVER_SPEED_MAX_KMH = 180; // gps.js _HAVER_SPEED_MAX_KMH と同値
  let _rawPrev = null;
  const havSpeedKmh = (x) => {
    if (x.spd >= 0) return x.spd * 3.6; // Doppler あり
    if (_rawPrev) {
      const dt = (x.t - _rawPrev.t) / 1000;
      if (dt > 0 && dt < 10) {
        const R = 6371000,
          tr = Math.PI / 180;
        const dLat = (x.lat - _rawPrev.lat) * tr,
          dLng = (x.lng - _rawPrev.lng) * tr;
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(_rawPrev.lat * tr) * Math.cos(x.lat * tr) * Math.sin(dLng / 2) ** 2;
        const dM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const kmh = (dM / dt) * 3.6;
        if (isFinite(kmh) && kmh > 0) return Math.min(kmh, HAVER_SPEED_MAX_KMH);
      }
    }
    return 0;
  };
  for (const x of samples) {
    clock.set(x.t); // ★各サンプルの実時刻にクロックを進める=drain/stall を実機どおり
    sendRoadsIfDue(x.t); // ★道路ロード遅延が明けたら loadRoads 発火((B)再現)
    const nb = gw.getResults().length;
    const _spdKmh = havSpeedKmh(x);
    _rawPrev = { lat: x.lat, lng: x.lng, t: x.t };
    gw.sendMessage({
      type: 'position',
      data: {
        lat: x.lat,
        lng: x.lng,
        accuracy: x.acc,
        speedKmh: _spdKmh,
        heading: x.hdg >= 0 ? x.hdg : null,
        altitude: x.alt || 0,
        now: x.t,
        compassHeading: x.compass != null ? x.compass : null,
        accelData: null,
        accelSamples: x.accel || [],
        gyroData: null,
        gyroSamples: x.gyro ? [x.gyro] : [],
        speedSrc: x.spd >= 0 ? 'dop' : 'hav', // gps.js _speedSrc と同一則
      },
    });
    const r = gw.getResults();
    if (r.length > nb) {
      emitted++;
      const o = r[r.length - 1];
      if (o.isStationary) statn++;
      Meter.update({
        lat: o.lat,
        lng: o.lng,
        accuracy: o.accuracy != null ? o.accuracy : x.acc,
        speedKmh: o.speedKmh != null ? o.speedKmh : x.spd >= 0 ? x.spd * 3.6 : 0,
        speedSrc: o.speedSrc != null ? o.speedSrc : x.spd >= 0 ? 'dop' : 'hav', // ★speedSrc 貫通
        headingDeg: x.hdg >= 0 ? x.hdg : null,
        altitude: 0,
        timestamp: x.t,
        isStationary: o.isStationary,
        accelSamples: x.accel || null,
      });
    } else rejected++;
  }
  clock.set(samples[samples.length - 1].t);
  if (typeof Meter.businessEnd === 'function') Meter.businessEnd();
  const s = Meter.getState();
  return {
    business_distance_m: s.business_distance_m || 0,
    distance_m: s.distance_m || 0,
    emitted,
    rejected,
    stationary: statn,
  };
}

// 業務別分割 (it==1 連続セグメント)
function splitBusinesses(arr) {
  const out = [];
  let cur = null;
  for (const x of arr) {
    if ((x.biz || {}).it === 1) {
      if (!cur) {
        cur = [];
        out.push(cur);
      }
      cur.push(x);
    } else cur = null;
  }
  return out;
}

function appTdKm(seg) {
  return ((seg[seg.length - 1].biz.td || 0) - (seg[0].biz.td || 0)) / 1000;
}

// ★warmup 抽出 (2026-06-08)★: 業務セグメント開始前 sec 秒の生サンプル (biz 状態問わず) を返す。
//   実機の「待機中 GPS が流れ続けている」状態を runRealTraceBusiness の opts.warmupSamples へ。
function warmupBefore(arr, seg, sec) {
  const t0 = seg[0].t;
  const from = t0 - sec * 1000;
  return arr.filter((x) => x && Number.isFinite(x.lat) && x.t >= from && x.t < t0);
}

module.exports = { runRealTraceBusiness, splitBusinesses, appTdKm, makeClock, warmupBefore };
