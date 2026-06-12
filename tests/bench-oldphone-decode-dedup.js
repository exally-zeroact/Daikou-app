#!/usr/bin/env node
'use strict';

// tests/bench-oldphone-perfbudget.js (旧名 bench-oldphone-decode-dedup)
// ★古スマホ「処理が重くてメーターがカクつくのか?」への実測回答 + 回帰ガード★
//
// 経緯: 古スマホ対応で ③ snap/routing decode 重複排除を「速度本丸」として実装したが、
//   実測で ★0.91x (10% 遅い)★ と判明し撤回 (routing は既に _graphCache を持つため
//   getRoadsNear はキャッシュミス時=全点の約5%しか呼ばれず、dedup の節約 < 収集 overhead)。
//   → 結論: pipeline の1点あたり compute コストは元々 1Hz 予算に対し桁違いに軽い。
//      古スマホのボトルネックは CPU ではなくメモリ (OOM)。本ベンチでそれを数字で固定する。
//
// 何を測るか: 実走 trace (seg1) を最終 pipeline-distance に流したときの「1GPS点あたり
//   処理時間」。これが 1 秒 (= 1Hz GPS 周期) に対しどれだけ余裕があるかを示す。
//   さらに古スマホ係数 (dev 比 ~4x 遅い) を掛けた最悪値も出す。
//
// 使い方: node tests/bench-oldphone-perfbudget.js   (env ROADS_PREF=ehime / GPS_TRACE=...)

const fs = require('fs');
const path = require('path');

const PREF = (process.env.ROADS_PREF || 'ehime').toLowerCase();
const TRACE_PATH = process.env.GPS_TRACE || 'C:/Users/zeroa/gpstrace.json';
const TRIP_GAP_SEC = 120;
const R = 6371000;
const OLDPHONE_SLOWDOWN = 4; // dev CPU 比 低スペック端末の単スレッド係数 (保守的)
const PERPOINT_BUDGET_MS = 5; // 1点あたり許容 (Worker B・1Hz=1000ms 予算に対し十分余裕)

function rad(x) {
  return (x * Math.PI) / 180;
}
function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function pickMainTrip(samples) {
  const s = samples
    .filter((x) => x && typeof x.lat === 'number' && typeof x.lng === 'number')
    .sort((a, b) => a.t - b.t);
  const segs = [[]];
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && s[i].t - s[i - 1].t > TRIP_GAP_SEC * 1000) segs.push([]);
    segs[segs.length - 1].push(s[i]);
  }
  let best = [];
  let bd = -1;
  for (const g of segs) {
    if (g.length < 2) continue;
    let d = 0;
    for (let i = 1; i < g.length; i++) d += haversine(g[i - 1], g[i]);
    if (d > bd) {
      bd = d;
      best = g;
    }
  }
  return best;
}

function loadDecoder(pref) {
  global.window = global;
  global.self = global;
  const decSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'roads-decoder.js'), 'utf8');
  // eslint-disable-next-line no-eval
  eval(decSrc);
  const dataFile = path.join(__dirname, '..', 'data', 'roads-' + pref + '.js');
  if (!fs.existsSync(dataFile)) throw new Error('roads データ無し: ' + dataFile);
  const dataSrc = fs.readFileSync(dataFile, 'utf8');
  // eslint-disable-next-line no-eval
  eval(dataSrc);
  const key = 'ROADS_' + pref.toUpperCase();
  const roadsData = global[key];
  if (!roadsData) throw new Error('global.' + key + ' 未定義');
  const dec = new global.RoadDecoder(roadsData);
  dec.buildOffsetTable();
  return dec;
}

function loadTrace() {
  let p = TRACE_PATH;
  if (!fs.existsSync(p)) {
    p = path.join(__dirname, 'fixtures', 'real-trace-iphone13-親-16min.json');
  }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const samples = Array.isArray(raw) ? raw : raw.samples || raw.gps || [];
  return { samples: pickMainTrip(samples), path: p };
}

function median(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

(function main() {
  const PD = require(path.join(__dirname, '..', 'js', 'pipeline-distance.js'));
  const computeDistance = PD.computeDistance;
  if (!computeDistance) throw new Error('pipeline-distance.js: computeDistance export 不足');

  const dec = loadDecoder(PREF);
  const { samples: seg, path: tracePath } = loadTrace();
  const N = seg.length;

  // warmup (JIT)
  computeDistance(seg, dec, { enableRouting: true });
  computeDistance(seg, dec, { enableRouting: true });

  const runs = [];
  let dist = 0;
  for (let i = 0; i < 7; i++) {
    const t0 = process.hrtime.bigint();
    const r = computeDistance(seg, dec, { enableRouting: true });
    const t1 = process.hrtime.bigint();
    runs.push(Number(t1 - t0) / 1e6);
    dist = r.distance_m;
  }
  const med = median(runs);
  const perPtDev = med / N; // ms/点 (dev)
  const perPtOld = perPtDev * OLDPHONE_SLOWDOWN; // ms/点 (古スマホ推定)

  console.log('trace:', tracePath, '/ seg1 点数:', N, '/ pref:', PREF);
  console.log('');
  console.log('━━━ pipeline-distance 1点あたり処理コスト (median of 7) ━━━');
  console.log('  trace 全体 (' + N + '点): ' + med.toFixed(1) + ' ms');
  console.log('  dev      : ' + (perPtDev * 1000).toFixed(0) + ' µs/GPS点');
  console.log(
    '  古スマホ推定 (' + OLDPHONE_SLOWDOWN + 'x): ' + (perPtOld * 1000).toFixed(0) + ' µs/GPS点'
  );
  console.log('');
  console.log('━━━ 1Hz (1000ms/GPS点) 予算に対する占有率 ━━━');
  console.log('  dev      : ' + ((perPtDev / 1000) * 100).toFixed(2) + ' %');
  console.log('  古スマホ : ' + ((perPtOld / 1000) * 100).toFixed(2) + ' %');
  console.log('  (Worker B 上で実行 = メインスレッド/描画は別。占有率は予算比)');
  console.log('');
  console.log('  distance_m = ' + dist + ' (= 課金距離・回帰確認用)');

  if (perPtOld > PERPOINT_BUDGET_MS) {
    console.error(
      '\n❌ FAIL: 古スマホ推定 ' +
        perPtOld.toFixed(2) +
        ' ms/点 が予算 ' +
        PERPOINT_BUDGET_MS +
        ' ms/点 超過 = compute がカクつき要因になりうる。'
    );
    process.exit(1);
  }
  console.log(
    '\n✅ PASS: 古スマホでも ' +
      perPtOld.toFixed(2) +
      ' ms/点 (予算 ' +
      PERPOINT_BUDGET_MS +
      ' ms の ' +
      ((perPtOld / PERPOINT_BUDGET_MS) * 100).toFixed(0) +
      '%) = compute はカクつき要因にならない。'
  );
})();
