'use strict';
// license-v2.js の「アプリ同梱 公開鍵(PUBLIC_KEY)」と、対応する秘密鍵で署名した
// 実トークンの往復を固定する回帰テスト (2026-07-27 STEP1鍵生成)。
//   ★このテストが緑 = 埋め込んだ公開鍵と、サーバ秘密鍵(Edge Function)が正しく噛み合う★。
//   トークンは実秘密鍵(scratchpad・repo外)で1度署名した固定値=署名済みライセンスで公開安全。
//   payload = { company_id:'test-co', device_id:'test-dev', vin:'', status:'on', exp:2100年 }。
const LicenseV2 = require('../../js/license-v2.js');

// 実鍵ペアで署名した固定トークン(exp=4102444800000=西暦2100・status:on)
const REAL_TOKEN =
  'eyJjb21wYW55X2lkIjoidGVzdC1jbyIsImRldmljZV9pZCI6InRlc3QtZGV2IiwidmluIjoiIiwic3RhdHVzIjoib24iLCJleHAiOjQxMDI0NDQ4MDAwMDB9.qimvECoMnLyFglSQU79LmtLVk65nP2mlb62A3tXtse7-ZFKZRB5HVUiSvyUTKNBFuoM1H1B2tq6mPTWyDCWYBQ';
const NOW_2026 = 1750000000000; // 2025-06頃(exp<<なので active)

describe('license-v2 埋め込み公開鍵(PUBLIC_KEY)の実鍵往復', () => {
  it('PUBLIC_KEY が公開され・raw32byte(base64url)である', () => {
    expect(typeof LicenseV2.PUBLIC_KEY).toBe('string');
    // base64url 32byte = 43文字(パディングなし)・[-_A-Za-z0-9]のみ
    expect(LicenseV2.PUBLIC_KEY).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const raw = Buffer.from(LicenseV2.PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    expect(raw.length).toBe(32);
  });

  it('★本命: 実秘密鍵署名トークンを 埋め込み鍵で verify → valid・payload一致', async () => {
    const v = await LicenseV2.verifyLicenseTokenEmbedded(REAL_TOKEN);
    expect(v.valid).toBe(true);
    expect(v.payload.company_id).toBe('test-co');
    expect(v.payload.status).toBe('on');
    expect(v.payload.exp).toBe(4102444800000);
  });

  it('★本命: evaluateLicenseTokenEmbedded → active・allowed', async () => {
    const r = await LicenseV2.evaluateLicenseTokenEmbedded(REAL_TOKEN, NOW_2026, {
      running: false,
    });
    expect(r.state).toBe('active');
    expect(r.allowed).toBe(true);
  });

  it('改ざんトークン(1文字書換)は 埋め込み鍵で invalid → unlicensed', async () => {
    // 署名部の中央の1文字を差し替え(末尾は余剰ビットで復号不変になるため中央を変える)
    const dot = REAL_TOKEN.indexOf('.');
    const payloadB64 = REAL_TOKEN.slice(0, dot);
    const sigB64 = REAL_TOKEN.slice(dot + 1);
    const i = 10;
    const ch = sigB64[i] === 'A' ? 'B' : 'A';
    const tampered = payloadB64 + '.' + sigB64.slice(0, i) + ch + sigB64.slice(i + 1);
    const v = await LicenseV2.verifyLicenseTokenEmbedded(tampered);
    expect(v.valid).toBe(false);
    const r = await LicenseV2.evaluateLicenseTokenEmbedded(tampered, NOW_2026, {
      running: false,
    });
    expect(r.state).toBe('unlicensed');
    // ★ただし業務中(running=true)は改ざんでも止めない(絶対ガード)
    const rRun = await LicenseV2.evaluateLicenseTokenEmbedded(tampered, NOW_2026, {
      running: true,
    });
    expect(rRun.allowed).toBe(true);
  });
});
