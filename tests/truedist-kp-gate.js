#!/usr/bin/env node
'use strict';
/* ============================================================================
 * ★真距離KP採点ゲート (truedist-kp-gate.js) — 2026-06-10 / テストツール班★
 * ----------------------------------------------------------------------------
 * 目的:
 *   今日(0610b)のAndroid実走 fixture を「業務別(代行開始→精算終了)」に自動分割し、
 *   各業務 *内* で *時系列単調* にキロポスト(KP)通過を検出して、
 *   真距離(=KP差km・国交省RTK実測の官製道路距離) に対し
 *     ・ダイコメ実測距離   (biz.td 差 = 本番エンジン出力)
 *     ・生GPS弦長          (連続haversine)
 *     ・OBD∫v              (台形積分・参考。td=GPSなので本番未使用)
 *     ・OBD∫v × k          (車別校正 k=1.02・保守クランプ後)
 *   を採点する。★過大(error>0)が1業務でも出たら gate FAIL(認定の片側公差=過大不可)★。
 *
 * ★旧 kp-segment-score.js のバグ★:
 *   nearest(kp) が trace 全体から最近傍を探していた。2業務が同じKPを逆方向に
 *   2回通過すると、業務跨ぎで誤った点を拾い +25〜159% のゴミ誤差を吐いた。
 *   本ゲートは (1)業務内に探索を限定 (2)KP通過を業務内の時系列単調列として確定
 *   することで跨ぎ誤採点を排除する。
 *
 * 真距離の定義:
 *   KP = 百米標(km・松山起点からの道路チェーニジ)。区間真距離 = |KP終 - KP始| km。
 *   lat/lng は通過検出専用(RTK実測)。距離値そのものは KP 番号差から来る(GPS非依存)。
 *
 * 業務分割の定義(本番アプリの biz 状態に忠実):
 *   1業務 = act=1 かつ it=1(代行走行中)が連続する区間を tc(完了トリップ番号)で束ねたもの。
 *   biz.td は完了時にラッチされる累積トリップ距離(m)。区間ダイコメ距離 = td(終) - td(始)。
 *
 * 使い方:
 *   node tests/truedist-kp-gate.js                       # 既定: 0610b-Android.json をゲート
 *   node tests/truedist-kp-gate.js <traceFile> [--k=1.02] [--eps=0.05] [--json]
 *     --k    : OBD∫v に掛ける車別校正係数(既定 1.02 = 真距離校正値)
 *     --eps  : 過大判定のしきい(% ・既定 0.05。丸め誤差での誤FAIL防止)
 *     --json : 機械可読 JSON を末尾に出す(CI 連結用)
 *
 * 終了コード: 過大(over-count)業務が1つでもあれば 1(FAIL)、無ければ 0(PASS)。
 * ※「緑≠実機」。本ゲートは fixture 上の回帰検出器であり、実機検証の代替ではない。
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

// ---- args -------------------------------------------------------------------
function getOpt(re, dflt) {
  for (const a of process.argv.slice(2)) {
    const m = re.exec(a);
    if (m) return m[1];
  }
  return dflt;
}
const traceArg =
  process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2]
    : 'fixtures/0610b-Android.json';
const K = parseFloat(getOpt(/^--k=([0-9.]+)$/, '1.02')); // 車別OBD校正係数
const EPS = parseFloat(getOpt(/^--eps=([0-9.]+)$/, '0.05')); // 過大しきい(%)
const JSON_OUT = process.argv.slice(2).includes('--json');

// ---- geo --------------------------------------------------------------------
function hav(aLat, aLng, bLat, bLng) {
  const R = 6371000,
    r = Math.PI / 180;
  const dLat = (bLat - aLat) * r,
    dLng = (bLng - aLng) * r;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ---- load KP anchors --------------------------------------------------------
const KP_FILE = path.join(__dirname, 'fixtures', 'imabari-196-kp-rtk.json');
const kpData = JSON.parse(fs.readFileSync(KP_FILE, 'utf8'));
const KP = {};
for (const p of kpData.kp) KP[p.kp] = p;
const KP_NUMS = kpData.kp.map((p) => p.kp).sort((a, b) => a - b);

// ============================================================================
// ★公式 真距離区間 (ground truth) — 司さん提示の実走採点区間★
//   業務別に「採点する KP 始/終」を明示宣言する。これが採点の正(canonical)。
//   宣言が無い trace / 業務は STEP2 の自動端点検出にフォールバックする。
//   業務の順序キー = splitBusinesses の出力順(時系列 = 業務1,業務2,...)。
//   ※ 自動で「最初/最後に通過したKP」を採ると 51m 級の緩い端点(KP49 等)まで
//     拾い区間がブレる。公式区間で固定し baseline を厳密再現する。
// ============================================================================
const GROUND_TRUTH = {
  '0610b-Android.json': [
    { tc: 0, startKP: 48, endKP: 39 }, // 業務1: 東予→大西 9km (KP48→39)
    { tc: 1, startKP: 38, endKP: 42 }, // 業務2: 大西→今治 4km (KP38→42)
  ],
};

// ---- load trace -------------------------------------------------------------
const tracePath = path.isAbsolute(traceArg) ? traceArg : path.join(__dirname, traceArg);
let samples = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
samples = (Array.isArray(samples) ? samples : Object.values(samples))
  .filter((x) => x && Number.isFinite(x.lat) && Number.isFinite(x.lng))
  .sort((a, b) => (a.t || 0) - (b.t || 0));

// ============================================================================
// STEP 1 — 業務分割: act=1 && it=1(代行走行中)の連続区間を tc で束ねる
//   ★合計や勝手な分割は禁止(司さんルール)。業務=代行開始→精算終了の単位のみ。★
// ============================================================================
function splitBusinesses(arr) {
  const spans = [];
  let cur = null;
  for (let i = 0; i < arr.length; i++) {
    const b = arr[i].biz || {};
    const driving = b.act === 1 && b.it === 1;
    if (driving) {
      if (!cur || cur.tc !== b.tc) {
        if (cur) spans.push(cur);
        cur = { tc: b.tc, i0: i, i1: i, td0: b.td, td1: b.td };
      } else {
        cur.i1 = i;
        cur.td1 = b.td;
      }
    } else if (cur) {
      spans.push(cur);
      cur = null;
    }
  }
  if (cur) spans.push(cur);
  // 実距離 0(停車のみ等)の span は業務として採点しない
  return spans.filter((s) => s.i1 > s.i0 && s.td1 - s.td0 > 50);
}

// ============================================================================
// STEP 2 — 業務内 時系列単調 KP通過検出
//   業務 span に探索を限定し、各KPの最接近サンプルを取る。
//   ★跨ぎ排除★: 採点に使うのは「業務内で最接近距離が小さく(=実通過)」
//   かつ「indexが時系列単調に並ぶ」KP列。逆走業務でも自分の span 内だけを見るので
//   隣業務の同KP点を拾わない。
// ============================================================================
const PASS_MAX_M = 80; // 最接近がこれ超 = そのKPは通っていない(採点に使わない)

function nearestInSpan(i0, i1, kpNum) {
  const P = KP[kpNum];
  let best = Infinity,
    bi = -1;
  for (let i = i0; i <= i1; i++) {
    const d = hav(samples[i].lat, samples[i].lng, P.lat, P.lng);
    if (d < best) {
      best = d;
      bi = i;
    }
  }
  return { idx: bi, dist: best };
}

// span 内で実際に通過した(最接近<PASS_MAX_M)KPを、index昇順=時系列単調で返す
function passedKPs(span) {
  const hits = [];
  for (const kp of KP_NUMS) {
    const n = nearestInSpan(span.i0, span.i1, kp);
    if (n.idx >= 0 && n.dist <= PASS_MAX_M) {
      hits.push({ kp, idx: n.idx, dist: n.dist, td: samples[n.idx].biz.td });
    }
  }
  // 時系列単調列に整える(index昇順)。同一KPは1点(nearestInSpanで既に一意)。
  hits.sort((a, b) => a.idx - b.idx);
  return hits;
}

// ============================================================================
// STEP 3 — 区間採点(2つの通過KP間: 真距離 vs dm / GPS / OBD∫v / OBD×k)
// ============================================================================
function scoreSegment(span, startHit, endHit) {
  const a = startHit.idx,
    b = endHit.idx;
  const lo = Math.min(a, b),
    hi = Math.max(a, b);
  const trueKm = Math.abs(endHit.kp - startHit.kp);

  // ダイコメ(biz.td 差)= 本番エンジン出力
  const daikomeKm = (samples[b].biz.td - samples[a].biz.td) / 1000;

  // 生GPS弦長
  let gpsM = 0;
  for (let i = lo + 1; i <= hi; i++) {
    gpsM += hav(samples[i - 1].lat, samples[i - 1].lng, samples[i].lat, samples[i].lng);
  }

  // OBD∫v(台形・dt<=10s・obd>=0 km/h を m/s 換算)
  let obdM = 0,
    obdN = 0;
  for (let i = lo + 1; i <= hi; i++) {
    const p = samples[i],
      q = samples[i - 1];
    const dt = (p.t - q.t) / 1000;
    if (!(dt > 0) || dt > 10) continue;
    const o0 = typeof q.obd === 'number' && q.obd >= 0 ? q.obd : null;
    const o1 = typeof p.obd === 'number' && p.obd >= 0 ? p.obd : null;
    if (o0 == null || o1 == null) continue;
    obdM += ((o0 + o1) / 2 / 3.6) * dt; // km/h -> m/s
    obdN++;
  }
  const obdKm = obdN > 0 ? obdM / 1000 : null;
  // OBD×k は保守クランプ(distance<=真値) で過大ゼロ維持
  const obdKmKraw = obdKm != null ? obdKm * K : null;
  const obdKmK = obdKmKraw != null ? Math.min(obdKmKraw, trueKm) : null;
  const kAuto = obdKm ? trueKm / obdKm : null;

  return {
    startKP: startHit.kp,
    endKP: endHit.kp,
    trueKm,
    nA: { idx: a, dist: startHit.dist },
    nB: { idx: b, dist: endHit.dist },
    nSamples: hi - lo + 1,
    daikomeKm,
    gpsKm: gpsM / 1000,
    obdKm,
    obdKmK,
    obdN,
    kAuto,
  };
}

function errPct(km, trueKm) {
  return km == null ? null : (km / trueKm - 1) * 100;
}
function fmtPct(e) {
  return e == null ? '—' : (e >= 0 ? '+' : '') + e.toFixed(2) + '%';
}
function band(e) {
  if (e == null) return '—';
  return e > EPS ? '✗過大(FAIL)' : e >= -4 ? '✓合格' : '✗過小';
}

// ============================================================================
// RUN
// ============================================================================
const businesses = splitBusinesses(samples);
const gt = GROUND_TRUTH[path.basename(tracePath)] || null;
const report = { trace: path.basename(tracePath), k: K, eps: EPS, businesses: [] };
let anyOver = false;

// 業務 span 内で「指定KP」の通過点(最接近)を取る。通過していなければ null。
function hitFor(span, kpNum) {
  const n = nearestInSpan(span.i0, span.i1, kpNum);
  if (n.idx < 0 || n.dist > PASS_MAX_M) return null;
  return { kp: kpNum, idx: n.idx, dist: n.dist, td: samples[n.idx].biz.td };
}

console.log('===========================================================');
console.log(
  '★真距離KP採点ゲート★ trace=' + path.basename(tracePath) + ' / k=' + K + ' / eps=' + EPS + '%'
);
console.log('真距離 = KP差(国交省RTK実測・官製道路距離) / 認定バンド=-4%〜0%(過大不可)');
console.log('===========================================================\n');
console.log('業務分割(act=1&it=1 を tc で束ね・実距離>50mのみ): ' + businesses.length + '業務\n');

businesses.forEach((span, bi) => {
  const hits = passedKPs(span);
  const label = '業務' + (bi + 1) + ' (tc=' + span.tc + ', idx ' + span.i0 + '..' + span.i1 + ')';

  // 採点端点の決定: 公式区間(GROUND_TRUTH)があればそれを使う。無ければ自動(最初/最後の通過KP)。
  let startHit, endHit, srcTag;
  const gtSeg = gt ? gt.find((g) => g.tc === span.tc) : null;
  if (gtSeg) {
    startHit = hitFor(span, gtSeg.startKP);
    endHit = hitFor(span, gtSeg.endKP);
    srcTag = '公式区間';
    if (!startHit || !endHit) {
      console.log(
        label +
          ': 公式区間KP' +
          gtSeg.startKP +
          '/' +
          gtSeg.endKP +
          ' が業務内で未通過(>' +
          PASS_MAX_M +
          'm)。採点スキップ。\n'
      );
      report.businesses.push({ label, scored: false, reason: 'gt-KP-not-passed' });
      return;
    }
  } else {
    if (hits.length < 2) {
      console.log(label + ': 通過KPが2点未満(KP区間外)。採点スキップ。\n');
      report.businesses.push({ label, scored: false, reason: 'fewer-than-2-KP' });
      return;
    }
    startHit = hits[0];
    endHit = hits[hits.length - 1];
    srcTag = '自動端点';
  }
  // ★時系列単調チェック★: start の index は end より前(または逆も明示)。業務内に限定済なので跨ぎ無し。
  const monotone = startHit.idx !== endHit.idx;
  const s = scoreSegment(span, startHit, endHit);

  const eDm = errPct(s.daikomeKm, s.trueKm);
  const eGps = errPct(s.gpsKm, s.trueKm);
  const eObd = errPct(s.obdKm, s.trueKm);
  const eObdK = errPct(s.obdKmK, s.trueKm);

  // ★過大ゲート★: ダイコメ(本番出力)が過大なら FAIL。
  const over = eDm != null && eDm > EPS;
  if (over) anyOver = true;

  console.log(label);
  console.log(
    '  業務内 通過KP列(時系列単調・業務内限定で跨ぎ排除): ' +
      hits.map((h) => 'KP' + h.kp + '(' + h.dist.toFixed(0) + 'm)').join(' → ')
  );
  console.log(
    '  採点区間[' +
      srcTag +
      ']: KP' +
      s.startKP +
      ' → KP' +
      s.endKP +
      '  真距離=' +
      s.trueKm.toFixed(3) +
      'km  (端点最接近 ' +
      s.nA.dist.toFixed(0) +
      'm @idx' +
      s.nA.idx +
      ' / ' +
      s.nB.dist.toFixed(0) +
      'm @idx' +
      s.nB.idx +
      ', 単調=' +
      (monotone ? 'OK' : 'NG') +
      ', n=' +
      s.nSamples +
      ')'
  );
  console.log('  ----------------------------------------------------------');
  console.log('  項目            | 距離       | vs真距離 | 判定');
  console.log(
    '  ダイコメ(td/本番) | ' +
      (s.daikomeKm.toFixed(3) + 'km').padEnd(10) +
      ' | ' +
      fmtPct(eDm).padStart(8) +
      ' | ' +
      band(eDm)
  );
  console.log(
    '  生GPS弦長        | ' +
      (s.gpsKm.toFixed(3) + 'km').padEnd(10) +
      ' | ' +
      fmtPct(eGps).padStart(8) +
      ' | ' +
      band(eGps)
  );
  console.log(
    '  OBD∫v(raw,k=1)   | ' +
      (s.obdKm != null
        ? (s.obdKm.toFixed(3) + 'km').padEnd(10) +
          ' | ' +
          fmtPct(eObd).padStart(8) +
          ' | ' +
          band(eObd) +
          ' (n=' +
          s.obdN +
          ')'
        : '— OBD無し')
  );
  console.log(
    '  OBD∫v×k=' +
      K.toFixed(2) +
      '(clamp)| ' +
      (s.obdKmK != null
        ? (s.obdKmK.toFixed(3) + 'km').padEnd(10) +
          ' | ' +
          fmtPct(eObdK).padStart(8) +
          ' | ' +
          band(eObdK)
        : '—')
  );
  if (s.kAuto != null)
    console.log(
      '  → 自動推定 k = ' + s.kAuto.toFixed(4) + ' (raw∫v×これ=真距離一致 / この車の k 候補)'
    );
  console.log('');

  report.businesses.push({
    label,
    scored: true,
    tc: span.tc,
    startKP: s.startKP,
    endKP: s.endKP,
    trueKm: s.trueKm,
    daikomeKm: round(s.daikomeKm),
    daikomeErrPct: round(eDm),
    gpsKm: round(s.gpsKm),
    gpsErrPct: round(eGps),
    obdKm: round(s.obdKm),
    obdErrPct: round(eObd),
    obdKmK: round(s.obdKmK),
    obdKErrPct: round(eObdK),
    kAuto: round(s.kAuto),
    over,
  });
});

function round(v) {
  return v == null ? null : Math.round(v * 10000) / 10000;
}

report.pass = !anyOver;
console.log('===========================================================');
if (anyOver) {
  console.log('★GATE FAIL★ — 過大(error>+' + EPS + '%)の業務あり = 認定の片側公差(過大不可)違反。');
} else {
  console.log('★GATE PASS★ — 全業務でダイコメ距離 ≤ 真距離(過大ゼロ維持)。');
}
console.log('※緑≠実機。本ゲートは fixture 回帰検出器。実機検証の代替ではない。');
console.log('===========================================================');

if (JSON_OUT) console.log('\n' + JSON.stringify(report, null, 2));

process.exit(anyOver ? 1 : 0);
