#!/usr/bin/env node
'use strict';
// ★物差し★ 2026-08-28 … ★①タクシー認定モードの線（過大ゼロ）で 判定しています★
//   ・この見張りが 赤にするのは ★distance_m ≤ 真距離（過大不可）★ を 破った時（この file 自身に そう書いてある）
//   ・★代行は 検定対象外★＝法として「真距離を超えるな」は 課されていません。
//     代行の実上限は ★DM Light／タイヤ真値 ＋0.5〜6%★ という 緩い天井（係数 1.0085 で わざと上乗せ）。
//   ⇒★ここが赤でも「代行で 過大請求している」とは 限りません★。
//     うちは ★内側の約束★として 過大ゼロを 守っています（2026-08-23 の誤読を 二度と させない為 明記）。
// tests/tools/measure-tighten-cap.js
// ★距離精度 実測ツール(2026-06-25)★: パイプライン distance_m を ドップラー(∫spd=タイヤ非依存の
//   真距離・角切りしない) と突合し、過大/過小%を出す。read-only 検証専用。
//   経緯: cap締め(平滑弦≤spd×dt)を試行→ gpstrace+1.88%は+0.27%に消えるが iPhone13/SE を
//   -1.4〜-2.0%へ過小化(never-over違反)→ 締め不採用(pipeline側 revert 済・現行cap1.5が均衡)。
//   本ツールは「実出力が真距離±何%か」を fixture/trace で測る汎用器として残す。
//   使い方: node tests/tools/measure-tighten-cap.js   (env GPS_TRACE=... / ROADS_PREF=ehime)
const fs = require('fs');
const path = require('path');
const PREF = (process.env.ROADS_PREF || 'ehime').toLowerCase();
const TRACE = process.env.GPS_TRACE || 'C:/Users/zeroa/gpstrace.json';
function loadDecoder(pref) {
  global.window = global;
  global.self = global;
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'roads-decoder.js'), 'utf8'));
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'roads-' + pref + '.js'), 'utf8'));
  const rd = global['ROADS_' + pref.toUpperCase()];
  const d = new global.RoadDecoder(rd);
  if (d.buildOffsetTable) d.buildOffsetTable();
  return d;
}
const { computeDistance } = require(path.join(__dirname, '..', '..', 'js', 'pipeline-distance.js'));
const raw = JSON.parse(fs.readFileSync(TRACE, 'utf8'));
const samples = (raw.samples || raw).filter((x) => x && x.lat != null).sort((a, b) => a.t - b.t);
const segs = [[]];
for (let i = 0; i < samples.length; i++) {
  if (i > 0 && samples[i].t - samples[i - 1].t > 120000) segs.push([]);
  segs[segs.length - 1].push(samples[i]);
}
segs.sort((a, b) => b.length - a.length);
const seg = segs[0];
const dec = loadDecoder(PREF);
let dopp = 0;
for (let i = 1; i < seg.length; i++) {
  const dt = (seg[i].t - seg[i - 1].t) / 1000;
  if (dt > 0 && dt < 5 && seg[i].spd > 0) dopp += seg[i].spd * dt;
}
const r = computeDistance(seg, dec, { enableRouting: true });
const pct = ((r.distance_m / dopp - 1) * 100).toFixed(2);
// eslint-disable-next-line no-console
console.log('ドップラー(真距離) =', dopp.toFixed(0), 'm  [基準0%]');
// eslint-disable-next-line no-console
console.log('パイプライン distance_m =', r.distance_m.toFixed(0), 'm  → 真距離比', pct + '%');
