#!/usr/bin/env node
/* eslint-env node */
// ============================================================
// scripts/build-town-polygons.js  町丁・字の 境の 形を 県ごとに 作る（dev tool）
//
// ★★2026-10-24 作り直し（司さん「どの都道府県でもきっちりやれ」）★★
//   前の 作り方（2026-05-23）は 町ごとに 輪を 別々に 削った（郊外 100m・緯度経度の 順も 逆）
//   ⇒ 隣の 町との 間に 隙間が でき、隙間に 落ちた 点は「一番 近い 市の 代表点＋付近」に なった
//     （今治市郷桜井 が「西条市 付近」「西条市郷桜井」・愛媛を 面積で 2万点＝引けない 1.35%・違う 町 1.68%）
//   ⇒ ファイルが 無い 市町村は 黙って 飛ばした（全国で 9市町村 まるごと 形が 無かった）
//
//   今の 作り方：
//     ① 県の 中の 全部の 町の 輪を 集め、2つ以上の 町が 本当に 共有して いる 境の 線（arc）を 見つける
//        （市の 境＝別の ファイル 同士も 同じ 線に なる＝今治と 西条の 間にも 隙間が 無い）
//     ② 線ごとに 1回だけ Douglas-Peucker 5m（メートルで・[lng,lat] の 順）
//     ③ 線を 差分の 整数（×1e5）で 書き、町は 線の 番号の 並びで 持つ＝端末で 輪に 組む（js/business.js）
//     ④ 水面（HCODE 8154）は 町に しない
//     ⑤ 市町村の ファイルが 1つでも 欠けたら 止める（黙って 抜かない）
//
// 入力:  tmp/nii-geoshape/r2ka{5桁}.topojson（NII Geoshape 町丁・字等境界 2020・フル解像度）
//        取り方 = https://geoshape.ex.nii.ac.jp/ka/topojson/2020/{県2桁}/r2ka{5桁}.topojson
//        別の 置き場は 環境変数 TOWN_SRC_DIR
// 出力:  data/town-polygons-{pref}.js（window.TOWN_POLYGONS_{PREF}・v 2）
//
// schema (v 2):
//   { v: 2, generated, precision: 100000, prefecture, prefCode, tolM: 5,
//     bbox: [latMinI, lngMinI, latMaxI, lngMaxI],
//     arcs: [[lat0I, lng0I, dLat1, dLng1, ...], ...],      // 差分の 整数（×1e5）
//     items: [{ n: '郷桜井三丁目', c: '今治市', code: '38202…', r: [[arcRef, ...], ...穴], bbox }],
//       // arcRef は 線の 番号（負＝~番号 を 逆向きに）。r[0] が 外周・r[1..] が 穴
//     cities: 市町村の 数, source, license, licenseUrl, sourceUrl }
//
// 使い方: node scripts/build-town-polygons.js [pref]   例: node scripts/build-town-polygons.js ehime
//
// 出典: 「令和2年国勢調査町丁・字等別境界データ」をもとに NII が 加工（NII Geoshape・CODH）
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = process.env.TOWN_SRC_DIR || path.join(ROOT, 'tmp', 'nii-geoshape');
const OUT_DIR = process.env.TOWN_OUT_DIR || path.join(ROOT, 'data');
const COARSE_JS = path.join(ROOT, 'data', 'addresses-coarse-jp.js');

const COORD_SCALE = 100000; // 出力（×1e5 ≒ 1.1m）
const KEY_SCALE = 1000000; // 元の 座標（小数 6桁）を 同じ 点と 見る 鍵
const TOL_M = 5; // 線を 削る 細かさ（愛媛で 違う 町 0.01%・10m で 0.24%・20m で 0.48%）
const SUIMEN_HCODE = 8154; // 水面 調査区＝町に しない

// 元データに 無い 市町村（北方領土＝404）
const NAI_KODE = new Set(['01695', '01696', '01697', '01698', '01699', '01700']);

// ★浜松市は 2024-01-01 に 区を 7 → 3（中央区・浜名区・天竜区）★ 2026-10-24
//   元データ（2020）は 古い 区（22131〜22137）＝一覧（coarse）の 新しい 番号（22138〜22140）では 取れず、
//   前の 作り方は 浜松市を まるごと 黙って 飛ばして いた。古い 区の ファイルを 読み、区の 名前を 今の 物に 置き換える
//   中・東・西・南区→中央区／北区の 三方原地区 7町→中央区・北区の 残り→浜名区／浜北区→浜名区／天竜区→天竜区
//   出典：浜松市「区再編」https://www.city.hamamatsu.shizuoka.jp/kikaku/kuseido/index.html
const HAMAMATSU_SHIN = ['22138', '22139', '22140'];
const HAMAMATSU_KYU = ['22131', '22132', '22133', '22134', '22135', '22136', '22137'];
const MIKATAHARA = /^(初生町|三方原町|東三方町|豊岡町|三幸町|大原町|根洗町)/;
function imaNoShi(cityName, sName) {
  if (!/^浜松市/.test(cityName)) return cityName;
  if (/^浜松市(中|東|西|南)区$/.test(cityName)) return '浜松市中央区';
  if (cityName === '浜松市北区') return MIKATAHARA.test(sName) ? '浜松市中央区' : '浜松市浜名区';
  if (cityName === '浜松市浜北区') return '浜松市浜名区';
  return cityName;
}

const SOURCE_CREDIT =
  '「令和2年国勢調査町丁・字等別境界データ」をもとにNIIが加工（NII Geoshape・CODH）';
const LICENSE_URL = 'https://www.e-stat.go.jp/terms-of-use';
const SOURCE_URL = 'https://geoshape.ex.nii.ac.jp/ka/';

const PREF_NAMES = {
  '01': 'hokkaido',
  '02': 'aomori',
  '03': 'iwate',
  '04': 'miyagi',
  '05': 'akita',
  '06': 'yamagata',
  '07': 'fukushima',
  '08': 'ibaraki',
  '09': 'tochigi',
  10: 'gunma',
  11: 'saitama',
  12: 'chiba',
  13: 'tokyo',
  14: 'kanagawa',
  15: 'niigata',
  16: 'toyama',
  17: 'ishikawa',
  18: 'fukui',
  19: 'yamanashi',
  20: 'nagano',
  21: 'gifu',
  22: 'shizuoka',
  23: 'aichi',
  24: 'mie',
  25: 'shiga',
  26: 'kyoto',
  27: 'osaka',
  28: 'hyogo',
  29: 'nara',
  30: 'wakayama',
  31: 'tottori',
  32: 'shimane',
  33: 'okayama',
  34: 'hiroshima',
  35: 'yamaguchi',
  36: 'tokushima',
  37: 'kagawa',
  38: 'ehime',
  39: 'kochi',
  40: 'fukuoka',
  41: 'saga',
  42: 'nagasaki',
  43: 'kumamoto',
  44: 'oita',
  45: 'miyazaki',
  46: 'kagoshima',
  47: 'okinawa',
};

// ─── TopoJSON の 線を 絶対座標へ（NII は transform 無し＝[lng, lat] の 絶対値）───
function topojsonDecode(topology) {
  const tr = topology.transform;
  if (tr && tr.scale && tr.translate) {
    return topology.arcs.map((arc) => {
      let x = 0;
      let y = 0;
      return arc.map((p) => {
        x += p[0];
        y += p[1];
        return [x * tr.scale[0] + tr.translate[0], y * tr.scale[1] + tr.translate[1]];
      });
    });
  }
  return topology.arcs.map((arc) => arc.map((p) => [p[0], p[1]]));
}

function arcsToRing(refs, arcs) {
  const out = [];
  refs.forEach((idx, i) => {
    const arc = arcs[idx < 0 ? ~idx : idx];
    if (!arc) return;
    const seq = idx < 0 ? arc.slice().reverse() : arc;
    out.push(...(i === 0 ? seq : seq.slice(1)));
  });
  return out;
}

// geometry → [[外周, 穴...], ...]（Polygon / MultiPolygon）
function geometryToPolys(geom, arcs) {
  if (geom.type === 'Polygon') return [geom.arcs.map((r) => arcsToRing(r, arcs))];
  if (geom.type === 'MultiPolygon') return geom.arcs.map((p) => p.map((r) => arcsToRing(r, arcs)));
  return [];
}

// ─── 点と 線分の 距離（メートル・[lng, lat]）───
function segDistM(p, a, b) {
  const k = Math.cos((p[1] * Math.PI) / 180);
  const px = p[0] * 111320 * k;
  const py = p[1] * 110574;
  const ax = a[0] * 111320 * k;
  const ay = a[1] * 110574;
  const dx = b[0] * 111320 * k - ax;
  const dy = b[1] * 110574 - ay;
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// Douglas-Peucker（両端は 残す・stack で）
function douglasPeucker(pts, tolM) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const st = [[0, n - 1]];
  while (st.length) {
    const [s, e] = st.pop();
    let m = 0;
    let mi = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDistM(pts[i], pts[s], pts[e]);
      if (d > m) {
        m = d;
        mi = i;
      }
    }
    if (m > tolM && mi > 0) {
      keep[mi] = 1;
      st.push([s, mi], [mi, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const keyOf = (p) => Math.round(p[0] * KEY_SCALE) + ',' + Math.round(p[1] * KEY_SCALE);

// ─── 共有の 境の 線を 作る ───
// rings: [[ [lng,lat], ... ], ...]（閉じた 輪）
// 返り: { arcs: [[ [lng,lat], ... ]], refs: [[arcRef, ...] (輪ごと)] }
function buildTopology(rings) {
  // 点ごとの 隣の 点（向き 無し）
  const nb = new Map();
  const addNb = (k, a, b) => {
    let s = nb.get(k);
    if (!s) nb.set(k, (s = new Set()));
    s.add(a);
    s.add(b);
  };
  const keyed = rings.map((r0) => {
    let r = r0;
    const ks = r.map(keyOf);
    // 閉じて いない 輪は 閉じる
    if (ks[0] !== ks[ks.length - 1]) {
      r = r.concat([r[0]]);
      ks.push(ks[0]);
    }
    return { r, ks };
  });
  keyed.forEach(({ ks }) => {
    const m = ks.length - 1; // 最後は 最初と 同じ
    for (let i = 0; i < m; i++) addNb(ks[i], ks[(i - 1 + m) % m], ks[(i + 1) % m]);
  });
  // 分かれ目＝隣が 3つ 以上（3つ 以上の 町が 会う・線が 枝分かれ）
  const isJ = (k) => nb.get(k).size > 2;
  const arcIdx = new Map(); // 線の 鍵 → 番号
  const arcs = [];
  const refs = keyed.map(({ r, ks }) => {
    const m = ks.length - 1;
    let start = -1;
    for (let i = 0; i < m; i++)
      if (isJ(ks[i])) {
        start = i;
        break;
      }
    const pieces = [];
    if (start < 0) {
      // 分かれ目が 無い 輪（島・1つの 町だけで 囲む）＝輪 まるごと 1本。始まりを 一番 小さい 鍵に 揃える
      let s = 0;
      for (let i = 1; i < m; i++) if (ks[i] < ks[s]) s = i;
      const seq = [];
      const kq = [];
      for (let i = 0; i <= m; i++) {
        seq.push(r[(s + i) % m]);
        kq.push(ks[(s + i) % m]);
      }
      pieces.push({ seq, kq });
    } else {
      let cur = [r[start]];
      let ck = [ks[start]];
      for (let step = 1; step <= m; step++) {
        const i = (start + step) % m;
        cur.push(r[i]);
        ck.push(ks[i]);
        if (isJ(ks[i])) {
          pieces.push({ seq: cur, kq: ck });
          cur = [r[i]];
          ck = [ks[i]];
        }
      }
    }
    return pieces.map(({ seq, kq }) => {
      const f = kq.join(';');
      const b = kq.slice().reverse().join(';');
      if (arcIdx.has(f)) return arcIdx.get(f);
      if (arcIdx.has(b)) return ~arcIdx.get(b);
      const id = arcs.length;
      arcs.push(seq);
      arcIdx.set(f, id);
      return id;
    });
  });
  return { arcs, refs };
}

function prefCityCodes() {
  const sandbox = {};
  new Function('window', fs.readFileSync(COARSE_JS, 'utf8'))(sandbox);
  const byPref = {};
  for (const it of sandbox.ADDRESSES_COARSE_JP.items) {
    if (!it.c || it.c.length !== 5 || !it.n || /所属未定/.test(it.n) || NAI_KODE.has(it.c))
      continue;
    (byPref[it.c.slice(0, 2)] = byPref[it.c.slice(0, 2)] || []).push(it.c);
  }
  return byPref;
}

function buildPref(prefCode, prefName, cityCodes0) {
  // 浜松市の 新しい 区の 番号は 古い 区の ファイルで 読む
  let cityCodes = cityCodes0.filter((c) => HAMAMATSU_SHIN.indexOf(c) < 0);
  if (cityCodes.length !== cityCodes0.length) cityCodes = cityCodes.concat(HAMAMATSU_KYU);
  // ⑤ 欠けたら 止める
  const kake = cityCodes.filter(
    (c) => !fs.existsSync(path.join(SRC_DIR, 'r2ka' + c + '.topojson'))
  );
  if (kake.length)
    throw new Error(prefName + ': 元データが 無い 市町村 ' + kake.length + ' = ' + kake.join(','));
  if (!cityCodes.length) throw new Error(prefName + ': 市町村が 0');
  const towns = []; // { n, c, code, ids: [輪の 番号] }
  const rings = [];
  let cities = 0;
  for (const code of cityCodes) {
    const t = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'r2ka' + code + '.topojson'), 'utf8'));
    if (!t.objects || !t.objects.town) throw new Error(code + ': town の 形が 無い');
    const arcs = topojsonDecode(t);
    let n = 0;
    for (const g of t.objects.town.geometries) {
      const p = g.properties || {};
      // ④ 水面は 町に しない。★町の 名前が 無い 区画（直島町・知夫村・平谷村 等の 町字に 分かれて いない 町村 全体 など・全国 211）は
      //   市町村の 名前だけで 入れる★（前の 作り方は 捨てた＝9市町村が まるごと 抜けた）
      if (!p.CITY_NAME || Number(p.HCODE) === SUIMEN_HCODE) continue;
      for (const poly of geometryToPolys(g, arcs)) {
        const ids = poly.map((r) => rings.push(r) - 1);
        towns.push({
          n: p.S_NAME || '',
          c: imaNoShi(p.CITY_NAME, p.S_NAME || ''),
          code: p.KEY_CODE,
          ids,
        });
        n++;
      }
    }
    if (!n) throw new Error(code + ': 町が 0');
    cities++;
  }
  const topo = buildTopology(rings);
  let vRaw = 0;
  let vOut = 0;
  const q = (v) => Math.round(v * COORD_SCALE);
  const outArcs = topo.arcs.map((a) => {
    vRaw += a.length;
    const s = douglasPeucker(a, TOL_M);
    // 差分の 整数（[lat, lng] の 順＝前の データと 同じ 向き）。重なった 点は 1つに
    const o = [];
    let pl = null;
    let pn = null;
    for (const p of s) {
      const la = q(p[1]);
      const ln = q(p[0]);
      if (pl === null) o.push(la, ln);
      else if (la !== pl || ln !== pn) o.push(la - pl, ln - pn);
      else continue;
      pl = la;
      pn = ln;
    }
    vOut += o.length / 2;
    return o;
  });
  // 線の 外枠（町の bbox 用）
  const arcBox = outArcs.map((o) => {
    let la = o[0];
    let ln = o[1];
    const b = [la, ln, la, ln];
    for (let i = 2; i < o.length; i += 2) {
      la += o[i];
      ln += o[i + 1];
      if (la < b[0]) b[0] = la;
      if (ln < b[1]) b[1] = ln;
      if (la > b[2]) b[2] = la;
      if (ln > b[3]) b[3] = ln;
    }
    return b;
  });
  const all = [Infinity, Infinity, -Infinity, -Infinity];
  const items = towns.map((t) => {
    const r = t.ids.map((i) => topo.refs[i]);
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ref of r[0]) {
      const ab = arcBox[ref < 0 ? ~ref : ref];
      if (ab[0] < b[0]) b[0] = ab[0];
      if (ab[1] < b[1]) b[1] = ab[1];
      if (ab[2] > b[2]) b[2] = ab[2];
      if (ab[3] > b[3]) b[3] = ab[3];
    }
    for (let k = 0; k < 4; k++) all[k] = k < 2 ? Math.min(all[k], b[k]) : Math.max(all[k], b[k]);
    return { n: t.n, c: t.c, code: t.code, r, bbox: b };
  });
  const out = {
    v: 2,
    generated: new Date().toISOString(),
    precision: COORD_SCALE,
    prefecture: prefName,
    prefCode: Number(prefCode),
    tolM: TOL_M,
    bbox: all,
    arcs: outArcs,
    items,
    cities,
    source: SOURCE_CREDIT,
    licenseUrl: LICENSE_URL,
    sourceUrl: SOURCE_URL,
  };
  const outFile = path.join(OUT_DIR, 'town-polygons-' + prefName + '.js');
  const header =
    '// Auto-generated by scripts/build-town-polygons.js (v 2・共有の 境を 1回だけ ' +
    TOL_M +
    'm で 削る)\n// 出典: ' +
    SOURCE_CREDIT +
    '\n// 利用規約: ' +
    LICENSE_URL +
    '\n// 市町村 ' +
    cities +
    ' / 町 ' +
    items.length +
    ' / 線 ' +
    outArcs.length +
    ' / 点 ' +
    vRaw +
    ' → ' +
    vOut +
    '\n';
  fs.writeFileSync(
    outFile,
    header + 'window.TOWN_POLYGONS_' + prefName.toUpperCase() + ' = ' + JSON.stringify(out) + ';\n'
  );
  const size = fs.statSync(outFile).size;
  console.log(
    '[build] ' +
      prefName +
      ' 市町村 ' +
      cities +
      ' 町 ' +
      items.length +
      ' 線 ' +
      outArcs.length +
      ' 点 ' +
      vRaw +
      '→' +
      vOut +
      ' ' +
      (size / 1024).toFixed(0) +
      'KB'
  );
  return { prefName, size, items: items.length, cities };
}

function main() {
  const only = process.argv[2];
  const byPref = prefCityCodes();
  const res = [];
  for (let i = 1; i <= 47; i++) {
    const pc = String(i).padStart(2, '0');
    const pn = PREF_NAMES[pc] || PREF_NAMES[i];
    if (only && only !== pn && only !== pc) continue;
    res.push(buildPref(pc, pn, byPref[pc] || []));
  }
  if (!res.length) throw new Error('県が 0（' + only + '）');
  const total = res.reduce((s, r) => s + r.size, 0);
  console.log('[build] 県 ' + res.length + ' / 合計 ' + (total / 1024 / 1024).toFixed(1) + 'MB');
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error('[build] 止めた:', e && (e.stack || e.message));
    process.exit(1);
  }
}

module.exports = {
  PREF_NAMES,
  imaNoShi,
  topojsonDecode,
  geometryToPolys,
  douglasPeucker,
  buildTopology,
  buildPref,
  segDistM,
};
