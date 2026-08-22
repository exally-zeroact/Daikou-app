// ============================================================
// ★配ってある関数と repo を突き合わせる「印」の作り方★（2026-08-19）
//   scripts/check-deployed-functions.mjs は 配ってある中身を取ってきて
//   repo のソースから作った「印」が全部 在るかを見る。
//   ここでは ★印の作り方★ だけを（外に出ずに）確かめる。
//   ・関数の名前が印に入る … ★これが無いと「文字列を足しただけの直し」を見逃す★
//     （実際、行き先の直しは 区切り「〜」を足しただけ＝文字列の印では捕まえられなかった）
//   ・URL は印にしない（環境で変わる）
// ============================================================
import { describe, it, expect } from 'vitest';
import { fingerprint } from '../../scripts/check-deployed-functions.mjs';

const SRC = `
  const URL = 'https://example.supabase.co/functions/v1';
  function placeText(addr, homeCity) { return addr; }
  function routeText(trip, homeCity) { return trip.start_address + '〜' + trip.end_address; }
  const COLS = 'company_id, owner_id, home_city';
  const SHORT = 'ab';
`;

describe('★印の作り方★', () => {
  it('関数の名前が印に入る', () => {
    const f = fingerprint(SRC);
    expect(f, '★関数の名前が印に無い＝中身を直しても気づけない★').toContain('routeText');
    expect(f).toContain('placeText');
  });

  it('長い文字列は印に入る／短すぎる物とURLは入らない', () => {
    const f = fingerprint(SRC);
    expect(f).toContain('company_id, owner_id, home_city');
    expect(f).not.toContain('ab');
    expect(f.some((s) => s.startsWith('https://'))).toBe(false);
  });

  it('印は多すぎない（既定10個まで）', () => {
    // ★2026-08-22 印を10→100に増やした（10個では書き換えを見逃した・実測で100個でも全部一致）★
    expect(fingerprint(SRC).length).toBeLessThanOrEqual(100);
  });
});
