// tests/tools/find-along-196.js
// 全端末・全セッションを走査し「196号KP線を沿って走った(chainage単調進行)」窓を探す。
// 各端末について perp<400m かつ chainage が単調進行する最長連続区間の chainage幅 を報告。
// 幅が数km出る端末/窓だけが真距離採点に使える。
const path = require('path');
const kp = require(path.join(__dirname, '..', 'fixtures', 'imabari-196-kp-rtk.json')).kp;
const BASE = 'https://daikou-app-c821a-default-rtdb.asia-southeast1.firebasedatabase.app';
const R = 6371000,
  rad = (d) => (d * Math.PI) / 180;
function proj(lat, lng) {
  let b = { p: 1e9, ch: 0 };
  for (let i = 0; i < kp.length - 1; i++) {
    const A = kp[i],
      B = kp[i + 1];
    const x = (p) => rad(p.lng - A.lng) * Math.cos(rad(A.lat)) * R,
      y = (p) => rad(p.lat - A.lat) * R;
    const bx = x(B),
      by = y(B),
      px = x({ lat, lng }),
      py = y({ lat, lng });
    const l2 = bx * bx + by * by;
    let t = l2 > 0 ? (px * bx + py * by) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const pp = Math.hypot(px - t * bx, py - t * by);
    if (pp < b.p) b = { p: pp, ch: A.kp + t * (B.kp - A.kp) };
  }
  return b;
}
async function jget(u) {
  return (await fetch(u)).json();
}
async function main() {
  const afterKey = process.argv[2] || null;
  const keysObj = await jget(`${BASE}/debug_traces.json?shallow=true`);
  let keys = Object.keys(keysObj).sort();
  keys = afterKey ? keys.filter((k) => k >= afterKey) : keys.slice(-120);
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
  console.log('=== 196号 沿走窓スキャン (perp<400m・chainage単調) ===');
  for (const lab of Object.keys(dev)) {
    const s = dev[lab].slice().sort((a, b) => a.t - b.t);
    const obdN = s.filter((x) => typeof x.obd === 'number' && x.obd >= 0).length;
    // perp<400 の点の (t,ch) を取り、chの単調進行最長スパンを測る
    const pts = s.map((x) => ({ t: x.t, ...proj(x.lat, x.lng) })).filter((p) => p.p < 400);
    let bestSpan = 0,
      bestN = 0;
    // 連続(時間隣接<15s)かつ単調方向一定で最大chスパン
    for (let dir = -1; dir <= 1; dir += 2) {
      let startCh = null,
        lastT = null,
        n = 0;
      for (const p of pts) {
        if (lastT == null || p.t - lastT > 15000) {
          startCh = p.ch;
          n = 0;
        } else if ((p.ch - startCh) * dir < -0.05) {
          startCh = p.ch;
          n = 0;
        }
        n++;
        const span = Math.abs(p.ch - startCh);
        if (span > bestSpan) {
          bestSpan = span;
          bestN = n;
        }
        lastT = p.t;
      }
    }
    console.log(
      `  端末=${lab}  全${s.length}点 OBD有${obdN}点  KP近傍(<400m)${pts.length}点  最長沿走chスパン=${bestSpan.toFixed(2)}km(${bestN}点)`
    );
  }
  console.log(
    '\n※ 沿走chスパンが数km出る端末だけが真距離採点に使える。<0.5kmは横切り/非沿走=採点不可。'
  );
}
main().catch((e) => console.error('ERR', e.message));
