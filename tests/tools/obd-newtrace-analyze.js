// tests/tools/obd-newtrace-analyze.js
// ★新実走trace 即採点ツール (2026-06-13)★
//   実機テスト(196号+山越えトンネル)のtraceをFirebaseから取得し、新ロジック(過大ゼロ天井+精度ラチェット)を
//   ★実Doppler(coords.speed=trace.spd)★で採点する。合成でなく本物のDopplerで:
//     ・過大ゼロ (distance ≤ 真距離)
//     ・ラチェット効果 (OFF=天井のみ vs ON)
//     ・トンネル死区間 (Doppler欠落区間で連続前進・k_now保持)
//     ・196号KP区間は RTK真距離で絶対採点
//   使い方: node tests/tools/obd-newtrace-analyze.js [afterKey] [deviceLabel]
//     afterKey 省略時は直近セッションを自動検出。deviceLabel 省略時は OBD有(spdsrc=obd)の端末。

const path = require('path');
const PD = require(path.join(__dirname, '..', '..', 'js', 'pipeline-distance.js'));
const kp = require(path.join(__dirname, '..', 'fixtures', 'imabari-196-kp-rtk.json')).kp;

const BASE = 'https://daikou-app-c821a-default-rtdb.asia-southeast1.firebasedatabase.app';
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
function projKP(lat, lng) {
  let best = { perpM: 1e9 };
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

async function jget(u) {
  const r = await fetch(u);
  return r.json();
}

async function main() {
  const afterKey = process.argv[2] || null;
  const wantLabel = process.argv[3] || null;
  const keysObj = await jget(`${BASE}/debug_traces.json?shallow=true`);
  let keys = Object.keys(keysObj).sort();
  // 直近セッション: afterKey 以降、なければ末尾80件
  if (afterKey) keys = keys.filter((k) => k >= afterKey);
  else keys = keys.slice(-80);

  // GPS chunk を端末別に集約
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

  // OBD端末を選ぶ (spdsrc=obd or obd>=0 が多い)
  let labels = Object.keys(dev);
  if (wantLabel) labels = labels.filter((l) => l === wantLabel);
  const pick = labels
    .map((l) => ({
      l,
      obdN: dev[l].filter((x) => x.spdsrc === 'obd' || (typeof x.obd === 'number' && x.obd >= 0))
        .length,
      n: dev[l].length,
    }))
    .sort((a, b) => b.obdN - a.obdN)[0];
  if (!pick) {
    console.log(
      'OBD端末trace見つからず。afterKey/deviceLabelを指定してください。検出端末:',
      labels
    );
    return;
  }
  let s = dev[pick.l];
  const seen = new Set();
  s = s
    .filter((x) => x.biz && (seen.has(x.t) ? false : (seen.add(x.t), true)))
    .sort((a, b) => a.t - b.t);

  // 業務(tc)別に
  const byTc = {};
  for (const x of s) (byTc[x.biz.tc] = byTc[x.biz.tc] || []).push(x);

  console.log('=== 新実走trace 即採点 (' + pick.l + ' / OBD有) ===');
  console.log('端末=' + pick.l + ' 全点=' + s.length + ' 業務(tc)=' + Object.keys(byTc).join(','));

  function runEngine(samples, ratchet) {
    const tk = PD.createDistanceTracker(stub, {
      useSnapCache: false,
      enableRouting: false,
      adaptiveMode: false,
      obdRatchet: ratchet,
    });
    let dopN = 0,
      dopGap = 0;
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
      const dop = typeof x.spd === 'number' && x.spd >= 0 ? x.spd : -1; // ★実Doppler=coords.speed★
      if (dop >= 0) dopN++;
      else dopGap++;
      tk.ingest({ lat: x.lat, lng: x.lng, t: x.t, acc: x.acc, spd: vObd, obd: true, dopMps: dop });
    }
    return { dist: tk.totalM(), dopN, dopGap };
  }

  for (const tc of Object.keys(byTc).sort()) {
    const a = byTc[tc];
    if (a.length < 10) {
      console.log(`\n--- 業務tc=${tc}: 点少(${a.length})スキップ`);
      continue;
    }
    const chS = projKP(a[0].lat, a[0].lng),
      chE = projKP(a[a.length - 1].lat, a[a.length - 1].lng);
    const kpTrueM = Math.abs(chS.ch - chE.ch) * 1000;
    const onKP = chS.perpM < 60 && chE.perpM < 60; // 196号KP上か
    let rawInt = 0;
    for (let i = 1; i < a.length; i++) {
      const dt = (a[i].t - a[i - 1].t) / 1000;
      if (dt > 0 && dt <= 10 && typeof a[i].obd === 'number' && a[i].obd >= 0)
        rawInt += (a[i].obd / 3.6) * dt;
    }
    const off = runEngine(a, false),
      on = runEngine(a, true);
    console.log(`\n--- 業務tc=${tc} (${a.length}点) ---`);
    console.log(
      `  KP真距離=${(kpTrueM / 1000).toFixed(3)}km (端点perp ${chS.perpM.toFixed(0)}/${chE.perpM.toFixed(0)}m・196号上=${onKP}) / 生OBD∫v=${(rawInt / 1000).toFixed(3)}km`
    );
    console.log(`  Doppler有効=${on.dopN}点 / 欠落(トンネル等)=${on.dopGap}点`);
    const pct = (d) => (((d - kpTrueM) / kpTrueM) * 100).toFixed(2);
    const flag = (d) => (d <= kpTrueM + 1 ? '✓過大ゼロ' : '★過大!');
    if (onKP) {
      console.log(
        `  天井のみ(ratchet OFF): ${(off.dist / 1000).toFixed(3)}km  ${pct(off.dist)}%  ${flag(off.dist)}`
      );
      console.log(
        `  ラチェット ON       : ${(on.dist / 1000).toFixed(3)}km  ${pct(on.dist)}%  ${flag(on.dist)}`
      );
    } else {
      console.log(
        `  (196号KP外=絶対採点不可。生OBD∫v比で) OFF ${((off.dist / rawInt - 1) * 100).toFixed(2)}% / ON ${((on.dist / rawInt - 1) * 100).toFixed(2)}%`
      );
      console.log(
        `  過大ゼロ(≤生OBD∫v×1.02): OFF ${off.dist <= rawInt * 1.02} / ON ${on.dist <= rawInt * 1.02}`
      );
    }
  }
  console.log(
    '\n※ spd=実coords.speed(GNSS Doppler) / obd=OBD車速 で採点。過大ゼロ=最優先・精度はDoppler品質次第。'
  );
}
main().catch((e) => console.error('ERR', e.message));
