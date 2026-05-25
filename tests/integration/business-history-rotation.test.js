// tests/integration/business-history-rotation.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step ㉓ / 全32件)
//
// 検証対象: business.js business_history 30 日 rotation
//   HISTORY_KEY = 'daikou_business_history'
//   RETENTION_DAYS = 30
//   _appendHistory: 30 日 cutoff で古い entry 削除
//
// 絶対ルール準拠:
//   js/business.js は触らない absolute・既存 business.test.js と同じ sandbox pattern。

const fs = require('fs');
const path = require('path');

const BUSINESS_JS_PATH = path.join(__dirname, '..', '..', 'js', 'business.js');
const BUSINESS_JS_SOURCE = fs.readFileSync(BUSINESS_JS_PATH, 'utf8');

function makeLS() {
  const store = Object.create(null);
  return {
    getItem(k) {
      return store[k] || null;
    },
    setItem(k, v) {
      store[k] = String(v);
    },
    removeItem(k) {
      delete store[k];
    },
    clear() {
      for (const k of Object.keys(store)) delete store[k];
    },
    key(i) {
      return Object.keys(store)[i] || null;
    },
    get length() {
      return Object.keys(store).length;
    },
    _raw: store,
  };
}

function loadBusiness(meter) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.Meter = meter || {
    getState: () => ({ distance_m: 0, business_distance_m: 0, running: false }),
    setDistance: () => {},
    setBusinessDistance: () => {},
    getNearestAddress: () => null,
  };
  sandbox.localStorage = makeLS();
  sandbox.dlog = () => {};
  sandbox.console = console;
  const fn = new Function(
    'window',
    'Meter',
    'localStorage',
    'dlog',
    'console',
    BUSINESS_JS_SOURCE + '\n;return window.Business;'
  );
  return {
    Business: fn(sandbox, sandbox.Meter, sandbox.localStorage, sandbox.dlog, sandbox.console),
    ls: sandbox.localStorage,
  };
}

describe('business.js history 30 日 rotation (㉓)', () => {
  it('S1: HISTORY_KEY = daikou_business_history / RETENTION_DAYS = 30', () => {
    if (!/HISTORY_KEY\s*=\s*['"]daikou_business_history['"]/.test(BUSINESS_JS_SOURCE)) {
      throw new Error('HISTORY_KEY 定数未検出');
    }
    if (!/RETENTION_DAYS\s*=\s*30\b/.test(BUSINESS_JS_SOURCE)) {
      throw new Error('RETENTION_DAYS=30 未検出');
    }
  });

  it('S2: RETENTION_MS = 30 × 24 × 60 × 60 × 1000 計算', () => {
    if (!/RETENTION_MS\s*=\s*RETENTION_DAYS\s*\*\s*24/.test(BUSINESS_JS_SOURCE)) {
      throw new Error('RETENTION_MS 計算式未検出');
    }
  });

  it('S3: _appendHistory + Date.now() - RETENTION_MS cutoff 経路', () => {
    if (!/Date\.now\s*\(\s*\)\s*-\s*RETENTION_MS/.test(BUSINESS_JS_SOURCE)) {
      throw new Error('RETENTION_MS cutoff 計算未検出');
    }
  });

  it('D1: end → abandon で history に entry 追加', () => {
    const { Business, ls } = loadBusiness();
    Business.start();
    Business.end();
    Business.abandon(); // history に push
    const history = JSON.parse(ls.getItem('daikou_business_history') || '[]');
    expect(history.length).toBeGreaterThan(0);
  });

  it('D2: 31 日経過した古い entry は cutoff で削除される', () => {
    const { Business, ls } = loadBusiness();
    // 古い entry (= 31 日前) を localStorage に手動セット
    const oldEntry = {
      start_time: Date.now() - 31 * 24 * 60 * 60 * 1000,
      end_time: Date.now() - 30.5 * 24 * 60 * 60 * 1000,
      total_distance_m: 1000,
      fare_total_yen: 1300,
    };
    ls.setItem('daikou_business_history', JSON.stringify([oldEntry]));

    // 新規 business で _appendHistory が走ると cutoff で古い entry 削除
    Business.start();
    Business.end();
    Business.abandon();

    const history = JSON.parse(ls.getItem('daikou_business_history') || '[]');
    // 古い entry は削除・新 entry のみ残る
    const hasOldEntry = history.some((e) => e.start_time === oldEntry.start_time);
    expect(hasOldEntry).toBe(false);
  });

  it('D3: 29 日前の entry は cutoff で残る', () => {
    const { Business, ls } = loadBusiness();
    const recentEntry = {
      start_time: Date.now() - 29 * 24 * 60 * 60 * 1000,
      end_time: Date.now() - 29 * 24 * 60 * 60 * 1000 + 3600000,
      total_distance_m: 1000,
      fare_total_yen: 1300,
    };
    ls.setItem('daikou_business_history', JSON.stringify([recentEntry]));
    Business.start();
    Business.end();
    Business.abandon();
    const history = JSON.parse(ls.getItem('daikou_business_history') || '[]');
    const hasRecent = history.some((e) => e.start_time === recentEntry.start_time);
    expect(hasRecent).toBe(true);
  });

  it('D4: JSON parse error 時の安全フォールバック (= history=[])', () => {
    const { Business, ls } = loadBusiness();
    ls.setItem('daikou_business_history', 'not valid json');
    Business.start();
    Business.end();
    expect(() => Business.abandon()).not.toThrow();
  });

  it('D5: 複数 entry 累積 (= push 順序維持)', () => {
    const { Business, ls } = loadBusiness();
    for (let i = 0; i < 3; i++) {
      Business.start();
      Business.end();
      Business.abandon();
    }
    const history = JSON.parse(ls.getItem('daikou_business_history') || '[]');
    expect(history.length).toBe(3);
  });
});
