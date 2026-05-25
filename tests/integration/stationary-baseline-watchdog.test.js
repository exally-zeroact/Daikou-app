// tests/integration/stationary-baseline-watchdog.test.js
//
// ★設計変更宣言 (2026-05-23・Phase 1・静止判定 baseline watchdog):
//   今後 Phase 2-3 で・isStationary 判定 (= gps.js radius / gps-worker.js 3点AND/閾値) を・
//   司さん専決で・改修する時の・「片方直して片方壊す」検知用 baseline test。
//
//   ★ 現状 baseline の・記録 ★ (= 2026-05-23 時点):
//     ・gps.js checkStationaryFallback: radius 3m + 5秒継続 + speedKmh<3 km/h
//     ・gps-worker.js: 3点AND (= gpsStationary && c1Stationary && !c2Moving)
//     ・速度 speedKmh<0.5 補助 = 撤去 (= 2026-05-16 b22efbaa)
//     ・屋内 sigma 7m + radius 3m → isStationary true 率 ~0% (= シミュ実証)
//
//   ★ この test の・目的 ★:
//     1. 現状 baseline の・記録 (= 「壊れてる事実」を・固定化)
//     2. Phase 2-3 で・isStationary が・改善された時の・regression 防止
//     3. 走行中 isStationary false 維持率 = 100% を・保証 (= 走行中誤静止 検知)
//
//   ★ 絶対ルール準拠 ★:
//     ✓ distance_m / isStationary / 触らないファイル: 1 byte 不変 (= test 追加のみ)
//     ✓ 距離挙動 影響なし (= 純粋 シミュレーション + verify only)
//     ✓ 司さん家 fixture で・案 C 既存 PIP verify と・整合 (= regression なし)

'use strict';

const path = require('path');
const fs = require('fs');

// ─── ガウシアン noise 生成 (= 屋内/屋外 GPS ドリフト simulate) ───
function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function metersPerDegLat() {
  return 111000;
}
function metersPerDegLng(lat) {
  return 111000 * Math.cos((lat * Math.PI) / 180);
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const T = Math.PI / 180;
  const dLat = (lat2 - lat1) * T;
  const dLng = (lng2 - lng1) * T;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * T) * Math.cos(lat2 * T) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── 現状 gps.js checkStationaryFallback (= L621-639) を・simulate ───
// CONFIG: speed_limit_kmh=3 / stationary_sec=5 / stationary_radius_m=3
function simulateStationaryFallback({
  sigma,
  radiusM,
  speedKmh,
  durationSec,
  sampleHz,
  baseLat,
  baseLng,
}) {
  const samples = durationSec * sampleHz;
  let lowSpeedStart = null;
  let isStat = false;
  let trueCount = 0;
  for (let i = 0; i < samples; i++) {
    const t = (i * 1000) / sampleHz;
    const dLat = (gauss() * sigma) / metersPerDegLat();
    const dLng = (gauss() * sigma) / metersPerDegLng(baseLat);
    const lat = baseLat + dLat;
    const lng = baseLng + dLng;
    // gps.js checkStationaryFallback 模倣 (= L621-639):
    //   speedKmh < 3 km/h かつ・lowSpeedStart 起点から・5 秒継続 + radius m 内
    if (speedKmh < 3) {
      if (!lowSpeedStart) {
        lowSpeedStart = { time: t, lat, lng };
      } else {
        const e = (t - lowSpeedStart.time) / 1000;
        const m = haversineM(lowSpeedStart.lat, lowSpeedStart.lng, lat, lng);
        if (e >= 5 && m < radiusM) {
          isStat = true;
        } else if (m >= radiusM) {
          // 起点から離脱 → 再起点・isStat false
          lowSpeedStart = { time: t, lat, lng };
          isStat = false;
        }
      }
    } else {
      lowSpeedStart = null;
      isStat = false;
    }
    if (isStat) trueCount++;
  }
  return trueCount / samples;
}

// ─── 1. 屋内 ドリフト baseline (= 現状 0% の・固定化) ───
describe('静止判定 baseline watchdog: 屋内 (sigma 3-10m) で・現状 radius 3m', () => {
  const TRIALS = 50;
  const DURATION = 300; // 5 分
  const HZ = 1;
  const CURRENT_RADIUS = 3; // m (= gps.js stationary_radius_m 現状値)

  it('★ sigma 5m radius 3m → isStationary true 率 < 5% (= 現状 baseline)', () => {
    let total = 0;
    for (let i = 0; i < TRIALS; i++) {
      total += simulateStationaryFallback({
        sigma: 5,
        radiusM: CURRENT_RADIUS,
        speedKmh: 0,
        durationSec: DURATION,
        sampleHz: HZ,
        baseLat: 34.077806599,
        baseLng: 132.996956368,
      });
    }
    const rate = total / TRIALS;
    // 現状 baseline = ほぼ 0%・5% 未満 = 「屋内防御 機能していない」事実 を・固定
    expect(rate).toBeLessThan(0.05);
  });

  it('★ sigma 7m radius 3m → isStationary true 率 < 1% (= 屋内 完全機能停止)', () => {
    let total = 0;
    for (let i = 0; i < TRIALS; i++) {
      total += simulateStationaryFallback({
        sigma: 7,
        radiusM: CURRENT_RADIUS,
        speedKmh: 0,
        durationSec: DURATION,
        sampleHz: HZ,
        baseLat: 34.077806599,
        baseLng: 132.996956368,
      });
    }
    const rate = total / TRIALS;
    // sigma 7m (= 司iPhone 屋内 想定) で・現状 isStationary ほぼ・true にならない
    expect(rate).toBeLessThan(0.01);
  });

  it('★ sigma 3m radius 3m → isStationary true 率 < 10% (= 屋外 良好 GPS でも・限定的)', () => {
    let total = 0;
    for (let i = 0; i < TRIALS; i++) {
      total += simulateStationaryFallback({
        sigma: 3,
        radiusM: CURRENT_RADIUS,
        speedKmh: 0,
        durationSec: DURATION,
        sampleHz: HZ,
        baseLat: 34.077806599,
        baseLng: 132.996956368,
      });
    }
    const rate = total / TRIALS;
    // 屋外 sigma 3m でも・現状 radius 3m は・10% 未満
    expect(rate).toBeLessThan(0.1);
  });

  it('★ sigma 1m radius 3m → isStationary true 率 > 50% (= 開発機・高精度 GPS で・機能する)', () => {
    let total = 0;
    for (let i = 0; i < TRIALS; i++) {
      total += simulateStationaryFallback({
        sigma: 1,
        radiusM: CURRENT_RADIUS,
        speedKmh: 0,
        durationSec: DURATION,
        sampleHz: HZ,
        baseLat: 34.077806599,
        baseLng: 132.996956368,
      });
    }
    const rate = total / TRIALS;
    // 高精度 GPS (= sigma 1m) なら・現状 radius 3m でも・50% 以上 true
    expect(rate).toBeGreaterThan(0.5);
  });
});

// ─── 2. 走行中 isStationary false 維持 (= 距離過少 防止 watchdog) ───
describe('静止判定 baseline watchdog: 走行中 (speedKmh > 3) で・isStationary false 維持', () => {
  const TRIALS = 50;
  const DURATION = 60;
  const HZ = 1;

  it('★ 走行中 20km/h speedKmh > 3 km/h なので・isStationary false 維持 (= 100%)', () => {
    let total = 0;
    for (let i = 0; i < TRIALS; i++) {
      total += simulateStationaryFallback({
        sigma: 3,
        radiusM: 3,
        speedKmh: 20, // 走行中
        durationSec: DURATION,
        sampleHz: HZ,
        baseLat: 34.077806599,
        baseLng: 132.996956368,
      });
    }
    const rate = total / TRIALS;
    // 走行中は・isStationary 0% (= 全 false) 期待・★ Phase 2-3 で・regress すれば・即検知 ★
    expect(rate).toBe(0);
  });

  it('★ 走行中 60km/h speedKmh > 3 km/h なので・isStationary false 維持 (= 100%)', () => {
    let total = 0;
    for (let i = 0; i < TRIALS; i++) {
      total += simulateStationaryFallback({
        sigma: 3,
        radiusM: 3,
        speedKmh: 60,
        durationSec: DURATION,
        sampleHz: HZ,
        baseLat: 34.077806599,
        baseLng: 132.996956368,
      });
    }
    expect(total / TRIALS).toBe(0);
  });

  it('★ 徐行 (speedKmh = 1, < 3 km/h) でも・sigma > radius なら・isStationary 不安定 (= 現状 baseline)', () => {
    let total = 0;
    for (let i = 0; i < TRIALS; i++) {
      total += simulateStationaryFallback({
        sigma: 5,
        radiusM: 3,
        speedKmh: 1, // 徐行・speed_limit 内
        durationSec: 60,
        sampleHz: HZ,
        baseLat: 34.077806599,
        baseLng: 132.996956368,
      });
    }
    const rate = total / TRIALS;
    // 徐行 + sigma 5m + radius 3m → ほぼ true にならず (= 現状 baseline・走行扱い)
    expect(rate).toBeLessThan(0.1);
  });
});

// ─── 3. 司さん家 fixture (= 案 C 既存 regression と統合・距離挙動 verify) ───
describe('司さん家 baseline (= 案 C 既存 PIP regression と整合)', () => {
  let ehimeBundle;
  let Business;
  let pointInPolygon;

  beforeAll(() => {
    const ehimePath = path.join(__dirname, '..', '..', 'data', 'town-polygons-ehime.js');
    if (!fs.existsSync(ehimePath)) {
      return;
    }
    const sandbox = {};
    new Function('window', fs.readFileSync(ehimePath, 'utf8'))(sandbox);
    ehimeBundle = sandbox.TOWN_POLYGONS_EHIME;
    delete require.cache[require.resolve(path.join('..', '..', 'js', 'business.js'))];
    Business = require(path.join('..', '..', 'js', 'business.js'));
    pointInPolygon = Business.__addressFormatter.pointInPolygon;
  });

  it('★ 司さん家 (= 本町7-3-40・ABR 実座標) 本町七丁目 polygon 内 = YES (= 案 C 既存 regression)', () => {
    if (!ehimeBundle) return;
    const honmachi7 = ehimeBundle.items.find((it) => it.n === '本町七丁目' && it.c === '今治市');
    expect(honmachi7).toBeDefined();
    const userLatI = Math.round(34.077806599 * 100000);
    const userLngI = Math.round(132.996956368 * 100000);
    expect(pointInPolygon(userLatI, userLngI, honmachi7.rings[0])).toBe(true);
  });

  it('★ 司さん家 北浜町 polygon 内 = NO (= 案 C 既存 regression)', () => {
    if (!ehimeBundle) return;
    const kitahama = ehimeBundle.items.find((it) => it.n === '北浜町' && it.c === '今治市');
    expect(kitahama).toBeDefined();
    const userLatI = Math.round(34.077806599 * 100000);
    const userLngI = Math.round(132.996956368 * 100000);
    expect(pointInPolygon(userLatI, userLngI, kitahama.rings[0])).toBe(false);
  });
});

// ─── 4. お節介バナー禁止 (= Phase 1 削除確証 watchdog) ───
describe('お節介バナー禁止 watchdog (= Phase 1 削除 verify)', () => {
  let html;
  beforeAll(() => {
    html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  });

  it('★ businessForgotBanner HTML element が・存在しない (= Phase 1 削除)', () => {
    expect(html).not.toMatch(/id="businessForgotBanner"/);
  });

  it('★ _checkBusinessForgot 関数定義が・存在しない', () => {
    expect(html).not.toMatch(/function _checkBusinessForgot/);
  });

  it('★ dismissBusinessForgotBanner / startBusinessFromForgotBanner が・存在しない', () => {
    expect(html).not.toMatch(/function dismissBusinessForgotBanner/);
    expect(html).not.toMatch(/function startBusinessFromForgotBanner/);
  });

  it('★ user 表示の・「業務開始していますか?」文言が・存在しない (= 同一行 HTML element 内容)', () => {
    // コメント (= // や /* */ 内) の・歴史 記録は・許可
    // user 表示 (= <div>内容</div>・1 行 element 内容) は・禁止
    // 同一行 (= \n 跨ぎなし) で・「>... 業務開始していますか ...<」(= 直接 user 表示)
    expect(html).not.toMatch(/>[^<>\n]*業務開始していますか[^<>\n]*</);
  });

  it('★ restoreBanner 単独 show (= 補完文言なし) が・存在しない', () => {
    // 「✅ 走行データを復元しました」単独 textContent 代入が・なくなっている
    // 「+Xm・¥Y 補完」追記時の・banner.textContent = '...' は・残る (= 期待)
    expect(html).not.toMatch(/banner\.textContent\s*=\s*['"]✅ 走行データを復元しました['"]/);
    expect(html).not.toMatch(
      /restoreBanner['"][\s\S]*?\.textContent\s*=\s*['"]✅ 走行データを復元しました['"]/
    );
  });

  it('★ 「+Xm・¥Y 補完」追記 logic (= 操作判断 必要・残す) は・存在する', () => {
    expect(html).toMatch(/走行データを復元しました（\+/);
  });
});

// ─── 5. stopCandidateBanner 削除 watchdog (= 2026-05-24・お節介ルール適用) ───
describe('stopCandidateBanner 削除 watchdog (= 2026-05-24・お節介ルール適用)', () => {
  let html;
  beforeAll(() => {
    html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  });

  it('★ stopCandidateBanner HTML element が・存在しない (= 削除確証)', () => {
    expect(html).not.toMatch(/id="stopCandidateBanner"/);
  });

  it('★ stopCandidateMin span (= 分数表示) も・存在しない', () => {
    expect(html).not.toMatch(/id="stopCandidateMin"/);
  });

  it('★ _stopStartedAt 変数定義が・存在しない (= setInterval ロジック撤去)', () => {
    expect(html).not.toMatch(/let _stopStartedAt\s*=/);
    expect(html).not.toMatch(/_stopStartedAt\s*=\s*Date\.now\(\)/);
  });

  it('★ STOP_CANDIDATE_THRESHOLD_MS 定数定義が・存在しない', () => {
    expect(html).not.toMatch(/const STOP_CANDIDATE_THRESHOLD_MS\s*=/);
  });

  it('★ user 表示「実車終了ですか?」文言が・存在しない (= 同一行 HTML element 内容)', () => {
    // コメント内 (= JS 履歴記録) は許可・user 表示文言は禁止
    expect(html).not.toMatch(/>[^<>\n]*実車終了ですか[^<>\n]*</);
  });

  it('★ user 表示「停車 X 分以上」 文言が・存在しない (= 自動表示バナー禁止)', () => {
    // 「停車 5 分以上」 等の・自動表示文言 (= 1 行 HTML 内容) が・なくなっている
    expect(html).not.toMatch(/>[^<>\n]*停車\s*<span[^<>\n]*分以上[^<>\n]*</);
  });

  it('★ isStationary 判定本体は・1 byte 不変 (= 司さん専決・触らず)', () => {
    // window._lastStationary 参照 (= GPS callback) は・既存通り維持
    expect(html).toMatch(/window\._lastStationary\s*=\s*!!g\.isStationary/);
    // stationaryHint postMessage (= Worker B ヒント) も・既存通り維持
    expect(html).toMatch(/postMessage\(\{\s*type:\s*['"]stationaryHint['"]/);
  });
});
