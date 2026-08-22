'use strict';
// ============================================================
// 共有本番にSQLを当てる前の門番 テスト 2026-08-01
//
//   ★この倉庫には Kyually本番 / Exally本番 / 代行請求（明細1000件超）の実データが同居している★
//   事故の形は2つだけ:
//     ① 消す/書き換える系が混ざる     → 他アプリのデータが飛ぶ
//     ② dk_ 以外の棚をいじってしまう  → 他アプリの棚が壊れる
//   両方を機械で止める。★わざと危ない物を食わせて止まることまで確かめる★
// ============================================================
const fs = require('fs');
const path = require('path');

let G;
beforeAll(async () => {
  G = await import('../../scripts/sql-guard.mjs');
});

const OK_SQL = `
-- 足すだけ
create table if not exists dk_employees (
  employee_id uuid primary key default gen_random_uuid(),
  company_id  uuid not null references dk_companies(company_id) on delete cascade,
  name        text not null
);
create index if not exists dk_employees_company_idx on dk_employees (company_id);
alter table dk_employees enable row level security;
create policy dk_employees_owner_sel on dk_employees
  for select using (company_id in (select company_id from dk_companies where owner_id = auth.uid()));
select tablename from pg_tables where schemaname = 'public';
`;

describe('★足すだけのSQLは通す★', () => {
  it('通る', () => {
    const r = G.guard(OK_SQL);
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it('触る棚をぜんぶ挙げる', () => {
    expect(G.guard(OK_SQL).tables).toEqual(['dk_employees']);
  });

  it('列を足すのは通る', () => {
    const r = G.guard(
      'alter table dk_shift_edits add column if not exists hours double precision;'
    );
    expect(r.ok).toBe(true);
  });

  it('コメントを付けるのは通る', () => {
    const r = G.guard("comment on column dk_shift_edits.hours is '車の時数';");
    expect(r.ok).toBe(true);
  });
});

describe('★消す/書き換える系は止める★', () => {
  const bad = {
    'drop table': 'drop table dk_employees;',
    'drop policy': 'drop policy if exists dk_shifts_owner_sel on dk_shifts;',
    'drop column': 'alter table dk_employees drop column name;',
    truncate: 'truncate dk_work_hours;',
    delete: 'delete from dk_employees where active = false;',
    update: "update dk_employees set role = '1種';",
    insert: "insert into dk_employees (name) values ('x');",
    revoke: 'revoke all on dk_employees from anon;',
  };
  Object.keys(bad).forEach((k) => {
    it(k + ' は止まる', () => {
      const r = G.guard(bad[k]);
      expect(r.ok).toBe(false);
      expect(r.reasons.length).toBeGreaterThan(0);
    });
  });

  it('★足すだけの中に1文だけ混ぜても止まる★', () => {
    const r = G.guard(OK_SQL + '\ndrop table pay_slips;');
    expect(r.ok).toBe(false);
  });

  it('中身を読めない do $$ ... $$ は通さない', () => {
    const r = G.guard('do $$ begin execute (%%); end $$;');
    expect(r.ok).toBe(false);
  });
});

describe('★dk_ 以外の棚に触る物は止める★', () => {
  it('他アプリの棚を作ろうとしたら止まる', () => {
    const r = G.guard('create table if not exists pay_slips (id uuid primary key);');
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toContain('pay_slips');
  });

  it('代行請求の meisai に触ろうとしたら止まる', () => {
    const r = G.guard('alter table meisai add column if not exists x int;');
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toContain('meisai');
  });

  it('policy を他アプリの棚に付けようとしたら止まる', () => {
    const r = G.guard('create policy p1 on companies for select using (true);');
    expect(r.ok).toBe(false);
  });

  it('★dk_ を参照するだけ（references / select の中）は止めない★', () => {
    const r = G.guard(
      'create table if not exists dk_x (a uuid references dk_companies(company_id), b uuid references pay_org(id));'
    );
    // 作る棚は dk_x だけ。参照先は作り変えないので通る
    expect(r.tables).toEqual(['dk_x']);
    expect(r.ok).toBe(true);
  });
});

describe('★ごまかしが効かないこと★', () => {
  it('コメントの中の drop は無視する（止めない）', () => {
    const r = G.guard(
      '-- drop table dk_employees するな\ncreate table if not exists dk_a (id int);'
    );
    expect(r.ok).toBe(true);
  });

  it('文字列の中の drop は無視する', () => {
    const r = G.guard("comment on table dk_a is 'drop table しない';");
    expect(r.ok).toBe(true);
  });

  it('大文字でも止める', () => {
    expect(G.guard('DROP TABLE dk_a;').ok).toBe(false);
    expect(G.guard('DeLeTe FrOm dk_a;').ok).toBe(false);
  });

  it('改行や空白を増やしても止める', () => {
    expect(G.guard('drop\n\n   table   dk_a;').ok).toBe(false);
  });

  it('空っぽ・意味不明は通さない', () => {
    expect(G.guard('').ok).toBe(false);
    expect(G.guard(null).ok).toBe(false);
    expect(G.guard('こんにちは').ok).toBe(false);
  });
});

describe('★実物のファイルで確かめる★', () => {
  const dir = path.join(__dirname, '..', '..', 'supabase');
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

  [
    'apply-shared-dk-jobs.sql',
    'apply-shared-dk-sales.sql',
    'apply-shared-dk-sales-settings.sql',
    'apply-shared-dk-payroll.sql',
  ].forEach((f) => {
    it(f + ' は通る（足すだけ）', () => {
      const r = G.guard(read(f));
      if (!r.ok) console.log(f, r.reasons);
      expect(r.ok).toBe(true);
      expect(r.tables.every((t) => t.indexOf('dk_') === 0)).toBe(true);
    });
  });

  it('★migrate-standalone.sql は止まる（新しい空プロジェクト用・共有本番に持ち込まない）★', () => {
    const r = G.guard(read('migrate-standalone.sql'));
    expect(r.ok).toBe(false);
  });
});
