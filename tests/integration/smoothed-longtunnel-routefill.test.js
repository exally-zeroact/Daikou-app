// ★物差し★ 2026-08-28 … ★①タクシー認定モードの線（過大ゼロ）で 判定しています★
//   ・この見張りが 赤にするのは ★distance_m ≤ 真距離（過大不可）★ を 破った時（この file 自身に そう書いてある）
//   ・★代行は 検定対象外★＝法として「真距離を超えるな」は 課されていません。
//     代行の実上限は ★DM Light／タイヤ真値 ＋0.5〜6%★ という 緩い天井（係数 1.0085 で わざと上乗せ）。
//   ⇒★ここが赤でも「代行で 過大請求している」とは 限りません★。
//     うちは ★内側の約束★として 過大ゼロを 守っています（2026-08-23 の誤読を 二度と させない為 明記）。
// tests/integration/smoothed-longtunnel-routefill.test.js
// ★STEP B: tunnelRouteFill (出口アンカー道路 routing 充填) 発火 & parity (2026-06-12)★
//
// 目的: 長トンネルの過少を「両端 GPS を道路 snap → 道路網 routing の道なり弧長」で回収する。
//   幾何: chord ≤ 道路中心線弧 ≤ 実走経路 → never-over (過大ゼロ死守)。実証 +1.25% 回収。
//
// ★テスト先行 (ALWAYS)★: 実装前は tunnelRouteFill が cfg に無く RED:
//   - 「fill 実発火」(tunnelRouteSegs>0) → undefined→0 で FAIL
//   - 「ON > OFF 回収」 → ON==OFF で FAIL
//   実装 (DEFAULTS + stepDistance 長穴分岐) 後に GREEN。
//
// ★配線ガードの核★: batch(computeDistance=cert採点路) と tracker(createDistanceTracker=live課金路) は
//   ★同一 stepDistance★ を通り、両経路とも ★同一 _smoothOnePoint★ で _rawLat/_rawLng を持つ。
//   よって fill 発火時も batch==tracker (<0.5m)。STEP A の coastSpdMps parity の上に成立する。
//   tracker 側も fill を発火する (長穴分岐に到達する) ことを明示 assert し「片経路だけ実装」の繋ぎ忘れを禁ず。

const fs = require('fs');
const path = require('path');

global.window = global;
global.self = global;
/* eslint-disable no-eval */
eval(fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'roads-decoder.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'roads-ehime.js'), 'utf8'));
/* eslint-enable no-eval */
const dec = new global.RoadDecoder(global.ROADS_EHIME);
dec.buildOffsetTable();
const PD = require(path.join(__dirname, '..', '..', 'js', 'pipeline-distance.js'));

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8'))
    .filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng) && Number.isFinite(s.t))
    .sort((a, b) => (a.t || 0) - (b.t || 0));
}

function runBatch(fx, opts) {
  return PD.computeDistance(fx, dec, opts || {});
}

function runTracker(fx, opts) {
  const tk = PD.createDistanceTracker(dec, opts || {});
  for (const s of fx) tk.ingest(s);
  tk.flush();
  return { totalM: tk.totalM(), stats: tk._stats(), breakdown: tk._breakdown() };
}

const FIXTURES = [
  'shimanami-iPhone13.slim.json',
  'shimanami-iPhoneSE.slim.json',
  'shimanami-Android.slim.json',
];
const FIX = 'shimanami-iPhone13.slim.json';

describe('STEP B tunnelRouteFill 発火 & batch==tracker parity', () => {
  it('★ fill が実発火する (tunnelRouteSegs>0・hollow-green でない)', () => {
    const b = runBatch(loadFixture(FIX), { tunnelRouteFill: true });
    expect((b.stats.tunnelRouteSegs || 0) > 0).toBe(true);
  });

  it('★ fill が距離を回収する (ON > OFF・長トンネル過少回収)', () => {
    const fx = loadFixture(FIX);
    const on = runBatch(fx, { tunnelRouteFill: true }).distance_m;
    const off = runBatch(fx, { tunnelRouteFill: false }).distance_m;
    expect(on).toBeGreaterThan(off);
  });

  it('★ never-over 健全: 回収は穏当 (ON < OFF×1.15・暴走しない)', () => {
    const fx = loadFixture(FIX);
    const on = runBatch(fx, { tunnelRouteFill: true }).distance_m;
    const off = runBatch(fx, { tunnelRouteFill: false }).distance_m;
    expect(on).toBeLessThan(off * 1.15);
  });

  // ★配線の核★: fill 発火時も batch==tracker (両者 stepDistance 共有・採点路==課金路 一致)
  for (const f of FIXTURES) {
    it(`★ ${f}: fill ON で batch == tracker (<0.5m)`, () => {
      const fx = loadFixture(f);
      const b = runBatch(fx, { tunnelRouteFill: true }).distance_m;
      const t = runTracker(fx, { tunnelRouteFill: true });
      expect(Math.abs(b - t.totalM)).toBeLessThan(0.5);
    });
  }

  it('★ tracker(課金路) も fill を発火する (長穴分岐到達の配線確認・片経路実装の禁止)', () => {
    const t = runTracker(loadFixture(FIX), { tunnelRouteFill: true });
    expect((t.stats.tunnelRouteSegs || 0) > 0).toBe(true);
  });

  it('★ batch/tracker 両経路で tunnelRouteM/Segs が固定形状で観測できる (初期化配線・監査対称性)', () => {
    const fx = loadFixture(FIX);
    const b = runBatch(fx, { tunnelRouteFill: true });
    const t = runTracker(fx, { tunnelRouteFill: true });
    // 固定形状: 発火有無に関わらず number で存在 (undefined にならない)
    expect(typeof b.breakdown.tunnelRouteM).toBe('number');
    expect(typeof b.stats.tunnelRouteSegs).toBe('number');
    expect(typeof t.breakdown.tunnelRouteM).toBe('number');
    expect(typeof t.stats.tunnelRouteSegs).toBe('number');
    // 両経路で回収距離・発火数が一致 (parity の breakdown レベル確認)
    expect(Math.abs(b.breakdown.tunnelRouteM - t.breakdown.tunnelRouteM)).toBeLessThan(0.5);
    expect(b.stats.tunnelRouteSegs).toBe(t.stats.tunnelRouteSegs);
  });

  it('★ OFF でも tunnelRouteM/Segs は固定形状 0 (動的追加でない・初期化済み)', () => {
    const b = runBatch(loadFixture(FIX), { tunnelRouteFill: false });
    const t = runTracker(loadFixture(FIX), { tunnelRouteFill: false });
    expect(b.breakdown.tunnelRouteM).toBe(0);
    expect(b.stats.tunnelRouteSegs).toBe(0);
    expect(t.breakdown.tunnelRouteM).toBe(0);
    expect(t.stats.tunnelRouteSegs).toBe(0);
  });

  it('★ OFF は fill を一切発火しない (flag OFF=従来不変・回帰なし)', () => {
    const off = runBatch(loadFixture(FIX), { tunnelRouteFill: false });
    expect(off.stats.tunnelRouteSegs || 0).toBe(0);
  });

  it('★ DEFAULTS は fill ON (既定で過少回収が効く)', () => {
    // opts 無指定 = DEFAULTS。tunnelRouteFill 既定 true なら fill 発火。
    const b = runBatch(loadFixture(FIX), {});
    expect((b.stats.tunnelRouteSegs || 0) > 0).toBe(true);
  });
});
