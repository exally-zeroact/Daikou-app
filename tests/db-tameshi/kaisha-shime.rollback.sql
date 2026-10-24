-- ★会社の 締め日（dk_sales_settings.kaisha_shime_hi）の 確かめ★ 2026-10-24＝テスト線の 倉庫だけ・必ず rollback
-- 当て方：node tests/db-tameshi/tameshi-rollback.mjs <worktree> この ファイル
-- 持ち主＝★運営（dk_admins）で ない★ 会社の 持ち主（運営は 全部の 会社が 見える＝持ち主の 決まりを 確かめた 事に ならない）
-- 期待：1 窓から 保存（on conflict＝画面の on_conflict=company_id＋merge-duplicates と 同じ 文）で 返る 行＝1
--       2 読み直し（窓）＝1行・20
--       3 窓から 直す（update … returning）＝1行・5／末日（null）に 戻す＝1行
--       4 29・0 ＝ことわり
--       5 よその 会社に 書く（insert）＝ことわり／よその 会社を 直す（update）＝0行
--       6 持ち主で ない 人には 見えない＝0
--       7 引く 物の 列は 触らない（保存の 前の 値の まま）
begin;
create temp table co as
  select c.company_id, c.owner_id from daikome.dk_companies c
   where c.owner_id is not null
     and c.owner_id not in (select account_id from daikome.dk_admins where account_id is not null)
   order by c.company_id limit 1;
create temp table yoso as
  select c.company_id from daikome.dk_companies c
   where c.company_id <> (select company_id from co)
     and coalesce(c.owner_id::text, '') <> (select owner_id::text from co)
   order by c.company_id limit 1;
create temp table k (n text, v text);
create temp table r (n text, c int, v text);
grant select, insert on co, yoso, k, r to authenticated, anon;
insert into k select '0 確かめる 会社（運営で ない 持ち主）', count(*)::text from co;

-- 持ち主として（PostgREST と 同じ 役・同じ 窓）
create temp table c1 as select set_config('request.jwt.claims', json_build_object('sub', owner_id::text, 'role', 'authenticated')::text, true) x from co;
set local role authenticated;
with x as (
  insert into public.dk_sales_settings (company_id, kaisha_shime_hi, updated_at)
    select company_id, 20, now() from co
    on conflict (company_id) do update set kaisha_shime_hi = excluded.kaisha_shime_hi, updated_at = excluded.updated_at
    returning company_id, kaisha_shime_hi
) insert into r select '1', count(*), string_agg(kaisha_shime_hi::text, ',') from x;
insert into r select '2', count(*), string_agg(kaisha_shime_hi::text, ',')
  from public.dk_sales_settings where company_id = (select company_id from co);
with x as (
  update public.dk_sales_settings set kaisha_shime_hi = 5
   where company_id = (select company_id from co) returning kaisha_shime_hi
) insert into r select '3a', count(*), string_agg(kaisha_shime_hi::text, ',') from x;
with x as (
  update public.dk_sales_settings set kaisha_shime_hi = null
   where company_id = (select company_id from co) returning coalesce(kaisha_shime_hi::text, '末日') v
) insert into r select '3b', count(*), string_agg(v, ',') from x;
do $$
begin
  update public.dk_sales_settings set kaisha_shime_hi = 29 where company_id = (select company_id from co);
  insert into k values ('4a 29', 'かけた');
exception when others then
  insert into k values ('4a 29', 'ことわり');
end $$;
do $$
begin
  update public.dk_sales_settings set kaisha_shime_hi = 0 where company_id = (select company_id from co);
  insert into k values ('4b 0', 'かけた');
exception when others then
  insert into k values ('4b 0', 'ことわり');
end $$;
do $$
begin
  insert into public.dk_sales_settings (company_id, kaisha_shime_hi) select company_id, 20 from yoso;
  insert into k values ('5a よその 会社に 書く', 'かけた');
exception when others then
  insert into k values ('5a よその 会社に 書く', 'ことわり');
end $$;
with x as (
  update public.dk_sales_settings set kaisha_shime_hi = 7
   where company_id = (select company_id from yoso) returning 1
) insert into r select '5b', count(*), '' from x;
insert into r select '7', count(*), string_agg(deduct_toll::text || '/' || deduct_bridge::text || '/' || deduct_other::text, ',')
  from public.dk_sales_settings where company_id = (select company_id from co);
reset role;
-- 持ち主で ない 人
create temp table c2 as select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true) x;
set local role authenticated;
insert into k select '6 持ち主で ない 人に 見える 行', count(*)::text from public.dk_sales_settings;
reset role;
insert into k select '1 保存で 返る 行', c::text || ':' || coalesce(v, '') from r where n = '1';
insert into k select '2 読み直し', c::text || ':' || coalesce(v, '') from r where n = '2';
insert into k select '3a 直す', c::text || ':' || coalesce(v, '') from r where n = '3a';
insert into k select '3b 末日に 戻す', c::text || ':' || coalesce(v, '') from r where n = '3b';
insert into k select '5b よその 会社を 直す', c::text from r where n = '5b';
insert into k select '7 引く 物の 列（既定の まま）', coalesce(v, '') from r where n = '7';
select n, v from k order by n;
rollback;
