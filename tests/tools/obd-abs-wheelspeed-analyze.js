// tests/tools/obd-abs-wheelspeed-analyze.js
// ★ABS各輪速 ID 特定オフライン解析 (2026-06-15・測定前精度の本命レバー)★
//   実車で OBDClient.probeWheelSpeed() を ★異なる速度で数回★ 撃つと、各捕捉が
//   [OBD-WHEELSPEED] {obd010d_kmh, rawSample(ATMA生フレーム)} として Firebase debug_traces に残る。
//   本ツールは「どの CAN ID の・どのバイト位置(2byte)の値が 010D 車速に線形比例するか」を回帰で特定し、
//   その分解能(km/h/LSB)を出す。010D(1km/h floor)の30〜100倍細かい輪速チャネルが見つかれば、
//   floor量子化(-2%)を発生源から消せる ⇒ 測定前精度 -1.3% → -0.2〜-0.4%(過大ゼロ維持)。
//
//   使い方:
//     node tests/tools/obd-abs-wheelspeed-analyze.js <traceKey>      # Firebaseから取得
//     node tests/tools/obd-abs-wheelspeed-analyze.js --file caps.json # ローカルJSON([{obd010d_kmh,rawSample}])
//   ★最低2つ・できれば停車/20/40/60km/h の4捕捉★ があると回帰が決まる。
const fs = require('fs');
const path = require('path');
require(path.join(__dirname, '..', '..', 'js', 'obd-client.js'));
const OBD = global.OBDClient;
const SEED = require(path.join(__dirname, '..', '..', 'js', 'obd-wheelspeed-map.js'));

const BASE = 'https://daikou-app-c821a-default-rtdb.asia-southeast1.firebasedatabase.app';

async function jget(u) {
  return (await fetch(u)).json();
}

// ★実際の保存形式に整合(2026-06-15・debug-log-uploader.js 実コードで検証)★:
//   console.log は kind='console_log' の別キーに samples[{t,lvl,m}] で上がる(本文はフィールド ★m★・切詰なし)。
//   GPS trace(kind='GPS')とは別キー。∴ console_log キーを自動走査し m から [OBD-WHEELSPEED] を抽出する。
//   使い方: node obd-abs-wheelspeed-analyze.js [afterKey] / --file caps.json(ローカル) 。afterKey省略=直近200キー。
async function loadCaptures() {
  const a2 = process.argv[2];
  if (a2 === '--file') {
    const arr = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    return { caps: Array.isArray(arr) ? arr : [arr], identified: [] };
  }
  const afterKey = a2 || null;
  const keysObj = await jget(`${BASE}/debug_traces.json?shallow=true`);
  let keys = Object.keys(keysObj || {}).sort();
  keys = afterKey ? keys.filter((k) => k >= afterKey) : keys.slice(-200);
  const caps = [];
  const identified = [];
  for (const k of keys) {
    let meta;
    try {
      meta = await jget(`${BASE}/debug_traces/${k}/meta.json`);
    } catch {
      continue;
    }
    if (!meta || meta.kind !== 'console_log') continue; // ★console_log キーだけ★
    let ss;
    try {
      ss = await jget(`${BASE}/debug_traces/${k}/samples.json`);
    } catch {
      continue;
    }
    const arr = Array.isArray(ss) ? ss : Object.values(ss || {});
    for (const s of arr) {
      const line = s && typeof s.m === 'string' ? s.m : ''; // ★本文フィールド=m★
      if (line.indexOf('[OBD-WHEELSPEED-ID]') >= 0) {
        try {
          identified.push(JSON.parse(line.slice(line.indexOf('{'))));
        } catch (_) {
          /* skip */
        }
      } else if (line.indexOf('[OBD-WHEELSPEED]') >= 0) {
        try {
          caps.push(JSON.parse(line.slice(line.indexOf('{'))));
        } catch (_) {
          /* skip */
        }
      }
    }
  }
  return { caps, identified };
}

// ID別・バイト位置別の平均値を1捕捉ぶん計算(16bit BE/LE と 8bit 単独を候補化)
function decodeCapture(cap) {
  const frames = OBD._parseMonitorFrames(cap.rawSample || '');
  const byId = {};
  for (const f of frames) {
    if (!byId[f.id]) byId[f.id] = { sum: [], n: 0, len: f.bytes.length };
    const e = byId[f.id];
    e.n++;
    for (let b = 0; b < f.bytes.length; b++) e.sum[b] = (e.sum[b] || 0) + f.bytes[b];
  }
  const out = {};
  for (const id of Object.keys(byId)) {
    const e = byId[id];
    const mean = e.sum.map((v) => v / e.n);
    const cand = {};
    for (let o = 0; o + 1 < mean.length; o++) {
      cand[`${o}:BE16`] = mean[o] * 256 + mean[o + 1];
      cand[`${o}:LE16`] = mean[o + 1] * 256 + mean[o];
    }
    for (let o = 0; o < mean.length; o++) cand[`${o}:U8`] = mean[o];
    out[id] = { n: e.n, cand };
  }
  return out;
}

function linfit(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  const slope = sxy / sxx; // km/h per LSB
  const intercept = my - slope * mx;
  const r2 = (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2 };
}

async function main() {
  const loaded = await loadCaptures();
  const caps = (loaded.caps || []).filter(
    (c) => c && typeof c.obd010d_kmh === 'number' && c.rawSample
  );
  // ★端末が"その場で"確定したマッピング([OBD-WHEELSPEED-ID])を先に表示(オフライン識別の答え合わせ)★
  if (loaded.identified && loaded.identified.length) {
    const last = loaded.identified[loaded.identified.length - 1];
    console.log('=== 端末内識別の結果(on-device) ===');
    console.log(
      `  ✓確定 ID=${last.id} @${last.key} ・${Number(last.kmhPerLSB).toFixed(4)}km/h刻み ・R²=${Number(last.r2).toFixed(4)} ・${last.seedMatch ? last.seedMatch.join('/') : '未収録車(自動発見)'}`
    );
  }
  console.log(`=== ABS輪速 ID 特定解析(オフライン再確認) ===  捕捉数=${caps.length}`);
  if (caps.length === 0) {
    console.log(
      '捕捉0件。確認: (1)Android+OBD接続で1業務走ったか (2)8km/h以上を含む走行か(停車のみは撃たない) ' +
        '(3)?debuglog=on でログ送信が有効か (4)走行後にアプリを30秒以上開いたままにしたか(flush)。'
    );
    return;
  }
  caps.sort((a, b) => a.obd010d_kmh - b.obd010d_kmh);
  console.log('捕捉速度(010D km/h):', caps.map((c) => c.obd010d_kmh).join(', '));

  const decoded = caps.map(decodeCapture);
  // 全捕捉に共通して出てきた ID
  const common = decoded.reduce(
    (acc, d) => acc.filter((id) => id in d),
    Object.keys(decoded[0] || {})
  );
  console.log(`全捕捉共通の CAN ID 数 = ${common.length}`);

  if (caps.length < 2) {
    console.log('\n捕捉が1件のみ=回帰不可。動くバイト(速度候補)だけ列挙:');
    const s = OBD._summarizeFrames(OBD._parseMonitorFrames(caps[0].rawSample));
    s.slice(0, 12).forEach((e) =>
      console.log(`  ID ${e.id} count=${e.count} len=${e.len} changingBytes=[${e.changingBytes}]`)
    );
    console.log('\n→ 異なる速度で最低2回(理想4回)撃てば 010D との回帰で確定できます。');
    return;
  }

  // 各 ID×候補(offset:endian) について 値→010D の線形回帰
  const xs = caps.map((c) => c.obd010d_kmh); // 独立変数=010D速度
  const results = [];
  for (const id of common) {
    const keys = Object.keys(decoded[0][id].cand);
    for (const key of keys) {
      const ys = decoded.map((d) => d[id].cand[key]); // 候補の生値(各捕捉の平均)
      // 回帰: 010D = a*value + b。良い候補 = R²高・b小・aが正(=値が速度に比例)。
      const fit = linfit(ys, xs);
      if (!fit) continue;
      // 値レンジ(捕捉間の値の動き)。動かない候補は除外。
      const vmin = Math.min(...ys),
        vmax = Math.max(...ys);
      if (vmax - vmin < 1) continue;
      results.push({
        id,
        key,
        r2: fit.r2,
        kmhPerLSB: fit.slope, // この値1あたり何km/h(=分解能。小さいほど細かい)
        intercept: fit.intercept,
        valueRange: [vmin.toFixed(1), vmax.toFixed(1)],
      });
    }
  }
  results.sort((a, b) => b.r2 - a.r2 || Math.abs(a.kmhPerLSB) - Math.abs(b.kmhPerLSB));

  console.log('\n--- 輪速チャネル候補 (010Dとの線形あてはめ上位) ---');
  console.log('  R²      km/h/LSB   切片     値レンジ        ID:byte:endian   既知シード');
  results.slice(0, 15).forEach((r) => {
    const fine = Math.abs(r.kmhPerLSB) < 1 && Math.abs(r.kmhPerLSB) > 1e-4 ? ' ★高分解能★' : '';
    const seed = SEED.lookupById(r.id);
    const seedTag = seed ? ` ✓${seed.makers.join('/')}(${seed.endian}×${seed.factor})` : '';
    console.log(
      `  ${r.r2.toFixed(4)}  ${r.kmhPerLSB.toExponential(2)}  ${r.intercept.toFixed(2).padStart(7)}  [${r.valueRange.join('-')}]  ${r.id} @${r.key}${fine}${seedTag}`
    );
  });
  // ★既知シード照合: 撃ったIDが opendbc由来の既知輪速IDに一致したら即特定★
  const idHit = results.find((r) => SEED.lookupById(r.id) && r.r2 > 0.9);
  if (idHit) {
    const s = SEED.lookupById(idHit.id);
    console.log(
      `\n★既知シード一致: ID ${idHit.id} = ${s.makers.join('/')} の輪速(${s.endian}×${s.factor}・${s.resolutionKmhPerLsb}km/h/LSB)★`
    );
    if (s.note) console.log(`  注: ${s.note}`);
  }
  const best = results.find((r) => r.r2 > 0.98 && Math.abs(r.kmhPerLSB) < 0.2);
  console.log('\n--- 判定 ---');
  if (best) {
    console.log(
      `★輪速チャネル特定: ID ${best.id} @${best.key} ・分解能 ${best.kmhPerLSB.toExponential(3)} km/h/LSB (010Dの${(1 / Math.abs(best.kmhPerLSB)).toFixed(0)}倍細かい) ・R²=${best.r2.toFixed(4)}★`
    );
    console.log(
      '  → このID/オフセット/係数を車種マップに登録し、∫(輪速)で floor量子化を消す検証へ進める。'
    );
  } else {
    console.log(
      'R²>0.98 かつ <0.2km/h/LSB の明確な高分解能チャネルは未検出。捕捉速度の幅を広げる/捕捉回数を増やす、'
    );
    console.log('または ATCRA で候補IDを絞って再捕捉。上位候補(↑)を手動精査。');
  }
}
main().catch((e) => console.error('ERR', e.message));
