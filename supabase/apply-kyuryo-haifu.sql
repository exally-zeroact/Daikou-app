-- ============================================================
-- ★★事務所が 従業員へ 配る（URL と 初回コードを 作る）★★ 2026-09-03
--
--   ★なぜ 関数に するか★
--     ・初回コードは ★秘密★なので 窓（public.dk_kyuryo_pub）には 出していない。
--       ⇒ 画面から 直に 読めない ＝ ★配る時だけ 関数が 返す★。
--     ・棚への 書き込みも 関数に まとめる（画面から 直に 触らせない）。
--
--   ★2本だけ★
--     ① dk_kyuryo_haifu     … 今いる人 全員に 1本ずつ 用意して 一覧を 返す
--        ★もう 配ってある人は そのまま★（token も パスワードも 消さない）
--        ★パスワードを まだ 決めていない人には 初回コードを 返す★（URL に 埋める為）
--     ② dk_kyuryo_saihakkou … 1人だけ 作り直す（忘れた／漏れた 時）
--        ★初回コードを 作り直し、パスワードを 消す★
--
--   ★守り★
--     ・★自分の 会社の 人だけ★（dk_companies.owner_id = auth.uid()）
--     ・★他の 会社の 人は 1人も 返さない／触らない★
--     ・パスワードそのもの（pw_hash）は ★1度も 返さない★
--     ・security definer ＋ ★search_path 固定★
-- ============================================================

-- ① 今いる人 全員に 1本ずつ 用意して 一覧を 返す
create or replace function public.dk_kyuryo_haifu()
returns json
language plpgsql
security definer
set search_path = daikome, public, extensions
as $fn$
declare
  cid uuid;
begin
  select c.company_id into cid
    from daikome.dk_companies c
   where c.owner_id = auth.uid()
   limit 1;
  if cid is null then
    return json_build_object('ok', false, 'reason', 'no_company');
  end if;

  -- ★今いる人★に 1本ずつ（もう 在る人は そのまま）
  insert into daikome.dk_kyuryo_pub (token, company_id, employee_id, init_code)
  select
    encode(extensions.gen_random_bytes(16), 'hex'),
    e.company_id,
    e.employee_id,
    upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 8))
  from daikome.dk_employees e
  where e.company_id = cid
    and coalesce(e.active, true) = true
  on conflict (company_id, employee_id) do nothing;

  return json_build_object(
    'ok', true,
    'list', (
      select coalesce(jsonb_agg(x order by x.sort_order nulls last, x.name), '[]'::jsonb)
      from (
        select e.employee_id, e.name, e.sort_order,
               p.token,
               -- ★パスワードを 決めていない人だけ 初回コードを 返す★（URL に 埋める為）
               case when p.pw_hash is null then p.init_code else null end as init_code,
               (p.pw_hash is not null) as pw_ari
        from daikome.dk_employees e
        join daikome.dk_kyuryo_pub p
          on p.company_id = e.company_id and p.employee_id = e.employee_id
        where e.company_id = cid and coalesce(e.active, true) = true
      ) x
    )
  );
end;
$fn$;

-- ② 1人だけ 作り直す（忘れた／漏れた 時）
create or replace function public.dk_kyuryo_saihakkou(p_employee_id uuid)
returns json
language plpgsql
security definer
set search_path = daikome, public, extensions
as $fn$
declare
  cid uuid;
  atarashii text;
begin
  select c.company_id into cid
    from daikome.dk_companies c
   where c.owner_id = auth.uid()
   limit 1;
  if cid is null then
    return json_build_object('ok', false, 'reason', 'no_company');
  end if;
  -- ★自分の 会社の 人か★（よその 人を 作り直せない）
  if not exists (
    select 1 from daikome.dk_employees e
     where e.employee_id = p_employee_id and e.company_id = cid
  ) then
    return json_build_object('ok', false, 'reason', 'not_yours');
  end if;

  atarashii := upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 8));
  update daikome.dk_kyuryo_pub
     set init_code = atarashii,
         pw_hash = null,
         device_tokens = '{}',
         updated_at = now()
   where company_id = cid and employee_id = p_employee_id;

  return json_build_object(
    'ok', true,
    'init_code', atarashii,
    'token', (
      select p.token from daikome.dk_kyuryo_pub p
       where p.company_id = cid and p.employee_id = p_employee_id
    )
  );
end;
$fn$;

-- ★事務所（ログイン した 社長）だけ★（anon には 出さない）
grant execute on function public.dk_kyuryo_haifu() to authenticated;
grant execute on function public.dk_kyuryo_saihakkou(uuid) to authenticated;
