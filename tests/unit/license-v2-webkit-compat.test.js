'use strict';
// iPhone/iOS Safari 互換 回帰テスト (2026-07-27・司さん要件「iPhoneでも使えるように」)。
//   古いiOS Safari(<17)は crypto.subtle は在るが Ed25519 非対応 → importKey が throw。
//   もし WebCrypto だけに頼ると「正規ユーザーなのにライセンス無効=業務開始できない」事故になる。
//   対策: tweetnacl(純JS Ed25519・同梱 js/tweetnacl.min.js)を検証の主経路にした。
//   本テストは crypto.subtle を「Ed25519非対応」に差し替えても正規トークンが valid になることを固定する。
const LicenseV2 = require('../../js/license-v2.js');

// 実秘密鍵で署名した固定トークン(exp=2100・status:on)
const REAL_TOKEN =
  'eyJjb21wYW55X2lkIjoidGVzdC1jbyIsImRldmljZV9pZCI6InRlc3QtZGV2IiwidmluIjoiIiwic3RhdHVzIjoib24iLCJleHAiOjQxMDI0NDQ4MDAwMDB9.qimvECoMnLyFglSQU79LmtLVk65nP2mlb62A3tXtse7-ZFKZRB5HVUiSvyUTKNBFuoM1H1B2tq6mPTWyDCWYBQ';
const NOW = 1750000000000;

describe('license-v2 iPhone/iOS Safari 互換 (WebCrypto Ed25519 非対応でも検証OK)', () => {
  it('tweetnacl(純JS Ed25519)が同梱され・ロードできる', () => {
    const nacl = require('../../js/tweetnacl.min.js');
    expect(nacl && nacl.sign && nacl.sign.detached).toBeTruthy();
    expect(typeof nacl.sign.detached.verify).toBe('function');
  });

  it('★核心: crypto.subtle が Ed25519 非対応(importKey throw)でも 正規トークンは valid', async () => {
    const orig = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    // 古いiOS Safari相当: subtleは在るが Ed25519 は importKey で throw
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        subtle: {
          importKey: async () => {
            throw new Error('Ed25519 unsupported (old iOS Safari)');
          },
          verify: async () => false,
        },
      },
      configurable: true,
      writable: true,
    });
    try {
      const v = await LicenseV2.verifyLicenseTokenEmbedded(REAL_TOKEN);
      expect(v.valid).toBe(true); // ★正規ユーザーがブロックされない(tweetnaclが検証)★
      const r = await LicenseV2.evaluateLicenseTokenEmbedded(REAL_TOKEN, NOW, { running: false });
      expect(r.state).toBe('active');
      expect(r.allowed).toBe(true);
    } finally {
      if (orig) Object.defineProperty(globalThis, 'crypto', orig);
    }
  });

  it('WebCrypto非対応環境でも 改ざんトークンは弾く(tweetnacl)', async () => {
    const dot = REAL_TOKEN.indexOf('.');
    const sig = REAL_TOKEN.slice(dot + 1);
    const i = 10;
    const ch = sig[i] === 'A' ? 'B' : 'A';
    const tampered = REAL_TOKEN.slice(0, dot + 1) + sig.slice(0, i) + ch + sig.slice(i + 1);
    const v = await LicenseV2.verifyLicenseTokenEmbedded(tampered);
    expect(v.valid).toBe(false);
  });
});
