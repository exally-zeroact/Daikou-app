// tests/unit/license-v2-verify.test.js
//
// ★ライセンスv2 STEP2: Ed25519 署名検証 (2026-07-03・テスト先行)★
//   会社URL/QR方式のライセンストークンを、アプリ同梱の公開鍵でオフライン検証する。
//   トークン契約 (Edge Function `dk-issue-license` と一致させる):
//     payloadB64 = base64url(utf8(JSON.stringify(payload)))
//     署名対象   = utf8bytes(payloadB64)   ← 送信文字列そのもの (JSON再直列化しない=キー順ズレ耐性)
//     token      = payloadB64 + "." + base64url(sig)
//
//   verifyLicenseToken(token, publicKeyB64url) → Promise<{valid, payload}>
//     valid=true かつ payload= 検証済み中身。改ざん/不正/形式異常は {valid:false, payload:null}。
//   evaluateLicenseToken(token, pub, nowMs, {running}) = verify→evaluateLicense を1本化。
//     署名NG/偽トークンは payload=null → unlicensed。ただし running=true は常に allowed。
//
//   絶対ルール: 距離/課金に無関係・純粋(副作用なし)・crypto.subtle Ed25519 使用。

'use strict';

const { webcrypto } = require('crypto');
const subtle = webcrypto.subtle;
const LicenseV2 = require('../../js/license-v2.js');

// ─── テスト用: 発行側(Edge Function相当) の署名ヘルパ ───
function b64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}
async function genKeys() {
  const kp = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const jwk = await subtle.exportKey('jwk', kp.publicKey);
  return { priv: kp.privateKey, pubB64url: jwk.x };
}
async function makeToken(payloadObj, privKey) {
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const msg = new TextEncoder().encode(payloadB64);
  const sig = await subtle.sign({ name: 'Ed25519' }, privKey, msg);
  return payloadB64 + '.' + b64url(new Uint8Array(sig));
}

const NOW = 1_800_000_000_000; // 固定 now (ms)
const DAY = 24 * 60 * 60 * 1000;

describe('license-v2: verifyLicenseToken (Ed25519署名検証)', () => {
  it('★ verifyLicenseToken/evaluateLicenseToken が公開されている', () => {
    expect(typeof LicenseV2.verifyLicenseToken).toBe('function');
    expect(typeof LicenseV2.evaluateLicenseToken).toBe('function');
  });

  it('★ 正しく署名されたトークン → valid:true・payload一致', async () => {
    const { priv, pubB64url } = await genKeys();
    const payload = {
      company_id: 'co1',
      device_id: 'devA',
      vin: 'VIN123',
      status: 'on',
      exp: NOW + 30 * DAY,
    };
    const token = await makeToken(payload, priv);
    const r = await LicenseV2.verifyLicenseToken(token, pubB64url);
    expect(r.valid).toBe(true);
    expect(r.payload).toEqual(payload);
  });

  it('★ payload改ざん (base64url1文字書換) → valid:false・payload:null', async () => {
    const { priv, pubB64url } = await genKeys();
    const token = await makeToken(
      { company_id: 'co1', device_id: 'devA', status: 'on', exp: NOW + DAY },
      priv
    );
    const [p, s] = token.split('.');
    // payload の末尾1文字を別の base64url 文字に差し替え
    const flipped = p.slice(0, -1) + (p.slice(-1) === 'A' ? 'B' : 'A');
    const r = await LicenseV2.verifyLicenseToken(flipped + '.' + s, pubB64url);
    expect(r.valid).toBe(false);
    expect(r.payload).toBeNull();
  });

  it('★ 署名改ざん → valid:false', async () => {
    const { priv, pubB64url } = await genKeys();
    const token = await makeToken(
      { company_id: 'co1', device_id: 'devA', status: 'on', exp: NOW + DAY },
      priv
    );
    const [p] = token.split('.');
    const badSig = b64url(new Uint8Array(64)); // 全0の偽署名
    const r = await LicenseV2.verifyLicenseToken(p + '.' + badSig, pubB64url);
    expect(r.valid).toBe(false);
  });

  it('★ 別の鍵で作った公開鍵では検証失敗 (なりすまし防止)', async () => {
    const a = await genKeys();
    const b = await genKeys();
    const token = await makeToken(
      { company_id: 'co1', device_id: 'devA', status: 'on', exp: NOW + DAY },
      a.priv
    );
    const r = await LicenseV2.verifyLicenseToken(token, b.pubB64url); // 別会社の公開鍵
    expect(r.valid).toBe(false);
  });

  it('★ 形式異常 (dotなし/空/null/非文字列) は throw せず valid:false', async () => {
    const { pubB64url } = await genKeys();
    for (const bad of ['garbage', '', 'a.b.c', null, undefined, 123, 'onlypayload']) {
      const r = await LicenseV2.verifyLicenseToken(bad, pubB64url);
      expect(r.valid).toBe(false);
      expect(r.payload).toBeNull();
    }
  });
});

describe('license-v2: evaluateLicenseToken (検証→状態 1本化)', () => {
  it('★ 有効な active トークン → allowed:true・state:active', async () => {
    const { priv, pubB64url } = await genKeys();
    const token = await makeToken(
      { company_id: 'co1', device_id: 'devA', status: 'on', exp: NOW + 30 * DAY },
      priv
    );
    const r = await LicenseV2.evaluateLicenseToken(token, pubB64url, NOW, { running: false });
    expect(r.state).toBe('active');
    expect(r.allowed).toBe(true);
  });

  it('★ 偽トークン → unlicensed・allowed:false (業務外)', async () => {
    const { pubB64url } = await genKeys();
    const r = await LicenseV2.evaluateLicenseToken('forged.token', pubB64url, NOW, {
      running: false,
    });
    expect(r.state).toBe('unlicensed');
    expect(r.allowed).toBe(false);
  });

  it('★★ 偽トークンでも running=true(客乗せ中) は絶対止めない: allowed:true ★★', async () => {
    const { pubB64url } = await genKeys();
    const r = await LicenseV2.evaluateLicenseToken('forged.token', pubB64url, NOW, {
      running: true,
    });
    expect(r.allowed).toBe(true);
  });

  it('★ 署名は正しいが期限切れトークン → expired', async () => {
    const { priv, pubB64url } = await genKeys();
    const token = await makeToken(
      { company_id: 'co1', device_id: 'devA', status: 'on', exp: NOW - DAY },
      priv
    );
    const r = await LicenseV2.evaluateLicenseToken(token, pubB64url, NOW, { running: false });
    expect(r.state).toBe('expired');
    expect(r.allowed).toBe(false);
  });

  it('★ 署名は正しいが status:off (停止) → expired・中立文言', async () => {
    const { priv, pubB64url } = await genKeys();
    const token = await makeToken(
      { company_id: 'co1', device_id: 'devA', status: 'off', exp: NOW + 30 * DAY },
      priv
    );
    const r = await LicenseV2.evaluateLicenseToken(token, pubB64url, NOW, { running: false });
    expect(r.state).toBe('expired');
    expect(r.message).not.toMatch(/未払|料金|支払/);
  });
});
