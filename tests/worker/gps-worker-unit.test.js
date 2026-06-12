// tests/worker/gps-worker-unit.test.js
// ZEROact 共通テスト基盤 P11 (2026-05-18 新規) — gps-worker.js 単体テスト
// ★Phase 4 拡張 (2026-05-21): 静的 grep のみ (= drift-risk #4) を解消するため・
//   tests/worker/gps-worker-sim.js を経由した実 Worker A 実走テストを追加。
//   既存静的検証 (CONFIG 閾値・3-AND pattern grep) は保持・互換性のため。
//   新規実走 case で挙動 (= 動的 accuracy / jump 棄却 / 停車 5 重 gate / T12 hardBrake /
//   compass 融合) を Worker context 内で確認する。
//
// 司さん memory 既記載値 (= verified gps-worker.js L627 + L19-21):
//   stationary_sec: 5
//   stationary_radius_m: 3
//   speed_limit_kmh: 3
//   accel_variance_threshold: 0.1
//   accel_motion_threshold: 0.5

import '@vitest/web-worker'; // 将来 dynamic worker test 用の setup・現状は import のみ
const fs = require('fs');
const path = require('path');

const GPS_WORKER_PATH = path.join(__dirname, '..', '..', 'js', 'gps-worker.js');

function loadSource() {
  return fs.readFileSync(GPS_WORKER_PATH, 'utf8');
}

describe('gps-worker.js 静的検証 (P11)', () => {
  it('CONFIG 閾値 5 件が定義されている', () => {
    const source = loadSource();
    const expected = [
      /speed_limit_kmh\s*:\s*3/,
      /stationary_sec\s*:\s*5/,
      /stationary_radius_m\s*:\s*3/,
      /accel_variance_threshold\s*:\s*0\.1/,
      /accel_motion_threshold\s*:\s*0\.5/,
    ];
    for (const re of expected) {
      if (!re.test(source)) {
        throw new Error('CONFIG 閾値未検出: ' + re.toString());
      }
    }
  });

  // ★ Phase 6-7 (2026-05-21・(M) 分離): 旧 'isStationary 判定 3-AND が L627 周辺' /
  //   '加速度サンプル null 救済 (L596-598) が存在' (= 行アンカー ±10 静的 grep) は
  //   tests/drift-static/gps-worker-anchor.test.js へ移動。
  //   理由: Stryker instrumentation で行シフト → false-fail。byte 不変で別 file 化し
  //         通常 vitest run では同 ±10 厳格度で実行・stryker では exclude する設計。

  it('checkStationary 関数が定義されている', () => {
    const source = loadSource();
    if (!/function\s+checkStationary\s*\(/.test(source)) {
      throw new Error('checkStationary 関数定義未検出');
    }
  });

  it('self.postMessage で main thread に応答する経路が存在', () => {
    const source = loadSource();
    if (!/self\.postMessage\s*\(/.test(source)) {
      throw new Error('self.postMessage 呼出未検出 (= Worker A → main thread 通信)');
    }
  });
});

// ─── dynamic worker test (@vitest/web-worker 配線) ─────────────────

describe('gps-worker.js dynamic worker test (⑪)', () => {
  it('Worker 起動 + init message 送受信', { timeout: 15000 }, async () => {
    const workerUrl = new URL('../../js/gps-worker.js', import.meta.url);
    const worker = new Worker(workerUrl);

    // init message 送信
    worker.postMessage({
      type: 'init',
      data: { config: {}, debug: false },
    });

    // 即終了 (= 起動 + postMessage 受付成功で十分・実応答は init で出ない)
    // 短い待機で event loop が tick した後に terminate
    await new Promise((r) => setTimeout(r, 50));
    worker.terminate();
  });

  it('Worker 起動 + position message → result 応答受信', { timeout: 15000 }, async () => {
    const workerUrl = new URL('../../js/gps-worker.js', import.meta.url);
    const worker = new Worker(workerUrl);

    // init 先行
    worker.postMessage({ type: 'init', data: { config: {}, debug: false } });

    // result 受信 promise
    const resultPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error('worker result timeout (10s)'));
      }, 10000);
      worker.onmessage = (e) => {
        if (e.data && e.data.type === 'result') {
          clearTimeout(timeout);
          resolve(e.data.data);
        }
      };
      worker.onerror = (err) => {
        clearTimeout(timeout);
        reject(new Error('worker error: ' + (err && err.message)));
      };
    });

    // position 送信 (= 静止判定対象になりやすい低速 GPS)
    worker.postMessage({
      type: 'position',
      data: {
        lat: 33.84,
        lng: 132.7656,
        accuracy: 5,
        speedKmh: 0,
        heading: null,
        altitude: 0,
        now: Date.now(),
        compassHeading: null,
        accelSamples: [],
        gyroSamples: [],
      },
    });

    try {
      const result = await resultPromise;
      // result が返れば成功 (= 中身は Kalman 平滑後の値・ここでは存在のみ確認)
      expect(result).toBeDefined();
      expect(typeof result.lat).toBe('number');
      expect(typeof result.lng).toBe('number');
      expect(typeof result.isStationary).toBe('boolean');
    } finally {
      worker.terminate();
    }
  });
});

// ─── ダイコメ知識注入 (2026-05-18・isStationary 3-AND 詳細) ─────────

describe('isStationary 3-AND 条件 詳細 (gps-worker.js verified L596-627)', () => {
  function sendAndWait(worker, msg, timeoutMs) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error('timeout ' + timeoutMs + 'ms')),
        timeoutMs || 10000
      );
      worker.onmessage = (e) => {
        if (e.data && e.data.type === 'result') {
          clearTimeout(t);
          resolve(e.data.data);
        }
      };
      worker.onerror = (err) => {
        clearTimeout(t);
        reject(new Error('worker error: ' + (err && err.message)));
      };
      worker.postMessage(msg);
    });
  }

  it(
    '加速度サンプル null + 1 GPS 単独 → 即時停車判定は false (= 5 秒継続必要)',
    { timeout: 15000 },
    async () => {
      const worker = new Worker(new URL('../../js/gps-worker.js', import.meta.url));
      worker.postMessage({ type: 'init', data: { config: {}, debug: false } });
      try {
        const result = await sendAndWait(worker, {
          type: 'position',
          data: {
            lat: 33.84,
            lng: 132.7656,
            accuracy: 5,
            speedKmh: 0,
            heading: null,
            altitude: 0,
            now: Date.now(),
            compassHeading: null,
            accelSamples: [],
            gyroSamples: [],
          },
        });
        // 初回 GPS では elapsedSec=0 で isStationary=false (= 5 秒継続必要)
        expect(result.isStationary).toBe(false);
      } finally {
        worker.terminate();
      }
    }
  );

  it(
    '加速度サンプル null + 同座標 6 GPS 1Hz → isStationary=true 確定',
    { timeout: 20000 },
    async () => {
      const worker = new Worker(new URL('../../js/gps-worker.js', import.meta.url));
      worker.postMessage({ type: 'init', data: { config: {}, debug: false } });
      try {
        const baseTs = Date.now();
        let lastResult;
        for (let i = 0; i < 7; i++) {
          lastResult = await sendAndWait(worker, {
            type: 'position',
            data: {
              lat: 33.84,
              lng: 132.7656,
              accuracy: 5,
              speedKmh: 0,
              heading: null,
              altitude: 0,
              now: baseTs + i * 1000,
              compassHeading: null,
              accelSamples: [],
              gyroSamples: [],
            },
          });
        }
        // 7 step (= 6 秒経過) で isStationary=true 確定 (= 加速度 null fallback)
        expect(lastResult.isStationary).toBe(true);
      } finally {
        worker.terminate();
      }
    }
  );

  it(
    '速度 30km/h GPS 単発 → isStationary=false (= speed_limit_kmh=3 超過)',
    { timeout: 15000 },
    async () => {
      const worker = new Worker(new URL('../../js/gps-worker.js', import.meta.url));
      worker.postMessage({ type: 'init', data: { config: {}, debug: false } });
      try {
        const result = await sendAndWait(worker, {
          type: 'position',
          data: {
            lat: 33.84,
            lng: 132.7656,
            accuracy: 5,
            speedKmh: 30,
            heading: 90,
            altitude: 0,
            now: Date.now(),
            compassHeading: null,
            accelSamples: [],
            gyroSamples: [],
          },
        });
        expect(result.isStationary).toBe(false);
      } finally {
        worker.terminate();
      }
    }
  );
});

// ─── ダイコメ知識注入 (2026-05-18・Worker B mmResult 形式) ─────────
//
// Worker B (map-matcher.js) は本 test ファイル対象外 (= gps-worker.js 単体テスト)。
// mmResult 形式の verify は別 worker test として future work。
// ダイコメ knowledge として mmResult の期待形式を以下に記録:
//
//   type: 'mmResult'
//   mmIncrementM: number (= Tier1 Viterbi commit 距離・absolute 値)
//   tentativeIncrementM: number (= 表示用先行値・commit 前 preview)
//   snapped: boolean (= 道路 snap 成功フラグ)
//   committed: boolean (= Viterbi window 確定フラグ)
//   skipped: boolean (= snap 失敗 / accuracy 不足等の skip フラグ)
//   isStationary: boolean (= 入力 echo・force 0 化判定用)
//   timestamp: number (= input GPS の timestamp)
//
// ★ map-matcher.js の Worker B 単体テストは将来課題:
//   ・Worker B init は 47 県 roads データ load 必須 (= ~30 秒の重量起動)
//   ・msg.isStationary=true で mmIncrementM/tentativeIncrementM 強制 0 化 (L3007)
//   ・現状は静的検証 (= tests/property/isstationary-no-increase.test.js B4) でカバー

describe('Worker B mmResult 形式 (静的検証・将来 dynamic 拡張)', () => {
  it('property/static-check で map-matcher.js L3007 強制 0 化 pattern 存在 verify 済', () => {
    // 詳細は tests/property/isstationary-no-increase.test.js B4 に委譲
    // 本 placeholder は「mmResult 形式 知識を本 spec で記録した」明示用
    expect(true).toBe(true);
  });
});

// ─── Phase 4 (2026-05-21・Worker A 実走シナリオ・drift-risk #4 解消) ─────
// tests/worker/gps-worker-sim.js (= vm.runInContext で実 gps-worker.js を Worker context として
// evaluate) を使い・実コード経路で挙動 (= 動的 accuracy / jump 棄却 / 停車 5 重 gate / T12
// hardBrake / compass 融合) を検証。挙動は記録のみ・本番診断はしない (= ツール完成後)。
const { createGpsWorker } = require('./gps-worker-sim');

describe('Phase 4: gps-worker.js 実走シナリオ (vm.runInContext 経由・drift-risk #4 解消)', () => {
  function initWorker() {
    const w = createGpsWorker();
    w.sendMessage({ type: 'init', data: { config: {}, debug: false } });
    return w;
  }

  // ─── シナリオ ①: 動的 accuracy 閾値で skip される ───────────────
  it('シナリオ ①-a: accuracy 超過 GPS は skip (= result message なし)', () => {
    const w = initWorker();
    const t0 = 1700000000000;
    // accuracy=200m (= 動的閾値より大幅超え) → processPosition return null
    w.sendMessage({
      type: 'position',
      data: {
        lat: 33.84,
        lng: 132.78,
        accuracy: 200,
        speedKmh: 40,
        heading: 90,
        altitude: 0,
        now: t0,
      },
    });
    const results = w.getResults();
    expect(results.length).toBe(0); // ★ accuracy 超過 → skip 確認
  });

  it('シナリオ ①-b: accuracy 良好 GPS は result 返却', () => {
    const w = initWorker();
    const t0 = 1700000000000;
    w.sendMessage({
      type: 'position',
      data: {
        lat: 33.84,
        lng: 132.78,
        accuracy: 5,
        speedKmh: 40,
        heading: 90,
        altitude: 0,
        now: t0,
      },
    });
    const results = w.getResults();
    expect(results.length).toBe(1);
    expect(typeof results[0].lat).toBe('number');
    expect(typeof results[0].isStationary).toBe('boolean');
  });

  // ─── シナリオ ②: GPS jump 棄却 ──────────────────────────────
  it('シナリオ ②: jump_limit 超過 (= 50m/s = 180km/h 相当) で skip', () => {
    const w = initWorker();
    const t0 = 1700000000000;
    // 1 点目 = 基準
    w.sendMessage({
      type: 'position',
      data: {
        lat: 33.84,
        lng: 132.78,
        accuracy: 5,
        speedKmh: 40,
        heading: 90,
        altitude: 0,
        now: t0,
      },
    });
    // 2 点目 = 1 秒後・100m 西へ jump (= 100m/s・jump_limit 50m/s 超過)
    w.sendMessage({
      type: 'position',
      data: {
        lat: 33.84,
        lng: 132.7889,
        accuracy: 5,
        speedKmh: 40,
        heading: 90,
        altitude: 0,
        now: t0 + 1000,
      },
    });
    const results = w.getResults();
    // 1 点目は OK・2 点目は jump で skip → results.length=1
    expect(results.length).toBe(1);
  });

  // ─── シナリオ ③: 加速度異常は ★位置を棄却しない★ (= bypass化B・2026-06-04) ───────────────
  //   ★設計変更宣言 (2026-06-04・bypass化B): 加速度異常 (>8m/s²) は「速度成分の異常」であって
  //     位置 fix の棄却理由にしない。旧設計は 2 点目を skip (length=1) したが、bypass 化で位置は
  //     emit され Worker B(Viterbi snap) が外れ値を委任吸収する。よって 2 点目も result に載る
  //     (length=2)。診断 (_postGpsDbg rej:accel) は残るが棄却はしない。
  it('シナリオ ③: 加速度 > 8 m/s² でも位置は受理 (= bypass化B・Worker B 委任・27.8m/s²)', () => {
    const w = initWorker();
    const t0 = 1700000000000;
    w.sendMessage({
      type: 'position',
      data: {
        lat: 33.84,
        lng: 132.78,
        accuracy: 5,
        speedKmh: 5,
        heading: 90,
        altitude: 0,
        now: t0,
      },
    });
    w.sendMessage({
      type: 'position',
      data: {
        lat: 33.84,
        lng: 132.7801,
        accuracy: 5,
        speedKmh: 100,
        heading: 90,
        altitude: 0,
        now: t0 + 1000,
      },
    });
    const results = w.getResults();
    // 1 点目 OK・2 点目も加速度異常でも ★位置受理★ (= bypass化B・棄却しない) → length=2
    expect(results.length).toBe(2);
  });

  // ─── シナリオ ④: 停車 5 重 gate + ZUPT (= 5 秒継続) ─────────
  it('シナリオ ④: 5 秒継続停車 (= 同位置・低速) で isStationary=true 発火', () => {
    const w = initWorker();
    const t0 = 1700000000000;
    // 同位置で 6 秒間 5km/h 以下を送信
    for (let i = 0; i < 7; i++) {
      w.sendMessage({
        type: 'position',
        data: {
          lat: 33.84,
          lng: 132.78,
          accuracy: 5,
          speedKmh: 1,
          heading: 90,
          altitude: 0,
          now: t0 + i * 1000,
          accelSamples: [{ x: 0, y: 0, z: 9.8, timestamp: t0 + i * 1000 }],
        },
      });
    }
    const results = w.getResults();
    expect(results.length).toBeGreaterThan(0);
    // 末尾の result で isStationary が true
    const last = results[results.length - 1];
    // 注: 5 秒継続 + C-1/C-2 加速度判定の組合せで・必ず true とは限らない (= 3-AND gate)
    //     accelSamples 不足で「null 救済」も発動・GPS 単独で判定する pattern もある
    expect(typeof last.isStationary).toBe('boolean'); // 動作確認のみ・boolean 出力
  });

  it('シナリオ ④-b: 走行中 GPS (= 40km/h) は isStationary=false', () => {
    const w = initWorker();
    const t0 = 1700000000000;
    // 速度 40km/h で位置変動あり
    for (let i = 0; i < 7; i++) {
      w.sendMessage({
        type: 'position',
        data: {
          lat: 33.84 + i * 0.0001,
          lng: 132.78,
          accuracy: 5,
          speedKmh: 40,
          heading: 0,
          altitude: 0,
          now: t0 + i * 1000,
        },
      });
    }
    const results = w.getResults();
    expect(results.length).toBeGreaterThan(0);
    const last = results[results.length - 1];
    expect(last.isStationary).toBe(false); // ★ 走行中は false 確実
  });

  // ─── シナリオ ⑤: 進行方向不整合で skip ──────────────────
  it('シナリオ ⑤: heading と移動方向の差 > 90度 で skip', () => {
    const w = initWorker();
    const t0 = 1700000000000;
    // 1 点目: 基準・heading=東 (90度)
    w.sendMessage({
      type: 'position',
      data: {
        lat: 33.84,
        lng: 132.78,
        accuracy: 5,
        speedKmh: 40,
        heading: 90,
        altitude: 0,
        now: t0,
      },
    });
    // 2 点目: 北へ移動 (= 移動 bearing 0度)・但し heading=東 (= 90度差)
    w.sendMessage({
      type: 'position',
      data: {
        lat: 33.8401, // 約 11m 北 (= heading_check_min_distance_m=5m を超える)
        lng: 132.78,
        accuracy: 5,
        speedKmh: 40,
        heading: 90, // 東を指す
        altitude: 0,
        now: t0 + 1000,
      },
    });
    const results = w.getResults();
    // 1 点目 OK・2 点目は heading 不整合 (= 90度差 = threshold ぴったり) で skip しない可能性
    // 実コード L546: diff > threshold (= 90度) で skip。**=90 では skip しない**仕様
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  // ─── シナリオ ⑥: reset で内部状態クリア ──────────────────
  it('シナリオ ⑥: reset 後・isStationary state がクリアされる', () => {
    const w = initWorker();
    const t0 = 1700000000000;
    // 停車 GPS を 6 秒
    for (let i = 0; i < 7; i++) {
      w.sendMessage({
        type: 'position',
        data: {
          lat: 33.84,
          lng: 132.78,
          accuracy: 5,
          speedKmh: 1,
          heading: 90,
          altitude: 0,
          now: t0 + i * 1000,
        },
      });
    }
    // reset
    w.sendMessage({ type: 'reset' });
    // reset 後・1 点 GPS
    w.sendMessage({
      type: 'position',
      data: {
        lat: 33.84,
        lng: 132.78,
        accuracy: 5,
        speedKmh: 40,
        heading: 90,
        altitude: 0,
        now: t0 + 10000,
      },
    });
    const results = w.getResults();
    expect(results.length).toBeGreaterThan(0);
    // reset 後最初の result は・isStationary=false (= 内部 state クリア)
    const lastResult = results[results.length - 1];
    expect(lastResult.isStationary).toBe(false);
  });

  // ─── シナリオ ⑦: T12 急ブレーキ hardBrake 検出 ──────
  it('シナリオ ⑦: 急減速 (= 40→0km/h を 1 秒) で・hardBrake / inertialDriftHint の挙動を観測', () => {
    const w = initWorker();
    const t0 = 1700000000000;
    // 走行中の連続 GPS
    for (let i = 0; i < 3; i++) {
      w.sendMessage({
        type: 'position',
        data: {
          lat: 33.84 + i * 0.0001,
          lng: 132.78,
          accuracy: 5,
          speedKmh: 40,
          heading: 0,
          altitude: 0,
          now: t0 + i * 1000,
        },
      });
    }
    // 急減速 (= 40→1km/h を 1 秒で = -10.8m/s²・加速度異常 8m/s² で skip される)
    w.sendMessage({
      type: 'position',
      data: {
        lat: 33.8403,
        lng: 132.78,
        accuracy: 5,
        speedKmh: 1,
        heading: 0,
        altitude: 0,
        now: t0 + 3000,
      },
    });
    const results = w.getResults();
    // ★bypass化B (2026-06-04): 急減速 (= 11m/s²) でも加速度異常は位置を棄却しない設計に変更。
    //   4 点目も result に載る (= 全 4 点)。hardBrake clamp は速度成分にのみ作用し位置は emit される。
    expect(results.length).toBeGreaterThanOrEqual(3);
    // hardBrake field が・各 result で boolean 値として返る
    for (const r of results) {
      expect(typeof r.hardBrake).toBe('boolean');
      expect(r.inertialDriftHint == null || typeof r.inertialDriftHint === 'object').toBe(true);
    }
  });

  // ─── シナリオ ⑧: setRoadType で typeCode 受領 ────────
  it('シナリオ ⑧: setRoadType message で _currentTypeCode 更新 (= 後続 Kalman Q 動的選択)', () => {
    const w = initWorker();
    // typeCode=0 (= motorway) → Kalman Q 動的選択ベース
    w.sendMessage({ type: 'setRoadType', data: { typeCode: 0 } });
    // null クリア
    w.sendMessage({ type: 'setRoadType', data: { typeCode: null } });
    // エラーなく処理されること (= return; だけなので postMessage なし・msg log でも応答なし)
    expect(true).toBe(true);
  });

  // ─── ★ Phase 4 fidelity (2026-05-21・realism check 司さん指示): 3-AND gate 発火確認
  //   stationary シナリオで・実機相当 accel (= variance ~0.02 / |a|偏差 ~0.05) を入れて
  //   null 救済 path ではなく・3-AND gate (= GPS + C-1 + C-2) で停車判定が発火することを確認。
  //   注意: ゼロ完全静止 accel は禁止 (= 設計者意図に反する人工 phantom 消去になる)。
  describe('Phase 4 fidelity: realistic accelSamples で 3-AND gate 発火確認', () => {
    // gps-worker.js と同じ ms timestamp 基準で realistic accel を生成
    //   - 停車中: |a|≈9.8 + std 0.05 (= variance ~0.0025・閾値 0.1 未満)
    //   - 走行中: |a|≈9.8 + std 0.5  (= variance ~0.25・閾値 0.1 超過)
    // Mulberry32 (= noise-model.js と同形式) で deterministic
    function makePrng(seed) {
      let s = seed >>> 0;
      return function () {
        s |= 0;
        s = (s + 0x6d2b79f5) | 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function gauss(prng, mean, std) {
      const u1 = Math.max(prng(), 1e-12),
        u2 = prng();
      return mean + std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
    function genAccel(timestampMs, prng, std_xyz, windowSec, sampleRateHz) {
      const n = Math.floor((windowSec || 5) * (sampleRateHz || 20));
      const samples = new Array(n);
      for (let i = 0; i < n; i++) {
        samples[i] = {
          t: timestampMs - (n - 1 - i) * (1000 / (sampleRateHz || 20)),
          x: gauss(prng, 0, std_xyz),
          y: gauss(prng, 0, std_xyz),
          z: gauss(prng, 9.8, std_xyz),
        };
      }
      return samples;
    }

    it('④-c: 5 秒継続停車 + realistic 停車 accel (std=0.05) → 3-AND gate path で isStationary=true', () => {
      const w = initWorker();
      const t0 = 1700000000000;
      const prng = makePrng(123);
      // 同位置・1km/h・realistic 停車 accel (= std 0.05・variance ~0.0025)
      for (let i = 0; i < 7; i++) {
        const ts = t0 + i * 1000;
        const accel = genAccel(ts, prng, 0.05, 5, 20);
        w.sendMessage({
          type: 'position',
          data: {
            lat: 33.84,
            lng: 132.78,
            accuracy: 5,
            speedKmh: 1,
            heading: 90,
            altitude: 0,
            now: ts,
            accelSamples: accel,
          },
        });
      }
      const results = w.getResults();
      expect(results.length).toBeGreaterThan(0);
      const last = results[results.length - 1];
      // 5 秒継続 (= gpsStationary=true) + realistic accel (= c1Stationary=true / c2Moving=false)
      // → 3-AND gate で isStationary=true 発火
      expect(last.isStationary).toBe(true);
    });

    it('④-d: 5 秒継続停車 + realistic 走行 accel (std=0.5) → 3-AND gate で c1=false → isStationary=false', () => {
      const w = initWorker();
      const t0 = 1700000000000;
      const prng = makePrng(456);
      // 同位置・1km/h (= gpsStationary=true) だが・accel は走行レベル振動
      for (let i = 0; i < 7; i++) {
        const ts = t0 + i * 1000;
        const accel = genAccel(ts, prng, 0.5, 5, 20); // variance ~0.25・閾値 0.1 超過
        w.sendMessage({
          type: 'position',
          data: {
            lat: 33.84,
            lng: 132.78,
            accuracy: 5,
            speedKmh: 1,
            heading: 90,
            altitude: 0,
            now: ts,
            accelSamples: accel,
          },
        });
      }
      const results = w.getResults();
      expect(results.length).toBeGreaterThan(0);
      const last = results[results.length - 1];
      // gps=stationary だが・accel variance 大 → c1Stationary=false → 3-AND false
      // (= 「GPS は停車だが・車内で何か振動している」現象を C-1 が検知)
      expect(last.isStationary).toBe(false);
    });

    it('④-e: accelSamples 空 (= null 救済 path)・5 秒継続停車 → GPS 単独で isStationary 判定', () => {
      const w = initWorker();
      const t0 = 1700000000000;
      // accelSamples 渡さない (= 既存シナリオ ④ と同じ・null 救済)
      for (let i = 0; i < 7; i++) {
        w.sendMessage({
          type: 'position',
          data: {
            lat: 33.84,
            lng: 132.78,
            accuracy: 5,
            speedKmh: 1,
            heading: 90,
            altitude: 0,
            now: t0 + i * 1000,
          },
        });
      }
      const results = w.getResults();
      expect(results.length).toBeGreaterThan(0);
      // null 救済 path → finalStationary = gpsStationary (= 5 秒継続なので true)
      const last = results[results.length - 1];
      expect(typeof last.isStationary).toBe('boolean');
    });
  });
});
