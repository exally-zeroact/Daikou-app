-- ★人の 変えた 記録（dk_hito_rireki）と 本人の 関数の 確かめ★ 2026-10-18＝テスト線の 倉庫だけ・必ず rollback
-- 当て方：node tests/db-tameshi/tameshi-rollback.mjs <worktree> この ファイル
-- 期待：0 よその 会社の 人を 控えた＝1
--       1 持ち主は 自分の 会社の 人に 書ける＝2（A と B）
--       2 よその 会社の 人の id で 書くと 断られる＝ことわり
--       3 持ち主で ない 人には 見えない＝0
--       4 同乗の 役は その 日の 記録（9/10 は 列の 1種・9/12 は 記録の 甲）＝1種/甲
--       5 本人の 関数が 記録を 返す＝1（本人 A の 分だけ・B の 記録は 返さない・anon で 呼ぶ）
begin;
create temp table co as
  select c.company_id, c.owner_id from daikome.dk_companies c
   where c.owner_id is not null order by c.company_id limit 1;
create temp table yoso as
  select c.company_id from daikome.dk_companies c
   where c.company_id <> (select company_id from co) order by c.company_id limit 1;
create temp table k (n text, v text);
insert into daikome.dk_employees (company_id, name, role, active)
  select company_id, 'zz-rireki-A', '1種', true from co;
insert into daikome.dk_employees (company_id, name, role, active)
  select company_id, 'zz-rireki-Y', '1種', true from yoso;
-- 同じ 会社の 別の 人（本人の 関数が この 人の 記録を 返さない 事を 見る）
insert into daikome.dk_employees (company_id, name, role, active)
  select company_id, 'zz-rireki-B', '1種', true from co;
insert into daikome.dk_work_hours (company_id, employee_id, work_date, device_id, hours)
  select co.company_id, e.employee_id, d::date, 'zz-dev', 3
    from co, daikome.dk_employees e, (values ('2026-09-10'), ('2026-09-12')) v(d)
   where e.name = 'zz-rireki-A';
insert into daikome.dk_kyuryo_pub (token, company_id, employee_id, pw_hash)
  select 'zz-token-rireki', co.company_id, e.employee_id, crypt('zzpw', gen_salt('bf'))
    from co, daikome.dk_employees e where e.name = 'zz-rireki-A';
-- よその 会社の 人の id を 先に 控える（持ち主の 役では RLS で 見えない＝id を 知っている 人の 形で 試す）
create temp table yid as select employee_id from daikome.dk_employees where name = 'zz-rireki-Y';
grant select, insert on co, yoso, k, yid to authenticated, anon;
insert into k select '0 よその 会社の 人を 控えた', count(*)::text from yid;

-- 持ち主として 書く
create temp table c1 as select set_config('request.jwt.claims', json_build_object('sub', owner_id::text, 'role', 'authenticated')::text, true) x from co;
set local role authenticated;
insert into daikome.dk_hito_rireki (company_id, employee_id, key, from_date, value)
  select (select company_id from co), e.employee_id, 'role', '2026-09-11', '"甲"'::jsonb
    from daikome.dk_employees e where e.name = 'zz-rireki-A';
insert into daikome.dk_hito_rireki (company_id, employee_id, key, from_date, value)
  select (select company_id from co), e.employee_id, 'pay_rate', '2026-09-11', '0.5'::jsonb
    from daikome.dk_employees e where e.name = 'zz-rireki-B';
insert into k select '1 自分の 会社の 人に 書ける', count(*)::text from daikome.dk_hito_rireki;
-- よその 会社の 人の id で 書く（会社は 自分の）
do $$
declare n int;
begin
  insert into daikome.dk_hito_rireki (company_id, employee_id, key, from_date, value)
    select (select company_id from co), y.employee_id, 'pay_rate', '2026-09-11', '0.9'::jsonb from yid y;
  get diagnostics n = row_count;
  insert into k values ('2 よその 人の id', 'かけた ' || n || ' 行');
exception when others then
  insert into k values ('2 よその 人の id', 'ことわり');
end $$;
reset role;
-- 持ち主で ない 人
create temp table c2 as select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true) x;
set local role authenticated;
insert into k select '3 持ち主で ない 人に 見える 行', count(*)::text from daikome.dk_hito_rireki;
reset role;
-- 本人の 関数（anon が 呼ぶ）
create temp table c3 as select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true) x;
create temp table r5 (j jsonb);
grant select, insert on r5 to anon;
set local role anon;
insert into r5 select public.dk_kyuryo_get('zz-token-rireki', 'zzpw', '2026-09-01', '2026-09-30')::jsonb;
reset role;
insert into k select '4 同乗の 役 9/10・9/12',
  (select string_agg(c->'roles'->>0, '/' order by c->>'work_date') from r5, jsonb_array_elements(r5.j->'crew') c);
insert into k select '5 本人の 関数が 記録を 返す', jsonb_array_length(r5.j->'rireki')::text from r5;
select n, v from k order by n;
rollback;
