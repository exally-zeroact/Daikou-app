#!/usr/bin/env node
'use strict';

// tests/real-trace-compare.js
// 実機 debug trace (★手元の data/traces/*.json★) を読み、
// 実走距離 (raw haversine) / ダイコメ報告値 (console business) / OSRM 道なり / Google 道なり
// の 4 系統を突き合わせて精度を自動検証する。
//
// 目的: 「Google マップと実走をちゃんと比較する」を手動操作ゼロで回す。
//   - OSRM は自前 endpoint (OSRM_ENDPOINT secret) を使うため公開デモの座標制限を受けない
//   - Google は Directions API に「実際に通った経路」を waypoint で渡すため、
//     ループ走行 (出発≒終点) でも 0m にならず道なり距離が出る (origin→dest 単独問合せの欠陥を是正)
//
// 環境変数:
//   GOOGLE_DIRECTIONS_API_KEY  Google Directions (未設定なら Google だけ skip)
//   OSRM_ENDPOINT / OSRM_PROFILE  自前 OSRM (未設定なら OSRM だけ skip)
//   REAL_TRACE_KEY  特定 trace を指定 (未設定なら最新 GPS trace を自動選択)
//
// 出力: data/test-results/real-trace-latest.json + 標準出力サマリ + GITHUB_STEP_SUMMARY

const fs = require('fs');
const path = require('path');

// ★★Firebase は 使いません（司さん 2026-08-30「読む為にも 使うな」）★★
//   前は ここに Firebase RTDB の 住所が 書いてあり、
//   ★毎日 2つの repo（本番・テスト）が 読んでいました★。
//   材料（実機の GPS trace）は ★手元の ファイル★から 受け取ります。
//     REAL_TRACE_FILE=<path>  … その ファイルを 読む
//     REAL_TRACE_KEY=<名前>   … data/traces/<名前>.json を 読む
//     どちらも 無ければ data/traces/ の 一番 新しい .json
//   ★材料が 無い時は 何処へも 繋がずに ★未測定★ と 言って 終わります★
const TRACE_DIR = path.join(__dirname, '..', 'data', 'traces');
const TRACE_FILE = (process.env.REAL_TRACE_FILE || '').trim();
const OUT_DIR = path.join(__dirname, '..', 'data', 'test-results');
const OUT_FILE = path.join(OUT_DIR, 'real-trace-latest.json');

const GOOGLE_KEY_RAW = process.env.GOOGLE_DIRECTIONS_API_KEY || '';
const GOOGLE_KEY = GOOGLE_KEY_RAW.trim(); // 貼付時の改行/空白混入を除去
// キーの形だけ安全診断 (中身は出さない: 長さ・AIza始まりか・前後空白の有無のみ)
if (GOOGLE_KEY_RAW) {
  console.log(
    '[real-compare] key diag: len=' +
      GOOGLE_KEY.length +
      ' startsAIza=' +
      GOOGLE_KEY.startsWith('AIza') +
      ' hadWhitespace=' +
      (GOOGLE_KEY_RAW !== GOOGLE_KEY)
  );
}
const OSRM_ENDPOINT = (process.env.OSRM_ENDPOINT || '').replace(/\/+$/, '');
const OSRM_PROFILE = process.env.OSRM_PROFILE || 'driving';
const FORCED_KEY = process.env.REAL_TRACE_KEY || '';

const TIMEOUT_MS = 10000;
const TRIP_GAP_SEC = 120; // この秒数より長い無通信は別 trip
const R = 6371000;

function rad(x) {
  return (x * Math.PI) / 180;
}
function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const la1 = rad(a.lat);
  const la2 = rad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function getJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

// ── 材料（GPS trace）を 手元から 読む ──
//   ★外へは 繋ぎません★。無ければ null を 返す（＝未測定）
function traceWoYomu() {
  let p = null;
  if (TRACE_FILE)
    p = path.isAbsolute(TRACE_FILE) ? TRACE_FILE : path.join(__dirname, '..', TRACE_FILE);
  else if (FORCED_KEY) p = path.join(TRACE_DIR, FORCED_KEY + '.json');
  else if (fs.existsSync(TRACE_DIR)) {
    const l = fs
      .readdirSync(TRACE_DIR)
      .filter((x) => x.endsWith('.json'))
      .sort();
    if (l.length) p = path.join(TRACE_DIR, l[l.length - 1]);
  }
  if (!p || !fs.existsSync(p)) return null;
  let j;
  try {
    j = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('[real-compare] 材料が 読めません: ' + p + ' / ' + e.message);
    return null;
  }
  // ★形は 2通り 受ける★ … 点の 並び そのもの ／ { samples: [...] }
  const samples = Array.isArray(j) ? j : Array.isArray(j && j.samples) ? j.samples : null;
  if (!samples) return null;
  return { key: path.basename(p), samples: samples };
}

// ── trip 分割し最大走行 segment を返す ──
function pickMainTrip(samples) {
  const s = samples
    .filter((x) => x && typeof x.lat === 'number' && typeof x.lng === 'number')
    .sort((a, b) => a.t - b.t);
  const segs = [[]];
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && s[i].t - s[i - 1].t > TRIP_GAP_SEC * 1000) segs.push([]);
    segs[segs.length - 1].push(s[i]);
  }
  let best = [];
  let bestDist = -1;
  for (const g of segs) {
    if (g.length < 2) continue;
    let d = 0;
    for (let i = 1; i < g.length; i++) d += haversine(g[i - 1], g[i]);
    if (d > bestDist) {
      bestDist = d;
      best = g;
    }
  }
  return { trip: best, rawDistanceM: bestDist > 0 ? bestDist : 0 };
}

// ── ダイコメ報告 business 距離 (km) の最大値を ★同じ 材料の 中から★ 拾う ──
//   ★前は ここでも 別に Firebase を 読んでいました★（もう 繋ぎません）
function extractDaikomeBusinessKm(samples) {
  if (!Array.isArray(samples)) return null;
  let maxKm = 0;
  let found = false;
  for (const x of samples) {
    if (!x || !x.m) continue;
    const mt = String(x.m).match(/\[Business\] total=([\d.]+)km/);
    if (!mt) continue;
    found = true;
    const km = parseFloat(mt[1]);
    if (km > maxKm) maxKm = km;
  }
  return found ? maxKm : null;
}

// ── OSRM /match (自前 endpoint・100 点間引き) ──
async function osrmMatch(trip) {
  // ★2026-08-28: 'skipped' は 読む人に 合格に見えます ⇒ ★未測定★ と はっきり言う
  if (!OSRM_ENDPOINT)
    return { status: 'misokutei', note: '★未測定★ OSRM_ENDPOINT が未設定（外のサービスが要る）' };
  const stride = Math.max(1, Math.floor(trip.length / 100));
  const pts = [];
  for (let i = 0; i < trip.length; i += stride) pts.push(trip[i]);
  if (pts[pts.length - 1] !== trip[trip.length - 1]) pts.push(trip[trip.length - 1]);
  const coordStr = pts.map((p) => p.lng.toFixed(6) + ',' + p.lat.toFixed(6)).join(';');
  const url =
    OSRM_ENDPOINT +
    '/match/v1/' +
    OSRM_PROFILE +
    '/' +
    coordStr +
    '?overview=false&annotations=distance&tidy=true';
  try {
    const resp = await getJson(url);
    if (!resp || !resp.matchings) return { status: 'no_match', distance_m: null };
    let d = 0;
    for (const m of resp.matchings) d += m.distance || 0;
    return { status: 'ok', distance_m: +d.toFixed(1), points_sent: pts.length };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
}

// ── Google Routes API computeRoutes (実走経路を intermediates で渡す・最大 25 点) ──
//   旧 Directions API は legacy で新規プロジェクト無効のため Routes API (新) を使用。
//   要: Google Cloud で「Routes API」有効化 + キー制限に Routes API を含める。
function llObj(p) {
  return { location: { latLng: { latitude: p.lat, longitude: p.lng } } };
}
async function googleDirections(trip) {
  if (!GOOGLE_KEY)
    return {
      status: 'misokutei',
      note: '★未測定★ GOOGLE_DIRECTIONS_API_KEY が未設定（外の鍵が要る）',
    };
  const MAX_WP = 23; // origin + destination + 中間 23 = 計 25 点
  const origin = trip[0];
  const dest = trip[trip.length - 1];
  const inner = trip.slice(1, -1);
  const wps = [];
  if (inner.length > 0) {
    const step = Math.max(1, Math.floor(inner.length / MAX_WP));
    for (let i = 0; i < inner.length && wps.length < MAX_WP; i += step) wps.push(inner[i]);
  }
  const body = {
    origin: llObj(origin),
    destination: llObj(dest),
    intermediates: wps.map(llObj),
    travelMode: 'DRIVE',
  };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_KEY,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify(body),
    });
    clearTimeout(t);
    const resp = await res.json();
    if (!res.ok || !resp.routes || !resp.routes[0] || resp.routes[0].distanceMeters == null) {
      return {
        status: 'no_route',
        http: res.status,
        google_error: resp && resp.error ? resp.error.message : null,
      };
    }
    return { status: 'ok', distance_m: resp.routes[0].distanceMeters, waypoints_sent: wps.length };
  } catch (e) {
    clearTimeout(t);
    return { status: 'error', error: e.message };
  }
}

function pct(a, b) {
  if (!b) return null;
  return +(((a - b) / b) * 100).toFixed(1);
}

async function main() {
  const zairyou = traceWoYomu();
  const key = zairyou ? zairyou.key : null;
  if (!key) {
    // ★2026-08-28: 黙って 0 で終わると 合格に見えます ⇒ ★未測定★ と はっきり言う
    console.error('★[real-compare] ★未測定★ 材料（GPS trace）が 手元に ありません★');
    console.error(
      '  置き場: data/traces/*.json ／ REAL_TRACE_FILE=<path> ／ REAL_TRACE_KEY=<名前>'
    );
    console.error('[real-compare] MISOKUTEI=1 reason=zairyou-nashi');
    console.error('  ⇒「測っていない」であって「異常なし」ではありません。');
    process.exit(0);
  }
  console.log('[real-compare] trace key =', key);
  const samples = zairyou.samples;
  if (!Array.isArray(samples) || samples.length < 2) {
    console.error('★[real-compare] ★未測定★ 実物が 空／読めません★');
    console.error('[real-compare] MISOKUTEI=1 reason=samples-empty');
    process.exit(0);
  }
  const { trip, rawDistanceM } = pickMainTrip(samples);
  if (trip.length < 2) {
    console.error('★[real-compare] ★未測定★ 走った区間が 在りません★');
    console.error('[real-compare] MISOKUTEI=1 reason=no-trip');
    process.exit(0);
  }
  const durSec = (trip[trip.length - 1].t - trip[0].t) / 1000;

  const daikomeKm = extractDaikomeBusinessKm(samples);
  const [osrm, google] = await Promise.all([osrmMatch(trip), googleDirections(trip)]);
  console.log('[real-compare] google_detail:', JSON.stringify(google));
  console.log('[real-compare] osrm_detail:', JSON.stringify(osrm));

  const rawM = +rawDistanceM.toFixed(1);
  const daikomeM = daikomeKm != null ? Math.round(daikomeKm * 1000) : null;
  const googleM = google.status === 'ok' ? google.distance_m : null;
  const osrmM = osrm.status === 'ok' ? osrm.distance_m : null;
  const ref = googleM != null ? googleM : osrmM != null ? osrmM : rawM; // 道なり基準

  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    trace_key: key,
    trip_points: trip.length,
    trip_duration_sec: +durSec.toFixed(0),
    distances_m: {
      raw_haversine: rawM,
      daikome_business: daikomeM,
      osrm_road: osrmM,
      google_road: googleM,
    },
    error_vs_google_pct: {
      daikome: daikomeM != null && googleM != null ? pct(daikomeM, googleM) : null,
      raw: googleM != null ? pct(rawM, googleM) : null,
      osrm: osrmM != null && googleM != null ? pct(osrmM, googleM) : null,
    },
    error_vs_reference_pct: {
      daikome: daikomeM != null ? pct(daikomeM, ref) : null,
      reference_source: googleM != null ? 'google' : osrmM != null ? 'osrm' : 'raw',
    },
    mlit_cert_band: '-4.0% 〜 0% (国交省 特定運賃収受ソフトウェア認定要領)',
    osrm_detail: osrm,
    google_detail: google,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));

  const lines = [];
  lines.push('## 🚕 実走 vs ダイコメ vs Google 距離比較');
  lines.push('');
  lines.push('- trace: `' + key + '` / ' + trip.length + '点 / ' + report.trip_duration_sec + '秒');
  lines.push('');
  lines.push('| 系統 | 距離 | Google比 |');
  lines.push('|---|---|---|');
  lines.push(
    '| 実走 (raw GPS) | ' + rawM + ' m | ' + fmtPct(report.error_vs_google_pct.raw) + ' |'
  );
  lines.push(
    '| ダイコメ (business) | ' +
      (daikomeM != null ? daikomeM + ' m' : 'N/A') +
      ' | ' +
      fmtPct(report.error_vs_google_pct.daikome) +
      ' |'
  );
  lines.push(
    '| OSRM 道なり | ' +
      (osrmM != null ? osrmM + ' m' : osrm.status) +
      ' | ' +
      fmtPct(report.error_vs_google_pct.osrm) +
      ' |'
  );
  lines.push(
    '| **Google 道なり** | ' +
      (googleM != null ? '**' + googleM + ' m**' : google.status) +
      ' | — |'
  );
  lines.push('');
  if (report.error_vs_reference_pct.daikome != null) {
    const e = report.error_vs_reference_pct.daikome;
    const band = e >= -4 && e <= 0 ? '✅ 認定基準内' : '❌ 認定基準外 (-4%〜0%)';
    lines.push(
      'ダイコメ誤差 (' +
        report.error_vs_reference_pct.reference_source +
        '基準): **' +
        e +
        '%** → ' +
        band
    );
  }
  const md = lines.join('\n');
  console.log('\n' + md + '\n');
  console.log('[real-compare] wrote ' + OUT_FILE);

  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
    } catch (_) {
      // best-effort
    }
  }
}

function fmtPct(p) {
  if (p == null) return '—';
  return (p > 0 ? '+' : '') + p + '%';
}

main().catch((e) => {
  console.error('[real-compare] fatal:', e);
  process.exit(0); // 検証スクリプトは CI を落とさない
});
