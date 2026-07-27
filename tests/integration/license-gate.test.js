// tests/integration/license-gate.test.js
//
// ★設計変更宣言 (2026-05-24・端末ライセンス台数ロック・案 C):
//   js/license.js の・public API verify。
//   ・device_id は・既存 DAIKOME_DEVICE_ID (= debug-trace.js) を・流用
//   ・状態: licensed / grace / expired / unregistered / unknown
//   ・cache: localStorage 'DAIKOME_LICENSE_CACHE'
//   ・grace period: 7 日
//
// 絶対ルール準拠:
//   ✓ distance_m / 課金距離ロジック / Meter / Worker B: 完全無関係
//   ✓ debug-trace.js 同 key (= 'DAIKOME_DEVICE_ID') を・流用・新規生成なし

'use strict';

const path = require('path');
const fs = require('fs');

let License;
let mockLocalStorage;

function _setupLocalStorage() {
  const store = {};
  mockLocalStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
    clear: () => {
      Object.keys(store).forEach((k) => delete store[k]);
    },
    _store: store,
  };
  global.localStorage = mockLocalStorage;
}

beforeAll(() => {
  _setupLocalStorage();
  // crypto.randomUUID polyfill
  if (typeof global.crypto === 'undefined' || typeof global.crypto.randomUUID === 'undefined') {
    global.crypto = {
      randomUUID: () => 'test-uuid-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10),
    };
  }
  // fetch mock (= network 失敗 emulate・navigator は・既存利用)
  global.fetch = function () {
    return Promise.reject(new Error('mock network fail'));
  };
  delete require.cache[require.resolve(path.join('..', '..', 'js', 'license.js'))];
  License = require(path.join('..', '..', 'js', 'license.js'));
});

beforeEach(() => {
  mockLocalStorage.clear();
});

describe('1. device_id 流用 (= 既存 DAIKOME_DEVICE_ID)', () => {
  it('既存 DAIKOME_DEVICE_ID あれば・流用 (= 新規生成しない)', () => {
    mockLocalStorage.setItem('DAIKOME_DEVICE_ID', 'existing-device-uuid-1234');
    const id = License.getDeviceId();
    expect(id).toBe('existing-device-uuid-1234');
  });

  it('既存 DAIKOME_DEVICE_ID なし → 初回生成・localStorage 永続', () => {
    const id1 = License.getDeviceId();
    expect(id1).toBeTruthy();
    expect(mockLocalStorage.getItem('DAIKOME_DEVICE_ID')).toBe(id1);
    // 2 回目呼出も・同 ID
    const id2 = License.getDeviceId();
    expect(id2).toBe(id1);
  });
});

describe('2. 状態判定 (= getState・期限内/grace/expired/unregistered/unknown)', () => {
  it('cache なし → state: unknown', () => {
    const s = License.getState();
    expect(s.state).toBe('unknown');
  });

  it('cache licensed=false → state: unregistered', () => {
    mockLocalStorage.setItem(
      'DAIKOME_LICENSE_CACHE',
      JSON.stringify({ licensed: false, expires_at: 0, last_check: Date.now() })
    );
    const s = License.getState();
    expect(s.state).toBe('unregistered');
  });

  it('cache licensed=true + 期限内 → state: licensed', () => {
    const future = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 日先
    mockLocalStorage.setItem(
      'DAIKOME_LICENSE_CACHE',
      JSON.stringify({ licensed: true, expires_at: future, last_check: Date.now() })
    );
    const s = License.getState();
    expect(s.state).toBe('licensed');
    expect(s.expires_at).toBe(future);
  });

  it('cache licensed=true + 期限超過 + grace 内 (= 3 日経過) → state: grace', () => {
    const past3days = Date.now() - 3 * 24 * 60 * 60 * 1000;
    mockLocalStorage.setItem(
      'DAIKOME_LICENSE_CACHE',
      JSON.stringify({ licensed: true, expires_at: past3days, last_check: past3days })
    );
    const s = License.getState();
    expect(s.state).toBe('grace');
    expect(s.expires_at).toBe(past3days);
    expect(s.grace_ends_at).toBe(past3days + 7 * 24 * 60 * 60 * 1000);
  });

  it('cache licensed=true + 期限超過 + grace 超過 (= 10 日経過) → state: expired', () => {
    const past10days = Date.now() - 10 * 24 * 60 * 60 * 1000;
    mockLocalStorage.setItem(
      'DAIKOME_LICENSE_CACHE',
      JSON.stringify({ licensed: true, expires_at: past10days, last_check: past10days })
    );
    const s = License.getState();
    expect(s.state).toBe('expired');
  });
});

describe('3. checkBeforeBusinessStart (= 業務開始 gate 判定)', () => {
  it('licensed → allowed: true', () => {
    const future = Date.now() + 30 * 24 * 60 * 60 * 1000;
    mockLocalStorage.setItem(
      'DAIKOME_LICENSE_CACHE',
      JSON.stringify({ licensed: true, expires_at: future, last_check: Date.now() })
    );
    const r = License.checkBeforeBusinessStart();
    expect(r.allowed).toBe(true);
    expect(r.state).toBe('licensed');
  });

  it('grace → allowed: true (= 稼働継続・但しメッセージ付き)', () => {
    const past3days = Date.now() - 3 * 24 * 60 * 60 * 1000;
    mockLocalStorage.setItem(
      'DAIKOME_LICENSE_CACHE',
      JSON.stringify({ licensed: true, expires_at: past3days, last_check: past3days })
    );
    const r = License.checkBeforeBusinessStart();
    expect(r.allowed).toBe(true);
    expect(r.state).toBe('grace');
    expect(r.message).toContain('grace');
  });

  it('expired → allowed: false (= 業務開始 block)', () => {
    const past10days = Date.now() - 10 * 24 * 60 * 60 * 1000;
    mockLocalStorage.setItem(
      'DAIKOME_LICENSE_CACHE',
      JSON.stringify({ licensed: true, expires_at: past10days, last_check: past10days })
    );
    const r = License.checkBeforeBusinessStart();
    expect(r.allowed).toBe(false);
    expect(r.state).toBe('expired');
  });

  it('unregistered → allowed: false (= 「この端末は未登録です」)', () => {
    mockLocalStorage.setItem(
      'DAIKOME_LICENSE_CACHE',
      JSON.stringify({ licensed: false, expires_at: 0, last_check: Date.now() })
    );
    const r = License.checkBeforeBusinessStart();
    expect(r.allowed).toBe(false);
    expect(r.state).toBe('unregistered');
    expect(r.message).toContain('未登録');
  });

  it('unknown (= 初回・cache なし) → allowed: false (= 初回 online 認証要)', () => {
    const r = License.checkBeforeBusinessStart();
    expect(r.allowed).toBe(false);
    expect(r.state).toBe('unknown');
  });
});

describe('4. オフライン cache (= network 失敗時・既存 cache 利用)', () => {
  it('online check 失敗時・cache 既存なら・既存 cache の state 維持', async () => {
    const future = Date.now() + 30 * 24 * 60 * 60 * 1000;
    mockLocalStorage.setItem(
      'DAIKOME_LICENSE_CACHE',
      JSON.stringify({ licensed: true, expires_at: future, last_check: Date.now() })
    );
    // navigator.onLine = false (= setup で設定済) → init は・promise 即 resolve・cache 更新なし
    const s = await License.init();
    expect(s.state).toBe('licensed');
    // cache そのまま
    const cache = License.getCache();
    expect(cache.licensed).toBe(true);
    expect(cache.expires_at).toBe(future);
  });
});

describe('5. source 静的 verify (= 既存 device_id 流用・1 byte 不変)', () => {
  let licenseSrc;
  beforeAll(() => {
    licenseSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'license.js'), 'utf8');
  });

  it('DEVICE_ID_KEY = "DAIKOME_DEVICE_ID" (= debug-trace.js と同 key)', () => {
    expect(licenseSrc).toMatch(/const DEVICE_ID_KEY\s*=\s*['"]DAIKOME_DEVICE_ID['"]/);
  });

  it('GRACE_PERIOD_MS = 7 日 (= 7 * 24 * 60 * 60 * 1000)', () => {
    expect(licenseSrc).toMatch(/GRACE_PERIOD_MS\s*=\s*7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });

  it('Supabase URL + dk_check_device_license RPC (= Exally倉庫 dk_棚・2026-06-28移行)', () => {
    expect(licenseSrc).toMatch(/tnfwipbgfgjaymlszeid\.supabase\.co/);
    expect(licenseSrc).toMatch(/dk_check_device_license/);
    // Firebase RTDB は撤去済
    expect(licenseSrc).not.toMatch(/daikou-app-c821a-default-rtdb/);
  });

  it('課金距離ロジックに・触れていない (= 実コード行で・distance_m / business_distance_m 不参照)', () => {
    // コメント行 (= // 以降) を除外して・実コードのみ check
    const codeLines = licenseSrc
      .split('\n')
      .map((l) => l.split('//')[0])
      .join('\n');
    expect(codeLines).not.toMatch(/state\.distance_m/);
    expect(codeLines).not.toMatch(/state\.business_distance_m/);
    expect(codeLines).not.toMatch(/mmIncrementM/);
    expect(codeLines).not.toMatch(/Meter\.[a-z]/);
    expect(codeLines).not.toMatch(/map-matcher/);
  });

  it('debug-trace.js の・device_id 生成ロジック・1 byte 不変 verify', () => {
    const traceSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'js', 'debug-trace.js'),
      'utf8'
    );
    // 既存の DEVICE_ID_KEY 定義行を期待
    expect(traceSrc).toMatch(/const DEVICE_ID_KEY\s*=\s*['"]DAIKOME_DEVICE_ID['"]/);
    // 既存の 初回生成ロジック (= crypto.randomUUID fallback) を期待
    expect(traceSrc).toMatch(/crypto\.randomUUID/);
  });
});

describe('6. index.html 配線 verify (= script load + onBusinessStart gate + overlay)', () => {
  let html;
  beforeAll(() => {
    html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  });

  it('script src="js/license.js" を・load', () => {
    expect(html).toMatch(/<script src="js\/license\.js"><\/script>/);
  });

  it('onBusinessStart 内で・window.License.checkBeforeBusinessStart 呼出', () => {
    expect(html).toMatch(/window\.License\.checkBeforeBusinessStart/);
  });

  it('未登録時・window.showLicenseGate を・呼出', () => {
    expect(html).toMatch(/window\.showLicenseGate\(_lic\)/);
  });

  it('overlayLicenseGate element + licenseGateDeviceId span 存在', () => {
    expect(html).toMatch(/id="overlayLicenseGate"/);
    expect(html).toMatch(/id="licenseGateDeviceId"/);
  });

  it('showLicenseGate / hideLicenseGate 関数定義あり', () => {
    expect(html).toMatch(/window\.showLicenseGate\s*=\s*function/);
    expect(html).toMatch(/window\.hideLicenseGate\s*=\s*function/);
  });

  it('起動時 window.License.init() 呼出 (= 自動 refresh)', () => {
    expect(html).toMatch(/window\.License\.init\(\)/);
  });
});

describe('7. Supabase RPC 応答パース (= dk_check_device_license・2026-06-28移行)', () => {
  const realFetch = global.fetch;
  // 注: Node の navigator は read-only + onLine 未定義(≠false)なので、_maybeRefresh の
  //     online ガード(navigator.onLine===false)は通る。navigator は触らない。
  beforeEach(() => {
    mockLocalStorage.clear();
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('RPC が licensed:true 行を返す → init() で cache 更新・state licensed', async () => {
    const future = Date.now() + 30 * 24 * 60 * 60 * 1000;
    global.fetch = function () {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([{ licensed: true, expires_at: future, label: 'モコ', tenant_id: 't1' }]),
      });
    };
    const s = await License.init();
    expect(s.state).toBe('licensed');
    const cache = License.getCache();
    expect(cache.licensed).toBe(true);
    expect(cache.expires_at).toBe(future);
    expect(cache.label).toBe('モコ');
  });

  it('RPC が空配列(未登録)を返す → state unregistered', async () => {
    global.fetch = function () {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    };
    const s = await License.init();
    expect(s.state).toBe('unregistered');
  });

  it('RPC が licensed:false(期限切れ)を返す → cache licensed:false → unregistered(既存挙動踏襲)', async () => {
    // 注: grace はオフラインで cache licensed:true のまま期限が過ぎた時のみ(test 2-4参照)。
    //     オンラインで RPC が licensed:false を返したら cache licensed:false → unregistered。
    const past = Date.now() - 3 * 24 * 60 * 60 * 1000;
    global.fetch = function () {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([{ licensed: false, expires_at: past, label: '', tenant_id: '' }]),
      });
    };
    const s = await License.init();
    expect(s.state).toBe('unregistered');
  });
});
