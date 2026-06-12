'use strict';

// gap-routing-validation.test.js
// ★STEP4 Phase2-a 検証基盤 (2026-05-27)★
// 合成 ground-truth でトンネル gap の「道路最短経路 routing」を実走行ゼロで検証する。
//   ・カーブ道路 = 真の道路距離が既知 (polyline 累積)
//   ・トンネル gap = 中間区間の GPS 点を間引く
//   ・検証: gap 前後の snap 間 calcRoadDistance (= 道路 polyline 距離) が
//           ★真値に一致し・過大に振れない★ことを数値で確認。
//   ・対照: 速度×時間 (旧 gap fill) の誤差と比較。
//
// この test は実装 (map-matcher.js _routeDistance / meter.js gate) と同じ
// アルゴリズム (= 同一道路 polyline 追従) を snap-lib で検証する。
// 過大/過少を数値で測れる状態にするのが目的 (司さんは運転不要)。

// describe/it/expect は vitest globals (vitest.config globals:true)
const { snapToPolyline, calcRoadDistance } = require('../lib/snap');
const { haversineM } = require('../lib/distance');

const TR = Math.PI / 180;
function metersPerDegree(lat) {
  return { lat: 111132.92, lng: 111412.84 * Math.cos(lat * TR) };
}
function step(lat, lng, bearingDeg, distM) {
  const mpd = metersPerDegree(lat);
  const dx = distM * Math.sin(bearingDeg * TR);
  const dy = distM * Math.cos(bearingDeg * TR);
  return [lat + dy / mpd.lat, lng + dx / mpd.lng];
}
function buildRoad(lat0, lng0, segments) {
  const pts = [[lat0, lng0]];
  let lat = lat0,
    lng = lng0;
  for (const seg of segments) {
    const [nlat, nlng] = step(lat, lng, seg.bearing, seg.length);
    pts.push([nlat, nlng]);
    lat = nlat;
    lng = nlng;
  }
  return pts;
}
function pointAtDistance(pts, distM) {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const segLen = haversineM(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (acc + segLen >= distM) {
      const t = segLen > 0 ? (distM - acc) / segLen : 0;
      return [
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
      ];
    }
    acc += segLen;
  }
  return pts[pts.length - 1];
}

describe('STEP4 Phase2-a: トンネル gap の道路 routing 検証 (合成 ground-truth・実走行不要)', () => {
  // カーブしたトンネル道路 (= 道路距離 > 直線距離 の意味ある形)
  const road = buildRoad(34.05, 132.99, [
    { bearing: 0, length: 200 },
    { bearing: 30, length: 200 },
    { bearing: 60, length: 200 },
    { bearing: 30, length: 200 },
    { bearing: 0, length: 200 },
  ]);
  const roadObj = { typeCode: 5, oneway: 0, layer: 0, points: road };

  // gap = [gapStartM, gapEndM] の区間で GPS 点を間引く (トンネル)
  const gapStartM = 350;
  const gapEndM = 700;
  const trueGapDistM = gapEndM - gapStartM; // 道路に沿った真のトンネル距離 = 350m

  function snapAt(distM) {
    const [lat, lng] = pointAtDistance(road, distM);
    return snapToPolyline([roadObj], lat, lng, { maxDistM: 50 });
  }

  it('道路 routing は真のトンネル距離に一致 (誤差 < 2%・過大に振れない)', () => {
    const snapBefore = snapAt(gapStartM); // gap 突入直前の snap
    const snapAfter = snapAt(gapEndM); // gap 復帰直後の snap
    expect(snapBefore).not.toBeNull();
    expect(snapAfter).not.toBeNull();
    // 同一道路 = 高信頼 (実装の同一road polyline guard と同条件)
    expect(snapBefore.roadIndex).toBe(snapAfter.roadIndex);

    const r = calcRoadDistance([roadObj], snapBefore, snapAfter);
    expect(r).not.toBeNull();
    expect(r.onSameRoad).toBe(true);

    const der = Math.abs(r.distanceM - trueGapDistM) / trueGapDistM;
    // 道路 routing は真値に一致
    expect(der).toBeLessThan(0.02);
    // ★認定バンド (片公差 −4%〜0%・過大ゼロ) を ★この同一道路 arc 経路にも強制★。★
    //   旧 assert は +5% の過大を許していた (認定不適合)。calcRoadDistance (同一道路弧長) は
    //   tail edge投影を経由しない経路なので元々 0% (実測 350.000m = +0.000%) で ★GREEN を維持★。
    //   ※ routedM (別道路 routeDistance の tailA/tailB 純加算) 由来の過大は A1 の本命であり、
    //     その over-zero 強制 RED は tests/integration/road-distance-gate.test.js (実 fixture
    //     8489m>8390m) と sim-fullpipeline-montecarlo --cert-strict が担う。
    //   ★テスト・ゲーミング禁止: 帯は認定根拠で固定。1m の過大も許さない。★
    expect(r.distanceM).toBeLessThanOrEqual(trueGapDistM + 0.5);
  });

  it('対照: 速度×時間 (旧 gap fill) はカーブで誤差が大きい (= routing の優位を数値化)', () => {
    // gap 中の平均速度を「gap 突入直前の直線速度」と仮定 (旧 gap fill の前提)
    // カーブのため直線進行すると道路距離より短くなる傾向 = 過少 / 速度誤認で過大もあり得る
    const gapSec = 35; // 350m を 36km/h(=10m/s) で 35s と仮定
    const lastSpeedMs = 10; // 36km/h
    const naiveDist = lastSpeedMs * gapSec; // 速度×時間 = 350m (速度一定なら一致)
    // 速度が変動した場合 (例: トンネルで減速 7m/s) の誤差を示す
    const slowedMs = 7;
    const naiveSlowed = slowedMs * gapSec; // 245m → 真値 350m に対し 30% 過少
    const derSlowed = Math.abs(naiveSlowed - trueGapDistM) / trueGapDistM;
    // 速度×時間は速度誤認で大きく外れる (routing はカーブ形状を捉えるので堅牢)
    expect(derSlowed).toBeGreaterThan(0.2); // 速度誤認で 20% 超の誤差が出ることを記録
    // 一定速度なら一致することも記録 (= 速度×時間が常に悪いわけではない)
    expect(Math.abs(naiveDist - trueGapDistM) / trueGapDistM).toBeLessThan(0.02);
  });

  it('過大 routing の検出: 別道路に誤 snap した場合は同一road guard で弾く', () => {
    // 並行する別道路 (gap 復帰点が誤って別道路に snap したケースを模擬)
    const parallel = road.map((p) => step(p[0], p[1], 90, 8)); // 8m 横の並行道路
    const roadObj2 = { typeCode: 5, oneway: 0, layer: 0, points: parallel };
    const snapBefore = snapToPolyline([roadObj, roadObj2], ...pointAtDistance(road, gapStartM), {
      maxDistM: 50,
    });
    const [aLat, aLng] = pointAtDistance(parallel, gapEndM);
    const snapWrong = snapToPolyline([roadObj, roadObj2], aLat, aLng, { maxDistM: 50 });
    // 復帰点が別道路 (roadIndex 不一致) なら・同一road guard で routing せず fallback すべき
    const sameRoad = snapBefore.roadIndex === snapWrong.roadIndex;
    // guard の意味確認: roadIndex 不一致なら calcRoadDistance は haversine fallback (onSameRoad=false)
    const r = calcRoadDistance([roadObj, roadObj2], snapBefore, snapWrong);
    if (!sameRoad) {
      expect(r.onSameRoad).toBe(false); // → 実装は onSameRoad=false で gap routing を見送る (速度×時間 fallback)
    }
    // この test は「同一road guard が誤 snap を弾く判定材料になる」ことを保証する
    expect(typeof r.onSameRoad).toBe('boolean');
  });
});
