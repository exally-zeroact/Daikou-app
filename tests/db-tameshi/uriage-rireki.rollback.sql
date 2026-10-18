-- ★売上から 引く 物の 変えた 記録（dk_uriage_rireki）と 本人の 関数の 確かめ★ 2026-10-18＝テスト線の 倉庫だけ・必ず rollback
-- 当て方：node tests/db-tameshi/tameshi-rollback.mjs <worktree> この ファイル
-- 期待：1 持ち主は 自分の 会社に 書ける＝2
--       2 同じ 鍵・日の 2件目（素の insert）＝ことわり
--       3 ありえない 日（2026-02-30）＝ことわり
--       4 よその 会社に 書く＝ことわり
--       5 持ち主で ない 人には 見えない＝0
--       6 窓（public.dk_uriage_rireki）から on conflict で 同じ 鍵・日を もう一度＝直す（行は 増えない）＝2:false
--       7 窓から 直す・消す＝1/1
--       8 鍵が 3つ 以外＝ことわり ／ 9 値が 空＝ことわり
--       10 本人の 関数が 会社の 記録を 返す＝1（anon で 呼ぶ）
begin;
create temp table co as
  select c.company_id, c.owner_id from daikome.dk_companies c
   where c.owner_id is not null order by c.company_id limit 1;
create temp table yoso as
  select c.company_id from daikome.dk_companies c
   where c.company_id <> (select company_id from co) order by c.company_id limit 1;
create temp table k (n text, v text);
insert into daikome.dk_employees (company_id, name, role, active)
  select company_id, 'zz-uri-A', '1種', true from co;
insert into daikome.dk_kyuryo_pub (token, company_id, employee_id, pw_hash)
  select 'zz-token-uri', co.company_id, e.employee_id, crypt('zzpw', gen_salt('bf'))
    from co, daikome.dk_employees e where e.name = 'zz-uri-A';
grant select, insert on co, yoso, k to authenticated, anon;

-- 持ち主として 書く
create temp table c1 as select set_config('request.jwt.claims', json_build_object('sub', owner_id::text, 'role', 'authenticated')::text, true) x from co;
set local role authenticated;
insert into daikome.dk_uriage_rireki (company_id, key, from_date, value)
  select company_id, 'toll', '2026-09-11', false from co;
insert into daikome.dk_uriage_rireki (company_id, key, from_date, value)
  select company_id, 'other', '2026-09-20', true from co;
insert into k select '1 自分の 会社に 書ける', count(*)::text from daikome.dk_uriage_rireki where company_id = (select company_id from co);
do $$
begin
  insert into daikome.dk_uriage_rireki (company_id, key, from_date, value)
    select company_id, 'toll', '2026-09-11', true from co;
  insert into k values ('2 同じ 日の 2件目', 'かけた');
exception when others then
  insert into k values ('2 同じ 日の 2件目', 'ことわり');
end $$;
do $$
begin
  insert into daikome.dk_uriage_rireki (company_id, key, from_date, value)
    select company_id, 'bridge', '2026-02-30', true from co;
  insert into k values ('3 ありえない 日', 'かけた');
exception when others then
  insert into k values ('3 ありえない 日', 'ことわり');
end $$;
do $$
begin
  insert into daikome.dk_uriage_rireki (company_id, key, from_date, value)
    select company_id, 'bridge', '2026-09-11', true from yoso;
  insert into k values ('4 よその 会社', 'かけた');
exception when others then
  insert into k values ('4 よその 会社', 'ことわり');
end $$;
do $$
begin
  insert into daikome.dk_uriage_rireki (company_id, key, from_date, value)
    select company_id, 'xx', '2026-09-12', true from co;
  insert into k values ('8 鍵が 3つ 以外', 'かけた');
exception when others then
  insert into k values ('8 鍵が 3つ 以外', 'ことわり');
end $$;
do $$
begin
  insert into daikome.dk_uriage_rireki (company_id, key, from_date, value)
    select company_id, 'bridge', '2026-09-12', null from co;
  insert into k values ('9 値が 空', 'かけた');
exception when others then
  insert into k values ('9 値が 空', 'ことわり');
end $$;
-- 窓から（PostgREST の on_conflict=company_id,key,from_date＋merge-duplicates と 同じ 文）
insert into public.dk_uriage_rireki (company_id, key, from_date, value)
  select company_id, 'toll', '2026-09-11', false from co
  on conflict (company_id, key, from_date) do update set value = excluded.value;
insert into public.dk_uriage_rireki (company_id, key, from_date, value)
  select company_id, 'other', '2026-09-20', false from co
  on conflict (company_id, key, from_date) do update set value = excluded.value;
insert into k select '6 窓から on conflict で 直す',
  count(*)::text || ':' || (select value::text from daikome.dk_uriage_rireki where key = 'other' and company_id = (select company_id from co))
  from daikome.dk_uriage_rireki where company_id = (select company_id from co);
create temp table r7 (n text, c int);
grant select, insert on r7 to authenticated;
with x as (
  update public.dk_uriage_rireki set from_date = '2026-09-21' where key = 'other' returning 1
) insert into r7 select 'upd', count(*) from x;
with x as (
  delete from public.dk_uriage_rireki where key = 'other' returning 1
) insert into r7 select 'del', count(*) from x;
insert into k select '7 窓から 直す/消す', string_agg(c::text, '/' order by n desc) from r7;
reset role;
-- 持ち主で ない 人
create temp table c2 as select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true) x;
set local role authenticated;
insert into k select '5 持ち主で ない 人に 見える 行', count(*)::text from daikome.dk_uriage_rireki;
reset role;
-- 本人の 関数（anon が 呼ぶ）
create temp table c3 as select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true) x;
create temp table r10 (j jsonb);
grant select, insert on r10 to anon;
set local role anon;
insert into r10 select public.dk_kyuryo_get('zz-token-uri', 'zzpw', '2026-09-01', '2026-09-30')::jsonb;
reset role;
insert into k select '10 本人の 関数が 会社の 記録を 返す',
  (select count(*) from r10, jsonb_array_elements(r10.j->'uriageRireki') x where x->>'key' = 'toll')::text;
select n, v from k order by n;
rollback;
