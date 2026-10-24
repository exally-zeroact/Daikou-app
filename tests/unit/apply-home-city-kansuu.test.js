// ============================================================
// scripts/apply-home-city-kansuu.mjs の 守り 2026-10-24
//   ①本物の SQL から 関数の 塊だけ 切り出せる（呼べる 人の 文は 塊に 入らない）
//   ②書き換えて よい 表は daikome.dk_companies だけ（他の 表は 止まる）
//   ③書く 列は home_city だけ（status 等を 足すと 列の 数えで 分かる・在って ほしくない 字でも 分かる）
//   ④本物の SQL は 在って ほしい 字を 全部 持つ
// ============================================================
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
let M;
let Y;
beforeAll(async () => {
  M = await import(pathToFileURL(path.join(ROOT, 'scripts', 'apply-home-city-kansuu.mjs')).href);
  Y = await import(pathToFileURL(path.join(ROOT, 'scripts', 'apply-yaku-namae.mjs')).href);
});
const SQL = fs.readFileSync(path.join(ROOT, 'supabase', 'apply-home-city-kansuu.sql'), 'utf8');

describe('apply-home-city-kansuu の 守り', () => {
  it('① 関数の 塊だけ 切り出す', () => {
    const b = Y.kiridasu(SQL, M.K);
    expect(b.startsWith(M.K.atama)).toBe(true);
    expect(b.trimEnd().endsWith('$fn$;')).toBe(true);
    expect(b).not.toMatch(/\bgrant\b|\brevoke\b/i);
  });
  it('② 他の 表を 書き換えたら 止まる', () => {
    const s = SQL.replace('update daikome.dk_companies c', 'update daikome.dk_employees c');
    expect(s).not.toBe(SQL);
    expect(() => Y.kiridasu(s, M.K)).toThrow('dk_employees');
  });
  it('③ 書く 列は home_city だけ', () => {
    expect(M.kakuRetsu(Y.kiridasu(SQL, M.K))).toEqual(['home_city']);
    const s = SQL.replace('set home_city = v', "set home_city = v, status = 'on'");
    expect(s).not.toBe(SQL);
    const b = Y.kiridasu(s, M.K);
    expect(M.kakuRetsu(b)).toEqual(['home_city', 'status']);
    expect(Y.kazoeru(b, M.K).ok).toBe(false);
  });
  it('④ 本物の SQL は 在って ほしい 字を 全部 持つ', () => {
    expect(Y.kazoeru(Y.kiridasu(SQL, M.K), M.K).ok).toBe(true);
    expect(Y.kazoeru('', M.K).ok).toBe(false);
  });
});
