#!/usr/bin/env node
'use strict';
// tests/tools/calib-1km-validate.js
// ★確定方式の検証ツール(2026-06-26・テスト先行)★
//   最終確定方式 [[project_daikome_distance_method_DECIDED_2026-06-26]] を実データで採点する:
//     ① 最初の良GPS 1km で K=(GPS距離)÷(OBD∫v) を学習(=ユーザーが1km走る初期較正)
//     ② 以降の距離 = Σ( OBDが有効なら OBD速度×dt×K / OBDが欠落なら GPS弦 )  ← OBD∫v主体・穴はGPS
//     ③ 業務別(it=1)に距離を出し、DM Light(meta.dm_ref) と突合
//   これで「タイヤ入力なしでも1km較正でKが出て、どの業務(道)でもDMに乗るか」を数字で確認する。
//   ★read-only・本番distance_m/calcFare無改変★。
//   使い方: node tests/tools/calib-1km-validate.js [fixture] [--accmax=20] [--calibkm=1.0]
//   既定 fixture=realtrace-0617-daiko-dm.json (DM真値あり)。

const fs = require('fs');
const path = require('path');
const KCalib = require(path.join(__dirname, '..', '..', 'js', 'k-calib.js')); // ★純モジュールを検証★

function hav(a, b) {
  const R = 6371000,
    r = Math.PI / 180;
  const dla = (b.lat - a.lat) * r,
    dlo = (b.lng - a.lng) * r;
  const la = a.lat * r,
    lb = b.lat * r;
  const h = Math.sin(dla / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function parseArgs(argv) {
  const o = { file: null, accmax: 20, calibkm: 1.0 };
  for (const a of argv) {
    let m;
    if ((m = /^--accmax=([0-9.]+)$/.exec(a))) o.accmax = parseFloat(m[1]);
    else if ((m = /^--calibkm=([0-9.]+)$/.exec(a))) o.calibkm = parseFloat(m[1]);
    else if (!/^--/.test(a) && !o.file) o.file = a;
  }
  return o;
}

// ★較正K = js/k-calib.js(本番と同一モジュール)に委譲して検証★。良GPS+OBD有効ステップを渡すだけ。
function learnK(samples, accmax, calibkm) {
  const cal = KCalib.createKCalibrator({ calibKm: calibkm, accMax: accmax });
  for (let i = 1; i < samples.length; i++) {
    const p = samples[i - 1],
      c = samples[i];
    const dt = (c.t - p.t) / 1000;
    if (!(p.obd >= 0 && c.obd >= 0)) continue;
    cal.addPair(hav(p, c), (p.obd + c.obd) / 2 / 3.6, dt, c.acc); // OBD速度=台形平均(m/s)
  }
  const snap = cal.snapshot();
  if (snap.K == null) return null;
  return {
    K: snap.K,
    windows: snap.windows,
    accM: snap.accKm * 1000,
    converged: cal.confident(),
    Ks: snap.Ks,
  };
}

// 1業務の距離: OBD有効なら OBD速度×dt×K、OBD欠落なら GPS弦(飛び除外)。
function businessDistanceM(seg, K) {
  let m = 0,
    obdM = 0,
    gpsFillM = 0;
  for (let i = 1; i < seg.length; i++) {
    const p = seg[i - 1],
      c = seg[i];
    const dt = (c.t - p.t) / 1000;
    if (!(dt > 0 && dt < 5)) continue;
    if (p.obd >= 0 && c.obd >= 0) {
      const d = ((p.obd + c.obd) / 2 / 3.6) * dt * K;
      m += d;
      obdM += d;
    } else {
      const g = hav(p, c);
      if (g < 200) {
        m += g;
        gpsFillM += g;
      }
    }
  }
  return { m, obdM, gpsFillM };
}

function segmentBusinesses(S) {
  const segs = [];
  let cur = null;
  for (const x of S) {
    const it = x.biz && x.biz.it ? 1 : 0;
    if (it) {
      if (!cur) cur = [];
      cur.push(x);
    } else {
      if (cur && cur.length > 5) segs.push(cur);
      cur = null;
    }
  }
  if (cur && cur.length > 5) segs.push(cur);
  return segs;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = args.file || path.join(__dirname, '..', 'fixtures', 'realtrace-0617-daiko-dm.json');
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const S = (j.samples || j).filter((x) => x && Number.isFinite(x.lat)).sort((a, b) => a.t - b.t);
  const dm =
    j.meta && j.meta.dm_ref
      ? Object.keys(j.meta.dm_ref)
          .filter((k) => /trip\d+_km/.test(k))
          .sort()
          .map((k) => j.meta.dm_ref[k])
      : [];

  const cal = learnK(S, args.accmax, args.calibkm);
  console.log('=== 1km自動較正 検証: ' + path.basename(file) + ' ===');
  console.log('  acc<=' + args.accmax + 'm / 較正距離=' + args.calibkm + 'km');
  if (!cal) {
    console.log('  較正不可(OBD/GPS良区間なし)');
    return;
  }
  console.log(
    '  ★学習K(窓中央値) = ' +
      cal.K.toFixed(4) +
      '★ (' +
      cal.windows +
      '窓×' +
      args.calibkm +
      'km・良GPS累積' +
      (cal.accM / 1000).toFixed(1) +
      'km' +
      (cal.converged ? '' : ' ※窓<2=累積比代用') +
      ')' +
      (cal.Ks ? '  窓K=[' + cal.Ks.map((k) => k.toFixed(3)).join(',') + ']' : '')
  );
  console.log('');

  const segs = segmentBusinesses(S);
  console.log('業務 | OBD∫v×K(km) | (内OBD/GPS埋) | DM Light | vs DM | 画面値参考');
  console.log('-----|-------------|--------------|----------|-------|--------');
  const screen =
    j.meta && j.meta.daikome_screen
      ? Object.keys(j.meta.daikome_screen)
          .filter((k) => /trip\d+_km/.test(k))
          .sort()
          .map((k) => j.meta.daikome_screen[k])
      : [];
  segs.forEach((seg, i) => {
    const r = businessDistanceM(seg, cal.K, args.accmax);
    const km = r.m / 1000;
    const d = dm[i];
    const pct = d != null ? ((km / d - 1) * 100).toFixed(2) + '%' : '—';
    const sc = screen[i] != null ? screen[i].toFixed(2) + 'km' : '—';
    console.log(
      '実車' +
        (i + 1) +
        ' | ' +
        km.toFixed(3).padStart(11) +
        ' | ' +
        ('obd' + (r.obdM / 1000).toFixed(2) + '/gps' + (r.gpsFillM / 1000).toFixed(2)).padEnd(12) +
        ' | ' +
        (d != null ? d.toFixed(2) + 'km' : '—').padStart(8) +
        ' | ' +
        pct.padStart(6) +
        ' | ' +
        sc
    );
  });
  console.log('');
  console.log(
    '※K=GPS/OBD較正(=GPSスケール)。OBD∫v×K はGPS水準に乗る(DM-0.4%付近)。DM-0.2%着地は代行係数1.011(別軸)。'
  );
  console.log('※業務別にKが効いてDMに乗れば「1km較正→どの業務(道)でもDM一致」が成立。');
}
main();
