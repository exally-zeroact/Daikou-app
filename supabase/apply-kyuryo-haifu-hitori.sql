-- ============================================================
-- ★★従業員 1人ずつ 配る★★ 2026-09-04（司さん「従業員毎に 配るんやないんか」）
--
--   ★なぜ 1人ずつか★
--     ・渡し方は ★その人を 呼んで QR を 見せる★ か ★その人に リンクを 送る★。
--       ⇒ ★1人ぶん 作れば 足りる★
--     ・全員ぶんを 一度に 作ると、★渡していない 鍵が 増えていく★。
--       （やめた人・まだ 渡す気の 無い人の 鍵まで 出来る）
--     ・[[feedback_kagi_wo_ichiran_ni_narameru_na]]
--       ＝★鍵は 渡す 相手 1人にだけ★
--
--   ★この 関数が する事★
--     ・その人の 鍵が ★無ければ 作る★／★在れば そのまま★（作り直しでは ない）
--     ・その人ぶんだけ 返す（token・初回コード・パスワードを 決めたか）
--
--   ★守り（既に 在る 2本と 同じ）★
--     ・★自分の 会社の 人だけ★（dk_companies.owner_id = auth.uid()）
--     ・★よその 会社の 人は 1人も 触らない／返さない★
--     ・★今 居る人（active）だけ★
--     ・パスワードそのもの（pw_hash）は ★1度も 返さない★
--     ・security definer ＋ ★search_path 固定★
-- ============================================================

create or replace function public.dk_kyuryo_haifu_hitori(p_employee_id uuid)
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

  -- ★自分の 会社の 人か／今 居る人か★
  if not exists (
    select 1 from daikome.dk_employees e
     where e.employee_id = p_employee_id
       and e.company_id = cid
       and coalesce(e.active, true) = true
  ) then
    return json_build_object('ok', false, 'reason', 'not_yours');
  end if;

  -- ★無ければ 作る／在れば そのまま★（作り直しでは ない）
  insert into daikome.dk_kyuryo_pub (token, company_id, employee_id, init_code)
  values (
    encode(extensions.gen_random_bytes(16), 'hex'),
    cid,
    p_employee_id,
    upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 8))
  )
  on conflict (company_id, employee_id) do nothing;

  return json_build_object(
    'ok', true,
    'hito', (
      select json_build_object(
        'employee_id', e.employee_id,
        'name', e.name,
        'sort_order', e.sort_order,
        'token', p.token,
        -- ★パスワードを 決めていない人だけ 初回コードを 返す★（URL に 埋める為）
        'init_code', case when p.pw_hash is null then p.init_code else null end,
        'pw_ari', (p.pw_hash is not null)
      )
      from daikome.dk_employees e
      join daikome.dk_kyuryo_pub p
        on p.company_id = e.company_id and p.employee_id = e.employee_id
      where e.company_id = cid and e.employee_id = p_employee_id
    )
  );
end;
$fn$;

grant execute on function public.dk_kyuryo_haifu_hitori(uuid) to authenticated;
