-- ★本人の 関数が 手入力の 日の 会社が 足した 実費（expenses）を 返すか★ 2026-10-20（司さん「揃えろ」）＝テスト線の 倉庫だけ・必ず rollback
-- 当て方：node tests/db-tameshi/tameshi-rollback.mjs <worktree> この ファイル
-- 訳：事務所の 給料は 表を select * で 読み、手入力の 日の expenses を 引く（js/payroll-daily.js）。
--     本人の 画面は dk_kyuryo_get の manualDays を 同じ 計算に 渡す＝★関数が 表と 同じ expenses を 返せば 額は 揃う★。
-- 期待：1 印 tebikiJippi＝true
--       2 手入力の 日の 足した 実費（zzk）＝300
--       3 関数の expenses と 表の expenses が 同じ＝true
--       4 手入力の 日の 行の 数＝1（空振り で ない）
begin;
create temp table co as
  select c.company_id from daikome.dk_companies c
   where c.owner_id is not null order by c.company_id limit 1;
create temp table k (n text, v text);
insert into daikome.dk_employees (company_id, name, role, active)
  select company_id, 'zz-tebiki-A', '1種', true from co;
insert into daikome.dk_kyuryo_pub (token, company_id, employee_id, pw_hash)
  select 'zz-token-tebiki', co.company_id, e.employee_id, crypt('1234', gen_salt('bf'))
    from co, daikome.dk_employees e where e.name = 'zz-tebiki-A';
insert into daikome.dk_work_hours (company_id, employee_id, work_date, device_id, hours)
  select co.company_id, e.employee_id, '2026-09-10', 'zz-tebiki-dev', 8
    from co, daikome.dk_employees e where e.name = 'zz-tebiki-A';
insert into daikome.dk_manual_days (company_id, work_date, device_id, sales_yen, hours, toll_yen, expenses)
  select company_id, '2026-09-10', 'zz-tebiki-dev', 10000, 8, 100, '{"zzk": 300}'::jsonb from co;
grant select, insert on co, k to anon;
create temp table r (j jsonb);
grant select, insert on r to anon;
create temp table c3 as select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true) x;
set local role anon;
insert into r select public.dk_kyuryo_get('zz-token-tebiki', '1234', '2026-09-01', '2026-09-30')::jsonb;
reset role;
insert into k select '1 印 tebikiJippi', (select j->>'tebikiJippi' from r);
insert into k select '2 手入力の 日の 足した 実費（zzk）',
  (select string_agg(x->'expenses'->>'zzk', ',') from r, jsonb_array_elements(r.j->'manualDays') x
    where x->>'device_id' = 'zz-tebiki-dev');
insert into k select '3 関数の expenses と 表の expenses が 同じ',
  (select ((x->'expenses') = m.expenses)::text from r, jsonb_array_elements(r.j->'manualDays') x,
     daikome.dk_manual_days m, co
    where x->>'device_id' = 'zz-tebiki-dev' and m.company_id = co.company_id
      and m.device_id = 'zz-tebiki-dev' and m.work_date = '2026-09-10');
insert into k select '4 手入力の 日の 行の 数',
  (select count(*)::text from r, jsonb_array_elements(r.j->'manualDays') x where x->>'device_id' = 'zz-tebiki-dev');
select n, v from k order by n;
rollback;
