'use strict';
// license-activate.js: 会社URL活性化 + ゲート + 同期 の回帰テスト (2026-07-27 STEP3)。
//   fetch/localStorage をモックし、license-v2(実tweetnacl検証)と繋いだ実挙動を採点。
//   ★running(業務中)は常に allowed=絶対止めない を固定★。

// 実秘密鍵で署名した固定トークン(exp=2100・status:on・active)
const REAL_TOKEN =
  'eyJjb21wYW55X2lkIjoidGVzdC1jbyIsImRldmljZV9pZCI6InRlc3QtZGV2IiwidmluIjoiIiwic3RhdHVzIjoib24iLCJleHAiOjQxMDI0NDQ4MDAwMDB9.qimvECoMnLyFglSQU79LmtLVk65nP2mlb62A3tXtse7-ZFKZRB5HVUiSvyUTKNBFuoM1H1B2tq6mPTWyDCWYBQ';

function mockLS() {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
    clear: () => {
      for (const k in store) delete store[k];
    },
  };
}

let LA;
beforeAll(() => {
  globalThis.localStorage = mockLS();
  globalThis.localStorage.setItem('DAIKOME_DEVICE_ID', 'dev-test-1');
  LA = require('../../js/license-activate.js');
});

beforeEach(async () => {
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem('DAIKOME_DEVICE_ID', 'dev-test-1');
  delete globalThis.fetch;
  await LA._refresh(); // _verifiedPayload を null に戻す
});

describe('license-activate ゲート(checkBeforeBusinessStart)', () => {
  it('未活性化(トークン無し): running=false は allowed=false / running=true は allowed=true(絶対止めない)', () => {
    const off = LA.checkBeforeBusinessStart(false);
    expect(off.allowed).toBe(false);
    expect(off.state).toBe('unlicensed');
    const onJob = LA.checkBeforeBusinessStart(true);
    expect(onJob.allowed).toBe(true); // ★業務中は絶対通す
  });
});

describe('license-activate 活性化(activate)', () => {
  it('成功: Edge Functionが署名トークン返す→cache→active/allowed', async () => {
    globalThis.fetch = async () => ({ json: async () => ({ ok: true, token: REAL_TOKEN }) });
    const r = await LA.activate('url-token-abc');
    expect(r.ok).toBe(true);
    expect(globalThis.localStorage.getItem('dk_license_token')).toBe(REAL_TOKEN);
    expect(globalThis.localStorage.getItem('dk_license_company')).toBe('url-token-abc');
    const g = LA.checkBeforeBusinessStart(false);
    expect(g.state).toBe('active');
    expect(g.allowed).toBe(true);
  });

  it('台数上限: seat_limit で弾かれる(ok:false・reason=seat_limit)', async () => {
    globalThis.fetch = async () => ({
      json: async () => ({ ok: false, reason: 'seat_limit', seat_limit: 4 }),
    });
    const r = await LA.activate('url-token-abc');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('seat_limit');
    expect(r.seat_limit).toBe(4);
    // 弾かれたのでトークンはcacheされない
    expect(globalThis.localStorage.getItem('dk_license_token')).toBe(null);
    expect(LA.checkBeforeBusinessStart(false).allowed).toBe(false);
  });

  it('会社URL不正: invalid_url', async () => {
    globalThis.fetch = async () => ({ json: async () => ({ ok: false, reason: 'invalid_url' }) });
    const r = await LA.activate('bad');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid_url');
  });

  it('オフライン(fetch throw): reason=offline・落ちない', async () => {
    globalThis.fetch = async () => {
      throw new Error('network');
    };
    const r = await LA.activate('url-token-abc');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('offline');
  });

  it('偽トークン(署名NG)は cache しても active にならない(検証で弾く)', async () => {
    globalThis.fetch = async () => ({
      json: async () => ({ ok: true, token: 'ZmFrZQ.ZmFrZXNpZw' }),
    });
    const r = await LA.activate('url-token-abc');
    expect(r.ok).toBe(true); // 発行応答自体はokだが…
    const g = LA.checkBeforeBusinessStart(false);
    expect(g.state).toBe('unlicensed'); // ★署名検証で弾かれ有効にならない
    expect(g.allowed).toBe(false);
  });
});

describe('license-activate 同期(sync)', () => {
  it('会社未保存: no_company', async () => {
    const r = await LA.sync();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_company');
  });

  it('会社保存済: 再同期で+新トークン取得', async () => {
    globalThis.localStorage.setItem('dk_license_company', 'url-token-abc');
    let called = null;
    globalThis.fetch = async (url, opt) => {
      called = JSON.parse(opt.body);
      return { json: async () => ({ ok: true, token: REAL_TOKEN }) };
    };
    const r = await LA.sync();
    expect(r.ok).toBe(true);
    expect(called.url_token).toBe('url-token-abc');
    expect(called.device_id).toBe('dev-test-1');
    expect(LA.checkBeforeBusinessStart(false).allowed).toBe(true);
  });
});
