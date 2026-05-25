// tests/unit/oneway-violation.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step P1-⑧ / 全32件)
//
// ★設計変更宣言 Phase 5 (2026-05-21・drift#3 撲滅):
//   旧: isolated 再実装 (= map-matcher.js 内部関数を Node 側で複製) で property test。
//       js/map-matcher.js が drift しても本 test は気付けない (= 自書再実装は drift signal を持たない)。
//   新: 実 js/map-matcher.js を vm.runInContext で load (= tests/replay-mm-worker/worker-sim.js
//       経由・Worker B harness と同方式) し、実 _violatesOneway / _segmentBearing / _angleDiff
//       を直接 invoke する。再実装を撤去・実コード経路で D1-D12 / S1-S2 を verify。
//   絶対前提:
//     - prod 無変更 (js/map-matcher.js 完全不変)
//     - 再実装 / Node コピー 禁止 (= 実 js をそのまま実行)
//     - 既存 12 テストケース (D1-D12) の挙動意図は保持・assertion 内容は同等
//
// 検証対象: map-matcher.js L1720 _violatesOneway(prev, curr, prevGps, currGps)
//   curr.oneway=false → false
//   同 road・同 pref: segmentIndex 後退 / 同 segment で t 後退 → true (= 逆走)
//   別 road: GPS movementBearing と segBearing の angleDiff > 90° → true
//
// 検証手法:
//   ① 静的 verify: 実 map-matcher.js の関数定義 存在 (= drift 防止 grep)
//   ② 動的 verify: 実 _violatesOneway を vm context 経由で呼び property test で網羅

'use strict';

const fs = require('fs');
const path = require('path');
const { fc, propertyAssert } = require('../../scripts/zeroact-test-commons/property-test-helpers');
const { createMapMatcherWorker } = require('../replay-mm-worker/worker-sim');

const MAP_MATCHER_JS_PATH = path.join(__dirname, '..', '..', 'js', 'map-matcher.js');

function loadSource() {
  return fs.readFileSync(MAP_MATCHER_JS_PATH, 'utf8');
}

// 実 map-matcher.js を vm context で load・内部関数 _violatesOneway を取り出す
// (= 1 度だけ load し describe 全体で共有・vm 起動コストを節約)
let _ctxCache = null;
function getRealMapMatcherCtx() {
  if (_ctxCache) return _ctxCache;
  const w = createMapMatcherWorker();
  if (typeof w.ctx._violatesOneway !== 'function') {
    throw new Error(
      '[drift#3] map-matcher.js を vm load したが _violatesOneway が globalThis に存在しない (= drift detected)'
    );
  }
  _ctxCache = w.ctx;
  return _ctxCache;
}

// 実関数 wrapper (= test 内で呼びやすい名前)
function violatesOneway(prev, curr, prevGps, currGps) {
  return getRealMapMatcherCtx()._violatesOneway(prev, curr, prevGps, currGps);
}

describe('map-matcher.js _violatesOneway (P1-⑧・drift#3 実コード経路)', () => {
  // ─── ① 静的 verify (= 関数定義 grep・低コスト drift trip-wire) ──

  it('S1: map-matcher.js に function _violatesOneway 定義が存在', () => {
    const source = loadSource();
    if (!/function\s+_violatesOneway\s*\(/.test(source)) {
      throw new Error('_violatesOneway 関数定義未検出 (drift)');
    }
  });

  it('S2: _segmentBearing / _angleDiff helper 関数が存在', () => {
    const source = loadSource();
    if (!/function\s+_segmentBearing\s*\(/.test(source)) {
      throw new Error('_segmentBearing 関数定義未検出');
    }
    if (!/function\s+_angleDiff\s*\(/.test(source)) {
      throw new Error('_angleDiff 関数定義未検出');
    }
  });

  it('S3: vm load 後・_violatesOneway / _segmentBearing / _angleDiff が ctx に出現する', () => {
    const ctx = getRealMapMatcherCtx();
    expect(typeof ctx._violatesOneway).toBe('function');
    expect(typeof ctx._segmentBearing).toBe('function');
    expect(typeof ctx._angleDiff).toBe('function');
  });

  // ─── ② 動的 verify (= 実 _violatesOneway を直接 invoke) ──

  it('D1: curr=null → false (= 安全側)', () => {
    expect(violatesOneway(null, null, null, null)).toBe(false);
  });

  it('D2: curr.oneway=false → 常に false (= 双方向道路)', () => {
    const curr = { oneway: false, prefecture: 'tokyo', roadIndex: 1, segmentIndex: 5, t: 0.5 };
    const prev = { prefecture: 'tokyo', roadIndex: 1, segmentIndex: 10, t: 0.5 };
    expect(violatesOneway(prev, curr, null, null)).toBe(false);
  });

  it('D3: 同 road・同 pref で segmentIndex 後退 → true (= 逆走)', () => {
    const prev = { prefecture: 'tokyo', roadIndex: 1, segmentIndex: 10, t: 0.5 };
    const curr = {
      oneway: true,
      prefecture: 'tokyo',
      roadIndex: 1,
      segmentIndex: 5,
      t: 0.5,
    };
    expect(violatesOneway(prev, curr, null, null)).toBe(true);
  });

  it('D4: 同 road・同 pref で segmentIndex 前進 → false (= 順走)', () => {
    const prev = { prefecture: 'tokyo', roadIndex: 1, segmentIndex: 5, t: 0.5 };
    const curr = {
      oneway: true,
      prefecture: 'tokyo',
      roadIndex: 1,
      segmentIndex: 10,
      t: 0.5,
    };
    expect(violatesOneway(prev, curr, null, null)).toBe(false);
  });

  it('D5: 同 segment で t 後退 (= curr.t < prev.t - 0.05) → true', () => {
    const prev = { prefecture: 'tokyo', roadIndex: 1, segmentIndex: 5, t: 0.5 };
    const curr = { oneway: true, prefecture: 'tokyo', roadIndex: 1, segmentIndex: 5, t: 0.3 };
    expect(violatesOneway(prev, curr, null, null)).toBe(true);
  });

  it('D6: 同 segment で t 同じ or 0.05 以内の小差 → false (= 許容範囲)', () => {
    const prev = { prefecture: 'tokyo', roadIndex: 1, segmentIndex: 5, t: 0.5 };
    const curr1 = { oneway: true, prefecture: 'tokyo', roadIndex: 1, segmentIndex: 5, t: 0.5 };
    const curr2 = { oneway: true, prefecture: 'tokyo', roadIndex: 1, segmentIndex: 5, t: 0.46 };
    expect(violatesOneway(prev, curr1, null, null)).toBe(false);
    expect(violatesOneway(prev, curr2, null, null)).toBe(false);
  });

  it('D7: 別 road で GPS 移動方向と segment 方向が同方向 (= angleDiff<90) → false', () => {
    // GPS: 北向き (lat 増加)
    const prevGps = { lat: 33.84, lng: 132.7656 };
    const currGps = { lat: 33.8409, lng: 132.7656 };
    // segment: 北向き (= movement と同方向)
    const curr = {
      oneway: true,
      prefecture: 'tokyo',
      roadIndex: 2,
      segLatA: 33.84,
      segLngA: 132.7656,
      segLatB: 33.85,
      segLngB: 132.7656,
    };
    const prev = { prefecture: 'tokyo', roadIndex: 1 }; // 別 road
    expect(violatesOneway(prev, curr, prevGps, currGps)).toBe(false);
  });

  it('D8: 別 road で GPS 移動方向と segment 方向が逆向き (= angleDiff>90) → true', () => {
    // GPS: 北向き
    const prevGps = { lat: 33.84, lng: 132.7656 };
    const currGps = { lat: 33.8409, lng: 132.7656 };
    // segment: 南向き (= 逆方向)
    const curr = {
      oneway: true,
      prefecture: 'tokyo',
      roadIndex: 2,
      segLatA: 33.85,
      segLngA: 132.7656,
      segLatB: 33.83,
      segLngB: 132.7656,
    };
    const prev = { prefecture: 'tokyo', roadIndex: 1 };
    expect(violatesOneway(prev, curr, prevGps, currGps)).toBe(true);
  });

  it('D9: prev=null + curr.oneway=true + GPS あり → 別 road 判定で動作', () => {
    const prevGps = { lat: 33.84, lng: 132.7656 };
    const currGps = { lat: 33.83, lng: 132.7656 }; // 南向き
    const curr = {
      oneway: true,
      prefecture: 'tokyo',
      roadIndex: 2,
      segLatA: 33.83,
      segLngA: 132.7656,
      segLatB: 33.85, // segment は北向き → 逆走
      segLngB: 132.7656,
    };
    // prev=null なので「同 road」判定をスキップ・別 road 経路で判定
    expect(violatesOneway(null, curr, prevGps, currGps)).toBe(true);
  });

  it('D10: prevGps null → 別 road 判定スキップ → 同 road 一致なしで false', () => {
    const curr = {
      oneway: true,
      prefecture: 'tokyo',
      roadIndex: 2,
      segLatA: 33.83,
      segLngA: 132.7656,
      segLatB: 33.85,
      segLngB: 132.7656,
    };
    const prev = { prefecture: 'tokyo', roadIndex: 1 };
    // prevGps null で別 road 経路もスキップ → false
    expect(violatesOneway(prev, curr, null, null)).toBe(false);
  });

  it('D11: fast-check 同 road segmentIndex で property: prev<curr → false / prev>curr → true', () => {
    propertyAssert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (prevSeg, currSeg) => {
          if (prevSeg === currSeg) return; // skip 同値
          const prev = { prefecture: 'tokyo', roadIndex: 1, segmentIndex: prevSeg, t: 0.5 };
          const curr = {
            oneway: true,
            prefecture: 'tokyo',
            roadIndex: 1,
            segmentIndex: currSeg,
            t: 0.5,
          };
          const violation = violatesOneway(prev, curr, null, null);
          if (currSeg < prevSeg && !violation) {
            throw new Error(
              'seg 後退 (prev=' + prevSeg + ' > curr=' + currSeg + ') で違反検出失敗'
            );
          }
          if (currSeg > prevSeg && violation) {
            throw new Error('seg 前進 (prev=' + prevSeg + ' < curr=' + currSeg + ') で違反誤検出');
          }
        }
      )
    );
  });

  it('D12: fast-check 別 road bearing 任意値で対称性: 0°/180° で逆走判定', () => {
    propertyAssert(
      fc.property(fc.double({ min: 0, max: 359, noNaN: true }), (movementBearing) => {
        // GPS 移動方向を movementBearing で設定
        const movementRad = (movementBearing * Math.PI) / 180;
        const dy = Math.cos(movementRad) * 0.0001;
        const dx = Math.sin(movementRad) * 0.0001;
        const prevGps = { lat: 33.84, lng: 132.7656 };
        const currGps = { lat: 33.84 + dy, lng: 132.7656 + dx };

        // segment 方向 = movement と逆方向 (180° 反転)
        const segBearing = (movementBearing + 180) % 360;
        const segRad = (segBearing * Math.PI) / 180;
        const sdy = Math.cos(segRad) * 0.0001;
        const sdx = Math.sin(segRad) * 0.0001;

        const curr = {
          oneway: true,
          prefecture: 'tokyo',
          roadIndex: 2,
          segLatA: 33.84,
          segLngA: 132.7656,
          segLatB: 33.84 + sdy,
          segLngB: 132.7656 + sdx,
        };
        const prev = { prefecture: 'tokyo', roadIndex: 1 };
        const violation = violatesOneway(prev, curr, prevGps, currGps);
        // 完全逆方向 (180°) なら必ず違反検出
        if (!violation) {
          throw new Error(
            'movement=' + movementBearing + '° / seg=' + segBearing + '° で逆走未検出'
          );
        }
      })
    );
  });
});
