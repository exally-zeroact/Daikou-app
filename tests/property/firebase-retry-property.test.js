// tests/property/firebase-retry-property.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step ㉘ / 全32件)
//
// 検証対象: firebase.js retry queue の eventual consistency (= P1-⑦ 補完)
//   任意 failure pattern で RETRY_MAX_COUNT=5 以内に成功 or 確定 discard
//   queue monotonic (= 削除のみ・追加なし)
//
// 絶対ルール準拠:
//   js/firebase.js は触らない absolute・isolated 実装で property test。

const { fc, propertyAssert } = require('../../scripts/zeroact-test-commons/property-test-helpers');

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

describe('firebase retry property (㉘)', () => {
  it('F1: 任意 failure pattern で最終的に queue は空 (= eventual consistency)', async () => {
    await propertyAssert(
      fc.asyncProperty(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 15 }),
        async (failureSeq) => {
          const state = { _queue: [{ id: 1 }], _flushInProgress: false };
          let i = 0;
          const exec = async () => {
            if (failureSeq[i % failureSeq.length]) {
              i++;
              throw new Error('fail');
            }
            i++;
            return true;
          };
          for (let k = 0; k < 15 && state._queue.length > 0; k++) {
            state._queue.forEach((r) => {
              r.nextRetryAt = 0;
            });
            await isolatedFlushRetry(state, exec);
          }
          // 全 failure でも RETRY_MAX_COUNT 超で discard・全 success でも 1 回で削除
          // 必ず空または retryCount <= 5
          if (state._queue.length > 0) {
            if (state._queue[0].retryCount <= RETRY_MAX_COUNT) {
              throw new Error('eventual consistency 違反');
            }
          }
        }
      )
    );
  });

  it('F2: queue 状態は monotonic (= key 追加なし・削除のみ)', async () => {
    await propertyAssert(
      fc.asyncProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }), async (failure) => {
        const initial = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
        const state = { _queue: [...initial], _flushInProgress: false };
        const initIds = new Set(initial.map((r) => r.id));
        let i = 0;
        const exec = async () => {
          if (failure[i % failure.length]) {
            i++;
            throw new Error('fail');
          }
          i++;
          return true;
        };
        for (let k = 0; k < 10; k++) {
          state._queue.forEach((r) => {
            r.nextRetryAt = 0;
          });
          await isolatedFlushRetry(state, exec);
        }
        // 残った queue の id は全て初期 set の subset
        for (const r of state._queue) {
          if (!initIds.has(r.id)) {
            throw new Error('queue に新 id 追加検出: ' + r.id);
          }
        }
      })
    );
  });

  it('F3: backoff 配列 [0, 1000, 2000, 4000, 8000, 16000] 確認', () => {
    expect(RETRY_BACKOFF_MS).toEqual([0, 1000, 2000, 4000, 8000, 16000]);
    // exponential property: backoff[i+1] >= backoff[i]
    for (let i = 1; i < RETRY_BACKOFF_MS.length; i++) {
      expect(RETRY_BACKOFF_MS[i]).toBeGreaterThanOrEqual(RETRY_BACKOFF_MS[i - 1]);
    }
  });

  it('F4: retryCount <= RETRY_MAX_COUNT 不変条件', async () => {
    await propertyAssert(
      fc.asyncProperty(fc.integer({ min: 1, max: 15 }), async (n) => {
        const state = { _queue: [{ id: 1 }], _flushInProgress: false };
        const exec = async () => {
          throw new Error('always fail');
        };
        for (let k = 0; k < n; k++) {
          state._queue.forEach((r) => {
            r.nextRetryAt = 0;
          });
          await isolatedFlushRetry(state, exec);
        }
        // queue 内の retryCount は <= 5 (= RETRY_MAX_COUNT) or queue 空
        for (const r of state._queue) {
          if (r.retryCount > RETRY_MAX_COUNT) {
            throw new Error('retryCount > RETRY_MAX_COUNT 残留');
          }
        }
      })
    );
  });
});
