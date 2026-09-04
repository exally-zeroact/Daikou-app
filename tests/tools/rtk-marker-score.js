// tests/tools/rtk-marker-score.js
// ★標識実通過 RTK サブメートル採点 (2026-06-15・どの車でも使える汎用版)★
//   百米標(国交省道路基準点・RTK実測lat/lng)を「車が実際に通過した瞬間(最接近)」で捉え、
//   官製kp差(=真距離・誤差サブm)で OBD/Doppler/ダイコメ を採点する。1km粗ポリライン投影の±2%誤差を排除。
//   ★新しい車のテストもこれで即採点★: 型式に応じ factory K(MG33S=1.018)を自動適用、未登録車は自動(K=0)。
//   使い方: node tests/tools/rtk-marker-score.js [afterKey] [deviceLabel]
//     afterKey 省略=直近80セッション / deviceLabel 省略=OBD有が最多の端末。
const path = require('path');
const PD = require(path.join(__dirname, '..', '..', 'js', 'pipeline-distance.js'));
const kp = require(path.join(__dirname, '..', 'fixtures', 'imabari-196-kp-rtk.json')).kp;

// ★★Firebase は 使いません（司さん 2026-08-30「読む為にも 使うな」）★★
//   材料は ★手元の data/traces/*.json★ から 受け取ります。
const TRACE = require('../lib/trace-zairyou');
// ★遠くの倉庫では ありません★（下の jget が 手元の 材料に 振り分けます）
const BASE = 'zairyou:';
const R = 6371000,
  rad = (d) => (d * Math.PI) / 180;
const hav = (a, b) => {
  const dla = rad(b.lat - a.lat),
    dln = rad(b.lng - a.lng);
  const x =
    Math.sin(dla / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dln / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const stub = {
  snapToNearestRoad: () => null,
  getRoadsNear: () => [],
  calcRoadDistance: () => null,
  decodeRoadAt: () => null,
};
// ★factory較正テーブル(meter.js と同値・型式別・既存実測由来)★
const FACTORY_K = { MG33S: 1.018 };
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

function replay(ss, vk) {
  if (ss.length < 2) return 0;
  const tk = PD.createDistanceTracker(stub, {
    useSnapCache: false,
    enableRouting: false,
    adaptiveMode: false,
    obdVehicleK: vk,
  });
  tk.ingest({
    lat: ss[0].lat,
    lng: ss[0].lng,
    t: ss[0].t,
    acc: ss[0].acc,
    spd: 0,
    obd: true,
    dopMps: -1,
  });
  for (let k = 1; k < ss.length; k++) {
    const x = ss[k];
    const v = typeof x.obd === 'number' && x.obd >= 0 ? x.obd / 3.6 : 0;
    const d = typeof x.spd === 'number' && x.spd >= 0 ? x.spd : -1;
    tk.ingest({ lat: x.lat, lng: x.lng, t: x.t, acc: x.acc, spd: v, obd: true, dopMps: d });
  }
  return tk.totalM();
}
function rawDop(ss, i, j) {
  let r = 0,
    dp = 0;
  for (let k = i + 1; k <= j; k++) {
    const dt = (ss[k].t - ss[k - 1].t) / 1000;
    if (dt > 0 && dt <= 10) {
      if (typeof ss[k].obd === 'number' && ss[k].obd >= 0) r += (ss[k].obd / 3.6) * dt;
      if (typeof ss[k].spd === 'number' && ss[k].spd >= 0) dp += ss[k].spd * dt;
    }
  }
  return { r, dp };
}

async function main() {
  const afterKey = process.argv[2] || null;
  const wantLabel = process.argv[3] || null;
  const keysObj = await jget(`${BASE}/debug_traces.json?shallow=true`);
  let keys = Object.keys(keysObj).sort();
  keys = afterKey ? keys.filter((k) => k >= afterKey) : keys.slice(-80);
  const dev = {};
  const prof = {};
  for (const k of keys) {
    let m;
    try {
      m = await jget(`${BASE}/debug_traces/${k}/meta.json`);
    } catch {
      continue;
    }
    if (!m || (m.kind && m.kind !== 'GPS')) continue;
    const lab = m.device_label || m.device_id || '?';
    if (m.vehicle) prof[lab] = m.vehicle;
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
    .map((l) => ({ l, n: dev[l].filter((x) => typeof x.obd === 'number' && x.obd >= 0).length }))
    .sort((a, b) => b.n - a.n)[0];
  if (!pick) {
    console.log('OBD有traceが見つからず。afterKey/deviceLabel指定を。検出端末:', labels);
    return;
  }
  const seen = new Set();
  const all = dev[pick.l]
    .filter((x) => x.biz && (seen.has(x.t) ? false : (seen.add(x.t), true)))
    .sort((a, b) => a.t - b.t);
  const v = prof[pick.l] || {};
  const katashiki = v.katashiki || v.model || '?';
  const factoryK = FACTORY_K[katashiki] || 0;
  console.log(`=== RTK標識実通過 採点 ===`);
  console.log(
    `端末=${pick.l} 型式=${katashiki} タイヤ=${v.tire || '?'} 個体k=${v.k}(ks=${v.k_samples}) / factory K=${factoryK || 'なし(自動)'}`
  );
  // 業務(tc)別
  const byTc = {};
  for (const x of all) (byTc[x.biz.tc] = byTc[x.biz.tc] || []).push(x);
  for (const tc of Object.keys(byTc).sort()) {
    const s = byTc[tc];
    if (s.length < 20) {
      console.log(`\n--- 業務tc=${tc}: 点少(${s.length})`);
      continue;
    }
    // 各百米標への最接近点
    const passes = [];
    for (const m of kp) {
      let b = { d: 1e9, idx: -1 };
      for (let i = 0; i < s.length; i++) {
        const d = hav(s[i], m);
        if (d < b.d) b = { d, idx: i };
      }
      if (b.d < 60) passes.push({ kp: m.kp, idx: b.idx, closest: b.d });
    }
    passes.sort((a, b) => a.idx - b.idx);
    const applyK = factoryK || 0;
    if (passes.length >= 2) {
      let trueM = 0,
        obdM = 0,
        dopM = 0,
        autoM = 0,
        kM = 0,
        segN = 0;
      for (let p = 1; p < passes.length; p++) {
        const A = passes[p - 1],
          B = passes[p];
        if (B.idx <= A.idx) continue;
        const dkp = Math.abs(B.kp - A.kp);
        if (dkp < 0.5 || dkp > 3.5) continue;
        const rd = rawDop(s, A.idx, B.idx);
        trueM += dkp * 1000;
        obdM += rd.r;
        dopM += rd.dp;
        autoM += replay(s.slice(A.idx, B.idx + 1), 0);
        if (applyK > 0) kM += replay(s.slice(A.idx, B.idx + 1), applyK);
        segN++;
      }
      const pc = (x) => (((x - trueM) / trueM) * 100).toFixed(2);
      console.log(
        `\n--- 業務tc=${tc} (${s.length}点)・196号KP上 ${segN}区間 (通過標識${passes.length}個) ---`
      );
      console.log(`  ★真距離(官製RTK・サブm) = ${(trueM / 1000).toFixed(3)}km`);
      console.log(`  生OBD∫v   = ${(obdM / 1000).toFixed(3)}km  ${pc(obdM)}%`);
      console.log(`  Doppler∫  = ${(dopM / 1000).toFixed(3)}km  ${pc(dopM)}%`);
      console.log(`  自動(K=0) = ${(autoM / 1000).toFixed(3)}km  ${pc(autoM)}%`);
      if (applyK > 0)
        console.log(`  ★factory(×${applyK}) = ${(kM / 1000).toFixed(3)}km  ${pc(kM)}%★`);
      console.log(
        `  認定公差バンド[-4%〜0%] = [${((trueM * 0.96) / 1000).toFixed(3)} 〜 ${(trueM / 1000).toFixed(3)}]km`
      );
      console.log(`  → この車のK推定(真距離/生OBD) = ${(trueM / obdM).toFixed(4)}`);
    } else {
      // KP外: 独立基準(生OBD/Doppler/平滑弦)のみ
      let raw = 0,
        dop = 0;
      for (let i = 1; i < s.length; i++) {
        const dt = (s[i].t - s[i - 1].t) / 1000;
        if (dt > 0 && dt <= 10) {
          if (typeof s[i].obd === 'number' && s[i].obd >= 0) raw += (s[i].obd / 3.6) * dt;
          if (typeof s[i].spd === 'number' && s[i].spd >= 0) dop += s[i].spd * dt;
        }
      }
      const sm = s.map((_, i) => {
        let la = 0,
          ln = 0,
          n = 0;
        for (let j = Math.max(0, i - 2); j <= Math.min(s.length - 1, i + 2); j++) {
          la += s[j].lat;
          ln += s[j].lng;
          n++;
        }
        return { lat: la / n, lng: ln / n };
      });
      let smc = 0;
      for (let i = 1; i < sm.length; i++) smc += hav(sm[i - 1], sm[i]);
      console.log(`\n--- 業務tc=${tc} (${s.length}点)・★196号KP外(RTK採点不可・独立基準のみ)★ ---`);
      console.log(
        `  生OBD∫v=${(raw / 1000).toFixed(3)}km / Doppler∫=${(dop / 1000).toFixed(3)}km / 平滑弦=${(smc / 1000).toFixed(3)}km / 自動=${(replay(s, 0) / 1000).toFixed(3)}km${applyK ? ' / factory=' + (replay(s, applyK) / 1000).toFixed(3) + 'km' : ''}`
      );
      console.log(`  ※RTK真距離はKP区間のみ。196号(長沢〜小泉のKP上)を沿走すれば真距離採点可。`);
    }
  }
  console.log(
    '\n※ サブm精度RTK採点は「百米標を60m以内で通過」した区間のみ。新車も型式記録→factory無ければ自動(K=0)で採点。'
  );
}
main().catch((e) => console.error('ERR', e.message));
