'use strict';

// 純粋計算版 snap-to-polyline (js/roads-decoder.js の snapToNearestRoad 内核を Node に複製)
// CI でバイナリ road graph を持ち込まずに同じ projection 数学で regression を捕える目的
// 47 県 v=2 graph を読まず軽量・固定挙動。本物のデコーダーが返す snap オブジェクトと同形

const { metersPerDegree, haversineM } = require('./distance');

// 道路ポリライン [[lat,lng],...] への最近接 snap
// road = { points: [[lat,lng],...], typeCode, oneway, layer }
// returns: { roadIndex, segmentIndex, t, snapLat, snapLng, distanceM, typeCode, layer } | null
function snapToPolyline(roads, lat, lng, opts){
  opts = opts || {};
  const maxDistM = opts.maxDistM != null ? opts.maxDistM : 50;
  const mpd = metersPerDegree(lat);
  const mpdLat = mpd.lat;
  const mpdLng = mpd.lng;

  let bestSq = Infinity;
  let best = null;
  const maxSq = maxDistM * maxDistM;

  for(let r = 0; r < roads.length; r++){
    const road = roads[r];
    const pts = road.points;
    for(let j = 0; j < pts.length - 1; j++){
      const aLat = pts[j][0],     aLng = pts[j][1];
      const bLat = pts[j + 1][0], bLng = pts[j + 1][1];
      const ax = (aLng - lng) * mpdLng;
      const ay = (aLat - lat) * mpdLat;
      const bx = (bLng - lng) * mpdLng;
      const by = (bLat - lat) * mpdLat;
      const abx = bx - ax, aby = by - ay;
      const ab2 = abx * abx + aby * aby;
      let t;
      if(ab2 < 1e-9) t = 0;
      else {
        t = (-ax * abx + -ay * aby) / ab2;
        if(t < 0) t = 0;
        else if(t > 1) t = 1;
      }
      const px = ax + t * abx;
      const py = ay + t * aby;
      const sq = px * px + py * py;
      if(sq < bestSq && sq <= maxSq){
        bestSq = sq;
        best = {
          roadIndex: r,
          segmentIndex: j,
          t: t,
          snapLat: aLat + t * (bLat - aLat),
          snapLng: aLng + t * (bLng - aLng),
          distanceM: Math.sqrt(sq),
          typeCode: road.typeCode != null ? road.typeCode : 0,
          layer: road.layer != null ? road.layer : 0,
        };
      }
    }
  }
  return best;
}

// 同一道路上 (snapA.roadIndex === snapB.roadIndex) の道路上距離
// 異なる道路 → 直線距離 fallback (haversine)
function calcRoadDistance(roads, snapA, snapB){
  if(!snapA || !snapB) return null;
  if(snapA.roadIndex !== snapB.roadIndex){
    return {
      distanceM: haversineM(snapA.snapLat, snapA.snapLng, snapB.snapLat, snapB.snapLng),
      onSameRoad: false,
    };
  }
  const road = roads[snapA.roadIndex];
  const pts = road.points;
  let from = snapA, to = snapB;
  let reversed = false;
  if(snapA.segmentIndex > snapB.segmentIndex ||
    (snapA.segmentIndex === snapB.segmentIndex && snapA.t > snapB.t)){
    from = snapB; to = snapA; reversed = true;
  }
  let total = 0;
  if(from.segmentIndex === to.segmentIndex){
    const j = from.segmentIndex;
    const segLen = haversineM(pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1]);
    total = segLen * (to.t - from.t);
  } else {
    const jFrom = from.segmentIndex;
    const segLenFrom = haversineM(pts[jFrom][0], pts[jFrom][1], pts[jFrom + 1][0], pts[jFrom + 1][1]);
    total += segLenFrom * (1 - from.t);
    for(let j = jFrom + 1; j < to.segmentIndex; j++){
      total += haversineM(pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1]);
    }
    const jTo = to.segmentIndex;
    const segLenTo = haversineM(pts[jTo][0], pts[jTo][1], pts[jTo + 1][0], pts[jTo + 1][1]);
    total += segLenTo * to.t;
  }
  return { distanceM: total, onSameRoad: true, reversed: reversed };
}

module.exports = { snapToPolyline, calcRoadDistance };
