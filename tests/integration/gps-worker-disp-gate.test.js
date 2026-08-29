// ★物差し★ 2026-08-28 … ★画面の見え方の線（display ≤ distance_m）で 判定しています★
//   ・見ているのは ★画面の数字が 課金距離を 先取りしないか★（この file 自身に そう書いてある）
//   ・★距離そのもの（いくら取るか）の採点では ありません★。
//   ・タクシー認定モード（過大不可）／代行モード（天井 +0.5〜6%）の どちらの線でも ありません。
// tests/integration/gps-worker-disp-gate.test.js
//
// ★設計変更宣言 (2026-06-06・監査 wf_1cd1ef59 + 司さん指摘「端末で分けるな・全端末で出る条件」)★:
//   低速徐行が加速度variance小で isStationary=true に誤分類されると accuracy ゲートが厳格 base になり、
//   屋内の中程度精度(acc20-35m)の ★実走行点★ が棄却され距離が過小化する(実機: 04:33でSE・別夜でiPhone13)。
//   端末別ではなく ★条件★(低速徐行)で出るため、生GPS軌跡(全点)の継続前進で「徐行=移動」を判定し
//   accuracy を緩和する。真静止は net 変位が伸びず厳格維持(過大保険温存)。本テストは gps-worker を
//   実走させ ①徐行の救済(ゲートON で emit 増) ②真静止の非救済(creep防止) を恒久ガードする。
//
// 絶対ルール: distance_m/calcFare 不可侵・creep は MM 側 spd ゲートが死守(本ゲートは accuracy 緩和のみ)。

'use strict';

const path = require('path');
const { createGpsWorker } = require('../worker/gps-worker-sim');

// 低variance accel (平置きスマホ相当 = isStationary 候補にする)
function steadyAccel(t0) {
  const a = [];
  for (let k = 0; k < 20; k++) a.push({ x: 0.1, y: 0.1, z: 9.8, t: t0 + k * 50 });
  return a;
}

function runWorker(samples, cfg) {
  const w = createGpsWorker({ debug: false });
  w.sendMessage({ type: 'init', data: { config: cfg || {}, debug: false } });
  let emit = 0;
  for (const s of samples) {
    const nb = w.getResults().length;
    w.sendMessage({
      type: 'position',
      data: {
        lat: s.lat,
        lng: s.lng,
        accuracy: s.acc,
        speedKmh: s.spd != null ? s.spd : 0,
        heading: null,
        altitude: 0,
        now: s.t,
        compassHeading: null,
        accelData: null,
        accelSamples: s.accel,
        gyroData: null,
        gyroSamples: [],
        speedSrc: 'dop',
      },
    });
    if (w.getResults().length > nb) emit++;
  }
  return emit;
}

const OFF = { disp_window: 999999 }; // 実質ゲート無効化(従来挙動)

describe('gps-worker 変位継続性ゲート (端末非依存・条件ベース)', () => {
  it('CONFIG に disp_window/disp_net_m が存在', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'gps-worker.js'), 'utf8');
    expect(/disp_window:\s*\d+/.test(src)).toBe(true);
    expect(/disp_net_m:\s*\d+/.test(src)).toBe(true);
    // 全点バッファ更新(accept限定でない=屋内開始でも発火)・accuracy緩和判定の存在
    expect(/__rawDispBuf\.push/.test(src)).toBe(true);
    expect(/__relaxAcc\s*=\s*!isStationary\s*\|\|\s*__movingByDisp/.test(src)).toBe(true);
  });

  it('★徐行(継続前進・中程度精度 acc28m)はゲートONで救済される(emit増)', () => {
    // 12km/h ≈ 3.33m/s で直進。disp_window=4 は 3 区間(3秒)= net ≈ 10m > disp_net_m(6) → 徐行と判定。
    const t0 = 1780000000000;
    const samples = [];
    for (let i = 0; i < 30; i++) {
      samples.push({
        lat: 33.84 + i * 3.0e-5,
        lng: 132.77,
        t: t0 + i * 1000,
        acc: 28,
        spd: 12,
        accel: steadyAccel(t0 + i * 1000),
      });
    }
    const on = runWorker(samples, {}); // 既定(ゲートON)
    const off = runWorker(samples, OFF); // ゲート無効
    // ゲートONは徐行を移動扱いして acc28(≤35)を受理 → emit が無効化版より多い(救済)。
    expect(on).toBeGreaterThan(off);
  });

  it('★真静止(net変位 disp_net_m未満・acc28m)はゲートONでも緩和しない', () => {
    // 同位置に ±0.8m の微小ジッタのみ → 4点 net < disp_net_m(6) → ゲートは徐行と誤認しない。
    const t0 = 1780000000000;
    const jit = [7e-6, -7e-6, 5e-6, -6e-6, 7e-6, -5e-6];
    const samples = [];
    for (let i = 0; i < 30; i++) {
      samples.push({
        lat: 33.84 + jit[i % jit.length],
        lng: 132.77 + jit[(i + 2) % jit.length],
        t: t0 + i * 1000,
        acc: 28,
        spd: 0,
        accel: steadyAccel(t0 + i * 1000),
      });
    }
    const on = runWorker(samples, {});
    const off = runWorker(samples, OFF);
    // 真静止は net が伸びず緩和されない → ゲートON/OFF で emit 同数(余計な救済をしない)。
    expect(on).toBe(off);
  });
});
