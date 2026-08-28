// tests/lib/snap.drift-guard.test.js
//
// ★設計変更宣言 Phase 5 (2026-05-21・drift#2 撲滅・guard 方式採択):
//   tests/lib/snap.js は js/roads-decoder.js の snapToNearestRoad 内核を Node に複製したもの
//   (= 自書ヘッダ L3-6 で明示)。本テストは・両者が同一 probe で同じ snap 結果を出すことを
//   verify し・drift (= 一方の math が変更され他方が追従されない事象) を CI で検知する。
//
//   採択方針 (= 司さん指示・"移行が大規模/危険なら最低限 guard で乖離検知"):
//     - 完全移行 (= replay-mm.js を実 RoadDecoder 呼出に書換) は・fixture jsonl 形式 (= 自前
//       roads 配列を持つ軽量 fixture) を捨てて prefecture-wide data 依存に変える大規模改修。
//       本タスク範囲を超えるため drift-guard 方式を採択。
//     - 本テストは・projection math が乖離した場合 fail する。fail したら原因確認 → コピー
//       側を実体に追従 (or 逆) して再 PASS。
//
//   実装:
//     - 実 js/roads-decoder.js を vm context で load・実 data/roads-ehime.js を渡し
//       RoadDecoder.snapToNearestRoad を probe で呼ぶ。
//     - 同じ probe を tests/lib/snap.js snapToPolyline に・real 側が選んだ road 1 件のみを
//       candidate として渡す (= 探索範囲を一致させて projection math 単独を比較)。
//     - probe は実 ehime road 22203 (= low-speed-stop fixture が使う既知 road) の
//       segment 中央付近 ±少量 offset。
//     - segmentIndex の一致は厳密・snapLat/snapLng/distanceM は tolerance 内一致を要求。
//
//   既知 drift (= 本 test 作成時点・記録のみ):
//     metersPerDegree 係数が microscopically 異なる:
//       tests/lib/distance.js  : lat=111132.92・lng=111412.84*cos(lat)
//       js/roads-decoder.js    : lat=111132.954-559.822*cos(2lat)+1.175*cos(4lat)・lng=111319.488*cos(lat)
//     係数差: lat ~0.19% / lng ~0.08% (= 緯度 33.9° 周辺)。projection 結果に微差発生。
//     本 test の tolerance は・観測値ベースで本 drift を許容範囲とする (= 数 cm 〜 0.5m)。
//     より大きな drift (= 新規) は本テストが fail させる。
//
//   prod 無変更 (= js/roads-decoder.js / map-matcher.js / meter.js)。テスト追加のみ。
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { snapToPolyline } = require('./snap');

const JS_DIR = path.join(__dirname, '..', '..', 'js');
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

// 実 roads-decoder.js + 実 prefecture data を vm context で load
//   (= tests/replay-mm-worker/runner.js と同パターン・再実装 / Node コピー 禁止 を遵守)
function loadRealDecoder(pref) {
  const decSrc = fs.readFileSync(path.join(JS_DIR, 'roads-decoder.js'), 'utf8');
  const dataSrc = fs.readFileSync(path.join(DATA_DIR, 'roads-' + pref + '.js'), 'utf8');
  const ctx = {
    window: {},
    Buffer,
    Uint8Array,
    Uint32Array,
    performance: { now: () => Date.now() },
  };
  vm.createContext(ctx);
  vm.runInContext(decSrc, ctx);
  vm.runInContext(dataSrc, ctx);
  const data = ctx.window['ROADS_' + pref.toUpperCase()];
  const dec = new ctx.window.RoadDecoder(data);
  dec.buildOffsetTable();
  return { dec, data };
}

// decodeRoadAt は整数 lat*precision を返すため・snap.js が期待する float lat/lng に変換
function toFloatRoad(road, precision) {
  return {
    points: road.points.map(function (p) {
      return [p[0] / precision, p[1] / precision];
    }),
    typeCode: road.typeCode != null ? road.typeCode : 0,
    layer: road.layer != null ? road.layer : 0,
    oneway: road.oneway,
  };
}

describe('tests/lib/snap.js — drift-guard against real js/roads-decoder.js', () => {
  it('snapToPolyline projection matches RoadDecoder.snapToNearestRoad within tolerance (ehime probes)', () => {
    const { dec, data } = loadRealDecoder('ehime');

    // probe set: 実 ehime road 22203 / 22235 (= low-speed-stop / parallel-frontage fixture
    // で実証済の道路) の segment 中央付近を base とし・微小 offset を加えて off-road probe にする。
    // offset は perpendicular でない単純 lat/lng 加算 (= drift 検知目的なので簡単な off-road 化で十分)
    const baseRoads = [22203, 22235];
    const offsetsDeg = [
      [0, 0], // 直上 (= 道路ジオメトリ完全一致確認)
      [0.00005, 0], // 約 +5.5m 北
      [0, 0.00005], // 約 +4.6m 東
      [-0.00008, 0.00003], // 北西方向 off
    ];
    const probes = [];
    for (const rIdx of baseRoads) {
      const r = dec.decodeRoadAt(rIdx);
      if (!r || !r.points || r.points.length < 2) continue;
      const a = r.points[0];
      const b = r.points[1];
      const midLat = (a[0] + b[0]) / (2 * data.precision);
      const midLng = (a[1] + b[1]) / (2 * data.precision);
      for (const off of offsetsDeg) {
        probes.push({
          lat: midLat + off[0],
          lng: midLng + off[1],
          label: 'r' + rIdx + '_off' + off.join(','),
        });
      }
    }
    expect(probes.length).toBeGreaterThan(0);

    let matched = 0;
    let skipped = 0;
    const drifts = [];

    for (const p of probes) {
      // 実 RoadDecoder の snap (= prod が GPS に対して行う本物の snap)
      const realSnap = dec.snapToNearestRoad(p.lat, p.lng, { maxDistM: 100 });
      // ★2026-08-28: 全部 skip されても 緑でした＝★0件でも緑★（下で 0件なら 赤にします）
      if (realSnap == null) {
        skipped++;
        continue;
      }
      // real が選んだ road を decode → float lat/lng に変換 → snap.js に唯一 candidate として渡す
      // (= 探索範囲を一致させ・projection math 単独を比較する)
      const realRoad = dec.decodeRoadAt(realSnap.roadIndex);
      const floatRoad = toFloatRoad(realRoad, data.precision);
      const copySnap = snapToPolyline([floatRoad], p.lat, p.lng, { maxDistM: 1e6 });

      expect(copySnap).not.toBeNull();
      // segmentIndex は projection math が選ぶ・両者で一致するはず
      expect(copySnap.segmentIndex).toBe(realSnap.segmentIndex);

      const dLat = Math.abs(copySnap.snapLat - realSnap.snapLat);
      const dLng = Math.abs(copySnap.snapLng - realSnap.snapLng);
      const dDist = Math.abs(copySnap.distanceM - realSnap.distanceM);
      drifts.push({ label: p.label, dLat, dLng, dDist });

      // tolerance: 既知 mpd 係数差 (~0.2%) を許容・新規 drift は fail
      //   - snap 位置 lat/lng: 1e-5 deg (= ~1m) 以下を要求 (= drift ~0.1m を 10x マージン)
      //   - distanceM: 1m 以下を要求 (= drift typical < 0.05m を 20x マージン)
      expect(dLat).toBeLessThan(1e-5);
      expect(dLng).toBeLessThan(1e-5);
      expect(dDist).toBeLessThan(1);
      matched++;
    }

    expect(matched).toBeGreaterThan(0); // 少なくとも 1 件は実 road に snap 成立すること

    // 観測 log (= drift の actual size を見える化・regression 監視用)
    const maxDrift = drifts.reduce(
      function (m, d) {
        return {
          dLat: Math.max(m.dLat, d.dLat),
          dLng: Math.max(m.dLng, d.dLng),
          dDist: Math.max(m.dDist, d.dDist),
        };
      },
      { dLat: 0, dLng: 0, dDist: 0 }
    );
    // eslint-disable-next-line no-console
    // ★2026-08-28: 全部 skip でも 緑でした＝★0件でも緑★
    expect(
      probes.length - skipped,
      '★1点も snap 出来ていません（' +
        skipped +
        '/' +
        probes.length +
        ' が skip）＝0件を 合格と 読ませない★'
    ).toBeGreaterThan(0);

    console.log(
      '[snap.js drift-guard] matched=' +
        matched +
        ' skipped=' +
        skipped +
        ' total_probes=' +
        probes.length +
        ' max_dLat=' +
        maxDrift.dLat.toExponential(2) +
        ' max_dLng=' +
        maxDrift.dLng.toExponential(2) +
        ' max_dDist=' +
        maxDrift.dDist.toFixed(4) +
        'm'
    );
  }, 60000);
});
