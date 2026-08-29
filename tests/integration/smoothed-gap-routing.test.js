// ★物差し★ 2026-08-28 … ★①タクシー認定モードの線（過大ゼロ）で 判定しています★
//   ・この見張りが 赤にするのは ★distance_m ≤ 真距離（過大不可）★ を 破った時（この file 自身に そう書いてある）
//   ・★代行は 検定対象外★＝法として「真距離を超えるな」は 課されていません。
//     代行の実上限は ★DM Light／タイヤ真値 ＋0.5〜6%★ という 緩い天井（係数 1.0085 で わざと上乗せ）。
//   ⇒★ここが赤でも「代行で 過大請求している」とは 限りません★。
//     うちは ★内側の約束★として 過大ゼロを 守っています（2026-08-23 の誤読を 二度と させない為 明記）。
// tests/integration/smoothed-gap-routing.test.js
// ★smoothedRawMode 穴 (長dt gap) routing 充填 (2026-06-07・STEP1 テスト先行)★
//
// 真因 (Monte-Carlo cert gate FAIL・過大+3.88%/過小-21.18%): ON は snap を全点スキップするため
// stepDistance の two-snap routing 充填 (穴の本来処理・連結性拘束 + routingAcceptMaxRatio +
// never-over) が構造的に発火せず、穴が straight/Doppler/coast に落ちて OFF より劣化していた。
// 設計メモ「長dt穴は平滑弦で角を切らず従来処理に回す」の「従来処理」は routing まで含むのが正。
//
// 修正契約: ON でも dt > smoothGapSec の穴境界ステップだけ snap を遅延解決し、OFF と同一の
// routed gap fill に回す。通常 cadence は平滑弦のまま (snap 不使用)。

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

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'realtest3-Android.slim.json');

// 実トレースから連続移動窓を取り、中央に「穴」(len 点抜き) を開ける
function holedTrace(nTotal, holeStart, holeLen) {
  const all = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    .filter((x) => x && Number.isFinite(x.lat) && Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);
  const win = [];
  for (const s of all) {
    if (typeof s.spd === 'number' && s.spd >= 5) {
      win.push(s);
      if (win.length >= nTotal) break;
    } else if (win.length > 0 && win.length < nTotal) {
      win.length = 0;
    }
  }
  if (win.length < nTotal) throw new Error('moving window not found');
  const dense = win;
  const holed = [];
  for (let i = 0; i < win.length; i++) {
    if (i >= holeStart && i < holeStart + holeLen) continue;
    const p = Object.assign({}, win[i]);
    if (i === holeStart + holeLen) p.spd = -1; // 穴脱出 = 速度欠落 (再取得・本番同等)
    holed.push(p);
  }
  return { dense, holed };
}

describe('smoothedRawMode 穴 routing 充填 (穴は OFF と同一の routed gap fill)', () => {
  const { dense, holed } = holedTrace(80, 30, 25); // ~25s の穴 (トンネル/ビル街級)

  it('★ ON の穴あり距離が OFF (routing 充填) と同等 (= 穴で劣化しない)', () => {
    const offHoled = PD.computeDistance(holed, dec, { smoothedRawMode: false }).distance_m;
    const onHoled = PD.computeDistance(holed, dec, {}).distance_m;
    // OFF は routing で道路弧長を埋める (= 基準)。ON も同等 (±8%) に埋まること。
    // 修正前の ON は穴部分が straight/Doppler に落ち、シナリオ次第で -21%〜+3.9% に暴れた。
    expect(Math.abs(onHoled - offHoled)).toBeLessThan(offHoled * 0.08);
  });

  it('★ ON: 穴あり ≤ 穴なし真値 ×1.005 (never-over・穴埋めで過大を作らない)', () => {
    const onDense = PD.computeDistance(dense, dec, {}).distance_m;
    const onHoled = PD.computeDistance(holed, dec, {}).distance_m;
    expect(onHoled).toBeLessThanOrEqual(onDense * 1.005 + 1);
    // 穴を埋めきれない過小も塞ぐ (真値の -8% 以内)
    expect(onHoled).toBeGreaterThan(onDense * 0.92);
  });

  it('★ parity: 穴ありでも batch == tracker(+flush) (1点ズレなし)', () => {
    const batch = PD.computeDistance(holed, dec, {}).distance_m;
    const tk = PD.createDistanceTracker(dec, {});
    for (const s of holed) tk.ingest(s);
    tk.flush();
    expect(Math.abs(batch - tk.totalM())).toBeLessThan(0.01);
  });

  it('通常 cadence (穴なし) は平滑弦のまま (= 今回の修正で通常走行距離が変わらない)', () => {
    // 修正は「dt > smoothGapSec の穴境界ステップ」限定。穴なし窓では routing 分岐は発火せず
    // 平滑弦距離が不変であること (= 0606night/愛媛14業務で検証済の数値を壊さない)。
    const r = PD.computeDistance(dense, dec, {});
    expect(r.breakdown.routedM).toBe(0); // 穴なし → routed 充填ゼロ = 全て平滑弦
    expect(r.distance_m).toBeGreaterThan(0);
  });
});
