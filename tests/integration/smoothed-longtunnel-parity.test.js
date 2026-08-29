// ★物差し★ 2026-08-28 … ★①タクシー認定モードの線（過大ゼロ）で 判定しています★
//   ・この見張りが 赤にするのは ★distance_m ≤ 真距離（過大不可）★ を 破った時（この file 自身に そう書いてある）
//   ・★代行は 検定対象外★＝法として「真距離を超えるな」は 課されていません。
//     代行の実上限は ★DM Light／タイヤ真値 ＋0.5〜6%★ という 緩い天井（係数 1.0085 で わざと上乗せ）。
//   ⇒★ここが赤でも「代行で 過大請求している」とは 限りません★。
//     うちは ★内側の約束★として 過大ゼロを 守っています（2026-08-23 の誤読を 二度と させない為 明記）。
// tests/integration/smoothed-longtunnel-parity.test.js
// ★長トンネル batch==tracker parity 回帰 (2026-06-12・STEP A テスト先行)★
//
// 発見: iPhone 長トンネル trace で computeDistance(batch) と createDistanceTracker(tracker=live課金路)
//   が大乖離 (shimanami-iPhone13 264m / iPhoneSE 336m / Android 0)。真因 = gap-guard が参照する
//   coastSpdMps が ★tracker=stateful 保持・batch=-1 渡し (stateless)★ で、bad-acc 穴の entry 速度判定が
//   分岐し fill(263.92m) vs skip(0) に割れる。課金は tracker・cert gate は batch 採点 → 検証が乖離。
//
// 修正契約: batch も tracker と同一の coastSpdMps 状態機械を持ち、長トンネルでも batch==tracker。
//   既存の短fixture parity (smoothed-gap-routing.test.js) は緑のまま・distance_m 意味/calcFare 不変。
//
// ※本テストは修正前 ★RED★ (264m/336m)・修正後 ★GREEN★ (<0.5m)。

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

function batchVsTracker(fx) {
  const batch = PD.computeDistance(fx, dec, {}).distance_m;
  const tk = PD.createDistanceTracker(dec, {});
  for (const s of fx) tk.ingest(s);
  tk.flush();
  return { batch, tracker: tk.totalM(), diff: Math.abs(batch - tk.totalM()) };
}

describe('長トンネル batch==tracker parity (gap-guard coastSpdMps 一致)', () => {
  // ★slim版 (必須フィールドのみ・coord 6桁)★ をコミット (full は 21MB で重い)。
  //   slim は parity 破綻を保持 (PRE-FIX で iPhone13 263.87m/SE 335.89m=full と同等) = 有効なガード。
  const FIXTURES = [
    'shimanami-iPhone13.slim.json',
    'shimanami-iPhoneSE.slim.json',
    'shimanami-Android.slim.json',
  ];
  for (const f of FIXTURES) {
    it(`★ ${f}: batch == tracker (+flush) (1点ズレなし)`, () => {
      const r = batchVsTracker(loadFixture(f));
      expect(r.diff).toBeLessThan(0.5); // 修正前は 264m/336m
    });
  }

  it('★ never-over 不変: batch も tracker も穴埋めで過大を作らない (両者一致かつ有限)', () => {
    const r = batchVsTracker(loadFixture('shimanami-iPhone13.slim.json'));
    expect(Number.isFinite(r.batch)).toBe(true);
    expect(Number.isFinite(r.tracker)).toBe(true);
    expect(r.tracker).toBeGreaterThan(0);
  });
});
