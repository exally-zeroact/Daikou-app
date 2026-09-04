// ★物差し★ 2026-08-28 … ★①タクシー認定モードの線（過大ゼロ）で 判定しています★
//   ・この見張りが 赤にするのは ★distance_m ≤ 真距離（過大不可）★ を 破った時（この file 自身に そう書いてある）
//   ・★代行は 検定対象外★＝法として「真距離を超えるな」は 課されていません。
//     代行の実上限は ★DM Light／タイヤ真値 ＋0.5〜6%★ という 緩い天井（係数 1.0085 で わざと上乗せ）。
//   ⇒★ここが赤でも「代行で 過大請求している」とは 限りません★。
//     うちは ★内側の約束★として 過大ゼロを 守っています（2026-08-23 の誤読を 二度と させない為 明記）。
// tests/tools/obd-196-sweep.js
// ★196号 実データ パラメータ・スイープ (2026-06-14)★
//   目的: 過大ゼロを破らない範囲で「過小」を限界まで詰める設定を実データで探す。
//   ①Firebaseから196号traceを1回だけ取得しローカルcache (再fetch回避)
//   ②KP線上(perp<60m)の最長連続区間を切り出し→有効な真距離refを得る
//   ③設定(quantile/quantCorrect/ratioMax/kMax)をグリッドで振り、KP真距離比 % と過大ゼロflag を実測
//   ④全窓は生OBD∫v比も併記
//   使い方: node tests/tools/obd-196-sweep.js [afterKey] [deviceLabel]
//           CACHE=1 で前回cacheを使う(fetchスキップ)

const fs = require('fs');
const path = require('path');
const os = require('os');
const PD = require(path.join(__dirname, '..', '..', 'js', 'pipeline-distance.js'));
const kp = require(path.join(__dirname, '..', 'fixtures', 'imabari-196-kp-rtk.json')).kp;

// ★★Firebase は 使いません（司さん 2026-08-30「読む為にも 使うな」）★★
//   材料は ★手元の data/traces/*.json★ から 受け取ります。
const TRACE = require('../lib/trace-zairyou');
// ★遠くの倉庫では ありません★（下の jget が 手元の 材料に 振り分けます）
const BASE = 'zairyou:';
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const CACHE = path.join(os.tmpdir(), 'obd-196-trace-cache.json');

function projKP(lat, lng) {
  let best = { perpM: 1e9, ch: 0 };
  for (let i = 0; i < kp.length - 1; i++) {
    const A = kp[i],
      B = kp[i + 1];
    const x = (p) => rad(p.lng - A.lng) * Math.cos(rad(A.lat)) * R;
    const y = (p) => rad(p.lat - A.lat) * R;
    const bx = x(B),
      by = y(B),
      px = x({ lat, lng }),
      py = y({ lat, lng });
    const l2 = bx * bx + by * by;
    let t = l2 > 0 ? (px * bx + py * by) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const perpM = Math.hypot(px - t * bx, py - t * by);
    if (perpM < best.perpM) best = { perpM, ch: A.kp + t * (B.kp - A.kp) };
  }
  return best;
}
const stub = {
  snapToNearestRoad: () => null,
  getRoadsNear: () => [],
  calcRoadDistance: () => null,
  decodeRoadAt: () => null,
};
// ★取ってくる 所だけ 差し替えました★（呼ぶ側は 1行も 変えていません）
//   ★外へは 1度も 繋ぎません★。知らない 行き先は ★そのまま 落とす★
//   （黙って 空を 返すと「材料が 無い」と 見分けが つかない為）
async function jget(u) {
  const s = String(u);
  if (s.indexOf('/debug_traces.json') >= 0) {
    const o = {};
    TRACE.keyIchiran().forEach((k) => {
      o[k] = true;
    });
    return o;
  }
  const m = s.match(/\/debug_traces\/([^/]+)\/(meta|samples)\.json/);
  if (m) {
    const r = m[2] === 'meta' ? TRACE.metaWoYomu(m[1]) : TRACE.samplesWoYomu(m[1]);
    if (r == null) throw new Error('材料が ありません: ' + m[1]);
    return r;
  }
  throw new Error('★外へは 繋ぎません★: ' + s);
}

async function loadSamples(afterKey, wantLabel) {
  if (process.env.CACHE === '1' && fs.existsSync(CACHE)) {
    console.log('cache使用:', CACHE);
    return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  }
  const keysObj = await jget(`${BASE}/debug_traces.json?shallow=true`);
  let keys = Object.keys(keysObj).sort();
  if (afterKey) keys = keys.filter((k) => k >= afterKey);
  else keys = keys.slice(-80);
  const dev = {};
  for (const k of keys) {
    let m;
    try {
      m = await jget(`${BASE}/debug_traces/${k}/meta.json`);
    } catch {
      continue;
    }
    if (!m || (m.kind && m.kind !== 'GPS')) continue;
    const lab = m.device_label || m.device_id || '?';
    let ss;
    try {
      ss = await jget(`${BASE}/debug_traces/${k}/samples.json`);
    } catch {
      continue;
    }
    const arr = Array.isArray(ss) ? ss : Object.values(ss || {});
    (dev[lab] = dev[lab] || []).push(...arr.filter((x) => x && typeof x.lat === 'number'));
  }
  let labels = Object.keys(dev);
  if (wantLabel) labels = labels.filter((l) => l === wantLabel);
  const pick = labels
    .map((l) => ({
      l,
      obdN: dev[l].filter((x) => x.spdsrc === 'obd' || (typeof x.obd === 'number' && x.obd >= 0))
        .length,
    }))
    .sort((a, b) => b.obdN - a.obdN)[0];
  let s = dev[pick.l];
  const seen = new Set();
  s = s
    .filter((x) => x.biz && (seen.has(x.t) ? false : (seen.add(x.t), true)))
    .sort((a, b) => a.t - b.t);
  const out = { label: pick.l, samples: s };
  fs.writeFileSync(CACHE, JSON.stringify(out));
  console.log('cache保存:', CACHE);
  return out;
}

function runEngine(samples, cfg) {
  const tk = PD.createDistanceTracker(stub, {
    useSnapCache: false,
    enableRouting: false,
    adaptiveMode: false,
    ...cfg,
  });
  tk.ingest({
    lat: samples[0].lat,
    lng: samples[0].lng,
    t: samples[0].t,
    acc: samples[0].acc,
    spd: 0,
    obd: true,
    dopMps: -1,
  });
  for (let i = 1; i < samples.length; i++) {
    const x = samples[i];
    const vObd = typeof x.obd === 'number' && x.obd >= 0 ? x.obd / 3.6 : 0;
    const dop = typeof x.spd === 'number' && x.spd >= 0 ? x.spd : -1;
    tk.ingest({ lat: x.lat, lng: x.lng, t: x.t, acc: x.acc, spd: vObd, obd: true, dopMps: dop });
  }
  return tk.totalM();
}

// 最長連続 on-KP(perp<60m) 区間を返す
function longestOnKP(s) {
  let best = null,
    cur = [];
  for (const x of s) {
    const p = projKP(x.lat, x.lng);
    if (p.perpM < 60) cur.push({ x, ch: p.ch });
    else {
      if (cur.length > (best ? best.length : 0)) best = cur;
      cur = [];
    }
  }
  if (cur.length > (best ? best.length : 0)) best = cur;
  return best || [];
}

async function main() {
  const { label, samples } = await loadSamples(process.argv[2] || null, process.argv[3] || null);
  console.log(`端末=${label} 全点=${samples.length}`);

  // 生OBD∫v(全窓)
  let rawAll = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].t - samples[i - 1].t) / 1000;
    if (dt > 0 && dt <= 10 && typeof samples[i].obd === 'number' && samples[i].obd >= 0)
      rawAll += (samples[i].obd / 3.6) * dt;
  }

  // ★真距離の代理 = 平滑GPS弦 win5 (ティア2出荷方式・過大ゼロ実証済・真距離の下限)★
  const R2 = 6371000,
    rd = (d) => (d * Math.PI) / 180;
  const hav = (a, b) => {
    const dla = rd(b.lat - a.lat),
      dln = rd(b.lng - a.lng);
    const x =
      Math.sin(dla / 2) ** 2 + Math.cos(rd(a.lat)) * Math.cos(rd(b.lat)) * Math.sin(dln / 2) ** 2;
    return 2 * R2 * Math.asin(Math.sqrt(x));
  };
  const sm = samples.map((_, i) => {
    let la = 0,
      ln = 0,
      n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(samples.length - 1, i + 2); j++) {
      la += samples[j].lat;
      ln += samples[j].lng;
      n++;
    }
    return { lat: la / n, lng: ln / n };
  });
  let smChord = 0;
  for (let i = 1; i < sm.length; i++) smChord += hav(sm[i - 1], sm[i]);
  let dopInt = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].t - samples[i - 1].t) / 1000;
    if (dt > 0 && dt <= 10 && typeof samples[i].spd === 'number' && samples[i].spd >= 0)
      dopInt += samples[i].spd * dt;
  }
  console.log(
    `\n★真距離代理(平滑GPS弦win5)=${(smChord / 1000).toFixed(3)}km / Doppler∫=${(dopInt / 1000).toFixed(3)}km / 生OBD∫v=${(rawAll / 1000).toFixed(3)}km`
  );
  console.log(
    `  生OBD∫v vs 平滑弦 = ${((rawAll / smChord - 1) * 100).toFixed(2)}% (現エンジンの過小)`
  );

  console.log(
    '\n=== 全窓スイープ (真距離代理=平滑弦・過小最小を探す・過大ゼロは別途property) ===\n' +
      'quant.q quantMps kMax | 全窓dist  %vs平滑弦  %vsDoppler'
  );
  for (const q of [0.25, 0.4, 0.5, 0.6])
    for (const qm of [0.139, 0.278])
      for (const km of [1.02, 1.05]) {
        const d = runEngine(samples, {
          obdDopQuantile: q,
          obdQuantCorrectMps: qm,
          obdKMax: km,
          obdRatchet: true,
          obdDopplerCeiling: true,
        });
        console.log(
          `  ${q.toFixed(2)}   ${qm.toFixed(3)}  ${km.toFixed(2)} | ${(d / 1000).toFixed(3)}km  ` +
            `${((d / smChord - 1) * 100).toFixed(2).padStart(6)}%  ${((d / dopInt - 1) * 100).toFixed(2).padStart(6)}%`
        );
      }
  console.log(
    '\n※ 平滑弦は真距離の下限=これに近づくほど良いが超えてもまだ真距離以下の余地あり。過大ゼロの可否はproperty(240台)が判定。'
  );

  // KP線上 最長区間 (参考・このtraceでは退化)
  const seg = longestOnKP(samples);
  const segS = seg.map((e) => e.x);
  let kpTrue = 0,
    rawSeg = 0;
  if (seg.length > 5) {
    kpTrue = Math.abs(seg[0].ch - seg[seg.length - 1].ch) * 1000;
    for (let i = 1; i < segS.length; i++) {
      const dt = (segS[i].t - segS[i - 1].t) / 1000;
      if (dt > 0 && dt <= 10 && typeof segS[i].obd === 'number' && segS[i].obd >= 0)
        rawSeg += (segS[i].obd / 3.6) * dt;
    }
  }
  console.log(
    `\nKP線上 最長連続区間: ${seg.length}点 / KP真距離=${(kpTrue / 1000).toFixed(3)}km / 生OBD∫v(区間)=${(rawSeg / 1000).toFixed(3)}km (${((rawSeg / kpTrue - 1) * 100).toFixed(2)}% vs KP)`
  );
  console.log(`全窓 生OBD∫v=${(rawAll / 1000).toFixed(3)}km`);

  // グリッド
  const quantiles = [0.25, 0.35, 0.5];
  const quants = [0.139, 0.208, 0.278]; // +0.5 / +0.75 / +1.0 km/h
  const ratioMaxes = [1.1];
  const kMaxes = [1.02, 1.05];

  console.log(
    '\n=== KP線上区間 採点 (過大ゼロ=dist≤KP真距離) ===\n' +
      'quant.q  quantMps  ratioMax kMax |  KP区間dist   %vsKP   過大ゼロ'
  );
  const rows = [];
  for (const q of quantiles)
    for (const qm of quants)
      for (const rm of ratioMaxes)
        for (const km of kMaxes) {
          const cfg = {
            obdDopQuantile: q,
            obdQuantCorrectMps: qm,
            obdRatioMax: rm,
            obdKMax: km,
            obdRatchet: true,
            obdDopplerCeiling: true,
          };
          const d = seg.length > 5 ? runEngine(segS, cfg) : 0;
          const pct = (d / kpTrue - 1) * 100;
          const over = d > kpTrue + 1;
          rows.push({ q, qm, rm, km, d, pct, over });
          console.log(
            `  ${q.toFixed(2)}    ${qm.toFixed(3)}    ${rm.toFixed(2)}   ${km.toFixed(2)} | ` +
              `${(d / 1000).toFixed(3)}km  ${pct.toFixed(2).padStart(6)}%  ${over ? '★過大!' : '✓'}`
          );
        }

  // 過大ゼロを守る中で過小最小(=pctが0に最も近く負側)
  const safe = rows.filter((r) => !r.over).sort((a, b) => b.pct - a.pct);
  console.log('\n--- 過大ゼロを守る中で過小最小 TOP3 ---');
  safe
    .slice(0, 3)
    .forEach((r) =>
      console.log(
        `  q=${r.q} quant=${r.qm} kMax=${r.km} → ${r.pct.toFixed(2)}% (${(r.d / 1000).toFixed(3)}km)`
      )
    );
  console.log(
    '\n※ KP真距離は±1%疑い(投影)。過大ゼロ判定はこの区間のKP真距離基準=絶対ではない。最終はproperty(240台)で確認。'
  );
}
main().catch((e) => console.error('ERR', e.message));
