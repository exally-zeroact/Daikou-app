// ============================================================
// scripts/apply-yaku-namae.mjs の 守り（切り出し・書き換えて よい 表・呼べる 人の 読み）2026-10-17
//   ①本物の SQL から 関数の 塊だけ 切り出せる（呼べる 人の 文は 塊に 入らない）
//   ②中に delete・insert・grant 等が 混ざったら 止まる
//   ③書き換えて よい 表は dk_payroll_settings と dk_employees だけ
//   ④本物の SQL は 在って ほしい 字を 全部 持つ
//   ⑤呼べる 人は anon・PUBLIC が 呼べず authenticated が 呼べる 時だけ OK
// ============================================================
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
let M;
beforeAll(async () => {
  M = await import(pathToFileURL(path.join(ROOT, 'scripts', 'apply-yaku-namae.mjs')).href);
});
const SQL = fs.readFileSync(path.join(ROOT, 'supabase', 'apply-yaku-namae.sql'), 'utf8');

describe('apply-yaku-namae の 守り', () => {
  it('① 関数の 塊だけ 切り出す', () => {
    const b = M.kiridasu(SQL, M.K);
    expect(b.startsWith(M.K.atama)).toBe(true);
    expect(b.trimEnd().endsWith('$fn$;')).toBe(true);
    expect(b).not.toMatch(/\bgrant\b|\brevoke\b/i);
  });
  for (const [na, ire] of [
    ['delete', 'delete from daikome.dk_employees;'],
    ['insert', 'insert into daikome.dk_employees (name) values (1);'],
    ['grant', 'grant all on daikome.dk_employees to anon;'],
    ['drop', 'drop table daikome.dk_employees;'],
  ]) {
    it('② 中に ' + na + ' が 在れば 止まる', () => {
      const s = SQL.replace(
        '  get diagnostics n_hito = row_count;\n\n',
        '  ' + ire + '\n  get diagnostics n_hito = row_count;\n\n'
      );
      expect(s).not.toBe(SQL);
      expect(() => M.kiridasu(s, M.K)).toThrow(na);
    });
  }
  it('③ 他の 表を 書き換えたら 止まる', () => {
    const s = SQL.replace(
      'update daikome.dk_employees e\n     set role = p_map ->> e.role\n   where e.company_id = p_company_id\n     and p_map ? e.role;\n  get diagnostics n_hito = row_count;\n\n',
      'update daikome.dk_kyuryo_pub e set token = null;\n  get diagnostics n_hito = row_count;\n\n'
    );
    expect(s).not.toBe(SQL);
    expect(() => M.kiridasu(s, M.K)).toThrow('dk_kyuryo_pub');
  });
  // ★抜け道 3つ（対立役 2026-10-17 本番前）★ 直す 前は どれも 通った
  // ★目印は return の 前の 空行まで★（return の 上に 注釈が 入っても 外れない・10-18 2件目の 小さい 直しで 8件 外れた）
  const SHIRI = '  get diagnostics n_hito = row_count;\n\n';
  for (const [na, ire, kotae] of [
    ['引用符で 囲んだ 表', 'update "daikome"."dk_companies" c set name = name;', 'dk_companies'],
    ['空白を 挟んだ 表', 'update daikome . dk_companies c set name = name;', 'dk_companies'],
    ['execute で 字を つなぐ', "execute 'dro' || 'p table daikome.dk_employees';", 'execute'],
  ]) {
    it('③-2 ' + na + ' も 止まる', () => {
      const s = SQL.replace(SHIRI, '  ' + ire + '\n' + SHIRI);
      expect(s).not.toBe(SQL);
      expect(() => M.kiridasu(s, M.K)).toThrow(kotae);
    });
  }
  it('③-3 注釈の 字では security definer に ならない', () => {
    const s = SQL.replace('security definer\n', 'security invoker -- security definer\n');
    expect(s).not.toBe(SQL);
    expect(() => M.kiridasu(s, M.K)).toThrow('security');
  });
  it('④ 本物の SQL は 在って ほしい 字を 全部 持つ', () => {
    expect(M.kazoeru(M.kiridasu(SQL, M.K), M.K).ok).toBe(true);
    expect(M.kazoeru('', M.K).ok).toBe(false);
  });
  it('⑤ 呼べる 人の 読み', () => {
    expect(M.kengenOk({ anon: false, pub: false, auth: true })).toBe(true);
    expect(M.kengenOk({ anon: true, pub: false, auth: true })).toBe(false);
    expect(M.kengenOk({ anon: false, pub: true, auth: true })).toBe(false);
    expect(M.kengenOk({ anon: false, pub: false, auth: false })).toBe(false);
    expect(M.kengenOk({ anon: null, pub: null, auth: null })).toBe(false);
  });
});
