// tests/integration/firebase-retry-queue.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step P1-⑦ / 全32件)
//
// 検証対象: firebase.js 送信失敗 retry queue (P0 Step 2 設計・L22-178)
//   RETRY_DB_NAME = 'daikome_retry'
//   RETRY_MAX_COUNT = 5
//   RETRY_BACKOFF_MS = [0, 1000, 2000, 4000, 8000, 16000]
//   _flushRetryQueue: 失敗 → retryCount++ → RETRY_MAX_COUNT 超で確定 discard
//
// 検証手法:
//   ① 静的 verify: 実 firebase.js の定数 + 関数定義の存在
//   ② 動的 verify: ロジックを isolated 抽出して property test で任意 failure pattern 網羅
//
// 絶対ルール準拠:
//   js/firebase.js は触らない absolute。fake IndexedDB は使わず in-memory queue で simulate。

const fs = require('fs');
const path = require('path');
const { fc, propertyAssert } = require('../../scripts/zeroact-test-commons/property-test-helpers');

const FIREBASE_JS_PATH = path.join(__dirname, '..', '..', 'js', 'firebase.js');

function loadSource() {
  return fs.readFileSync(FIREBASE_JS_PATH, 'utf8');
}

// firebase.js _flushRetryQueue ロジックの isolated 実装 (verified 2026-05-18)
//   実コード (L152-178) と論理的等価。静的 verify でドリフトを検出。
const RETRY_MAX_COUNT = 5;
const RETRY_BACKOFF_MS = [0, 1000, 2000, 4000, 8000, 16000];

async function isolatedFlushRetry(state, executeRetry) {
  if (state._flushInProgress) return;
  state._flushInProgress = true;
  try {
    const now = Date.now();
    const due = state._queue.filter((r) => (r.nextRetryAt || 0) <= now);
    for (const record of due) {
      try {
        await executeRetry(record);
        state._queue = state._queue.filter((r) => r.id !== record.id);
      } catch (_e) {
        record.retryCount = (record.retryCount || 0) + 1;
        if (record.retryCount > RETRY_MAX_COUNT) {
          state._queue = state._queue.filter((r) => r.id !== record.id);
        } else {
          record.nextRetryAt = Date.now() + (RETRY_BACKOFF_MS[record.retryCount] || 16000);
        }
      }
    }
  } finally {
    state._flushInProgress = false;
  }
}

describe('firebase.js retry queue 動作検証 (P1-⑦)', () => {
  // ─── ① 静的 verify (= 定数 + 関数定義の存在) ─────────────────

  it('S1: RETRY_MAX_COUNT = 5 が firebase.js 内に定義されている', () => {
    const source = loadSource();
    if (!/const\s+RETRY_MAX_COUNT\s*=\s*5\b/.test(source)) {
      throw new Error('firebase.js に RETRY_MAX_COUNT = 5 定数定義未検出 (drift)');
    }
  });

  it('S2: RETRY_BACKOFF_MS = [0, 1000, 2000, 4000, 8000, 16000] が定義されている', () => {
    const source = loadSource();
    if (
      !/RETRY_BACKOFF_MS\s*=\s*\[\s*0\s*,\s*1000\s*,\s*2000\s*,\s*4000\s*,\s*8000\s*,\s*16000\s*\]/.test(
        source
      )
    ) {
      throw new Error(
        'firebase.js に exponential backoff 配列 [0,1000,2000,4000,8000,16000] 未検出'
      );
    }
  });

  it('S3: _flushRetryQueue 関数が定義されている (= export 経由で debug 利用)', () => {
    const source = loadSource();
    if (!/async\s+function\s+_flushRetryQueue\s*\(/.test(source)) {
      throw new Error('firebase.js に async function _flushRetryQueue 定義未検出');
    }
  });

  it('S4: window online/offline event listener が登録されている (= 復帰時 flush)', () => {
    const source = loadSource();
    if (!/addEventListener\s*\(\s*['"]online['"]/.test(source)) {
      throw new Error('firebase.js に online event listener 未検出');
    }
    if (!/addEventListener\s*\(\s*['"]offline['"]/.test(source)) {
      throw new Error('firebase.js に offline event listener 未検出');
    }
  });

  // ★★2026-08-30 直し（料金表の 引っ越し）★★
  //   料金表(saveFareConfig)は ★Supabase へ 引っ越しました★（司さん「Firebaseは2度と使うな」）。
  //   ⇒ 再送の 待ち行列に 残るのは ★勤務の 開始と 終わりの 2つ★です。
  //   ★数を 3 のままに しておくと「消し忘れ」に 気づけません★ので 2 に 直します。
  it('S5: _enqueueRetry が startSession / endSession の 失敗時に 呼ばれる', () => {
    const source = loadSource();
    const calls = source.match(/_enqueueRetry\s*\(\s*['"]\w+['"]/g) || [];
    if (calls.length < 2) {
      throw new Error('firebase.js に _enqueueRetry 呼出が 2 件未満: ' + calls.length);
    }
    // ★料金表が 戻ってきていない事★も 見る（両方の倉庫に 二重に 入るのを 防ぐ）
    if (/saveFareConfig/.test(source.replace(/^\s*\/\/.*$/gm, ''))) {
      throw new Error('★料金表が Firebase に 戻っています（2026-08-30 に 引っ越し済み）★');
    }
  });

  // ─── ② 動的 property test (= isolated ロジックで任意 failure pattern 検証) ──

  it('D1: 1 回目で成功 → queue から削除される', async () => {
    const state = {
      _queue: [{ id: 1, type: 'startSession', payload: {} }],
      _flushInProgress: false,
    };
    const executeRetry = async () => true;
    await isolatedFlushRetry(state, executeRetry);
    expect(state._queue.length).toBe(0);
  });

  it('D2: 1 回失敗 → retryCount=1 + nextRetryAt が backoff[1]=1000ms 後にセット', async () => {
    const state = {
      _queue: [{ id: 1, type: 'startSession', payload: {} }],
      _flushInProgress: false,
    };
    const executeRetry = async () => {
      throw new Error('fail');
    };
    const before = Date.now();
    await isolatedFlushRetry(state, executeRetry);
    expect(state._queue.length).toBe(1);
    expect(state._queue[0].retryCount).toBe(1);
    expect(state._queue[0].nextRetryAt).toBeGreaterThanOrEqual(before + 1000);
    expect(state._queue[0].nextRetryAt).toBeLessThan(before + 1500);
  });

  it('D3: 5 回失敗 → retryCount=5 で queue に残る (= まだ retry 余地あり)', async () => {
    const state = {
      _queue: [{ id: 1, type: 'startSession', payload: {} }],
      _flushInProgress: false,
    };
    const executeRetry = async () => {
      throw new Error('fail');
    };
    // 5 回失敗 (nextRetryAt を毎回 過去に戻して即実行)
    for (let i = 0; i < 5; i++) {
      state._queue.forEach((r) => (r.nextRetryAt = 0));
      await isolatedFlushRetry(state, executeRetry);
    }
    expect(state._queue.length).toBe(1);
    expect(state._queue[0].retryCount).toBe(5);
  });

  it('D4: 6 回失敗 → retryCount > RETRY_MAX_COUNT で確定 discard', async () => {
    const state = {
      _queue: [{ id: 1, type: 'startSession', payload: {} }],
      _flushInProgress: false,
    };
    const executeRetry = async () => {
      throw new Error('fail');
    };
    for (let i = 0; i < 6; i++) {
      state._queue.forEach((r) => (r.nextRetryAt = 0));
      await isolatedFlushRetry(state, executeRetry);
    }
    expect(state._queue.length).toBe(0); // 6 回目で discard
  });

  it('D5: nextRetryAt 未来時刻なら due に含まれない (= 早期 return)', async () => {
    const future = Date.now() + 60000;
    const state = {
      _queue: [{ id: 1, type: 'startSession', payload: {}, nextRetryAt: future }],
      _flushInProgress: false,
    };
    const executeRetry = async () => true;
    await isolatedFlushRetry(state, executeRetry);
    // 未到来 entry は処理されない
    expect(state._queue.length).toBe(1);
    expect(state._queue[0].nextRetryAt).toBe(future);
  });

  it('D6: _flushInProgress=true なら同時実行を防ぐ (= 早期 return)', async () => {
    const state = { _queue: [{ id: 1 }], _flushInProgress: true };
    const executeRetry = async () => true;
    await isolatedFlushRetry(state, executeRetry);
    // _flushInProgress=true なら queue 変更なし
    expect(state._queue.length).toBe(1);
  });

  it('D7: fast-check 任意 failure pattern で eventual consistency', () => {
    return new Promise((resolve, reject) => {
      try {
        propertyAssert(
          fc.asyncProperty(
            fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }),
            async (failurePattern) => {
              const state = {
                _queue: [{ id: 1, type: 'startSession', payload: {} }],
                _flushInProgress: false,
              };
              let idx = 0;
              const executeRetry = async () => {
                if (failurePattern[idx % failurePattern.length]) {
                  idx++;
                  throw new Error('simulated');
                }
                idx++;
                return true;
              };
              // 最大 10 回 retry
              for (let i = 0; i < 10; i++) {
                state._queue.forEach((r) => (r.nextRetryAt = 0));
                await isolatedFlushRetry(state, executeRetry);
                if (state._queue.length === 0) break;
              }
              // 結果: queue は必ず空になる (= 成功 or RETRY_MAX_COUNT 超 discard)
              if (state._queue.length > 0 && state._queue[0].retryCount <= RETRY_MAX_COUNT) {
                throw new Error(
                  'queue 残留 + retryCount=' +
                    state._queue[0].retryCount +
                    ' (= 10 回試行内に削除されず・eventual consistency 違反)'
                );
              }
            }
          )
        ).then(resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
  });

  it('D8: queue 状態が monotonic (= key 削除のみ・追加なし) で動作する', async () => {
    const initialQueue = [
      { id: 1, type: 'a' },
      { id: 2, type: 'b' },
      { id: 3, type: 'c' },
    ];
    const state = { _queue: [...initialQueue], _flushInProgress: false };
    const initialIds = new Set(state._queue.map((r) => r.id));
    const executeRetry = async (r) => {
      if (r.id === 2) throw new Error('fail');
      return true;
    };
    await isolatedFlushRetry(state, executeRetry);
    // 残った entry の id は initial set の subset
    for (const r of state._queue) {
      expect(initialIds.has(r.id)).toBe(true);
    }
    // queue は削除のみ・新 id は追加されない
    expect(state._queue.length).toBeLessThanOrEqual(initialQueue.length);
  });
});
