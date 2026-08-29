// ★物差し★ 2026-08-28 … ★画面の見え方の線（display ≤ distance_m）で 判定しています★
//   ・見ているのは ★画面の数字が 課金距離を 先取りしないか★（この file 自身に そう書いてある）
//   ・★距離そのもの（いくら取るか）の採点では ありません★。
//   ・タクシー認定モード（過大不可）／代行モード（天井 +0.5〜6%）の どちらの線でも ありません。
// tests/property/display-catchup-invariants.test.js
// ★メーター最高精度化 (catch-up + latch) の中核 invariant★ (2026-05-30)
//
// 司さん確定方針:
//   ・課金はメーター(表示 display)に合わせる(= calcFare(display))。実距離で別計算しない。
//   ・メーターは最終的に実距離に追いつく(latch)。支払時点で メーター=実距離=料金 が一致する。
//   ・過大請求は「課金を変える」のでなく「メーターが実距離を絶対に超えない(catch-up)」で消す。
//
// 検証 invariant:
//   (a) 全更新フレームで display ≤ distance_m / business_display ≤ business_distance_m
//       (= overshoot ゼロ・先取り禁止)。← 過大請求根絶の中核。
//   (b) latch 経路 (確定=stop / 業務終了=businessEnd / 停車) 後に display == distance_m
//       (= 支払時点で メーター=実距離=料金 一致)。
//   (c) 停車 trace で display が単調かつ target に収束する。
//   (d) fare = calcFare(display) の配線が維持され、(a) により fare ≤ calcFare(distance_m)
//       を常に満たす (= 過大請求不能)。
//
//   ★distance_m / calcFare / 課金経路は本テストで一切変更しない (= 読むだけ)。★

const path = require('path');

const METER_JS_PATH = path.join(__dirname, '..', '..', 'js', 'meter.js');

function loadMeter() {
  delete require.cache[require.resolve(METER_JS_PATH)];
  return require(METER_JS_PATH);
}

// fake mapMatcher: _onMmWorkerMessage を捕捉し pipelineDeltaM を注入する (= prod 距離駆動経路)。
//   これにより distance_m / business_distance_m は実コードの「state.distance_m += delta」で
//   増える (= overshoot が起きる本物の経路)。setDistance は display を即同期し predict 状態を
//   reset するため overshoot を露出できない → ★必ず += delta 経路で検証する★。
function setupMeter() {
  const Meter = loadMeter();
  Meter.setFareConfig({
    version: 2,
    base_fare: 1300,
    base_distance_m: 1000,
    add_fare: 100,
    add_distance_m: 420,
    tiers: [],
    surcharges: [],
    minFare: null,
    maxFare: null,
    rounding: 10,
    autoSurcharges: {},
    vehicles: [],
    vehiclesEnabled: false,
    wait: { enabled: false, freeMins: 5, ratePerMin: 100 },
  });
  Meter.reset();
  let handler = null;
  const adapter = {
    addEventListener(type, h) {
      if (type === 'message') handler = h;
    },
    removeEventListener() {},
    postMessage() {},
  };
  Meter.setMapMatcher(adapter);
  if (typeof Meter._setDrainMmUntil === 'function') Meter._setDrainMmUntil(0);
  // delta(m) を distance_m / business_distance_m に加算する prod 経路 trigger。
  const inject = (deltaM) => {
    if (handler) handler({ data: { type: 'mmResult', pipelineDeltaM: deltaM } });
  };
  return { Meter, inject };
}

// 1 GPS step 相当: 累積 target へ進めるため delta を distance_m へ += (prod 経路) し
//   UI ループ (rAF) を ticks 回読む。driveCum は呼出側が「累積 target 列」を渡せるよう
//   直前累積との差分を delta として inject する (= prod の += pipelineDeltaM 経路と同一)。
function makeDriver(inject, Meter, frames) {
  let prevCum = 0;
  return function driveCum(cumM, ticks) {
    const delta = cumM - prevCum;
    prevCum = cumM;
    if (delta > 0) inject(delta);
    for (let k = 0; k < ticks; k++) {
      frames.push(Meter.getState());
    }
  };
}

describe('メーター catch-up + latch invariant (過大請求根絶)', () => {
  it('(a) 全更新フレームで display_distance_m ≤ distance_m (overshoot ゼロ)', () => {
    const { Meter, inject } = setupMeter();
    Meter.start();
    const frames = [];
    const drive = makeDriver(inject, Meter, frames);
    // 段階的に距離を引き上げ (停車→加速→巡航→停車) しつつ高頻度 UI 読出。
    const dists = [0, 5, 12, 30, 30, 30, 80, 150, 150, 240, 240, 240];
    for (const d of dists) drive(d, 6);

    let maxOver = -Infinity;
    for (const s of frames) {
      const over = (s.display_distance_m || 0) - (s.distance_m || 0);
      if (over > maxOver) maxOver = over;
    }
    // float 誤差のみ許容 (1e-6)。先取り (10m) は不能でなければならない。
    if (maxOver > 1e-6) {
      throw new Error(
        'overshoot 検出: display が distance_m を超えた (= 過大請求の穴)。max over = ' +
          maxOver.toFixed(6) +
          ' m'
      );
    }
  });

  it('(a-biz) 全更新フレームで business_display ≤ business_distance_m', () => {
    const { Meter } = setupMeter();
    Meter.setBusinessActive(true);
    Meter.start();
    const frames = [];
    const dists = [0, 8, 20, 50, 50, 120, 200, 200, 320];
    for (const d of dists) {
      Meter.setBusinessDistance(d);
      for (let k = 0; k < 6; k++) frames.push(Meter.getState());
    }
    let maxOver = -Infinity;
    for (const s of frames) {
      const over = (s.business_display_distance_m || 0) - (s.business_distance_m || 0);
      if (over > maxOver) maxOver = over;
    }
    if (maxOver > 1e-6) {
      throw new Error(
        'business overshoot 検出: business_display が business_distance_m を超えた。max over = ' +
          maxOver.toFixed(6) +
          ' m'
      );
    }
  });

  it('(b) latch (stop=確定) 後に display == distance_m (支払時点 メーター=実距離=料金)', () => {
    const { Meter } = setupMeter();
    Meter.start();
    const frames = [];
    // 急に大きく距離を進めて display が catch-up 途中 (display < distance_m) の状態を作る。
    Meter.setDistance(5);
    frames.push(Meter.getState());
    Meter.setDistance(500);
    // 1 フレームだけ読む → catch-up は途中 (display << 500) のはず。
    const mid = Meter.getState();
    if ((mid.display_distance_m || 0) >= 500 - 1e-6) {
      // 1 tick で即追いつくほど TAU が短いなら latch 効果が観測できない → 設計逸脱を検出。
      throw new Error(
        'catch-up が 1 フレームで完了 (= 中間状態を作れない・TAU 設計逸脱)。display=' +
          mid.display_distance_m
      );
    }
    // ★latch: stop で display == distance_m へ即収束するはず。
    Meter.stop();
    const after = Meter.getState();
    const gap = Math.abs((after.distance_m || 0) - (after.display_distance_m || 0));
    if (gap > 1e-6) {
      throw new Error(
        'stop(確定) 後 display が distance_m に latch しない。gap = ' + gap.toFixed(6)
      );
    }
  });

  it('(b-biz) latch (businessEnd=業務終了) 後に business_display == business_distance_m', () => {
    const { Meter } = setupMeter();
    Meter.setBusinessActive(true);
    Meter.start();
    Meter.setBusinessDistance(8);
    Meter.getState();
    Meter.setBusinessDistance(600);
    Meter.getState(); // catch-up 途中
    Meter.businessEnd();
    const after = Meter.getState();
    const gap = Math.abs(
      (after.business_distance_m || 0) - (after.business_display_distance_m || 0)
    );
    if (gap > 1e-6) {
      throw new Error(
        '業務終了後 business_display が business_distance_m に latch しない。gap = ' +
          gap.toFixed(6)
      );
    }
  });

  it('(c) 停車 trace で display が単調かつ target に収束する', () => {
    const { Meter, inject } = setupMeter();
    Meter.start();
    const frames = [];
    const drive = makeDriver(inject, Meter, frames);
    // 距離を 240m まで進めてから停車 (target 不動) → display は単調かつ 240 へ収束。
    const dists = [0, 30, 90, 180, 240];
    for (const d of dists) drive(d, 5);
    // 停車: target 据え置きで UI を多数回読む → 収束させる。
    for (let k = 0; k < 5000; k++) frames.push(Meter.getState());

    let prev = 0;
    let monoViol = 0;
    for (const s of frames) {
      const disp = s.display_distance_m || 0;
      if (disp < prev - 1e-6) monoViol++;
      prev = Math.max(prev, disp);
    }
    if (monoViol > 0) throw new Error('display が後退した (単調違反 ' + monoViol + ' 回)');

    const last = frames[frames.length - 1];
    const gap = (last.distance_m || 0) - (last.display_distance_m || 0);
    if (gap > 0.01) {
      throw new Error('停車後 display が target に収束しない。残 gap = ' + gap.toFixed(6) + ' m');
    }
    // 停車中 overshoot も不能。
    if ((last.display_distance_m || 0) - (last.distance_m || 0) > 1e-6) {
      throw new Error('停車収束時に overshoot した');
    }
  });

  it('(d) fare = calcFare(display) 配線維持 → fare ≤ calcFare(distance_m) を常に満たす', () => {
    const { Meter } = setupMeter();
    Meter.start();
    const dists = [0, 7, 18, 44, 44, 130, 260, 260, 999, 1001, 1421];
    let maxFareOver = -Infinity;
    for (const d of dists) {
      Meter.setDistance(d);
      for (let k = 0; k < 6; k++) {
        const s = Meter.getState();
        const fareOnDisplay = Meter.calcFare(s.display_distance_m || 0);
        const fareOnDistance = Meter.calcFare(s.distance_m || 0);
        // ★過大請求不能: メーター(display) 課金 ≤ 実距離 課金。
        const over = fareOnDisplay - fareOnDistance;
        if (over > maxFareOver) maxFareOver = over;
      }
    }
    if (maxFareOver > 0) {
      throw new Error(
        'calcFare(display) > calcFare(distance_m) が発生 (= 過大請求)。max over = ' +
          maxFareOver +
          ' 円'
      );
    }
  });
});
