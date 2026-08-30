-- ============================================================
-- ★倉庫の「窓」= public から daikome の部屋を見せている view★
--
--   ★なぜこの紙が要るか（2026-08-09 実際に踏んだ）★
--     部屋(daikome.dk_companies)に列 home_city を足しただけで、
--     ★窓に足すのを忘れた★。アプリは窓ごしにしか見えないので、
--     その列を読みに行った途端 ★同期が丸ごと db_error で落ちた★。
--     文法チェックもテストも通る。★実際に叩いて初めて分かった★。
--     → 窓の中身をここに書いておき、CI で列の食い違いを止める
--       (tests/unit/public-window-columns.test.js)
--
--   ★HARD: create or replace view は security_invoker を落とす★
--     落ちると窓が「作った人の権限」で開き、RLS を素通りする。
--     必ず alter view ... set (security_invoker = true) を続けて当て、
--     当てた後に reloptions を数えること。
-- ============================================================
create or replace view public.dk_admins as
SELECT account_id,
    email,
    note,
    created_at
   FROM daikome.dk_admins;
alter view public.dk_admins set (security_invoker = true);

create or replace view public.dk_companies as
SELECT company_id,
    url_token,
    name,
    status,
    seat_limit,
    plan,
    created_at,
    contact,
    owner_id,
    home_city
   FROM daikome.dk_companies;
alter view public.dk_companies set (security_invoker = true);

create or replace view public.dk_company_devices as
SELECT company_id,
    device_id,
    vin,
    last_seen,
    created_at
   FROM daikome.dk_company_devices;
alter view public.dk_company_devices set (security_invoker = true);

create or replace view public.dk_device_labels as
SELECT company_id,
    device_id,
    label,
    updated_at,
    sort_order
   FROM daikome.dk_device_labels;
alter view public.dk_device_labels set (security_invoker = true);

create or replace view public.dk_employees as
SELECT employee_id,
    company_id,
    name,
    role,
    active,
    sort_order,
    note,
    created_at,
    updated_at,
    pay_rate,
    pay_floor
   FROM daikome.dk_employees;
alter view public.dk_employees set (security_invoker = true);

create or replace view public.dk_license_codes as
SELECT code,
    tenant_id,
    label,
    seat_limit,
    expires_at,
    created_at
   FROM daikome.dk_license_codes;
alter view public.dk_license_codes set (security_invoker = true);

create or replace view public.dk_licensed_devices as
SELECT device_id,
    tenant_id,
    expires_at,
    activated_at,
    label,
    vin,
    created_at,
    code
   FROM daikome.dk_licensed_devices;
alter view public.dk_licensed_devices set (security_invoker = true);

create or replace view public.dk_manual_days as
SELECT company_id,
    work_date,
    device_id,
    sales_yen,
    hours,
    toll_yen,
    bridge_yen,
    other_yen,
    trip_count,
    note,
    updated_at
   FROM daikome.dk_manual_days;
alter view public.dk_manual_days set (security_invoker = true);

create or replace view public.dk_month_extras as
SELECT company_id,
    ym,
    paypay_yen,
    note,
    updated_at
   FROM daikome.dk_month_extras;
alter view public.dk_month_extras set (security_invoker = true);

create or replace view public.dk_payroll_settings as
SELECT company_id,
    pool_mode,
    deduct_reserve_before_rate,
    reserve_pool_rate,
    reserve_owner_rate,
    period_start_day,
    period_end_mode,
    period_days,
    owner_device_id,
    roles,
    updated_at
   FROM daikome.dk_payroll_settings;
alter view public.dk_payroll_settings set (security_invoker = true);

create or replace view public.dk_sales_settings as
SELECT company_id,
    deduct_toll,
    deduct_bridge,
    deduct_other,
    other_label,
    updated_at
   FROM daikome.dk_sales_settings;
alter view public.dk_sales_settings set (security_invoker = true);

create or replace view public.dk_shift_edits as
SELECT shift_id,
    company_id,
    toll_yen,
    bridge_yen,
    other_yen,
    other_label,
    note,
    updated_at,
    hours
   FROM daikome.dk_shift_edits;
alter view public.dk_shift_edits set (security_invoker = true);

create or replace view public.dk_shifts as
SELECT shift_id,
    company_id,
    device_id,
    driver_id,
    started_at,
    ended_at,
    elapsed_sec,
    total_distance_m,
    actual_total_m,
    empty_distance_m,
    fare_total_yen,
    trip_count,
    created_at,
    excluded,
    note
   FROM daikome.dk_shifts;
alter view public.dk_shifts set (security_invoker = true);

create or replace view public.dk_trips as
SELECT trip_id,
    shift_id,
    company_id,
    seq,
    distance_m,
    fare_yen,
    customer_id,
    customer_name,
    payment_type,
    started_at,
    ended_at,
    start_address,
    end_address,
    waypoints,
    created_at,
    customer_note
   FROM daikome.dk_trips;
alter view public.dk_trips set (security_invoker = true);

create or replace view public.dk_work_hours as
SELECT company_id,
    work_date,
    employee_id,
    device_id,
    hours,
    updated_at
   FROM daikome.dk_work_hours;
alter view public.dk_work_hours set (security_invoker = true);

-- ★★料金表の 窓（Firebase → Supabase の 引っ越し）★★ 2026-08-30
--   ★司さんの指示★「全部Supabaseに引越ししたろが」「★Firebaseは2度と使うな★」「引っ越しもしろよ」
--   ★お金に 直結する棚★です。値は 引っ越し前と ★1円も 変えていません★
--   （787通りの 距離で 前後の 料金が 同じ事を tests/unit/fare-config-store.test.js が 見ています）。
create or replace view public.dk_fare_config as
SELECT company_id,
    config,
    updated_at,
    updated_by
   FROM public.dk_fare_config;
alter view public.dk_fare_config set (security_invoker = true);

-- ★変えた記録の 窓★（前は 上書き 1件だけで ★戻せませんでした★）
create or replace view public.dk_fare_config_history as
SELECT id,
    company_id,
    changed_at,
    changed_by,
    before_config,
    after_config,
    is_revert
   FROM public.dk_fare_config_history;
alter view public.dk_fare_config_history set (security_invoker = true);
