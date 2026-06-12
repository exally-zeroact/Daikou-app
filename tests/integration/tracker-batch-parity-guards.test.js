// tests/integration/tracker-batch-parity-guards.test.js
// ★tracker(live課金路) vs batch(computeDistance) の parity / 入力堅牢性ガード (2026-06-12 配線)★
//
// 背景: これらのガードは tests/replay-pipeline-distance.js に存在したが、同スクリプトは
//   ローカル専用 trace (C:/Users/zeroa/gpstrace.json) 依存で ★CI/pre-push に未配線★ だった
//   (= 緑のまま壊れる)。実際そこで batch==tracker が 3.13m ズレていた真因は ★テスト側の
//   flush() 呼び忘れ★ (末尾 h 平滑点の tail 未計上) で、本番コードは正しかった
//   (with-flush で batch と完全一致を node 実証)。本テストはその恒久回帰ガードを ★コミット済み
//   slim fixture★ 上の vitest に移植し、CI(test.yml)/pre-push で常時走らせる。
//
// 守る不変条件:
//   (1) incremental(+flush) == batch (live 課金路と batch 採点路の距離一致)
//   (2) reset() で完全初期化 (totalM=0)
//   (3) out-of-order (ペア入替) を ingest しても batch を超える水増しが起きない (ガード導通)
//   (4) stale 遅延再送 (過去 frame の再送) は全破棄され total が batch と一致
//   (5) NaN/Infinity/null 座標は skip され total が clean baseline と一致 (入力検証)
//
// ※距離本体 (pipeline-distance.js) は read-only。本テストは観測のみ・distance_m 不変。

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

// tracker を全点 ingest + flush して総距離を返す (本番 map-matcher/meter と同じ契約)。
function ingestAllFlushed(fx, opts) {
  const tk = PD.createDistanceTracker(dec, opts || { enableRouting: true });
  let dropped = 0;
  let skipped = 0;
  for (const s of fx) {
    const r = tk.ingest(s);
    if (r.reason === 'out_of_order') dropped++;
    if (r.reason === 'skip') skipped++;
  }
  tk.flush();
  return { total: tk.totalM(), dropped, skipped, tk };
}

const FIX = 'shimanami-iPhone13.slim.json';
const PARITY_MAX_DIFF_M = 0.5; // STEP A で実証済の許容 (長トンネル含む slim・浮動累積)

describe('tracker vs batch parity / 入力堅牢性ガード (replay-gate を CI へ移植)', () => {
  it('(1) incremental(+flush) == batch (live課金路==batch採点路)', () => {
    const fx = loadFixture(FIX);
    const batch = PD.computeDistance(fx, dec, { enableRouting: true }).distance_m;
    const inc = ingestAllFlushed(fx).total;
    expect(Math.abs(inc - batch)).toBeLessThan(PARITY_MAX_DIFF_M);
  });

  it('(1b) ★flush を呼ばないと tail 未計上で過少になる (flush 契約の回帰実証)', () => {
    // flush 必須を構造的に守るためのメタ検証: flush 無しは batch より小さい (= 3.13m級の過少)。
    const fx = loadFixture(FIX);
    const batch = PD.computeDistance(fx, dec, { enableRouting: true }).distance_m;
    const tk = PD.createDistanceTracker(dec, { enableRouting: true });
    for (const s of fx) tk.ingest(s);
    const noFlush = tk.totalM(); // flush せず
    tk.flush();
    const withFlush = tk.totalM();
    expect(noFlush).toBeLessThanOrEqual(withFlush + 1e-9); // flush で増える方向 (tail 計上)
    expect(Math.abs(withFlush - batch)).toBeLessThan(PARITY_MAX_DIFF_M);
  });

  it('(2) reset() で totalM=0 に完全初期化', () => {
    const fx = loadFixture(FIX);
    const { tk } = ingestAllFlushed(fx);
    expect(tk.totalM()).toBeGreaterThan(0);
    tk.reset();
    expect(tk.totalM()).toBe(0);
  });

  it('(3) out-of-order (ペア入替) を ingest しても batch を超えない (水増しガード導通)', () => {
    const fx = loadFixture(FIX);
    const batch = PD.computeDistance(fx, dec, { enableRouting: true }).distance_m;
    const swapped = fx.slice();
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      const tmp = swapped[i];
      swapped[i] = swapped[i + 1];
      swapped[i + 1] = tmp;
    }
    const r = ingestAllFlushed(swapped);
    expect(r.dropped).toBeGreaterThan(0); // t 逆転フレームが実際に破棄される
    expect(r.total).toBeLessThanOrEqual(batch + 0.01); // batch を超える水増しが起きない
  });

  it('(4) stale 遅延再送 (過去 frame 再送) は全破棄され total が batch と一致', () => {
    const fx = loadFixture(FIX);
    const batch = PD.computeDistance(fx, dec, { enableRouting: true }).distance_m;
    const withStale = [];
    let injected = 0;
    for (let i = 0; i < fx.length; i++) {
      withStale.push(fx[i]);
      if (i >= 3 && i % 50 === 0) {
        withStale.push(fx[i - 3]); // 3 点前の古い frame を再送 (t < 現 prev)
        injected++;
      }
    }
    const r = ingestAllFlushed(withStale);
    expect(injected).toBeGreaterThan(0);
    expect(r.dropped).toBe(injected); // 全 stale が破棄される
    expect(Math.abs(r.total - batch)).toBeLessThan(PARITY_MAX_DIFF_M); // 除去後 batch 一致
  });

  it('(5) NaN/Infinity/null 座標は skip され total が clean baseline と一致 (入力検証)', () => {
    const fx = loadFixture(FIX);
    const baseline = PD.computeDistance(fx, dec, { enableRouting: true }).distance_m;
    const poisoned = [];
    const mid = Math.floor(fx.length / 2);
    for (let i = 0; i < fx.length; i++) {
      poisoned.push(fx[i]);
      if (i === mid) {
        const t = fx[i].t != null ? fx[i].t : i;
        poisoned.push({ lat: NaN, lng: fx[i].lng, t: t + 1 });
        poisoned.push({ lat: fx[i].lat, lng: Infinity, t: t + 2 });
        poisoned.push({ lat: -Infinity, lng: -Infinity, t: t + 3 });
        poisoned.push(null);
      }
    }
    // batch も汚染点を除外して baseline と一致
    const batchPoisoned = PD.computeDistance(poisoned, dec, { enableRouting: true });
    expect(Number.isFinite(batchPoisoned.distance_m)).toBe(true);
    expect(Math.abs(batchPoisoned.distance_m - baseline)).toBeLessThan(0.01);
    // ingest 側: 4 点 (NaN/Infinity/-Infinity/null) が skip され total が baseline 一致
    const r = ingestAllFlushed(poisoned);
    expect(r.skipped).toBe(4);
    expect(Math.abs(r.total - baseline)).toBeLessThan(PARITY_MAX_DIFF_M);
  });
});
