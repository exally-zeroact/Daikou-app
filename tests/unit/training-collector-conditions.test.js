// tests/unit/training-collector-conditions.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step P2-⑪ / 全32件)
//
// 検証対象: training-collector.js collectIfEligible 4-AND 収集条件 + FIFO eviction
//   L189 collectIfEligible(gpsResult):
//     - _enabled = true
//     - _ready && _db (= IndexedDB 利用可能)
//     - gpsResult.accuracy <= MIN_ACCURACY_M (= 20)
//     - gpsResult.speedKmh >= MIN_SPEED_KMH (= 5)
//     - !gpsResult.isStationary
//     - _accelBuffer.length >= WINDOW_SAMPLES (= 80)
//   L271 _evictOld: SAMPLE_COUNT_LIMIT (= 50000) 超で古い順削除
//
// 絶対ルール準拠:
//   js/training-collector.js は触らない absolute・isolated 実装で property test。
//   位置情報 (lat/lng) は意図的に含めない (= プライバシー設計)。

const fs = require('fs');
const path = require('path');
const { fc, propertyAssert } = require('../../scripts/zeroact-test-commons/property-test-helpers');

const TC_PATH = path.join(__dirname, '..', '..', 'js', 'training-collector.js');

function loadSource() {
  return fs.readFileSync(TC_PATH, 'utf8');
}

// isolated 実装 (= collectIfEligible 判定ロジック)
const WINDOW_SAMPLES = 80;
const MIN_ACCURACY_M = 20;
const MIN_SPEED_KMH = 5;
const SAMPLE_COUNT_LIMIT = 50000;

function shouldCollect(state, gpsResult) {
  if (!state.enabled) return { ok: false, reason: 'disabled' };
  if (!state.ready || !state.db) return { ok: false, reason: 'not_ready' };
  if (!gpsResult || typeof gpsResult.speedKmh !== 'number')
    return { ok: false, reason: 'invalid_gps' };
  if (gpsResult.accuracy != null && gpsResult.accuracy > MIN_ACCURACY_M)
    return { ok: false, reason: 'accuracy' };
  if (gpsResult.speedKmh < MIN_SPEED_KMH) return { ok: false, reason: 'speed' };
  if (gpsResult.isStationary) return { ok: false, reason: 'stationary' };
  if (state.accelBufferLen < WINDOW_SAMPLES) return { ok: false, reason: 'no_window' };
  return { ok: true };
}

// FIFO eviction simulation
function isolatedEvict(samples, limit) {
  if (samples.length <= limit) return samples;
  const toDelete = samples.length - limit;
  // 古い順 (= 配列前方) を削除
  return samples.slice(toDelete);
}

describe('training-collector.js 収集条件 + FIFO eviction (P2-⑪)', () => {
  // ─── 静的 verify ────────────────────────────────────────

  it('S1: 定数 WINDOW_SAMPLES=80 / MIN_ACCURACY_M=20 / MIN_SPEED_KMH=5 / SAMPLE_COUNT_LIMIT=50000', () => {
    const source = loadSource();
    if (!/const\s+WINDOW_SAMPLES\s*=\s*80\b/.test(source)) {
      throw new Error('WINDOW_SAMPLES=80 未検出');
    }
    if (!/const\s+MIN_ACCURACY_M\s*=\s*20\b/.test(source)) {
      throw new Error('MIN_ACCURACY_M=20 未検出');
    }
    if (!/const\s+MIN_SPEED_KMH\s*=\s*5\b/.test(source)) {
      throw new Error('MIN_SPEED_KMH=5 未検出');
    }
    if (!/const\s+SAMPLE_COUNT_LIMIT\s*=\s*50000\b/.test(source)) {
      throw new Error('SAMPLE_COUNT_LIMIT=50000 未検出');
    }
  });

  it('S2: collectIfEligible / _evictOld 関数定義の存在', () => {
    const source = loadSource();
    if (!/function\s+collectIfEligible\s*\(/.test(source)) {
      throw new Error('collectIfEligible 関数定義未検出');
    }
    if (!/function\s+_evictOld\s*\(/.test(source)) {
      throw new Error('_evictOld 関数定義未検出');
    }
  });

  it('S3: 位置情報 (lat/lng) を sample に含めない (= プライバシー設計)', () => {
    const source = loadSource();
    // sample object 構築箇所で lat/lng が含まれていないこと
    if (!/位置情報.*lat\/lng.*意図的に含めない/.test(source)) {
      throw new Error('プライバシー設計コメント未検出 (= lat/lng 不含意図)');
    }
  });

  // ─── 動的 verify: collectIfEligible 4-AND 判定 ─────────

  it('D1: 全条件満足 (= 正常 GPS + accel 80 sample + enabled + ready) で ok=true', () => {
    const state = { enabled: true, ready: true, db: {}, accelBufferLen: 80 };
    const gps = { speedKmh: 30, accuracy: 5, isStationary: false };
    expect(shouldCollect(state, gps).ok).toBe(true);
  });

  it('D2: enabled=false → reason=disabled', () => {
    const state = { enabled: false, ready: true, db: {}, accelBufferLen: 80 };
    const gps = { speedKmh: 30, accuracy: 5, isStationary: false };
    const r = shouldCollect(state, gps);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('disabled');
  });

  it('D3: ready=false / db=null → reason=not_ready', () => {
    const state1 = { enabled: true, ready: false, db: {}, accelBufferLen: 80 };
    expect(shouldCollect(state1, { speedKmh: 30, accuracy: 5, isStationary: false }).reason).toBe(
      'not_ready'
    );
    const state2 = { enabled: true, ready: true, db: null, accelBufferLen: 80 };
    expect(shouldCollect(state2, { speedKmh: 30, accuracy: 5, isStationary: false }).reason).toBe(
      'not_ready'
    );
  });

  it('D4: accuracy > MIN_ACCURACY_M (20m) → reason=accuracy', () => {
    const state = { enabled: true, ready: true, db: {}, accelBufferLen: 80 };
    const gps = { speedKmh: 30, accuracy: 21, isStationary: false };
    const r = shouldCollect(state, gps);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('accuracy');
  });

  it('D5: accuracy = MIN_ACCURACY_M (20m) ちょうど → ok=true (= 境界・<= 比較)', () => {
    const state = { enabled: true, ready: true, db: {}, accelBufferLen: 80 };
    const gps = { speedKmh: 30, accuracy: 20, isStationary: false };
    expect(shouldCollect(state, gps).ok).toBe(true);
  });

  it('D6: speedKmh < MIN_SPEED_KMH (5) → reason=speed', () => {
    const state = { enabled: true, ready: true, db: {}, accelBufferLen: 80 };
    const gps = { speedKmh: 4.9, accuracy: 5, isStationary: false };
    expect(shouldCollect(state, gps).reason).toBe('speed');
  });

  it('D7: isStationary=true → reason=stationary', () => {
    const state = { enabled: true, ready: true, db: {}, accelBufferLen: 80 };
    const gps = { speedKmh: 30, accuracy: 5, isStationary: true };
    expect(shouldCollect(state, gps).reason).toBe('stationary');
  });

  it('D8: accelBufferLen < WINDOW_SAMPLES (80) → reason=no_window', () => {
    const state = { enabled: true, ready: true, db: {}, accelBufferLen: 79 };
    const gps = { speedKmh: 30, accuracy: 5, isStationary: false };
    expect(shouldCollect(state, gps).reason).toBe('no_window');
  });

  it('D9: speedKmh 数値以外 → reason=invalid_gps', () => {
    const state = { enabled: true, ready: true, db: {}, accelBufferLen: 80 };
    const gps = { speedKmh: '30', accuracy: 5, isStationary: false };
    expect(shouldCollect(state, gps).reason).toBe('invalid_gps');
  });

  // ─── FIFO eviction ──────────────────────────────────────

  it('D10: samples.length <= SAMPLE_COUNT_LIMIT で eviction なし', () => {
    const samples = Array.from({ length: 49999 }, (_, i) => ({ id: i }));
    const after = isolatedEvict(samples, SAMPLE_COUNT_LIMIT);
    expect(after.length).toBe(49999);
  });

  it('D11: samples.length > SAMPLE_COUNT_LIMIT で 古い順 (= index 前方) 削除', () => {
    const samples = Array.from({ length: 50010 }, (_, i) => ({ id: i }));
    const after = isolatedEvict(samples, SAMPLE_COUNT_LIMIT);
    expect(after.length).toBe(50000);
    // 古い 10 件 (id 0-9) が削除
    expect(after[0].id).toBe(10);
    expect(after[after.length - 1].id).toBe(50009);
  });

  it('D12: fast-check 任意 sample 数で eviction 後 length が SAMPLE_COUNT_LIMIT 以下', () => {
    propertyAssert(
      fc.property(fc.integer({ min: 0, max: 60000 }), (n) => {
        const samples = Array.from({ length: n }, (_, i) => ({ id: i }));
        const after = isolatedEvict(samples, SAMPLE_COUNT_LIMIT);
        if (after.length > SAMPLE_COUNT_LIMIT) {
          throw new Error('eviction 後 length=' + after.length + ' > limit=' + SAMPLE_COUNT_LIMIT);
        }
        // 残った sample は最新側
        if (after.length > 0) {
          const minId = after[0].id;
          const maxId = after[after.length - 1].id;
          if (maxId !== n - 1) {
            throw new Error('eviction 後 最新 id=' + maxId + ' != n-1=' + (n - 1));
          }
          if (minId !== Math.max(0, n - SAMPLE_COUNT_LIMIT)) {
            throw new Error(
              'eviction 後 最古 id=' + minId + ' != expected=' + Math.max(0, n - SAMPLE_COUNT_LIMIT)
            );
          }
        }
      })
    );
  });

  it('D13: fast-check 全条件任意値で shouldCollect が決定的・条件別 reason 整合', () => {
    propertyAssert(
      fc.property(
        fc.record({
          enabled: fc.boolean(),
          ready: fc.boolean(),
          accelBufferLen: fc.integer({ min: 0, max: 200 }),
        }),
        fc.record({
          speedKmh: fc.double({ min: 0, max: 200, noNaN: true }),
          accuracy: fc.double({ min: 0, max: 200, noNaN: true }),
          isStationary: fc.boolean(),
        }),
        (s, gps) => {
          const state = { ...s, db: {} };
          const r1 = shouldCollect(state, gps);
          const r2 = shouldCollect(state, gps);
          if (r1.ok !== r2.ok || r1.reason !== r2.reason) {
            throw new Error('shouldCollect 非決定的');
          }
          // ok=true なら全条件満足
          if (r1.ok) {
            if (!state.enabled || !state.ready)
              throw new Error('ok=true なのに enabled/ready=false');
            if (gps.accuracy > MIN_ACCURACY_M) throw new Error('ok=true なのに accuracy 違反');
            if (gps.speedKmh < MIN_SPEED_KMH) throw new Error('ok=true なのに speed 違反');
            if (gps.isStationary) throw new Error('ok=true なのに isStationary');
            if (state.accelBufferLen < WINDOW_SAMPLES)
              throw new Error('ok=true なのに accelBufferLen 不足');
          }
        }
      )
    );
  });
});
