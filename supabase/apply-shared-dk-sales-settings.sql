-- ============================================================================
-- ダイコメ 売上表の設定（共有本番倉庫 tnfwipbgfgjaymlszeid 用）2026-08-01
--
--   ★このファイルは「足すだけ」★
--     ・新しい表 dk_device_labels（車の呼び名）と dk_sales_settings（売上から何を引くか）を作るだけ
--     ・既に在る物（dk_shifts / dk_company_devices / meisai / companies / pay_* …）は
--       ★1バイトも触らない★
--
--   ▼何のためか（司さん指示 2026-08-01）
--     「売上は橋代と高速代引いた分」
--     「ユーザー毎に引くものを選べるようにしとけよ」
--     → 会社ごとに「高速代／橋代／その他」のどれを売上から引くかを持つ。
--     既定は 高速代と橋代を引く（その他は引かない）。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) 車の呼び名（1号車 / 2号車 …）
--    ※ dk_company_devices（台数カウントの真実源・Edge Functionだけが書く）には触らない
-- ---------------------------------------------------------------------------
create table if not exists dk_device_labels (
  company_id uuid not null references dk_companies(company_id) on delete cascade,
  device_id  text not null,
  label      text default '',
  updated_at timestamptz default now(),
  primary key (company_id, device_id)
);

alter table dk_device_labels enable row level security;

create policy dk_device_labels_owner_sel on dk_device_labels
  for select using (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );
create policy dk_device_labels_owner_ins on dk_device_labels
  for insert with check (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );
create policy dk_device_labels_owner_upd on dk_device_labels
  for update using (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 2) 売上から何を引くか（会社ごとに選べる）
-- ---------------------------------------------------------------------------
create table if not exists dk_sales_settings (
  company_id    uuid primary key references dk_companies(company_id) on delete cascade,
  deduct_toll   boolean not null default true,   -- 高速代を引く
  deduct_bridge boolean not null default true,   -- 橋代を引く
  deduct_other  boolean not null default false,  -- その他を引く
  other_label   text default 'その他',            -- 「その他」の呼び名（駐車場代など）
  updated_at    timestamptz default now()
);

alter table dk_sales_settings enable row level security;

create policy dk_sales_settings_owner_sel on dk_sales_settings
  for select using (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );
create policy dk_sales_settings_owner_ins on dk_sales_settings
  for insert with check (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );
create policy dk_sales_settings_owner_upd on dk_sales_settings
  for update using (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );

-- 確認
select tablename, rowsecurity as rls_enabled
  from pg_tables
 where schemaname = 'public' and tablename in ('dk_device_labels', 'dk_sales_settings')
 order by tablename;
