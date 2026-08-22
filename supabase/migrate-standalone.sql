-- ============================================================================
-- ダイコメ 独立プロジェクト 一発構築SQL (2026-07-31)
--
--   ★使い方: 新しい Supabase プロジェクトの SQL Editor に、このファイルを丸ごと貼って1回実行。★
--   何度実行しても同じ結果になる(冪等)ので、失敗したらそのまま貼り直してよい。
--
--   これが作るもの:
--     dk_companies        … 契約している会社(1社1行)。会社URL(?c=)のトークン・契約台数・ON/OFF。
--     dk_company_devices  … 有効化されたスマホ(台数カウントの真実源)。
--     RLS                 … ログインした会社が「自分の会社と自分の端末」だけ見られる鍵。
--
--   ★含めていないもの(意図的)★
--     ・admin_token / 秘密リンク方式 … アカウント(マジックリンク)方式に置き換え済のため入れない。
--     ・テスト会社の自動作成         … アカウント方式では dashboard.html の登録フォームから作るのが正。
--
--   この後にやること(手順書 docs/DAIKOME_STANDALONE_MIGRATION.md 参照):
--     1) Ed25519 鍵ペアを作り、秘密鍵を Edge Function secret DK_LICENSE_PRIVKEY に入れる
--     2) Edge Function dk-issue-license / dk-register-company をデプロイ
--     3) Auth のメールログインを有効化 + リダイレクト許可URL を登録
--     4) js/dk-config.js の SB_URL / ANON_KEY を新プロジェクトの値に差し替え
--     5) js/license-v2.js の PUBLIC_KEY を新しい公開鍵に差し替え
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) 会社(契約単位)
--    url_token = 会社ごとの固有URL ?c=<これ>。推測不能な乱数(16byte hex)。ドライバーに配る。
--    status    = 'on' | 'off'。'off' は未払い等での停止。★会社側から戻せてはいけない(下のRLS参照)★
--    seat_limit= 契約台数(有効化できるスマホの数)。
--    owner_id  = この会社にログインできる人(auth.users.id)。1オーナー1会社。
-- ---------------------------------------------------------------------------
create table if not exists dk_companies (
  company_id uuid primary key default gen_random_uuid(),
  url_token  text unique not null,
  name       text default '',
  contact    text default '',
  status     text not null default 'on',
  seat_limit int  not null default 1,
  plan       text default '',
  owner_id   uuid,
  created_at timestamptz default now()
);

-- 既存プロジェクトから移す場合に備え、列は個別にも足せるように(冪等)
alter table dk_companies add column if not exists contact  text default '';
alter table dk_companies add column if not exists plan     text default '';
alter table dk_companies add column if not exists owner_id uuid;

-- 1オーナー = 1会社(owner_id が入っている行の中で一意)
create unique index if not exists dk_companies_owner_uidx
  on dk_companies (owner_id) where owner_id is not null;

-- ---------------------------------------------------------------------------
-- 2) 有効化されたスマホ(台数カウントの真実源)
--    ★台数はスマホ(device_id)単位★(車VIN固定は「めんどくさい」で撤回済・司さん決定 2026-07-28)。
--    同じスマホの再有効化は席を消費しない(主キーが (company_id, device_id) なので upsert で冪等)。
--    vin は参考情報として保存するだけ。判定には使わない。
-- ---------------------------------------------------------------------------
create table if not exists dk_company_devices (
  company_id uuid not null references dk_companies(company_id) on delete cascade,
  device_id  text not null,
  vin        text default '',
  last_seen  timestamptz default now(),
  created_at timestamptz default now(),
  primary key (company_id, device_id)
);

-- 台数カウント(会社ごとの件数)を速くする
create index if not exists dk_company_devices_company_idx
  on dk_company_devices (company_id);

-- ---------------------------------------------------------------------------
-- 3) RLS(行レベルセキュリティ) = 「誰がどの行を見られるか」の鍵
--    ・ログインした会社は、自分の会社と自分の端末だけ。他社の行は存在ごと見えない。
--    ・匿名(anonキーだけ)では0件。列挙できない。
--    ・書き込み(会社作成・端末登録)は Edge Function(service_role)だけ。service_role は RLS を通り抜ける。
-- ---------------------------------------------------------------------------
alter table dk_companies       enable row level security;
alter table dk_company_devices enable row level security;

-- 自分の会社だけ「読める」
drop policy if exists dk_companies_owner_sel on dk_companies;
create policy dk_companies_owner_sel on dk_companies
  for select using (owner_id = auth.uid());

-- ★update ポリシーは作らない(重要)★
--   会社側に update を許すと、停止(status='off')を本人が 'on' に戻せてしまい、
--   「未払いで止める」仕組みが丸ごと無効になる。status/seat_limit の変更は
--   管理(service_role)/課金フロー専用。insert も Edge Function 経由のみ。
drop policy if exists dk_companies_owner_upd on dk_companies;

-- 自分の会社の端末だけ「読める」
drop policy if exists dk_devices_owner_sel on dk_company_devices;
create policy dk_devices_owner_sel on dk_company_devices
  for select using (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );

-- 自分の会社の端末だけ「外せる」(壊れた/入れ替えたスマホの席を空ける)
drop policy if exists dk_devices_owner_del on dk_company_devices;
create policy dk_devices_owner_del on dk_company_devices
  for delete using (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );

-- insert/update(端末登録)は dk-issue-license(service_role)経由のみ。ポリシーを作らない = 誰も直接書けない。

-- ---------------------------------------------------------------------------
-- 4) 勤務(シフト) = 業務開始 → 業務終了。1晩の勤務ぜんたい。
--    メーターが localStorage に貯めた履歴を dk-sync-jobs が入れる。
--    ★鍵 = (company_id, device_id, started_at)★ … 同じ勤務を何度送っても増えない(冪等)。
-- ---------------------------------------------------------------------------
create table if not exists dk_shifts (
  shift_id         uuid primary key default gen_random_uuid(),
  company_id       uuid not null references dk_companies(company_id) on delete cascade,
  device_id        text not null,
  driver_id        uuid,                    -- 後で dk_drivers に紐付ける(今は空)
  started_at       timestamptz not null,
  ended_at         timestamptz,
  elapsed_sec      int,
  total_distance_m double precision,        -- 総走行(空車込み)
  actual_total_m   double precision,        -- 実車の合計
  empty_distance_m double precision,        -- 空車 = 総走行 − 実車
  fare_total_yen   int,                     -- 売上合計
  trip_count       int,                     -- 代行の件数
  created_at       timestamptz default now(),
  unique (company_id, device_id, started_at)
);

create index if not exists dk_shifts_company_started_idx
  on dk_shifts (company_id, started_at desc);

-- ---------------------------------------------------------------------------
-- 5) 代行 = 代行開始 → 精算終了。★課金の単位。売上と歩合の元ネタ。★
--    距離・料金はメーターが確定した値をそのまま入れる(再計算・補正はしない)。
-- ---------------------------------------------------------------------------
create table if not exists dk_trips (
  trip_id       uuid primary key default gen_random_uuid(),
  shift_id      uuid not null references dk_shifts(shift_id) on delete cascade,
  company_id    uuid not null references dk_companies(company_id) on delete cascade,
  seq           int not null,               -- 勤務内の何件目か(明細の順を毎回同じにする)
  distance_m    double precision not null,  -- ★メーター確定値★
  fare_yen      int not null,               -- ★メーター確定値★
  -- 請求書払い(掛け)。実車中に「請求書」ボタンで選ばれた会社。未選択なら現金。
  --   customer_name は「その時の名前」を焼き付ける(後でマスタから消えても過去の請求書が壊れない)
  customer_id   text,          -- 代行請求書アプリ companies.id
  customer_name text default '',
  payment_type  text not null default 'cash',   -- 'cash' | 'invoice'
  started_at    timestamptz,
  ended_at      timestamptz,
  start_address text default '',
  end_address   text default '',
  waypoints     jsonb default '[]'::jsonb,
  created_at    timestamptz default now(),
  unique (shift_id, seq)
);

-- 既存の表にも足せるように(冪等)
alter table dk_trips add column if not exists customer_id   text;
alter table dk_trips add column if not exists customer_name text default '';
alter table dk_trips add column if not exists payment_type  text not null default 'cash';

-- 掛けの集計(請求書作成)を速くする
create index if not exists dk_trips_customer_idx
  on dk_trips (company_id, customer_id, started_at)
  where customer_id is not null;

create index if not exists dk_trips_company_started_idx
  on dk_trips (company_id, started_at desc);

-- RLS: 会社は自分の実績だけ読める。書き込みは Edge Function(service_role)のみ。
alter table dk_shifts enable row level security;
alter table dk_trips  enable row level security;

drop policy if exists dk_shifts_owner_sel on dk_shifts;
create policy dk_shifts_owner_sel on dk_shifts
  for select using (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );

drop policy if exists dk_trips_owner_sel on dk_trips;
create policy dk_trips_owner_sel on dk_trips
  for select using (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 6) 事務所の画面が使う表（売上表 / 給料）
--    ★repo規約: dk_ 表を足したら必ず同じコミットでここにも追記する★
--    共有本番へは supabase/apply-shared-*.sql（足すだけ版）を使うこと。
--    ここは「新しい空のプロジェクトに引っ越す」ための1枚。
-- ---------------------------------------------------------------------------

-- 6-1) 勤務ごとの手入力（高速代・橋代・その他・車の時数）
create table if not exists dk_shift_edits (
  shift_id    uuid primary key references dk_shifts(shift_id) on delete cascade,
  company_id  uuid not null references dk_companies(company_id) on delete cascade,
  toll_yen    int default 0,
  bridge_yen  int default 0,
  other_yen   int default 0,
  other_label text default '',
  note        text default '',
  hours       double precision,   -- 車の時数（NULL=未入力→勤務の実時間から自動）
  updated_at  timestamptz default now()
);
alter table dk_shift_edits add column if not exists hours double precision;
create index if not exists dk_shift_edits_company_idx on dk_shift_edits (company_id);

-- 6-2) 車の呼び名
create table if not exists dk_device_labels (
  company_id uuid not null references dk_companies(company_id) on delete cascade,
  device_id  text not null,
  label      text default '',
  updated_at timestamptz default now(),
  primary key (company_id, device_id)
);

-- 6-3) 売上から何を引くか
create table if not exists dk_sales_settings (
  company_id    uuid primary key references dk_companies(company_id) on delete cascade,
  deduct_toll   boolean not null default true,
  deduct_bridge boolean not null default true,
  deduct_other  boolean not null default false,
  other_label   text default 'その他',
  updated_at    timestamptz default now()
);

-- 6-4) 従業員
create table if not exists dk_employees (
  employee_id uuid primary key default gen_random_uuid(),
  company_id  uuid not null references dk_companies(company_id) on delete cascade,
  name        text not null,
  role        text not null default '2種',
  active      boolean not null default true,
  sort_order  int default 0,
  note        text default '',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists dk_employees_company_idx
  on dk_employees (company_id, active, sort_order, name);

-- 6-5) 誰がどの車に乗ったか（日ごと）
create table if not exists dk_work_hours (
  company_id  uuid not null references dk_companies(company_id) on delete cascade,
  work_date   date not null,
  employee_id uuid not null references dk_employees(employee_id) on delete cascade,
  device_id   text default '',
  hours       double precision not null default 0,  -- 0=乗った車の時数を使う
  updated_at  timestamptz default now(),
  primary key (company_id, work_date, employee_id)
);
create index if not exists dk_work_hours_date_idx on dk_work_hours (company_id, work_date);

-- 6-6) 給料の決め方
create table if not exists dk_payroll_settings (
  company_id                 uuid primary key references dk_companies(company_id) on delete cascade,
  pool_mode                  text not null default 'others_total',
  deduct_reserve_before_rate boolean not null default true,
  reserve_pool_rate          double precision not null default 0.05,
  reserve_owner_rate         double precision not null default 0.05,
  period_start_day           int not null default 21,
  period_end_mode            text not null default 'thirds',   -- 月3回払い(1-10/11-20/21-末)
  period_days                int not null default 11,
  owner_device_id            text default '',
  roles                      jsonb not null default
    '{"2種":{"rate":0.35,"floor":1150},"1種":{"rate":0.30,"floor":1000}}'::jsonb,
  updated_at                 timestamptz default now()
);

-- 6-7) 月次集計の手入力ぶん（PayPay など。メーターが区別していない受け取り方）
create table if not exists dk_month_extras (
  company_id uuid not null references dk_companies(company_id) on delete cascade,
  ym         text not null,                       -- '2026-01'
  paypay_yen double precision not null default 0,
  note       text default '',
  updated_at timestamptz default now(),
  primary key (company_id, ym)
);

-- 6-8) 手で入れた1日分（スマホが無くても給料を出せるように）
--     ★同じ日・同じ車にメーターの記録がある時は、ロジック側で足し算せずメーターを正とする★
create table if not exists dk_manual_days (
  company_id  uuid not null references dk_companies(company_id) on delete cascade,
  work_date   date not null,
  device_id   text not null,
  sales_yen   double precision not null default 0,
  hours       double precision not null default 0,
  toll_yen    double precision not null default 0,
  bridge_yen  double precision not null default 0,
  other_yen   double precision not null default 0,
  trip_count  int not null default 0,
  note        text default '',
  updated_at  timestamptz default now(),
  primary key (company_id, work_date, device_id)
);
create index if not exists dk_manual_days_date_idx on dk_manual_days (company_id, work_date);

-- 6-9) RLS: 会社は自分の分だけ 読める / 足せる / 直せる
alter table dk_manual_days      enable row level security;
alter table dk_month_extras     enable row level security;
alter table dk_shift_edits      enable row level security;
alter table dk_device_labels    enable row level security;
alter table dk_sales_settings   enable row level security;
alter table dk_employees        enable row level security;
alter table dk_work_hours       enable row level security;
alter table dk_payroll_settings enable row level security;

do $$
declare
  t text;
  c text;
begin
  foreach t in array array[
    'dk_shift_edits', 'dk_device_labels', 'dk_sales_settings',
    'dk_employees', 'dk_work_hours', 'dk_payroll_settings', 'dk_month_extras',
    'dk_manual_days'
  ] loop
    foreach c in array array['select', 'insert', 'update'] loop
      execute format('drop policy if exists %I on %I', t || '_owner_' || left(c, 3), t);
      if c = 'insert' then
        execute format(
          'create policy %I on %I for insert with check '
          '(company_id in (select company_id from dk_companies where owner_id = auth.uid()))',
          t || '_owner_ins', t);
      else
        execute format(
          'create policy %I on %I for %s using '
          '(company_id in (select company_id from dk_companies where owner_id = auth.uid()))',
          t || '_owner_' || left(c, 3), t, c);
      end if;
    end loop;
  end loop;
  -- 手で入れた物は消せる（打ち間違いを取り消せるように）
  execute 'drop policy if exists dk_manual_days_owner_del on dk_manual_days';
  execute 'create policy dk_manual_days_owner_del on dk_manual_days for delete using '
       || '(company_id in (select company_id from dk_companies where owner_id = auth.uid()))';
  -- 時数だけは消せる（乗る人を間違えた日を取り消せるように）
  execute 'drop policy if exists dk_work_hours_owner_del on dk_work_hours';
  execute 'create policy dk_work_hours_owner_del on dk_work_hours for delete using '
       || '(company_id in (select company_id from dk_companies where owner_id = auth.uid()))';
end $$;

-- ---------------------------------------------------------------------------
-- 7) 確認: ここまでが正しく入ったかを目で見る
--    期待: 12個の表が rls_enabled = true で並ぶ。
-- ---------------------------------------------------------------------------
select tablename, rowsecurity as rls_enabled
  from pg_tables
 where schemaname = 'public'
   and tablename in ('dk_companies', 'dk_company_devices', 'dk_shifts', 'dk_trips',
                     'dk_shift_edits', 'dk_device_labels', 'dk_sales_settings',
                     'dk_employees', 'dk_work_hours', 'dk_payroll_settings',
                     'dk_month_extras', 'dk_manual_days')
 order by tablename;

select tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public'
   and tablename in ('dk_companies', 'dk_company_devices', 'dk_shifts', 'dk_trips',
                     'dk_shift_edits', 'dk_device_labels', 'dk_sales_settings',
                     'dk_employees', 'dk_work_hours', 'dk_payroll_settings',
                     'dk_month_extras', 'dk_manual_days')
 order by tablename, policyname;
