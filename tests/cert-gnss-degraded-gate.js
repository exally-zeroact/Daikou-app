#!/usr/bin/env node
'use strict';
/* ============================================================================
 * ★cert-gnss-degraded ゲート (cert-gnss-degraded-gate.js)
 *   — 2026-06-12 / テストツール班★
 * ----------------------------------------------------------------------------
 * これは何か / なぜ要るか:
 *   GNSS 不安定環境(ビル街マルチパス / 樹冠 / 橋下)では ★生GPS弦が真の走行線より
 *   膨張する★(各点が走行線の左右へジッタ → ジグザグ弦が真距離より長くなる)。
 *   認定メーターの片側公差は「過大不可(distance_m ≤ 真距離)」なので、この膨張が
 *   そのまま distance_m に漏れると ★過大請求 = 認定アウト★。
 *
 *   ダイコメの距離方式 smoothedRawMode(平滑生GPS弦)は、双方向移動平均でこの
 *   左右対称ジッタを相殺し、膨張弦を「真の走行線」へ畳み込む = 平滑弦 ≤ 生弦。
 *   本ゲートは ★実エンジン(js/pipeline-distance.js の computeDistance)★ に
 *   ★生GPS弦が真値+約10%膨張するノイズを注入した trace★ を流し、
 *     (A) 平滑(出荷既定 smoothedRawMode=true) の distance_m ≤ 生弦モードの distance_m
 *         (= 平滑が +10%膨張を吸収する。spec「平滑弦<=生弦」)
 *     (B) 平滑の distance_m ≤ 真値(=ノイズ無し clean の engine 出力)+ cert ε
 *         (= GNSS劣化下でも過大ゼロ = never-over を守る)
 *   を assert する。
 *
 *   ★負例(RED 実証)★: --no-clamp で smoothedRawMode=false にすると、平滑防御が
 *   外れて +10%膨張弦が distance_m に素通り → 真値に対して過大(over-count)になる。
 *   このとき exit 1 を返し、本ゲートが ★空緑でない(防御が無いと実際に過大になる)★
 *   ことを実コードで実証する。
 *
 * 使い方:
 *   node tests/cert-gnss-degraded-gate.js            # 本判定 (PASS=exit0 / 過大=exit1)
 *   node tests/cert-gnss-degraded-gate.js --json      # 機械可読 JSON も出力
 *   node tests/cert-gnss-degraded-gate.js --no-clamp  # ★負例★ 平滑OFF=生弦素通し→過大→exit1
 *   node tests/cert-gnss-degraded-gate.js --expand=0.10  # 膨張目標(既定 +10%)
 *
 * 終了コード:
 *   本判定: いずれかの fixture で (A)吸収 or (B)過大ゼロ に違反すれば 1、全 PASS で 0。
 *   --no-clamp: 平滑OFF が真値超過(過大)を起こせば 1(=RED 実証)、起こさなければ 0。
 *
 * ★不可侵★: distance_m / pipeline-distance.js 等の prod js は ★1byte も触らない★。
 *   computeDistance を read-only で require して観測するだけ。smoothedRawMode の ON/OFF は
 *   ★呼び出し時 opts で渡す★(本番 flip と同じ設定面・source は不変)。
 * ※緑≠実機。本ゲートは合成劣化 GNSS trace 上の過大ゼロ回帰検出器であり、実機検証の代替ではない。
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
const PREF = getOpt(/^--pref=(.+)$/, process.env.ROADS_PREF || 'ehime').toLowerCase();
const EXPAND_TARGET = parseFloat(getOpt(/^--expand=([0-9.]+)$/, '0.10')); // 生弦膨張目標 (+10%)
const CERT_EPS = parseFloat(getOpt(/^--eps=([0-9.]+)$/, '0.005')); // 過大しきい(真値比・丸め余裕 0.5%)
// ★代行モードの採点に使う 2つ★（2026-08-28・指示役の裁定①）
//   ★代行係数 1.0085 (+0.85%)★ … 本番 index.html:7506 Meter.setDaikouDistanceFactor(1.0085)
//     2026-07-04 に再較正（旧 1.011/1.013）。★随伴車 DM Light に合わせる為の わざとの上乗せ★。
//   ★天井 +6%★ … DM Light / タイヤ真値(オドメーター) は 真距離+0.5〜6% の範囲。
//     ⇒ 代行は「真値を超えたら赤」ではなく「★この天井を 超えたら赤★」で 採点する。
const DAIKOU_FACTOR = parseFloat(getOpt(/^--daikou-factor=([0-9.]+)$/, '1.0085'));
const DAIKOU_CEIL_PCT = parseFloat(getOpt(/^--daikou-ceil=([0-9.]+)$/, '0.06'));
const NO_CLAMP = process.argv.slice(2).includes('--no-clamp'); // ★負例★ 平滑OFF=生弦素通し
const JSON_OUT = process.argv.slice(2).includes('--json');

// 3台同一走行 realdevice fixture(GNSS 特性が端末ごと異なる=劣化注入の母集合に好適)
const FIXTURES = [
  'realdevice-android.json',
  'realdevice-iphonese.json',
  'realdevice-iphone13-noisy.json',
];

// ============================================================================
// decoder ロード (replay-pipeline-distance.js と同手法・完全オフライン eval shim)
// ============================================================================
function loadDecoder(pref) {
  global.window = global;
  global.self = global;
  const decSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'roads-decoder.js'), 'utf8');
  // eslint-disable-next-line no-eval
  eval(decSrc); // → global.RoadDecoder
  const dataFile = path.join(__dirname, '..', 'data', 'roads-' + pref + '.js');
  if (!fs.existsSync(dataFile)) throw new Error('roads データ無し: ' + dataFile);
  const dataSrc = fs.readFileSync(dataFile, 'utf8');
  // eslint-disable-next-line no-eval
  eval(dataSrc); // → global.ROADS_<PREF>
  const key = 'ROADS_' + pref.toUpperCase();
  const roadsData = global[key];
  if (!roadsData) throw new Error('global.' + key + ' 未定義');
  const dec = new global.RoadDecoder(roadsData);
  dec.buildOffsetTable();
  return dec;
}

// ---- geo --------------------------------------------------------------------
function hav(a, b) {
  const R = 6371000,
    r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r,
    dLng = (b.lng - a.lng) * r;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function chordLen(arr) {
  let c = 0;
  for (let i = 1; i < arr.length; i++) c += hav(arr[i - 1], arr[i]);
  return c;
}

function loadFixture(name) {
  const p = path.join(__dirname, 'fixtures', name);
  if (!fs.existsSync(p)) throw new Error('fixture 無し: ' + p);
  return JSON.parse(fs.readFileSync(p, 'utf8'))
    .filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .sort((a, b) => (a.t || 0) - (b.t || 0));
}

// ============================================================================
// ★GNSS劣化ノイズ注入★ — 各点を「走行線(前点→当該点)の直交方向」へ ±amp 度だけ
//   左右交互にずらす = ジグザグ。これで生GPS弦長が膨張する(真の走行線は不変)。
//   amp は EXPAND_TARGET(+10%)に届くよう自動較正する(勘の固定値でなく実測 sweep)。
// ============================================================================
function injectNoise(arr, amp) {
  const r = Math.PI / 180;
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const p = arr[i];
    let bLat = 0,
      bLng = 0;
    if (i > 0) {
      // 進行ベクトル(度・経度は cos 補正)→ 直交単位ベクトル
      const dLat = p.lat - arr[i - 1].lat;
      const dLng = (p.lng - arr[i - 1].lng) * Math.cos(p.lat * r);
      const L = Math.hypot(dLat, dLng) || 1;
      const pLat = -dLng / L;
      const pLng = dLat / L;
      const sgn = i % 2 === 0 ? 1 : -1; // 左右交互(対称ジッタ=平滑で相殺可能)
      bLat = pLat * amp * sgn;
      bLng = (pLng * amp * sgn) / Math.max(Math.cos(p.lat * r), 1e-6);
    }
    out.push(Object.assign({}, p, { lat: p.lat + bLat, lng: p.lng + bLng }));
  }
  return out;
}

// EXPAND_TARGET(例 +10%)を満たす最小 amp を二分探索で較正(端末ごと点密度が違うため毎回)
function calibrateAmp(clean, target) {
  const baseChord = chordLen(clean);
  let lo = 0,
    hi = 1e-4;
  // hi が target に届くまで拡大
  for (let k = 0; k < 30; k++) {
    const exp = chordLen(injectNoise(clean, hi)) / baseChord - 1;
    if (exp >= target) break;
    hi *= 1.6;
  }
  // 二分探索
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    const exp = chordLen(injectNoise(clean, mid)) / baseChord - 1;
    if (exp < target) lo = mid;
    else hi = mid;
  }
  const amp = hi;
  const exp = chordLen(injectNoise(clean, amp)) / baseChord - 1;
  return { amp, expandPct: exp * 100 };
}

// ============================================================================
// RUN
// ============================================================================
const dec = loadDecoder(PREF);
const PD = require(path.join(__dirname, '..', 'js', 'pipeline-distance.js'));
if (typeof PD.computeDistance !== 'function') {
  console.error('★FATAL★: pipeline-distance.js computeDistance export 不整合');
  process.exit(2);
}
const computeDistance = PD.computeDistance;

console.log('===========================================================');
console.log(
  '★cert-gnss-degraded ゲート★ (GNSS劣化=生GPS弦+' + (EXPAND_TARGET * 100).toFixed(0) + '%膨張)'
);
console.log(
  'pref=' +
    PREF +
    ' / cert ε=' +
    (CERT_EPS * 100).toFixed(1) +
    '% / mode=' +
    (NO_CLAMP ? '★負例(--no-clamp=平滑OFF=生弦素通し)★' : '本判定(平滑既定)')
);
// ★★どちらの採点か を 先に言う★★ 2026-08-28（指示役の裁定①）
//   ★この (B) は「タクシー認定モード(係数1.0)」の採点です★
//   ・タクシー認定 … ★過大不可(distance_m ≤ 真距離)★＝片側公差。ε=0.5%。
//   ・★代行は 検定対象外★＝「真距離を超えるな」は 法的拘束では ありません。
//     代行は 係数 ★1.0085(+0.85%)★ で わざと上乗せし ★随伴車の DM Light に合わせて★います
//     （本番 index.html の Meter.setDaikouDistanceFactor / 2026-07-04 再較正）。
//     実上限は ★DM Light・タイヤ真値(オドメーター)＝真距離 +0.5〜6%★ という 緩い天井。
//   ⇒★同じ数字でも 採点が 2つ在ります。両方 出します★
console.log('★★採点は 2つ 出します★★');
console.log(
  '  ① ★タクシー認定モード★(係数1.0) … 過大不可(distance_m ≤ 真値+ε)  ε=' +
    (CERT_EPS * 100).toFixed(1) +
    '%'
);
console.log(
  '  ② ★代行モード★(係数' +
    DAIKOU_FACTOR.toFixed(4) +
    ') …… 天井=真値+' +
    (DAIKOU_CEIL_PCT * 100).toFixed(1) +
    '%(DM Light/タイヤ真値)'
);
console.log('  ★代行は検定対象外＝①が赤でも 代行の請求が おかしいとは 限りません★');
console.log('真値=ノイズ無し clean の engine distance_m');
console.log(
  '★distance_m / pipeline-distance.js は read-only(1byte も触らない)。平滑 ON/OFF は呼出時 opts のみ。'
);
console.log('===========================================================\n');

const report = {
  pref: PREF,
  expandTarget: EXPAND_TARGET,
  certEps: CERT_EPS,
  mode: NO_CLAMP ? 'no-clamp(smooth OFF)' : 'judge(smooth default)',
  fixtures: [],
};

let gateFail = false;
let daikouFail = false; // ★代行モードの採点（別の物差し）★
let redProven = false; // 負例: 平滑OFF が過大を起こせたか

for (const fx of FIXTURES) {
  let clean, noisy, cal;
  try {
    clean = loadFixture(fx);
    cal = calibrateAmp(clean, EXPAND_TARGET);
    noisy = injectNoise(clean, cal.amp);
  } catch (e) {
    console.log('  ' + fx + ' : LOAD/INJECT ERROR ' + e.message);
    report.fixtures.push({ fixture: fx, error: e.message });
    gateFail = true;
    continue;
  }

  // 真値 = ノイズ無し clean を実エンジンで測った distance_m(=この trace の engine 基準距離)
  const trueDm = computeDistance(clean, dec, { enableRouting: true }).distance_m;

  // 平滑既定(smoothedRawMode=true)で劣化 trace を測る
  const smoothedDm = computeDistance(noisy, dec, {
    enableRouting: true,
    smoothedRawMode: true,
  }).distance_m;
  // 生弦モード(smoothedRawMode=false)= 平滑防御を外した劣化 trace
  const rawDm = computeDistance(noisy, dec, {
    enableRouting: true,
    smoothedRawMode: false,
  }).distance_m;

  // 本判定で「観測する」エンジン出力 = 平滑(NO_CLAMP なら生弦=防御無し)
  const observedDm = NO_CLAMP ? rawDm : smoothedDm;

  const absorbOk = smoothedDm <= rawDm + 0.0001; // (A) 平滑 ≤ 生弦(吸収)
  const overPct = (observedDm / trueDm - 1) * 100; // 真値比 過大%
  const neverOverOk = observedDm <= trueDm * (1 + CERT_EPS); // (B) 過大ゼロ(真値+ε 以内)

  const rawOverPct = (rawDm / trueDm - 1) * 100; // 生弦モードの真値超過%(負例の主役)

  const row = {
    fixture: fx,
    points: clean.length,
    injectExpandPct: +cal.expandPct.toFixed(2),
    trueDm: +trueDm.toFixed(1),
    smoothedDm: +smoothedDm.toFixed(1),
    rawDm: +rawDm.toFixed(1),
    observedDm: +observedDm.toFixed(1),
    overPct: +overPct.toFixed(3),
    rawOverPct: +rawOverPct.toFixed(3),
    absorbOk,
    neverOverOk,
  };
  report.fixtures.push(row);

  console.log('  ' + fx.padEnd(30) + ' (' + clean.length + '点)');
  console.log('    生弦膨張注入 = +' + cal.expandPct.toFixed(1) + '%');
  console.log(
    '    真値(clean)=' +
      trueDm.toFixed(0) +
      'm | 平滑=' +
      smoothedDm.toFixed(0) +
      'm | 生弦=' +
      rawDm.toFixed(0) +
      'm'
  );

  if (NO_CLAMP) {
    // ★負例★: 平滑OFF=生弦素通し。真値超過(過大)を起こせば RED 実証成功。
    const over = rawDm > trueDm * (1 + CERT_EPS);
    console.log(
      '    ★負例(平滑OFF)★ 生弦 vs 真値 = ' +
        (rawOverPct >= 0 ? '+' : '') +
        rawOverPct.toFixed(2) +
        '%  → ' +
        (over ? '★過大(RED 実証)★' : '過大ならず')
    );
    if (over) redProven = true;
  } else {
    console.log(
      '    (A)吸収 平滑≤生弦 = ' +
        (absorbOk ? 'OK' : '★NG★') +
        ' (平滑が生弦を ' +
        (rawDm - smoothedDm).toFixed(0) +
        'm 下回る)'
    );
    console.log(
      '    (B)過大ゼロ 平滑 vs 真値 = ' +
        (overPct >= 0 ? '+' : '') +
        overPct.toFixed(2) +
        '% → ' +
        (neverOverOk ? 'OK(過大ゼロ維持)' : '★NG(過大=認定アウト)★') +
        '   ←★①タクシー認定モードの採点★'
    );
    // ★②代行モードの採点★（2026-08-28・指示役の裁定①）
    //   代行は 検定対象外。★係数1.0085 を掛けた値が DM Light/タイヤ真値の天井(+6%)を超えたら赤★。
    //   ＝「真値を超えたら赤」ではない。同じ数字を ★2つの物差しで★ 採点する。
    const daikouDm = observedDm * DAIKOU_FACTOR;
    const daikouOverPct = (daikouDm / trueDm - 1) * 100;
    const daikouOk = daikouDm <= trueDm * (1 + DAIKOU_CEIL_PCT);
    row.daikouDm = +daikouDm.toFixed(1);
    row.daikouOverPct = +daikouOverPct.toFixed(3);
    row.daikouOk = daikouOk;
    console.log(
      '    (B2)天井 代行(×' +
        DAIKOU_FACTOR.toFixed(4) +
        ') vs 真値 = ' +
        (daikouOverPct >= 0 ? '+' : '') +
        daikouOverPct.toFixed(2) +
        '% → ' +
        (daikouOk
          ? 'OK(天井 +' + (DAIKOU_CEIL_PCT * 100).toFixed(0) + '% の中)'
          : '★NG(天井超え)★') +
        '   ←★②代行モードの採点★'
    );
    if (!absorbOk || !neverOverOk) gateFail = true;
    if (!daikouOk) daikouFail = true;
  }
  console.log('');
}

console.log('===========================================================');
let exitCode;
// ★2つの採点を 両方 出す★（片方だけ見て 判断させない）
if (NO_CLAMP) {
  // 負例: 防御(平滑)を外したら過大が起きること自体を実証する run。
  if (redProven) {
    console.log(
      '★負例 RED 実証 OK★ — 平滑OFF(生弦素通し)で GNSS劣化+10%膨張が distance_m を真値超過させた。'
    );
    console.log(
      '= 本ゲートは空緑でない(平滑防御が無いと実際に過大になることを実コードで確認)。exit 1。'
    );
    exitCode = 1;
  } else {
    console.log(
      '★負例 失敗★ — 平滑OFF でも過大が起きなかった = 膨張注入 or 真値設定が弱い(要再較正)。exit 0。'
    );
    exitCode = 0;
  }
} else {
  if (gateFail) {
    console.log(
      '★① タクシー認定モード = FAIL★ — GNSS劣化下で (A)吸収 or (B)過大ゼロ 違反 = 片側公差(過大不可)違反。'
    );
    console.log(
      '★② 代行モード = ' +
        (daikouFail
          ? 'FAIL（天井超え）★'
          : 'PASS（天井 +' + (DAIKOU_CEIL_PCT * 100).toFixed(0) + '% の中）★')
    );
    console.log(
      '  ⇒★代行は 検定対象外です★。①が赤でも ★代行の請求が おかしいとは 限りません★。' +
        'この見張りが赤で止めているのは ★タクシー認定モードの線★です。'
    );
    exitCode = 1;
  } else {
    console.log(
      '★GATE PASS★ — GNSS劣化+10%膨張を平滑(smoothedRawMode)が吸収し、全 fixture で distance_m ≤ 真値(過大ゼロ維持)。'
    );
    exitCode = 0;
  }
}
console.log(
  '※緑≠実機。本ゲートは合成劣化 GNSS trace 上の過大ゼロ回帰検出器。実機検証の代替ではない。'
);
console.log('===========================================================');

if (JSON_OUT) console.log('\n' + JSON.stringify(report, null, 2));

process.exit(exitCode);
