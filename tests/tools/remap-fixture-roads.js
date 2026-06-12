#!/usr/bin/env node
'use strict';
// OSM自動更新 (osm-update.yml) で道路データの配列が変わると、replay-mm-worker fixture の
// ハードコード roadIndex がズレて invalid segment / 距離不一致で赤くなる (初出 2026-06-07・
// 4a22c494 で 22203→22201 等 -2 シフト)。本ツールは「更新前の git ref」の roads-ehime.js と
// 現 working tree の roads-ehime.js を geometry 完全一致で照合し、fixture の
// roadIndex / competing_road_indices / description 内の番号を自動リマップする。
//
// 使い方: node tests/tools/remap-fixture-roads.js <更新前のgit ref>
//   例:   node tests/tools/remap-fixture-roads.js b4514e6f
// 完全一致が取れない index (= OSM 側で geometry 自体が変わった) は書き換えせず exit 1。
// その場合は fixture の意図 (md 参照) を見て手動で道路を選び直すこと。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const PREF = 'ehime';

function loadDecoderFrom(roadsFile, pref) {
  const sw = global.window,
    ss = global.self,
    srd = global.RoadDecoder;
  const key = 'ROADS_' + pref.toUpperCase();
  const sr = global[key];
  try {
    global.window = global;
    global.self = global;
    eval(fs.readFileSync(path.join(ROOT, 'js', 'roads-decoder.js'), 'utf8'));
    eval(fs.readFileSync(roadsFile, 'utf8'));
    const data = global[key];
    const dec = new global.RoadDecoder(data);
    dec.buildOffsetTable();
    return { dec, numRoads: data.numRoads };
  } finally {
    global.window = sw;
    global.self = ss;
    global.RoadDecoder = srd;
    global[key] = sr;
  }
}

function fp(points) {
  return JSON.stringify(points);
}

function main() {
  const ref = process.argv[2];
  if (!ref) {
    console.error('使い方: node tests/tools/remap-fixture-roads.js <更新前のgit ref>');
    process.exit(2);
  }
  const oldFile = path.join(os.tmpdir(), 'dk-old-roads-' + PREF + '.js');
  fs.writeFileSync(
    oldFile,
    execSync('git show ' + ref + ':data/roads-' + PREF + '.js', {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
    })
  );

  const FIX_DIR = path.join(ROOT, 'tests', 'replay-mm-worker', 'fixtures');
  const fixtures = fs.readdirSync(FIX_DIR).filter((f) => f.endsWith('.json'));

  // 1. fixture から旧 roadIndex を収集
  const oldIndices = new Set();
  const fixObjs = {};
  for (const f of fixtures) {
    const o = JSON.parse(fs.readFileSync(path.join(FIX_DIR, f), 'utf8'));
    fixObjs[f] = o;
    for (const s of o.meta.ground_truth_segments || []) oldIndices.add(s.roadIndex);
    for (const i of o.meta.competing_road_indices || []) oldIndices.add(i);
  }
  console.log('fixture roadIndex (旧):', [...oldIndices].sort((a, b) => a - b).join(', '));

  // 2. 旧データで各 index の geometry を取得
  const old = loadDecoderFrom(oldFile, PREF);
  const oldRoads = {};
  for (const idx of oldIndices) {
    const r = old.dec.decodeRoadAt(idx);
    if (!r || !r.points) throw new Error('旧データで decode 不可: ' + idx);
    oldRoads[idx] = { fp: fp(r.points), nPoints: r.points.length, first: r.points[0].join(',') };
  }

  // 3. 新データ全道路を first-point で索引 → 完全一致を探す
  const cur = loadDecoderFrom(path.join(ROOT, 'data', 'roads-' + PREF + '.js'), PREF);
  const byFirst = new Map();
  for (let i = 0; i < cur.numRoads; i++) {
    const r = cur.dec.decodeRoadAt(i);
    if (!r || !r.points || !r.points.length) continue;
    const k = r.points[0].join(',');
    if (!byFirst.has(k)) byFirst.set(k, []);
    byFirst.get(k).push({ i, points: r.points });
  }

  const map = {};
  for (const idx of oldIndices) {
    const o = oldRoads[idx];
    const cands = byFirst.get(o.first) || [];
    const hit = cands.filter((c) => fp(c.points) === o.fp);
    if (hit.length === 1) {
      map[idx] = hit[0].i;
      console.log(
        `  ${idx} -> ${hit[0].i} (points=${o.nPoints} 完全一致${idx === hit[0].i ? '・不変' : ''})`
      );
    } else {
      console.log(`  ${idx} -> ★一致${hit.length}件 (要手動確認)・候補first一致=${cands.length}`);
      map[idx] = null;
    }
  }

  // 4. 全マップ確定なら fixture を書き換え (roadIndex / competing / description 内の番号)
  if (Object.values(map).some((v) => v == null)) {
    console.log('\n★未解決あり・書き換えスキップ (geometry が変わった道路は手動で選び直し)');
    process.exit(1);
  }
  let changed = 0;
  for (const f of fixtures) {
    const o = fixObjs[f];
    let dirty = false;
    for (const s of o.meta.ground_truth_segments || []) {
      if (map[s.roadIndex] !== s.roadIndex) dirty = true;
      s.roadIndex = map[s.roadIndex];
    }
    if (o.meta.competing_road_indices) {
      const before = o.meta.competing_road_indices.join(',');
      o.meta.competing_road_indices = o.meta.competing_road_indices.map((i) => map[i]);
      if (o.meta.competing_road_indices.join(',') !== before) dirty = true;
    }
    if (dirty && o.meta.description) {
      for (const [a, b] of Object.entries(map)) {
        if (String(a) !== String(b))
          o.meta.description = o.meta.description.split('road ' + a).join('road ' + b);
      }
    }
    if (dirty) {
      fs.writeFileSync(path.join(FIX_DIR, f), JSON.stringify(o, null, 2) + '\n');
      changed++;
      console.log('書き換え:', f);
    }
  }
  console.log(`\n完了: ${changed}/${fixtures.length} fixture 更新`);
}

main();
