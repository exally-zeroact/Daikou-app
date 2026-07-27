#!/usr/bin/env node
'use strict';

// ============================================================
// tests/gate-route-gain.js
//   ★B(自前ルーティング強化) 利得検出ゲート (STEP1・実装前の感度計測)★
//
//   背景(監査結論): map-matcher の _routeDistance は距離の直接 sink でなく、
//     _transitionScore(自前routing)経由で「どの道にスナップするか」に
//     間接的に効くだけ(OSRM教師blendは2026-06-20廃止)。よって「自前ルーティングを強化(=道なり弧長を正確に)」
//     しても、スナップ選択(=表示の道/住所②/距離源の道)が ★実際に変わるのか★ が不明。
//     変わらない(利得≈0)なら B に投資する意味がない。まずそれを実値で測る。
//
//   方法(忠実・実コード):
//     実 js/map-matcher.js (Worker B) + 実 js/meter.js で iPhone13 fixture(ehime)を
//     ★同じ入力で2回★流す:
//       baseline = _forceRouteFactor 1   (現状=routing強化前)
//       forced   = _forceRouteFactor 1.25(交差道の routing を道なり化=強化を模擬・上限)
//     setForceRouteFactor は ★テスト専用 message★(既定1=本番byte不変)。
//
//   計測:
//     (1) スナップ変化点数 = baseline と forced で mmResult.snap の roadIndex/snapLat/Lng が
//         変わった点の数。0 なら「routing強化はスナップを1点も動かさない」= B利得ゼロ。
//     (2) distance_m の差(baseline vs forced)。
//     (3) 過大ゼロ感度: 両 run の distance_m を タイヤ真値 8390m と突合(参考)。
//
//   ★判定はこのゲート単体では PASS/FAIL を出さない(感度の "数値" を出すのが目的)★。
//   利得 0 → B 不要(現状維持)。利得あり → どの lever(tile硬化 等)で実装するか次STEP。
//
//   絶対不変: このゲートは検証のみ。_forceRouteFactor 既定1 = 本番完全不変。
//
//   使い方: node tests/gate-route-gain.js   [ROADS_PREF=ehime]
// ============================================================

const fs = require('fs');
const path = require('path');
const { createMapMatcherWorker, loadPrefRoadsData } = require('./replay-mm-worker/worker-sim');
const { loadMeter } = require('./replay-mm-worker/runner');

const DEFAULT_PREF = process.env.ROADS_PREF || 'ehime';
const FIXTURE_NAME = 'real-trace-iphone13-8.39km-tire.json';
const TIRE_TRUTH_M = 8390;
const FORCE_FACTOR = 1.25; // 道なり化を上限模擬(交差道弦×1.25)

const STANDARD_FARE = {
  baseFare: 1300,
  baseDistance: 1750,
  addFare: 100,
  addDistance: 311,
};

function loadFixture() {
  const p = path.join(__dirname, 'fixtures', FIXTURE_NAME);
  if (!fs.existsSync(p)) throw new Error('fixture 無し: ' + p);
  return JSON.parse(fs.readFileSync(p, 'utf8'))
    .filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .sort((a, b) => (a.t || 0) - (b.t || 0));
}

// ── 実 prod 経路を forceFactor 指定で1回流す。snap列 と distance_m を返す ──
function runOnce(pref, samples, forceFactor) {
  const worker = createMapMatcherWorker({ debug: false });
  const mmResults = [];
  let roadsLoaded = false;
  let forceAck = null;
  let forceStats = null;
  worker.on((e) => {
    const m = e.data;
    if (!m) return;
    if (m.type === 'mmResult') mmResults.push(m);
    if (m.type === 'roadsLoaded') roadsLoaded = m.ok;
    if (m.type === 'forceRouteFactorSet') forceAck = m.factor;
    if (m.type === 'forceRouteStats') forceStats = m;
  });
  const roadsData = loadPrefRoadsData(pref);

  const Meter = loadMeter({ debug: false });
  Meter.setFareConfig(STANDARD_FARE);
  Meter.reset();
  const handlers = [];
  worker.on((e) => {
    for (const h of handlers) h(e);
  });
  const adapter = {
    addEventListener(t, h) {
      if (t === 'message') handlers.push(h);
    },
    removeEventListener(t, h) {
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    },
    postMessage(msg) {
      worker.sendMessage(msg);
    },
  };
  Meter.setMapMatcher(adapter);
  adapter.postMessage({ type: 'configPlatform', isIOS: true });
  adapter.postMessage({ type: 'loadRoads', pref: roadsData.prefecture, roadsData });
  if (!roadsLoaded) throw new Error('loadRoads failed for pref=' + pref);
  // ★利得検出フックを設定(roadsLoaded 後・start 前)★
  adapter.postMessage({ type: 'setForceRouteFactor', factor: forceFactor });
  if (forceAck == null || Math.abs(forceAck - forceFactor) > 1e-9) {
    throw new Error('setForceRouteFactor ack mismatch: want ' + forceFactor + ' got ' + forceAck);
  }
  if (typeof Meter.setBusinessActive === 'function') Meter.setBusinessActive(true);
  Meter.start();
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  if (typeof Meter._setOffRoadGraceUntil === 'function') Meter._setOffRoadGraceUntil(0);

  for (const g of samples) {
    Meter.update({
      lat: g.lat,
      lng: g.lng,
      accuracy: g.acc,
      speedKmh: g.spd >= 0 ? g.spd * 3.6 : null,
      headingDeg: g.hdg,
      altitude: g.alt,
      timestamp: g.t,
      isStationary: false,
    });
  }
  adapter.postMessage({ type: 'getForceRouteStats' });
  Meter.businessEnd();
  const finalState = Meter.getState();

  // committed snap 列を抽出(表示/距離源の道)
  const snaps = [];
  for (const m of mmResults) {
    if (m._reason === 'pipeline flush before reset') continue;
    if (m.committed && m.snap) {
      snaps.push({
        roadIndex: m.snap.roadIndex,
        prefecture: m.snap.prefecture,
        snapLat: m.snap.snapLat,
        snapLng: m.snap.snapLng,
      });
    }
  }
  return {
    forceAck,
    forceStats,
    snaps,
    distance_m: finalState.distance_m,
    committedCount: snaps.length,
    mmResultCount: mmResults.length,
  };
}

// ── 2 run の snap 列を突合: roadIndex/座標が変わった点を数える ──
function diffSnaps(a, b) {
  const n = Math.min(a.length, b.length);
  let roadChanged = 0;
  let coordChanged = 0;
  for (let i = 0; i < n; i++) {
    const sa = a[i];
    const sb = b[i];
    if (sa.roadIndex !== sb.roadIndex || sa.prefecture !== sb.prefecture) roadChanged++;
    const dLat = Math.abs((sa.snapLat || 0) - (sb.snapLat || 0));
    const dLng = Math.abs((sa.snapLng || 0) - (sb.snapLng || 0));
    if (dLat > 1e-7 || dLng > 1e-7) coordChanged++;
  }
  return { compared: n, roadChanged, coordChanged, lenA: a.length, lenB: b.length };
}

function runGainGate(opts) {
  opts = opts || {};
  const pref = opts.pref || DEFAULT_PREF;
  const samples = loadFixture();

  const base = runOnce(pref, samples, 1);
  const forced = runOnce(pref, samples, opts.forceFactor || FORCE_FACTOR);
  const forcedDown = runOnce(pref, samples, 0.7); // ★逆方向: 交差道を短く=cross-road snap を誘発する側★
  const d = diffSnaps(base.snaps, forced.snaps);
  const dDown = diffSnaps(base.snaps, forcedDown.snaps);

  const distDelta = forced.distance_m - base.distance_m;
  const result = {
    pref,
    fixture: FIXTURE_NAME,
    tire_truth_m: TIRE_TRUTH_M,
    force_factor: opts.forceFactor || FORCE_FACTOR,
    baseline: {
      distance_m: round(base.distance_m),
      committed: base.committedCount,
      err_pct: round(((base.distance_m - TIRE_TRUTH_M) / TIRE_TRUTH_M) * 100),
    },
    forced: {
      distance_m: round(forced.distance_m),
      committed: forced.committedCount,
      err_pct: round(((forced.distance_m - TIRE_TRUTH_M) / TIRE_TRUTH_M) * 100),
    },
    snap_diff: d,
    distance_delta_m: round(distDelta),
    distance_delta_pct: round((distDelta / Math.max(1, base.distance_m)) * 100),
    force_fired: forced.forceStats
      ? {
          fireCount: forced.forceStats.fireCount,
          routeCallCount: forced.forceStats.routeCallCount,
          viaCount: forced.forceStats.viaCount,
        }
      : null,
    down_0p7: {
      distance_m: round(forcedDown.distance_m),
      snap_diff: dDown,
      distance_delta_m: round(forcedDown.distance_m - base.distance_m),
    },
  };
  // ★利得判定(graded・正直)★:
  //   - 距離(=お金)の感度: 両方向とも |Δdistance| < 1m → 課金には完全無影響。
  //   - スナップの感度: 変化点 / 全点。strengthening の実体は「routing をより正確(≒chordより少し長い)」=
  //     上向き(×1.25)側。上向きで snap が動かなければ "強化"は効かない。下向き(×0.7=交差道を安く)で
  //     僅かに動くのは強化の逆方向で意味が薄い。
  const distInsensitive =
    Math.abs(distDelta) < 1 && Math.abs(forcedDown.distance_m - base.distance_m) < 1;
  const upSnapChanged = d.roadChanged + d.coordChanged;
  const downSnapChanged = dDown.roadChanged + dDown.coordChanged;
  const total = Math.max(1, d.compared);
  result.verdict = {
    distance_insensitive: distInsensitive,
    up_snap_changed: upSnapChanged,
    up_snap_pct: round((upSnapChanged / total) * 100),
    down_snap_changed: downSnapChanged,
    down_snap_pct: round((downSnapChanged / total) * 100),
    // 強化(上向き)で距離も snap も動かない → B は効かない。
    worth_implementing: !distInsensitive || upSnapChanged > total * 0.01,
  };
  result.has_gain = result.verdict.worth_implementing;
  return result;
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}

if (require.main === module) {
  const r = runGainGate({});
  console.log('=== B 利得検出ゲート (STEP1・感度計測) ===');
  console.log(
    '  fixture: ' + r.fixture + ' / pref: ' + r.pref + ' / 真値: ' + r.tire_truth_m + 'm'
  );
  console.log('  force_factor(道なり化模擬): ' + r.force_factor);
  console.log('  ── baseline (routing強化前) ──');
  console.log(
    '    distance_m: ' +
      r.baseline.distance_m +
      ' (' +
      r.baseline.err_pct +
      '% vs 真値) / committed snap: ' +
      r.baseline.committed
  );
  console.log('  ── forced (交差道を道なり化=強化模擬) ──');
  console.log(
    '    distance_m: ' +
      r.forced.distance_m +
      ' (' +
      r.forced.err_pct +
      '% vs 真値) / committed snap: ' +
      r.forced.committed
  );
  console.log('  ── 差分(=Bの感度) ──');
  console.log(
    '    snap比較点数: ' +
      r.snap_diff.compared +
      ' (baseline ' +
      r.snap_diff.lenA +
      ' / forced ' +
      r.snap_diff.lenB +
      ')'
  );
  console.log('    ★道(roadIndex)が変わった点: ' + r.snap_diff.roadChanged);
  console.log('    ★スナップ座標が動いた点: ' + r.snap_diff.coordChanged);
  console.log('    distance_m 差: ' + r.distance_delta_m + 'm (' + r.distance_delta_pct + '%)');
  if (r.force_fired) {
    console.log('  ── ★forced分岐の発火統計(false-zero検出)★ ──');
    console.log('    _routeDistance 総呼び出し: ' + r.force_fired.routeCallCount);
    console.log('    forced(道なり化)発火回数: ' + r.force_fired.fireCount);
    console.log('    _via内訳: ' + JSON.stringify(r.force_fired.viaCount));
  }
  console.log('  ── 逆方向(factor0.7=交差道を短縮・cross-road snap誘発) ──');
  console.log(
    '    distance_m: ' +
      r.down_0p7.distance_m +
      ' / 道変化: ' +
      r.down_0p7.snap_diff.roadChanged +
      ' / 座標変化: ' +
      r.down_0p7.snap_diff.coordChanged +
      ' / 距離差: ' +
      r.down_0p7.distance_delta_m +
      'm'
  );
  console.log('');
  console.log('  ── ★判定★ ──');
  console.log(
    '    距離(お金)感度: ' +
      (r.verdict.distance_insensitive ? '無影響(両方向とも|Δ|<1m)' : '影響あり')
  );
  console.log(
    '    強化向き(上)snap変化: ' + r.verdict.up_snap_changed + '点 (' + r.verdict.up_snap_pct + '%)'
  );
  console.log(
    '    逆向き(下)snap変化: ' +
      r.verdict.down_snap_changed +
      '点 (' +
      r.verdict.down_snap_pct +
      '%・参考)'
  );
  console.log('');
  if (r.verdict.worth_implementing) {
    console.log(
      '★利得あり★ — routing強化でスナップ/距離が有意に動く。B実装に意味がある(次STEP=lever選定)。'
    );
  } else {
    console.log(
      '☆利得ほぼゼロ☆ — routing "強化"向き(×1.25)で距離もsnapも動かない。距離は両方向0m。'
    );
    console.log(
      '  現アーキ(_transitionScore 0.3間接blend)では自前ルーティング強化は表示snapを変えない。'
    );
    console.log(
      '  → B本実装は費用対効果ゼロ=現状維持(自前routingのまま)が正解。課金はOBDで全国保証済み。'
    );
  }
  console.log('');
  console.log(JSON.stringify(r, null, 2));
}

module.exports = { runGainGate };
