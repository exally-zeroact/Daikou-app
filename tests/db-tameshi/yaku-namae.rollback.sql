-- ★役割の 名前を 直す 関数（dk_yaku_namae_naoshi）の 確かめ★ 2026-10-17＝テスト線の 倉庫だけ・必ず rollback
-- 今の 穴：名前を 直すと 決まりの 鍵だけ 変わり、人の 役割（辞めた 人も）と 日給・段階歩合は 古い 名前の まま 残った
-- 当て方：node tests/db-tameshi/tameshi-rollback.mjs <worktree> この ファイル
-- 期待：1 直す＝true（人 A・B（辞めた 人）が 甲・決まりに 甲 在り 1種 無し・日給 5000 が 甲へ）
--         ok/A/B/甲在り/1種無し/日給 ＝ true/甲/甲/true/true/5000
--       2 入れ替え（甲⇔2種）＝ true/2種/甲/0.30（A は 2種・C は 甲・2種 の 率は 前の 甲＝0.30）
--       3 直さない 役割の 名前と ぶつかる＝exists（何も 変わらない＝A は 2種 の まま）
--       4 同じ 新しい 名前が 2つ＝dup／5 決まりに 無い 名前＝not_found／6 空＝blank
--       7 よその 会社＝not_yours
--       8 設定の 行が まだ 無い 会社＝true/乙/0（人の 役割だけ 直る・行は 作らない）
--       9 決まりが 空（{}）の 会社＝true/丙（人の 役割だけ 直る）
--       9b 直さない 名前が 日給・段階歩合の 鍵に だけ 残る＝exists
begin;
create temp table co as
  select c.company_id, c.owner_id
    from daikome.dk_companies c
   where c.owner_id is not null
   order by c.company_id
   limit 1;
-- 持ち主の 居る 会社に 仮の 設定（1種・2種・1種に 日給 5000）を 入れる（rollback で 消える）
insert into daikome.dk_payroll_settings (company_id, roles, pay_extra)
  select company_id,
         '{"1種":{"rate":0.30,"floor":1000},"2種":{"rate":0.35,"floor":1150}}'::jsonb,
         jsonb_build_object('roles', jsonb_build_object('1種', jsonb_build_object('nikkyu', 5000)))
    from co
  on conflict (company_id) do update set roles = excluded.roles, pay_extra = excluded.pay_extra;
insert into daikome.dk_employees (company_id, name, role, active)
  select company_id, 'zz-yaku-A', '1種', true from co;
insert into daikome.dk_employees (company_id, name, role, active)
  select company_id, 'zz-yaku-B', '1種', false from co;
insert into daikome.dk_employees (company_id, name, role, active)
  select company_id, 'zz-yaku-C', '2種', true from co;
select set_config('request.jwt.claims', json_build_object('sub', owner_id::text, 'role', 'authenticated')::text, true) from co;
create temp table k (n text, v text);
create function pg_temp.yaku(nm text) returns text language sql as
  $$ select role from daikome.dk_employees where name = nm $$;

-- ★関数を 呼ぶ 文と 読む 文を 分ける★（同じ 文の 中では 関数が 書いた 後の 設定が 見えない）
create temp table r1 as select public.dk_yaku_namae_naoshi(company_id, '{"1種":"甲"}'::jsonb)::jsonb x from co;
insert into k select '1 直す ok/A/B/甲在り/1種無し/日給',
  (r1.x->>'ok') || '/' || pg_temp.yaku('zz-yaku-A') || '/' || pg_temp.yaku('zz-yaku-B') || '/'
  || (s.roles ? '甲')::text || '/' || (not (s.roles ? '1種'))::text || '/'
  || coalesce(s.pay_extra #>> '{roles,甲,nikkyu}', 'なし')
  from r1, daikome.dk_payroll_settings s
 where s.company_id = (select company_id from co);

create temp table r2 as select public.dk_yaku_namae_naoshi(company_id, '{"甲":"2種","2種":"甲"}'::jsonb)::jsonb x from co;
insert into k select '2 入れ替え ok/A/C/2種の率',
  (r2.x->>'ok') || '/' || pg_temp.yaku('zz-yaku-A') || '/' || pg_temp.yaku('zz-yaku-C') || '/'
  || to_char((s.roles #>> '{2種,rate}')::numeric, 'FM0.00')
  from r2, daikome.dk_payroll_settings s
 where s.company_id = (select company_id from co);

insert into k select '3 ぶつかる reason/A',
  (public.dk_yaku_namae_naoshi(company_id, '{"甲":"2種"}'::jsonb)::jsonb->>'reason') || '/' || pg_temp.yaku('zz-yaku-A')
  from co;
insert into k select '4 同じ 名前 2つ', public.dk_yaku_namae_naoshi(company_id, '{"甲":"X","2種":"X"}'::jsonb)::jsonb->>'reason' from co;
insert into k select '5 決まりに 無い', public.dk_yaku_namae_naoshi(company_id, '{"無い":"Y"}'::jsonb)::jsonb->>'reason' from co;
insert into k select '6 空', public.dk_yaku_namae_naoshi(company_id, '{"甲":"  "}'::jsonb)::jsonb->>'reason' from co;
-- 8 設定の 行が まだ 無い 会社＝人の 役割だけ 直る（決まりは 後の 保存が 作る）
create temp table co2 as
  select c.company_id, c.owner_id
    from daikome.dk_companies c
   where c.owner_id is not null
     and not exists (select 1 from daikome.dk_payroll_settings s where s.company_id = c.company_id)
   order by c.company_id
   limit 1;
insert into daikome.dk_employees (company_id, name, role, active)
  select company_id, 'zz-yaku-D', '2種', true from co2;
create temp table c2 as select set_config('request.jwt.claims', json_build_object('sub', owner_id::text, 'role', 'authenticated')::text, true) x from co2;
create temp table r8 as select public.dk_yaku_namae_naoshi(company_id, '{"2種":"乙"}'::jsonb)::jsonb x from co2;
insert into k select '8 行の 無い 会社 ok/D/行',
  (r8.x->>'ok') || '/' || pg_temp.yaku('zz-yaku-D') || '/'
  || (select count(*) from daikome.dk_payroll_settings s where s.company_id = (select company_id from co2))::text
  from r8;
-- 9 設定の 行は 在るが 決まりが 空（{}）＝人の 役割だけ 直る（前は no_roles で 二度と 直せなかった）
insert into daikome.dk_payroll_settings (company_id, roles) select company_id, '{}'::jsonb from co2;
create temp table r9 as select public.dk_yaku_namae_naoshi(company_id, '{"乙":"丙"}'::jsonb)::jsonb x from co2;
insert into k select '9 決まりが 空 ok/D', (r9.x->>'ok') || '/' || pg_temp.yaku('zz-yaku-D') from r9;
-- 9b 直さない 名前が 日給・段階歩合の 鍵に だけ 残って いる＝ぶつかる（日給を 黙って 上書きしない）
create temp table c3 as select set_config('request.jwt.claims', json_build_object('sub', owner_id::text, 'role', 'authenticated')::text, true) x from co;
update daikome.dk_payroll_settings s
   set pay_extra = jsonb_build_object('roles', jsonb_build_object('Q', jsonb_build_object('nikkyu', 7000)))
 where s.company_id = (select company_id from co);
insert into k select '9b 日給の 鍵と ぶつかる', public.dk_yaku_namae_naoshi(company_id, '{"甲":"Q"}'::jsonb)::jsonb->>'reason' from co;
create temp table yoso as select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true) x;
insert into k select '7 よその 会社', public.dk_yaku_namae_naoshi(company_id, '{"甲":"Z"}'::jsonb)::jsonb->>'reason' from co;
select n, v from k order by n;
rollback;
