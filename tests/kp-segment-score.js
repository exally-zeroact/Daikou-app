#!/usr/bin/env node
'use strict';
// ★KP区間 真距離採点ハーネス (2026-06-10)★
//   国道196号のキロポスト(RTK実測座標・imabari-196-kp-rtk.json)を真距離アンカーに、
//   走行traceの「区間」を切り出して ダイコメ距離 / OBD∫v を 真距離(KP差km) と突き合わせ採点する。
//   真距離 = |KP終 - KP始| km (= 官製道路チェーニジ・測量不要の既知値)。
//   座標はRTK実測なので、GPSログから各KPの通過点をピタリ特定できる。
//
// 使い方:
//   node tests/kp-segment-score.js <traceFile> <kpStart> <kpEnd> [--k=1.04]
//   例: node tests/kp-segment-score.js fixtures/0610-Android.json 22 32 --k=1.04
//
// 出力:
//   ・各KPへの最接近距離(=本当にその区間を走ったかの確認。大きければ未通過)
//   ・区間真距離 / ダイコメ距離(biz.td) / 生GPS弦長
//   ・★raw ∫v(OBD・k=1)★ = 今のOBDの素の精度(司さん要望・真距離突合用)
//   ・★OBD×k(適用後)★ = 車別補正kを掛けたOBD距離(暫定k≈1.04。距離標走行で確定)
//   ・自動推定k(=trueKm/rawObdKm) も併記
//   ・各誤差% と −4%〜0%バンド判定(過大不可=認定失格)

const fs = require('fs');
const path = require('path');

// ★k オプション(車別OBD補正係数)★: --k=1.04 で OBD×k 行を出す。未指定は 1.0(=raw のみ)。
function parseK(argv) {
  for (const a of argv) {
    const m = /^--k=([0-9.]+)$/.exec(a);
    if (m) return parseFloat(m[1]);
  }
  return null;
}

function hav(a, b, c, d) {
  const R = 6371000,
    r = Math.PI / 180;
  const dLat = (c - a) * r,
    dLng = (d - b) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const KP_FILE = path.join(__dirname, 'fixtures', 'imabari-196-kp-rtk.json');
const kpData = JSON.parse(fs.readFileSync(KP_FILE, 'utf8'));
const KP = {};
for (const p of kpData.kp) KP[p.kp] = p;

const traceArg = process.argv[2];
const kpStart = +process.argv[3];
const kpEnd = +process.argv[4];
const K_OPT = parseK(process.argv.slice(5)); // 暫定 k≈1.04 (車別・距離標走行で確定)
if (!traceArg || !Number.isFinite(kpStart) || !Number.isFinite(kpEnd)) {
  console.log('usage: node tests/kp-segment-score.js <traceFile> <kpStart> <kpEnd>');
  process.exit(1);
}
if (!KP[kpStart] || !KP[kpEnd]) {
  console.log('指定KPが座標表に無い。利用可能: ' + Object.keys(KP).join(','));
  process.exit(1);
}

const tracePath = path.isAbsolute(traceArg) ? traceArg : path.join(__dirname, traceArg);
let samples = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
samples = samples
  .filter((x) => x && Number.isFinite(x.lat) && Number.isFinite(x.lng))
  .sort((a, b) => (a.t || 0) - (b.t || 0));

// 各KPへの最接近サンプル(通過点)を探す
function nearest(kp) {
  const P = KP[kp];
  let best = Infinity,
    idx = -1;
  for (let i = 0; i < samples.length; i++) {
    const d = hav(samples[i].lat, samples[i].lng, P.lat, P.lng);
    if (d < best) {
      best = d;
      idx = i;
    }
  }
  return { idx, dist: best, t: samples[idx] ? samples[idx].t : null };
}

const nStart = nearest(kpStart);
const nEnd = nearest(kpEnd);
let iA = nStart.idx,
  iB = nEnd.idx;
if (iA > iB) {
  const t = iA;
  iA = iB;
  iB = t;
} // 時系列順に
const seg = samples.slice(iA, iB + 1);

// 真距離 = KP差(km)
const trueKm = Math.abs(kpEnd - kpStart);

// ダイコメ距離(biz.td差) over 区間
const tdA = seg[0].biz && typeof seg[0].biz.td === 'number' ? seg[0].biz.td : null;
const tdB =
  seg[seg.length - 1].biz && typeof seg[seg.length - 1].biz.td === 'number'
    ? seg[seg.length - 1].biz.td
    : null;
const daikomeKm = tdA != null && tdB != null ? (tdB - tdA) / 1000 : null;

// 生GPS弦長(連続haversine) over 区間
let gpsM = 0;
for (let i = iA + 1; i <= iB; i++)
  gpsM += hav(samples[i - 1].lat, samples[i - 1].lng, samples[i].lat, samples[i].lng);

// OBD ∫v over 区間 (台形・dt<10s)
let obdM = 0,
  obdN = 0;
for (let i = iA + 1; i <= iB; i++) {
  const p = samples[i],
    q = samples[i - 1];
  const dt = (p.t - q.t) / 1000;
  if (dt <= 0 || dt > 10) continue;
  const o0 = typeof q.obd === 'number' && q.obd >= 0 ? q.obd : null;
  const o1 = typeof p.obd === 'number' && p.obd >= 0 ? p.obd : null;
  if (o0 == null || o1 == null) continue;
  obdM += ((o0 + o1) / 2 / 3.6) * dt;
  obdN++;
}
const obdKm = obdM > 0 ? obdM / 1000 : null; // ★raw ∫v(OBD・k=1)★ = OBD素の精度
const kAuto = obdKm ? trueKm / obdKm : null; // 自動推定 k (= 真距離合わせ込み係数)
// ★OBD×k(車別補正適用後)★: 暫定 k(--k=) を掛けた距離。指定が無ければ自動推定k で参考表示。
const kApplied = K_OPT != null ? K_OPT : null;
const obdKmK = obdKm != null && kApplied != null ? obdKm * kApplied : null;

function pct(v) {
  return v == null ? '—' : ((v / trueKm - 1) * 100).toFixed(2) + '%';
}
function band(v) {
  if (v == null) return '—';
  const e = (v / trueKm - 1) * 100;
  return e >= -4 && e <= 0 ? '✓合格' : e > 0 ? '✗過大(失格)' : '✗過小';
}

console.log(
  '=== KP区間 真距離採点: ' +
    path.basename(tracePath) +
    ' / KP' +
    kpStart +
    '→KP' +
    kpEnd +
    ' ===\n'
);
console.log('真距離(KP差・官製道路距離) = ' + trueKm.toFixed(3) + ' km\n');
console.log('通過検出:');
console.log(
  '  KP' +
    kpStart +
    ' 最接近 ' +
    nStart.dist.toFixed(0) +
    'm  KP' +
    kpEnd +
    ' 最接近 ' +
    nEnd.dist.toFixed(0) +
    'm'
);
if (nStart.dist > 60 || nEnd.dist > 60) {
  console.log(
    '  ⚠️ 最接近が60m超 = このtraceはこのKP区間を通っていない可能性大(座標確認 or 別区間)。\n'
  );
} else {
  console.log('  ✓ 両KPとも近接 = この区間を通過している\n');
}
console.log('区間サンプル数=' + seg.length + '\n');
console.log('項目        | 距離       | vs真距離 | 判定');
console.log('-----------|-----------|---------|--------');
console.log(
  'ダイコメ      | ' +
    (daikomeKm != null ? daikomeKm.toFixed(3) + 'km' : '—').padEnd(11) +
    ' | ' +
    pct(daikomeKm).padStart(7) +
    ' | ' +
    band(daikomeKm)
);
console.log(
  '生GPS弦長     | ' +
    ((gpsM / 1000).toFixed(3) + 'km').padEnd(11) +
    ' | ' +
    pct(gpsM / 1000).padStart(7) +
    ' | ' +
    band(gpsM / 1000)
);
console.log(
  'OBD raw∫v(k=1)| ' +
    (obdKm != null
      ? (obdKm.toFixed(3) + 'km(' + obdN + '点)').padEnd(11) +
        ' | ' +
        pct(obdKm).padStart(7) +
        ' | ' +
        band(obdKm)
      : '— (OBD無し・iPhone)')
);
if (obdKmK != null) {
  console.log(
    'OBD×k=' +
      kApplied.toFixed(2).padEnd(5) +
      ' | ' +
      (obdKmK.toFixed(3) + 'km').padEnd(11) +
      ' | ' +
      pct(obdKmK).padStart(7) +
      ' | ' +
      band(obdKmK)
  );
}
if (kAuto != null)
  console.log(
    '\n→ 自動推定 OBD校正値 k = ' +
      kAuto.toFixed(4) +
      ' (raw∫vにこれを掛けると区間真距離に一致 = この車の k 候補)'
  );
if (kApplied != null && kAuto != null && Math.abs(kApplied - kAuto) > 0.02) {
  console.log(
    '  ⚠️ 指定 k=' +
      kApplied.toFixed(3) +
      ' と 自動推定 k=' +
      kAuto.toFixed(3) +
      ' が乖離 (>0.02)。OBD×k が過大/過小方向にズレている可能性。'
  );
}
console.log(
  '\n※DM Lightは走行後に1回読んだ合計値を別途この真距離と突き合わせる(区間採点は走行設計次第)。'
);
