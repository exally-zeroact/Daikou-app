#!/usr/bin/env node
/* eslint-env node */
// ============================================================
// scripts/make-chimei-seikai.js  地名の 正解の 点を 県ごとに 作る（dev tool）2026-10-24
//
//   司さん「どの都道府県でもきっちりやれ」＝見張りの 正解は ★元の 細かい 形★（NII Geoshape フル解像度）で 決める
//   （前の 見張り gate-address2 は 正解を 削った 形 そのもの から 出した＝形が 間違って いても 緑だった）
//
//   県ごとに 点を 作る：
//     ・面積で 均等（山・田畑も 入る）N/2 点
//     ・人の 数（JINKO）で 町を 選び、その 中の 均等な 点 N/2 点（人が 行く 所）
//     ・正解は その 点を 囲む 元の 町（市の 名前は build-town-polygons と 同じ 置き換え・丁目は 切る）
//     ・元の 町の 境から 10m より 近い 点は 使わない（5m の 削りで どちらにも なり得る）
//   出力: tests/fixtures/chimei-seikai.json { v, n, perPref: { ehime: [[lat, lng, '今治市郷桜井'], ...] } }
//   使い方: TOWN_SRC_DIR=<元データ> node scripts/make-chimei-seikai.js [pref] [N]
//
//   ★--shi＝市町村（区）ごとに 1点（2026-10-30・6 住所の 全国確認）★
//     県ごとの 点は 小さな 村に 落ちない＝村が まるごと 抜けても 見張りが 緑（前の 作り方で 9市町村 抜けて いた）。
//     元データの 全部の 市町村（区・浜松は 今の 3区）で 一番 広い 町の 中の 1点 ⇒ perShi（perPref は 触らない）
//     ＋ tokubetsu＝町の 名前が 無い 区画 1つに 1点（混ざった 市町村の 分も）・浜松の 三方原地区 7町に 1点ずつ
//     使い方: TOWN_SRC_DIR=<元データ> node scripts/make-chimei-seikai.js --shi
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const B = require('./build-town-polygons.js');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = process.env.TOWN_SRC_DIR || path.join(ROOT, 'tmp', 'nii-geoshape');
const OUT = path.join(ROOT, 'tests', 'fixtures', 'chimei-seikai.json');
const N = Number(process.argv[3] || 200);
const KYORI_M = 10;

const cut = (n) => String(n).replace(/[一二三四五六七八九十百千〇零0-9０-９]+丁目$/, '');

function pip(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function box(rings) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings)
    for (const [x, y] of r) {
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    }
  return b;
}
function inPoly(p, x, y) {
  if (x < p.bb[0] || x > p.bb[2] || y < p.bb[1] || y > p.bb[3]) return false;
  if (!pip(x, y, p.rings[0])) return false;
  for (let k = 1; k < p.rings.length; k++) if (pip(x, y, p.rings[k])) return false;
  return true;
}
function edgeM(p, x, y) {
  let m = Infinity;
  for (const r of p.rings)
    for (let i = 1; i < r.length; i++) {
      const d = B.segDistM([x, y], r[i - 1], r[i]);
      if (d < m) m = d;
    }
  return m;
}

function prefPolys(prefCode) {
  const files = fs
    .readdirSync(SRC_DIR)
    .filter((f) => new RegExp('^r2ka' + prefCode + '\\d{3}\\.topojson$').test(f));
  const polys = [];
  for (const f of files) {
    const c5 = f.slice(4, 9);
    if (['22138', '22139', '22140'].indexOf(c5) >= 0) continue;
    const t = JSON.parse(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'));
    const arcs = B.topojsonDecode(t);
    for (const g of t.objects.town.geometries) {
      const p = g.properties || {};
      if (!p.CITY_NAME || Number(p.HCODE) === 8154) continue;
      for (const rings of B.geometryToPolys(g, arcs)) {
        const shi = B.imaNoShi(p.CITY_NAME, p.S_NAME || '');
        polys.push({
          shi,
          nashi: !p.S_NAME,
          name: shi + cut(p.S_NAME || ''),
          jinko: Number(p.JINKO) || 0,
          rings,
          bb: box(rings),
        });
      }
    }
  }
  return polys;
}

function main() {
  const only = process.argv[2];
  const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { v: 1, perPref: {} };
  const names = B.PREF_NAMES;
  for (let i = 1; i <= 47; i++) {
    const pc = String(i).padStart(2, '0');
    const pn = names[pc] || names[i];
    if (only && only !== pn && only !== pc) continue;
    const polys = prefPolys(pc);
    if (!polys.length) throw new Error(pn + ': 元データが 無い');
    const all = box(polys.flatMap((p) => p.rings));
    let seed = 1000 + i;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pts = [];
    const take = (p, x, y) => {
      if (edgeM(p, x, y) < KYORI_M) return false;
      pts.push([+y.toFixed(6), +x.toFixed(6), p.name]);
      return true;
    };
    // 面積で 均等
    let tries = 0;
    while (pts.length < N / 2 && tries++ < N * 400) {
      const x = all[0] + rnd() * (all[2] - all[0]);
      const y = all[1] + rnd() * (all[3] - all[1]);
      const p = polys.find((q) => inPoly(q, x, y));
      if (p) take(p, x, y);
    }
    // 人の 数で 町を 選ぶ
    const tot = polys.reduce((s, p) => s + p.jinko, 0);
    tries = 0;
    while (pts.length < N && tries++ < N * 400) {
      let r = rnd() * tot;
      let p = polys[0];
      for (const q of polys) {
        r -= q.jinko;
        if (r <= 0) {
          p = q;
          break;
        }
      }
      for (let k = 0; k < 50; k++) {
        const x = p.bb[0] + rnd() * (p.bb[2] - p.bb[0]);
        const y = p.bb[1] + rnd() * (p.bb[3] - p.bb[1]);
        if (inPoly(p, x, y) && take(p, x, y)) break;
      }
    }
    out.perPref[pn] = pts;
    console.log('[seikai] ' + pn + ' ' + pts.length + ' 点');
  }
  out.n = N;
  out.kyoriM = KYORI_M;
  out.source =
    '「令和2年国勢調査町丁・字等別境界データ」をもとにNIIが加工（NII Geoshape フル解像度）';
  fs.writeFileSync(OUT, JSON.stringify(out));
}

function menseki(r) {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(s / 2);
}

// 市町村（区）ごとに 一番 広い 町の 中の 1点（境から 10m 以上）
function shiMain() {
  const out = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const perShi = {};
  const tokubetsu = [];
  let nashiKukaku = 0;
  let kazu = 0;
  for (let i = 1; i <= 47; i++) {
    const pc = String(i).padStart(2, '0');
    const pn = B.PREF_NAMES[pc] || B.PREF_NAMES[i];
    const polys = prefPolys(pc);
    if (!polys.length) throw new Error(pn + ': 元データが 無い');
    let seed = 5000 + i;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const hiroi = new Map();
    for (const p of polys) {
      p.a = menseki(p.rings[0]);
      const m = hiroi.get(p.shi);
      if (!m || p.a > m.a) hiroi.set(p.shi, p);
    }
    const ten = (p) => {
      for (let k = 0; k < 2000; k++) {
        const x = p.bb[0] + rnd() * (p.bb[2] - p.bb[0]);
        const y = p.bb[1] + rnd() * (p.bb[3] - p.bb[1]);
        if (inPoly(p, x, y) && edgeM(p, x, y) >= KYORI_M)
          return [+y.toFixed(6), +x.toFixed(6), p.name];
      }
      return null;
    };
    const pts = [];
    for (const [shi, p] of hiroi) {
      const pt = ten(p);
      if (!pt) throw new Error(pn + ': ' + shi + ' の 中に 点が 取れない');
      pts.push(pt);
    }
    perShi[pn] = pts;
    // ★町の 名前が 無い 区画（全国 211・S_NAME が 空・町名の ある 町と 混ざった 市町村にも ある）は 1区画 1点★
    //   （小さくて 境から 10m の 点が 取れない 区画は 飛ばす＝数は 残す）
    for (const p of polys) {
      if (!p.nashi) continue; // ★元の 町名が 空か で 決める（「十二丁目」だけの 区画は 町名が ある＝名前で 決めると 混ざる）★
      nashiKukaku++;
      const pt = ten(p);
      if (pt) tokubetsu.push(pt.concat(pn));
    }
    // ★浜松の 旧北区 三方原地区 7町（今は 中央区）は 1町 1点（imaNoShi の 置き換えを 見張る）★
    if (pc === '22') {
      const hiroiMachi = new Map();
      for (const p of polys) {
        const m = /^浜松市中央区(初生町|三方原町|東三方町|豊岡町|三幸町|大原町|根洗町)/.exec(
          p.name
        );
        if (!m) continue;
        const q = hiroiMachi.get(m[1]);
        if (!q || p.a > q.a) hiroiMachi.set(m[1], p);
      }
      if (hiroiMachi.size !== 7)
        throw new Error('三方原地区の 町が ' + hiroiMachi.size + '（7 の はず）');
      for (const p of hiroiMachi.values()) {
        const pt = ten(p);
        if (!pt) throw new Error(p.name + ' の 中に 点が 取れない');
        tokubetsu.push(pt.concat(pn));
      }
    }
    kazu += pts.length;
    console.log('[seikai --shi] ' + pn + ' ' + pts.length + ' 市町村');
  }
  out.perShi = perShi;
  out.shiKazu = kazu;
  out.tokubetsu = tokubetsu;
  out.nashiKukaku = nashiKukaku;
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(
    '[seikai --shi] 全国 ' +
      kazu +
      ' 市町村・町名の 無い 区画 ' +
      nashiKukaku +
      '・特別の 点 ' +
      tokubetsu.length
  );
}

if (require.main === module) {
  if (process.argv[2] === '--shi') shiMain();
  else main();
}
