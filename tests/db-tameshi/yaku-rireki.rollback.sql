-- ★役割の 決まりの 変えた 記録（dk_yaku_rireki）と 名前直し・本人の 関数の 確かめ★ 2026-10-18＝テスト線の 倉庫だけ・必ず rollback
-- 当て方：node tests/db-tameshi/tameshi-rollback.mjs <worktree> この ファイル
-- 期待：1 持ち主は 自分の 会社に 書ける＝2
--       2 同じ 役割・鍵・日の 2件目＝ことわり
--       3 ありえない 日（2026-02-30）＝ことわり
--       4 よその 会社に 書く＝ことわり
--       5 持ち主で ない 人には 見えない＝0
--       6 名前の 入れ替え（zz甲↔zz乙・★両方に 同じ 鍵・同じ 日★＝deferrable で ないと ぶつかる）で 記録も 入れ替わる
--         ＝zz乙:floor:5000/zz乙:rate:0.4/zz甲:floor:7000/zz甲:rate:0.5
--       9 0 より 下の 値＝ことわり
--       10 窓（public.dk_yaku_rireki＝画面が 使う 口）から 書く・直す・消す＝1/1/1
--       7 残った 記録の 在る 名前へ 直す＝kiroku_nokori（何も 変えない）
--       8 本人の 関数が 会社の 記録を 返す＝5（anon で 呼ぶ・残った 記録も 含む）
begin;
create temp table co as
  select c.company_id, c.owner_id from daikome.dk_companies c
   where c.owner_id is not null order by c.company_id limit 1;
create temp table yoso as
  select c.company_id from daikome.dk_companies c
   where c.company_id <> (select company_id from co) order by c.company_id limit 1;
create temp table k (n text, v text);
insert into daikome.dk_payroll_settings (company_id, roles)
  select company_id, '{"zz甲":{"rate":0.3,"floor":1000},"zz乙":{"rate":0.35,"floor":1150}}'::jsonb from co
  on conflict (company_id) do update set roles = excluded.roles;
insert into daikome.dk_employees (company_id, name, role, active)
  select company_id, 'zz-yaku-A', 'zz甲', true from co;
insert into daikome.dk_kyuryo_pub (token, company_id, employee_id, pw_hash)
  select 'zz-token-yaku', co.company_id, e.employee_id, crypt('zzpw', gen_salt('bf'))
    from co, daikome.dk_employees e where e.name = 'zz-yaku-A';
grant select, insert on co, yoso, k to authenticated, anon;

-- 持ち主として 書く
create temp table c1 as select set_config('request.jwt.claims', json_build_object('sub', owner_id::text, 'role', 'authenticated')::text, true) x from co;
set local role authenticated;
insert into daikome.dk_yaku_rireki (company_id, yaku, key, from_date, value)
  select company_id, 'zz甲', 'floor', '2026-09-11', 5000 from co;
insert into daikome.dk_yaku_rireki (company_id, yaku, key, from_date, value)
  select company_id, 'zz乙', 'rate', '2026-09-11', 0.5 from co;
insert into k select '1 自分の 会社に 書ける', count(*)::text from daikome.dk_yaku_rireki where yaku like 'zz%';
-- 入れ替えで ぶつかる 形（両方の 役割に 同じ 鍵・同じ 日）
insert into daikome.dk_yaku_rireki (company_id, yaku, key, from_date, value)
  select company_id, 'zz乙', 'floor', '2026-09-11', 7000 from co;
insert into daikome.dk_yaku_rireki (company_id, yaku, key, from_date, value)
  select company_id, 'zz甲', 'rate', '2026-09-11', 0.4 from co;
do $$
begin
  insert into daikome.dk_yaku_rireki (company_id, yaku, key, from_date, value)
    select company_id, 'zz甲', 'rate', '2026-09-20', -1 from co;
  insert into k values ('9 0 より 下', 'かけた');
exception when others then
  insert into k values ('9 0 より 下', 'ことわり');
end $$;
-- 窓から（PostgREST と 同じ 口）
create temp table r10 (n text, c int);
grant select, insert on r10 to authenticated;
with x as (
  insert into public.dk_yaku_rireki (company_id, yaku, key, from_date, value)
  select company_id, 'zz乙', 'rate', '2026-09-25', 0.6 from co returning 1
) insert into r10 select 'ins', count(*) from x;
with x as (
  update public.dk_yaku_rireki set value = 0.61 where yaku = 'zz乙' and from_date = '2026-09-25' returning 1
) insert into r10 select 'upd', count(*) from x;
with x as (
  delete from public.dk_yaku_rireki where yaku = 'zz乙' and from_date = '2026-09-25' returning 1
) insert into r10 select 'del', count(*) from x;
insert into k select '10 窓から 書く/直す/消す', string_agg(c::text, '/' order by case n when 'ins' then 1 when 'upd' then 2 else 3 end) from r10;
do $$
begin
  insert into daikome.dk_yaku_rireki (company_id, yaku, key, from_date, value)
    select company_id, 'zz甲', 'floor', '2026-09-11', 6000 from co;
  insert into k values ('2 同じ 日の 2件目', 'かけた');
exception when others then
  insert into k values ('2 同じ 日の 2件目', 'ことわり');
end $$;
do $$
begin
  insert into daikome.dk_yaku_rireki (company_id, yaku, key, from_date, value)
    select company_id, 'zz甲', 'rate', '2026-02-30', 0.4 from co;
  insert into k values ('3 ありえない 日', 'かけた');
exception when others then
  insert into k values ('3 ありえない 日', 'ことわり');
end $$;
do $$
begin
  insert into daikome.dk_yaku_rireki (company_id, yaku, key, from_date, value)
    select company_id, 'zz甲', 'rate', '2026-09-11', 0.4 from yoso;
  insert into k values ('4 よその 会社', 'かけた');
exception when others then
  insert into k values ('4 よその 会社', 'ことわり');
end $$;
-- 名前の 入れ替え（1つの 取引）
create temp table r6 (j json);
grant select, insert on r6 to authenticated;
insert into r6 select public.dk_yaku_namae_naoshi((select company_id from co), '{"zz甲":"zz乙","zz乙":"zz甲"}'::jsonb);
insert into k select '6 入れ替え', string_agg(yaku || ':' || key || ':' || value::text, '/' order by yaku, key)
  from daikome.dk_yaku_rireki where company_id = (select company_id from co) and yaku like 'zz%';
-- 残った 記録（決まりに 無い zz丙）の 名前へ 直す
insert into daikome.dk_yaku_rireki (company_id, yaku, key, from_date, value)
  select company_id, 'zz丙', 'rate', '2026-09-01', 0.9 from co;
insert into k select '7 残った 記録の 名前へ', public.dk_yaku_namae_naoshi((select company_id from co), '{"zz甲":"zz丙"}'::jsonb) ->> 'reason';
reset role;
-- 持ち主で ない 人
create temp table c2 as select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true) x;
set local role authenticated;
insert into k select '5 持ち主で ない 人に 見える 行', count(*)::text from daikome.dk_yaku_rireki;
reset role;
-- 本人の 関数（anon が 呼ぶ）
create temp table c3 as select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true) x;
create temp table r8 (j jsonb);
grant select, insert on r8 to anon;
set local role anon;
insert into r8 select public.dk_kyuryo_get('zz-token-yaku', 'zzpw', '2026-09-01', '2026-09-30')::jsonb;
reset role;
insert into k select '8 本人の 関数が 会社の 記録を 返す',
  (select count(*) from r8, jsonb_array_elements(r8.j->'yakuRireki') x where x->>'yaku' like 'zz%')::text;
select n, v from k order by n;
rollback;
