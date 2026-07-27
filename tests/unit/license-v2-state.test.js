'use strict';
// ★ライセンスv2 状態機械 テスト先行 (2026-07-02・会社URL/QR+署名トークン方式・STEP0)★
//   純関数 evaluateLicense(payload, nowMs, {running}) を検証。
//   payload = 署名検証済みトークンの中身 or null。{ exp(ms), status:'on'|'off', company_id, device_id, vin }
//   返り: { state, allowed, daysLeft, message }
//     state: 'active' | 'warning'(残り<=7日) | 'expired'(期限切れ or status off) | 'unlicensed'(payload無し)
//   ★running=true(業務中/客乗せ中)は allowed 常に true=絶対に止めない★
//   ※署名検証(crypto Ed25519)は別テスト。ここは"検証済み中身→状態"の純ロジックのみ。

const path = require('path');
let evaluateLicense, WARN_DAYS;
beforeAll(() => {
  const mod = require(path.join('..', '..', 'js', 'license-v2.js'));
  evaluateLicense = mod.evaluateLicense;
  WARN_DAYS = mod.WARN_DAYS;
});

const DAY = 24 * 60 * 60 * 1000;
const now = 1800000000000; // 固定 now

describe('1. 通常の状態遷移', () => {
  it('期限まで30日 → active・使える', () => {
    const r = evaluateLicense({ exp: now + 30 * DAY, status: 'on' }, now, {});
    expect(r.state).toBe('active');
    expect(r.allowed).toBe(true);
    expect(r.daysLeft).toBe(30);
  });

  it('期限まで5日 → warning・使える・残り日数', () => {
    const r = evaluateLicense({ exp: now + 5 * DAY, status: 'on' }, now, {});
    expect(r.state).toBe('warning');
    expect(r.allowed).toBe(true);
    expect(r.daysLeft).toBe(5);
    expect(r.message).toContain('Wi-Fi');
  });

  it('境界: ちょうど7日(WARN_DAYS)残り → warning', () => {
    expect(WARN_DAYS).toBe(7);
    const r = evaluateLicense({ exp: now + 7 * DAY, status: 'on' }, now, {});
    expect(r.state).toBe('warning');
  });

  it('境界: 8日残り → まだ active(警告出さない)', () => {
    const r = evaluateLicense({ exp: now + 8 * DAY, status: 'on' }, now, {});
    expect(r.state).toBe('active');
  });

  it('期限切れ → expired・使えない', () => {
    const r = evaluateLicense({ exp: now - DAY, status: 'on' }, now, {});
    expect(r.state).toBe('expired');
    expect(r.allowed).toBe(false);
  });

  it('会社OFF(未払い)は期限内でも → expired・使えない', () => {
    const r = evaluateLicense({ exp: now + 30 * DAY, status: 'off' }, now, {});
    expect(r.state).toBe('expired');
    expect(r.allowed).toBe(false);
  });

  it('ライセンス無し(payload null) → unlicensed・使えない', () => {
    const r = evaluateLicense(null, now, {});
    expect(r.state).toBe('unlicensed');
    expect(r.allowed).toBe(false);
  });
});

describe('2. ★業務中(running)は絶対に止めない★', () => {
  it('期限切れでも running=true なら allowed:true(客乗せ中に停止させない)', () => {
    const r = evaluateLicense({ exp: now - DAY, status: 'on' }, now, { running: true });
    expect(r.allowed).toBe(true);
  });

  it('会社OFFでも running=true なら allowed:true', () => {
    const r = evaluateLicense({ exp: now + 30 * DAY, status: 'off' }, now, { running: true });
    expect(r.allowed).toBe(true);
  });

  it('ライセンス無しでも running=true なら allowed:true(業務開始後に失効しても止めない)', () => {
    const r = evaluateLicense(null, now, { running: true });
    expect(r.allowed).toBe(true);
  });

  it('running中でも state自体は正しく返す(表示用・停止はしないが状態は分かる)', () => {
    const r = evaluateLicense({ exp: now - DAY, status: 'on' }, now, { running: true });
    expect(r.state).toBe('expired');
    expect(r.allowed).toBe(true);
  });
});

describe('3. 停止画面の文言(客前に出す想定なので中立)', () => {
  it('expired の message に「未払い」「料金」などの語を含めない(客前の恥防止)', () => {
    const off = evaluateLicense({ exp: now + DAY, status: 'off' }, now, {});
    const exp = evaluateLicense({ exp: now - DAY, status: 'on' }, now, {});
    for (const m of [off.message, exp.message]) {
      expect(m).not.toMatch(/未払い|料金|支払/);
    }
  });
});
