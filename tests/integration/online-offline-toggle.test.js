// tests/integration/online-offline-toggle.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step ㉕ / 全32件)
//
// 検証対象: navigator.onLine 切替時の firebase.js 動作
//   オフライン⇄オンライン連続切替で retry queue 重複防止
//   ★OSRM (osrm-client.js) は 2026-06-20 廃止済 → S4/S6 削除★
//
// 絶対ルール準拠:
//   js/firebase.js は触らない absolute・静的 + isolated 検証。

const fs = require('fs');
const path = require('path');

const FB_PATH = path.join(__dirname, '..', '..', 'js', 'firebase.js');

describe('online/offline 切替動作 (㉕)', () => {
  it('S1: firebase.js に online/offline event listener', () => {
    const src = fs.readFileSync(FB_PATH, 'utf8');
    if (!/addEventListener\s*\(\s*['"]online['"]/.test(src)) {
      throw new Error('firebase.js online listener 未検出');
    }
    if (!/addEventListener\s*\(\s*['"]offline['"]/.test(src)) {
      throw new Error('firebase.js offline listener 未検出');
    }
  });

  it('S2: firebase.js online 復帰時に _flushRetryQueue が呼ばれる', () => {
    const src = fs.readFileSync(FB_PATH, 'utf8');
    // online listener 内で _flushRetryQueue 呼出
    if (!/online.*_flushRetryQueue/s.test(src)) {
      // 順序が違う場合は別 pattern で確認
      const onlineMatch = src.match(/addEventListener\s*\(\s*['"]online['"][^]*?\}\s*\)/);
      if (!onlineMatch || !/_flushRetryQueue/.test(onlineMatch[0])) {
        throw new Error('online listener 内 _flushRetryQueue 呼出未検出');
      }
    }
  });

  it('S3: firebase.js offline 時 isOnline=false セット', () => {
    const src = fs.readFileSync(FB_PATH, 'utf8');
    const offlineMatch = src.match(/addEventListener\s*\(\s*['"]offline['"][^]*?\}\s*\)/);
    if (!offlineMatch || !/isOnline\s*=\s*false/.test(offlineMatch[0])) {
      throw new Error('offline listener 内 isOnline=false 未検出');
    }
  });

  it('S5: firebase.js _flushInProgress フラグで同時 flush 防止', () => {
    const src = fs.readFileSync(FB_PATH, 'utf8');
    if (!/_flushInProgress/.test(src)) {
      throw new Error('_flushInProgress 同時実行ガード未検出');
    }
  });
});
