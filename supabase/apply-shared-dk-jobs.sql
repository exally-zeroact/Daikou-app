-- ============================================================================
-- ダイコメ 実績まわり 追加スクリプト（共有本番倉庫 tnfwipbgfgjaymlszeid 用）
--   2026-08-01
--
--   ★このファイルは「足すだけ」★
--     ・新しい表 dk_shifts / dk_trips を作るだけ
--     ・既に在る物（dk_companies / dk_company_devices / pay_* / companies / meisai …）は
--       ★1バイトも触らない★。drop / delete / truncate / 既存ポリシーの作り直しは1つも書いていない。
--     ・何度実行しても同じ結果（if not exists のみ）
--
--   ▼なぜ migrate-standalone.sql を使わないのか
--     あれは「新しい空のプロジェクトに引っ越す」ための物で、
--     既存の dk_companies のポリシーを drop policy して作り直す記述が入っている。
--     この倉庫には Kyually本番 / Exally本番 / 代行請求の実データが同居しているので、
--     既存物に触る記述は持ち込まない。
--
--   ▼実行後の確認
--     node scripts/verify-standalone-migration.js
--     （表が出来ていれば HTTP 200 + 空配列、無ければ 404 で機械判定できる）
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) 勤務（業務開始 → 業務終了。1晩の勤務ぜんたい）
--    ★鍵 = (company_id, device_id, started_at)★ 同じ勤務を何度送っても増えない
-- ---------------------------------------------------------------------------
create table if not exists dk_shifts (
  shift_id         uuid primary key default gen_random_uuid(),
  company_id       uuid not null references dk_companies(company_id) on delete cascade,
  device_id        text not null,
  driver_id        uuid,
  started_at       timestamptz not null,
  ended_at         timestamptz,
  elapsed_sec      int,
  total_distance_m double precision,
  actual_total_m   double precision,
  empty_distance_m double precision,
  fare_total_yen   int,
  trip_count       int,
  created_at       timestamptz default now(),
  unique (company_id, device_id, started_at)
);

create index if not exists dk_shifts_company_started_idx
  on dk_shifts (company_id, started_at desc);

-- ---------------------------------------------------------------------------
-- 2) 代行（代行開始 → 精算終了。★課金の単位★）
--    距離・料金はメーターが確定した値をそのまま入れる（再計算・補正はしない）
--    customer_id は代行請求書アプリ companies.id（型が違っても入るよう text）
-- ---------------------------------------------------------------------------
create table if not exists dk_trips (
  trip_id       uuid primary key default gen_random_uuid(),
  shift_id      uuid not null references dk_shifts(shift_id) on delete cascade,
  company_id    uuid not null references dk_companies(company_id) on delete cascade,
  seq           int not null,
  distance_m    double precision not null,
  fare_yen      int not null,
  customer_id   text,
  customer_name text default '',
  payment_type  text not null default 'cash',
  started_at    timestamptz,
  ended_at      timestamptz,
  start_address text default '',
  end_address   text default '',
  waypoints     jsonb default '[]'::jsonb,
  created_at    timestamptz default now(),
  unique (shift_id, seq)
);

create index if not exists dk_trips_company_started_idx
  on dk_trips (company_id, started_at desc);

create index if not exists dk_trips_customer_idx
  on dk_trips (company_id, customer_id, started_at)
  where customer_id is not null;

-- ---------------------------------------------------------------------------
-- 3) 鍵（RLS）— ★新しい2つの表にだけ★
--    会社は自分の実績だけ読める。書き込みは Edge Function(service_role)のみ。
--    ※既存表のポリシーには一切触らない。
-- ---------------------------------------------------------------------------
alter table dk_shifts enable row level security;
alter table dk_trips  enable row level security;

-- 新しい表にしか作らないので drop policy は不要（同名が存在し得ない）
create policy dk_shifts_owner_sel on dk_shifts
  for select using (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );

create policy dk_trips_owner_sel on dk_trips
  for select using (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 4) 確認（目で見る用）
--    期待: dk_shifts / dk_trips が rls_enabled = true で2行、ポリシーが2本
-- ---------------------------------------------------------------------------
select tablename, rowsecurity as rls_enabled
  from pg_tables
 where schemaname = 'public' and tablename in ('dk_shifts', 'dk_trips')
 order by tablename;

select tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public' and tablename in ('dk_shifts', 'dk_trips')
 order by tablename, policyname;
