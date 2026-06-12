// tests/integration/stationary-baseline-watchdog.test.js
//
// ★設計変更宣言 (2026-05-28・新構造対応 全面書換):
//   旧: 自前の `simulateStationaryFallback` (= speedKmh<3 + radius<3m/5s) で
//       「現状 baseline = 屋内 0% 等」 を記録するだけの自己完結 sim だった。
//       実 gps-worker.js を一切呼ばず・Fix① (= 加速度variance主体) を全く検証していなかった。
//       「新構造を偽って緑」 になっていた。
//   新: 実 js/gps-worker.js を tests/worker/gps-worker-sim.js の vm context で実走させ・
//       tests/replay-mm-worker/gps-layer-pipeline.js を経由して
//       実 meter.js (= state.business_distance_m) まで通して挙動を assert する。
//       A3偽速度 / iOS accel拒否 / 屋内 poor accuracy / 5Hz / iOS×Android matrix を
//       parametrize して全通し検証する。
//
//   ★絶対ルール準拠:
//     ・distance_m / calcFare / running gate / 5加算経路 / isStationary 判定本体: 1 byte 不変
//     ・本 file は test 追加のみ・本番 js/*.js は触らない
//     ・既存 section 3-5 (= 司さん家 PIP / banner 削除 watchdog) は1byte 不変で保持

'use strict';

const path = require('path');
const fs = require('fs');

const { runGpsLayerPipeline } = require('../replay-mm-worker/gps-layer-pipeline');
const {
  generateGpsTrace,
  staticTrueTrace,
  linearTrueTrace,
  defaultConfigIndoor,
} = require('../replay-mm-worker/noise-model');

// ─── 1. Fix① 静止判定 watchdog (★実 gps-worker.js 経由・新構造) ────────
//
// 検証する不変: 「物理的に静止している(=加速度平坦)端末は・GPS 偽速度や drift が
//   あっても worker が isStationary=true を返し・business_distance_m は増えない」
// シナリオは parametrized matrix:
//   静止/低速/高速 × iOS(hav)/Android(dop) × accel 有/無 × accuracy 普通/屋内poor
describe('Fix① 静止判定 watchdog (実 gps-worker.js 経由・★新構造)', () => {
  const N = 40; // 各シナリオ step 数 (= 40 秒 1Hz 相当)
  const BASE_LAT = 33.84;
  const BASE_LNG = 132.7656;

  // 共通 helper: シナリオを走らせ summary 計算
  function runScenario(genCfg, opts) {
    const trace = genCfg.linear
      ? generateGpsTrace(
          linearTrueTrace(
            BASE_LAT,
            BASE_LNG,
            N,
            genCfg.linear.speedKmh,
            genCfg.interval_ms || 1000,
            genCfg.linear.bearingDeg || 90
          ),
          genCfg
        )
      : generateGpsTrace(staticTrueTrace(BASE_LAT, BASE_LNG, N), genCfg);
    return {
      trace,
      result: runGpsLayerPipeline(trace, opts),
    };
  }

  const SCENARIOS_FIX1 = [
    {
      name: '①-1 iPhone13 iOS A3偽速度 静止 + accel平坦 → isStationary=true 維持・creep=0',
      gen: {
        seed: 7,
        position_noise_stddev_m: 0.6, // 実機 A3 ≈ 3km/h 相当 (1Hz σ0.6 → mean 3-4km/h)
        accuracy_mean_m: 8,
        accuracy_stddev_m: 1.5,
        outlier_rate: 0,
        speed_mode: 'hav', // ★A3 = coords.speed null → 連続 noisy 点 haversine 代用
        interval_ms: 1000,
        accel_mode: 'stationary',
      },
      opts: { businessActive: true, running: false },
      expect: {
        statTrueRatio_min: 0.85,
        biz_max_m: 1,
        emit_ratio_min: 0.7,
      },
    },
    {
      name: '①-2 iOS accel権限拒否 (位置半径fallback) → isStationary=true 維持・creep=0',
      gen: {
        seed: 7,
        position_noise_stddev_m: 0.6,
        accuracy_mean_m: 8,
        accuracy_stddev_m: 1.5,
        outlier_rate: 0,
        speed_mode: 'hav',
        interval_ms: 1000,
        accel_mode: 'none', // ★accel 無 = iOS DeviceMotion 拒否相当・位置半径 fallback 経路
      },
      opts: { businessActive: true, running: false },
      expect: {
        statTrueRatio_min: 0.6, // fallback は anchor warmup あり (5秒)・閾値緩め
        biz_max_m: 1,
        emit_ratio_min: 0.7,
      },
    },
    {
      name: '①-3 Android Doppler 静止 (speed=0 dop) + accel平坦 → creep=0',
      gen: {
        seed: 11,
        position_noise_stddev_m: 0.6,
        accuracy_mean_m: 8,
        accuracy_stddev_m: 1.5,
        outlier_rate: 0,
        speed_mode: 'dop', // ★Android = Doppler あり
        interval_ms: 1000,
        accel_mode: 'stationary',
        speed_noise_kmh: 0.3,
      },
      opts: { businessActive: true, running: false },
      expect: {
        statTrueRatio_min: 0.85,
        biz_max_m: 1,
        emit_ratio_min: 0.7,
      },
    },
    {
      name: '①-4 屋内 poor accuracy (12-17m) 静止 + accel平坦 → creep=0 (Fix①②協調)',
      gen: Object.assign(defaultConfigIndoor(), {
        seed: 13,
        position_noise_stddev_m: 1.0,
        outlier_rate: 0,
        speed_mode: 'hav',
        interval_ms: 1000,
        accel_mode: 'stationary',
      }),
      opts: { businessActive: true, running: false },
      expect: {
        statTrueRatio_min: 0.5, // 静止確定後 cap=base(10)で多く reject → emit 少だが creep 出ない
        biz_max_m: 1,
        emit_ratio_min: 0.02, // 最初の数frame は accept (= Fix① が即静止確定)
      },
    },
    {
      name: '①-5 高速走行 40km/h Doppler + accel motion → isStationary=false 100%',
      gen: {
        seed: 17,
        position_noise_stddev_m: 1.0,
        accuracy_mean_m: 8,
        accuracy_stddev_m: 1.5,
        outlier_rate: 0,
        speed_mode: 'dop',
        interval_ms: 1000,
        accel_mode: 'moving',
        speed_noise_kmh: 1,
        heading_noise_deg: 3,
        linear: { speedKmh: 40, bearingDeg: 90 },
      },
      opts: { businessActive: true, running: true },
      expect: {
        // 走行中は isStationary=false 100% 期待 (= 課金 distance 増加保証)
        statTrueRatio_max: 0,
      },
    },
    {
      name: '①-6 Android 5Hz 静止 + accel平坦 → 高レートでも creep=0',
      gen: {
        seed: 19,
        position_noise_stddev_m: 0.6,
        accuracy_mean_m: 8,
        accuracy_stddev_m: 1.5,
        outlier_rate: 0,
        speed_mode: 'dop',
        interval_ms: 200, // ★5Hz
        accel_mode: 'stationary',
        speed_noise_kmh: 0.3,
      },
      opts: { businessActive: true, running: false },
      expect: {
        statTrueRatio_min: 0.5, // 5Hz だと最初の数frame accel window 不足あり・最終的に stationary
        biz_max_m: 1,
      },
    },
    {
      // ★設計変更宣言 (2026-05-28・実機 Android iPhone13 屋内 Doppler creep 真因再現):
      //   司さん iPhone13/Android 実機で・屋内静止中に・Doppler 偽速度 0.6-0.8km/h が継続出力 +
      //   accel ノイズで Fix① 静止判定が時々 moving に振れる + GPS dropout で・[Meter] GPS消失補完
      //   (mm/retro/gap 経路) が発火 → business_distance_m が 70m/7 分で creep する現象を再現。
      //   この fixture は・ZUPT 並記 (= 4 経路に _isBusinessZuptMicroMotion 並記) ★前は FAIL★・
      //   並記後は緑 (= mirror アーキ完成) で・修正の効果を assertion で担保する。
      name: '①-7 Android Doppler 屋内偽速度 0.6km/h 継続 + accel ノイズ → business creep ≤ 1m (★ZUPT 全 4 経路並記 検証)',
      gen: {
        seed: 23,
        position_noise_stddev_m: 1.0,
        accuracy_mean_m: 8,
        accuracy_stddev_m: 2,
        outlier_rate: 0,
        speed_mode: 'dop',
        speed_bias_kmh: 0.6, // ★屋内 Doppler 偽速度 mean=0.6km/h 継続出力 (= 司さん実機 Eruda log 観測値)
        speed_noise_kmh: 0.2,
        interval_ms: 1000,
        accel_mode: 'moving', // ★屋内 accel ノイズで・Fix① 判定が時々 moving に振れる (= 実機現象)
      },
      opts: { businessActive: true, running: false },
      expect: {
        biz_max_m: 1, // ★ZUPT 並記 前は FAIL・並記後は緑 (= mirror アーキ完成)
      },
    },
  ];

  for (const s of SCENARIOS_FIX1) {
    it(s.name, () => {
      const { result } = runScenario(s.gen, s.opts);
      const emitRatio = result.workerEmittedCount / result.totalSteps;
      const statTrueRatio =
        result.workerEmittedCount > 0 ? result.stationaryTrueCount / result.workerEmittedCount : 0;
      const biz = result.finalState.business_distance_m || 0;
      const ctx =
        `emit=${result.workerEmittedCount}/${result.totalSteps}(${emitRatio.toFixed(2)}) ` +
        `statTrue=${result.stationaryTrueCount}(${statTrueRatio.toFixed(2)}) biz=${biz.toFixed(2)}m`;
      if (s.expect.emit_ratio_min != null) {
        if (emitRatio < s.expect.emit_ratio_min) {
          throw new Error(
            `${s.name}: emit_ratio ${emitRatio.toFixed(2)} < ${s.expect.emit_ratio_min} | ${ctx}`
          );
        }
      }
      if (s.expect.statTrueRatio_min != null) {
        if (statTrueRatio < s.expect.statTrueRatio_min) {
          throw new Error(
            `${s.name}: statTrueRatio ${statTrueRatio.toFixed(2)} < ${s.expect.statTrueRatio_min} | ${ctx}`
          );
        }
      }
      if (s.expect.statTrueRatio_max != null) {
        if (statTrueRatio > s.expect.statTrueRatio_max) {
          throw new Error(
            `${s.name}: statTrueRatio ${statTrueRatio.toFixed(2)} > ${s.expect.statTrueRatio_max} | ${ctx}`
          );
        }
      }
      if (s.expect.biz_max_m != null) {
        if (biz > s.expect.biz_max_m) {
          throw new Error(
            `${s.name}: business_distance_m ${biz.toFixed(2)} > ${s.expect.biz_max_m} | ${ctx}`
          );
        }
      }
    });
  }
});

// ─── 2. Fix② accuracy cap watchdog (★実 gps-worker.js 経由・新構造) ────
//
// 検証する不変:
//   ・移動時は屋内 poor accuracy (12-17m) を accept (= 全 reject 凍結を回避)
//   ・静止時は厳格 cap (= drift を計上しない)
//   ・本当に悪い accuracy (>25m) は移動時でも reject (= ゲート機能維持)
describe('Fix② accuracy cap watchdog (実 gps-worker.js 経由・★新構造)', () => {
  const N = 40;
  const BASE_LAT = 33.84;
  const BASE_LNG = 132.7656;

  it('②-1 屋内 12-17m + 移動 15km/h → emit 多 (= 凍結なし・Fix② で accept)', () => {
    const cfg = Object.assign(defaultConfigIndoor(), {
      seed: 23,
      position_noise_stddev_m: 1.5,
      outlier_rate: 0,
      speed_mode: 'dop',
      interval_ms: 1000,
      accel_mode: 'moving',
      heading_noise_deg: 5,
      speed_noise_kmh: 1,
    });
    const trace = generateGpsTrace(linearTrueTrace(BASE_LAT, BASE_LNG, N, 15, 1000, 90), cfg);
    const result = runGpsLayerPipeline(trace, { businessActive: true, running: true });
    const emitRatio = result.workerEmittedCount / result.totalSteps;
    // 旧 cap10 なら全 reject (emit=0) → 凍結。Fix② 移動時 cap=20 → 半数以上 accept。
    if (emitRatio < 0.35) {
      throw new Error(
        `②-1: 屋内移動で emit_ratio ${emitRatio.toFixed(2)} < 0.35 (凍結検知) emit=${result.workerEmittedCount}/${result.totalSteps}`
      );
    }
  });

  // ★設計変更宣言 (2026-06-04・bypass化D): 移動時 accuracy 天井を 20m → accuracy_moving_extreme_m
  //   (=35m) へ引き上げ「真に使い物にならない極端値のみ硬棄却」へ。中程度誤差 (acc 30m) は受理し
  //   Worker B(Viterbi) に外れ値吸収を委ねる (= 点を消さない bypass 化)。よって本ゲートは検査軸を
  //   「acc 30m は受理 (= 過少回復)」かつ「acc 45m (= 35m 天井超の極端値) は硬棄却 (= 過大ゼロ保険)」
  //   の 2 点に更新する。
  it('②-2 acc 30m + 移動 → emit 多 (= bypass化D で 35m 天井まで受理・点を消さない)', () => {
    const cfg = {
      seed: 29,
      position_noise_stddev_m: 2,
      accuracy_mean_m: 30, // ★accuracy_moving_extreme_m=35 未満 → 受理されるべき
      accuracy_stddev_m: 3,
      outlier_rate: 0,
      speed_mode: 'dop',
      interval_ms: 1000,
      accel_mode: 'moving',
      heading_noise_deg: 5,
      speed_noise_kmh: 1,
    };
    const trace = generateGpsTrace(linearTrueTrace(BASE_LAT, BASE_LNG, N, 40, 1000, 90), cfg);
    const result = runGpsLayerPipeline(trace, { businessActive: true, running: true });
    const emitRatio = result.workerEmittedCount / result.totalSteps;
    // 30m mean < 35m 天井 → 大半 accept (= 点を消さず Worker B 委任)。
    if (emitRatio < 0.6) {
      throw new Error(
        `②-2: acc 30m (35m 天井未満) なのに emit_ratio ${emitRatio.toFixed(2)} < 0.6 (過剰棄却) emit=${result.workerEmittedCount}/${result.totalSteps}`
      );
    }
  });

  it('②-2b acc 45m + 移動 → emit 低 (= bypass化D の極端値硬棄却・過大ゼロ保険・35m 天井)', () => {
    const cfg = {
      seed: 31,
      position_noise_stddev_m: 2,
      accuracy_mean_m: 45, // ★accuracy_moving_extreme_m=35 を確実に超える極端値
      accuracy_stddev_m: 3,
      outlier_rate: 0,
      speed_mode: 'dop',
      interval_ms: 1000,
      accel_mode: 'moving',
      heading_noise_deg: 5,
      speed_noise_kmh: 1,
    };
    const trace = generateGpsTrace(linearTrueTrace(BASE_LAT, BASE_LNG, N, 40, 1000, 90), cfg);
    const result = runGpsLayerPipeline(trace, { businessActive: true, running: true });
    const emitRatio = result.workerEmittedCount / result.totalSteps;
    // 45m mean > 35m 天井 → 大半 reject (= 使い物にならない極端値は距離前に硬棄却)
    if (emitRatio > 0.3) {
      throw new Error(
        `②-2b: 極端 accuracy 45m で emit_ratio ${emitRatio.toFixed(2)} > 0.3 (天井ゆるすぎ) emit=${result.workerEmittedCount}/${result.totalSteps}`
      );
    }
  });

  // ★②-3 (2026-05-28・★Fix① v2 dwell time で復活):
  //   旧 Fix① で Linux CI で偽速度 spike 11.68km/h (1 step) が 10km/h backstop を defeat し
  //   biz=33.23m creep が発生 (run 26553931113 で diagnostic 確認)。
  //   Fix① v2 (dwell time=3 step) で・1 step spike では highSpeedFire しない → accel branch
  //   → c1&&!c2=true → finalStationary=true 維持 → biz=0 を期待。
  //   diagnostic 版は CI ログで Linux 環境の挙動を比較確認するため保持。
  it('②-3 屋内 12-17m + 静止 + accel平坦 → biz=0 (= 静止時は drift 計上しない)', () => {
    const cfg = Object.assign(defaultConfigIndoor(), {
      seed: 31,
      position_noise_stddev_m: 1.0,
      outlier_rate: 0,
      speed_mode: 'hav',
      interval_ms: 1000,
      accel_mode: 'stationary',
    });
    const trace = generateGpsTrace(staticTrueTrace(BASE_LAT, BASE_LNG, N), cfg);
    const result = runGpsLayerPipeline(trace, { businessActive: true, running: false });
    const biz = result.finalState.business_distance_m || 0;
    if (biz > 1) {
      throw new Error(`②-3: 屋内静止で biz=${biz.toFixed(2)} > 1m (creep 検知)`);
    }
  });

  // ★②-3 diagnostic (2026-05-28・★Linux 環境差調査★・assertion なし・常に PASS):
  //   ②-3 と同じシナリオを CI で実行し・per-step の (emit/isStat/dDist/dBiz/accuracy/speedKmh) を
  //   console.log で吐く。CI ログから・どの step で biz が伸びたか・何が Linux 特有挙動か特定する。
  it('②-3 diagnostic: CI per-step ダンプ (assertion なし・★ローカル/CI 差調査用)', () => {
    const cfg = Object.assign(defaultConfigIndoor(), {
      seed: 31,
      position_noise_stddev_m: 1.0,
      outlier_rate: 0,
      speed_mode: 'hav',
      interval_ms: 1000,
      accel_mode: 'stationary',
    });
    const trace = generateGpsTrace(staticTrueTrace(BASE_LAT, BASE_LNG, N), cfg);
    const result = runGpsLayerPipeline(trace, { businessActive: true, running: false });
    const biz = result.finalState.business_distance_m || 0;
    const env = `node=${process.version} platform=${process.platform} arch=${process.arch}`;
    // ★dump (CI ログ抽出用)
    // eslint-disable-next-line no-console
    console.log(`[DIAG-②-3] env: ${env}`);
    // eslint-disable-next-line no-console
    console.log(
      `[DIAG-②-3] final: biz=${biz.toFixed(4)} dist=${result.finalState.distance_m.toFixed(4)} emit=${result.workerEmittedCount}/${result.totalSteps} statT=${result.stationaryTrueCount}`
    );
    // eslint-disable-next-line no-console
    console.log(
      `[DIAG-②-3] trace first 5: ` +
        trace
          .slice(0, 5)
          .map(
            (t, i) =>
              `s${i}{spd=${t.speedKmh.toFixed(2)} src=${t.speedSrc} acc=${t.accuracy.toFixed(2)} lat=${t.lat.toFixed(6)} lng=${t.lng.toFixed(6)}}`
          )
          .join(' | ')
    );
    // per-step (dDist > 0 or dBiz > 0 の step のみ・creep が起きた所だけ抽出)
    const significant = result.perStep.filter((p) => p.dDist > 0 || p.dBiz > 0);
    // eslint-disable-next-line no-console
    console.log(
      `[DIAG-②-3] significant steps (dDist>0 or dBiz>0): ` +
        (significant.length === 0
          ? '(none)'
          : significant
              .slice(0, 10)
              .map(
                (p) =>
                  `s${p.step}{emit=${p.emitted} stat=${p.isStationary} acc=${p.accuracy.toFixed(2)} spd=${p.speedKmh.toFixed(2)} dDist=${p.dDist} dBiz=${p.dBiz}}`
              )
              .join(' | '))
    );
    // assertion なし (= 常に PASS・CI ログ採取に専念)
    if (biz < 0) throw new Error('unreachable');
  });
});

// ─── 3. 司さん家 fixture (= 案 C 既存 PIP regression と統合・距離挙動 verify) ───
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
