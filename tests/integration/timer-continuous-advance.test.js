// tests/integration/timer-continuous-advance.test.js
// ★タイマー連続前進 二重計上ガード 実エンジン不変条件 (2026-06-10・コア実装班)★
//   背景: 全パイプラインが GPS イベント駆動 → トンネルで GPS が切れると onPosition 不発で距離凍結 →
//   GPS 復帰の1点で「ドン」と一括計上(実機 iPhone13 +1147m)。これを断つため gps.js に自走タイマー
//   (_gapTick)を新設し、GPS stale 中だけ ★合成点 (synthetic・位置据え置き+t前進)★ を流して距離を
//   連続前進させる。本テストは createDistanceTracker を ★実コードのまま★ 動かし、
//     ① 合成 coast 点が speed×dt で距離を前進させる (穴中も凍結しない)
//     ② ★二重計上しない★: 合成で穴を埋めた後に GPS が復帰 (大きな弦・小さな dt) しても、
//        smoothedRawMode の never-over cap (smoothDopplerCapRatio) で復帰点の弦が spd×dt に
//        クランプされ「ドン」が出ない。total = 合成fill + 微小残差 ≈ 連続GPS理想値。
//     ③ never-over: 合成 coast の総和が ★実移動量 (連続GPS で測った理想) を超えない★。
//   ★不可侵★: distance_m の意味/calcFare/business 分離/過大ゼロ天井は触らない。

'use strict';
const path = require('path');

let createDistanceTracker, DEFAULTS;

beforeAll(() => {
  const mod = require(path.join(__dirname, '..', '..', 'js', 'pipeline-distance.js'));
  createDistanceTracker = mod.createDistanceTracker;
  DEFAULTS = mod.DEFAULTS;
});

// 道路に依存しない最小スタブ (synthetic coast 枝は snap/road-arc を使わない=純粋に速度×時間)
const stubDec = {
  snapToNearestRoad() {
    return null;
  },
  getRoadsNear() {
    return [];
  },
  calcRoadDistance() {
    return null;
  },
  decodeRoadAt() {
    return null;
  },
};
// 本番 DEFAULTS と同じ (smoothedRawMode=true・adaptiveMode=false)
const OPT = { useSnapCache: false, enableRouting: false };
const T0 = 1_700_000_000_000;

// 緯度経度を東方向に dx メートル移動した点 (1度経度 ≈ 111320*cos(lat) m)
function moveEast(lat, lng, dx) {
  const mPerDeg = 111320 * Math.cos((lat * Math.PI) / 180);
  return { lat, lng: lng + dx / mPerDeg };
}

describe('タイマー連続前進 (synthetic coast) 二重計上ガード', () => {
  it('① 合成 coast 点は speed×dt で距離を前進させる (穴中も凍結しない)', () => {
    const tk = createDistanceTracker(stubDec, OPT);
    let t = T0;
    const lat = 34,
      lng = 133;
    // 走行確立 (実 GPS 点を平滑経路で 2 点投入 → prev が _core に確立される)
    let p = { lat, lng };
    tk.ingest({ lat: p.lat, lng: p.lng, t, acc: 5, spd: 20 });
    t += 1000;
    p = moveEast(p.lat, p.lng, 20);
    tk.ingest({ lat: p.lat, lng: p.lng, t, acc: 5, spd: 20 });
    // 合成 coast 点を 0.15s 刻みで 10 個 = 1.5s 分・速度 20m/s ホールド (位置据え置き)
    let synFill = 0;
    for (let i = 0; i < 10; i++) {
      t += 150;
      const r = tk.ingest({ lat: p.lat, lng: p.lng, t, acc: 30, spd: 20, synthetic: true });
      expect(r.reason).toBe('coast'); // ★距離源が coast (speed×dt) であることを固定★
      synFill += r.deltaM;
    }
    // 1.5s × 20m/s = 30m を連続前進 (凍結=0 ではない)
    expect(synFill).toBeGreaterThan(25);
    expect(synFill).toBeLessThanOrEqual(20 * 1.5 + 1e-6); // never-over: speed×dt 上限
  });

  it('② ★二重計上しない★: 合成で穴を埋めた後 GPS 復帰の大弦は cap され lump が出ない', () => {
    // シナリオ: 20m/s で 60s のトンネル。本番の連続 GPS なら約 1200m。
    //   穴中はタイマー合成が 0.15s 刻みで埋め、復帰点で「トンネル全長の弦」が来る。
    //   ★stop-in-hole creep ガード (監査 P0)★ 導入後の契約: 合成 coast は 1 穴あたり
    //   coastHoleMaxSec(25s)/coastHoleMaxM(600m) で ★前進停止 (凍結是認)★ する。これは never-over
    //   を死守するための保守側挙動 (= 長穴の過小は合法・過大は失格)。本テストは「① cap まで前進する
    //   (凍結=0 ではない) ② cap で頭打ち ③ 復帰の大弦は二重計上されない ④ total は理想を超えない」を固定。
    const tkSyn = createDistanceTracker(stubDec, OPT);
    const lat = 34,
      lng = 133;
    let t = T0;
    const v = 20; // m/s
    // 走行確立 (2 点で prev を _core に確立)
    let p = { lat, lng };
    tkSyn.ingest({ lat: p.lat, lng: p.lng, t, acc: 5, spd: v });
    t += 1000;
    p = moveEast(p.lat, p.lng, v);
    tkSyn.ingest({ lat: p.lat, lng: p.lng, t, acc: 5, spd: v });
    const preTunnel = tkSyn.totalM();
    // ── 60s の穴をタイマー合成 (位置据え置き=p のまま・t だけ前進) ──
    const tickMs = 150;
    const ticks = Math.round((60 * 1000) / tickMs);
    for (let i = 0; i < ticks; i++) {
      t += tickMs;
      tkSyn.ingest({ lat: p.lat, lng: p.lng, t, acc: 30, spd: v, synthetic: true });
    }
    const fillOnly = tkSyn.totalM() - preTunnel;
    // cap まで前進する (凍結=0 ではない・連続前進している) かつ cap で頭打ち (never-over backstop)。
    const capM = Math.min(DEFAULTS.coastHoleMaxM, DEFAULTS.coastHoleMaxSec * v);
    expect(fillOnly).toBeGreaterThan(capM * 0.9); // cap 近くまで前進
    expect(fillOnly).toBeLessThanOrEqual(capM + 1e-6); // ★cap 超過しない (1 穴あたり累積 cap)★
    // ── GPS 復帰: 60s × 20m/s = 1200m 東に移動した実位置が「大きな弦」として来る ──
    const exit = moveEast(p.lat, p.lng, v * 60);
    t += tickMs; // 復帰点 dt は ★直前の合成 t★ からの差分 = tickMs (小さい)
    const rExit = tkSyn.ingest({ lat: exit.lat, lng: exit.lng, t, acc: 5, spd: v });
    const fl = tkSyn.flush();

    // ★二重計上ガード★: 復帰点 (ingest + flush 含む) の lump は 1tick 相当
    //   (speed×dt×capRatio = 20×0.15×1.5 = 4.5m) 級に抑えられ、1200m の弦が「ドン」と乗らない。
    const exitLumpTotal = rExit.deltaM + fl.deltaM;
    expect(exitLumpTotal).toBeLessThan(v * (tickMs / 1000) * DEFAULTS.smoothDopplerCapRatio + 5);
    expect(exitLumpTotal).toBeLessThan(50); // 実機 +1147m のような lump は構造的に出ない

    // total は 合成fill(cap) + 微小残差 で、★連続走行の理想 (1200m+前区間) を超えない (never-over)★。
    const total = tkSyn.totalM();
    const ideal = preTunnel + v * 60; // ~1200m + 前区間
    expect(total).toBeLessThanOrEqual(ideal + 5); // 過大ゼロ: 理想を超えない
  });

  it('③ 合成 coast は減衰 (毎秒×0.97 を呼出側で実施) を渡しても never-over (speed×dt 上限)', () => {
    const tk = createDistanceTracker(stubDec, OPT);
    const lat = 34,
      lng = 133;
    let t = T0;
    let v = 20;
    let p = { lat, lng };
    tk.ingest({ lat: p.lat, lng: p.lng, t, acc: 5, spd: v });
    t += 1000;
    p = moveEast(p.lat, p.lng, v);
    tk.ingest({ lat: p.lat, lng: p.lng, t, acc: 5, spd: v });
    let sum = 0;
    let cumIdeal = 0;
    for (let i = 0; i < 100; i++) {
      // 呼出側 (gps.js) が毎 tick 減衰させる挙動を再現: v を 0.15s 分減衰
      v = v * Math.pow(0.97, 0.15);
      t += 150;
      const r = tk.ingest({ lat: p.lat, lng: p.lng, t, acc: 30, spd: v, synthetic: true });
      sum += r.deltaM;
      cumIdeal += v * 0.15; // この区間の理想 (= 渡した v×dt)
    }
    // 各区間 deltaM ≤ v×dt を保証 (never-over・位置据え置きで弦=0 なので spd×dt のみ)
    expect(sum).toBeLessThanOrEqual(cumIdeal + 1e-6);
    expect(sum).toBeGreaterThan(0); // 前進はしている
  });

  it('⑤ ★stop-in-hole creep (監査 P0)★: 穴中で減速停車しても合成 coast は creep 天井内で凍結', () => {
    // シナリオ: 40km/h(11.1m/s) で走行 → トンネル(GPS穴)進入 → 穴の中で物理停車 (信号/渋滞)。
    //   gps.js は穴中もホールド速度を減衰 (×0.92/s) しながら 0.15s 刻みで合成 coast を送る。
    //   GPS は復帰しない (停車したまま穴の中)。本テストは ★距離増分が creep 天井内で凍結する★
    //   ことを実エンジン (createDistanceTracker) で固定する。修正前は decay の長い裾を積分し続け
    //   phantom +166〜530m (実測 40km/h で +347.5m/144s) が乗った = 認定 creep<10m/30s の 35倍超過。
    const tk = createDistanceTracker(stubDec, OPT);
    const lat = 34,
      lng = 133;
    let t = T0;
    let v = 40 / 3.6; // 11.1 m/s で進入
    let p = { lat, lng };
    // 走行確立
    tk.ingest({ lat: p.lat, lng: p.lng, t, acc: 5, spd: v });
    t += 1000;
    p = moveEast(p.lat, p.lng, v);
    tk.ingest({ lat: p.lat, lng: p.lng, t, acc: 5, spd: v });
    const preHole = tk.totalM();
    // 穴中: 物理停車 (位置据え置き) + gps.js の減衰ホールドを再現 (×0.92/s)。300s 分 (= 144s の creep 裾を十分超える)。
    const tickMs = 150;
    const ticks = Math.round((300 * 1000) / tickMs);
    for (let i = 0; i < ticks; i++) {
      v = v * Math.pow(0.92, tickMs / 1000); // gps.js COAST_DECAY_PER_S=0.92 と同じ減衰
      t += tickMs;
      tk.ingest({ lat: p.lat, lng: p.lng, t, acc: 30, spd: v, synthetic: true });
    }
    tk.flush();
    const creep = tk.totalM() - preHole;
    // ★creep backstop★: pipeline は加速度を持たないため、減速停車は「合成速度の減衰」でのみ検出され、
    //   freeze(coastFreezeSpdMps=2.5m/s) 到達までの短い積分 (decay 0.92 で 40km/h→2.5m/s ~16s ≈ 88m) は残る。
    //   重要なのは ★旧 +347m/144s の暴走が freeze で 100m 未満へ確実に閉じ込められる (never-over backstop)★ こと。
    //   ★認定 creep<10m/30s の厳格達成は gps.js の加速度分散 ZUPT★ (停車を即検出し合成送信自体を止める)
    //   が担う = pipeline はあくまで ZUPT 取りこぼし時の最終床。本テストは backstop が効くことを固定する。
    expect(creep).toBeLessThan(110); // 旧 +347m → freeze backstop で ~100m (暴走遮断・−70%)
    expect(creep).toBeGreaterThanOrEqual(0); // never-over: 負には振れない
  });

  it('④ 合成点を挟んでも通常 GPS 区間の距離が壊れない (混在 parity)', () => {
    const tk = createDistanceTracker(stubDec, OPT);
    const lat = 34,
      lng = 133;
    let t = T0;
    const v = 15;
    tk.ingest({ lat, lng, t, acc: 5, spd: v });
    // 通常 GPS を東へ 1s 刻みで 5 点 (各 15m) → 合成 2 点 → また通常 GPS
    let p = { lat, lng };
    for (let i = 0; i < 5; i++) {
      t += 1000;
      p = moveEast(p.lat, p.lng, v);
      tk.ingest({ lat: p.lat, lng: p.lng, t, acc: 5, spd: v });
    }
    const afterGps = tk.totalM();
    // 合成 coast 2 点 (位置据え置き)。★合成 ingest は平滑バッファを drain する★ため、h=1 遅延で
    //   未処理だった「最後の実 GPS 点 (~15m)」が先に確定し、その後 合成 2 点 (2×0.15s×15 ≈ 4.5m)。
    for (let i = 0; i < 2; i++) {
      t += 150;
      tk.ingest({ lat: p.lat, lng: p.lng, t, acc: 30, spd: v, synthetic: true });
    }
    tk.flush();
    const total = tk.totalM();
    // total は単調増加 (合成で減らない) かつ 増分は「未処理実点1区間(~15m) + 合成(~4.5m)」級で微小。
    expect(total).toBeGreaterThanOrEqual(afterGps);
    expect(total - afterGps).toBeLessThan(v * 1 + 10); // 1200m 級の暴走は構造的に無い (< ~25m)
  });

  it('⑥ ★過大ゼロ根治 (監査 CRITICAL P0)★: 穴明け実点が Doppler 無し (spd=-1) でも二重計上しない', () => {
    // 監査が捕捉した P0: 合成 fill 直後の穴明け実点が speedSrc=hav (spd=-1) だと never-over cap
    //   (spd>=0 ゲート) がスキップされ、トンネル全長の弦が合成 fill に二重加算され +41%過大(1698 vs 1200)。
    //   修正: prev.synthetic かつ spd<0 の弦を維持済み coastSpdMps で cap → 二重計上を断つ。
    const tk = createDistanceTracker(stubDec, OPT);
    const lat = 34,
      lng = 133;
    let t = T0;
    const v = 20;
    let p = { lat, lng };
    tk.ingest({ lat: p.lat, lng: p.lng, t, acc: 5, spd: v });
    t += 1000;
    p = moveEast(p.lat, p.lng, v);
    tk.ingest({ lat: p.lat, lng: p.lng, t, acc: 5, spd: v });
    const pre = tk.totalM();
    // 60s トンネルを合成 coast で埋める (位置据え置き)
    const ticks = Math.round((60 * 1000) / 150);
    for (let i = 0; i < ticks; i++) {
      t += 150;
      tk.ingest({ lat: p.lat, lng: p.lng, t, acc: 30, spd: v, synthetic: true });
    }
    // ★穴明け実点: Doppler 無し (spd=-1) で トンネル全長(1200m)東へジャンプ★
    const exit = moveEast(p.lat, p.lng, v * 60);
    t += 150;
    tk.ingest({ lat: exit.lat, lng: exit.lng, t, acc: 5, spd: -1 });
    tk.flush();
    const total = tk.totalM();
    const ideal = pre + v * 60; // ~1200m
    // ★never-over (過大ゼロ): 合成fill + 微小残差 で理想を超えない (修正前は1698m=+41%で FAIL)★
    expect(total).toBeLessThanOrEqual(ideal + 10);
  });
});
