// ★物差し★ 2026-08-28 … ★①タクシー認定モードの線（過大ゼロ）で 判定しています★
//   ・この見張りが 赤にするのは ★distance_m ≤ 真距離（過大不可）★ を 破った時（この file 自身に そう書いてある）
//   ・★代行は 検定対象外★＝法として「真距離を超えるな」は 課されていません。
//     代行の実上限は ★DM Light／タイヤ真値 ＋0.5〜6%★ という 緩い天井（係数 1.0085 で わざと上乗せ）。
//   ⇒★ここが赤でも「代行で 過大請求している」とは 限りません★。
//     うちは ★内側の約束★として 過大ゼロを 守っています（2026-08-23 の誤読を 二度と させない為 明記）。
// tests/integration/adaptive-mode-distance.test.js
// ★確定2択方式 adaptiveMode の回帰ガード (2026-06-09・実トレース実証)★
//
// 方式: GPS良好=平滑生GPS弦をspd×dt×cap頭打ち / GPS穴(dt>1.8s)・劣化(acc>15m)=速度×時間 / 停止=ZUPT。
//   OBD全距離駆動(∫v)は廃止(実機-3.86%悪化)→ OBDは①cap/②穴埋めの速度源として spd 経由で使う。
// 検証: ①愛媛14業務 過大ゼロ(eng≤tire) ②実トレース(タイヤ真値)で国交省バンド内+トンネル穴回収
//       ③batch==tracker parity ④OFF=従来 byte 不変。
// 絶対ルール: distance_m 算出のみ・calcFare 非依存。

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FIX = path.join(__dirname, '..', 'fixtures');
let computeDistance, createDistanceTracker, dec;

beforeAll(() => {
  const sandbox = {
    console,
    atob: typeof atob !== 'undefined' ? atob : (b) => Buffer.from(b, 'base64').toString('binary'),
    btoa: typeof btoa !== 'undefined' ? btoa : (s) => Buffer.from(s, 'binary').toString('base64'),
    Uint8Array,
    TextDecoder: typeof TextDecoder !== 'undefined' ? TextDecoder : undefined,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'roads-decoder.js'), 'utf8'),
    sandbox,
    { filename: 'roads-decoder.js' }
  );
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'roads-ehime.js'), 'utf8'),
    sandbox,
    { filename: 'roads-ehime.js' }
  );
  dec = new sandbox.RoadDecoder(sandbox.ROADS_EHIME);
  dec.buildOffsetTable();
  const mod = require(path.join(__dirname, '..', '..', 'js', 'pipeline-distance.js'));
  computeDistance = mod.computeDistance;
  createDistanceTracker = mod.createDistanceTracker;
}, 60000);

function load(file) {
  const a = JSON.parse(fs.readFileSync(path.join(FIX, file), 'utf8'));
  return a.filter((x) => x && Number.isFinite(x.lat)).sort((x, y) => x.t - y.t);
}
function splitTrips(s) {
  const trips = [];
  let cur = null;
  for (let i = 0; i < s.length; i++) {
    const b = s[i].biz || {};
    const it = b.it != null ? b.it : b.run;
    if (it === 1) {
      if (!cur) cur = { s: i, e: i };
      cur.e = i;
    } else if (cur) {
      trips.push(cur);
      cur = null;
    }
  }
  if (cur) trips.push(cur);
  return trips.filter((t) => t.e - t.s > 20);
}
const OPT = { adaptiveMode: true, mode3D: false, enableRouting: false };

// ★fixture は slim 版 (lat/lng/t/acc/spd/biz・リポジトリ追跡済)。full版(accel配列入り)は未追跡で
//   CI に存在しない (ENOENT)。adaptiveMode は mode3D OFF で alt 不要・slim で過大ゼロ等価実証済。★
const EHIME = [
  { f: '0606-Android.slim.json', tire: [null, 3.57, 3.39] },
  { f: '0606-iPhone13.slim.json', tire: [null, 3.57, 3.39] },
  { f: '0606-iPhoneSE.slim.json', tire: [null, 3.57, 3.39] },
  { f: 'realtest3-Android.slim.json', tire: [1.5, 8.58, 9.59, 1.72] },
  { f: 'realtest3-iPhoneSE.slim.json', tire: [1.5, 8.58, 9.59, 1.72] },
];

describe('adaptiveMode 確定2択方式 (実機fixture)', () => {
  it('★愛媛14業務 過大ゼロ (eng ≤ tire) かつ 国交省バンド -4%〜0% 内', () => {
    const violations = [];
    // ★2026-08-28: 真値(tire)が 1つも 無くても 緑でした＝★0件でも緑★。
    //   ⇒ ★何回 比べたかを 数え、0回なら 赤★（0件と 異常なしを 混ぜない）
    let kurabetaKaisu = 0;
    for (const c of EHIME) {
      const a = load(c.f);
      splitTrips(a).forEach((tr, i) => {
        const tv = c.tire[i];
        if (tv == null) return;
        kurabetaKaisu++;
        const km = computeDistance(a.slice(tr.s, tr.e + 1), dec, OPT).distance_m / 1000;
        const pct = (km / tv - 1) * 100;
        if (pct > 0.05)
          violations.push(
            `${c.f} trip${i + 1} 過大 +${pct.toFixed(2)}% (eng=${km.toFixed(3)} tire=${tv})`
          );
        if (pct < -4) violations.push(`${c.f} trip${i + 1} 過小 ${pct.toFixed(2)}%`);
      });
    }
    // ★2026-08-28: 真値が 1つも 無くても 緑でした＝★0件でも緑★
    if (kurabetaKaisu === 0)
      throw new Error('★1回も 真値と 比べていません（0件を 合格と 読ませない）★');
    if (violations.length) throw new Error('過大/過小 違反:\n  ' + violations.join('\n  '));
  }, 30000);

  it('★実トレース(Android+OBD) タイヤ真値・トンネル穴回収 (バンド内・過大ゼロ)', () => {
    const a = load('realtrace-0609-Android-OBD.json');
    const trips = splitTrips(a);
    const TIRE = [6.73, 17.71];
    expect(trips.length).toBe(2);
    trips.forEach((tr, i) => {
      // 速度源 = OBD較正(+0.5中点)優先・無ければ Doppler (本番 speedProvider 相当)
      const seg = a.slice(tr.s, tr.e + 1).map((x) => {
        const o = x.obd;
        const sp =
          typeof o === 'number' && o >= 0
            ? (o + 0.5) / 3.6
            : typeof x.spd === 'number'
              ? x.spd
              : -1;
        return Object.assign({}, x, { spd: sp });
      });
      const r = computeDistance(seg, dec, OPT);
      const km = r.distance_m / 1000;
      const pct = (km / TIRE[i] - 1) * 100;
      expect(pct).toBeLessThanOrEqual(0.05); // 過大ゼロ
      expect(pct).toBeGreaterThanOrEqual(-4); // バンド内
      if (i === 1) {
        // 業務2=トンネル25秒穴 → 速度充填が発火し回収している
        expect(r.breakdown.dopplerM).toBeGreaterThan(100);
      }
    });
  }, 30000);

  it('★batch == tracker(ingest全点+flush) parity 完全一致', () => {
    for (const f of [
      '0606-Android.slim.json',
      'realtest3-iPhoneSE.slim.json',
      'realtrace-0609-Android-OBD.json',
    ]) {
      const a = load(f);
      const batch = computeDistance(a, dec, OPT).distance_m;
      const tk = createDistanceTracker(dec, OPT);
      for (const x of a) tk.ingest(x);
      if (tk.flush) tk.flush();
      expect(Math.abs(batch - tk.totalM())).toBeLessThanOrEqual(0.01);
    }
  }, 30000);

  it('★adaptiveMode:false=従来smoothedRawModeと一致(rollback契約) / true は別方式に切替', () => {
    const a = load('0606-Android.slim.json');
    const on = computeDistance(a, dec, { enableRouting: true, adaptiveMode: true }).distance_m;
    const off = computeDistance(a, dec, { enableRouting: true, adaptiveMode: false }).distance_m;
    const legacy = computeDistance(a, dec, {
      enableRouting: true,
      adaptiveMode: false,
      smoothedRawMode: true,
    }).distance_m;
    expect(Math.abs(off - legacy)).toBeLessThanOrEqual(0.0001); // adaptiveMode:false=従来win3 と一致(既定値非依存)
    expect(on).toBeGreaterThan(0);
    expect(off).toBeGreaterThan(0);
    expect(on).not.toBe(off); // フラグが距離源を実際に切替えている
  }, 30000);
});
