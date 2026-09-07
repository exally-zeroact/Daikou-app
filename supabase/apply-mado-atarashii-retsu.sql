-- ★★窓（public の view）が 本体の 新しい 列を 映していなかった★★ 2026-09-06（司さん「直せ」）
--
--   ★何が 起きていたか（実測）★
--     お客さんの 画面は ★public の 窓★ を 叩きます。本体は daikome。
--     私は 列を ★本体にだけ★ 足して、★窓を 作り直していませんでした★。
--       dk_payroll_settings … show_car_sales が 窓に 無い
--       dk_employees ……… slip_cars が 窓に 無い
--       dk_device_labels …… show_in_slip が 窓に 無い
--     ⇒ API は「そんな列は 知らない（PGRST204）」で ★400★
--     ⇒ 8/25 頃から ★保存が 1回も 通っていなかった★
--
--   ★注意（repo の SQL に 私が 書いていた事）★
--     `create or replace view` は ★security_invoker を 落とす★ので ★必ず 付け直す★。
--     3つとも 今 security_invoker=true・持ち主 postgres。同じに して 戻す。
--
--   ★データは 1行も 触りません★（映す列を 1本ずつ 足すだけ）

create or replace view public.dk_device_labels
  with (security_invoker = true) as
  select company_id, device_id, label, updated_at, sort_order, show_in_slip
    from daikome.dk_device_labels;

create or replace view public.dk_employees
  with (security_invoker = true) as
  select employee_id, company_id, name, role, active, sort_order, note,
         created_at, updated_at, pay_rate, pay_floor, slip_cars
    from daikome.dk_employees;

create or replace view public.dk_payroll_settings
  with (security_invoker = true) as
  select company_id, pool_mode, deduct_reserve_before_rate, reserve_pool_rate,
         reserve_owner_rate, period_start_day, period_end_mode, period_days,
         owner_device_id, roles, updated_at, show_car_sales
    from daikome.dk_payroll_settings;
