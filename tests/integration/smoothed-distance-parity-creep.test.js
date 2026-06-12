// tests/integration/smoothed-distance-parity-creep.test.js
//
// ★設計変更宣言 (2026-06-06・監査 CRITICAL-1/2/3・MAJOR-5)★:
//   smoothedRawMode (生GPS双方向スムージング距離) の本番課金経路(live tracker)を恒久ガードする。
//   監査が「batchで過大ゼロを実証しても本番=createDistanceTracker(live)が別物なら無意味(緑≠直った)」と
//   指摘した構造欠陥への対策。本テストは ON モードで:
//     ① batch(computeDistance) == tracker(ingest全点+flush) を ±0.01m で assert (parity)
//     ② 停止中 bad-accuracy ゴミ点 → distance < 5m (CRITICAL-2 汚染creep防止)
//     ③ 微速(spd=0.6)純ジッタ → Doppler cap 内 (CRITICAL-3 creep防止)
//     ④ 通常停止(spd=0/spd無し) → distance < 5m
//   を CI で常時検証する。これが破れたら本番で過大請求/creep になるため即 FAIL。

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let computeDistance, createDistanceTracker, dec;

beforeAll(() => {
  const sandbox = {
    console: console,
    atob: typeof atob !== 'undefined' ? atob : (b) => Buffer.from(b, 'base64').toString('binary'),
    Uint8Array: Uint8Array,
    TextDecoder: typeof TextDecoder !== 'undefined' ? TextDecoder : undefined,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'roads-decoder.js'), 'utf8'),
    sandbox,
    { filename: 'roads-decoder.js' }
  );
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'roads-ehime.js'), 'utf8'),
    sandbox,
    { filename: 'roads-ehime.js' }
  );
  dec = new sandbox.RoadDecoder(sandbox.ROADS_EHIME);
  dec.buildOffsetTable();
  const mod = require(path.join(__dirname, '..', '..', 'js', 'pipeline-distance.js'));
  computeDistance = mod.computeDistance;
  createDistanceTracker = mod.createDistanceTracker;
}, 60000);

const OPT = { smoothedRawMode: true, enableRouting: true };

function trackerTotal(samples) {
  const tk = createDistanceTracker(dec, OPT);
  const ordered = samples
    .filter((x) => x && Number.isFinite(x.lat))
    .slice()
    .sort((a, b) => (a.t || 0) - (b.t || 0));
  for (const s of ordered) tk.ingest(s);
  expect(typeof tk.flush).toBe('function'); // flush API 必須 (末尾h点確定)
  tk.flush();
  return tk.totalM();
}

const PARITY_FIXTURES = [
  'realtest3-Android.slim.json',
  'realtest3-iPhoneSE.slim.json',
  '0606-iPhone13.slim.json',
  '0606-Android.slim.json',
];

describe('smoothedRawMode 本番(live tracker)ガード', () => {
  it('① batch == tracker(ingest+flush) parity ±0.01m (実機fixture)', () => {
    const fails = [];
    for (const f of PARITY_FIXTURES) {
      let a;
      try {
        a = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', f), 'utf8'));
      } catch (_) {
        fails.push(f + ' READ ERR');
        continue;
      }
      a = a.filter((x) => x && Number.isFinite(x.lat)).sort((x, y) => x.t - y.t);
      const batch = computeDistance(a, dec, OPT).distance_m;
      const trk = trackerTotal(a);
      if (Math.abs(batch - trk) > 0.01)
        fails.push(
          `${f} batch=${batch.toFixed(3)} tracker=${trk.toFixed(3)} diff=${(batch - trk).toFixed(4)}`
        );
    }
    if (fails.length) throw new Error('parity 不一致:\n  ' + fails.join('\n  '));
  }, 30000);

  it('② 停止中 bad-accuracy ゴミ点 → distance < 5m (汚染creep防止)', () => {
    const base = { lat: 33.84, lng: 132.77 };
    const out = [];
    const t0 = 1780000000000;
    const jit = [3e-5, -3e-5, 2e-5, -2e-5, 4e-5, -4e-5, 1e-5, -1e-5];
    for (let i = 0; i < 40; i++) {
      if (i === 20) {
        out.push({ lat: base.lat + 0.004, lng: base.lng + 0.001, t: t0 + i * 1000, acc: 150 });
        continue;
      }
      out.push({
        lat: base.lat + jit[i % jit.length],
        lng: base.lng + jit[(i + 2) % jit.length],
        t: t0 + i * 1000,
        acc: 8,
      });
    }
    expect(computeDistance(out, dec, OPT).distance_m).toBeLessThan(5);
    expect(trackerTotal(out)).toBeLessThan(5);
  }, 20000);

  it('③ 微速 spd=0.6 純ジッタ → Doppler cap 内 (creep防止)', () => {
    const base = { lat: 33.84, lng: 132.77 };
    const out = [];
    const t0 = 1780000000000;
    const jit = [25e-5, -25e-5, 20e-5, -20e-5, 28e-5, -28e-5];
    for (let i = 0; i < 40; i++)
      out.push({
        lat: base.lat + jit[i % jit.length],
        lng: base.lng + jit[(i + 2) % jit.length],
        t: t0 + i * 1000,
        acc: 8,
        spd: 0.6,
      });
    const cap = 0.6 * 1 * 39 * 1.5 + 1; // spd*dt*ratio*segs
    expect(computeDistance(out, dec, OPT).distance_m).toBeLessThanOrEqual(cap);
    expect(trackerTotal(out)).toBeLessThanOrEqual(cap);
  }, 20000);

  it('④ 通常停止 (spd=0 / spd無し) → distance < 5m', () => {
    const mk = (withSpd) => {
      const base = { lat: 33.84, lng: 132.77 };
      const out = [];
      const t0 = 1780000000000;
      const jit = [5e-5, -5e-5, 4e-5, -6e-5, 7e-5, -4e-5];
      for (let i = 0; i < 60; i++) {
        const p = {
          lat: base.lat + jit[i % jit.length],
          lng: base.lng + jit[(i + 3) % jit.length],
          t: t0 + i * 1000,
          acc: 8,
        };
        if (withSpd) p.spd = 0;
        out.push(p);
      }
      return out;
    };
    for (const ws of [true, false]) {
      const l = mk(ws);
      expect(computeDistance(l, dec, OPT).distance_m).toBeLessThan(5);
      expect(trackerTotal(l)).toBeLessThan(5);
    }
  }, 20000);

  it('⑤ 既定 (smoothedRawMode 未指定) は従来 map-matching = tracker に flush は no-op', () => {
    const tk = createDistanceTracker(dec, { enableRouting: true });
    const r = tk.flush(); // 非smoothedでも安全(no-op)
    expect(r.totalM).toBe(0);
  });
});
