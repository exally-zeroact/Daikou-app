#!/usr/bin/env node
'use strict';

// tests/sim-display-montecarlo.js
// ★現 meter.js 実物の表示エンジンを数百パターンの走行で回し、表示契約を全測定★ (2026-05-31)
//   司さんの全要求を、合成だが多様な走行(巡航/加減速/GPS穴/トンネル/信号停止連打/
//   再発進/タブ復帰/lumpジャンプ)でストレステストする。distance_m/calcFare は読むだけ。
//
//   各シナリオで測る契約:
//     (1) overshoot: display ≤ distance_m を全フレーム (= 先取り/過大ゼロ・認定)
//     (2) 単調: display 後退なし
//     (3) 10m飛ばさず: 1フレーム前進 ≤ 10m (タブ復帰含む)
//     (4) 停車時一致: 完全停車(settle 1.0s 後)の残差 ≤ 1.0m (= 確定で跳ねない)
//     (5) 停車後不動: settle 後の display 増加 ≤ 0.05m (= 動いてないのにメーター動かない)
//     (6) latch: 末尾 latch 後 display == distance_m
//   node tests/sim-display-montecarlo.js [N]

const path = require('path');
const Meter = require(path.join(__dirname, '..', 'js', 'meter.js'));

const N = parseInt(process.argv[2] || '500', 10);
const CONTINUOUS = process.env.CONTINUOUS === '1'; // 距離層連続化(gap中も distance_m を進める)モード
const UI_DT_MS = 1000 / 60; // rAF 60Hz
const SETTLE_MS = 1000; // 完全停車とみなすまでの猶予(減速窓の延長)
const BASE = 1_700_000_000_000;

// 決定論 PRNG (seed 再現可能・Math.random 不使用で結果安定)
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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

// ── シナリオ生成: fix 列 [{t秒, dist累積m}] + resumeGaps(タブ復帰=描画間引き) ──
function genScenario(rng) {
  const fixes = [];
  let t = 0,
    dist = 0;
  const fixDt = [0.5, 1, 1, 1, 2][Math.floor(rng() * 5)]; // GPS間隔(主に1Hz・たまに0.5/2s)
  const cruise = 3 + rng() * 22; // 巡航速度 m/s (~11〜90km/h)
  const nSeg = 3 + Math.floor(rng() * 8); // 区間数
  const resumeGaps = []; // [{startMs,endMs}] = この間ポーリング停止(タブ隠れ)
  for (let seg = 0; seg < nSeg; seg++) {
    const kind = rng();
    if (kind < 0.45) {
      // 巡航(加減速含む)
      const dur = 5 + rng() * 25;
      const steps = Math.max(1, Math.round(dur / fixDt));
      const v = cruise * (0.5 + rng());
      for (let i = 0; i < steps; i++) {
        t += fixDt;
        dist += v * fixDt;
        fixes.push({ t, dist });
      }
    } else if (kind < 0.65) {
      // GPS穴(トンネル): 数秒〜30s
      const gap = 3 + rng() * 27;
      const v = cruise * (0.6 + rng() * 0.6);
      if (CONTINUOUS) {
        // ★距離層連続化(=トンネル中も道路長を直前速度で進める・roadreading架の方針)★: gap中も小刻みにfix
        const steps = Math.max(1, Math.round(gap / fixDt));
        for (let i = 0; i < steps; i++) {
          t += fixDt;
          dist += v * fixDt;
          fixes.push({ t, dist });
        }
      } else {
        // 現状(lump): fix 来ず → 復帰で道路長が一括
        t += gap;
        dist += v * gap;
        fixes.push({ t, dist });
      }
    } else if (kind < 0.85) {
      // 減速→完全停車→(信号)→再発進
      const v = cruise * (0.6 + rng() * 0.6);
      for (const f of [0.8, 0.55, 0.35, 0.18, 0.06]) {
        t += fixDt;
        dist += v * f * fixDt;
        fixes.push({ t, dist });
      }
      const stopDur = 2 + rng() * 40; // 停車(信号/経由地)
      const stopSteps = Math.max(1, Math.round(stopDur / fixDt));
      for (let i = 0; i < stopSteps; i++) {
        t += fixDt;
        fixes.push({ t, dist });
      } // dist 不動
    } else {
      // 中速巡航(グリッチlumpはGPS jumpゲートが弾くので現実モデルから除外)
      const dur = 4 + rng() * 12;
      const steps = Math.max(1, Math.round(dur / fixDt));
      const v = cruise * (0.7 + rng() * 0.5);
      for (let i = 0; i < steps; i++) {
        t += fixDt;
        dist += v * fixDt;
        fixes.push({ t, dist });
      }
    }
  }
  // 末尾: 必ず減速停車(支払前)
  const v = cruise * 0.5;
  for (const f of [0.6, 0.4, 0.2, 0.05]) {
    t += fixDt;
    dist += v * f * fixDt;
    fixes.push({ t, dist });
  }
  for (let i = 0; i < Math.round(3 / fixDt); i++) {
    t += fixDt;
    fixes.push({ t, dist });
  }
  // タブ復帰: 走行中ランダムに0〜2回、描画を10〜40s間引く
  const nResume = Math.floor(rng() * 3);
  for (let r = 0; r < nResume; r++) {
    const startMs = rng() * t * 1000 * 0.7;
    resumeGaps.push({ startMs, endMs: startMs + (10 + rng() * 30) * 1000 });
  }
  return { fixes, endT: t, resumeGaps };
}

function inResumeGap(ms, gaps) {
  for (const g of gaps) if (ms >= g.startMs && ms < g.endMs) return true;
  return false;
}

function runScenario(sc) {
  Meter.setFareConfig(FARE);
  Meter.reset();
  Meter.setBusinessActive(true);
  Meter.start();
  const _real = Date.now;
  let clock = BASE;
  Date.now = () => clock;
  try {
    let prevDisp = 0,
      maxOver = 0,
      mono = 0,
      maxJump = 0,
      fixIdx = 0;
    let curDist = 0,
      distStaticSinceMs = 0;
    let worstStopResidual = 0,
      worstStoppedMove = 0;
    let settleDispRef = null; // settle 到達時の display
    const endMs = Math.ceil(sc.endT * 1000) + 5000;
    let lastPollDisp = 0;
    for (let ms = 0; ms <= endMs; ms += UI_DT_MS) {
      clock = BASE + ms;
      // fix 適用
      while (fixIdx < sc.fixes.length && sc.fixes[fixIdx].t * 1000 <= ms) {
        const nd = sc.fixes[fixIdx].dist;
        if (nd > curDist + 1e-9) {
          curDist = nd;
          distStaticSinceMs = ms;
          settleDispRef = null;
        }
        Meter.setDistance(nd);
        fixIdx++;
      }
      // タブ復帰中はポーリングしない(= getState 呼ばない=描画停止)
      if (inResumeGap(ms, sc.resumeGaps)) continue;
      const s = Meter.getState();
      const disp = s.display_distance_m || 0;
      const dist = s.distance_m || 0;
      // (1) overshoot
      if (disp - dist > maxOver) maxOver = disp - dist;
      // (2) 単調
      if (disp < prevDisp - 1e-9) mono++;
      // (3) フレーム飛び(連続ポーリング間の増分)
      const jump = disp - lastPollDisp;
      if (jump > maxJump) maxJump = jump;
      // (4)(5) 停車: dist が settle 以上静止
      const staticMs = ms - distStaticSinceMs;
      if (staticMs >= SETTLE_MS) {
        if (settleDispRef === null) {
          settleDispRef = disp;
          const resid = dist - disp; // settle時の残差(=停車時に追いつけてるか)
          if (resid > worstStopResidual) worstStopResidual = resid;
        } else {
          const moved = disp - settleDispRef; // settle後にメーターが動いた量
          if (moved > worstStoppedMove) worstStoppedMove = moved;
        }
      }
      prevDisp = Math.max(prevDisp, disp);
      lastPollDisp = disp;
    }
    // (6) latch
    Meter.latchDisplay();
    const ls = Meter.getState();
    const latchGap = Math.abs((ls.display_distance_m || 0) - (ls.distance_m || 0));
    return {
      maxOver,
      mono,
      maxJump,
      worstStopResidual,
      worstStoppedMove,
      latchGap,
      finalDist: curDist,
    };
  } finally {
    Date.now = _real;
  }
}

// ── 実行 ──
const rng = mulberry32(12345);
const agg = {
  overshootFail: 0,
  monoFail: 0,
  jumpFail: 0,
  stopResidFail: 0,
  stoppedMoveFail: 0,
  latchFail: 0,
  allPass: 0,
  maxOver: 0,
  maxJump: 0,
  maxStopResid: 0,
  maxStoppedMove: 0,
  maxLatch: 0,
};
const jumps = [],
  resids = [],
  moves = [];
const worst = [];
let bigLumpTotal = 0,
  bigLumpFail = 0,
  smallTotal = 0,
  smallFail = 0;
for (let i = 0; i < N; i++) {
  const sc = genScenario(rng);
  // このシナリオの最大単一fix増分(=lump)
  let maxLump = 0,
    pd = 0;
  for (const fx of sc.fixes) {
    if (fx.dist - pd > maxLump) maxLump = fx.dist - pd;
    pd = Math.max(pd, fx.dist);
  }
  const r = runScenario(sc);
  const f = {
    overshoot: r.maxOver > 0.01,
    mono: r.mono > 0,
    jump: r.maxJump > 10.0,
    stopResid: r.worstStopResidual > 1.0,
    stoppedMove: r.worstStoppedMove > 0.05,
    latch: r.latchGap > 0.001,
  };
  if (f.overshoot) agg.overshootFail++;
  if (f.mono) agg.monoFail++;
  if (f.jump) agg.jumpFail++;
  if (f.stopResid) agg.stopResidFail++;
  if (f.stoppedMove) agg.stoppedMoveFail++;
  if (f.latch) agg.latchFail++;
  const anyFail = Object.values(f).some(Boolean);
  if (!anyFail) agg.allPass++;
  else if (worst.length < 8) worst.push({ i, ...r, fixes: sc.fixes.length, maxLump });
  // 大lump(>50m=トンネル等のgap一括)有無で分割
  if (maxLump > 50) {
    bigLumpTotal++;
    if (anyFail) bigLumpFail++;
  } else {
    smallTotal++;
    if (anyFail) smallFail++;
  }
  agg.maxOver = Math.max(agg.maxOver, r.maxOver);
  agg.maxJump = Math.max(agg.maxJump, r.maxJump);
  agg.maxStopResid = Math.max(agg.maxStopResid, r.worstStopResidual);
  agg.maxStoppedMove = Math.max(agg.maxStoppedMove, r.worstStoppedMove);
  agg.maxLatch = Math.max(agg.maxLatch, r.latchGap);
  jumps.push(r.maxJump);
  resids.push(r.worstStopResidual);
  moves.push(r.worstStoppedMove);
}
function pct(arr, p) {
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

console.log(
  '=== 表示エンジン Monte-Carlo シミュレーション (' + N + ' パターン・現 meter.js 実物) ===\n'
);
console.log(
  'シナリオ要素: 巡航/加減速・GPS穴3〜30s(トンネル)・信号停車2〜42s連打・再発進・グリッチlump20〜140m・タブ復帰10〜40s間引き×0〜2\n'
);
console.log('契約別 FAIL 数 (' + N + '中):');
console.log(
  '  (1) overshoot(過大/先取り) >0.01m : ' +
    agg.overshootFail +
    '   [max ' +
    agg.maxOver.toFixed(5) +
    'm]'
);
console.log('  (2) 単調違反(後退)               : ' + agg.monoFail);
console.log(
  '  (3) 10m飛び(>10m/frame)          : ' +
    agg.jumpFail +
    '   [max ' +
    agg.maxJump.toFixed(2) +
    'm / p95 ' +
    pct(jumps, 0.95).toFixed(2) +
    'm]'
);
console.log(
  '  (4) 停車時残差(>1.0m=確定で跳ね) : ' +
    agg.stopResidFail +
    '   [max ' +
    agg.maxStopResid.toFixed(2) +
    'm / p95 ' +
    pct(resids, 0.95).toFixed(2) +
    'm]'
);
console.log(
  '  (5) 停車後移動(>0.05m=止車で動く): ' +
    agg.stoppedMoveFail +
    '   [max ' +
    agg.maxStoppedMove.toFixed(3) +
    'm / p95 ' +
    pct(moves, 0.95).toFixed(3) +
    'm]'
);
console.log(
  '  (6) latch不一致(>0.001m)         : ' +
    agg.latchFail +
    '   [max ' +
    agg.maxLatch.toFixed(6) +
    'm]'
);
console.log(
  '\n★全契約PASS: ' + agg.allPass + ' / ' + N + ' (' + ((agg.allPass / N) * 100).toFixed(1) + '%)★'
);
console.log('\n--- 大lump(>50m=トンネルgap一括)有無での分割 ---');
console.log(
  '  大lump有り: ' +
    bigLumpTotal +
    '中 ' +
    bigLumpFail +
    ' FAIL (' +
    (bigLumpTotal ? ((bigLumpFail / bigLumpTotal) * 100).toFixed(1) : '0') +
    '%)'
);
console.log(
  '  大lump無し(巡航+停車のみ): ' +
    smallTotal +
    '中 ' +
    smallFail +
    ' FAIL (' +
    (smallTotal ? ((smallFail / smallTotal) * 100).toFixed(1) : '0') +
    '%)'
);
if (worst.length) {
  console.log('\n--- FAIL 例(最大8件)---');
  for (const w of worst)
    console.log(
      '  #' +
        w.i +
        ' fixes=' +
        w.fixes +
        ' over=' +
        w.maxOver.toFixed(3) +
        ' jump=' +
        w.maxJump.toFixed(1) +
        ' stopResid=' +
        w.worstStopResidual.toFixed(1) +
        ' stoppedMove=' +
        w.worstStoppedMove.toFixed(2) +
        ' latch=' +
        w.latchGap.toFixed(4)
    );
}
