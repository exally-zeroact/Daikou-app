-- ============================================================
-- ★★役割の 名前を 直す＝決まりと 人の 役割を 1つの 取引で 一緒に 直す★★ 2026-10-17
--
--   ★今の 穴★
--     給料の 設定で 役割の 名前を 直すと、決まり（dk_payroll_settings.roles）の 鍵だけ 変わり、
--     ・人の 役割（dk_employees.role）は 古い 名前の まま＝歩合0・保証0で 計算されていた
--     ・日給・段階歩合（pay_extra.roles）も 古い 名前の まま＝保存で 消えていた
--
--   ★この 関数が する事★（p_map ＝ { 読み込んだ 時の 名前: 今の 名前 }）
--     ・その 会社の 人（★辞めた 人も★）の role を 新しい 名前へ（倉庫の 側で role = 古い 名前 を 条件に＝
--       他の タブで 足した 人も 取りこぼさない）
--     ・決まり（roles）と 日給・段階歩合（pay_extra.roles）の 鍵も 同じ 取引で 新しい 名前へ
--     ・入れ替え（甲→乙・乙→甲）も 1回で（1つの 文で 書き換える）
--
--   ★断る 時★（何も 変えない）
--     ・自分の 会社で ない（dk_companies.owner_id = auth.uid() で 確かめる）
--     ・名前が 空・同じ 新しい 名前が 2つ・直さない 役割の 名前と ぶつかる（決まりが 上書きされる。
--       直さない 名前が 日給・段階歩合の 鍵に だけ 残って いる 時も ぶつかる 扱い）
--     ・直す 前の 名前が 決まりに 無い（設定の 行が まだ 無い・決まりが 空の 会社は 人の 役割だけ 直す＝決まりは 後の 保存が 作る）
--
--   ★守り★ security definer ＋ search_path 固定。anon・PUBLIC には 呼ばせない（authenticated だけ）
-- ============================================================

create or replace function public.dk_yaku_namae_naoshi(p_company_id uuid, p_map jsonb)
returns json
language plpgsql
security definer
set search_path = daikome, public, extensions
as $fn$
declare
  v_roles jsonb;
  v_extra jsonb;
  v_ex_roles jsonb;
  v_new_roles jsonb := '{}'::jsonb;
  v_new_ex jsonb := '{}'::jsonb;
  k text;
  n_hito int := 0;
begin
  if not exists (
    select 1 from daikome.dk_companies c
     where c.company_id = p_company_id
       and c.owner_id = auth.uid()
  ) then
    return json_build_object('ok', false, 'reason', 'not_yours');
  end if;

  if p_map is null or jsonb_typeof(p_map) <> 'object' or p_map = '{}'::jsonb then
    return json_build_object('ok', false, 'reason', 'empty');
  end if;

  -- 名前が 空・字で ない
  if exists (
    select 1 from jsonb_each(p_map) m
     where jsonb_typeof(m.value) <> 'string'
        or btrim(m.key) = ''
        or btrim(m.value #>> '{}') = ''
  ) then
    return json_build_object('ok', false, 'reason', 'blank');
  end if;

  -- 同じ 新しい 名前が 2つ
  if (select count(distinct m.value #>> '{}') from jsonb_each(p_map) m)
     <> (select count(*) from jsonb_each(p_map)) then
    return json_build_object('ok', false, 'reason', 'dup');
  end if;

  select s.roles, s.pay_extra into v_roles, v_extra
    from daikome.dk_payroll_settings s
   where s.company_id = p_company_id
   for update;
  -- ★設定の 行が まだ 無い・決まり（roles）が 空の 会社★（画面は 既定の 1種・2種 を 出している）＝人の 役割だけ 直す。
  --   決まりは この 後の 保存（upsert）が 新しい 名前で 作る（前は 空の 決まりで no_roles＝二度と 直せなかった・対立役）
  if not found or v_roles is null or jsonb_typeof(v_roles) <> 'object' or v_roles = '{}'::jsonb then
    update daikome.dk_employees e
       set role = p_map ->> e.role
     where e.company_id = p_company_id
       and p_map ? e.role;
    get diagnostics n_hito = row_count;
    return json_build_object('ok', true, 'hito', n_hito, 'roles', null);
  end if;
  -- 直す 前の 名前が 決まりに 無い
  if exists (select 1 from jsonb_object_keys(p_map) k0 where not (v_roles ? k0)) then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_ex_roles := case
    when v_extra is not null and jsonb_typeof(v_extra -> 'roles') = 'object' then v_extra -> 'roles'
    else null
  end;

  -- 直さない 役割の 名前と ぶつかる（決まり・日給/段階歩合が 上書きされる）
  if exists (
    select 1 from jsonb_each(p_map) m
     where (v_roles ? (m.value #>> '{}') or coalesce(v_ex_roles ? (m.value #>> '{}'), false))
       and not (p_map ? (m.value #>> '{}'))
  ) then
    return json_build_object('ok', false, 'reason', 'exists');
  end if;

  -- 決まりの 鍵を 付け替える（直さない 物は そのまま）
  for k in select jsonb_object_keys(v_roles) loop
    v_new_roles := v_new_roles
      || jsonb_build_object(coalesce(p_map ->> k, k), v_roles -> k);
  end loop;

  -- 日給・段階歩合（pay_extra.roles）も 同じに
  if v_ex_roles is not null then
    for k in select jsonb_object_keys(v_ex_roles) loop
      v_new_ex := v_new_ex || jsonb_build_object(coalesce(p_map ->> k, k), v_ex_roles -> k);
    end loop;
    v_extra := jsonb_set(v_extra, '{roles}', v_new_ex);
  end if;

  update daikome.dk_payroll_settings s
     set roles = v_new_roles,
         pay_extra = v_extra,
         updated_at = now()
   where s.company_id = p_company_id;

  -- 人の 役割（辞めた 人も）。1つの 文で 書き換える＝入れ替えも 正しい
  update daikome.dk_employees e
     set role = p_map ->> e.role
   where e.company_id = p_company_id
     and p_map ? e.role;
  get diagnostics n_hito = row_count;

  -- 書いた 時刻も 返す（画面が 手元の updated_at を 揃える＝次の 保存で 自分を「他の 画面で 変わった」と 止めない）
  return json_build_object('ok', true, 'hito', n_hito, 'roles', v_new_roles,
    'updated_at', (select s.updated_at from daikome.dk_payroll_settings s where s.company_id = p_company_id));
end;
$fn$;

revoke all on function public.dk_yaku_namae_naoshi(uuid, jsonb) from public, anon;
grant execute on function public.dk_yaku_namae_naoshi(uuid, jsonb) to authenticated;
